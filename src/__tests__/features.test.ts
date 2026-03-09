import {join} from "node:path";

import {describe, it, expect, afterAll} from "vitest";
import {
    loadEnv,
    unwrap,
    toString,
    toInt,
    toBool,
    toJSON,
    toStringArray,
    toIntArray,
    withDefault,
    withRequired,
    success,
    failure,
    type SchemaParser,
    type TransformContext,
} from "../index.js";

const fixtures = join(import.meta.dirname, "fixtures");
const opts = (files: string[], extra: Partial<Parameters<typeof loadEnv>[0]> = {}) =>
    ({files, transformKeys: false, basePath: fixtures, ...extra}) as const;

// ─── features ───────────────────────────────────────────────────────────────

describe("features", () => {
    describe("transformKeys", () => {
        it("converts UPPER_SNAKE_CASE to camelCase", () => {
            const result = loadEnv(
                {files: [".env.basic"], transformKeys: true, basePath: fixtures},
                {HOST: toString, PORT: toInt, APP_NAME: toString}
            );
            expect(result).toEqual({
                ok: true,
                data: {host: "localhost", port: 3000, appName: "my-app"},
            });
        });

        it("leaves mixed-case keys untouched", () => {
            const result = loadEnv(
                {files: [".env.transformkeys"], transformKeys: true, basePath: fixtures},
                {FOO_BAR: toString, helloThere: toString, blah: toString}
            );
            expect(result).toEqual({
                ok: true,
                data: {fooBar: "1", helloThere: "2", blah: "3"},
            });
        });

        it("does not transform keys when transformKeys is false", () => {
            const result = loadEnv(opts([".env.basic"]), {APP_NAME: toString});
            expect(result).toEqual({ok: true, data: {APP_NAME: "my-app"}});
        });

        it("works with export prefix", () => {
            const result = loadEnv(
                {files: [".env.export"], transformKeys: true, basePath: fixtures},
                {API_KEY: withRequired(toString), PORT: toInt}
            );
            expect(result).toEqual({ok: true, data: {apiKey: "secret123", port: 3000}});
        });
    });

    describe("layered files", () => {
        it("loads multiple files and merges (last-wins)", () => {
            const result = loadEnv(
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

        it("base values used when not overridden", () => {
            const result = loadEnv(
                {
                    files: [".env.layered.base", ".env.layered.local"],
                    transformKeys: false,
                    basePath: fixtures,
                },
                {HOST: toString}
            );
            expect(result).toEqual({ok: true, data: {HOST: "localhost"}});
        });
    });

    describe("duplicate keys", () => {
        it("last value wins", () => {
            const result = loadEnv(opts([".env.duplicate"]), {
                KEY: toString,
                OTHER: toString,
            });
            expect(result).toEqual({ok: true, data: {KEY: "second", OTHER: "only"}});
        });
    });

    describe("variable expansion", () => {
        it("expands ${VAR} references", () => {
            const result = loadEnv(opts([".env.expansion"]), {
                HOST: toString,
                PORT: toString,
                URL: toString,
            });
            expect(result).toEqual({
                ok: true,
                data: {HOST: "localhost", PORT: "3000", URL: "http://localhost:3000"},
            });
        });

        it("expands $VAR references (bare)", () => {
            const result = loadEnv(opts([".env.expansion"]), {
                HOST: toString,
                PORT: toString,
                URL: toString,
            });
            if (result.ok) {
                // URL uses both ${HOST} and $PORT
                expect(result.data.URL).toBe("http://localhost:3000");
            }
        });

        it("does NOT expand variables in single-quoted values", () => {
            const result = loadEnv(opts([".env.expansion"]), {
                HOST: toString,
                PORT: toString,
                SINGLE_QUOTED: toString,
            });
            if (result.ok) {
                expect(result.data.SINGLE_QUOTED).toBe("$HOST:${PORT}");
            }
        });

        it("leaves unresolved references unchanged (not empty string)", () => {
            // ensure CLENV_UNDEFINED_VAR is not in process.env
            delete process.env.CLENV_UNDEFINED_VAR;
            const result = loadEnv(opts([".env.expansion"]), {MISSING_REF: toString});
            expect(result).toEqual({ok: true, data: {MISSING_REF: "$CLENV_UNDEFINED_VAR"}});
        });

        it("supports chained expansion", () => {
            const result = loadEnv(opts([".env.expansion"]), {
                HOST: toString,
                PORT: toString,
                URL: toString,
                CHAINED: toString,
            });
            if (result.ok) {
                expect(result.data.CHAINED).toBe("http://localhost:3000/api");
            }
        });

        it("cyclic references resolve to unresolved tokens (no infinite loop)", () => {
            // A=$B is processed first — B hasn't been expanded yet, so $B is unresolved
            // B=$A is processed second — A is "$B" (literal), so B becomes "$B"
            delete process.env.A;
            delete process.env.B;
            const result = loadEnv(opts([".env.cyclic"]), {A: toString, B: toString});
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.A).toBe("$B");
                expect(result.data.B).toBe("$B");
            }
        });
    });

    describe("process.env merge", () => {
        const ENV_KEY = "CLENV_TEST_MERGE_KEY";

        afterAll(() => {
            delete process.env[ENV_KEY];
        });

        it("includeProcessEnv: true uses process.env as fallback for missing keys", () => {
            process.env[ENV_KEY] = "from-process";
            const result = loadEnv(
                {
                    files: [".env.missing"],
                    transformKeys: false,
                    basePath: fixtures,
                    includeProcessEnv: true,
                },
                {PRESENT: toString, [ENV_KEY]: toString}
            );
            expect(result).toEqual({
                ok: true,
                data: {PRESENT: "here", [ENV_KEY]: "from-process"},
            });
        });

        it("includeProcessEnv: true does not overwrite file values", () => {
            process.env.PRESENT = "from-process";
            const result = loadEnv(
                {
                    files: [".env.missing"],
                    transformKeys: false,
                    basePath: fixtures,
                    includeProcessEnv: true,
                },
                {PRESENT: toString}
            );
            expect(result).toEqual({ok: true, data: {PRESENT: "here"}});
            delete process.env.PRESENT;
        });

        it("includeProcessEnv: 'overwrite' lets process.env win", () => {
            process.env.PRESENT = "overwritten";
            const result = loadEnv(
                {
                    files: [".env.missing"],
                    transformKeys: false,
                    basePath: fixtures,
                    includeProcessEnv: "overwrite",
                },
                {PRESENT: toString}
            );
            expect(result).toEqual({ok: true, data: {PRESENT: "overwritten"}});
            delete process.env.PRESENT;
        });

        it("no merge when includeProcessEnv is false/undefined", () => {
            process.env[ENV_KEY] = "should-not-appear";
            const result = loadEnv(opts([".env.missing"]), {
                PRESENT: toString,
                [ENV_KEY]: withDefault(toString, "default"),
            });
            expect(result).toEqual({
                ok: true,
                data: {PRESENT: "here", [ENV_KEY]: "default"},
            });
        });
    });

    describe("schemaParser", () => {
        it("validates JSON with schema parser from opts", () => {
            type DbConfig = {host: string; port: number; ssl: boolean};
            const schema = {type: "DbConfig"};
            const parser: SchemaParser = (obj, s) => {
                if (s === schema && typeof obj === "object" && obj !== null) return success(obj);
                return failure("validation failed");
            };

            const result = loadEnv(
                {
                    files: [".env.complex"],
                    transformKeys: false,
                    basePath: fixtures,
                    schemaParser: parser,
                },
                {JSON_CONFIG: toJSON<DbConfig>(schema)}
            );
            expect(result).toEqual({
                ok: true,
                data: {JSON_CONFIG: {host: "localhost", port: 5432, ssl: true}},
            });
        });

        it("returns failure when schema parser rejects", () => {
            const parser: SchemaParser = () => failure("invalid shape");
            const result = loadEnv(
                {
                    files: [".env.complex"],
                    transformKeys: false,
                    basePath: fixtures,
                    schemaParser: parser,
                },
                {JSON_CONFIG: toJSON({})}
            );
            expect(result.ok).toBe(false);
        });

        it("no parser with schema fails", () => {
            const result = loadEnv(opts([".env.complex"]), {JSON_CONFIG: toJSON({})});
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.ctx[0]).toContain("schema provided but no schemaParser is set");
            }
        });

        it("no schema does not call parser", () => {
            let called = false;
            const parser: SchemaParser = () => {
                called = true;
                return success({});
            };
            loadEnv(
                {
                    files: [".env.complex"],
                    transformKeys: false,
                    basePath: fixtures,
                    schemaParser: parser,
                },
                {JSON_CONFIG: toJSON<{host: string; port: number; ssl: boolean}>()}
            );
            expect(called).toBe(false);
        });
    });

    describe("radix", () => {
        it("uses radix function for parseInt", () => {
            const result = loadEnv(
                {
                    files: [".env.radix"],
                    transformKeys: false,
                    basePath: fixtures,
                    radix: (key) => (key === "HEX_PORT" ? 16 : undefined),
                },
                {HEX_PORT: toInt, DEC_PORT: toInt}
            );
            expect(result).toEqual({ok: true, data: {HEX_PORT: 26, DEC_PORT: 3000}});
        });
    });

    describe("basePath", () => {
        it("joins basePath with file names", () => {
            const result = loadEnv(
                {files: [".env.basic"], transformKeys: false, basePath: fixtures},
                {HOST: toString}
            );
            expect(result).toEqual({ok: true, data: {HOST: "localhost"}});
        });

        it("works without basePath (absolute file paths)", () => {
            const fixture = (...names: string[]) => join(fixtures, ...names);
            const result = loadEnv(
                {files: [fixture(".env.basic")], transformKeys: false},
                {HOST: toString}
            );
            expect(result).toEqual({ok: true, data: {HOST: "localhost"}});
        });
    });

    describe("source tracking", () => {
        it("ctx.source reflects file name for file entries", () => {
            let capturedSource: string | undefined;
            const spy = (key: string, val: string | undefined, ctx: TransformContext) => {
                capturedSource = ctx.source;
                return toString(key, val, ctx);
            };

            loadEnv(opts([".env.basic"]), {HOST: spy});
            expect(capturedSource).toBe(".env.basic");
        });

        it("ctx.source is 'process.env' when value comes from process.env merge", () => {
            const envKey = "CLENV_SOURCE_TEST";
            process.env[envKey] = "from-process";
            let capturedSource: string | undefined;
            const spy = (key: string, val: string | undefined, ctx: TransformContext) => {
                capturedSource = ctx.source;
                return toString(key, val, ctx);
            };

            loadEnv(
                {
                    files: [".env.missing"],
                    transformKeys: false,
                    basePath: fixtures,
                    includeProcessEnv: true,
                },
                {PRESENT: toString, [envKey]: spy}
            );
            expect(capturedSource).toBe("process.env");
            delete process.env[envKey];
        });

        it("ctx.source is 'none' for unseen keys", () => {
            let capturedSource: string | undefined;
            const spy = (key: string, val: string | undefined, ctx: TransformContext) => {
                capturedSource = ctx.source;
                return success("default");
            };

            loadEnv(opts([".env.missing"]), {ABSENT: spy});
            expect(capturedSource).toBe("none");
        });

        it("ctx.line reflects line number from file", () => {
            let capturedLine: number | undefined;
            const spy = (key: string, val: string | undefined, ctx: TransformContext) => {
                capturedLine = ctx.line;
                return toString(key, val, ctx);
            };

            // PORT is on line 2 of .env.basic
            loadEnv(opts([".env.basic"]), {PORT: spy});
            expect(capturedLine).toBe(2);
        });

        it("ctx.source reflects overwriting file in layered setup", () => {
            let capturedSource: string | undefined;
            const spy = (key: string, val: string | undefined, ctx: TransformContext) => {
                capturedSource = ctx.source;
                return toString(key, val, ctx);
            };

            // PORT is in both files, .env.layered.local wins
            loadEnv(
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
});
