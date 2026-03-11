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
    refine,
    inRange,
    nonEmpty,
    matches,
    minLength,
    maxLength,
    success,
    failure,
    type SchemaParser,
    type TransformContext,
    type RefineCheck,
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
            expect(toString()("K", "hello", ctx)).toEqual({ok: true, data: "hello"});
        });

        it("returns empty string for empty value", () => {
            expect(toString()("K", "", ctx)).toEqual({ok: true, data: ""});
        });

        it("fails on undefined", () => {
            const result = toString()("K", undefined, ctx);
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
            expect(toBool()("K", input, ctx)).toEqual({ok: true, data: expected});
        });

        it.each(["yes", "no", "on", "off", "2", ""])("rejects '%s'", (input) => {
            const result = toBool()("K", input, ctx);
            expect(result.ok).toBe(false);
        });

        it("includes key and value in error message", () => {
            expect(toBool()("DEBUG", "nope", ctx)).toEqual({
                ok: false,
                ctx: "DEBUG: expected boolean, got 'nope'",
            });
        });

        it("supports custom true/false values", () => {
            const yesNo = toBool({trueValues: ["yes", "y"], falseValues: ["no", "n"]});
            expect(yesNo("K", "yes", ctx)).toEqual({ok: true, data: true});
            expect(yesNo("K", "n", ctx)).toEqual({ok: true, data: false});
            expect(yesNo("K", "true", ctx).ok).toBe(false);
        });

        it("uses defaults for omitted partial options", () => {
            const customTrue = toBool({trueValues: ["yes"]});
            expect(customTrue("K", "yes", ctx)).toEqual({ok: true, data: true});
            expect(customTrue("K", "false", ctx)).toEqual({ok: true, data: false});
            expect(customTrue("K", "true", ctx).ok).toBe(false);

            const customFalse = toBool({falseValues: ["no"]});
            expect(customFalse("K", "true", ctx)).toEqual({ok: true, data: true});
            expect(customFalse("K", "no", ctx)).toEqual({ok: true, data: false});
            expect(customFalse("K", "false", ctx).ok).toBe(false);
        });

        it("fails on undefined", () => {
            const result = toBool()("K", undefined, ctx);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx).toContain("no value provided");
        });
    });

    describe("toInt", () => {
        it("parses valid integer", () => {
            expect(toInt()("K", "42", ctx)).toEqual({ok: true, data: 42});
        });

        it("parses negative integer", () => {
            expect(toInt()("K", "-7", ctx)).toEqual({ok: true, data: -7});
        });

        it("fails on non-numeric (strict mode default)", () => {
            expect(toInt()("PORT", "abc", ctx)).toEqual({
                ok: false,
                ctx: "PORT: 'abc' is not a valid integer",
            });
        });

        it("fails on empty string (strict mode default)", () => {
            expect(toInt()("K", "", ctx)).toEqual({
                ok: false,
                ctx: "K: '' is not a valid integer",
            });
        });

        it("rejects trailing non-numeric characters in strict mode", () => {
            const result = toInt()("K", "42abc", ctx);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx).toContain("is not a valid integer");
        });

        it("allows trailing non-numeric in non-strict mode (parseInt behavior)", () => {
            expect(toInt({strict: false})("K", "42abc", ctx)).toEqual({ok: true, data: 42});
        });

        it("non-strict mode fails on completely non-numeric", () => {
            expect(toInt({strict: false})("K", "abc", ctx)).toEqual({
                ok: false,
                ctx: "K: failed to convert 'abc' to a number",
            });
        });

        it("respects radix option", () => {
            expect(toInt({radix: 16})("K", "ff", ctx)).toEqual({ok: true, data: 255});
        });

        it("respects radix with strict mode", () => {
            expect(toInt({radix: 16})("K", "1a", ctx)).toEqual({ok: true, data: 26});
            expect(toInt({radix: 16})("K", "gg", ctx).ok).toBe(false);
        });

        it("fails on undefined", () => {
            const result = toInt()("K", undefined, ctx);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx).toContain("no value provided");
        });
    });

    describe("toFloat", () => {
        it("parses valid float", () => {
            expect(toFloat()("K", "3.14", ctx)).toEqual({ok: true, data: 3.14});
        });

        it("parses negative float", () => {
            expect(toFloat()("K", "-0.5", ctx)).toEqual({ok: true, data: -0.5});
        });

        it("parses integer as float", () => {
            expect(toFloat()("K", "42", ctx)).toEqual({ok: true, data: 42});
        });

        it("parses scientific notation", () => {
            expect(toFloat()("K", "1.5e3", ctx)).toEqual({ok: true, data: 1500});
        });

        it("fails on non-numeric (strict mode default)", () => {
            expect(toFloat()("RATE", "abc", ctx)).toEqual({
                ok: false,
                ctx: "RATE: 'abc' is not a valid number",
            });
        });

        it("rejects trailing non-numeric in strict mode", () => {
            const result = toFloat()("K", "3.14xyz", ctx);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx).toContain("is not a valid number");
        });

        it("allows trailing non-numeric in non-strict mode", () => {
            expect(toFloat({strict: false})("K", "3.14xyz", ctx)).toEqual({ok: true, data: 3.14});
        });

        it("non-strict mode fails on completely non-numeric", () => {
            expect(toFloat({strict: false})("K", "abc", ctx)).toEqual({
                ok: false,
                ctx: "K: failed to convert 'abc' to a number",
            });
        });

        it("fails on undefined", () => {
            const result = toFloat()("K", undefined, ctx);
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

        it("returns empty array for empty string", () => {
            expect(toStringArray()("K", "", ctx)).toEqual({ok: true, data: []});
        });

        it("filters empty elements from split", () => {
            expect(toStringArray()("K", "a,,b", ctx)).toEqual({ok: true, data: ["a", "b"]});
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
            expect(toIntArray({delimiter: "-"})("K", "3-1-4", ctx)).toEqual({
                ok: true,
                data: [3, 1, 4],
            });
        });

        it("fails if any element is not a number", () => {
            const result = toIntArray()("NUMS", "1,abc,3", ctx);
            expect(result.ok).toBe(false);
        });

        it("propagates strict mode to elements", () => {
            const strict = toIntArray()("K", "1,42abc,3", ctx);
            expect(strict.ok).toBe(false);

            const lenient = toIntArray({strict: false})("K", "1,42abc,3", ctx);
            expect(lenient).toEqual({ok: true, data: [1, 42, 3]});
        });

        it("returns empty array for empty string", () => {
            expect(toIntArray()("K", "", ctx)).toEqual({ok: true, data: []});
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
            expect(toFloatArray({delimiter: "|"})("K", "3.14|2.71", ctx)).toEqual({
                ok: true,
                data: [3.14, 2.71],
            });
        });

        it("fails if any element is not a number", () => {
            const result = toFloatArray()("NUMS", "1.1,abc,3.3", ctx);
            expect(result.ok).toBe(false);
        });

        it("propagates strict mode to elements", () => {
            const strict = toFloatArray()("K", "1.0,3.14xyz", ctx);
            expect(strict.ok).toBe(false);

            const lenient = toFloatArray({strict: false})("K", "1.0,3.14xyz", ctx);
            expect(lenient).toEqual({ok: true, data: [1.0, 3.14]});
        });

        it("returns empty array for empty string", () => {
            expect(toFloatArray()("K", "", ctx)).toEqual({ok: true, data: []});
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
            const result = loadEnv(opts([".env.missing"]), {PRESENT: withRequired(toString())});
            expect(result).toEqual({ok: true, data: {PRESENT: "here"}});
        });

        it("fails when key is missing from file", () => {
            const result = loadEnv(opts([".env.missing"]), {ABSENT: withRequired(toString())});
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
                EMPTY_KEY: withRequired(toString()),
            });
            expect(result).toEqual({ok: true, data: {EMPTY_KEY: ""}});
        });

        it("passes through to inner transform when value is present", () => {
            const result = loadEnv(opts([".env.basic"]), {PORT: withRequired(toInt())});
            expect(result).toEqual({ok: true, data: {PORT: 3000}});
        });
    });

    describe("withDefault", () => {
        it("returns default when key is missing from file", () => {
            const result = loadEnv(opts([".env.missing"]), {ABSENT: withDefault(toInt(), 9999)});
            expect(result).toEqual({ok: true, data: {ABSENT: 9999}});
        });

        it("passes empty string through — does NOT use default for KEY=", () => {
            const result = loadEnv(opts([".env.empty-value"]), {
                EMPTY_KEY: withDefault(toString(), "fallback"),
            });
            expect(result).toEqual({ok: true, data: {EMPTY_KEY: ""}});
        });

        it("uses file value when key exists", () => {
            const result = loadEnv(opts([".env.basic"]), {PORT: withDefault(toInt(), 9999)});
            expect(result).toEqual({ok: true, data: {PORT: 3000}});
        });

        it("applies transformKeys to default values for missing keys", () => {
            const result = loadEnv(
                {files: [".env.missing"], transformKeys: true, basePath: fixtures},
                {MY_PORT: withDefault(toInt(), 3000)}
            );
            expect(result).toEqual({ok: true, data: {myPort: 3000}});
        });
    });

    describe("withOptional", () => {
        it("returns undefined when key is missing from file", () => {
            const result = loadEnv(opts([".env.missing"]), {
                ABSENT: withOptional(toString()),
            });
            expect(result).toEqual({ok: true, data: {ABSENT: undefined}});
        });

        it("delegates to inner transform when value is present", () => {
            const result = loadEnv(opts([".env.basic"]), {PORT: withOptional(toInt())});
            expect(result).toEqual({ok: true, data: {PORT: 3000}});
        });

        it("passes empty string through — does NOT return undefined for KEY=", () => {
            const result = loadEnv(opts([".env.empty-value"]), {
                EMPTY_KEY: withOptional(toString()),
            });
            expect(result).toEqual({ok: true, data: {EMPTY_KEY: ""}});
        });

        it("inner transform error propagates", () => {
            const result = loadEnv(opts([".env.basic"]), {
                HOST: withOptional(toInt()),
            });
            expect(result.ok).toBe(false);
        });
    });

    describe("bare transform for missing key", () => {
        it("bare toString() fails with 'no value provided' for missing key", () => {
            const result = loadEnv(opts([".env.missing"]), {FOO: toString()});
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx[0]!.message).toContain("no value provided");
        });

        it("bare toInt() fails with 'no value provided' for missing key", () => {
            const result = loadEnv(opts([".env.missing"]), {FOO: toInt()});
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx[0]!.message).toContain("no value provided");
        });
    });
});

// ─── undefined vs empty string semantics ────────────────────────────────────

describe("undefined vs empty string", () => {
    it("missing key → undefined to transform", () => {
        const result = loadEnv(opts([".env.missing"]), {ABSENT: toString()});
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.ctx[0]!.message).toContain("no value provided");
    });

    it("present empty KEY= → empty string to transform", () => {
        const result = loadEnv(opts([".env.empty-value"]), {EMPTY_KEY: toString()});
        expect(result).toEqual({ok: true, data: {EMPTY_KEY: ""}});
    });

    it("withRequired fails on missing, succeeds on empty", () => {
        const missing = loadEnv(opts([".env.missing"]), {ABSENT: withRequired(toString())});
        expect(missing.ok).toBe(false);

        const empty = loadEnv(opts([".env.empty-value"]), {EMPTY_KEY: withRequired(toString())});
        expect(empty).toEqual({ok: true, data: {EMPTY_KEY: ""}});
    });

    it("withDefault substitutes on missing, passes through empty", () => {
        const missing = loadEnv(opts([".env.missing"]), {
            ABSENT: withDefault(toString(), "fallback"),
        });
        expect(missing).toEqual({ok: true, data: {ABSENT: "fallback"}});

        const empty = loadEnv(opts([".env.empty-value"]), {
            EMPTY_KEY: withDefault(toString(), "fallback"),
        });
        expect(empty).toEqual({ok: true, data: {EMPTY_KEY: ""}});
    });

    it("withOptional returns undefined on missing, passes through empty", () => {
        const missing = loadEnv(opts([".env.missing"]), {
            ABSENT: withOptional(toString()),
        });
        expect(missing).toEqual({ok: true, data: {ABSENT: undefined}});

        const empty = loadEnv(opts([".env.empty-value"]), {
            EMPTY_KEY: withOptional(toString()),
        });
        expect(empty).toEqual({ok: true, data: {EMPTY_KEY: ""}});
    });
});

// ─── refine ──────────────────────────────────────────────────────────────────

describe("refine", () => {
    describe("refine function", () => {
        it("passes value through when all checks pass", () => {
            const transform = refine(toInt(), inRange(0, 100));
            expect(transform("K", "50", ctx)).toEqual({ok: true, data: 50});
        });

        it("fails when a check fails", () => {
            const transform = refine(toInt(), inRange(0, 100));
            const result = transform("K", "200", ctx);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx).toContain("bigger than constraint");
        });

        it("fails when base transform fails", () => {
            const transform = refine(toInt(), inRange(0, 100));
            const result = transform("K", "abc", ctx);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx).toContain("is not a valid integer");
        });

        it("chains multiple checks", () => {
            const transform = refine(toString(), nonEmpty(), maxLength(5));
            expect(transform("K", "hi", ctx)).toEqual({ok: true, data: "hi"});

            const tooLong = transform("K", "toolongstring", ctx);
            expect(tooLong.ok).toBe(false);

            const empty = transform("K", "", ctx);
            expect(empty.ok).toBe(false);
        });

        it("fails on undefined (base transform handles it)", () => {
            const transform = refine(toString(), nonEmpty());
            const result = transform("K", undefined, ctx);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx).toContain("no value provided");
        });
    });

    describe("inRange", () => {
        it("passes when value is within range", () => {
            const transform = refine(toInt(), inRange(1, 10));
            expect(transform("K", "5", ctx)).toEqual({ok: true, data: 5});
        });

        it("passes at boundaries", () => {
            const transform = refine(toInt(), inRange(1, 10));
            expect(transform("K", "1", ctx)).toEqual({ok: true, data: 1});
            expect(transform("K", "10", ctx)).toEqual({ok: true, data: 10});
        });

        it("fails below minimum", () => {
            const transform = refine(toInt(), inRange(1, 10));
            const result = transform("K", "0", ctx);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx).toContain("smaller than constraint '1'");
        });

        it("fails above maximum", () => {
            const transform = refine(toInt(), inRange(1, 10));
            const result = transform("K", "11", ctx);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx).toContain("bigger than constraint '10'");
        });

        it("works with floats", () => {
            const transform = refine(toFloat(), inRange(0, 1));
            expect(transform("K", "0.5", ctx)).toEqual({ok: true, data: 0.5});
            expect(transform("K", "1.1", ctx).ok).toBe(false);
        });
    });

    describe("nonEmpty", () => {
        it("passes for non-empty string", () => {
            const transform = refine(toString(), nonEmpty());
            expect(transform("K", "hello", ctx)).toEqual({ok: true, data: "hello"});
        });

        it("fails for empty string", () => {
            const transform = refine(toString(), nonEmpty());
            const result = transform("K", "", ctx);
            expect(result.ok).toBe(false);
        });

        it("works with arrays", () => {
            const transform = refine(toStringArray(), nonEmpty());
            expect(transform("K", "a,b", ctx)).toEqual({ok: true, data: ["a", "b"]});

            const empty = transform("K", "", ctx);
            expect(empty.ok).toBe(false);
        });
    });

    describe("matches", () => {
        it("passes when regex matches", () => {
            const transform = refine(toString(), matches(/^\d{3}-\d{4}$/));
            expect(transform("K", "123-4567", ctx)).toEqual({ok: true, data: "123-4567"});
        });

        it("fails when regex does not match", () => {
            const transform = refine(toString(), matches(/^\d{3}-\d{4}$/));
            const result = transform("K", "not-a-phone", ctx);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx).toContain("failed to match");
        });
    });

    describe("minLength", () => {
        it("passes when length meets minimum", () => {
            const transform = refine(toString(), minLength(3));
            expect(transform("K", "abc", ctx)).toEqual({ok: true, data: "abc"});
        });

        it("fails when too short", () => {
            const transform = refine(toString(), minLength(3));
            const result = transform("K", "ab", ctx);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx).toContain("minimum '3' length");
        });

        it("works with arrays", () => {
            const transform = refine(toStringArray(), minLength(2));
            expect(transform("K", "a,b,c", ctx)).toEqual({ok: true, data: ["a", "b", "c"]});
            expect(transform("K", "a", ctx).ok).toBe(false);
        });
    });

    describe("maxLength", () => {
        it("passes when length is within maximum", () => {
            const transform = refine(toString(), maxLength(5));
            expect(transform("K", "abc", ctx)).toEqual({ok: true, data: "abc"});
        });

        it("fails when too long", () => {
            const transform = refine(toString(), maxLength(3));
            const result = transform("K", "abcd", ctx);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx).toContain("maximum '3' length");
        });

        it("works with arrays", () => {
            const transform = refine(toStringArray(), maxLength(2));
            expect(transform("K", "a,b", ctx)).toEqual({ok: true, data: ["a", "b"]});
            expect(transform("K", "a,b,c", ctx).ok).toBe(false);
        });
    });

    describe("refine with wrappers", () => {
        it("withRequired + refine", () => {
            const result = loadEnv(opts([".env.basic"]), {
                PORT: withRequired(refine(toInt(), inRange(1, 65535))),
            });
            expect(result).toEqual({ok: true, data: {PORT: 3000}});
        });

        it("withRequired + refine fails on constraint", () => {
            const result = loadEnv(opts([".env.basic"]), {
                PORT: withRequired(refine(toInt(), inRange(1, 100))),
            });
            expect(result.ok).toBe(false);
        });

        it("withDefault + refine uses default for missing", () => {
            const result = loadEnv(opts([".env.missing"]), {
                ABSENT: withDefault(refine(toInt(), inRange(0, 100)), 50),
            });
            expect(result).toEqual({ok: true, data: {ABSENT: 50}});
        });

        it("withDefault + refine validates when present", () => {
            const result = loadEnv(opts([".env.basic"]), {
                PORT: withDefault(refine(toInt(), inRange(1, 100)), 50),
            });
            // PORT=3000 exceeds inRange(1, 100)
            expect(result.ok).toBe(false);
        });

        it("withDefault + refine passes when present and valid", () => {
            const result = loadEnv(opts([".env.basic"]), {
                PORT: withDefault(refine(toInt(), inRange(1, 65535)), 50),
            });
            expect(result).toEqual({ok: true, data: {PORT: 3000}});
        });

        it("withOptional + refine returns undefined for missing", () => {
            const result = loadEnv(opts([".env.missing"]), {
                ABSENT: withOptional(refine(toString(), nonEmpty())),
            });
            expect(result).toEqual({ok: true, data: {ABSENT: undefined}});
        });

        it("withOptional + refine validates when present", () => {
            const result = loadEnv(opts([".env.basic"]), {
                HOST: withOptional(refine(toString(), nonEmpty())),
            });
            expect(result).toEqual({ok: true, data: {HOST: "localhost"}});
        });

        it("withOptional + refine fails on constraint when present", () => {
            const result = loadEnv(opts([".env.empty-value"]), {
                EMPTY_KEY: withOptional(refine(toString(), nonEmpty())),
            });
            expect(result.ok).toBe(false);
        });

        it("refine with toStringArray + maxLength", () => {
            const result = loadEnv(opts([".env.complex"]), {
                TAGS: withRequired(refine(toStringArray(), maxLength(5))),
            });
            expect(result).toEqual({ok: true, data: {TAGS: ["foo", "bar", "baz"]}});
        });
    });

    describe("bare refine (no wrapper)", () => {
        it("passes when value is present and valid", () => {
            const result = loadEnv(opts([".env.basic"]), {
                PORT: refine(toInt(), inRange(1, 65535)),
            });
            expect(result).toEqual({ok: true, data: {PORT: 3000}});
        });

        it("fails when value is present and invalid", () => {
            const result = loadEnv(opts([".env.basic"]), {
                PORT: refine(toInt(), inRange(1, 100)),
            });
            expect(result.ok).toBe(false);
        });

        it("fails with 'no value provided' when key is missing", () => {
            const result = loadEnv(opts([".env.missing"]), {
                ABSENT: refine(toInt(), inRange(0, 100)),
            });
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx[0]!.message).toContain("no value provided");
        });
    });

    describe("refine with toEnum", () => {
        it("passes when value matches enum and check", () => {
            const result = loadEnv(opts([".env.custom"]), {
                LOG_LEVEL: refine(
                    toEnum("debug", "info", "warn", "error"),
                    minLength(4)
                ),
            });
            expect(result).toEqual({ok: true, data: {LOG_LEVEL: "debug"}});
        });

        it("fails when value matches enum but fails check", () => {
            const result = loadEnv(opts([".env.custom"]), {
                LOG_LEVEL: refine(
                    toEnum("debug", "info", "warn", "error"),
                    minLength(6)
                ),
            });
            // "debug" is 5 chars, fails minLength(6)
            expect(result.ok).toBe(false);
        });

        it("fails when value does not match enum", () => {
            const result = loadEnv(opts([".env.basic"]), {
                HOST: refine(
                    toEnum("debug", "info", "warn", "error"),
                    minLength(1)
                ),
            });
            // "localhost" is not in the enum
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx[0]!.message).toContain("expected one of");
        });
    });

    describe("custom RefineCheck", () => {
        it("custom check passes", () => {
            const isEven: RefineCheck<number> = (key, val) =>
                val % 2 === 0 ? success(val) : failure(`${key}: expected even, got ${val}`);

            const result = loadEnv(opts([".env.basic"]), {
                PORT: refine(toInt(), isEven),
            });
            // PORT=3000, which is even
            expect(result).toEqual({ok: true, data: {PORT: 3000}});
        });

        it("custom check fails with correct message", () => {
            const isOdd: RefineCheck<number> = (key, val) =>
                val % 2 !== 0 ? success(val) : failure(`${key}: expected odd, got ${val}`);

            const result = loadEnv(opts([".env.basic"]), {
                PORT: refine(toInt(), isOdd),
            });
            // PORT=3000, which is even
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.ctx[0]!.message).toContain("expected odd, got 3000");
        });

        it("custom check composes with wrappers", () => {
            const isPositive: RefineCheck<number> = (key, val) =>
                val > 0 ? success(val) : failure(`${key}: must be positive`);

            const result = loadEnv(opts([".env.missing"]), {
                ABSENT: withDefault(refine(toInt(), isPositive), 42),
            });
            expect(result).toEqual({ok: true, data: {ABSENT: 42}});
        });

        it("custom check on string transform", () => {
            const noSpaces: RefineCheck<string> = (key, val) =>
                val.includes(" ") ? failure(`${key}: must not contain spaces`) : success(val);

            const result = loadEnv(opts([".env.basic"]), {
                HOST: refine(toString(), noSpaces),
            });
            expect(result).toEqual({ok: true, data: {HOST: "localhost"}});
        });
    });
});
