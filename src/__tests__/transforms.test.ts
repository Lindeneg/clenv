import {join} from "node:path";
import {describe, it, expect} from "vitest";
import {
    loadEnv,
    toString,
    toInt,
    toFloat,
    toBool,
    toJSON,
    toStringArray,
    toIntArray,
    toFloatArray,
    toEnum,
    withDefault,
    withRequired,
    withOptional,
    success,
    failure,
    type SchemaParser,
    type TransformContext,
} from "../index.js";

const fixtures = join(import.meta.dirname, "fixtures");
const opts = (files: string[], extra: Partial<Parameters<typeof loadEnv>[0]> = {}) =>
    ({files, transformKeys: false, basePath: fixtures, ...extra}) as const;

// minimal ctx for direct transform unit tests
const ctx: TransformContext = {expandedEnv: {}};

// ─── transforms (unit) ──────────────────────────────────────────────────────

describe("transforms", () => {
    describe("toString", () => {
        it("returns value as-is", () => {
            expect(toString("K", "hello", ctx)).toEqual({ok: true, data: "hello"});
        });

        it("returns empty string for empty value", () => {
            expect(toString("K", "", ctx)).toEqual({ok: true, data: ""});
        });

        it("fails on undefined", () => {
            const result = toString("K", undefined, ctx);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx).toContain("no value provided");
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
            expect(toBool("K", input, ctx)).toEqual({ok: true, data: expected});
        });

        it.each(["yes", "no", "on", "off", "2", ""])("rejects '%s'", (input) => {
            const result = toBool("K", input, ctx);
            expect(result.ok).toBe(false);
        });

        it("includes key and value in error message", () => {
            expect(toBool("DEBUG", "nope", ctx)).toEqual({
                ok: false,
                ctx: "DEBUG: expected boolean, got 'nope'",
            });
        });

        it("fails on undefined", () => {
            const result = toBool("K", undefined, ctx);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx).toContain("no value provided");
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
            const hexCtx: TransformContext = {expandedEnv: {}, radix: () => 16};
            expect(toInt("K", "ff", hexCtx)).toEqual({ok: true, data: 255});
        });

        it("radix can be per-key", () => {
            const mixedCtx: TransformContext = {
                expandedEnv: {},
                radix: (key: string) => (key === "HEX" ? 16 : undefined),
            };
            expect(toInt("HEX", "a", mixedCtx)).toEqual({ok: true, data: 10});
            expect(toInt("DEC", "10", mixedCtx)).toEqual({ok: true, data: 10});
        });

        it("fails on undefined", () => {
            const result = toInt("K", undefined, ctx);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx).toContain("no value provided");
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

        it("fails on undefined", () => {
            const result = toFloat("K", undefined, ctx);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx).toContain("no value provided");
        });
    });

    describe("toStringArray", () => {
        it("splits by comma by default", () => {
            expect(toStringArray()("K", "a,b,c", ctx)).toEqual({ok: true, data: ["a", "b", "c"]});
        });

        it("trims whitespace from elements", () => {
            expect(toStringArray()("K", "a , b , c", ctx)).toEqual({
                ok: true,
                data: ["a", "b", "c"],
            });
        });

        it("supports custom delimiter", () => {
            expect(toStringArray("|")("K", "x|y|z", ctx)).toEqual({
                ok: true,
                data: ["x", "y", "z"],
            });
        });

        it("returns single-element array for no delimiter match", () => {
            expect(toStringArray()("K", "single", ctx)).toEqual({ok: true, data: ["single"]});
        });

        it("fails on undefined", () => {
            const result = toStringArray()("K", undefined, ctx);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx).toContain("no value provided");
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

        it("fails on undefined", () => {
            const result = toIntArray()("K", undefined, ctx);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx).toContain("no value provided");
        });
    });

    describe("toFloatArray", () => {
        it("splits and parses floats", () => {
            expect(toFloatArray()("K", "1.1,2.2,3.3", ctx)).toEqual({
                ok: true,
                data: [1.1, 2.2, 3.3],
            });
        });

        it("trims whitespace from elements", () => {
            expect(toFloatArray()("K", "1.5 , 2.5 , 3.5", ctx)).toEqual({
                ok: true,
                data: [1.5, 2.5, 3.5],
            });
        });

        it("supports custom delimiter", () => {
            expect(toFloatArray("|")("K", "3.14|2.71", ctx)).toEqual({
                ok: true,
                data: [3.14, 2.71],
            });
        });

        it("fails if any element is not a number", () => {
            const result = toFloatArray()("NUMS", "1.1,abc,3.3", ctx);
            expect(result.ok).toBe(false);
        });

        it("fails on undefined", () => {
            const result = toFloatArray()("K", undefined, ctx);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx).toContain("no value provided");
        });
    });

    describe("toEnum", () => {
        it("succeeds for valid value", () => {
            expect(toEnum("debug", "info", "warn", "error")("K", "debug", ctx)).toEqual({
                ok: true,
                data: "debug",
            });
        });

        it("succeeds for each allowed value", () => {
            const transform = toEnum("a", "b", "c");
            expect(transform("K", "a", ctx)).toEqual({ok: true, data: "a"});
            expect(transform("K", "b", ctx)).toEqual({ok: true, data: "b"});
            expect(transform("K", "c", ctx)).toEqual({ok: true, data: "c"});
        });

        it("fails for invalid value", () => {
            const result = toEnum("debug", "info")("LEVEL", "verbose", ctx);
            expect(result).toEqual({
                ok: false,
                ctx: "LEVEL: expected one of [debug, info], got 'verbose'",
            });
        });

        it("fails on undefined", () => {
            const result = toEnum("a", "b")("K", undefined, ctx);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx).toContain("no value provided");
        });

        it("is case-sensitive", () => {
            const result = toEnum("debug", "info")("K", "DEBUG", ctx);
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
                ctx: expect.stringContaining("CFG: failed to parse JSON:"),
            });
        });

        it("calls schemaParser when schema provided", () => {
            const schema = {type: "object"};
            const parser: SchemaParser = (obj, s, _k) => {
                if (s === schema) return success(obj);
                return failure("wrong schema");
            };
            const ctxWithParser: TransformContext = {expandedEnv: {}, schemaParser: parser};
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
            const ctxWithParser: TransformContext = {
                expandedEnv: {},
                schemaParser: () => {
                    called = true;
                    return success({});
                },
            };
            toJSON<{a: number}>()("K", '{"a":1}', ctxWithParser);
            expect(called).toBe(false);
        });

        it("fails on undefined", () => {
            const result = toJSON()("K", undefined, ctx);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx).toContain("no value provided");
        });
    });
});

// ─── wrappers ───────────────────────────────────────────────────────────────

describe("wrappers", () => {
    describe("withRequired", () => {
        it("succeeds when key exists in file", () => {
            const result = loadEnv(opts([".env.missing"]), {PRESENT: withRequired(toString)});
            expect(result).toEqual({ok: true, data: {PRESENT: "here"}});
        });

        it("fails when key is missing from file", () => {
            const result = loadEnv(opts([".env.missing"]), {ABSENT: withRequired(toString)});
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.ctx[0]).toMatchObject({
                    key: "ABSENT",
                    source: "none",
                    message: "ABSENT: is required but is missing",
                });
            }
        });

        it("passes empty string through to inner transform (KEY= is not missing)", () => {
            const result = loadEnv(opts([".env.empty-value"]), {
                EMPTY_KEY: withRequired(toString),
            });
            expect(result).toEqual({ok: true, data: {EMPTY_KEY: ""}});
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

        it("passes empty string through — does NOT use default for KEY=", () => {
            const result = loadEnv(opts([".env.empty-value"]), {
                EMPTY_KEY: withDefault(toString, "fallback"),
            });
            expect(result).toEqual({ok: true, data: {EMPTY_KEY: ""}});
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

    describe("withOptional", () => {
        it("returns undefined when key is missing from file", () => {
            const result = loadEnv(opts([".env.missing"]), {
                ABSENT: withOptional(toString),
            });
            expect(result).toEqual({ok: true, data: {ABSENT: undefined}});
        });

        it("delegates to inner transform when value is present", () => {
            const result = loadEnv(opts([".env.basic"]), {PORT: withOptional(toInt)});
            expect(result).toEqual({ok: true, data: {PORT: 3000}});
        });

        it("passes empty string through — does NOT return undefined for KEY=", () => {
            const result = loadEnv(opts([".env.empty-value"]), {
                EMPTY_KEY: withOptional(toString),
            });
            expect(result).toEqual({ok: true, data: {EMPTY_KEY: ""}});
        });

        it("inner transform error propagates", () => {
            const result = loadEnv(opts([".env.basic"]), {
                HOST: withOptional(toInt),
            });
            expect(result.ok).toBe(false);
        });
    });

    describe("bare transform for missing key", () => {
        it("bare toString fails with 'no value provided' for missing key", () => {
            const result = loadEnv(opts([".env.missing"]), {FOO: toString});
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx[0]!.message).toContain("no value provided");
        });

        it("bare toInt fails with 'no value provided' for missing key", () => {
            const result = loadEnv(opts([".env.missing"]), {FOO: toInt});
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx[0]!.message).toContain("no value provided");
        });
    });
});

// ─── undefined vs empty string semantics ────────────────────────────────────

describe("undefined vs empty string", () => {
    it("missing key → undefined to transform", () => {
        const result = loadEnv(opts([".env.missing"]), {ABSENT: toString});
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.ctx[0]!.message).toContain("no value provided");
    });

    it("present empty KEY= → empty string to transform", () => {
        const result = loadEnv(opts([".env.empty-value"]), {EMPTY_KEY: toString});
        expect(result).toEqual({ok: true, data: {EMPTY_KEY: ""}});
    });

    it("withRequired fails on missing, succeeds on empty", () => {
        const missing = loadEnv(opts([".env.missing"]), {ABSENT: withRequired(toString)});
        expect(missing.ok).toBe(false);

        const empty = loadEnv(opts([".env.empty-value"]), {EMPTY_KEY: withRequired(toString)});
        expect(empty).toEqual({ok: true, data: {EMPTY_KEY: ""}});
    });

    it("withDefault substitutes on missing, passes through empty", () => {
        const missing = loadEnv(opts([".env.missing"]), {
            ABSENT: withDefault(toString, "fallback"),
        });
        expect(missing).toEqual({ok: true, data: {ABSENT: "fallback"}});

        const empty = loadEnv(opts([".env.empty-value"]), {
            EMPTY_KEY: withDefault(toString, "fallback"),
        });
        expect(empty).toEqual({ok: true, data: {EMPTY_KEY: ""}});
    });

    it("withOptional returns undefined on missing, passes through empty", () => {
        const missing = loadEnv(opts([".env.missing"]), {
            ABSENT: withOptional(toString),
        });
        expect(missing).toEqual({ok: true, data: {ABSENT: undefined}});

        const empty = loadEnv(opts([".env.empty-value"]), {
            EMPTY_KEY: withOptional(toString),
        });
        expect(empty).toEqual({ok: true, data: {EMPTY_KEY: ""}});
    });
});
