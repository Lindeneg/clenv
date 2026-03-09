import {writeFileSync, mkdirSync, rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {describe, it, expect} from "vitest";
import {loadEnv, toString, withOptional} from "../index.js";

const fixtures = join(import.meta.dirname, "fixtures");
const opts = (files: string[], extra: Partial<Parameters<typeof loadEnv>[0]> = {}) =>
    ({files, transformKeys: false, basePath: fixtures, ...extra}) as const;

// ─── large files ────────────────────────────────────────────────────────────

describe("large files", () => {
    it("parses a 10,000-entry .env file", () => {
        const config: Record<string, typeof toString> = {};
        config.KEY_00001 = toString;
        config.KEY_05000 = toString;
        config.KEY_10000 = toString;

        const result = loadEnv(opts([".env.large"]), config);
        expect(result).toEqual({
            ok: true,
            data: {
                KEY_00001: "value_00001",
                KEY_05000: "value_05000",
                KEY_10000: "value_10000",
            },
        });
    });

    it("parses all 10,000 entries when requested", () => {
        const config: Record<string, typeof toString> = {};
        for (let i = 1; i <= 10000; i++) {
            config[`KEY_${String(i).padStart(5, "0")}`] = toString;
        }

        const result = loadEnv(opts([".env.large"]), config);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(Object.keys(result.data).length).toBe(10000);
        }
    });
});

// ─── fuzz testing ───────────────────────────────────────────────────────────

describe("fuzz", () => {
    // helper: generate random string
    function randStr(len: number) {
        const chars =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-. #${}='\"`\\\n\t";
        let s = "";
        for (let i = 0; i < len; i++) {
            s += chars[Math.floor(Math.random() * chars.length)];
        }
        return s;
    }

    // helper: generate valid key
    function randKey() {
        const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_";
        const alnum = alpha + "0123456789";
        let key = alpha[Math.floor(Math.random() * alpha.length)]!;
        const len = Math.floor(Math.random() * 20) + 1;
        for (let i = 0; i < len; i++) {
            key += alnum[Math.floor(Math.random() * alnum.length)]!;
        }
        return key;
    }

    it("parseDotenv never throws on random input (1000 chunks)", () => {
        const tmpDir = join(tmpdir(), "cl-env-fuzz");
        mkdirSync(tmpDir, {recursive: true});

        // write one large file with 1000 random chunks separated by newlines
        const chunks: string[] = [];
        for (let i = 0; i < 1000; i++) {
            chunks.push(randStr(Math.floor(Math.random() * 200)));
        }
        writeFileSync(join(tmpDir, ".env"), chunks.join("\n"), "utf8");

        // should never throw — parser should handle garbage
        expect(() => {
            loadEnv(
                {files: [".env"], transformKeys: false, basePath: tmpDir},
                {ANYTHING: withOptional(toString)}
            );
        }).not.toThrow();

        rmSync(tmpDir, {recursive: true, force: true});
    });

    it("well-formed KEY=VALUE always produces an entry", () => {
        const tmpDir = join(tmpdir(), "cl-env-fuzz-kv");
        mkdirSync(tmpDir, {recursive: true});

        // generate 200 entries in a single file, then verify each
        const entries: Array<{key: string; value: string}> = [];
        const lines: string[] = [];
        for (let i = 0; i < 200; i++) {
            const key = `${randKey()}_${i}`; // suffix to avoid duplicates
            const value = `simple_value_${i}`;
            entries.push({key, value});
            lines.push(`${key}=${value}`);
        }
        writeFileSync(join(tmpDir, ".env"), lines.join("\n") + "\n", "utf8");

        const config: Record<string, typeof toString> = {};
        for (const e of entries) config[e.key] = toString;

        const result = loadEnv({files: [".env"], transformKeys: false, basePath: tmpDir}, config);
        expect(result.ok).toBe(true);
        if (result.ok) {
            for (const e of entries) {
                expect((result.data as any)[e.key]).toBe(e.value);
            }
        }

        rmSync(tmpDir, {recursive: true, force: true});
    });

    it("heavy $expansion input does not cause stack overflow", () => {
        const tmpDir = join(tmpdir(), "cl-env-fuzz-expand");
        mkdirSync(tmpDir, {recursive: true});

        // generate entries where every value references the previous
        const lines: string[] = ["BASE=start"];
        for (let i = 1; i <= 500; i++) {
            lines.push(`V${i}=$V${i - 1}_suffix`);
        }
        // add lots of unresolved refs
        for (let i = 0; i < 100; i++) {
            lines.push(`MISS_${i}=$NONEXISTENT_${i}`);
        }
        writeFileSync(join(tmpDir, ".env"), lines.join("\n") + "\n", "utf8");

        const config: Record<string, typeof toString> = {BASE: toString, V500: toString};
        expect(() => {
            loadEnv({files: [".env"], transformKeys: false, basePath: tmpDir}, config);
        }).not.toThrow();

        rmSync(tmpDir, {recursive: true, force: true});
    });
});
