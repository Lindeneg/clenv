# cl-env

Type-safe, leak-free .env loading for Node.js.

- **Full type inference**
    - return type is derived from your config. Transforms, defaults, key casing, **all reflected at the type level**.
- **No exceptions**
    - every operation returns a `Result<T, E>`. Errors are accumulated, never thrown.
- **No `process.env` mutation**
    - returns a plain object. Secrets stay out of child processes.
- **Proper dotenv parser**
    - multiline quoted values, escape sequences, inline comments, variable expansion, BOM stripping, CRLF normalization.
- **Layered files**
    - load `[".env", ".env.local"]` with last-wins semantics.
- **Composable**
    - combine `withRequired`, `withDefault`, built-in transforms, or write your own.

## Install

```
npm i @lindeneg/cl-env
```

## Quick start

```ts
import { loadEnv, unwrap, toString, toInt, toBool, withDefault, withRequired } from "@lindeneg/cl-env";

const env = unwrap(
    loadEnv(
        { files: [".env"], transformKeys: true },
        {
            DATABASE_URL: withRequired(toString),
            PORT: withDefault(toInt, 3000),
            DEBUG: toBool,
        }
    )
);

// env: { databaseUrl: string, port: number, debug: boolean }
```

With `transformKeys: false`, keys are preserved as-is: `{ DATABASE_URL: string, PORT: number, DEBUG: boolean }`, enforced at the type-level and of course in the object itself.

## Result type

`loadEnv` never throws. It returns `Result<T, string[]>`:

```ts
const result = loadEnv(
    { files: [".env"], transformKeys: false },
    {
        PORT: withRequired(toInt),
        API_KEY: withRequired(toString),
    }
);

if (!result.ok) {
    // result.ctx: string[] — all errors, with line numbers
    // ["PORT:L3: PORT: is required but is missing", "API_KEY:L4: is required but is missing"]
    console.error(result.ctx.join("\n"));
    process.exit(1);
}

// result.data is the fully typed env object
result.data.PORT; // number
```

`unwrap(result)` extracts the data or throws if the result is a failure — use this when you want to fail fast.

All transforms also return `Result`. The `success(data)` and `failure(ctx)` constructors are exported for writing custom transforms.

## Options

```ts
type LoadEnvOpts = {
    files: string[];                              // files to load, in order
    transformKeys: boolean;                       // convert UPPER_SNAKE_CASE to camelCase
    basePath?: string;                            // prepended to each file path
    encoding?: BufferEncoding;                    // default: "utf8"
    includeProcessEnv?: boolean | "overwrite";    // merge process.env (see below)
    logger?: Logger | boolean;                    // logging (see below)
    schemaParser?: SchemaParser;                  // for toJSON schema validation
    radix?: (key: string) => number | undefined;  // per-key radix for toInt
};
```

## Transforms

Each config value is a transform function: `(key, value, ctx) => Result<T>`. The return type determines the type of that key in the result.

### Built-in transforms

| Transform | Output | Description |
|---|---|---|
| `toString` | `string` | Returns value as-is |
| `toInt` | `number` | Parses integer (respects `radix` option) |
| `toFloat` | `number` | Parses float |
| `toBool` | `boolean` | Strict: `true/TRUE/True/1` → `true`, `false/FALSE/False/0` → `false`, anything else fails |
| `toJSON<T>(schema?)` | `T` | Parses JSON, optionally validates with schema parser |
| `toStringArray(delimiter?)` | `string[]` | Splits by delimiter (default `,`), trims elements |
| `toIntArray(delimiter?)` | `number[]` | Splits and parses each element as integer |

### Wrappers

| Wrapper | Description |
|---|---|
| `withRequired(transform)` | Fails if value is empty or key is missing |
| `withDefault(transform, defaultValue)` | Uses `defaultValue` when value is empty or key is missing |

Without a wrapper, a missing key passes an empty string to the transform.

### Custom transforms

```ts
import { loadEnv, unwrap, success, failure } from "@lindeneg/cl-env";

const env = unwrap(
    loadEnv(
        { files: [".env"], transformKeys: false },
        {
            LOG_LEVEL: (key, v) => {
                if (["debug", "info", "warn", "error"].includes(v)) return success(v as "debug" | "info" | "warn" | "error");
                return failure(`${key}: invalid log level '${v}'`);
            },
        }
    )
);
// env: { LOG_LEVEL: "debug" | "info" | "warn" | "error" }
```

## Layered files

```ts
const env = unwrap(
    loadEnv(
        { files: [".env", ".env.local"], transformKeys: false, basePath: "." },
        { PORT: toInt, SECRET: withRequired(toString) }
    )
);
```

Files are loaded in order. Duplicate keys use last-wins semantics.

## Variable expansion

Values can reference other variables using `$VAR` or `${VAR}`:

```ini
HOST=localhost
PORT=3000
URL=http://${HOST}:$PORT
```

Expansion resolves against previously defined keys, then falls back to `process.env`. Single-quoted values are **not** expanded (they're literal).

## Process env merge

```ts
// Fallback: process.env fills in keys missing from files
loadEnv({ files: [".env"], transformKeys: false, includeProcessEnv: true }, config);

// Overwrite: process.env wins over file values
loadEnv({ files: [".env"], transformKeys: false, includeProcessEnv: "overwrite" }, config);
```

Only keys defined in your config are read from `process.env` — it doesn't pull in arbitrary env vars.

## Schema validation

`toJSON` accepts an optional schema argument. Pass a `schemaParser` in options to validate:

```ts
import { loadEnv, unwrap, toJSON, success, failure, type SchemaParser } from "@lindeneg/cl-env";

const parser: SchemaParser = (obj, schema, key) => {
    const result = schema.safeParse(obj);
    if (result.success) return success(result.data);
    return failure(`${key}: ${result.error.message}`);
};

const env = unwrap(
    loadEnv(
        { files: [".env"], transformKeys: false, schemaParser: parser },
        { DB_CONFIG: toJSON<DbConfig>(dbConfigSchema) }
    )
);
```

If a schema is passed to `toJSON` but no `schemaParser` is set, it fails with an error.

## Logging

```ts
// Use the built-in logger
loadEnv({ files: [".env"], transformKeys: false, logger: true }, config);

// Or provide your own
loadEnv({
    files: [".env"],
    transformKeys: false,
    logger: (level, message) => { /* level: "error" | "warn" | "debug" | "verbose" */ },
}, config);
```

The logger reports: duplicate keys, unknown keys, suspicious whitespace, variable expansion, process.env merges, default value usage, and a final summary.

## Parsing rules

- Full dotenv-compatible parser (character-by-character state machine)
- `#` lines are comments. Inline `#` preceded by whitespace is a comment in unquoted values.
- `export KEY=value` is supported (prefix stripped)
- Double-quoted values: escape sequences (`\n`, `\r`, `\t`, `\\`, `\"`), multiline
- Single-quoted and backtick-quoted values: literal (no escapes), multiline
- Unquoted values: single line, trailing whitespace trimmed
- BOM (`\uFEFF`) stripped, `\r\n` and `\r` normalized to `\n`
- Line numbers tracked and included in error messages (`KEY:L32: error`)

## License

MIT
