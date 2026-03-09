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

export type LoadEnvOpts = {
    files: string[];
    transformKeys: boolean;
    basePath?: string;
    encoding?: BufferEncoding;
    includeProcessEnv?: "fallback" | "override" | false;
    logger?: Logger | boolean;
    schemaParser?: SchemaParser;
    radix?: RadixFn;
};

export type ResolveEnvResult<TOpts extends LoadEnvOpts, TConfig extends Config> = Result<
    {
        [K in keyof TConfig as TOpts["transformKeys"] extends true
            ? K extends string
                ? SafeCamelCase<K>
                : K
            : K]: InferValueFromTransformFn<TConfig[K]>;
    },
    EnvError[]
>;

const LOG_CONFIG: Record<
    LogLevel,
    {method: "error" | "warn" | "log" | "debug"; color: string; pad: string}
> = {
    error: {method: "error", color: "\x1b[31m", pad: "  "},
    warn: {method: "warn", color: "\x1b[33m", pad: "   "},
    debug: {method: "debug", color: "\x1b[36m", pad: "  "},
    verbose: {method: "log", color: "\x1b[2m", pad: ""},
};

export function defaultLogger(level: LogLevel, message: string) {
    const {method, color, pad} = LOG_CONFIG[level];
    console[method](`${color}[cl-env:${level}]${pad}\x1b[0m ${message}`);
}

export function resolveLogger(logger: Logger | boolean | undefined): Logger | undefined {
    return typeof logger === "function" ? logger : logger === true ? defaultLogger : undefined;
}

export function parseFileContents(
    fileContents: Map<string, string>,
    errors: EnvError[],
    log?: Logger
): ParsedEntry[] {
    const allEntries: ParsedEntry[] = [];
    for (const [file, content] of fileContents) {
        const {entries, warnings} = parseDotenv(content);
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
    }
    return allEntries;
}

export function resolveEnv<const TOpts extends LoadEnvOpts, TConfig extends Config>(
    opts: TOpts,
    config: TConfig,
    fileContents: Map<string, string>,
    fileErrors: EnvError[]
): ResolveEnvResult<TOpts, TConfig> {
    const errors: EnvError[] = [...fileErrors];
    const env: Record<string, unknown> = {};
    const rawEnv: Record<string, string> = {};
    const seenKeys = new Set<string>();

    const log = resolveLogger(opts.logger);

    const baseCtx: TransformContext = {
        rawEnv,
        ...(opts.schemaParser && {schemaParser: opts.schemaParser}),
        ...(opts.radix && {radix: opts.radix}),
        ...(log && {log}),
    };

    const allEntries = parseFileContents(fileContents, errors, log);
    if (allEntries.length === 0 && errors.length > 0) return failure(errors) as any;
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

    if (errors.length) return failure(errors) as any;

    if (log) log("debug", `successfully loaded ${Object.keys(env).length} vars`);

    return success(env as any) as any;
}

function toCamelCase(s: string): string {
    if (s !== s.toUpperCase()) return s;
    return s.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
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

const VAR_REF_RE = /\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

function extractRefs(value: string): string[] {
    const refs: string[] = [];
    let match;
    VAR_REF_RE.lastIndex = 0;
    while ((match = VAR_REF_RE.exec(value)) !== null) {
        refs.push((match[1] ?? match[2])!);
    }
    return refs;
}

function expandEntries(deduped: Map<string, ParsedEntry>, log?: Logger) {
    const expanded = new SourceMap();

    // build dependency graph (internal refs only, excluding self-refs)
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    for (const key of deduped.keys()) {
        inDegree.set(key, 0);
        dependents.set(key, []);
    }

    for (const [key, entry] of deduped) {
        if (entry.quoted === "'") continue;
        const refs = extractRefs(entry.value);
        const seen = new Set<string>();
        for (const ref of refs) {
            if (ref === key || seen.has(ref) || !deduped.has(ref)) continue;
            seen.add(ref);
            inDegree.set(key, inDegree.get(key)! + 1);
            dependents.get(ref)!.push(key);
        }
    }

    // Kahn's algorithm — topological sort
    const queue: string[] = [];
    for (const [key, degree] of inDegree) {
        if (degree === 0) queue.push(key);
    }

    const order: string[] = [];
    while (queue.length > 0) {
        const key = queue.shift()!;
        order.push(key);
        for (const dep of dependents.get(key)!) {
            const newDegree = inDegree.get(dep)! - 1;
            inDegree.set(dep, newDegree);
            if (newDegree === 0) queue.push(dep);
        }
    }

    // expand in dependency order
    for (const key of order) {
        const entry = deduped.get(key)!;
        if (entry.quoted === "'") {
            expanded.set(key, entry.value, entry.source);
        } else {
            expanded.set(key, expand(key, entry, expanded, process.env, log), entry.source);
        }
    }

    // handle cyclic entries — warn and expand best-effort
    if (order.length < deduped.size) {
        const orderSet = new Set(order);
        for (const [key, entry] of deduped) {
            if (orderSet.has(key)) continue;
            log?.(
                "warn",
                `${entry.source}:L${entry.line}: ${key}: involved in cyclic reference, expansion may be incomplete`
            );
            if (entry.quoted === "'") {
                expanded.set(key, entry.value, entry.source);
            } else {
                expanded.set(key, expand(key, entry, expanded, process.env, log), entry.source);
            }
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
    return entry.value.replace(VAR_REF_RE, (original, braced, bare) => {
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
    });
}
