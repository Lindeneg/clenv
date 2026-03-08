import {writeFileSync, mkdirSync, rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";

import {describe, it, expect, afterAll, beforeAll, vi} from "vitest";
import {Expect, Equal} from "type-testing";
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
    success,
    failure,
    type Logger,
    type LogLevel,
    type SchemaParser,
    type Result,
} from "./index.js";

const fixtures = join(import.meta.dirname, "fixtures");
const fixture = (...names: string[]) => join(fixtures, ...names);
const opts = (files: string[], extra: Partial<Parameters<typeof loadEnv>[0]> = {}) =>
    ({files, transformKeys: false, basePath: fixtures, ...extra}) as const;

// minimal ctx for direct transform unit tests
const ctx = {rawEnv: {}};

describe("transforms", () => {
    describe("toString", () => {
        it("returns value as-is", () => {
            expect(toString("K", "hello")).toEqual({ok: true, data: "hello"});
        });

        it("returns empty string for empty value", () => {
            expect(toString("K", "")).toEqual({ok: true, data: ""});
        });
    });

    describe("toBool", () => {
        it.each([
            ["true", true],
            ["TRUE", true],
            ["True", true],
            ["1", true],
            ["false", false],
            ["FALSE", false],
            ["False", false],
            ["0", false],
        ] as const)("parses '%s' as %s", (input, expected) => {
            expect(toBool("K", input)).toEqual({ok: true, data: expected});
        });

        it.each(["yes", "no", "on", "off", "2", ""])("rejects '%s'", (input) => {
            const result = toBool("K", input);
            expect(result.ok).toBe(false);
        });

        it("includes key and value in error message", () => {
            expect(toBool("DEBUG", "nope")).toEqual({
                ok: false,
                ctx: "DEBUG: expected boolean, got 'nope'",
            });
        });
    });

    describe("toInt", () => {
        it("parses valid integer", () => {
            expect(toInt("K", "42", ctx)).toEqual({ok: true, data: 42});
        });

        it("parses negative integer", () => {
            expect(toInt("K", "-7", ctx)).toEqual({ok: true, data: -7});
        });

        it("fails on non-numeric", () => {
            expect(toInt("PORT", "abc", ctx)).toEqual({
                ok: false,
                ctx: "PORT: failed to convert 'abc' to a number",
            });
        });

        it("fails on empty string", () => {
            expect(toInt("K", "", ctx)).toEqual({
                ok: false,
                ctx: "K: failed to convert '' to a number",
            });
        });

        it("respects radix from context", () => {
            const hexCtx = {rawEnv: {}, radix: () => 16};
            expect(toInt("K", "ff", hexCtx)).toEqual({ok: true, data: 255});
        });

        it("radix can be per-key", () => {
            const mixedCtx = {
                rawEnv: {},
                radix: (key: string) => (key === "HEX" ? 16 : undefined),
            };
            expect(toInt("HEX", "a", mixedCtx)).toEqual({ok: true, data: 10});
            expect(toInt("DEC", "10", mixedCtx)).toEqual({ok: true, data: 10});
        });
    });

    describe("toFloat", () => {
        it("parses valid float", () => {
            expect(toFloat("K", "3.14", ctx)).toEqual({ok: true, data: 3.14});
        });

        it("parses negative float", () => {
            expect(toFloat("K", "-0.5", ctx)).toEqual({ok: true, data: -0.5});
        });

        it("parses integer as float", () => {
            expect(toFloat("K", "42", ctx)).toEqual({ok: true, data: 42});
        });

        it("fails on non-numeric", () => {
            expect(toFloat("RATE", "abc", ctx)).toEqual({
                ok: false,
                ctx: "RATE: failed to convert 'abc' to a number",
            });
        });
    });

    describe("toStringArray", () => {
        it("splits by comma by default", () => {
            expect(toStringArray()("K", "a,b,c")).toEqual({ok: true, data: ["a", "b", "c"]});
        });

        it("trims whitespace from elements", () => {
            expect(toStringArray()("K", "a , b , c")).toEqual({ok: true, data: ["a", "b", "c"]});
        });

        it("supports custom delimiter", () => {
            expect(toStringArray("|")("K", "x|y|z")).toEqual({ok: true, data: ["x", "y", "z"]});
        });

        it("returns single-element array for no delimiter match", () => {
            expect(toStringArray()("K", "single")).toEqual({ok: true, data: ["single"]});
        });
    });

    describe("toIntArray", () => {
        it("splits and parses integers", () => {
            expect(toIntArray()("K", "1,2,3", ctx)).toEqual({ok: true, data: [1, 2, 3]});
        });

        it("trims whitespace from elements", () => {
            expect(toIntArray()("K", "1 , 2 , 3", ctx)).toEqual({ok: true, data: [1, 2, 3]});
        });

        it("supports custom delimiter", () => {
            expect(toIntArray("-")("K", "3-1-4", ctx)).toEqual({ok: true, data: [3, 1, 4]});
        });

        it("fails if any element is not a number", () => {
            const result = toIntArray()("NUMS", "1,abc,3", ctx);
            expect(result.ok).toBe(false);
        });
    });

    describe("toJSON", () => {
        it("parses valid JSON", () => {
            expect(toJSON<{id: number}>()("K", '{"id":1}', ctx)).toEqual({
                ok: true,
                data: {id: 1},
            });
        });

        it("fails on invalid JSON", () => {
            expect(toJSON()("CFG", "not json", ctx)).toEqual({
                ok: false,
                ctx: "CFG: failed to convert to JSON",
            });
        });

        it("calls schemaParser when schema provided", () => {
            const schema = {type: "object"};
            const parser: SchemaParser = (obj, s, _k) => {
                if (s === schema) return success(obj);
                return failure("wrong schema");
            };
            const ctxWithParser = {rawEnv: {}, schemaParser: parser};
            expect(toJSON<{a: number}>(schema)("K", '{"a":1}', ctxWithParser)).toEqual({
                ok: true,
                data: {a: 1},
            });
        });

        it("fails when schema provided but no parser set", () => {
            expect(toJSON({})("K", '{"a":1}', ctx)).toEqual({
                ok: false,
                ctx: "K: schema provided but no schemaParser is set. Please use 'schemaParser' in options.",
            });
        });

        it("does not call parser when no schema provided", () => {
            let called = false;
            const ctxWithParser = {
                rawEnv: {},
                schemaParser: () => {
                    called = true;
                    return success({});
                },
            };
            toJSON<{a: number}>()("K", '{"a":1}', ctxWithParser);
            expect(called).toBe(false);
        });
    });
});

describe("parser", () => {
    describe("basic key=value", () => {
        it("reads and parses a simple .env file", () => {
            const result = loadEnv(opts([".env.basic"]), {
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

        it("ignores keys not present in config", () => {
            const result = loadEnv(opts([".env.basic"]), {HOST: toString});
            expect(result).toEqual({ok: true, data: {HOST: "localhost"}});
        });
    });

    describe("empty and special values", () => {
        it("handles empty values", () => {
            const result = loadEnv(opts([".env.messy"]), {EMPTY_VAL: toString});
            expect(result).toEqual({ok: true, data: {EMPTY_VAL: ""}});
        });

        it("handles values containing equals signs", () => {
            const result = loadEnv(opts([".env.messy"]), {EXTRA_EQUALS: toString});
            expect(result).toEqual({ok: true, data: {EXTRA_EQUALS: "a=b=c"}});
        });

        it("handles URLs with equals in query params", () => {
            const result = loadEnv(opts([".env.complex"]), {DATABASE_URL: toString});
            expect(result).toEqual({
                ok: true,
                data: {DATABASE_URL: "postgres://user:pass@localhost:5432/mydb?sslmode=require"},
            });
        });
    });

    describe("whitespace handling", () => {
        it("trims whitespace from keys and values", () => {
            const result = loadEnv(opts([".env.messy"]), {SPACED: toString});
            expect(result).toEqual({ok: true, data: {SPACED: "hello"}});
        });

        it("skips empty lines and lines without =", () => {
            const result = loadEnv(opts([".env.messy"]), {
                SPACED: toString,
                ANOTHER: toString,
            });
            expect(result).toEqual({
                ok: true,
                data: {SPACED: "hello", ANOTHER: "value"},
            });
        });
    });

    describe("comments", () => {
        it("skips lines starting with #", () => {
            const result = loadEnv(opts([".env.comments"]), {
                HOST: toString,
                PORT: toInt,
                DEBUG: toBool,
            });
            expect(result).toEqual({
                ok: true,
                data: {HOST: "localhost", PORT: 3000, DEBUG: true},
            });
        });

        it("skips indented comments", () => {
            const result = loadEnv(opts([".env.comments"]), {HOST: toString, DEBUG: toBool});
            expect(result).toEqual({ok: true, data: {HOST: "localhost", DEBUG: true}});
        });

        it("commented-out key is treated as missing", () => {
            const result = loadEnv(opts([".env.comments"]), {KEY: withRequired(toString)});
            expect(result).toEqual({ok: false, ctx: ["KEY: is required but is missing"]});
        });
    });

    describe("inline comments", () => {
        it("strips inline comments preceded by whitespace", () => {
            const result = loadEnv(opts([".env.inline-comments"]), {BARE: toString});
            expect(result).toEqual({ok: true, data: {BARE: "value"}});
        });

        it("does not treat # without preceding space as comment", () => {
            const result = loadEnv(opts([".env.inline-comments"]), {NO_SPACE: toString});
            expect(result).toEqual({ok: true, data: {NO_SPACE: "value#not-a-comment"}});
        });

        it("preserves # inside double quotes", () => {
            const result = loadEnv(opts([".env.inline-comments"]), {QUOTED_DOUBLE: toString});
            expect(result).toEqual({ok: true, data: {QUOTED_DOUBLE: "has # inside"}});
        });

        it("preserves # inside single quotes", () => {
            const result = loadEnv(opts([".env.inline-comments"]), {QUOTED_SINGLE: toString});
            expect(result).toEqual({ok: true, data: {QUOTED_SINGLE: "has # inside"}});
        });

        it("value starting with # is not treated as comment", () => {
            const result = loadEnv(opts([".env.inline-comments"]), {HASH_START: toString});
            expect(result).toEqual({ok: true, data: {HASH_START: "#not-a-comment"}});
        });
    });

    describe("export stripping", () => {
        it("strips export prefix from lines", () => {
            const result = loadEnv(opts([".env.export"]), {
                HOST: toString,
                PORT: toInt,
                API_KEY: toString,
            });
            expect(result).toEqual({
                ok: true,
                data: {HOST: "localhost", PORT: 3000, API_KEY: "secret123"},
            });
        });

        it("mixes export and non-export lines", () => {
            const result = loadEnv(opts([".env.export"]), {HOST: toString, DEBUG: toBool});
            expect(result).toEqual({ok: true, data: {HOST: "localhost", DEBUG: true}});
        });

        it("does not strip 'export' without trailing space", () => {
            // exportFOO=bar would have key "exportFOO", not "FOO"
            const result = loadEnv(opts([".env.export"]), {FOO: withRequired(toString)});
            expect(result).toEqual({ok: false, ctx: ["FOO: is required but is missing"]});
        });
    });

    describe("quote handling", () => {
        it("strips surrounding double quotes", () => {
            const result = loadEnv(opts([".env.quotes"]), {DOUBLE: toString});
            expect(result).toEqual({ok: true, data: {DOUBLE: "hello world"}});
        });

        it("strips surrounding single quotes", () => {
            const result = loadEnv(opts([".env.quotes"]), {SINGLE: toString});
            expect(result).toEqual({ok: true, data: {SINGLE: "hello world"}});
        });

        it("strips surrounding backticks", () => {
            const result = loadEnv(opts([".env.quotes"]), {BACKTICK: toString});
            expect(result).toEqual({ok: true, data: {BACKTICK: "hello world"}});
        });

        it("quotes are stripped before transform runs", () => {
            const result = loadEnv(opts([".env.basic"]), {
                PORT: toInt,
                DEBUG: toBool,
            });
            expect(result).toEqual({ok: true, data: {PORT: 3000, DEBUG: true}});
        });
    });

    describe("escape sequences", () => {
        it("expands \\n in double-quoted values", () => {
            const result = loadEnv(opts([".env.escapes"]), {NEWLINE: toString});
            expect(result).toEqual({ok: true, data: {NEWLINE: "hello\nworld"}});
        });

        it("expands \\t in double-quoted values", () => {
            const result = loadEnv(opts([".env.escapes"]), {TAB: toString});
            expect(result).toEqual({ok: true, data: {TAB: "hello\tworld"}});
        });

        it("expands \\r in double-quoted values", () => {
            const result = loadEnv(opts([".env.escapes"]), {CARRIAGE: toString});
            expect(result).toEqual({ok: true, data: {CARRIAGE: "hello\rworld"}});
        });

        it("expands \\\\ to single backslash in double-quoted values", () => {
            const result = loadEnv(opts([".env.escapes"]), {BACKSLASH: toString});
            expect(result).toEqual({ok: true, data: {BACKSLASH: "hello\\world"}});
        });

        it("expands escaped quotes in double-quoted values", () => {
            const result = loadEnv(opts([".env.escapes"]), {ESCAPED_QUOTE: toString});
            expect(result).toEqual({ok: true, data: {ESCAPED_QUOTE: 'say "hello"'}});
        });

        it("does NOT expand escapes in single-quoted values", () => {
            const result = loadEnv(opts([".env.escapes"]), {SINGLE_LITERAL: toString});
            expect(result).toEqual({ok: true, data: {SINGLE_LITERAL: "hello\\nworld"}});
        });

        it("does NOT expand escapes in backtick-quoted values", () => {
            const result = loadEnv(opts([".env.escapes"]), {BACKTICK_LITERAL: toString});
            expect(result).toEqual({ok: true, data: {BACKTICK_LITERAL: "hello\\nworld"}});
        });
    });

    describe("multiline values", () => {
        it("supports multiline in double quotes", () => {
            const result = loadEnv(opts([".env.multiline"]), {MULTI_DOUBLE: toString});
            expect(result).toEqual({ok: true, data: {MULTI_DOUBLE: "line1\nline2\nline3"}});
        });

        it("supports multiline in single quotes", () => {
            const result = loadEnv(opts([".env.multiline"]), {MULTI_SINGLE: toString});
            expect(result).toEqual({ok: true, data: {MULTI_SINGLE: "line1\nline2\nline3"}});
        });

        it("supports multiline in backticks", () => {
            const result = loadEnv(opts([".env.multiline"]), {MULTI_BACKTICK: toString});
            expect(result).toEqual({ok: true, data: {MULTI_BACKTICK: "line1\nline2\nline3"}});
        });

        it("parses entries after multiline values correctly", () => {
            const result = loadEnv(opts([".env.multiline"]), {
                MULTI_DOUBLE: toString,
                AFTER: toString,
            });
            expect(result).toEqual({
                ok: true,
                data: {MULTI_DOUBLE: "line1\nline2\nline3", AFTER: "still works"},
            });
        });
    });

    describe("BOM handling", () => {
        const tmpDir = join(tmpdir(), "cl-env-test-bom");

        beforeAll(() => {
            mkdirSync(tmpDir, {recursive: true});
            writeFileSync(join(tmpDir, ".env.bom"), "\uFEFFHOST=localhost\nPORT=3000\n", "utf8");
        });

        afterAll(() => {
            rmSync(tmpDir, {recursive: true, force: true});
        });

        it("strips BOM and parses correctly", () => {
            const result = loadEnv(
                {files: [".env.bom"], transformKeys: false, basePath: tmpDir},
                {HOST: toString, PORT: toInt}
            );
            expect(result).toEqual({ok: true, data: {HOST: "localhost", PORT: 3000}});
        });
    });

    describe("CRLF normalization", () => {
        const tmpDir = join(tmpdir(), "cl-env-test-crlf");

        beforeAll(() => {
            mkdirSync(tmpDir, {recursive: true});
            writeFileSync(join(tmpDir, ".env.crlf"), "FOO=bar\r\nBAR=baz\r\n", "utf8");
            writeFileSync(join(tmpDir, ".env.cr"), "FOO=bar\rBAR=baz\r", "utf8");
        });

        afterAll(() => {
            rmSync(tmpDir, {recursive: true, force: true});
        });

        it("handles CRLF line endings", () => {
            const result = loadEnv(
                {files: [".env.crlf"], transformKeys: false, basePath: tmpDir},
                {FOO: toString, BAR: toString}
            );
            expect(result).toEqual({ok: true, data: {FOO: "bar", BAR: "baz"}});
        });

        it("handles bare CR line endings", () => {
            const result = loadEnv(
                {files: [".env.cr"], transformKeys: false, basePath: tmpDir},
                {FOO: toString, BAR: toString}
            );
            expect(result).toEqual({ok: true, data: {FOO: "bar", BAR: "baz"}});
        });
    });
});

describe("wrappers", () => {
    describe("withRequired", () => {
        it("succeeds when key exists in file", () => {
            const result = loadEnv(opts([".env.missing"]), {PRESENT: withRequired(toString)});
            expect(result).toEqual({ok: true, data: {PRESENT: "here"}});
        });

        it("fails when key is missing from file", () => {
            const result = loadEnv(opts([".env.missing"]), {ABSENT: withRequired(toString)});
            expect(result).toEqual({ok: false, ctx: ["ABSENT: is required but is missing"]});
        });

        it("fails when value is empty", () => {
            const result = loadEnv(opts([".env.messy"]), {EMPTY_VAL: withRequired(toString)});
            expect(result).toEqual({
                ok: false,
                ctx: ["EMPTY_VAL:L8: EMPTY_VAL: is required but is missing"],
            });
        });

        it("passes through to inner transform when value is present", () => {
            const result = loadEnv(opts([".env.basic"]), {PORT: withRequired(toInt)});
            expect(result).toEqual({ok: true, data: {PORT: 3000}});
        });
    });

    describe("withDefault", () => {
        it("returns default when key is missing from file", () => {
            const result = loadEnv(opts([".env.missing"]), {ABSENT: withDefault(toInt, 9999)});
            expect(result).toEqual({ok: true, data: {ABSENT: 9999}});
        });

        it("returns default when value is empty", () => {
            const result = loadEnv(opts([".env.messy"]), {
                EMPTY_VAL: withDefault(toString, "fallback"),
            });
            expect(result).toEqual({ok: true, data: {EMPTY_VAL: "fallback"}});
        });

        it("uses file value when key exists", () => {
            const result = loadEnv(opts([".env.basic"]), {PORT: withDefault(toInt, 9999)});
            expect(result).toEqual({ok: true, data: {PORT: 3000}});
        });

        it("applies transformKeys to default values for missing keys", () => {
            const result = loadEnv(
                {files: [".env.missing"], transformKeys: true, basePath: fixtures},
                {MY_PORT: withDefault(toInt, 3000)}
            );
            expect(result).toEqual({ok: true, data: {myPort: 3000}});
        });
    });

    describe("plain transform for missing key", () => {
        it("toString succeeds with empty string for missing key", () => {
            const result = loadEnv(opts([".env.missing"]), {FOO: toString});
            expect(result).toEqual({ok: true, data: {FOO: ""}});
        });
    });
});

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

        it("resolves missing references to empty string", () => {
            // ensure CLENV_UNDEFINED_VAR is not in process.env
            delete process.env.CLENV_UNDEFINED_VAR;
            const result = loadEnv(opts([".env.expansion"]), {MISSING_REF: toString});
            expect(result).toEqual({ok: true, data: {MISSING_REF: ""}});
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

    describe("logger", () => {
        it("calls custom logger function", () => {
            const messages: Array<{level: LogLevel; message: string}> = [];
            const logger: Logger = (level, message) => messages.push({level, message});

            loadEnv(
                {files: [".env.basic"], transformKeys: false, basePath: fixtures, logger},
                {HOST: toString}
            );

            expect(messages.some((m) => m.level === "verbose")).toBe(true);
            expect(messages.some((m) => m.level === "debug")).toBe(true);
        });

        it("logger: true uses default logger (does not throw)", () => {
            // just verify it doesn't crash
            const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
            loadEnv(
                {files: [".env.basic"], transformKeys: false, basePath: fixtures, logger: true},
                {HOST: toString}
            );
            spy.mockRestore();
        });

        it("logs duplicate key warnings", () => {
            const messages: Array<{level: LogLevel; message: string}> = [];
            const logger: Logger = (level, message) => messages.push({level, message});

            loadEnv(
                {files: [".env.duplicate"], transformKeys: false, basePath: fixtures, logger},
                {KEY: toString, OTHER: toString}
            );

            const dupWarning = messages.find(
                (m) => m.level === "warn" && m.message.includes("duplicate key")
            );
            expect(dupWarning).toBeDefined();
        });

        it("logs unknown key warnings", () => {
            const messages: Array<{level: LogLevel; message: string}> = [];
            const logger: Logger = (level, message) => messages.push({level, message});

            loadEnv(
                {files: [".env.basic"], transformKeys: false, basePath: fixtures, logger},
                {HOST: toString}
                // PORT, DEBUG, APP_NAME are unknown
            );

            const unknownWarnings = messages.filter(
                (m) => m.level === "warn" && m.message.includes("not a known key")
            );
            expect(unknownWarnings.length).toBeGreaterThan(0);
        });

        it("logs summary on success", () => {
            const messages: Array<{level: LogLevel; message: string}> = [];
            const logger: Logger = (level, message) => messages.push({level, message});

            loadEnv(
                {files: [".env.basic"], transformKeys: false, basePath: fixtures, logger},
                {HOST: toString, PORT: toInt}
            );

            const summary = messages.find(
                (m) => m.level === "debug" && m.message.includes("loaded 2 keys from 1 file(s)")
            );
            expect(summary).toBeDefined();
        });

        it("logs expansion at verbose level", () => {
            const messages: Array<{level: LogLevel; message: string}> = [];
            const logger: Logger = (level, message) => messages.push({level, message});

            loadEnv(
                {files: [".env.expansion"], transformKeys: false, basePath: fixtures, logger},
                {HOST: toString, PORT: toString, URL: toString}
            );

            const expandLog = messages.find(
                (m) => m.level === "verbose" && m.message.includes("expanded")
            );
            expect(expandLog).toBeDefined();
        });

        it("logs default values at debug level", () => {
            const messages: Array<{level: LogLevel; message: string}> = [];
            const logger: Logger = (level, message) => messages.push({level, message});

            loadEnv(
                {files: [".env.missing"], transformKeys: false, basePath: fixtures, logger},
                {PRESENT: toString, ABSENT: withDefault(toInt, 9999)}
            );

            const defaultLog = messages.find(
                (m) =>
                    m.level === "debug" &&
                    m.message.includes("not found in any file, using default")
            );
            expect(defaultLog).toBeDefined();
        });

        it("logs process.env merge mode", () => {
            const messages: Array<{level: LogLevel; message: string}> = [];
            const logger: Logger = (level, message) => messages.push({level, message});

            loadEnv(
                {
                    files: [".env.basic"],
                    transformKeys: false,
                    basePath: fixtures,
                    logger,
                    includeProcessEnv: true,
                },
                {HOST: toString}
            );

            const mergeLog = messages.find(
                (m) => m.level === "debug" && m.message.includes("merging process.env as fallback")
            );
            expect(mergeLog).toBeDefined();
        });

        it("no logging when logger is undefined/false", () => {
            const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
            const spyDebug = vi.spyOn(console, "debug").mockImplementation(() => {});

            loadEnv(opts([".env.basic"]), {HOST: toString});

            expect(spy).not.toHaveBeenCalled();
            expect(spyDebug).not.toHaveBeenCalled();
            spy.mockRestore();
            spyDebug.mockRestore();
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
            const result = loadEnv(
                {files: [fixture(".env.basic")], transformKeys: false},
                {HOST: toString}
            );
            expect(result).toEqual({ok: true, data: {HOST: "localhost"}});
        });
    });
});

describe("error handling", () => {
    it("returns failure for nonexistent file", () => {
        const result = loadEnv(
            {files: ["does-not-exist.env"], transformKeys: false, basePath: fixtures},
            {FOO: toString}
        );
        expect(result.ok).toBe(false);
    });

    it("includes line numbers in transform errors", () => {
        // HOST is on line 1 of .env.basic, value "localhost" fails toInt
        const result = loadEnv(opts([".env.basic"]), {HOST: toInt});
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.ctx[0]).toMatch(/HOST:L1:/);
            expect(result.ctx[0]).toContain("failed to convert 'localhost' to a number");
        }
    });

    it("catches transform that throws", () => {
        const result = loadEnv(opts([".env.basic"]), {
            HOST: () => {
                throw new Error("boom");
            },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.ctx[0]).toMatch(/HOST:L1:/);
            expect(result.ctx[0]).toContain("transform function threw");
            expect(result.ctx[0]).toContain("boom");
        }
    });

    it("accumulates multiple errors", () => {
        const result = loadEnv(opts([".env.basic"]), {
            HOST: toInt,
            MISSING: withRequired(toString),
            PORT: toInt,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            // HOST fails to parse as int, MISSING is required but absent
            expect(result.ctx.length).toBe(2);
            expect(result.ctx[0]).toContain("HOST");
            expect(result.ctx[1]).toContain("MISSING");
        }
    });

    it("errors from multiple files include correct line numbers", () => {
        // PORT=3000 is on line 2 of .env.layered.base
        // PORT=8080 is on line 1 of .env.layered.local (this one wins after dedup)
        // So if PORT fails, it should reference the winning entry's line
        const result = loadEnv(
            {
                files: [".env.layered.base", ".env.layered.local"],
                transformKeys: false,
                basePath: fixtures,
            },
            {
                PORT: () => failure("custom error"),
            }
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.ctx[0]).toMatch(/PORT:L1:/);
        }
    });
});

describe("type inference", () => {
    it("infers correct types with transformKeys: false", () => {
        type SomeType = {host: string; port: number; ssl: boolean};

        const result = unwrap(
            loadEnv(opts([".env.complex"]), {
                DATABASE_URL: withRequired(toString),
                API_KEY: withRequired(toString),
                JSON_CONFIG: toJSON<SomeType>(),
                TAGS: toStringArray(),
                NUMBERS: toIntArray(),
            })
        );

        type assertion = Expect<
            Equal<
                typeof result,
                {
                    DATABASE_URL: string;
                    API_KEY: string;
                    JSON_CONFIG: SomeType;
                    TAGS: string[];
                    NUMBERS: number[];
                }
            >
        >;

        expect(result.DATABASE_URL).toBe(
            "postgres://user:pass@localhost:5432/mydb?sslmode=require"
        );
        expect(result.TAGS).toEqual(["foo", "bar", "baz"]);
        expect(result.NUMBERS).toEqual([1, 2, 3, 4, 5]);
    });

    it("infers camelCase keys with transformKeys: true", () => {
        const result = unwrap(
            loadEnv(
                {files: [".env.basic"], transformKeys: true, basePath: fixtures},
                {
                    HOST: toString,
                    PORT: toInt,
                    DEBUG: toBool,
                    APP_NAME: toString,
                }
            )
        );

        type assertion = Expect<
            Equal<
                typeof result,
                {
                    host: string;
                    port: number;
                    debug: boolean;
                    appName: string;
                }
            >
        >;

        expect(result.host).toBe("localhost");
        expect(result.port).toBe(3000);
        expect(result.debug).toBe(true);
        expect(result.appName).toBe("my-app");
    });

    it("preserves mixed-case keys with transformKeys: true", () => {
        const result = unwrap(
            loadEnv(
                {files: [".env.transformkeys"], transformKeys: true, basePath: fixtures},
                {FOO_BAR: toString, helloThere: toString}
            )
        );

        type assertion = Expect<
            Equal<
                typeof result,
                {
                    fooBar: string;
                    helloThere: string;
                }
            >
        >;

        expect(result.fooBar).toBe("1");
        expect(result.helloThere).toBe("2");
    });

    it("infers withDefault type correctly", () => {
        const result = unwrap(
            loadEnv(opts([".env.missing"]), {
                PRESENT: withRequired(toString),
                ABSENT: withDefault(toInt, 9999),
            })
        );

        type assertion = Expect<
            Equal<
                typeof result,
                {
                    PRESENT: string;
                    ABSENT: number;
                }
            >
        >;

        expect(result.PRESENT).toBe("here");
        expect(result.ABSENT).toBe(9999);
    });

    it("infers custom transform types", () => {
        const toDate = (k: string, v: string): Result<Date> => {
            const d = new Date(v);
            if (isNaN(d.getTime())) return failure(`${k}: invalid date`);
            return success(d);
        };

        const result = unwrap(
            loadEnv(opts([".env.custom"]), {CREATED: toDate})
        );

        type assertion = Expect<Equal<typeof result, {CREATED: Date}>>;

        expect(result.CREATED).toBeInstanceOf(Date);
    });

    it("infers union type from custom transform", () => {
        const toLogLevel = (key: string, v: string) => {
            if (["debug", "info", "warn", "error"].includes(v))
                return success(v as "debug" | "info" | "warn" | "error");
            return failure(`${key}: invalid log level '${v}'`);
        };

        const result = unwrap(
            loadEnv(opts([".env.custom"]), {LOG_LEVEL: toLogLevel})
        );

        type assertion = Expect<Equal<typeof result, {LOG_LEVEL: "debug" | "info" | "warn" | "error"}>>;

        expect(result.LOG_LEVEL).toBe("debug");
    });

    it("infers schemaParser + transformKeys combined", () => {
        type Config = {host: string; port: number};
        const parser: SchemaParser = (obj) => success(obj);

        const result = unwrap(
            loadEnv(
                {
                    files: [".env.complex"],
                    transformKeys: true,
                    basePath: fixtures,
                    schemaParser: parser,
                },
                {
                    JSON_CONFIG: toJSON<Config>({}),
                    API_KEY: withDefault(toString, "none"),
                }
            )
        );

        type assertion = Expect<
            Equal<
                typeof result,
                {
                    jsonConfig: Config;
                    apiKey: string;
                }
            >
        >;

        expect(result.jsonConfig).toEqual({host: "localhost", port: 5432, ssl: true});
        expect(result.apiKey).toBe("sk-abc123def456");
    });

    it("infers toBool as boolean, not true | false", () => {
        const result = unwrap(loadEnv(opts([".env.basic"]), {DEBUG: toBool}));

        type assertion = Expect<Equal<typeof result, {DEBUG: boolean}>>;
        expect(result.DEBUG).toBe(true);
    });

    it("infers toStringArray as string[]", () => {
        const result = unwrap(loadEnv(opts([".env.complex"]), {TAGS: toStringArray()}));

        type assertion = Expect<Equal<typeof result, {TAGS: string[]}>>;
        expect(result.TAGS).toEqual(["foo", "bar", "baz"]);
    });

    it("infers toIntArray as number[]", () => {
        const result = unwrap(loadEnv(opts([".env.complex"]), {NUMBERS: toIntArray()}));

        type assertion = Expect<Equal<typeof result, {NUMBERS: number[]}>>;
        expect(result.NUMBERS).toEqual([1, 2, 3, 4, 5]);
    });

    it("full end-to-end with all transform types", () => {
        type JsonShape = {host: string; port: number; ssl: boolean};

        const result = unwrap(
            loadEnv(
                {files: [".env.complex"], transformKeys: true, basePath: fixtures},
                {
                    DATABASE_URL: withRequired(toString),
                    API_KEY: withRequired(toString),
                    JSON_CONFIG: toJSON<JsonShape>(),
                    TAGS: toStringArray(),
                    NUMBERS: toIntArray(),
                    MULTILINE: toString,
                    SINGLE_NO_EXPAND: toString,
                }
            )
        );

        type assertion = Expect<
            Equal<
                typeof result,
                {
                    databaseUrl: string;
                    apiKey: string;
                    jsonConfig: JsonShape;
                    tags: string[];
                    numbers: number[];
                    multiline: string;
                    singleNoExpand: string;
                }
            >
        >;

        expect(result).toEqual({
            databaseUrl: "postgres://user:pass@localhost:5432/mydb?sslmode=require",
            apiKey: "sk-abc123def456",
            jsonConfig: {host: "localhost", port: 5432, ssl: true},
            tags: ["foo", "bar", "baz"],
            numbers: [1, 2, 3, 4, 5],
            multiline: "line1\nline2\nline3",
            singleNoExpand: "keep\\nraw",
        });
    });
});

describe("result utilities", () => {
    it("success creates ok result", () => {
        expect(success(42)).toEqual({ok: true, data: 42});
    });

    it("failure creates error result", () => {
        expect(failure("bad")).toEqual({ok: false, ctx: "bad"});
    });

    it("unwrap returns data on success", () => {
        expect(unwrap(success(42))).toBe(42);
    });

    it("unwrap throws on failure", () => {
        expect(() => unwrap(failure("bad"))).toThrow("bad");
    });

    it("unwrap joins array errors", () => {
        expect(() => unwrap(failure(["a", "b"]))).toThrow("a\nb");
    });
});
