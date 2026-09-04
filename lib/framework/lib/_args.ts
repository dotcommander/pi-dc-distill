/**
 * Args — quote-aware command-string tokenizer + declarative flag parser.
 *
 * `registerCommand` handlers receive a single raw string. The naive
 * `raw.split(/\s+/)` breaks the moment a user quotes a value
 * (`--name "two words"` becomes three tokens, the quotes leak through),
 * so every dc-* command that takes flags has hand-rolled a ~30-line
 * tokenizer + ad-hoc flag loop. This facade is that loop, once:
 * `Args.tokenize` does the quote-aware split, `Args.parse` resolves a
 * declarative `FlagDef[]` schema (canonical names, aliases, value flags,
 * `--name value` AND `--name=value` forms) into a structured result.
 *
 * Pure and total — no I/O, no `ctx`, never throws. Bad input lands in
 * `result.errors`; the caller decides whether to surface it.
 */

export interface FlagDef {
  /** Canonical flag name, e.g. "--model". */
  name: string;
  /** Additional spellings that resolve to `name`, e.g. ["-m", "model"]. */
  aliases?: string[];
  /** When true, the flag consumes a value (next token, or `--name=value`). */
  hasValue?: boolean;
}

export interface ParseOptions {
  /** What to do with a `-`/`--`-prefixed token not in the schema. Default "error". */
  unknownFlags?: "error" | "positional";
}

export interface ParseResult {
  /** Boolean flags that were present (keyed by canonical `name`). */
  flags: Record<string, boolean>;
  /** Value flags and their string values (keyed by canonical `name`). */
  values: Record<string, string>;
  /** Everything that wasn't a recognised flag, in order. */
  positional: string[];
  /** Human-readable problems — unknown flags, missing values. Never thrown. */
  errors: string[];
}

// Composite runs: bare text and attached quoted segments form ONE token, so
// `--flag="two words"` survives as a single token instead of splitting at `"`.
const TOKEN_RE = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g;

function stripQuotes(tok: string): string {
  // Remove paired quotes anywhere in the token:
  //   --name="two words"  →  --name=two words
  //   "two words"         →  two words
  if (!tok.includes('"') && !tok.includes("'")) return tok;
  return tok.replace(/"([^"]*)"|'([^']*)'/g, (_, d, s) => d ?? s ?? "");
}

function hasUnclosedQuote(input: string): boolean {
  let quote: '"' | "'" | undefined;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch !== '"' && ch !== "'") continue;
    if (quote === undefined) {
      quote = ch;
    } else if (quote === ch) {
      quote = undefined;
    }
  }
  return quote !== undefined;
}

function flagKey(token: string): string {
  const eq = token.indexOf("=");
  return eq === -1 ? token : token.slice(0, eq);
}

export const Args = {
  /**
   * Quote-aware split. Quoted runs survive as one token with the quotes
   * stripped, including attached forms (`--name="two words"`). No escape
   * handling — quotes don't nest.
   */
  tokenize(input: string): string[] {
    const out: string[] = [];
    const matches = input.match(TOKEN_RE);
    if (!matches) return out;
    for (const m of matches) out.push(stripQuotes(m));
    return out;
  },

  /**
   * Tokenize, then resolve a `FlagDef[]` schema. Supports `--name value`
   * and `--name=value` for value flags; bare `--name` for boolean flags.
   * Unknown flags become errors (or positionals, per `opts.unknownFlags`).
   * Never throws — problems land in `result.errors`.
   */
  parse(
    input: string,
    flags: FlagDef[] = [],
    opts: ParseOptions = {},
  ): ParseResult {
    const result: ParseResult = {
      flags: {},
      values: {},
      positional: [],
      errors: [],
    };
    const unknownMode = opts.unknownFlags ?? "error";
    const canon = new Map<string, FlagDef>();
    for (const def of flags) {
      canon.set(def.name, def);
      for (const a of def.aliases ?? []) canon.set(a, def);
    }
    const tokens = Args.tokenize(input);
    if (hasUnclosedQuote(input)) {
      result.errors.push("unclosed quote in arguments");
    }
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!tok.startsWith("-") || tok === "-" || tok === "--") {
        result.positional.push(tok);
        continue;
      }
      const eq = tok.indexOf("=");
      const key = flagKey(tok);
      const inlineValue = eq === -1 ? undefined : tok.slice(eq + 1);
      const def = canon.get(key);
      if (!def) {
        if (unknownMode === "positional") result.positional.push(tok);
        else result.errors.push(`unknown flag: ${key}`);
        continue;
      }
      if (def.hasValue) {
        let value = inlineValue;
        if (value === undefined) {
          const next = tokens[i + 1];
          if (next === undefined) {
            result.errors.push(`flag ${def.name} expects a value`);
            continue;
          }
          if (next.startsWith("-") && canon.has(flagKey(next))) {
            result.errors.push(`flag ${def.name} expects a value`);
            continue;
          }
          value = next;
          i++;
        }
        result.values[def.name] = value;
      } else {
        result.flags[def.name] = true;
      }
    }
    return result;
  },
} as const;
