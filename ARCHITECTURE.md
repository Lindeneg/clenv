# Architecture

Technical notes on the design decisions behind cl-env.

---

## Pipeline

Every `loadEnv` / `loadEnvAsync` call runs the same pipeline:

```
read files → parse → deduplicate → expand → merge process.env → transform → output
```

The pipeline is split across three layers:

1. **I/O layer** (`loadEnv.ts`, `loadEnvAsync.ts`) — reads files from disk. These are thin wrappers that differ only in whether they use `readFileSync` or `readFile` from `fs/promises`. All other logic is shared.

2. **Parser** (`parser.ts`) — turns raw file contents into `ParsedEntry[]` (key, value, line number, source file, quote type). Pure function, no I/O, no side effects.

3. **Core** (`core.ts`) — everything else: deduplication, variable expansion, process.env merging, transform execution, error accumulation. Receives a `Map<string, string>` of file contents, returns a `Result`.

This separation means the sync and async entry points share 100% of their logic. Adding a new I/O method (e.g. reading from a remote config store) would only require a new wrapper.

---

## Why a custom parser?

The `dotenv` npm package, which I have used for years and respect immensely, would cover basic `KEY=value` parsing, but cl-env needs features that dotenv either doesn't support out-of-the-box or handles differently altogether.

- **Multiline values** in all quote styles (double, single, backtick).
- **Variable expansion** that is quote-aware: `${VAR}` expands in double-quoted and unquoted values, but not in single-quoted values. dotenv doesn't distinguish; dotenv-expand is a separate package that patches values after the fact.
- **Line tracking** — every entry carries its line number from the source file, used in error messages and warnings. dotenv doesn't expose this.
- **Source tracking** — entries know which file they came from, critical for layered file support and debugging.
- **Warning accumulation** — unterminated quotes, invalid key names, and suspicious trailing whitespace are reported as warnings rather than silently ignored or thrown.

The parser (`parser.ts`) is a character-by-character state machine. It processes the input in a single pass with no regex for the main parsing loop (only for key name validation). This makes behavior explicit and predictable for edge cases like escape sequences inside multiline double-quoted values.

### Difficult edge cases

- **Unterminated quotes**: a missing closing quote consumes everything to EOF. All subsequent entries in that file are lost. The parser warns but doesn't error, because other files or process.env may still provide the needed keys.
- **Inline comments in unquoted values**: `KEY=value # comment` strips the comment, but `KEY=value#no-space` does not. The `#` must be preceded by whitespace to count as a comment. This matches dotenv's behavior.
- **BOM and line endings**: Windows-style `\r\n`, old Mac-style `\r`, and UTF-8 BOM (`\uFEFF`) are all normalized before parsing begins.
- **`export` prefix**: `export KEY=value` is supported (prefix stripped). This allows `.env` files to double as shell scripts.

---

## Variable expansion and topological sorting

Values can reference other variables: `URL=http://${HOST}:${PORT}`. The question is: in what order do you expand them?

### The naive approach

Expand in file order: process entries top to bottom, substitute references with whatever has been resolved so far. This means forward references don't work:

```ini
URL=http://${HOST}:${PORT}   # expanded first, HOST/PORT not yet resolved
HOST=localhost
PORT=3000
```

The user would have to carefully order their `.env` file, which gets worse with layered files where the definition might be in a different file entirely.

This is how I did the implementation initially. But then I got an idea!

### Graph-based expansion

cl-env builds a dependency graph from variable references and processes entries in topological order using Kahn's algorithm:

1. Scan each entry's value for `$VAR` / `${VAR}` references (skip single-quoted values).
2. Build an in-degree map: for each entry, count how many of its references point to other entries in the file set (ignoring self-references and references to keys not in the file set).
3. Process entries with zero in-degree first (no dependencies), then decrement dependents. This is a standard BFS topological sort.
4. After the sort completes, all entries with remaining in-degree > 0 are part of a cycle.

### Cycles

If the topological sort doesn't cover all entries, the remaining ones form one or more cycles. These are expanded best-effort (using whatever has been resolved so far) and logged as warnings. They are not errors because:
- The cyclic value might not be referenced by any config key.
- Even partial expansion may be useful for debugging.

### Self-references

`KEY=$KEY` or `KEY=${KEY}` are excluded from the dependency graph (a self-reference doesn't create a real dependency). During expansion, the reference resolves against the previously expanded entries or falls back to process.env. If neither has a value, the reference is left unexpanded (`$KEY` stays as literal `$KEY`).

### External references

References to variables not present in any file fall back to `process.env`. This is intentional: it allows `.env` files to reference system-level variables like `$HOME` or `$USER` without requiring them to be redefined.

---

## Transforms instead of schemas

Most env validation libraries (t3-env, envalid) use schema libraries like Zod for validation. cl-env uses transform functions instead:

```ts
DATABASE_URL: withRequired(toString),
PORT: withDefault(toInt, 3000),
LOG_LEVEL: toEnum("debug", "info", "warn", "error"),
```

### Why

1. **Zero dependencies.** Schema libraries are external dependencies. Transforms are plain functions built into the library.

2. **Direct type inference.** A transform's return type *is* the output type. `toInt` returns `Result<number>`, so TypeScript knows the config value is `number`. No generic schema-to-type extraction needed.

3. **Composability without complexity.** `withDefault(toInt, 3000)` is just function wrapping. The wrapper checks for `undefined`, the inner transform handles parsing. No special API for defaults/optionals/required — these are orthogonal wrappers that work with any transform.

4. **Custom transforms are trivial.** Return `success(value)` or `failure(message)`. No framework to learn, no base class to extend.

For users who want schema validation (e.g. validating a JSON blob against a Zod schema), `toJSON(schema)` delegates to a user-provided `schemaParser` function. This keeps the schema library as the user's dependency.

---

## Type inference

The goal: write the config once, get a fully typed result object with zero type annotations.

### Key tricks

**`<const TOpts>`**: The `loadEnv` signature uses `const` type parameter:

```ts
function loadEnv<const TOpts extends LoadEnvOpts, TConfig extends Config>(
    opts: TOpts, config: TConfig
): ResolveEnvResult<TOpts, TConfig>
```

The `const` modifier preserves the literal type of `transformKeys: true` (as `true`, not `boolean`). Without it, TypeScript widens to `boolean` and the conditional key mapping can't resolve.

**`SafeCamelCase<K>`**: When `transformKeys` is `true`, result keys are mapped through:

```ts
type SafeCamelCase<S extends string> = S extends Uppercase<S> ? CamelCase<S> : S;
```

This only transforms fully uppercase keys (`DATABASE_URL` → `databaseUrl`). Mixed-case keys like `myKey` pass through unchanged. The `CamelCase` type recursively splits on underscores and capitalizes each tail segment.

**`InferValueFromTransformFn<TTransform>`**: Extracts the success type from a transform's return type:

```ts
type InferValueFromTransformFn<TTransform extends TransformFn> =
    ReturnType<TTransform> extends Result<infer TData> ? TData : never;
```

This is what makes `withDefault(toInt, 3000)` produce `number` and `withOptional(toString)` produce `string | undefined` in the result type.

**`LoadEnvOpts` is not exported**. This is intentional. If users stored options in a variable, TypeScript would widen `transformKeys: true` to `boolean` (unless they added `as const` or `satisfies`). By forcing inline options, the `const` type parameter preserves the literal, and key casing inference works automatically.

---

## Error accumulation

`loadEnv` never throws. It returns `Result<T, EnvError[]>`:

```ts
type EnvError = {
    key: string;
    line?: number;
    source?: string;
    message: string;
};
```

Every config key is validated, and every failure is collected. The user sees all problems in one run, not one at a time. This matters in CI/CD where a deploy attempt might take minutes, finding out about five missing variables in one pass beats five separate failed deploys.

The `unwrap` helper throws with all messages joined by newlines for users who prefer fail-fast behavior.

---

## Reading only config keys from process.env

When `includeProcessEnv` is enabled, cl-env only reads keys that are defined in the user's config object. It does not dump all of `process.env` into the result.

This is a deliberate security and correctness choice:
- `process.env` contains hundreds of variables (PATH, HOME, shell internals, CI tokens). Exposing all of them would leak values the user never intended to use.
- Only reading config keys means the result type stays precise. The user gets exactly what they declared, nothing more.
- It prevents accidental shadowing where a system variable happens to share a name with an unrelated config key.
