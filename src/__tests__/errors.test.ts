import {join} from "node:path";

import {describe, it, expect} from "vitest";
import {
    loadEnv,
    toString,
    toInt,
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
            expect(result.ctx[0]).toMatch(/\.env\.basic:L1: HOST/);
            expect(result.ctx[0]).toContain("failed to convert 'localhost' to a number");
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
            expect(result.ctx[0]).toMatch(/\.env\.basic:L1: HOST/);
            expect(result.ctx[0]).toContain("transform function threw");
            expect(result.ctx[0]).toContain("boom");
            // should use err.message, not toString of Error object
            expect(result.ctx[0]).not.toContain("[object");
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
            expect(result.ctx[0]).toContain("raw string error");
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
            expect(result.ctx[0]).toMatch(/\.env\.layered\.local:L1: PORT/);
        }
    });
});
