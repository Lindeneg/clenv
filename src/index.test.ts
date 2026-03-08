import fs from "node:fs";
import nodePath from "node:path";
import {describe, it, expect, vi, beforeEach} from "vitest";
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
} from "./index.js";

const mockReadFileSync = vi.spyOn(fs, "readFileSync");
const mockPathJoin = vi.spyOn(nodePath, "join");

function envFile(...lines: string[]): string {
    return lines.join("\n");
}

function mockFile(content: string) {
    mockReadFileSync.mockReturnValue(content);
}

beforeEach(() => {
    mockReadFileSync.mockReset();
    mockPathJoin.mockReset();
});

describe("loadEnv", () => {
    it("type infers correctly", () => {
        mockFile(
            envFile(
                "FOO_BAR=hello",
                'BAR_BAZ={"hello": "there", "there": 0, "general": false, "kenobi": ["foo"]}',
                "BAZ_QUX=5",
                "BOOL=true",
                "QUX=x,y",
                "NUMBERS=3-1-4"
            )
        );
        type SomeType = {
            hello: string;
            there: number;
            general: boolean;
            kenobi: string[];
        };

        const env = {
            FOO_BAR: withDefault(toString, "fooBar"),
            BAR_BAZ: withRequired(toJSON<SomeType>()),
            BAZ_QUX: toInt,
            BOOL: toBool,
            QUX: toStringArray(),
            NUMBERS: toIntArray("-"),
        };

        const result = unwrap(loadEnv({path: ".env", transformKeys: false}, env));
        const resultTransformKeys = unwrap(loadEnv({path: ".env", transformKeys: true}, env));

        expect(result).toEqual({
            FOO_BAR: "hello",
            BAR_BAZ: {hello: "there", there: 0, general: false, kenobi: ["foo"]},
            BAZ_QUX: 5,
            BOOL: true,
            QUX: ["x", "y"],
            NUMBERS: [3, 1, 4],
        });

        expect(resultTransformKeys).toEqual({
            fooBar: "hello",
            barBaz: {hello: "there", there: 0, general: false, kenobi: ["foo"]},
            bazQux: 5,
            bool: true,
            qux: ["x", "y"],
            numbers: [3, 1, 4],
        });

        type assertion1 = Expect<
            Equal<
                typeof result,
                {
                    FOO_BAR: string;
                    BAR_BAZ: SomeType;
                    BAZ_QUX: number;
                    BOOL: boolean;
                    QUX: string[];
                    NUMBERS: number[];
                }
            >
        >;

        type assertion2 = Expect<
            Equal<
                typeof resultTransformKeys,
                {
                    fooBar: string;
                    barBaz: SomeType;
                    bazQux: number;
                    bool: boolean;
                    qux: string[];
                    numbers: number[];
                }
            >
        >;
    });

    describe("parsing", () => {
        it("parses KEY=VALUE pairs", () => {
            mockFile(envFile("FOO=hello", "BAR=world"));
            const result = loadEnv(
                {path: ".env", transformKeys: false},
                {FOO: toString, BAR: toString}
            );
            expect(result).toEqual({
                ok: true,
                data: {FOO: "hello", BAR: "world"},
            });
        });

        it("handles values containing equals signs", () => {
            mockFile(envFile("URL=postgres://host:5432/db?opt=1"));
            const result = loadEnv({path: ".env", transformKeys: false}, {URL: toString});
            expect(result).toEqual({
                ok: true,
                data: {URL: "postgres://host:5432/db?opt=1"},
            });
        });

        it("trims whitespace from keys and values", () => {
            mockFile(envFile("  FOO  =  bar  "));
            const result = loadEnv({path: ".env", transformKeys: false}, {FOO: toString});
            expect(result).toEqual({ok: true, data: {FOO: "bar"}});
        });

        it("skips empty lines and lines without =", () => {
            mockFile(envFile("  ", "FOO=bar", "", "not a valid line", "BAR=baz", ""));
            const result = loadEnv(
                {path: ".env", transformKeys: false},
                {FOO: toString, BAR: toString}
            );
            expect(result).toEqual({
                ok: true,
                data: {FOO: "bar", BAR: "baz"},
            });
        });

        it("ignores keys not present in config", () => {
            mockFile(envFile("FOO=bar", "UNKNOWN=ignored"));
            const result = loadEnv({path: ".env", transformKeys: false}, {FOO: toString});
            expect(result).toEqual({ok: true, data: {FOO: "bar"}});
        });

        it("accepts path as an array (joined with path.join)", () => {
            mockFile(envFile("A=1"));
            loadEnv({path: ["home", "user", ".env"], transformKeys: false}, {A: toString});
            expect(mockPathJoin).toHaveBeenCalledWith("home", "user", ".env");
        });

        it("does not call path.join if path is a string", () => {
            mockFile(envFile("A=1"));
            loadEnv({path: "/miles/davis/.env", transformKeys: false}, {A: toString});
            expect(mockPathJoin).toHaveBeenCalledTimes(0);
            expect(mockReadFileSync).toHaveBeenCalledWith("/miles/davis/.env", {encoding: "utf8"});
        });
    });

    describe("quote handling", () => {
        it("strips surrounding double quotes", () => {
            mockFile(envFile('FOO="hello world"'));
            const result = loadEnv({path: ".env", transformKeys: false}, {FOO: toString});
            expect(result).toEqual({ok: true, data: {FOO: "hello world"}});
        });

        it("strips surrounding single quotes", () => {
            mockFile(envFile("FOO='hello world'"));
            const result = loadEnv({path: ".env", transformKeys: false}, {FOO: toString});
            expect(result).toEqual({ok: true, data: {FOO: "hello world"}});
        });

        it("strips surrounding backticks", () => {
            mockFile(envFile("FOO=`hello world`"));
            const result = loadEnv({path: ".env", transformKeys: false}, {FOO: toString});
            expect(result).toEqual({ok: true, data: {FOO: "hello world"}});
        });

        it("does not strip mismatched quotes", () => {
            mockFile(envFile("FOO=\"hello world'"));
            const result = loadEnv({path: ".env", transformKeys: false}, {FOO: toString});
            expect(result).toEqual({ok: true, data: {FOO: "\"hello world'"}});
        });

        it("quotes are stripped before transform runs", () => {
            mockFile(envFile('BOOL="true"', "INT='42'", "FLOAT=`3.14`"));
            const result = loadEnv(
                {path: ".env", transformKeys: false},
                {BOOL: toBool, INT: toInt, FLOAT: toFloat}
            );
            expect(result).toEqual({
                ok: true,
                data: {BOOL: true, INT: 42, FLOAT: 3.14},
            });
        });
    });

    describe("escape expansion", () => {
        it("expands \\n to newline inside double quotes", () => {
            mockFile(envFile('FOO="line1\\nline2"'));
            const result = loadEnv({path: ".env", transformKeys: false}, {FOO: toString});
            expect(result).toEqual({ok: true, data: {FOO: "line1\nline2"}});
        });

        it("expands \\r to carriage return inside double quotes", () => {
            mockFile(envFile('FOO="line1\\rline2"'));
            const result = loadEnv({path: ".env", transformKeys: false}, {FOO: toString});
            expect(result).toEqual({ok: true, data: {FOO: "line1\rline2"}});
        });

        it("does NOT expand \\n inside single quotes", () => {
            mockFile(envFile("FOO='line1\\nline2'"));
            const result = loadEnv({path: ".env", transformKeys: false}, {FOO: toString});
            expect(result).toEqual({ok: true, data: {FOO: "line1\\nline2"}});
        });

        it("does NOT expand \\n inside backticks", () => {
            mockFile(envFile("FOO=`line1\\nline2`"));
            const result = loadEnv({path: ".env", transformKeys: false}, {FOO: toString});
            expect(result).toEqual({ok: true, data: {FOO: "line1\\nline2"}});
        });
    });

    describe("line ending normalization", () => {
        it("handles \\r\\n line endings", () => {
            mockFile("FOO=bar\r\nBAR=baz");
            const result = loadEnv(
                {path: ".env", transformKeys: false},
                {FOO: toString, BAR: toString}
            );
            expect(result).toEqual({ok: true, data: {FOO: "bar", BAR: "baz"}});
        });

        it("handles bare \\r line endings", () => {
            mockFile("FOO=bar\rBAR=baz");
            const result = loadEnv(
                {path: ".env", transformKeys: false},
                {FOO: toString, BAR: toString}
            );
            expect(result).toEqual({ok: true, data: {FOO: "bar", BAR: "baz"}});
        });
    });

    describe("withRequired", () => {
        it("returns failure when value is empty", () => {
            mockFile(envFile("FOO="));
            const result = loadEnv(
                {path: ".env", transformKeys: false},
                {FOO: withRequired(toString)}
            );
            expect(result).toEqual({
                ok: false,
                ctx: ["FOO: is required but is missing"],
            });
        });

        it("returns failure when key is missing from file", () => {
            mockFile(envFile("OTHER=value"));
            const result = loadEnv(
                {path: ".env", transformKeys: false},
                {FOO: withRequired(toString)}
            );
            expect(result).toEqual({
                ok: false,
                ctx: ["FOO: is required but is missing"],
            });
        });

        it("passes through to inner transform when value is present", () => {
            mockFile(envFile("PORT=8080"));
            const result = loadEnv(
                {path: ".env", transformKeys: false},
                {PORT: withRequired(toInt)}
            );
            expect(result).toEqual({ok: true, data: {PORT: 8080}});
        });
    });

    describe("withDefault", () => {
        it("returns default when value is empty", () => {
            mockFile(envFile("PORT="));
            const result = loadEnv(
                {path: ".env", transformKeys: false},
                {PORT: withDefault(toInt, 3000)}
            );
            expect(result).toEqual({ok: true, data: {PORT: 3000}});
        });

        it("returns default when key is missing from file", () => {
            mockFile(envFile("OTHER=value"));
            const result = loadEnv(
                {path: ".env", transformKeys: false},
                {PORT: withDefault(toInt, 3000)}
            );
            expect(result).toEqual({ok: true, data: {PORT: 3000}});
        });

        it("uses file value via transform when present", () => {
            mockFile(envFile("PORT=8080"));
            const result = loadEnv(
                {path: ".env", transformKeys: false},
                {PORT: withDefault(toInt, 3000)}
            );
            expect(result).toEqual({ok: true, data: {PORT: 8080}});
        });

        it("applies transformKeys to default values for missing keys", () => {
            mockFile(envFile("OTHER=value"));
            const result = loadEnv(
                {path: ".env", transformKeys: true},
                {MY_PORT: withDefault(toInt, 3000)}
            );
            expect(result).toEqual({ok: true, data: {myPort: 3000}});
        });
    });

    describe("missing keys without wrappers", () => {
        it("plain toString succeeds with empty string for missing key", () => {
            mockFile(envFile("OTHER=value"));
            const result = loadEnv({path: ".env", transformKeys: false}, {FOO: toString});
            expect(result).toEqual({ok: true, data: {FOO: ""}});
        });
    });

    describe("toString", () => {
        it("returns the value as-is", () => {
            expect(toString("KEY", "hello")).toEqual({ok: true, data: "hello"});
        });
    });

    describe("toInt", () => {
        it("parses a valid integer", () => {
            expect(toInt("KEY", "42")).toEqual({ok: true, data: 42});
        });

        it("fails on non-numeric string", () => {
            expect(toInt("PORT", "abc")).toEqual({
                ok: false,
                ctx: "PORT: failed to convert 'abc' to a number",
            });
        });
    });

    describe("toFloat", () => {
        it("parses a valid float", () => {
            expect(toFloat("KEY", "3.14")).toEqual({ok: true, data: 3.14});
        });

        it("fails on non-numeric string", () => {
            expect(toFloat("RATE", "abc")).toEqual({
                ok: false,
                ctx: "RATE: failed to convert 'abc' to a number",
            });
        });
    });

    describe("toBool", () => {
        it('returns true for "true"', () => {
            expect(toBool("KEY", "true")).toEqual({ok: true, data: true});
        });

        it('returns true for "TRUE"', () => {
            expect(toBool("KEY", "TRUE")).toEqual({ok: true, data: true});
        });

        it('returns true for "1"', () => {
            expect(toBool("KEY", "1")).toEqual({ok: true, data: true});
        });

        it("returns false for anything else", () => {
            expect(toBool("KEY", "false")).toEqual({ok: true, data: false});
            expect(toBool("KEY", "0")).toEqual({ok: true, data: false});
            expect(toBool("KEY", "nope")).toEqual({
                ok: false,
                ctx: "KEY: expected boolean, got 'nope'",
            });
        });
    });

    describe("toJSON", () => {
        it("parses valid JSON", () => {
            const parse = toJSON<{id: number}>();
            expect(parse("KEY", '{"id":1}')).toEqual({ok: true, data: {id: 1}});
        });

        it("fails on invalid JSON", () => {
            const parse = toJSON();
            expect(parse("CFG", "not json")).toEqual({
                ok: false,
                ctx: "CFG: failed to convert to JSON",
            });
        });
    });

    describe("transform errors", () => {
        it("reports transform failure via Result", () => {
            mockFile(envFile("BAD=notanumber"));
            const result = loadEnv({path: ".env", transformKeys: false}, {BAD: toInt});
            expect(result).toEqual({
                ok: false,
                ctx: ["BAD: failed to convert 'notanumber' to a number"],
            });
        });

        it("catches transform that throws and reports it", () => {
            mockFile(envFile("BAD=value"));
            const result = loadEnv(
                {path: ".env", transformKeys: false},
                {
                    BAD: () => {
                        throw new Error("unexpected crash");
                    },
                }
            );
            expect(result).toEqual({
                ok: false,
                ctx: ["BAD: transform function threw: Error: unexpected crash"],
            });
        });

        it("accumulates multiple errors", () => {
            mockFile(envFile("A=notnum", "C=5"));
            const result = loadEnv(
                {path: ".env", transformKeys: false},
                {
                    A: toInt,
                    B: withRequired(toString),
                    C: withRequired(toInt),
                }
            );
            expect(result).toEqual({
                ok: false,
                ctx: ["A: failed to convert 'notnum' to a number", "B: is required but is missing"],
            });
        });
    });

    describe("readFile error", () => {
        it("returns failure when file cannot be read", () => {
            mockReadFileSync.mockImplementation(() => {
                throw new Error("ENOENT: no such file or directory");
            });
            const result = loadEnv(
                {path: "/nonexistent/.env", transformKeys: false},
                {FOO: toString}
            );
            expect(result).toEqual({
                ok: false,
                ctx: ["ENOENT: no such file or directory"],
            });
        });
    });

    describe("transformKeys", () => {
        it("converts UPPER_SNAKE_CASE keys to camelCase when transformKeys is true", () => {
            mockFile(envFile("FOO=1", "FOO_BAR=2", "FOO_BAR_BAZ=3"));
            const result = loadEnv(
                {path: ".env", transformKeys: true},
                {FOO: toString, FOO_BAR: toString, FOO_BAR_BAZ: toString}
            );
            expect(result).toEqual({
                ok: true,
                data: {foo: "1", fooBar: "2", fooBarBaz: "3"},
            });
            if (result.ok) {
                type assertion = Expect<
                    Equal<
                        typeof result.data,
                        {
                            foo: string;
                            fooBar: string;
                            fooBarBaz: string;
                        }
                    >
                >;
            }
        });

        it("leaves mixed-case keys untouched when transformKeys is true", () => {
            mockFile(envFile("FOO_BAR=1", "helloThere=greetings", "blablabla=bla"));
            const result = loadEnv(
                {path: ".env", transformKeys: true},
                {FOO_BAR: toString, blablabla: toString, helloThere: toString}
            );
            expect(result).toEqual({
                ok: true,
                data: {fooBar: "1", helloThere: "greetings", blablabla: "bla"},
            });
            if (result.ok) {
                type assertion = Expect<
                    Equal<
                        typeof result.data,
                        {
                            fooBar: string;
                            helloThere: string;
                            blablabla: string;
                        }
                    >
                >;
            }
        });

        it("does not transform keys when transformKeys is false", () => {
            mockFile(envFile("FOO_BAR=hello"));
            const result = loadEnv({path: ".env", transformKeys: false}, {FOO_BAR: toString});
            expect(result).toEqual({
                ok: true,
                data: {FOO_BAR: "hello"},
            });
            if (result.ok) {
                type assertion = Expect<
                    Equal<
                        typeof result.data,
                        {
                            FOO_BAR: string;
                        }
                    >
                >;
            }
        });
    });

    describe("encoding", () => {
        it("defaults to utf8 encoding", () => {
            mockFile(envFile("A=1"));
            loadEnv({path: ".env", transformKeys: false}, {A: toString});
            expect(mockReadFileSync).toHaveBeenCalledWith(".env", {encoding: "utf8"});
        });

        it("uses custom encoding when specified", () => {
            mockFile(envFile("A=1"));
            loadEnv({path: ".env", transformKeys: false, encoding: "latin1"}, {A: toString});
            expect(mockReadFileSync).toHaveBeenCalledWith(".env", {encoding: "latin1"});
        });
    });
});
