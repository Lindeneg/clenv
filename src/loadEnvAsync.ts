import {readFile} from "node:fs/promises";
import {join as nodeJoin} from "node:path";
import {resolveEnv, resolveLogger, type LoadEnvOpts, type ResolveEnvResult} from "./core.js";
import type {EnvError} from "./result.js";
import type {Config} from "./types.js";

async function readEnvFile(
    file: string,
    encoding: BufferEncoding,
    basePath?: string
): Promise<{file: string; content: string} | {file: string; error: string}> {
    const fullPath = basePath ? nodeJoin(basePath, file) : file;
    try {
        const content = await readFile(fullPath, {encoding});
        return {file, content};
    } catch (err) {
        return {
            file,
            error: `failed to read '${fullPath}': ${err instanceof Error ? ((err as NodeJS.ErrnoException).code ?? err.message) : String(err)}`,
        };
    }
}

export async function loadEnvAsync<const TOpts extends LoadEnvOpts, TConfig extends Config>(
    opts: TOpts,
    config: TConfig
): Promise<ResolveEnvResult<TOpts, TConfig>> {
    const encoding = opts.encoding ?? "utf8";
    const fileContents = new Map<string, string>();
    const fileErrors: EnvError[] = [];
    const log = resolveLogger(opts.logger);

    const allReads = [
        ...opts.files.map((file) => ({file, required: true as const})),
        ...(opts.optionalFiles ?? []).map((file) => ({file, required: false as const})),
    ];

    const results = await Promise.all(
        allReads.map(async ({file, required}) => ({
            ...(await readEnvFile(file, encoding, opts.basePath)),
            required,
        }))
    );

    for (const result of results) {
        if ("content" in result) {
            fileContents.set(result.file, result.content);
        } else if (result.required) {
            log?.(
                "verbose",
                `failed to read file: ${opts.basePath ? nodeJoin(opts.basePath, result.file) : result.file}`
            );
            fileErrors.push({key: result.file, source: result.file, message: result.error});
        } else {
            log?.("debug", `optional file not found, skipping: ${result.file}`);
        }
    }

    return resolveEnv(opts, config, fileContents, fileErrors);
}
