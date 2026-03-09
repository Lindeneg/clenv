import {join} from "node:path";
import {describe, it, expect} from "vitest";
import {Expect, Equal} from "type-testing";
import {
    loadEnv,
    unwrap,
    toString,
    toInt,
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
    type Result,
} from "../index.js";

const fixtures = join(import.meta.dirname, "fixtures");
const opts = (files: string[], extra: Partial<Parameters<typeof loadEnv>[0]> = {}) =>
    ({files, transformKeys: false, basePath: fixtures, ...extra}) as const;

// ─── type inference ─────────────────────────────────────────────────────────

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

    it("infers withOptional type as T | undefined", () => {
        const result = unwrap(
            loadEnv(opts([".env.missing"]), {
                PRESENT: withRequired(toString),
                ABSENT: withOptional(toInt),
            })
        );

        type assertion = Expect<
            Equal<
                typeof result,
                {
                    PRESENT: string;
                    ABSENT: number | undefined;
                }
            >
        >;

        expect(result.PRESENT).toBe("here");
        expect(result.ABSENT).toBeUndefined();
    });

    it("infers custom transform types", () => {
        const toDate = (k: string, v: string | undefined): Result<Date> => {
            if (v === undefined) return failure(`${k}: no value`);
            const d = new Date(v);
            if (isNaN(d.getTime())) return failure(`${k}: invalid date`);
            return success(d);
        };

        const result = unwrap(loadEnv(opts([".env.custom"]), {CREATED: toDate}));

        type assertion = Expect<Equal<typeof result, {CREATED: Date}>>;

        expect(result.CREATED).toBeInstanceOf(Date);
    });

    it("infers union type from custom transform", () => {
        const toLogLevel = (key: string, v: string | undefined) => {
            if (v !== undefined && ["debug", "info", "warn", "error"].includes(v))
                return success(v as "debug" | "info" | "warn" | "error");
            return failure(`${key}: invalid log level '${v}'`);
        };

        const result = unwrap(loadEnv(opts([".env.custom"]), {LOG_LEVEL: toLogLevel}));

        type assertion = Expect<
            Equal<typeof result, {LOG_LEVEL: "debug" | "info" | "warn" | "error"}>
        >;

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

    it("infers toFloatArray as number[]", () => {
        const result = unwrap(loadEnv(opts([".env.complex"]), {NUMBERS: toFloatArray()}));

        type assertion = Expect<Equal<typeof result, {NUMBERS: number[]}>>;
        expect(result.NUMBERS).toEqual([1, 2, 3, 4, 5]);
    });

    it("infers toEnum as union of provided values", () => {
        const result = unwrap(
            loadEnv(opts([".env.custom"]), {LOG_LEVEL: toEnum("debug", "info", "warn", "error")})
        );

        type assertion = Expect<
            Equal<typeof result, {LOG_LEVEL: "debug" | "info" | "warn" | "error"}>
        >;
        expect(result.LOG_LEVEL).toBe("debug");
    });

    it("infers toEnum with withDefault", () => {
        const result = unwrap(
            loadEnv(opts([".env.missing"]), {
                ABSENT: withDefault(toEnum("a", "b", "c"), "b"),
            })
        );

        type assertion = Expect<Equal<typeof result, {ABSENT: "a" | "b" | "c"}>>;
        expect(result.ABSENT).toBe("b");
    });

    it("infers toEnum with withOptional as T | undefined", () => {
        const result = unwrap(
            loadEnv(opts([".env.missing"]), {
                ABSENT: withOptional(toEnum("x", "y")),
            })
        );

        type assertion = Expect<Equal<typeof result, {ABSENT: "x" | "y" | undefined}>>;
        expect(result.ABSENT).toBeUndefined();
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
