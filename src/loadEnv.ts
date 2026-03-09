import {join as nodeJoin} from "node:path";
import {readFileSync} from "node:fs";
import type {EnvError} from "./result.js";
import type {Config} from "./types.js";
import {type LoadEnvOpts, type ResolveEnvResult, resolveEnv, resolveLogger} from "./core.js";

export function loadEnv<const TOpts extends LoadEnvOpts, TConfig extends Config>(
    opts: TOpts,
    config: TConfig
): ResolveEnvResult<TOpts, TConfig> {
    const encoding = opts.encoding ?? "utf8";
    const fileContents = new Map<string, string>();
    const fileErrors: EnvError[] = [];
    const log = resolveLogger(opts.logger);

    for (const file of opts.files) {
        const fullPath = opts.basePath ? nodeJoin(opts.basePath, file) : file;
        try {
            const content = readFileSync(fullPath, {encoding});
            fileContents.set(file, content);
        } catch (err: any) {
            log?.("verbose", `failed to read file: ${fullPath}`);
            fileErrors.push({
                key: file,
                source: file,
                message: `failed to read '${fullPath}': ${err?.code ?? (err instanceof Error ? err.message : String(err))}`,
            });
        }
    }

    return resolveEnv(opts, config, fileContents, fileErrors);
}
