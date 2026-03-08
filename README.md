# cl-env


Env file loading for Node.js.

- **Strongly typed** — return type is inferred from your config. Transforms, defaults, and key casing are all reflected in the types.
- **Composable transforms** — combine `withRequired`, `withDefault`, and transform functions or write your own.
- **Key transformation** — optionally converts `UPPER_SNAKE_CASE` keys to `camelCase`, with full type-level support.
- **No `process.env` mutation** — returns a plain object. Secrets stay out of child processes.
- **Quote handling** — strips surrounding `"`, `'`, and `` ` `` from values. Expands `\n` and `\r` escapes inside double quotes.

#### Install

`npm i --save-dev @lindeneg/cl-env`

#### Example

```ts
import { loadEnv, unwrap, toString, toInt, toBool, withDefault, withRequired } from "@lindeneg/cl-env";

const env = unwrap(
    loadEnv(
        { path: ".env", transformKeys: false },
        {
            DATABASE_URL: withRequired(toString),
            PORT: withDefault(toInt, 3000),
            DEBUG: toBool,
        }
    )
);

// env is fully typed:
// { DATABASE_URL: string, PORT: number, DEBUG: boolean }

// if `transformKeys` is set to `true`, then env is typed as:
// { databaseUrl: string, port: number, debug: boolean }
```

## Error handling

Errors are accumulated. If multiple keys fail validation, you get all errors at once:

```ts
const result = loadEnv(
    { path: ".env", transformKeys: false },
    {
        PORT: withRequired(toInt),
        API_KEY: withRequired(toString),
        DB_HOST: withRequired(toString),
    }
);

if (!result.ok) {
    // result.ctx: ["PORT: is required but is missing", "API_KEY: is required but is missing"]
}
```

### Transform functions

Each config value is a transform function `(key: string, value: string) => Result<T>`. The return type determines the type of that key in the result.

#### Built-in transforms

| Transform | Output type | Description |
|---|---|---|
| `toString` | `string` | Returns the value as-is. |
| `toInt` | `number` | Parses an integer. Fails on non-numeric input. |
| `toFloat` | `number` | Parses a float. Fails on non-numeric input. |
| `toBool` | `boolean` | `"true"`, `"TRUE"`, `"True"`, `"1"` → `true`, `"false"`, `"FALSE"`, `"False"`, `"0"` → `false`. Fails on anything else. |
| `toJSON<T>(schema?)` | `T` | Parses JSON. Fails on invalid input. Optionally validates against a schema (see [Schema validation](#schema-validation)). |
| `toStringArray(delimiter?)` | `string[]` | Splits by delimiter (default `","`). |
| `toIntArray(delimiter?)` | `number[]` | Splits and parses each element as an integer. |

#### Wrappers

| Wrapper | Description |
|---|---|
| `withRequired(transform)` | Fails if the value is empty or the key is missing from the file. |
| `withDefault(transform, defaultValue)` | Uses `defaultValue` when the value is empty or the key is missing. |

#### Custom transforms

Write your own:

```ts
import { loadEnv, unwrap, success, failure } from "@lindeneg/cl-env";

const env = unwrap(
    loadEnv(
        { path: ".env", transformKeys: false },
        {
            ALLOWED_ORIGINS: (_, v) => success(v.split(",").map(s => s.trim())),
            LOG_LEVEL: (key, v) => {
                if (["debug", "info", "warn", "error"].includes(v)) return success(v);
                return failure(`${key}: invalid log level '${v}'`);
            },
        }
    )
);
```

## Schema validation

`toJSON` accepts an optional schema argument. To use it, register a schema parser first:

```ts
import { schemaParser, loadEnv, unwrap, toJSON, toString, withRequired } from "@lindeneg/cl-env";

// Register your parser once, then chain into loadEnv
const env = unwrap(
    schemaParser
        .set((obj, schema) => {
            // Use any validation library here (zod, arktype, etc.)
            const result = schema.safeParse(obj);
            if (result.success) return success(result.data);
            return failure(`validation failed: ${result.error.message}`);
        })
        .loadEnv(
            { path: ".env", transformKeys: false },
            {
                DB_CONFIG: toJSON<DbConfig>(dbConfigSchema),
                API_KEY: withRequired(toString),
            }
        )
);
```

If a schema is passed to `toJSON` but no parser has been registered, it will fail with an error telling you to call `schemaParser.set(...)` first.

## Parsing rules

- Lines are split on the first `=`. Keys and values are trimmed.
- Lines starting with `#` are treated as comments and skipped.
- Lines starting with `export ` have the prefix stripped (for bash compatibility).
- Empty lines and lines without `=` are skipped.
- Keys not in your config are ignored.
- Surrounding quotes (`"`, `'`, `` ` ``) are stripped from values.
- `\n` and `\r` are expanded inside double-quoted values only.
- `\r\n` and `\r` line endings are normalized.

## License

MIT
