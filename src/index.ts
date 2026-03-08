import path from "node:path";
import fs from "node:fs";

export type LoadEnvOpts = {
    transformKeys: boolean;
    path: string | string[];
    encoding?: BufferEncoding;
};

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

    const entries = parseDotenv(fileResult.data);
    for (const entry of entries) {
        const transform = config[entry.key];
        // ignore unknown key
        if (!transform) continue;
        seenKeys.add(entry.key);
        try {
            const transformResult = transform(entry.key, entry.value);
            if (!transformResult.ok) {
                errors.push(`${entry.key}:L${entry.line}: ${transformResult.ctx}`);
                continue;
            }
            setVal(entry.key, transformResult.data);
        } catch (err) {
            errors.push(`${entry.key}:L${entry.line}: transform function threw: ` + err);
            continue;
        }
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
                errors.push(`${cfgKey}: ${result.ctx}`);
            }
        }
    }

    if (errors.length) return failure(errors);

    return success(env as any);
}

export type SchemaParser<TSchema = any, TReturn = any> = (
    obj: unknown,
    schema: TSchema,
    key: string
) => Result<TReturn, string>;

export const schemaParser = (() => {
    let parser: SchemaParser | null = null;

    return {
        get() {
            return parser;
        },
        set(newParser: SchemaParser | null) {
            parser = newParser;
            return {loadEnv};
        },
    };
})();

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

export function toBool(key: string, v: string): Result<boolean> {
    const lower = v.toLowerCase();
    if (lower === "true" || v === "1") return success(true);
    if (lower === "false" || v === "0") return success(false);
    return failure(`${key}: expected boolean, got '${v}'`);
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

export function toJSON<T>(schema?: unknown) {
    return function (k: string, v: string): Result<T> {
        try {
            const json = JSON.parse(v);
            if (schema) {
                const parser = schemaParser.get();
                if (!parser) {
                    return failure(
                        `${k}: schema provided but no schemaParser is set. ` +
                            "Please use '.schemaParser.set(...).loadEnv(...)'"
                    );
                }
                return parser(json, schema, k);
            }
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
    const n = parser === "int" ? parseInt(v, 10) : parseFloat(v);
    if (Number.isNaN(n)) return failure(`${key}: failed to convert '${v}' to a number`);
    return success(n);
}

type ParsedEntry = {
    key: string;
    value: string;
    line: number;
};

function parseDotenv(raw: string): ParsedEntry[] {
    // strip BOM
    if (raw.charCodeAt(0) === 0xfeff) {
        raw = raw.slice(1);
    }
    // normalize line endings
    raw = raw.replace(/\r\n?/g, "\n");

    const entries: ParsedEntry[] = [];
    let pos = 0;
    let line = 1;

    function advance(): string | undefined {
        const ch = raw[pos++];
        if (ch === "\n") line++;
        return ch;
    }

    function skipInlineWhitespace() {
        while (pos < raw.length && (raw[pos] === " " || raw[pos] === "\t")) {
            pos++;
        }
    }

    function skipToNewline() {
        while (pos < raw.length && raw[pos] !== "\n") pos++;
        if (pos < raw.length) advance();
    }

    while (pos < raw.length) {
        skipInlineWhitespace();

        if (raw[pos] === "\n") {
            advance();
            continue;
        }

        // comment line
        if (raw[pos] === "#") {
            skipToNewline();
            continue;
        }

        // strip `export ` prefix
        if (raw.startsWith("export ", pos)) {
            pos += 7;
            skipInlineWhitespace();
        }

        const entryLine = line;

        // read key
        let key = "";
        while (pos < raw.length) {
            const c = raw[pos];
            if (c === "=" || c === " " || c === "\t" || c === "\n") break;
            key += advance();
        }

        if (!key) {
            skipToNewline();
            continue;
        }

        skipInlineWhitespace();

        if (raw[pos] !== "=") {
            skipToNewline();
            continue;
        }
        // consume =
        advance();

        skipInlineWhitespace();

        let value = "";
        const quote = raw[pos];

        if (quote === '"') {
            // double-quoted: escape sequences, multiline
            advance();
            while (pos < raw.length) {
                const c = raw[pos];
                if (c === "\\") {
                    advance();
                    if (pos >= raw.length) break;
                    const esc = advance();
                    switch (esc) {
                        case "n":
                            value += "\n";
                            break;
                        case "r":
                            value += "\r";
                            break;
                        case "t":
                            value += "\t";
                            break;
                        case "\\":
                            value += "\\";
                            break;
                        case '"':
                            value += '"';
                            break;
                        default:
                            value += "\\" + esc;
                            break;
                    }
                } else if (c === '"') {
                    advance();
                    break;
                } else {
                    value += advance();
                }
            }
        } else if (quote === "'") {
            // single-quoted: literal, no escapes, multiline
            advance();
            while (pos < raw.length) {
                if (raw[pos] === "'") {
                    advance();
                    break;
                }
                value += advance();
            }
        } else if (quote === "`") {
            // backtick-quoted: literal, no escapes, multiline
            advance();
            while (pos < raw.length) {
                if (raw[pos] === "`") {
                    advance();
                    break;
                }
                value += advance();
            }
        } else {
            // unquoted: single line, inline comments, trim trailing whitespace
            while (pos < raw.length && raw[pos] !== "\n") {
                if (
                    raw[pos] === "#" &&
                    value.length > 0 &&
                    (raw[pos - 1] === " " || raw[pos - 1] === "\t")
                ) {
                    value = value.trimEnd();
                    break;
                }
                value += raw[pos];
                pos++;
            }
            value = value.trimEnd();
        }

        // consume rest of line after quoted value
        skipToNewline();

        entries.push({key, value, line: entryLine});
    }

    return entries;
}
