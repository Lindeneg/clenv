import {join as nodeJoin} from "node:path";
import {readFileSync} from "node:fs";

export type LoadEnvOpts = {
    files: string[];
    transformKeys: boolean;
    basePath?: string;
    encoding?: BufferEncoding;
    includeProcessEnv?: boolean | "overwrite";
    logger?: Logger | boolean;
    schemaParser?: SchemaParser;
    radix?: RadixFn;
};

//type LoadedEnvOpts = Required<Pick<LoadEnvOpts, "files" | "transformKeys">> &
//    Omit<LoadEnvOpts, "files" | "transformKeys">;

export function loadEnv<TOpts extends LoadEnvOpts, TConfig extends Config>(
    opts: TOpts,
    config: TConfig
): Result<
    {
        [K in keyof TConfig as TOpts["transformKeys"] extends true
            ? K extends string
                ? SafeCamelCase<K>
                : K
            : K]: InferValueFromTransformFn<TConfig[K]>;
    },
    string[]
> {
    const errors: string[] = [];
    const env: Record<PropertyKey, unknown> = {};
    const rawEnv: Record<string, string> = {};
    const seenKeys = new Set<string>();

    const log: Logger | undefined =
        typeof opts.logger === "function"
            ? opts.logger
            : opts.logger === true
              ? defaultLogger
              : undefined;

    const baseCtx: TransformContext = {
        rawEnv,
        ...(opts.schemaParser && {schemaParser: opts.schemaParser}),
        ...(opts.radix && {radix: opts.radix}),
        ...(log && {log}),
    };

    const allEntries = parseAllFiles(opts.files, errors, log, opts.basePath, opts.encoding);
    const deduped = deduplicate(allEntries, log);

    if (log) checkUnknownKeys(deduped, config, log);

    const expanded = expandEntries(deduped, log);

    if (opts.includeProcessEnv) {
        mergeProcessEnv(expanded, opts.includeProcessEnv, config, log);
    }

    function setVal(key: string, value: unknown) {
        const finalKey = opts.transformKeys ? toCamelCase(key) : key;
        (env as any)[finalKey] = value;
        rawEnv[key] = String(value);
    }

    for (const [key, value] of expanded) {
        const transform = config[key];
        if (!transform) continue;
        seenKeys.add(key);
        const entry = deduped.get(key);
        const source = expanded.getSource(key) ?? entry?.source ?? "unknown";
        const ctx: TransformContext = {
            ...baseCtx,
            ...(entry && {line: entry.line}),
            source,
        };
        try {
            const transformResult = transform(key, value, ctx);
            if (!transformResult.ok) {
                const prefix = entry ? `${source}:L${entry.line}: ${key}` : key;
                errors.push(`${prefix}: ${transformResult.ctx}`);
                continue;
            }
            setVal(key, transformResult.data);
        } catch (err) {
            const prefix = entry ? `${source}:L${entry.line}: ${key}` : key;
            errors.push(
                `${prefix}: transform function threw: ${err instanceof Error ? err.message : String(err)}`
            );
            continue;
        }
    }

    // handle unseen keys — pass undefined to signal "missing"
    const cfgEntries = Object.entries(config);
    if (seenKeys.size < cfgEntries.length) {
        for (const [cfgKey, cfgFn] of cfgEntries) {
            if (seenKeys.has(cfgKey)) continue;
            const ctx: TransformContext = {...baseCtx, source: "none"};
            try {
                const result = cfgFn(cfgKey, undefined, ctx);
                if (result.ok) {
                    log?.("debug", `${cfgKey}: not found in any file, using default`);
                    setVal(cfgKey, result.data);
                } else {
                    errors.push(result.ctx);
                }
            } catch (err) {
                errors.push(
                    `${cfgKey}: transform function threw: ${err instanceof Error ? err.message : String(err)}`
                );
            }
        }
    }

    if (errors.length) return failure(errors);

    if (log) {
        const fileCounts = new Map<string, number>();
        for (const entry of allEntries) {
            fileCounts.set(entry.source, (fileCounts.get(entry.source) ?? 0) + 1);
        }
        const parts: string[] = [];
        for (const [file, count] of fileCounts) {
            parts.push(`${count} from ${file}`);
        }
        log("debug", `loaded ${seenKeys.size} vars: ${parts.join(", ")}`);
    }

    return success(env as any);
}

export type LogLevel = "error" | "warn" | "debug" | "verbose";
export type Logger = (level: LogLevel, message: string) => void;

export type SchemaParser<TSchema = any, TReturn = any> = (
    obj: unknown,
    schema: TSchema,
    key: string
) => Result<TReturn, string>;

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

export function toString(key: string, v: string | undefined): Result<string> {
    if (v === undefined) return failure(`${key}: no value provided (use withDefault or withRequired)`);
    return success(v);
}

export function toBool(key: string, v: string | undefined): Result<boolean> {
    if (v === undefined) return failure(`${key}: no value provided (use withDefault or withRequired)`);
    const lower = v.toLowerCase();
    if (lower === "true" || v === "1") return success(true);
    if (lower === "false" || v === "0") return success(false);
    return failure(`${key}: expected boolean, got '${v}'`);
}

export function toInt(key: string, v: string | undefined, ctx: TransformContext): Result<number> {
    if (v === undefined) return failure(`${key}: no value provided (use withDefault or withRequired)`);
    return toNumber(key, v, ctx, "int");
}

export function toFloat(key: string, v: string | undefined, ctx: TransformContext): Result<number> {
    if (v === undefined) return failure(`${key}: no value provided (use withDefault or withRequired)`);
    return toNumber(key, v, ctx, "float");
}

export function toStringArray(delimiter = ",") {
    return function (key: string, v: string | undefined): Result<string[]> {
        if (v === undefined) return failure(`${key}: no value provided (use withDefault or withRequired)`);
        return success(v.split(delimiter).map((s) => s.trim()));
    };
}

export function toIntArray(delimiter = ",") {
    return function (key: string, v: string | undefined, ctx: TransformContext): Result<number[]> {
        if (v === undefined) return failure(`${key}: no value provided (use withDefault or withRequired)`);
        const parts = v.split(delimiter).map((s) => s.trim());
        const out: number[] = [];

        for (const p of parts) {
            const r = toInt(key, p, ctx);
            if (!r.ok) return r;
            out.push(r.data);
        }

        return success(out);
    };
}

export function toJSON<T>(schema?: unknown) {
    return function (k: string, v: string | undefined, ctx: TransformContext): Result<T> {
        if (v === undefined) return failure(`${k}: no value provided (use withDefault or withRequired)`);
        try {
            const json = JSON.parse(v);
            if (schema) {
                if (!ctx.schemaParser) {
                    return failure(
                        `${k}: schema provided but no schemaParser is set. ` +
                            "Please use 'schemaParser' in options."
                    );
                }
                return ctx.schemaParser(json, schema, k);
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
    return function (
        key: string,
        val: string | undefined,
        ctx: TransformContext
    ): Result<InferValueFromTransformFn<TTransform>> {
        if (val === undefined) return success(defaultValue);
        return transform(key, val, ctx);
    };
}

export function withRequired<TTransform extends TransformFn>(transform: TTransform) {
    return function (
        key: string,
        val: string | undefined,
        ctx: TransformContext
    ): Result<InferValueFromTransformFn<TTransform>> {
        if (val === undefined) return failure(`${key}: is required but is missing`);
        return transform(key, val, ctx);
    };
}

export function withOptional<T>(transform: TransformFn<T>): TransformFn<T | undefined> {
    return (key, val, ctx) => {
        if (val === undefined) return success(undefined);
        return transform(key, val, ctx);
    };
}

type Config = Record<string, TransformFn>;

type CamelCase<S extends string> = S extends `${infer Head}_${infer Tail}`
    ? `${Lowercase<Head>}${PascalTail<Tail>}`
    : Lowercase<S>;

type PascalTail<S extends string> = S extends `${infer Head}_${infer Tail}`
    ? `${Capitalize<Lowercase<Head>>}${PascalTail<Tail>}`
    : Capitalize<Lowercase<S>>;

type SafeCamelCase<S extends string> = S extends Uppercase<S> ? CamelCase<S> : S;

type RadixFn = (key: string) => number | undefined;

export type TransformContext = {
    rawEnv: Record<string, string>;
    schemaParser?: SchemaParser;
    radix?: RadixFn;
    log?: Logger;
    line?: number;
    source?: string;
};

type TransformFn<TData = any> = (
    key: string,
    val: string | undefined,
    ctx: TransformContext
) => Result<TData, string>;

type InferValueFromTransformFn<TTransform extends TransformFn> =
    ReturnType<TTransform> extends Result<infer TData> ? TData : never;

function defaultLogger(level: LogLevel, message: string) {
    console[level === "error" ? "error" : level === "warn" ? "warn" : "debug"](
        `[cl-env:${level}] ${message}`
    );
}

function readFile(path: string, encoding: BufferEncoding): Result<string> {
    try {
        const file = readFileSync(path, {encoding});
        return success(file);
    } catch (err) {
        return failure(err instanceof Error ? err.message : `failed to read env file: '${path}'`);
    }
}

function toCamelCase(s: string): string {
    if (s !== s.toUpperCase()) return s;
    return s.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function toNumber(key: string, v: string, ctx: TransformContext, parser: "int" | "float") {
    let n;
    if (parser === "int") {
        n = parseInt(v, ctx.radix ? ctx.radix(key) : 10);
    } else {
        n = parseFloat(v);
    }
    if (Number.isNaN(n)) return failure(`${key}: failed to convert '${v}' to a number`);
    return success(n);
}

function parseAllFiles(
    files: string[],
    errors: string[],
    log?: Logger,
    basePath?: string,
    encoding?: BufferEncoding
) {
    const allEntries: ParsedEntry[] = [];
    for (const file of files) {
        const fullPath = basePath ? nodeJoin(basePath, file) : file;
        const fileResult = readFile(fullPath, encoding ?? "utf8");
        if (fileResult.ok) {
            const {entries, warnings} = parseDotenv(fileResult.data);
            for (const entry of entries) {
                entry.source = file;
            }
            allEntries.push(...entries);
            log?.("verbose", `parsed ${file}: ${entries.length} entries`);
            if (log) {
                for (const w of warnings) {
                    log("warn", `${file}:${w.message}`);
                }
            }
        } else {
            log?.("verbose", `failed to read file: ${fullPath}`);
            errors.push(fileResult.ctx);
        }
    }
    return allEntries;
}

function deduplicate(allEntries: ParsedEntry[], log?: Logger) {
    const deduped = new Map<string, ParsedEntry>();
    for (const entry of allEntries) {
        const prev = deduped.get(entry.key);
        if (log && prev) {
            log(
                "warn",
                `${entry.source}:L${entry.line}: ${entry.key}: duplicate key, overwriting ${prev.source}:L${prev.line}`
            );
        }
        deduped.set(entry.key, entry);
    }
    return deduped;
}

function expandEntries(deduped: Map<string, ParsedEntry>, log?: Logger) {
    const expanded = new SourceMap();
    for (const [key, entry] of deduped) {
        if (entry.quoted === "'") {
            expanded.set(key, entry.value, entry.source);
        } else {
            const expandedValue = expand(key, entry, expanded, process.env, log);
            expanded.set(key, expandedValue, entry.source);
        }
    }
    return expanded;
}

function checkUnknownKeys(deduped: Map<string, ParsedEntry>, config: Config, log: Logger) {
    for (const [key, entry] of deduped) {
        if (!config[key]) {
            log("warn", `${entry.source}:L${entry.line}: ${key}: not a known key`);
        }
    }
}

function mergeProcessEnv(
    expanded: SourceMap,
    includeProcessEnv: boolean | "overwrite",
    config: Config,
    log?: Logger
) {
    const mode = includeProcessEnv === "overwrite" ? "overwrite" : "fallback";
    log?.("debug", `merging process.env as ${mode}`);
    for (const key of Object.keys(config)) {
        const pVal = process.env[key];
        if (pVal === undefined) continue;

        if (includeProcessEnv === "overwrite") {
            const prev = expanded.getSource(key);
            log?.(
                "verbose",
                `process.env: ${key}: overwrites${prev ? ` ${prev}` : ""} value`
            );
            expanded.set(key, pVal, "process.env");
        } else if (!expanded.has(key)) {
            log?.("verbose", `process.env: ${key}: using as fallback`);
            expanded.set(key, pVal, "process.env");
        }
    }
}

class SourceMap {
    private _values = new Map<string, string>();
    private _sources = new Map<string, string>();

    set(key: string, value: string, source: string) {
        this._values.set(key, value);
        this._sources.set(key, source);
    }
    get(key: string) {
        return this._values.get(key);
    }
    has(key: string) {
        return this._values.has(key);
    }
    getSource(key: string) {
        return this._sources.get(key);
    }
    [Symbol.iterator]() {
        return this._values[Symbol.iterator]();
    }
}

type ParsedEntry = {
    key: string;
    value: string;
    line: number;
    source: string;
    quoted?: '"' | "'" | "`";
};

type ParseWarning = {
    line: number;
    message: string;
};

function parseDotenv(raw: string): {entries: ParsedEntry[]; warnings: ParseWarning[]} {
    // strip BOM
    if (raw.charCodeAt(0) === 0xfeff) {
        raw = raw.slice(1);
    }
    // normalize line endings
    raw = raw.replace(/\r\n?/g, "\n");

    const entries: ParsedEntry[] = [];
    const warnings: ParseWarning[] = [];
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

        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
            warnings.push({
                line: entryLine,
                message: `L${entryLine}: ${key}: invalid key name (expected [A-Za-z_][A-Za-z0-9_]*)`,
            });
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
            // use array + join for O(n) instead of O(n²) string +=
            const parts: string[] = [];
            let terminated = false;
            advance();
            while (pos < raw.length) {
                const c = raw[pos];
                if (c === "\\") {
                    advance();
                    if (pos >= raw.length) break;
                    const esc = advance();
                    switch (esc) {
                        case "n":
                            parts.push("\n");
                            break;
                        case "r":
                            parts.push("\r");
                            break;
                        case "t":
                            parts.push("\t");
                            break;
                        case "\\":
                            parts.push("\\");
                            break;
                        case '"':
                            parts.push('"');
                            break;
                        default:
                            parts.push("\\" + esc);
                            break;
                    }
                } else if (c === '"') {
                    advance();
                    terminated = true;
                    break;
                } else {
                    parts.push(advance()!);
                }
            }
            value = parts.join("");
            if (!terminated) {
                warnings.push({
                    line: entryLine,
                    message: `L${entryLine}: ${key}: unterminated double quote, read to EOF`,
                });
            }
        } else if (quote === "'") {
            // single-quoted: literal, no escapes, multiline — use slice
            const start = pos + 1;
            let terminated = false;
            advance();
            while (pos < raw.length) {
                if (raw[pos] === "'") {
                    value = raw.slice(start, pos);
                    advance();
                    terminated = true;
                    break;
                }
                advance();
            }
            if (!terminated) {
                value = raw.slice(start, pos);
                warnings.push({
                    line: entryLine,
                    message: `L${entryLine}: ${key}: unterminated single quote, read to EOF`,
                });
            }
        } else if (quote === "`") {
            // backtick-quoted: literal, no escapes, multiline — use slice
            const start = pos + 1;
            let terminated = false;
            advance();
            while (pos < raw.length) {
                if (raw[pos] === "`") {
                    value = raw.slice(start, pos);
                    advance();
                    terminated = true;
                    break;
                }
                advance();
            }
            if (!terminated) {
                value = raw.slice(start, pos);
                warnings.push({
                    line: entryLine,
                    message: `L${entryLine}: ${key}: unterminated backtick quote, read to EOF`,
                });
            }
        } else {
            // unquoted: single line, inline comments, trim trailing whitespace — use slice
            const start = pos;
            let commentAt = -1;
            while (pos < raw.length && raw[pos] !== "\n") {
                if (
                    raw[pos] === "#" &&
                    pos > start &&
                    (raw[pos - 1] === " " || raw[pos - 1] === "\t")
                ) {
                    commentAt = pos;
                    break;
                }
                pos++;
            }
            const rawValue = raw.slice(start, commentAt >= 0 ? commentAt : pos);
            value = rawValue.trimEnd();
            if (commentAt < 0 && value.length < rawValue.length) {
                warnings.push({
                    line: entryLine,
                    message: `L${entryLine}: ${key}: suspicious trailing whitespace in unquoted value`,
                });
            }
        }

        // consume rest of line after quoted value
        skipToNewline();

        const quoted = quote === '"' || quote === "'" || quote === "`" ? quote : undefined;
        entries.push({key, value, line: entryLine, source: "", ...(quoted && {quoted})});
    }

    return {entries, warnings};
}

function expand(
    key: string,
    entry: ParsedEntry,
    resolved: SourceMap,
    env: Record<string, string | undefined>,
    log?: Logger
): string {
    return entry.value.replace(
        /\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
        (original, braced, bare) => {
            const name = braced ?? bare;
            const fromResolved = resolved.get(name);
            if (fromResolved !== undefined) {
                log?.(
                    "verbose",
                    `${entry.source}:L${entry.line}: ${key}: expanded $${name} from ${resolved.getSource(name)}`
                );
                return fromResolved;
            }
            const fromEnv = env[name];
            if (fromEnv !== undefined) {
                log?.("verbose", `${entry.source}:L${entry.line}: ${key}: expanded $${name} from process.env`);
                return fromEnv;
            }
            log?.("warn", `${entry.source}:L${entry.line}: ${key}: $${name} is not defined, left unexpanded`);
            return original;
        }
    );
}

class Foo {}

const k = unwrap(
    loadEnv(
        {files: [".env"], transformKeys: true},
        {
            OPTIONAL: withOptional(toInt),
            DATABASE_URL: withRequired(toString),
            PORT: withDefault(toInt, 3000),
            RANGE_VALUES: toIntArray(),
            GOOGLE_ID: toString,
            GOOGLE_MID: toString,
            PROCESS_TEST: toJSON<Foo>(),
            CUSTOM_STUFF_THING: withRequired((k, v) => {
                return success(new Foo());
            }),
        }
    )
);
