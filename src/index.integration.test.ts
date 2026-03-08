import nodePath from "node:path";
import {describe, it, expect} from "vitest";
import {
    loadEnv,
    unwrap,
    toString,
    toInt,
    toFloat,
    toBool,
    toJSON,
    toStringArray,
    toIntArray,
    withDefault,
    withRequired,
} from "./index.js";

const fixtures = nodePath.join(import.meta.dirname, "fixtures");
const fixture = (name: string) => nodePath.join(fixtures, name);

describe("integration: real .env files", () => {
    describe("basic parsing", () => {
        it("reads and parses a simple .env file", () => {
            const result = loadEnv(
                {path: fixture(".env.basic"), transformKeys: false},
                {HOST: toString, PORT: toInt, DEBUG: toBool, APP_NAME: toString}
            );
            expect(result).toEqual({
                ok: true,
                data: {HOST: "localhost", PORT: 3000, DEBUG: true, APP_NAME: "my-app"},
            });
        });

        it("reads with transformKeys: true", () => {
            const result = loadEnv(
                {path: fixture(".env.basic"), transformKeys: true},
                {APP_NAME: toString, PORT: toInt}
            );
            expect(result).toEqual({
                ok: true,
                data: {appName: "my-app", port: 3000},
            });
        });

        it("works with path as array", () => {
            const result = loadEnv(
                {path: [fixtures, ".env.basic"], transformKeys: false},
                {HOST: toString}
            );
            expect(result).toEqual({ok: true, data: {HOST: "localhost"}});
        });
    });

    describe("quote handling", () => {
        it("strips double quotes from real file", () => {
            const result = loadEnv(
                {path: fixture(".env.quotes"), transformKeys: false},
                {DOUBLE: toString}
            );
            expect(result).toEqual({ok: true, data: {DOUBLE: "hello world"}});
        });

        it("strips single quotes from real file", () => {
            const result = loadEnv(
                {path: fixture(".env.quotes"), transformKeys: false},
                {SINGLE: toString}
            );
            expect(result).toEqual({ok: true, data: {SINGLE: "hello world"}});
        });

        it("strips backticks from real file", () => {
            const result = loadEnv(
                {path: fixture(".env.quotes"), transformKeys: false},
                {BACKTICK: toString}
            );
            expect(result).toEqual({ok: true, data: {BACKTICK: "hello world"}});
        });

        it("keeps mismatched quotes from real file", () => {
            const result = loadEnv(
                {path: fixture(".env.quotes"), transformKeys: false},
                {MISMATCH: toString}
            );
            expect(result).toEqual({ok: true, data: {MISMATCH: "\"hello world'"}});
        });
    });

    describe("complex values", () => {
        it("handles values with equals signs", () => {
            const result = loadEnv(
                {path: fixture(".env.complex"), transformKeys: false},
                {DATABASE_URL: toString}
            );
            expect(result).toEqual({
                ok: true,
                data: {DATABASE_URL: "postgres://user:pass@localhost:5432/mydb?sslmode=require"},
            });
        });

        it("parses JSON values from file", () => {
            const result = loadEnv(
                {path: fixture(".env.complex"), transformKeys: false},
                {JSON_CONFIG: toJSON<{host: string; port: number; ssl: boolean}>()}
            );
            expect(result).toEqual({
                ok: true,
                data: {JSON_CONFIG: {host: "localhost", port: 5432, ssl: true}},
            });
        });

        it("parses string arrays from file", () => {
            const result = loadEnv(
                {path: fixture(".env.complex"), transformKeys: false},
                {TAGS: toStringArray()}
            );
            expect(result).toEqual({
                ok: true,
                data: {TAGS: ["foo", "bar", "baz"]},
            });
        });

        it("parses int arrays from file", () => {
            const result = loadEnv(
                {path: fixture(".env.complex"), transformKeys: false},
                {NUMBERS: toIntArray()}
            );
            expect(result).toEqual({
                ok: true,
                data: {NUMBERS: [1, 2, 3, 4, 5]},
            });
        });

        it("expands \\n in double-quoted values from file", () => {
            const result = loadEnv(
                {path: fixture(".env.complex"), transformKeys: false},
                {MULTILINE: toString}
            );
            expect(result).toEqual({
                ok: true,
                data: {MULTILINE: "line1\nline2\nline3"},
            });
        });

        it("does NOT expand \\n in single-quoted values from file", () => {
            const result = loadEnv(
                {path: fixture(".env.complex"), transformKeys: false},
                {SINGLE_NO_EXPAND: toString}
            );
            expect(result).toEqual({
                ok: true,
                data: {SINGLE_NO_EXPAND: "keep\\nraw"},
            });
        });
    });

    describe("messy file handling", () => {
        it("skips empty lines, invalid lines, and trims whitespace", () => {
            const result = loadEnv(
                {path: fixture(".env.messy"), transformKeys: false},
                {SPACED: toString, ANOTHER: toString}
            );
            expect(result).toEqual({
                ok: true,
                data: {SPACED: "hello", ANOTHER: "value"},
            });
        });

        it("handles empty values", () => {
            const result = loadEnv(
                {path: fixture(".env.messy"), transformKeys: false},
                {EMPTY_VAL: toString}
            );
            expect(result).toEqual({ok: true, data: {EMPTY_VAL: ""}});
        });

        it("handles values containing extra equals signs", () => {
            const result = loadEnv(
                {path: fixture(".env.messy"), transformKeys: false},
                {EXTRA_EQUALS: toString}
            );
            expect(result).toEqual({ok: true, data: {EXTRA_EQUALS: "a=b=c"}});
        });

        it("ignores keys not in config", () => {
            const result = loadEnv(
                {path: fixture(".env.messy"), transformKeys: false},
                {ANOTHER: toString}
            );
            expect(result).toEqual({ok: true, data: {ANOTHER: "value"}});
        });
    });

    describe("withRequired / withDefault on real files", () => {
        it("withRequired succeeds when key exists in file", () => {
            const result = loadEnv(
                {path: fixture(".env.missing"), transformKeys: false},
                {PRESENT: withRequired(toString)}
            );
            expect(result).toEqual({ok: true, data: {PRESENT: "here"}});
        });

        it("withRequired fails when key is missing from file", () => {
            const result = loadEnv(
                {path: fixture(".env.missing"), transformKeys: false},
                {ABSENT: withRequired(toString)}
            );
            expect(result).toEqual({
                ok: false,
                ctx: ["ABSENT: is required but is missing"],
            });
        });

        it("withDefault returns default when key is missing from file", () => {
            const result = loadEnv(
                {path: fixture(".env.missing"), transformKeys: false},
                {ABSENT: withDefault(toInt, 9999)}
            );
            expect(result).toEqual({ok: true, data: {ABSENT: 9999}});
        });

        it("withDefault uses file value when key exists", () => {
            const result = loadEnv(
                {path: fixture(".env.basic"), transformKeys: false},
                {PORT: withDefault(toInt, 9999)}
            );
            expect(result).toEqual({ok: true, data: {PORT: 3000}});
        });
    });

    describe("error cases on real files", () => {
        it("returns failure for nonexistent file", () => {
            const result = loadEnv(
                {path: fixture(".env.does-not-exist"), transformKeys: false},
                {FOO: toString}
            );
            expect(result.ok).toBe(false);
        });

        it("accumulates errors from real file", () => {
            const result = loadEnv(
                {path: fixture(".env.basic"), transformKeys: false},
                {HOST: toInt, PORT: toInt}
            );
            // HOST is "localhost" which can't be parsed as int
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.ctx).toEqual(["HOST: failed to convert 'localhost' to a number"]);
            }
        });
    });

    describe("comments", () => {
        it("skips lines starting with #", () => {
            const result = loadEnv(
                {path: fixture(".env.comments"), transformKeys: false},
                {HOST: toString, PORT: toInt, DEBUG: toBool}
            );
            expect(result).toEqual({
                ok: true,
                data: {HOST: "localhost", PORT: 3000, DEBUG: true},
            });
        });

        it("does not parse commented-out keys", () => {
            const result = loadEnv(
                {path: fixture(".env.comments"), transformKeys: false},
                {KEY: withRequired(toString)}
            );
            expect(result).toEqual({
                ok: false,
                ctx: ["KEY: is required but is missing"],
            });
        });

        it("skips indented comments", () => {
            const result = loadEnv(
                {path: fixture(".env.comments"), transformKeys: false},
                {HOST: toString, DEBUG: toBool}
            );
            expect(result).toEqual({
                ok: true,
                data: {HOST: "localhost", DEBUG: true},
            });
        });
    });

    describe("export stripping", () => {
        it("strips export prefix from lines", () => {
            const result = loadEnv(
                {path: fixture(".env.export"), transformKeys: false},
                {HOST: toString, PORT: toInt, API_KEY: toString}
            );
            expect(result).toEqual({
                ok: true,
                data: {HOST: "localhost", PORT: 3000, API_KEY: "secret123"},
            });
        });

        it("mixes export and non-export lines", () => {
            const result = loadEnv(
                {path: fixture(".env.export"), transformKeys: false},
                {HOST: toString, DEBUG: toBool}
            );
            expect(result).toEqual({
                ok: true,
                data: {HOST: "localhost", DEBUG: true},
            });
        });

        it("works with transformKeys and export prefix", () => {
            const result = loadEnv(
                {path: fixture(".env.export"), transformKeys: true},
                {API_KEY: withRequired(toString), PORT: toInt}
            );
            expect(result).toEqual({
                ok: true,
                data: {apiKey: "secret123", port: 3000},
            });
        });
    });

    describe("strict toBool", () => {
        it("accepts true, TRUE, True as true", () => {
            const result = loadEnv(
                {path: fixture(".env.bool"), transformKeys: false},
                {A: toBool, B: toBool, C: toBool}
            );
            expect(result).toEqual({
                ok: true,
                data: {A: true, B: true, C: true},
            });
        });

        it("accepts false, FALSE, False as false", () => {
            const result = loadEnv(
                {path: fixture(".env.bool"), transformKeys: false},
                {D: toBool, E: toBool, F: toBool}
            );
            expect(result).toEqual({
                ok: true,
                data: {D: false, E: false, F: false},
            });
        });

        it("accepts 1 as true and 0 as false", () => {
            const result = loadEnv(
                {path: fixture(".env.bool"), transformKeys: false},
                {G: toBool, H: toBool}
            );
            expect(result).toEqual({
                ok: true,
                data: {G: true, H: false},
            });
        });

        it("rejects invalid boolean values", () => {
            const result = loadEnv(
                {path: fixture(".env.bool"), transformKeys: false},
                {I: toBool}
            );
            expect(result).toEqual({
                ok: false,
                ctx: ["I: expected boolean, got 'nope'"],
            });
        });
    });

    describe("full end-to-end with transformKeys", () => {
        it("loads complex file with transformKeys and mixed transforms", () => {
            const result = loadEnv(
                {path: fixture(".env.complex"), transformKeys: true},
                {
                    DATABASE_URL: withRequired(toString),
                    API_KEY: withRequired(toString),
                    JSON_CONFIG: toJSON<{host: string; port: number; ssl: boolean}>(),
                    TAGS: toStringArray(),
                    NUMBERS: toIntArray(),
                    MULTILINE: toString,
                    SINGLE_NO_EXPAND: toString,
                }
            );

            expect(result).toEqual({
                ok: true,
                data: {
                    databaseUrl: "postgres://user:pass@localhost:5432/mydb?sslmode=require",
                    apiKey: "sk-abc123def456",
                    jsonConfig: {host: "localhost", port: 5432, ssl: true},
                    tags: ["foo", "bar", "baz"],
                    numbers: [1, 2, 3, 4, 5],
                    multiline: "line1\nline2\nline3",
                    singleNoExpand: "keep\\nraw",
                },
            });
        });
    });
});
