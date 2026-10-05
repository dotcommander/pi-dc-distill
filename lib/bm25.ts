/**
 * bm25.ts — deterministic in-tree BM25 text ranking and code-aware tokenization.
 *
 * Implements Okapi BM25 with Lucene-style non-negative IDF:
 *   IDF(q) = ln(1 + (N - n + 0.5) / (n + 0.5))
 *
 * Zero external dependencies. 100% deterministic.
 *
 * Two tokenizers: `tokenize` stays ASCII-only (the compiler's lexical budget
 * depends on its byte-for-byte stability), while `tokenizeUnicode` adds a
 * non-ASCII supplement — Han unigrams plus non-ASCII letter runs — for recall
 * search. Only bm25Rank (the recall path) uses the Unicode-aware tokenizer.
 */

export interface BM25Document<T> {
  doc: T;
  score: number;
  index: number;
}

export interface BM25Options {
  /** Term frequency saturation parameter (default: 1.2). */
  k1?: number;
  /** Document length normalization parameter (default: 0.75). */
  b?: number;
  /** Add bonus score when doc contains exact contiguous query text (default: true). */
  boostExact?: boolean;
}

const TOKEN_PATTERN = /[A-Za-z0-9_./-]+/g;
/** Non-ASCII letter/number runs (same class family as lexical-budget's relevanceTokens). */
const UNICODE_RUN_PATTERN = /[\p{L}\p{M}\p{N}_./-]+/gu;
/** Han characters, matched one code point at a time for unigram indexing. */
const HAN_CHAR_PATTERN = /\p{Script=Han}/gu;

/**
 * Code-aware tokenization:
 * - Lowercases all text
 * - Preserves identifiers and file paths
 * - Expands camelCase, snake_case, and kebab-case into constituent subwords
 */
export function tokenize(text: string): string[] {
  if (!text || !text.trim()) return [];

  const rawMatches = text.match(TOKEN_PATTERN);
  if (!rawMatches) return [];

  const tokens: string[] = [];

  for (const raw of rawMatches) {
    const cleaned = raw.replace(/^[`'"<>{}.,;:[\]()]+|[`'"<>{}.,;:[\]()]+$/g, "");
    if (!cleaned) continue;

    const lower = cleaned.toLowerCase();
    tokens.push(lower);

    // Expand path components: e.g. "lib/recall.ts" -> "recall.ts", "recall"
    if (cleaned.includes("/")) {
      const parts = cleaned.split("/").filter(Boolean);
      for (const part of parts) {
        const partLower = part.toLowerCase();
        if (partLower !== lower) tokens.push(partLower);
        if (part.includes(".")) {
          const base = part.slice(0, part.lastIndexOf(".")).toLowerCase();
          if (base && base !== partLower) tokens.push(base);
        }
      }
    } else if (cleaned.includes(".")) {
      const base = cleaned.slice(0, cleaned.lastIndexOf(".")).toLowerCase();
      if (base && base !== lower) tokens.push(base);
    }

    // Expand camelCase: e.g. "getAuthToken" -> "auth", "token"
    const camelExpanded = cleaned
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
    if (camelExpanded !== cleaned) {
      for (const word of camelExpanded.toLowerCase().split(/\s+/)) {
        if (word && word !== lower) tokens.push(word);
      }
    }

    // Expand snake_case and kebab-case: e.g. "auth_token" -> "auth", "token"
    if (cleaned.includes("_") || cleaned.includes("-")) {
      for (const word of cleaned.toLowerCase().split(/[-_]+/)) {
        if (word && word !== lower) tokens.push(word);
      }
    }
  }

  return tokens;
}

const HAS_NON_ASCII = /[^\x00-\x7f]/;

/**
 * Unicode-aware search tokenization: the ASCII tokenizer plus a non-ASCII
 * supplement. Han characters index as single-character terms (unigrams) so
 * substring queries match unspaced Chinese text — whole runs alone cannot
 * (query 数据 vs run 数据丢失). Other non-ASCII scripts (kana, hangul,
 * Cyrillic, ...) index as whole letter runs, matching their space/segment
 * structure. ASCII output is byte-identical to tokenize().
 */
export function tokenizeUnicode(text: string): string[] {
  const ascii = tokenize(text);
  if (!HAS_NON_ASCII.test(text)) return ascii;
  const supplement: string[] = [];
  for (const run of text.match(UNICODE_RUN_PATTERN) ?? []) {
    if (HAS_NON_ASCII.test(run)) supplement.push(run.toLowerCase());
  }
  for (const [han] of text.matchAll(HAN_CHAR_PATTERN)) supplement.push(han);
  return [...ascii, ...supplement];
}
export function computeBM25Score(
  queryTokens: string[],
  docTokens: string[],
  docLength: number,
  avgdl: number,
  totalDocs: number,
  df: Map<string, number>,
  k1 = 1.2,
  b = 0.75,
): number {
  if (queryTokens.length === 0 || docTokens.length === 0 || totalDocs === 0) {
    return 0;
  }

  const tf = new Map<string, number>();
  for (const t of docTokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }

  const effectiveAvgdl = avgdl > 0 ? avgdl : 1;
  const uniqueQueryTerms = new Set(queryTokens);
  let score = 0;

  for (const term of uniqueQueryTerms) {
    const n = df.get(term) ?? 0;
    if (n === 0) continue;

    const freq = tf.get(term) ?? 0;
    if (freq === 0) continue;

    // Lucene non-negative IDF: ln(1 + (N - n + 0.5) / (n + 0.5))
    const idf = Math.log(1 + (totalDocs - n + 0.5) / (n + 0.5));
    const tfPart = (freq * (k1 + 1)) / (freq + k1 * (1 - b + b * (docLength / effectiveAvgdl)));
    score += idf * tfPart;
  }

  return score;
}

/**
 * Rank an array of documents against a text query using BM25.
 * Uses the Unicode-aware tokenizer: CJK content and queries rank correctly
 * (Han unigrams + non-ASCII letter runs supplement the ASCII terms).
 * Only returns documents with score > 0, sorted descending by score.
 * Equal scores preserve original array order (deterministic tie-breaking).
 */
export function bm25Rank<T>(
  docs: T[],
  getText: (doc: T) => string,
  query: string,
  options: BM25Options = {},
): BM25Document<T>[] {
  const qTokens = tokenizeUnicode(query);
  if (qTokens.length === 0 || docs.length === 0) return [];

  const k1 = options.k1 ?? 1.2;
  const b = options.b ?? 0.75;
  const boostExact = options.boostExact ?? true;

  const docTexts = docs.map(getText);
  const tokenizedDocs = docTexts.map(tokenizeUnicode);
  const totalDocs = docs.length;

  const totalTokens = tokenizedDocs.reduce((sum, tokens) => sum + tokens.length, 0);
  const avgdl = totalTokens / (totalDocs || 1);

  // Document frequencies
  const df = new Map<string, number>();
  for (const docTokens of tokenizedDocs) {
    for (const term of new Set(docTokens)) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  const normalizedQuery = query.toLowerCase().trim();
  const scored: BM25Document<T>[] = [];

  for (let i = 0; i < docs.length; i++) {
    const docTokens = tokenizedDocs[i];
    let score = computeBM25Score(
      qTokens,
      docTokens,
      docTokens.length,
      avgdl,
      totalDocs,
      df,
      k1,
      b,
    );

    if (score > 0) {
      if (boostExact && normalizedQuery.length > 0 && docTexts[i].toLowerCase().includes(normalizedQuery)) {
        score += 1.0;
      }
      scored.push({ doc: docs[i], score, index: i });
    }
  }

  // Sort descending by score, deterministic tie-breaking on index
  return scored.sort((a, b) => b.score - a.score || a.index - b.index);
}
