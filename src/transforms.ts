import {success, failure, type Result} from "./result.js";
import type {TransformContext, TransformFn, InferValueFromTransformFn} from "./types.js";

// return a function to match the rest of the api even though we dont
// actually need to take any arguments
export function toString() {
    return function (key: string, v: string | undefined, _ctx: TransformContext): Result<string> {
        if (v === undefined) {
            return failure(`${key}: no value provided (use withDefault or withRequired)`);
        }
        return success(v);
    };
}

export type ToBoolOpts = {
    trueValues: string[];
    falseValues: string[];
};

const defaultTrueValues = ["true", "1"];
const defaultFalseValues = ["false", "0"];
export function toBool(
    opts: ToBoolOpts = {trueValues: defaultTrueValues, falseValues: defaultFalseValues}
) {
    return function (key: string, v: string | undefined, _ctx: TransformContext): Result<boolean> {
        if (v === undefined) {
            return failure(`${key}: no value provided (use withDefault or withRequired)`);
        }
        const lower = v.toLowerCase();
        if (opts.trueValues.includes(lower)) return success(true);
        if (opts.falseValues.includes(lower)) return success(false);
        return failure(`${key}: expected boolean, got '${v}'`);
    };
}

export type ToNumberOpts = {
    radix?: number;
    strict?: boolean;
};
export function toInt(opts: ToNumberOpts = {}) {
    return function (key: string, v: string | undefined, _ctx: TransformContext): Result<number> {
        if (v === undefined) {
            return failure(`${key}: no value provided (use withDefault or withRequired)`);
        }
        return toNumber("int", opts, key, v);
    };
}

export function toFloat(opts: ToNumberOpts = {}) {
    return function (key: string, v: string | undefined, _ctx: TransformContext): Result<number> {
        if (v === undefined) {
            return failure(`${key}: no value provided (use withDefault or withRequired)`);
        }
        return toNumber("float", opts, key, v);
    };
}

export function toStringArray(delimiter = ",") {
    return function (key: string, v: string | undefined, _ctx: TransformContext): Result<string[]> {
        if (v === undefined) {
            return failure(`${key}: no value provided (use withDefault or withRequired)`);
        }
        return success(v.split(delimiter).map((s) => s.trim()));
    };
}

export type ToNumberArrayOpts = {
    delimiter?: string;
} & ToNumberOpts;

export function toIntArray(opts: ToNumberArrayOpts = {}) {
    return function (k: string, v: string | undefined, ctx: TransformContext): Result<number[]> {
        return toNumberArray("int", opts, k, v, ctx);
    };
}

export function toFloatArray(opts: ToNumberArrayOpts = {}) {
    return function (k: string, v: string | undefined, ctx: TransformContext): Result<number[]> {
        return toNumberArray("float", opts, k, v, ctx);
    };
}

export function toEnum<T extends string>(...values: T[]) {
    return function (key: string, v: string | undefined, _ctx: TransformContext): Result<T> {
        if (v === undefined) {
            return failure(`${key}: no value provided (use withDefault or withRequired)`);
        }
        if (values.includes(v as T)) return success(v as T);
        return failure(`${key}: expected one of [${values.join(", ")}], got '${v}'`);
    };
}

export function toJSON<T>(schema?: unknown) {
    return function (k: string, v: string | undefined, ctx: TransformContext): Result<T> {
        if (v === undefined)
            return failure(`${k}: no value provided (use withDefault or withRequired)`);
        try {
            const json = JSON.parse(v);
            if (schema) {
                if (!ctx.schemaParser) {
                    return failure(
                        `${k}: schema provided but no schemaParser is set. ` +
                            "Please use 'schemaParser' in options."
                    );
                }
                return ctx.schemaParser(json, schema, k);
            }
            return success(json);
        } catch (err) {
            return failure(
                `${k}: failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`
            );
        }
    };
}

export function withDefault<TTransform extends TransformFn>(
    transform: TTransform,
    defaultValue: InferValueFromTransformFn<TTransform>
) {
    return function (
        key: string,
        val: string | undefined,
        ctx: TransformContext
    ): Result<InferValueFromTransformFn<TTransform>> {
        if (val === undefined) return success(defaultValue);
        return transform(key, val, ctx);
    };
}

export function withRequired<TTransform extends TransformFn>(transform: TTransform) {
    return function (
        key: string,
        val: string | undefined,
        ctx: TransformContext
    ): Result<InferValueFromTransformFn<TTransform>> {
        if (val === undefined) return failure(`${key}: is required but is missing`);
        return transform(key, val, ctx);
    };
}

export function withOptional<T>(transform: TransformFn<T>): TransformFn<T | undefined> {
    return (key, val, ctx) => {
        if (val === undefined) return success(undefined);
        return transform(key, val, ctx);
    };
}

function toNumber(parser: "int" | "float", numberOpts: ToNumberOpts, key: string, v: string) {
    const opts = {
        radix: numberOpts.radix === undefined ? 10 : numberOpts.radix,
        strict: numberOpts.strict === undefined ? true : numberOpts.strict,
    };
    if (opts.strict) {
        const isValid = parser === "int" ? strictIntCheck(v, opts.radix) : STRICT_FLOAT_RE.test(v);
        if (!isValid) {
            return failure(
                `${key}: '${v}' is not a valid ${parser === "int" ? "integer" : "number"}`
            );
        }
    }
    let n;
    if (parser === "int") {
        n = parseInt(v, opts.radix);
    } else {
        n = parseFloat(v);
    }
    if (Number.isNaN(n)) return failure(`${key}: failed to convert '${v}' to a number`);
    return success(n);
}

function toNumberArray(
    parser: "int" | "float",
    opts: ToNumberArrayOpts,
    key: string,
    v: string | undefined,
    _ctx: TransformContext
): Result<number[]> {
    if (v === undefined) {
        return failure(`${key}: no value provided (use withDefault or withRequired)`);
    }
    const parts = v.split(opts.delimiter === undefined ? "," : opts.delimiter).map((s) => s.trim());
    const out: number[] = [];

    const boundToNumber = toNumber.bind(null, parser, opts);
    for (const p of parts) {
        const r = boundToNumber(key, p);
        if (!r.ok) return r;
        out.push(r.data);
    }
    return success(out);
}

const STRICT_INT_RE = /^[+-]?\d+$/;
const STRICT_FLOAT_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const ALPHANUMERIC = "0123456789abcdefghijklmnopqrstuvwxyz";
function strictIntCheck(v: string, radix: number): boolean {
    if (radix === 10) return STRICT_INT_RE.test(v);
    const chars = ALPHANUMERIC.slice(0, radix);
    return new RegExp(`^[+-]?[${chars}]+$`, "i").test(v);
}
