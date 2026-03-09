import {writeFileSync, mkdirSync, rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";

import {describe, it, expect, afterAll, beforeAll} from "vitest";
import {
    loadEnv,
    toString,
    toInt,
    toBool,
    withRequired,
    withOptional,
    type Logger,
    type LogLevel,
} from "../index.js";

const fixtures = join(import.meta.dirname, "fixtures");
const opts = (files: string[], extra: Partial<Parameters<typeof loadEnv>[0]> = {}) =>
    ({files, transformKeys: false, basePath: fixtures, ...extra}) as const;

// ─── parser (integration) ───────────────────────────────────────────────────

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
        it("handles empty values (KEY=)", () => {
            const result = loadEnv(opts([".env.empty-value"]), {EMPTY_KEY: toString});
            expect(result).toEqual({ok: true, data: {EMPTY_KEY: ""}});
        });

        it("empty value is not undefined — transforms receive empty string", () => {
            const result = loadEnv(opts([".env.empty-value"]), {EMPTY_KEY: toBool});
            expect(result.ok).toBe(false);
            if (!result.ok) {
                // should fail with "expected boolean" not "no value provided"
                expect(result.ctx[0]).toContain("expected boolean");
            }
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

        it("unclosed double quote reads to EOF (mismatched quotes)", () => {
            const result = loadEnv(opts([".env.quotes"]), {MISMATCH: toString});
            // MISMATCH="hello world' — no closing ", parser consumes to EOF including trailing newline
            expect(result).toEqual({ok: true, data: {MISMATCH: "hello world'\n"}});
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

    describe("parser warnings", () => {
        it("errors on unterminated double quote with lines consumed", () => {
            const messages: Array<{level: LogLevel; message: string}> = [];
            const logger: Logger = (level, message) => messages.push({level, message});

            loadEnv(
                opts([".env.unterminated-double"], {logger}),
                {GOOD: toString, BAD_DOUBLE: toString}
            );

            const err = messages.find(
                (m) => m.level === "error" && m.message.includes("unterminated double quote")
            );
            expect(err).toBeDefined();
            expect(err!.message).toContain("consumed");
            expect(err!.message).toContain("to EOF");
        });

        it("errors on unterminated single quote with lines consumed", () => {
            const messages: Array<{level: LogLevel; message: string}> = [];
            const logger: Logger = (level, message) => messages.push({level, message});

            loadEnv(
                opts([".env.unterminated-single"], {logger}),
                {GOOD: toString, BAD_SINGLE: toString}
            );

            const err = messages.find(
                (m) => m.level === "error" && m.message.includes("unterminated single quote")
            );
            expect(err).toBeDefined();
            expect(err!.message).toContain("consumed");
        });

        it("errors on unterminated backtick quote with lines consumed", () => {
            const messages: Array<{level: LogLevel; message: string}> = [];
            const logger: Logger = (level, message) => messages.push({level, message});

            loadEnv(
                opts([".env.unterminated-backtick"], {logger}),
                {GOOD: toString, BAD_BACKTICK: toString}
            );

            const err = messages.find(
                (m) => m.level === "error" && m.message.includes("unterminated backtick quote")
            );
            expect(err).toBeDefined();
            expect(err!.message).toContain("consumed");
        });

        it("unterminated quote consumes all subsequent entries to EOF", () => {
            const messages: Array<{level: LogLevel; message: string}> = [];
            const logger: Logger = (level, message) => messages.push({level, message});

            const result = loadEnv(
                opts([".env.unterminated-combined"], {logger}),
                {
                    GOOD: toString,
                    BAD: toString,
                    AFTER_BAD: withOptional(toString),
                    LAST: withOptional(toString),
                }
            );

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.GOOD).toBe("hello");
                // BAD consumes everything after the opening " to EOF
                expect(result.data.BAD).toContain("unclosed double");
                expect(result.data.BAD).toContain("AFTER_BAD");
                // AFTER_BAD and LAST are never parsed as entries — they're inside BAD's value
                expect(result.data.AFTER_BAD).toBeUndefined();
                expect(result.data.LAST).toBeUndefined();
            }

            // error log should report lines consumed
            const err = messages.find((m) => m.level === "error" && m.message.includes("unterminated"));
            expect(err).toBeDefined();
            expect(err!.message).toMatch(/consumed \d+ line/);
        });

        it("warns on invalid key names", () => {
            const messages: Array<{level: LogLevel; message: string}> = [];
            const logger: Logger = (level, message) => messages.push({level, message});

            loadEnv(opts([".env.invalid-keys"], {logger}), {
                VALID_KEY: toString,
                "123ABC": toString,
                "API-KEY": toString,
                "API.KEY": toString,
                _UNDERSCORE: toString,
            });

            const invalidWarnings = messages.filter(
                (m) => m.level === "warn" && m.message.includes("invalid key name")
            );
            // 123ABC, API-KEY, API.KEY should warn; VALID_KEY and _UNDERSCORE should not
            expect(invalidWarnings.length).toBe(3);
        });

        it("does not warn on valid key names", () => {
            const messages: Array<{level: LogLevel; message: string}> = [];
            const logger: Logger = (level, message) => messages.push({level, message});

            loadEnv(opts([".env.basic"], {logger}), {HOST: toString});

            const invalidWarnings = messages.filter(
                (m) => m.level === "warn" && m.message.includes("invalid key name")
            );
            expect(invalidWarnings.length).toBe(0);
        });

        it("warning/error format follows src:L{line}: key: message convention", () => {
            const messages: Array<{level: LogLevel; message: string}> = [];
            const logger: Logger = (level, message) => messages.push({level, message});

            loadEnv(opts([".env.unterminated-double"], {logger}), {BAD_DOUBLE: toString});

            const err = messages.find(
                (m) => m.level === "error" && m.message.includes("unterminated double quote")
            );
            expect(err).toBeDefined();
            expect(err!.message).toMatch(/^\.env\.unterminated-double:L\d+: BAD_DOUBLE:/);
        });
    });
});
