import {join} from "node:path";

import {describe, it, expect, vi} from "vitest";
import {
    loadEnv,
    toString,
    toInt,
    withDefault,
    type Logger,
    type LogLevel,
} from "../index.js";

const fixtures = join(import.meta.dirname, "fixtures");
const opts = (files: string[], extra: Partial<Parameters<typeof loadEnv>[0]> = {}) =>
    ({files, transformKeys: false, basePath: fixtures, ...extra}) as const;

// ─── logging ────────────────────────────────────────────────────────────────

describe("logging", () => {
    function capture() {
        const messages: Array<{level: LogLevel; message: string}> = [];
        const logger: Logger = (level, message) => messages.push({level, message});
        return {messages, logger};
    }

    it("calls custom logger function", () => {
        const {messages, logger} = capture();
        loadEnv(opts([".env.basic"], {logger}), {HOST: toString});

        expect(messages.some((m) => m.level === "verbose")).toBe(true);
        expect(messages.some((m) => m.level === "debug")).toBe(true);
    });

    it("logger: true uses default logger (does not throw)", () => {
        const spyLog = vi.spyOn(console, "log").mockImplementation(() => {});
        const spyDebug = vi.spyOn(console, "debug").mockImplementation(() => {});
        const spyWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const spyError = vi.spyOn(console, "error").mockImplementation(() => {});
        loadEnv(
            {files: [".env.basic"], transformKeys: false, basePath: fixtures, logger: true},
            {HOST: toString}
        );
        spyLog.mockRestore();
        spyDebug.mockRestore();
        spyWarn.mockRestore();
        spyError.mockRestore();
    });

    it("logs duplicate key warnings with source info", () => {
        const {messages, logger} = capture();
        loadEnv(opts([".env.duplicate"], {logger}), {KEY: toString, OTHER: toString});

        const dupWarning = messages.find(
            (m) => m.level === "warn" && m.message.includes("duplicate key")
        );
        expect(dupWarning).toBeDefined();
        expect(dupWarning!.message).toContain("overwriting");
        expect(dupWarning!.message).toContain(".env.duplicate");
    });

    it("logs duplicate key warnings across layered files", () => {
        const {messages, logger} = capture();
        loadEnv(
            {
                files: [".env.layered.base", ".env.layered.local"],
                transformKeys: false,
                basePath: fixtures,
                logger,
            },
            {PORT: toString, DEBUG: toString}
        );

        const dupWarnings = messages.filter(
            (m) => m.level === "warn" && m.message.includes("duplicate key")
        );
        expect(dupWarnings.length).toBeGreaterThan(0);
        // should mention both source files
        const portWarning = dupWarnings.find((m) => m.message.includes("PORT"));
        expect(portWarning).toBeDefined();
        expect(portWarning!.message).toContain(".env.layered.base");
        expect(portWarning!.message).toContain(".env.layered.local");
    });

    it("logs unknown key warnings with source info", () => {
        const {messages, logger} = capture();
        loadEnv(opts([".env.basic"], {logger}), {HOST: toString});

        const unknownWarnings = messages.filter(
            (m) => m.level === "warn" && m.message.includes("not a known key")
        );
        expect(unknownWarnings.length).toBeGreaterThan(0);
        expect(unknownWarnings[0]!.message).toContain(".env.basic");
    });

    it("logs success summary", () => {
        const {messages, logger} = capture();
        loadEnv(opts([".env.basic"], {logger}), {HOST: toString, PORT: toInt});

        const summary = messages.find(
            (m) => m.level === "debug" && m.message.includes("successfully loaded")
        );
        expect(summary).toBeDefined();
        expect(summary!.message).toBe("successfully loaded 2 vars");
    });

    it("logs expansion with source info", () => {
        const {messages, logger} = capture();
        loadEnv(opts([".env.expansion"], {logger}), {
            HOST: toString,
            PORT: toString,
            URL: toString,
        });

        const expandLog = messages.find(
            (m) => m.level === "verbose" && m.message.includes("expanded")
        );
        expect(expandLog).toBeDefined();
        expect(expandLog!.message).toContain(".env.expansion");
    });

    it("warns on unresolved variable expansion", () => {
        delete process.env.CLENV_UNDEFINED_VAR;
        const {messages, logger} = capture();
        loadEnv(opts([".env.expansion"], {logger}), {MISSING_REF: toString});

        const unresolved = messages.find(
            (m) => m.level === "warn" && m.message.includes("not defined, left unexpanded")
        );
        expect(unresolved).toBeDefined();
        expect(unresolved!.message).toContain("$CLENV_UNDEFINED_VAR");
    });

    it("logs default values at debug level", () => {
        const {messages, logger} = capture();
        loadEnv(opts([".env.missing"], {logger}), {
            PRESENT: toString,
            ABSENT: withDefault(toInt, 9999),
        });

        const defaultLog = messages.find(
            (m) =>
                m.level === "debug" &&
                m.message.includes("not found in any file, using default")
        );
        expect(defaultLog).toBeDefined();
    });

    it("logs process.env merge mode", () => {
        const {messages, logger} = capture();
        loadEnv(
            {
                files: [".env.basic"],
                transformKeys: false,
                basePath: fixtures,
                logger,
                includeProcessEnv: "fallback",
            },
            {HOST: toString}
        );

        const mergeLog = messages.find(
            (m) => m.level === "debug" && m.message.includes("merging process.env as fallback")
        );
        expect(mergeLog).toBeDefined();
    });

    it("logs process.env overwrite with source info", () => {
        process.env.HOST = "overwritten";
        const {messages, logger} = capture();
        loadEnv(
            {
                files: [".env.basic"],
                transformKeys: false,
                basePath: fixtures,
                logger,
                includeProcessEnv: "override",
            },
            {HOST: toString}
        );
        delete process.env.HOST;

        const overwriteLog = messages.find(
            (m) => m.level === "verbose" && m.message.includes("process.env") && m.message.includes("overrides")
        );
        expect(overwriteLog).toBeDefined();
    });

    it("default logger pads tags to equal width", () => {
        const spyLog = vi.spyOn(console, "log").mockImplementation(() => {});
        const spyDebug = vi.spyOn(console, "debug").mockImplementation(() => {});
        const spyWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const spyError = vi.spyOn(console, "error").mockImplementation(() => {});

        loadEnv(
            {files: [".env.basic"], transformKeys: false, basePath: fixtures, logger: true},
            {HOST: toString}
        );

        // collect all formatted messages across all console methods
        const allCalls = [
            ...spyLog.mock.calls,
            ...spyDebug.mock.calls,
            ...spyWarn.mock.calls,
            ...spyError.mock.calls,
        ].map((args) => args[0] as string);

        spyLog.mockRestore();
        spyDebug.mockRestore();
        spyWarn.mockRestore();
        spyError.mockRestore();

        expect(allCalls.length).toBeGreaterThan(0);

        // strip ANSI codes, then check that all tags + padding have the same width
        const stripped = allCalls.map((s) => s.replace(/\x1b\[[0-9;]*m/g, ""));
        const tagWidths = stripped.map((s) => {
            const match = s.match(/^\[cl-env:\w+\]\s*/);
            return match ? match[0].length : -1;
        });
        // all tags should be present and padded to 17 chars ("[cl-env:verbose] ")
        for (const w of tagWidths) {
            expect(w).toBe(17);
        }
    });

    it("default logger uses ANSI colors per level", () => {
        const spyLog = vi.spyOn(console, "log").mockImplementation(() => {});
        const spyDebug = vi.spyOn(console, "debug").mockImplementation(() => {});
        const spyWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const spyError = vi.spyOn(console, "error").mockImplementation(() => {});

        loadEnv(
            {files: [".env.basic"], transformKeys: false, basePath: fixtures, logger: true},
            {HOST: toString}
        );

        // verbose goes to console.log — should have dim (\x1b[2m)
        if (spyLog.mock.calls.length > 0) {
            expect(spyLog.mock.calls[0]![0]).toContain("\x1b[2m");
        }
        // warn goes to console.warn — should have yellow (\x1b[33m)
        if (spyWarn.mock.calls.length > 0) {
            expect(spyWarn.mock.calls[0]![0]).toContain("\x1b[33m");
        }
        // debug goes to console.debug — should have cyan (\x1b[36m)
        if (spyDebug.mock.calls.length > 0) {
            expect(spyDebug.mock.calls[0]![0]).toContain("\x1b[36m");
        }

        // all messages should end their color with reset
        const allCalls = [
            ...spyLog.mock.calls,
            ...spyDebug.mock.calls,
            ...spyWarn.mock.calls,
            ...spyError.mock.calls,
        ].map((args) => args[0] as string);

        for (const msg of allCalls) {
            expect(msg).toContain("\x1b[0m");
        }

        spyLog.mockRestore();
        spyDebug.mockRestore();
        spyWarn.mockRestore();
        spyError.mockRestore();
    });

    it("default logger output matches expected format exactly", () => {
        const spyLog = vi.spyOn(console, "log").mockImplementation(() => {});
        const spyDebug = vi.spyOn(console, "debug").mockImplementation(() => {});
        const spyWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const spyError = vi.spyOn(console, "error").mockImplementation(() => {});

        loadEnv(
            {files: [".env.basic"], transformKeys: false, basePath: fixtures, logger: true},
            {HOST: toString}
        );

        const allCalls = [
            ...spyLog.mock.calls,
            ...spyDebug.mock.calls,
            ...spyWarn.mock.calls,
            ...spyError.mock.calls,
        ].map((args) => args[0] as string);

        spyLog.mockRestore();
        spyDebug.mockRestore();
        spyWarn.mockRestore();
        spyError.mockRestore();

        // strip ANSI to get readable output
        const lines = allCalls.map((s) => s.replace(/\x1b\[[0-9;]*m/g, ""));

        // check a verbose line (parsed .env)
        const parsedLine = lines.find((l) => l.includes("parsed .env.basic"));
        expect(parsedLine).toBe("[cl-env:verbose] parsed .env.basic: 4 entries");

        // check a debug line (success summary)
        const summaryLine = lines.find((l) => l.includes("successfully loaded"));
        expect(summaryLine).toBe("[cl-env:debug]   successfully loaded 1 vars");

        // check a warn line (unknown keys)
        const warnLine = lines.find((l) => l.includes("not a known key"));
        expect(warnLine).toMatch(/^\[cl-env:warn\]\s{4}/);
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
