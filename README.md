# cl-env

Type-safe dotenv replacement with composable validation and zero runtime dependencies.

Load `.env` files, validate values with composable transforms, and produce a **fully typed** configuration object.

- **Full type inference** — transforms, defaults, key casing all reflected at the type level.
- **Proper dotenv parser** — multiline values, escape sequences, variable expansion, inline comments, layered files.
- **Composable validation** — combine `withRequired`, `withDefault`, built-in transforms, or write your own.
- **Structured errors** — errors accumulate; nothing fails silently.
- **No `process.env` mutation** — returns a plain object.
- **Zero dependencies** — single-file implementation.

## Install

```
npm i @lindeneg/cl-env
```

## Quick start

```ts
import { loadEnv, unwrap, toString, toInt, toFloat, toBool, toEnum,
         withOptional, withDefault, withRequired } from "@lindeneg/cl-env";

const env = unwrap(
    loadEnv(
        { files: [".env"], transformKeys: true },
        {
            DATABASE_URL: withRequired(toString),
            PORT: withDefault(toInt, 3000),
            FLOAT: withOptional(toFloat),
            DEBUG: toBool,
            LOG_LEVEL: toEnum("debug", "info", "warn", "error"),
        }
    )
);
```

Given this `.env` file:

```ini
DATABASE_URL=postgres://localhost/db
PORT=8080
DEBUG=true
LOG_LEVEL=info
```

The result is a fully typed object:

```ts
env.databaseUrl  // string
env.port         // number (8080, not the default)
env.float        // number | undefined
env.debug        // boolean
env.logLevel     // "debug" | "info" | "warn" | "error"
```

`unwrap` extracts the data or throws if any errors occurred. Key casing, transforms, defaults, and optionals are all inferred at the type level.

## Core concepts

### 1. Config is defined with transforms

Each key maps to a transform function that converts a raw string into a typed value:

```ts
{
    PORT: toInt,
    DEBUG: toBool,
    API_KEY: withRequired(toString),
}
```

The return type of each transform determines the type of that key in the result.

### 2. Missing values are explicit

You control how missing variables behave:

| Wrapper | Behavior |
|---|---|
| `withRequired(transform)` | Fails if key is missing — empty values pass through to the transform |
| `withDefault(transform, defaultValue)` | Uses `defaultValue` when key is missing — empty values pass through |
| `withOptional(transform)` | Returns `undefined` when key is missing, otherwise delegates to the transform |

Without a wrapper, a missing key passes `undefined` to the transform. All built-in transforms fail on `undefined` with a message suggesting `withDefault` or `withRequired`.

### 3. The loader returns a Result

`loadEnv` never throws. It returns `Result<T, EnvError[]>`:

```ts
const result = loadEnv(opts, config);

if (!result.ok) {
    for (const err of result.ctx) {
        console.error(`${err.source}:L${err.line}: ${err.key}: ${err.message}`);
    }
    process.exit(1);
}

result.data.PORT; // number
```

Or use `unwrap(result)` to extract the data or throw:

```ts
const env = unwrap(loadEnv(opts, config));
```

## Transforms

Each config value is a transform function `(key, value, ctx) => Result<T>`, where `value` is `string | undefined` (`undefined` means the key was not found in any file).

### Built-in transforms

| Transform | Output | Description |
|---|---|---|
| `toString` | `string` | Returns value as-is |
| `toInt` | `number` | Parses integer via `parseInt` (respects `radix` option) |
| `toFloat` | `number` | Parses float |
| `toBool` | `boolean` | `true/TRUE/True/1` → `true`, `false/FALSE/False/0` → `false`, anything else fails |
| `toEnum(...values)` | union of `values` | Succeeds if value is one of the provided strings (case-sensitive) |
| `toJSON<T>(schema?)` | `T` | Parses JSON, optionally validates with a schema parser |
| `toStringArray(delimiter?)` | `string[]` | Splits by delimiter (default `,`), trims elements |
| `toIntArray(delimiter?)` | `number[]` | Splits and parses each element as integer |
| `toFloatArray(delimiter?)` | `number[]` | Splits and parses each element as float |

Note: `parseInt` ignores trailing non-numeric characters (e.g. `'42abc'` parses as `42`). Use a custom transform if you need strict integer validation.

### Custom transforms

Return `success(value)` or `failure(message)`. TypeScript infers the result type from your `success(...)` calls.

```ts
import { loadEnv, unwrap, success, failure } from "@lindeneg/cl-env";

const env = unwrap(
    loadEnv(
        { files: [".env"], transformKeys: false },
        {
            CREATED: (key, v) => {
                if (v === undefined) return failure(`${key}: no value provided`);
                const d = new Date(v);
                if (isNaN(d.getTime())) return failure(`${key}: invalid date '${v}'`);
                return success(d);
            },
        }
    )
);
// env: { CREATED: Date }
```

Every transform receives a `TransformContext` as its third argument, which provides access to all resolved string values, the schema parser, radix function, logger, and the source file/line number of the key being transformed. The `TransformFn` type is exported for writing reusable transforms in separate files.

## Error handling

Errors are accumulated — all config keys are validated, and every failure is reported, not just the first one.

```ts
type EnvError = {
    key: string;
    line?: number;
    source?: string;
    message: string;
};
```

`unwrap(result)` throws an `Error` with all messages joined. The `success(data)` and `failure(ctx)` constructors are exported for writing custom transforms.

### Strict file resolution

Every file listed in `files` must be readable. If a file is missing or unreadable, that is always an error — even if all config keys are satisfied by other files. If you list `[".env", ".env.local"]` and `.env.local` doesn't exist, the result is a failure containing the file-read error alongside any transform errors. If no files produce any entries and there are file errors, `loadEnv` returns early with just the file errors (without running transforms).

If you want a file to be optional, don't include it in the `files` array — use `includeProcessEnv: "fallback"` or handle the layering yourself.

## Options

Options are passed inline as the first argument to `loadEnv`. Only `files` and `transformKeys` are required. The options type is not exported — pass options inline so TypeScript can infer the literal type of `transformKeys` and produce the correct key casing in the result.

### `files`

Files to load, in order:

```ts
files: [".env", ".env.local"]
```

Duplicate keys across files use last-wins semantics.

### `transformKeys`

Convert `SCREAMING_SNAKE_CASE` keys to `camelCase` in the result object — both at runtime and at the type level:

```ts
transformKeys: true
// DATABASE_URL → databaseUrl
// APP_NAME    → appName
```

Only fully uppercase keys are transformed. Mixed-case keys like `helloThere` are preserved as-is.

### `basePath`

Prepended to each file path:

```ts
basePath: "."
```

### `encoding`

File encoding, default `"utf8"`:

```ts
encoding: "utf8"
```

### `includeProcessEnv`

Controls how `process.env` is merged. Only keys defined in your config are read — it doesn't pull in arbitrary env vars.

| Value | Behavior |
|---|---|
| `"fallback"` | `process.env` fills in keys missing from files |
| `"override"` | `process.env` wins over file values |
| `false` | ignore `process.env` (default) |

The merge happens after variable expansion. Values from `process.env` are taken as-is — any `$VAR` references in them will not be expanded. In fallback mode, a key that exists in a file with an empty string value (`KEY=`) is considered present, so `process.env` will not replace it.

### `logger`

Enable the built-in logger or provide your own:

```ts
// Built-in
logger: true

// Custom
logger: (level, message) => { /* level: "error" | "warn" | "debug" | "verbose" */ }
```

Reports duplicate keys, unknown keys, suspicious whitespace, variable expansion, process.env merges, default value usage, and a final summary.

### `schemaParser`

A validation function available to `toJSON` transforms. Pass a schema to `toJSON(schema)` and the parser receives it for validation:

```ts
import { loadEnv, unwrap, toJSON, success, failure, type SchemaParser } from "@lindeneg/cl-env";

const parser: SchemaParser = (obj, schema, key) => {
    const result = schema.safeParse(obj);
    if (result.success) return success(result.data);
    return failure(`${key}: ${result.error.message}`);
};

loadEnv(
    { files: [".env"], transformKeys: false, schemaParser: parser },
    { DB_CONFIG: toJSON<DbConfig>(dbConfigSchema) }
);
```

If a schema is passed to `toJSON` but no `schemaParser` is set in options, it fails with an error.

### `radix`

Per-key radix for `toInt`:

```ts
radix: (key) => key === "HEX_PORT" ? 16 : undefined
```

Returns `undefined` to use the default (base 10).

## Variable expansion

Values can reference other variables using `$VAR` or `${VAR}`:

```ini
HOST=localhost
PORT=3000
URL=http://${HOST}:$PORT
```

Expansion runs after deduplication (last-wins) and processes keys in order. A reference resolves against keys that have already been expanded, then falls back to `process.env`. Forward references (to keys not yet expanded) are left unresolved. Unresolved references are left unchanged (e.g. `$MISSING` stays as `$MISSING`). Single-quoted values are **not** expanded (they're literal).

## Parsing rules

The parser is a character-by-character state machine with full dotenv compatibility:

- `#` lines are comments. Inline `#` preceded by whitespace is a comment in unquoted values.
- `export KEY=value` is supported (prefix stripped).
- Double-quoted values: escape sequences (`\n`, `\r`, `\t`, `\\`, `\"`), multiline.
- Single-quoted and backtick-quoted values: literal (no escapes), multiline.
- Unquoted values: single line, trailing whitespace trimmed.
- BOM (`\uFEFF`) stripped, `\r\n` and `\r` normalized to `\n`.
- Line numbers tracked and included in error messages.
- Unterminated quotes are detected and logged as a warning. The parser continues with best-effort parsing — the unterminated value consumes all content to EOF, so subsequent entries in the same file will be missing.
- Invalid key names (not matching `[A-Za-z_][A-Za-z0-9_]*`) produce a warning.

## License

MIT
