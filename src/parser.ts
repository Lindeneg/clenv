import type {ParsedEntry, ParseWarning} from "./types.js";

export function parseDotenv(
    raw: string,
    source: string
): {entries: ParsedEntry[]; warnings: ParseWarning[]} {
    // strip BOM
    if (raw.charCodeAt(0) === 0xfeff) {
        raw = raw.slice(1);
    }
    // normalize line endings
    raw = raw.replace(/\r\n?/g, "\n");

    const entries: ParsedEntry[] = [];
    const warnings: ParseWarning[] = [];
    let pos = 0;
    let line = 1;

    function advance(): string | undefined {
        const ch = raw[pos++];
        if (ch === "\n") line++;
        return ch;
    }

    function skipInlineWhitespace() {
        while (pos < raw.length && (raw[pos] === " " || raw[pos] === "\t")) {
            pos++;
        }
    }

    function skipToNewline() {
        while (pos < raw.length && raw[pos] !== "\n") pos++;
        if (pos < raw.length) advance();
    }

    function handleQuote(quote: "'" | "`", entryLine: number, key: string): string {
        const start = pos + 1;
        let terminated = false;
        let value = "";
        advance();
        while (pos < raw.length) {
            if (raw[pos] === quote) {
                value = raw.slice(start, pos);
                advance();
                terminated = true;
                break;
            }
            advance();
        }
        if (!terminated) {
            value = raw.slice(start, pos);
            const consumed = line - entryLine;
            warnings.push({
                line: entryLine,
                message: `${key}: unterminated ${quote === "`" ? "backtick" : "single"} quote, consumed ${consumed} line(s) to EOF`,
            });
        }
        return value;
    }

    while (pos < raw.length) {
        skipInlineWhitespace();

        if (raw[pos] === "\n") {
            advance();
            continue;
        }

        // comment line
        if (raw[pos] === "#") {
            skipToNewline();
            continue;
        }

        // strip `export ` prefix
        if (raw.startsWith("export ", pos)) {
            pos += 7;
            skipInlineWhitespace();
        }

        const entryLine = line;

        // read key
        let key = "";
        while (pos < raw.length) {
            const c = raw[pos];
            if (c === "=" || c === " " || c === "\t" || c === "\n") break;
            key += advance();
        }

        if (!key) {
            skipToNewline();
            continue;
        }

        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
            warnings.push({
                line: entryLine,
                message: `${key}: invalid key name (expected [A-Za-z_][A-Za-z0-9_]*)`,
            });
        }

        skipInlineWhitespace();

        if (raw[pos] !== "=") {
            skipToNewline();
            continue;
        }
        // consume =
        advance();

        skipInlineWhitespace();

        let value = "";
        const quote = raw[pos];

        if (quote === '"') {
            // double-quoted: escape sequences, multiline
            const parts: string[] = [];
            let terminated = false;
            advance();
            while (pos < raw.length) {
                const c = raw[pos];
                if (c === "\\") {
                    advance();
                    if (pos >= raw.length) break;
                    const esc = advance();
                    switch (esc) {
                        case "n":
                            parts.push("\n");
                            break;
                        case "r":
                            parts.push("\r");
                            break;
                        case "t":
                            parts.push("\t");
                            break;
                        case "\\":
                            parts.push("\\");
                            break;
                        case '"':
                            parts.push('"');
                            break;
                        default:
                            parts.push("\\" + esc);
                            break;
                    }
                } else if (c === '"') {
                    advance();
                    terminated = true;
                    break;
                } else {
                    const ch = advance();
                    if (ch !== undefined) parts.push(ch);
                }
            }
            value = parts.join("");
            if (!terminated) {
                const consumed = line - entryLine;
                warnings.push({
                    line: entryLine,
                    message: `${key}: unterminated double quote, consumed ${consumed} line(s) to EOF`,
                });
            }
        } else if (quote === "'" || quote === "`") {
            value = handleQuote(quote, entryLine, key);
        } else {
            // unquoted: single line, inline comments, trim trailing whitespace, use slice
            // pos++ (not advance()) is safe here: loop breaks on \n so line counter stays correct
            const start = pos;
            let commentAt = -1;
            while (pos < raw.length && raw[pos] !== "\n") {
                if (
                    raw[pos] === "#" &&
                    pos > start &&
                    (raw[pos - 1] === " " || raw[pos - 1] === "\t")
                ) {
                    commentAt = pos;
                    break;
                }
                pos++;
            }
            const rawValue = raw.slice(start, commentAt >= 0 ? commentAt : pos);
            value = rawValue.trimEnd();
            if (commentAt < 0 && value.length < rawValue.length) {
                warnings.push({
                    line: entryLine,
                    message: `${key}: suspicious trailing whitespace in unquoted value`,
                });
            }
        }

        // consume rest of line after quoted value
        skipToNewline();

        const quoted = quote === '"' || quote === "'" || quote === "`" ? quote : undefined;
        entries.push({key, value, line: entryLine, source, ...(quoted && {quoted})});
    }

    return {entries, warnings};
}
