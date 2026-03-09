import type {Result} from "./result.js";

export type LogLevel = "error" | "warn" | "debug" | "verbose";
export type Logger = (level: LogLevel, message: string) => void;

export type SchemaParser<TSchema = any, TReturn = any> = (
    obj: unknown,
    schema: TSchema,
    key: string
) => Result<TReturn, string>;

export type TransformContext = {
    rawEnv: Record<string, string>;
    schemaParser?: SchemaParser;
    radix?: (key: string) => number | undefined;
    log?: Logger;
    line?: number;
    source?: string;
};

export type TransformFn<TData = any> = (
    key: string,
    val: string | undefined,
    ctx: TransformContext
) => Result<TData, string>;

export type InferValueFromTransformFn<TTransform extends TransformFn> =
    ReturnType<TTransform> extends Result<infer TData> ? TData : never;

export type Config = Record<string, TransformFn>;

export type RadixFn = (key: string) => number | undefined;

export type CamelCase<S extends string> = S extends `${infer Head}_${infer Tail}`
    ? `${Lowercase<Head>}${PascalTail<Tail>}`
    : Lowercase<S>;

type PascalTail<S extends string> = S extends `${infer Head}_${infer Tail}`
    ? `${Capitalize<Lowercase<Head>>}${PascalTail<Tail>}`
    : Capitalize<Lowercase<S>>;

export type SafeCamelCase<S extends string> = S extends Uppercase<S> ? CamelCase<S> : S;

export type ParsedEntry = {
    key: string;
    value: string;
    line: number;
    source: string;
    quoted?: '"' | "'" | "`";
};

export type ParseWarning = {
    line: number;
    message: string;
};
