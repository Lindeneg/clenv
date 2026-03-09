import {join as nodeJoin} from "node:path";
import {readFileSync} from "node:fs";
import type {EnvError} from "./result.js";
import type {Config} from "./types.js";
import {type LoadEnvOpts, type ResolveEnvResult, resolveEnv, resolveLogger} from "./core.js";

function readEnvFile(
    file: string,
    encoding: BufferEncoding,
    basePath?: string
): {file: string; content: string} | {file: string; error: string} {
    const fullPath = basePath ? nodeJoin(basePath, file) : file;
    try {
        const content = readFileSync(fullPath, {encoding});
        return {file, content};
    } catch (err) {
        return {
            file,
            error: `failed to read '${fullPath}': ${err instanceof Error ? ((err as NodeJS.ErrnoException).code ?? err.message) : String(err)}`,
        };
    }
}

export function loadEnv<const TOpts extends LoadEnvOpts, TConfig extends Config>(
    opts: TOpts,
    config: TConfig
): ResolveEnvResult<TOpts, TConfig> {
    const encoding = opts.encoding ?? "utf8";
    const fileContents = new Map<string, string>();
    const fileErrors: EnvError[] = [];
    const log = resolveLogger(opts.logger);

    for (const file of opts.files) {
        const result = readEnvFile(file, encoding, opts.basePath);
        if ("content" in result) {
            fileContents.set(result.file, result.content);
        } else {
            log?.(
                "verbose",
                `failed to read file: ${opts.basePath ? nodeJoin(opts.basePath, file) : file}`
            );
            fileErrors.push({key: file, source: file, message: result.error});
        }
    }

    for (const file of opts.optionalFiles ?? []) {
        const result = readEnvFile(file, encoding, opts.basePath);
        if ("content" in result) {
            fileContents.set(result.file, result.content);
        } else {
            log?.("debug", `optional file not found, skipping: ${file}`);
        }
    }

    return resolveEnv(opts, config, fileContents, fileErrors);
}
