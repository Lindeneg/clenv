import path from "node:path";
import fs from "node:fs";

export type LoadEnvOpts = {
    transformKeys: boolean;
    path: string | string[];
    encoding?: BufferEncoding;
};

/**
 * Strongly typed loading of variables from a file.
 *
 * It does not modify `process.env` in order to prevent leakage of secrets to child processes.
 *
 * Instead it just returns a strongly typed object.
 *
 * The keys are inferred from the `config` argument. The values of each
 * key is derived from the return type of the `transform` function you provide.
 *
 * If `transformKeys` is set to `true`, then all properties `WITH_THIS_FORMAT` are converted
 * to `camelCase` and this is enforced at the type-level and of course in the object itself.
 * If it is set to false, all property names remain untouched and are used as is.
 *
 * If `path` is an array of strings, the contents will be passed to `path.join` and the
 * result will be passed onto `readFile`. If `path` is a string, it's used as is.
 *
 * */
export function loadEnv<TOpts extends LoadEnvOpts, TEnv extends {[key: string]: TransformFn}>(
    opts: TOpts,
    config: TEnv
): Result<
    {
        [K in keyof TEnv as TOpts["transformKeys"] extends true
            ? K extends string
                ? SafeCamelCase<K>
                : K
            : K]: InferValueFromTransformFn<TEnv[K]>;
    },
    string[]
> {
    const errors: string[] = [];
    const env: Record<PropertyKey, unknown> = {};
    const seenKeys = new Set<string>();

    const envPath = Array.isArray(opts.path) ? path.join(...opts.path) : opts.path;

    const fileResult = readFile(envPath, opts.encoding ?? "utf8");
    if (!fileResult.ok) return failure([fileResult.ctx]);

    function setVal(key: string, value: unknown) {
        if (opts.transformKeys) {
            env[toCamelCase(key)] = value;
        } else {
            env[key] = value;
        }
    }

    // convert line breaks to same format
    const lines = fileResult.data.replace(/\r\n?/gm, "\n").split("\n");
    for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        // skip commented lines
        if (line.startsWith("#")) continue;
        // strip export (for bash compatibility)
        if (line.startsWith("export ")) line = line.slice(7);
        const eqIdx = line.indexOf("=");
        if (eqIdx === -1) continue;
        let [key, value] = [line.slice(0, eqIdx).trim(), line.slice(eqIdx + 1).trim()];
        if (!key) continue;
        const transform = config[key];
        // ignore unknown key
        if (!transform) continue;
        if (!value) value = "";
        // save this for " check
        const first = value[0];
        // remove surrounding quotes
        value = value.replace(/^(['"`])([\s\S]*)\1$/, "$2");
        // expand newlines if double quoted
        if (first === '"') {
            value = value.replace(/\\n/g, "\n");
            value = value.replace(/\\r/g, "\r");
        }
        seenKeys.add(key);
        try {
            const transformResult = transform(key, value);
            if (!transformResult.ok) {
                errors.push(transformResult.ctx);
                continue;
            }
            value = transformResult.data;
        } catch (err) {
            errors.push(`${key}: transform function threw: ` + err);
            continue;
        }

        setVal(key, value);
    }

    // check if we have covered all keys
    // specified in config. If not, call
    // `transform` for unseen keys
    const cfgEntries = Object.entries(config);
    if (seenKeys.size < cfgEntries.length) {
        for (const [cfgKey, cfgFn] of cfgEntries) {
            if (seenKeys.has(cfgKey)) continue;
            const result = cfgFn(cfgKey, "");
            if (result.ok) {
                setVal(cfgKey, result.data);
            } else {
                errors.push(result.ctx);
            }
        }
    }

    if (errors.length) return failure(errors);

    return success(env as any);
}

type ResultSuccess<TData> = {
    data: TData;
    ok: true;
};

interface ResultFailure<TCtx> {
    ctx: TCtx;
    ok: false;
}

export type Result<TData, TErrorCtx = string> = ResultSuccess<TData> | ResultFailure<TErrorCtx>;

export function success<TData>(data: TData): ResultSuccess<TData> {
    return {data, ok: true};
}

export function failure<TCtx>(ctx: TCtx): ResultFailure<TCtx> {
    return {ok: false, ctx};
}

export function unwrap<T extends Result<any, any>>(
    r: T
): [T] extends [Result<infer TData, any>] ? TData : never {
    if (!r.ok) throw new Error(Array.isArray(r.ctx) ? r.ctx.join("\n") : r.ctx);
    return r.data;
}

export function toString(_: string, v: string): Result<string> {
    return success(v);
}

export function toBool(_: string, v: string): Result<boolean> {
    if (v === "true" || v === "TRUE" || v === "1") return success(true);
    return success(false);
}

export function toInt(key: string, v: string): Result<number> {
    return toNumber(key, v, "int");
}

export function toFloat(key: string, v: string): Result<number> {
    return toNumber(key, v, "float");
}

export function toStringArray(delimiter = ",") {
    return function (_: string, v: string): Result<string[]> {
        return success(v.split(delimiter));
    };
}

export function toIntArray(delimiter = ",") {
    return function (key: string, v: string): Result<number[]> {
        const splitted = v.split(delimiter);
        const arr: number[] = [];
        for (const val of splitted) {
            const result = toInt(key, val);
            if (!result.ok) return result;
            arr.push(result.data);
        }
        return success(arr);
    };
}

export function toJSON<T>() {
    return function (k: string, v: string): Result<T> {
        try {
            const json = JSON.parse(v);
            return success(json);
        } catch (err) {
            return failure(`${k}: failed to convert to JSON`);
        }
    };
}

export function withDefault<TTransform extends TransformFn>(
    transform: TTransform,
    defaultValue: InferValueFromTransformFn<TTransform>
) {
    return function (key: string, val: string): Result<InferValueFromTransformFn<TTransform>> {
        if (!val) return success(defaultValue);
        return transform(key, val);
    };
}

export function withRequired<TTransform extends TransformFn>(transform: TTransform) {
    return function (key: string, val: string): Result<InferValueFromTransformFn<TTransform>> {
        if (!val) return failure(`${key}: is required but is missing`);
        return transform(key, val);
    };
}

type CamelCase<S extends string> = S extends `${infer Head}_${infer Tail}`
    ? `${Lowercase<Head>}${PascalTail<Tail>}`
    : Lowercase<S>;

type PascalTail<S extends string> = S extends `${infer Head}_${infer Tail}`
    ? `${Capitalize<Lowercase<Head>>}${PascalTail<Tail>}`
    : Capitalize<Lowercase<S>>;

type SafeCamelCase<S extends string> = S extends Uppercase<S> ? CamelCase<S> : S;

type TransformFn = (key: string, val: string) => Result<any, string>;

type InferValueFromTransformFn<TTransform extends TransformFn> =
    ReturnType<TTransform> extends Result<infer TData> ? TData : never;

function readFile(path: string, encoding: BufferEncoding): Result<string> {
    try {
        const file = fs.readFileSync(path, {encoding}).toString();
        return success(file);
    } catch (err) {
        return failure(err instanceof Error ? err.message : `failed to read env file: '${path}'`);
    }
}

function toCamelCase(s: string): string {
    if (s !== s.toUpperCase()) return s;
    return s.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function toNumber(key: string, v: string, parser: "int" | "float") {
    const n = parser === "int" ? parseInt(v) : parseFloat(v);
    if (Number.isNaN(n)) return failure(`${key}: failed to convert '${v}' to a number`);
    return success(n);
}
