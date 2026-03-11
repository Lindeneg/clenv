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

export function unwrap<TData>(r: Result<TData, EnvError[]>): TData {
    if (!r.ok) {
        const msg = r.ctx
            .map(
                (e) =>
                    `${e.source && e.source !== "none" ? `${e.source}:${e.line ? `L${e.line}: ` : " "}` : ""}${e.message}`
            )
            .join("\n");
        throw new Error("\n" + msg);
    }
    return r.data;
}
