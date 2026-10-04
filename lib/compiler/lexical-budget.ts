import { tokenize } from "../bm25.ts";
import { codePointLength, codePointPrefix } from "../unicode.ts";

/** Unicode terms affect relevance only; original bytes and authority classifiers stay intact.
 * ASCII tokenization remains byte-for-byte compatible with the existing tokenizer. */
export function relevanceTokens(text: string): string[] {
  const ascii = tokenize(text);
  if (!/[^\x00-\x7f]/.test(text)) return ascii;
  const unicode = [...text.matchAll(/[\p{L}\p{M}\p{N}_./-]+/gu)]
    .map(match => match[0]).filter(term => /[^\x00-\x7f]/.test(term)).map(term => term.toLowerCase());
  return [...ascii, ...unicode];
}

/** Optional ranking has a shared operation budget; exhaustion never drops declarations. */
export class LexicalBudget {
  incomplete = false;
  private characters = 0;
  private tokens = 0;
  private terms = new Set<string>();
  private cache = new Map<string, string[]>();
  tokenize(text: string): string[] {
    const cached = this.cache.get(text);
    if (cached) return cached;
    const remaining = 1_048_576 - this.characters;
    if (remaining <= 0 || this.tokens >= 65_536) { this.incomplete = true; return []; }
    const bounded = codePointPrefix(text, remaining);
    this.characters += codePointLength(bounded);
    if (bounded.length !== text.length) this.incomplete = true;
    const result: string[] = [];
    for (const token of relevanceTokens(bounded)) {
      if (codePointLength(token) > 128) { this.incomplete = true; continue; }
      if (this.tokens >= 65_536 || (!this.terms.has(token) && this.terms.size >= 16_384)) { this.incomplete = true; break; }
      this.tokens++; this.terms.add(token); result.push(token);
    }
    this.cache.set(text, result);
    return result;
  }
}
