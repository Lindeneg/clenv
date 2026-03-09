import {readFile} from "node:fs/promises";
import {join as nodeJoin} from "node:path";
import {resolveEnv, resolveLogger, type LoadEnvOpts, type ResolveEnvResult} from "./core.js";
import type {EnvError} from "./result.js";
import type {Config} from "./types.js";

export async function loadEnvAsync<const TOpts extends LoadEnvOpts, TConfig extends Config>(
    opts: TOpts,
    config: TConfig
): Promise<ResolveEnvResult<TOpts, TConfig>> {
    const encoding = opts.encoding ?? "utf8";
    const fileContents = new Map<string, string>();
    const fileErrors: EnvError[] = [];
    const log = resolveLogger(opts.logger);

    const reads = opts.files.map(async (file) => {
        const fullPath = opts.basePath ? nodeJoin(opts.basePath, file) : file;
        try {
            const content = await readFile(fullPath, {encoding});
            return {file, content} as const;
        } catch (err: any) {
            log?.("verbose", `failed to read file: ${fullPath}`);
            return {
                file,
                error: `failed to read '${fullPath}': ${err?.code ?? (err instanceof Error ? err.message : String(err))}`,
            } as const;
        }
    });

    const results = await Promise.all(reads);

    for (const result of results) {
        if ("content" in result) {
            fileContents.set(result.file, result.content);
        } else {
            fileErrors.push({
                key: result.file,
                source: result.file,
                message: result.error,
            });
        }
    }

    return resolveEnv(opts, config, fileContents, fileErrors);
}
