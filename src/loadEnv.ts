import {join as nodeJoin} from "node:path";
import {readFileSync} from "node:fs";
import {parseDotenv} from "./parser.js";
import {success, failure, type Result, type EnvError} from "./result.js";
import type {
    Logger,
    LogLevel,
    SchemaParser,
    TransformContext,
    Config,
    RadixFn,
    InferValueFromTransformFn,
    SafeCamelCase,
    ParsedEntry,
} from "./types.js";

type LoadEnvOpts = {
    files: string[];
    transformKeys: boolean;
    basePath?: string;
    encoding?: BufferEncoding;
    includeProcessEnv?: "fallback" | "override" | false;
    logger?: Logger | boolean;
    schemaParser?: SchemaParser;
    radix?: RadixFn;
};

export function loadEnv<const TOpts extends LoadEnvOpts, TConfig extends Config>(
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
    EnvError[]
> {
    const errors: EnvError[] = [];
    const env: Record<string, unknown> = {};
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
    if (allEntries.length === 0 && errors.length > 0) return failure(errors);
    const deduped = deduplicate(allEntries, log);

    if (log) checkUnknownKeys(deduped, config, log);

    const expanded = expandEntries(deduped, log);

    if (opts.includeProcessEnv) {
        mergeProcessEnv(expanded, opts.includeProcessEnv, config, log);
    }

    // populate rawEnv from expanded values before any transforms run
    for (const [key, value] of expanded) {
        rawEnv[key] = value;
    }

    function setVal(key: string, value: unknown) {
        const finalKey = opts.transformKeys ? toCamelCase(key) : key;
        (env as any)[finalKey] = value;
    }

    for (const [key, value] of expanded) {
        const transform = config[key];
        if (!transform) continue;
        seenKeys.add(key);
        const entry = deduped.get(key);
        // source should always resolve from expanded or entry; "unknown" is defensive
        const source = expanded.getSource(key) ?? entry?.source ?? "unknown";
        const ctx: TransformContext = {
            ...baseCtx,
            ...(entry && {line: entry.line}),
            source,
        };
        try {
            const transformResult = transform(key, value, ctx);
            if (!transformResult.ok) {
                errors.push({
                    key,
                    ...(entry && {line: entry.line}),
                    source,
                    message: transformResult.ctx,
                });
                continue;
            }
            setVal(key, transformResult.data);
        } catch (err) {
            errors.push({
                key,
                ...(entry && {line: entry.line}),
                source,
                message: `transform function threw: ${err instanceof Error ? err.message : String(err)}`,
            });
            continue;
        }
    }

    // handle unseen keys, pass undefined to signal "missing"
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
                    errors.push({key: cfgKey, source: "none", message: result.ctx});
                }
            } catch (err) {
                errors.push({
                    key: cfgKey,
                    source: "none",
                    message: `transform function threw: ${err instanceof Error ? err.message : String(err)}`,
                });
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

function defaultLogger(level: LogLevel, message: string) {
    const method =
        level === "error"
            ? "error"
            : level === "warn"
              ? "warn"
              : level === "verbose"
                ? "log"
                : "debug";
    console[method](`[cl-env:${level}] ${message}`);
}

function readFile(path: string, encoding: BufferEncoding): Result<string> {
    try {
        const file = readFileSync(path, {encoding});
        return success(file);
    } catch (err: any) {
        return failure(
            `failed to read '${path}': ${err?.code ?? (err instanceof Error ? err.message : String(err))}`
        );
    }
}

function toCamelCase(s: string): string {
    if (s !== s.toUpperCase()) return s;
    return s.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function parseAllFiles(
    files: string[],
    errors: EnvError[],
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
            errors.push({key: file, source: file, message: fileResult.ctx});
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
    mode: "fallback" | "override",
    config: Config,
    log?: Logger
) {
    log?.("debug", `merging process.env as ${mode}`);
    for (const key of Object.keys(config)) {
        const pVal = process.env[key];
        if (pVal === undefined) continue;

        if (mode === "override") {
            const prev = expanded.getSource(key);
            log?.("verbose", `process.env: ${key}: overrides${prev ? ` ${prev}` : ""} value`);
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
                log?.(
                    "verbose",
                    `${entry.source}:L${entry.line}: ${key}: expanded $${name} from process.env`
                );
                return fromEnv;
            }
            log?.(
                "warn",
                `${entry.source}:L${entry.line}: ${key}: $${name} is not defined, left unexpanded`
            );
            return original;
        }
    );
}
