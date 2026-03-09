import {join} from "node:path";

import {describe, it, expect} from "vitest";
import {
    loadEnv,
    unwrap,
    toString,
    toInt,
    toBool,
    withDefault,
    withRequired,
    failure,
} from "../index.js";

const fixtures = join(import.meta.dirname, "fixtures");
const opts = (files: string[], extra: Partial<Parameters<typeof loadEnv>[0]> = {}) =>
    ({files, transformKeys: false, basePath: fixtures, ...extra}) as const;

// ─── error handling ─────────────────────────────────────────────────────────

describe("error handling", () => {
    it("returns failure for nonexistent file", () => {
        const result = loadEnv(
            {files: ["does-not-exist.env"], transformKeys: false, basePath: fixtures},
            {FOO: toString}
        );
        expect(result.ok).toBe(false);
    });

    it("includes source and line in transform errors", () => {
        // HOST is on line 1 of .env.basic, value "localhost" fails toInt
        const result = loadEnv(opts([".env.basic"]), {HOST: toInt});
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.ctx[0]).toMatchObject({
                key: "HOST",
                source: ".env.basic",
                line: 1,
            });
            expect(result.ctx[0]!.message).toContain("failed to convert 'localhost' to a number");
        }
    });

    it("catches transform that throws and formats error message", () => {
        const result = loadEnv(opts([".env.basic"]), {
            HOST: () => {
                throw new Error("boom");
            },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.ctx[0]).toMatchObject({
                key: "HOST",
                source: ".env.basic",
                line: 1,
            });
            expect(result.ctx[0]!.message).toContain("transform function threw");
            expect(result.ctx[0]!.message).toContain("boom");
            // should use err.message, not toString of Error object
            expect(result.ctx[0]!.message).not.toContain("[object");
        }
    });

    it("catches transform that throws non-Error and stringifies", () => {
        const result = loadEnv(opts([".env.basic"]), {
            HOST: () => {
                throw "raw string error";
            },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.ctx[0]!.message).toContain("raw string error");
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
            expect(result.ctx[0]!.key).toBe("HOST");
            expect(result.ctx[1]!.key).toBe("MISSING");
        }
    });

    it("exact EnvError for transform failure with source and line", () => {
        const result = loadEnv(opts([".env.basic"]), {HOST: toInt});
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.ctx[0]).toEqual({
                key: "HOST",
                source: ".env.basic",
                line: 1,
                message: "HOST: failed to convert 'localhost' to a number",
            });
        }
    });

    it("exact EnvError for missing key (no source, no line)", () => {
        const result = loadEnv(opts([".env.basic"]), {NOPE: withRequired(toString)});
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.ctx[0]).toEqual({
                key: "NOPE",
                source: "none",
                message: "NOPE: is required but is missing",
            });
        }
    });

    it("exact EnvError for thrown transform", () => {
        const result = loadEnv(opts([".env.basic"]), {
            HOST: () => {
                throw new Error("boom");
            },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.ctx[0]).toEqual({
                key: "HOST",
                source: ".env.basic",
                line: 1,
                message: "transform function threw: boom",
            });
        }
    });

    it("exact EnvError for nonexistent file", () => {
        const result = loadEnv(
            {files: ["does-not-exist.env"], transformKeys: false, basePath: fixtures},
            {FOO: toString}
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.ctx[0]!.key).toBe("does-not-exist.env");
            expect(result.ctx[0]!.source).toBe("does-not-exist.env");
            expect(result.ctx[0]!.message).toContain("failed to read");
        }
    });

    it("errors from layered files reference winning entry's source", () => {
        // PORT=8080 is on line 1 of .env.layered.local (this one wins)
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
            expect(result.ctx[0]).toMatchObject({
                key: "PORT",
                source: ".env.layered.local",
                line: 1,
            });
        }
    });
});

// ─── unwrap error messages ──────────────────────────────────────────────────

describe("unwrap error messages", () => {
    it("formats error with source and line", () => {
        expect(() => unwrap(loadEnv(opts([".env.basic"]), {HOST: toInt}))).toThrow(
            ".env.basic:L1: HOST: failed to convert 'localhost' to a number"
        );
    });

    it("formats error without source for missing keys", () => {
        expect(() =>
            unwrap(loadEnv(opts([".env.basic"]), {NOPE: withRequired(toString)}))
        ).toThrow("NOPE: is required but is missing");
    });

    it("does not prefix 'none:' for missing key errors", () => {
        try {
            unwrap(loadEnv(opts([".env.basic"]), {NOPE: withRequired(toString)}));
        } catch (e: any) {
            expect(e.message).not.toContain("none:");
        }
    });

    it("does not duplicate key name in message", () => {
        try {
            unwrap(loadEnv(opts([".env.basic"]), {HOST: toInt}));
        } catch (e: any) {
            // should be ".env.basic:L1: HOST: failed to ..."
            // not ".env.basic:L1: HOST: HOST: failed to ..."
            const matches = e.message.match(/HOST:/g);
            expect(matches).toHaveLength(1);
        }
    });

    it("joins multiple errors with newlines", () => {
        try {
            unwrap(
                loadEnv(opts([".env.basic"]), {
                    HOST: toInt,
                    MISSING: withRequired(toString),
                })
            );
        } catch (e: any) {
            const lines = e.message.trimStart().split("\n");
            expect(lines).toHaveLength(2);
            expect(lines[0]).toBe(
                ".env.basic:L1: HOST: failed to convert 'localhost' to a number"
            );
            expect(lines[1]).toBe("MISSING: is required but is missing");
        }
    });

    it("formats bare transform 'no value provided' without source prefix", () => {
        expect(() =>
            unwrap(loadEnv(opts([".env.basic"]), {NOPE: toBool}))
        ).toThrow("NOPE: no value provided (use withDefault or withRequired)");
    });

    it("formats error from nonexistent file", () => {
        try {
            unwrap(
                loadEnv(
                    {files: ["does-not-exist.env"], transformKeys: false, basePath: fixtures},
                    {FOO: toString}
                )
            );
        } catch (e: any) {
            expect(e.message).toContain("failed to read");
            expect(e.message).not.toContain("none:");
        }
    });

    it("realistic multi-file scenario with mixed error types", () => {
        try {
            unwrap(
                loadEnv(opts([".env.basic"]), {
                    HOST: toInt,
                    PORT: withDefault(toInt, 3000),
                    MISSING_REQ: withRequired(toString),
                    MISSING_BARE: toBool,
                })
            );
        } catch (e: any) {
            const lines = e.message.trimStart().split("\n");
            expect(lines).toHaveLength(3);
            // HOST fails transform — has source and line
            expect(lines[0]).toBe(
                ".env.basic:L1: HOST: failed to convert 'localhost' to a number"
            );
            // MISSING_REQ — no source
            expect(lines[1]).toBe("MISSING_REQ: is required but is missing");
            // MISSING_BARE — no source
            expect(lines[2]).toBe(
                "MISSING_BARE: no value provided (use withDefault or withRequired)"
            );
        }
    });
});
