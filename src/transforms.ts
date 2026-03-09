import {success, failure, type Result} from "./result.js";
import type {TransformContext, TransformFn, InferValueFromTransformFn} from "./types.js";

export function toString(
    key: string,
    v: string | undefined,
    _ctx: TransformContext
): Result<string> {
    if (v === undefined)
        return failure(`${key}: no value provided (use withDefault or withRequired)`);
    return success(v);
}

export function toBool(
    key: string,
    v: string | undefined,
    _ctx: TransformContext
): Result<boolean> {
    if (v === undefined)
        return failure(`${key}: no value provided (use withDefault or withRequired)`);
    const lower = v.toLowerCase();
    if (lower === "true" || lower === "1") return success(true);
    if (lower === "false" || lower === "0") return success(false);
    return failure(`${key}: expected boolean, got '${v}'`);
}

export function toInt(key: string, v: string | undefined, ctx: TransformContext): Result<number> {
    if (v === undefined)
        return failure(`${key}: no value provided (use withDefault or withRequired)`);
    return toNumber(key, v, ctx, "int");
}

export function toFloat(key: string, v: string | undefined, ctx: TransformContext): Result<number> {
    if (v === undefined)
        return failure(`${key}: no value provided (use withDefault or withRequired)`);
    return toNumber(key, v, ctx, "float");
}

export function toStringArray(delimiter = ",") {
    return function (key: string, v: string | undefined, _ctx: TransformContext): Result<string[]> {
        if (v === undefined)
            return failure(`${key}: no value provided (use withDefault or withRequired)`);
        return success(v.split(delimiter).map((s) => s.trim()));
    };
}

export function toIntArray(delimiter = ",") {
    return function (key: string, v: string | undefined, ctx: TransformContext): Result<number[]> {
        if (v === undefined)
            return failure(`${key}: no value provided (use withDefault or withRequired)`);
        const parts = v.split(delimiter).map((s) => s.trim());
        const out: number[] = [];

        for (const p of parts) {
            const r = toInt(key, p, ctx);
            if (!r.ok) return r;
            out.push(r.data);
        }

        return success(out);
    };
}

export function toFloatArray(delimiter = ",") {
    return function (key: string, v: string | undefined, ctx: TransformContext): Result<number[]> {
        if (v === undefined)
            return failure(`${key}: no value provided (use withDefault or withRequired)`);
        const parts = v.split(delimiter).map((s) => s.trim());
        const out: number[] = [];

        for (const p of parts) {
            const r = toFloat(key, p, ctx);
            if (!r.ok) return r;
            out.push(r.data);
        }

        return success(out);
    };
}

export function toEnum<T extends string>(...values: T[]) {
    return function (key: string, v: string | undefined, _ctx: TransformContext): Result<T> {
        if (v === undefined)
            return failure(`${key}: no value provided (use withDefault or withRequired)`);
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

function toNumber(key: string, v: string, ctx: TransformContext, parser: "int" | "float") {
    let n;
    if (parser === "int") {
        n = parseInt(v, ctx.radix ? ctx.radix(key) : 10);
    } else {
        n = parseFloat(v);
    }
    if (Number.isNaN(n)) return failure(`${key}: failed to convert '${v}' to a number`);
    return success(n);
}
