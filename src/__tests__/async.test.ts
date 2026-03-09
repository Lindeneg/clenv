import {join} from "node:path";
import {describe, it, expect, afterAll} from "vitest";
import {Expect, Equal} from "type-testing";
import {
    loadEnvAsync,
    unwrap,
    toString,
    toInt,
    toBool,
    toEnum,
    toStringArray,
    toIntArray,
    withDefault,
    withRequired,
    withOptional,
    type TransformContext,
} from "../index.js";

const fixtures = join(import.meta.dirname, "fixtures");
const opts = (files: string[], extra: Partial<Parameters<typeof loadEnvAsync>[0]> = {}) =>
    ({files, transformKeys: false, basePath: fixtures, ...extra}) as const;

// ─── async basic behavior ────────────────────────────────────────────────────

describe("loadEnvAsync", () => {
    describe("basic loading", () => {
        it("loads a single file", async () => {
            const result = await loadEnvAsync(opts([".env.basic"]), {
                HOST: toString,
                PORT: toInt,
                DEBUG: toBool,
                APP_NAME: toString,
            });
            expect(result).toEqual({
                ok: true,
                data: {HOST: "localhost", PORT: 3000, DEBUG: true, APP_NAME: "my-app"},
            });
        });

        it("loads multiple files with last-wins", async () => {
            const result = await loadEnvAsync(
                {
                    files: [".env.layered.base", ".env.layered.local"],
                    transformKeys: false,
                    basePath: fixtures,
                },
                {HOST: toString, PORT: toInt, DEBUG: toBool, SECRET: toString}
            );
            expect(result).toEqual({
                ok: true,
                data: {HOST: "localhost", PORT: 8080, DEBUG: true, SECRET: "mysecret"},
            });
        });

        it("transforms keys to camelCase", async () => {
            const result = await loadEnvAsync(
                {files: [".env.basic"], transformKeys: true, basePath: fixtures},
                {HOST: toString, PORT: toInt, APP_NAME: toString}
            );
            expect(result).toEqual({
                ok: true,
                data: {host: "localhost", port: 3000, appName: "my-app"},
            });
        });
    });

    // ─── error handling ──────────────────────────────────────────────────────

    describe("error handling", () => {
        it("returns failure for nonexistent file", async () => {
            const result = await loadEnvAsync(
                {files: ["does-not-exist.env"], transformKeys: false, basePath: fixtures},
                {FOO: toString}
            );
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.ctx[0]!.message).toContain("failed to read");
            }
        });

        it("includes source and line in transform errors", async () => {
            const result = await loadEnvAsync(opts([".env.basic"]), {HOST: toInt});
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.ctx[0]).toMatchObject({
                    key: "HOST",
                    source: ".env.basic",
                    line: 1,
                });
                expect(result.ctx[0]!.message).toContain(
                    "failed to convert 'localhost' to a number"
                );
            }
        });

        it("accumulates multiple errors", async () => {
            const result = await loadEnvAsync(opts([".env.basic"]), {
                HOST: toInt,
                MISSING: withRequired(toString),
                PORT: toInt,
            });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.ctx.length).toBe(2);
                expect(result.ctx[0]!.key).toBe("HOST");
                expect(result.ctx[1]!.key).toBe("MISSING");
            }
        });

        it("unwrap throws with formatted error", async () => {
            const result = await loadEnvAsync(opts([".env.basic"]), {HOST: toInt});
            expect(() => unwrap(result)).toThrow(
                ".env.basic:L1: HOST: failed to convert 'localhost' to a number"
            );
        });
    });

    // ─── variable expansion ──────────────────────────────────────────────────

    describe("variable expansion", () => {
        it("expands ${VAR} and $VAR references", async () => {
            const result = await loadEnvAsync(opts([".env.expansion"]), {
                HOST: toString,
                PORT: toString,
                URL: toString,
            });
            expect(result).toEqual({
                ok: true,
                data: {HOST: "localhost", PORT: "3000", URL: "http://localhost:3000"},
            });
        });

        it("does NOT expand variables in single-quoted values", async () => {
            const result = await loadEnvAsync(opts([".env.expansion"]), {
                HOST: toString,
                PORT: toString,
                SINGLE_QUOTED: toString,
            });
            if (result.ok) {
                expect(result.data.SINGLE_QUOTED).toBe("$HOST:${PORT}");
            }
        });
    });

    // ─── process.env merge ───────────────────────────────────────────────────

    describe("process.env merge", () => {
        const ENV_KEY = "CLENV_ASYNC_TEST_MERGE_KEY";

        afterAll(() => {
            delete process.env[ENV_KEY];
        });

        it("fallback mode fills missing keys from process.env", async () => {
            process.env[ENV_KEY] = "from-process";
            const result = await loadEnvAsync(
                {
                    files: [".env.missing"],
                    transformKeys: false,
                    basePath: fixtures,
                    includeProcessEnv: "fallback",
                },
                {PRESENT: toString, [ENV_KEY]: toString}
            );
            expect(result).toEqual({
                ok: true,
                data: {PRESENT: "here", [ENV_KEY]: "from-process"},
            });
        });

        it("override mode lets process.env win", async () => {
            process.env.PRESENT = "overwritten";
            const result = await loadEnvAsync(
                {
                    files: [".env.missing"],
                    transformKeys: false,
                    basePath: fixtures,
                    includeProcessEnv: "override",
                },
                {PRESENT: toString}
            );
            expect(result).toEqual({ok: true, data: {PRESENT: "overwritten"}});
            delete process.env.PRESENT;
        });
    });

    // ─── source tracking ─────────────────────────────────────────────────────

    describe("source tracking", () => {
        it("ctx.source reflects file name", async () => {
            let capturedSource: string | undefined;
            const spy = (key: string, val: string | undefined, ctx: TransformContext) => {
                capturedSource = ctx.source;
                return toString(key, val, ctx);
            };

            await loadEnvAsync(opts([".env.basic"]), {HOST: spy});
            expect(capturedSource).toBe(".env.basic");
        });

        it("ctx.source reflects overwriting file in layered setup", async () => {
            let capturedSource: string | undefined;
            const spy = (key: string, val: string | undefined, ctx: TransformContext) => {
                capturedSource = ctx.source;
                return toString(key, val, ctx);
            };

            await loadEnvAsync(
                {
                    files: [".env.layered.base", ".env.layered.local"],
                    transformKeys: false,
                    basePath: fixtures,
                },
                {PORT: spy}
            );
            expect(capturedSource).toBe(".env.layered.local");
        });
    });

    // ─── type inference ──────────────────────────────────────────────────────

    describe("type inference", () => {
        it("infers correct types with transformKeys: false", async () => {
            const result = unwrap(
                await loadEnvAsync(opts([".env.basic"]), {
                    HOST: toString,
                    PORT: toInt,
                    DEBUG: toBool,
                })
            );

            type assertion = Expect<
                Equal<typeof result, {HOST: string; PORT: number; DEBUG: boolean}>
            >;

            expect(result.HOST).toBe("localhost");
            expect(result.PORT).toBe(3000);
            expect(result.DEBUG).toBe(true);
        });

        it("infers camelCase keys with transformKeys: true", async () => {
            const result = unwrap(
                await loadEnvAsync(
                    {files: [".env.basic"], transformKeys: true, basePath: fixtures},
                    {HOST: toString, PORT: toInt, APP_NAME: toString}
                )
            );

            type assertion = Expect<
                Equal<typeof result, {host: string; port: number; appName: string}>
            >;

            expect(result.host).toBe("localhost");
            expect(result.port).toBe(3000);
            expect(result.appName).toBe("my-app");
        });

        it("infers withDefault, withOptional, and toEnum", async () => {
            const result = unwrap(
                await loadEnvAsync(opts([".env.missing"]), {
                    PRESENT: withRequired(toString),
                    ABSENT_DEFAULT: withDefault(toInt, 42),
                    ABSENT_OPTIONAL: withOptional(toBool),
                })
            );

            type assertion = Expect<
                Equal<
                    typeof result,
                    {
                        PRESENT: string;
                        ABSENT_DEFAULT: number;
                        ABSENT_OPTIONAL: boolean | undefined;
                    }
                >
            >;

            expect(result.PRESENT).toBe("here");
            expect(result.ABSENT_DEFAULT).toBe(42);
            expect(result.ABSENT_OPTIONAL).toBeUndefined();
        });

        it("infers toEnum union type", async () => {
            const result = unwrap(
                await loadEnvAsync(opts([".env.custom"]), {
                    LOG_LEVEL: toEnum("debug", "info", "warn", "error"),
                })
            );

            type assertion = Expect<
                Equal<typeof result, {LOG_LEVEL: "debug" | "info" | "warn" | "error"}>
            >;

            expect(result.LOG_LEVEL).toBe("debug");
        });

        it("infers array transforms", async () => {
            const result = unwrap(
                await loadEnvAsync(opts([".env.complex"]), {
                    TAGS: toStringArray(),
                    NUMBERS: toIntArray(),
                })
            );

            type assertion = Expect<Equal<typeof result, {TAGS: string[]; NUMBERS: number[]}>>;

            expect(result.TAGS).toEqual(["foo", "bar", "baz"]);
            expect(result.NUMBERS).toEqual([1, 2, 3, 4, 5]);
        });
    });
});
