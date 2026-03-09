export type EnvError = {
    key: string;
    line?: number;
    source?: string;
    message: string;
};

type ResultSuccess<TData> = {
    data: TData;
    ok: true;
};

interface ResultFailure<TCtx> {
    ctx: TCtx;
    ok: false;
}

export type Result<TData, TErrorCtx = string> = ResultSuccess<TData> | ResultFailure<TErrorCtx>;

export function success<TData>(data: TData): ResultSuccess<TData> {
    return {data, ok: true};
}

export function failure<TCtx>(ctx: TCtx): ResultFailure<TCtx> {
    return {ok: false, ctx};
}

export function unwrap<T extends Result<any, any>>(
    r: T
): [T] extends [Result<infer TData, any>] ? TData : never {
    if (!r.ok) {
        if (Array.isArray(r.ctx)) {
            const msg = r.ctx
                .map((e: EnvError | string) =>
                    typeof e === "string"
                        ? e
                        : `${e.source && e.source !== "none" ? `${e.source}:` : ""}${e.line ? `L${e.line}: ` : ""}${e.message}`
                )
                .join("\n");
            throw new Error(msg);
        }
        throw new Error(typeof r.ctx === "string" ? r.ctx : String(r.ctx));
    }
    return r.data;
}
