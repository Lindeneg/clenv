###### under development with possible breaking changes until 1.0.0 is released

# cl-env

Load `.env` files, validate values with composable transforms, and produce a **fully typed** configuration object, all with zero runtime dependencies.

- **Full type inference** — transforms, defaults, key casing all reflected at the type level.
- **Proper dotenv parser** — multiline values, escape sequences, variable expansion, inline comments, layered files.
- **Composable validation** — combine `withRequired`, `withDefault`, built-in transforms, or write your own.
- **Structured errors** — errors accumulate; nothing fails silently.
- **No `process.env` mutation** — returns a plain object, secrets never leak to child processes.
- **Zero dependencies.**

---

- [Install](#install)
- [Why cl-env?](#why-cl-env)
- [Quick start](#quick-start)
- [API](#api)
  - [Options](#options)
  - [Transforms](#transforms)
  - [Refine](#refine)
  - [Custom transforms](#custom-transforms)
  - [TransformContext](#transformcontext)
- [Behavior](#behavior)
  - [Missing values](#missing-values)
  - [Result type](#result-type)
  - [Error handling](#error-handling)
  - [File resolution](#file-resolution)
  - [Variable expansion](#variable-expansion)
  - [Parsing rules](#parsing-rules)

---

## Install

```
npm i @lindeneg/cl-env
```

## Why cl-env?

`cl-env` owns the full env loading pipeline: parsing, variable expansion, layered files, validation, and typing, in a single zero-dependency package that never mutates `process.env`.

If your framework already manages `process.env` for you, validation-only libraries like [t3-env](https://env.t3.gg) or [envalid](https://github.com/af/envalid) are purpose-built for that model and will serve you well.

`cl-env` is for when you want to control the loading yourself.

| | Common approach | cl-env |
|---|---|---|
| Parsing | dotenv (separate package) | Built-in |
| Typing | Via schema library (Zod, etc.) | Inferred from transforms |
| Validation | Schema-based | Transform-based |
| Expansion | dotenv-expand (separate package) | Built-in, graph-based |
| Layering | dotenv-flow (separate package) | Built-in |
| Errors | Varies | Accumulated with source tracking |
| Dependencies | 2-4 packages | Zero |

## Quick start

```ts
import {loadEnv, unwrap, toString, toInt, toFloat, toBool, toEnum, refine, inRange,
        withOptional, withDefault, withRequired } from "@lindeneg/cl-env";

const env = unwrap(
    loadEnv(
        { files: [".env"], transformKeys: true },
        {
            DATABASE_URL: withRequired(toString()),
            PORT: withDefault(refine(toInt(), inRange(1, 65535)), 3000),
            FLOAT: withOptional(toFloat()),
            DEBUG: toBool(),
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
env.port         // number
env.float        // number | undefined
env.debug        // boolean
env.logLevel     // "debug" | "info" | "warn" | "error"
```

`unwrap` extracts the data or throws if any errors occurred. Key casing, transforms, defaults, and optionals are all inferred at the type level.

An async version is also available:

```ts
const env = unwrap(
    await loadEnvAsync(
        { files: [".env"], transformKeys: true },
        { /* same config */ }
    )
);
```

`loadEnvAsync` has the same signature and type inference as `loadEnv` but reads files concurrently using `fs/promises` and returns a `Promise`.

---

## API

### Options

Options are passed inline as the first argument to `loadEnv` / `loadEnvAsync`. The options type is intentionally not exported. Pass options inline so TypeScript can infer the literal type of `transformKeys` and produce the correct key casing in the result.

| Option | Type | Required | Default | Description |
|---|---|---|---|---|
| `files` | `string[]` | yes | — | Required files to load, in order. Every file must be readable. Duplicate keys use last-wins. |
| `optionalFiles` | `string[]` | no | `[]` | Files to load if they exist, silently skipped otherwise. Read after `files`, same last-wins rule. |
| `transformKeys` | `boolean` | yes | — | Convert `SCREAMING_SNAKE_CASE` keys to `camelCase` in the result (runtime + type level). Only fully uppercase keys are transformed; mixed-case keys like `helloThere` are preserved. |
| `basePath` | `string` | no | — | Prepended to each file path. |
| `encoding` | `BufferEncoding` | no | `"utf8"` | File encoding. |
| `includeProcessEnv` | `"fallback"` \| `"override"` \| `false` | no | `false` | `"fallback"`: fills in keys missing from files. `"override"`: `process.env` wins over file values. `false`: ignore `process.env`. Only keys defined in your config are read. See [details below](#includeprocessenv-details). |
| `logger` | `Logger` \| `boolean` | no | — | `true` for built-in colored logger, or a `(level, message) => void` function. Levels: `"error"`, `"warn"`, `"debug"`, `"verbose"`. |
| `schemaParser` | `SchemaParser` | no | — | Validation function for `toJSON` transforms. See [schema validation](#schema-validation). |

#### `includeProcessEnv` details

The merge happens after variable expansion. Values from `process.env` are taken as-is. `$VAR` references in them are **not** expanded. In `"fallback"` mode, a key with an empty value in a file (`KEY=`) is considered present, so `process.env` will not replace it.

#### Schema validation

Pass a `schemaParser` in options and a schema to `toJSON(schema)`:

```ts
import { loadEnv, toJSON, success, failure, type SchemaParser } from "@lindeneg/cl-env";

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

---

### Transforms

All built-in transforms are factory functions. Call them (e.g. `toString()`, `toInt()`) in your config. The factory call accepts optional configuration.

| Transform | Output | Notes |
|---|---|---|
| `toString()` | `string` | Returns value as-is. |
| `toInt(opts?)` | `number` | `parseInt`. Options: `{ radix?: number, strict?: boolean }`. Strict mode (default) rejects non-numeric characters (e.g. `'42abc'` fails). |
| `toFloat(opts?)` | `number` | `parseFloat`. Options: `{ strict?: boolean }`. Strict mode (default) rejects non-numeric characters. |
| `toBool(opts?)` | `boolean` | `true/TRUE/1` → `true`, `false/FALSE/0` → `false` (case-insensitive). Options: `{ trueValues?: string[], falseValues?: string[] }` for custom mappings. |
| `toEnum(...values)` | union | Succeeds if value matches exactly (case-sensitive). Type is inferred as union of provided strings. |
| `toJSON<T>(schema?)` | `T` | `JSON.parse`, optionally validated via `schemaParser`. |
| `toStringArray(delim?)` | `string[]` | Split by delimiter (default `,`), trim each element, filter empty strings. An empty value (`KEY=`) produces `[]`. |
| `toIntArray(opts?)` | `number[]` | Split and parse each as integer. Options: `{ delimiter?, radix?, strict? }`. Empty elements are filtered. |
| `toFloatArray(opts?)` | `number[]` | Split and parse each as float. Options: `{ delimiter?, strict? }`. Empty elements are filtered. |

All built-in transforms fail on `undefined` with a message suggesting `withDefault` or `withRequired`.

### Refine

Chain validation checks after a transform using `refine`:

```ts
import { loadEnv, unwrap, toString, toInt, toStringArray,
         refine, inRange, nonEmpty, matches, minLength, maxLength,
         withRequired, withOptional } from "@lindeneg/cl-env";

const env = unwrap(
    loadEnv(
        { files: [".env"], transformKeys: false },
        {
            PORT: withRequired(refine(toInt(), inRange(1, 65535))),
            HOST: withRequired(refine(toString(), nonEmpty())),
            API_KEY: withOptional(refine(toString(), minLength(10), maxLength(128))),
            TAGS: refine(toStringArray(), maxLength(10)),
            EMAIL: refine(toString(), matches(/^.+@.+\..+$/)),
        }
    )
);
```

| Helper | Applies to | Description |
|---|---|---|
| `refine(transform, ...checks)` | any | Chain one or more checks after a transform. |
| `inRange(min, max)` | `number` | Value must be `>= min` and `<= max`. |
| `nonEmpty()` | `string \| any[]` | Shorthand for `minLength(1)`. |
| `minLength(n)` | `string \| any[]` | `.length` must be `>= n`. |
| `maxLength(n)` | `string \| any[]` | `.length` must be `<= n`. |
| `matches(regex)` | `string` | Value must match the regex. |

Checks are `RefineCheck<T>` functions: `(key, value, ctx) => Result<T>`. Write custom checks for project-specific validation:

```ts
import { loadEnv, unwrap, toInt, refine, withRequired,
         type RefineCheck, success, failure } from "@lindeneg/cl-env";

const isEven: RefineCheck<number> = (key, val) =>
    val % 2 === 0 ? success(val) : failure(`${key}: expected even number, got ${val}`);

const env = unwrap(
    loadEnv(
        { files: [".env"], transformKeys: false },
        { COUNT: withRequired(refine(toInt(), isEven)) }
    )
);
```

### Custom transforms

Return `success(value)` or `failure(message)`. TypeScript infers the result type from your `success(...)` calls:

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

The `TransformFn` type is exported for writing reusable transforms in separate files.

### TransformContext

Every transform receives a `TransformContext` as its third argument:

| Property | Type | Description |
|---|---|---|
| `expandedEnv` | `Record<string, string>` | All resolved string values (post-expansion, pre-transform). |
| `source` | `string \| undefined` | Where the key came from: file name (e.g. `".env.local"`), `"process.env"`, or `"none"`. |
| `line` | `number \| undefined` | Line number in the source file. `undefined` when there is no file. |
| `schemaParser` | `SchemaParser \| undefined` | The schema parser from options, if set. |
| `log` | `Logger \| undefined` | The logger from options, if set. |

---

## Behavior

### Missing values

You control how missing variables behave with wrappers:

| Wrapper | Missing key | Present key |
|---|---|---|
| `withRequired(transform)` | Fails with error | Delegates to transform |
| `withDefault(transform, value)` | Uses default value | Delegates to transform |
| `withOptional(transform)` | Returns `undefined` | Delegates to transform |

A key is "missing" when it doesn't appear in any file (or `process.env`, if merged) — its value is `undefined`. A key with an empty value (`KEY=`) is **not** missing; the empty string is passed to the inner transform as-is.

Without a wrapper, a missing key passes `undefined` directly to the transform. All built-in transforms fail on `undefined` with a message suggesting `withDefault` or `withRequired`.

Wrappers compose with `refine`: `withRequired(refine(toInt(), inRange(1, 65535)))` validates the port is required **and** within range.

### Result type

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

### Error handling

Errors are accumulated. All config keys are validated, and every failure is reported, not just the first one.

```ts
type EnvError = {
    key: string;
    line?: number;
    source?: string;
    message: string;
};
```

`unwrap(result)` throws an `Error` with all messages joined by newlines. The `success(data)` and `failure(ctx)` constructors are exported for writing custom transforms.

### File resolution

Every file listed in `files` must be readable. A missing required file is always an error, even if all config keys could be satisfied by other files or `process.env`. Use `optionalFiles` for files that may or may not exist.

At least one source of values must be configured:

| `files` | `optionalFiles` | `includeProcessEnv` | Result |
|---|---|---|---|
| `[]` | none | `false`/undefined | Error: no sources configured |
| `[".env"]` | — | any | `.env` must exist, error if missing |
| `[".env"]` | `[".env.local"]` | any | `.env` required; `.env.local` loaded if present, skipped if not |
| `[".env"]` (missing) | `[".env.local"]` (exists) | any | Error: required file missing |
| `[]` | `[".env"]` | `false`/undefined | OK, optional files are a valid source |
| `[]` | none | `"fallback"` or `"override"` | OK, `process.env` is a valid source |

### Variable expansion

Values can reference other variables using `$VAR` or `${VAR}`:

```ini
HOST=localhost
PORT=3000
URL=http://${HOST}:$PORT
```

- Expansion runs after deduplication (last-wins) in **dependency order** (topological sort), so forward references work regardless of file order.
- References resolve against other keys in the files first, then fall back to `process.env`.
- Unresolved references are left unchanged (e.g. `$MISSING` stays as `$MISSING`).
- Cyclic references are detected and logged as warnings. Values are expanded best-effort but may be incomplete.
- Single-quoted values are **not** expanded (they're literal).

### Parsing rules

The parser is a character-by-character state machine:

| Feature | Behavior |
|---|---|
| Comments | `#` lines. Inline `#` preceded by whitespace in unquoted values. |
| Export prefix | `export KEY=value` supported (prefix stripped). |
| Double quotes | Escape sequences (`\n`, `\r`, `\t`, `\\`, `\"`), multiline. |
| Single quotes / backticks | Literal (no escapes), multiline. |
| Unquoted values | Single line, trailing whitespace trimmed. |
| Line endings | BOM (`\uFEFF`) stripped, `\r\n` and `\r` normalized to `\n`. |
| Line tracking | Line numbers included in all error/warning messages. |
| Unterminated quotes | Warning logged. Value consumes to EOF; subsequent entries in that file will be missing. |
| Invalid keys | Names not matching `[A-Za-z_][A-Za-z0-9_]*` produce a warning. |

## License

MIT
