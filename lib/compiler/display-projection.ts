import { codePointLength } from "../unicode.ts";
import type { ConversationTurn, ResumeIndex } from "./types.ts";

export const DISPLAY_SCAN_LIMITS = Object.freeze({ recordCodePoints: 65_536, compilationCodePoints: 262_144, compilationTokens: 32_768 });

/** Display work has its own budget; lexical/evidence admission never depends on it. */
export class DisplayProjectionBudget {
  private codePoints = 0;
  private tokens = 0;
  private exhausted = false;

  project(text: string, protectedText = false): string {
    if (this.exhausted || protectedText) return text;
    // UTF-16 length upper-bounds code points. Proven small records cannot reach
    // phrase admission or either boundary; keep their exact Unicode accounting.
    if (text.length < 128 && text.length <= DISPLAY_SCAN_LIMITS.recordCodePoints &&
        this.codePoints + text.length <= DISPLAY_SCAN_LIMITS.compilationCodePoints) {
      this.codePoints += codePointLength(text);
      return text;
    }
    let size = 0;
    for (const _ of text) {
      size++;
      if (this.codePoints + size > DISPLAY_SCAN_LIMITS.compilationCodePoints) {
        this.exhausted = true;
        return text;
      }
      if (size > DISPLAY_SCAN_LIMITS.recordCodePoints) {
        this.codePoints += size;
        return text;
      }
    }
    this.codePoints += size;
    if (size < 128 || !plainProse(text)) return text;
    const words: Array<{ text: string; start: number; end: number; gap: string }> = [];
    const matches = text.matchAll(/\S+/g);
    for (const match of matches) {
      if (this.tokens + words.length + 1 > DISPLAY_SCAN_LIMITS.compilationTokens) {
        this.exhausted = true;
        return text; // Reserve the whole record before producing any replacement.
      }
      const start = match.index!;
      const previous = words.at(-1);
      if (previous) previous.gap = text.slice(previous.end, start);
      words.push({ text: match[0], start, end: start + match[0].length, gap: "" });
    }
    this.tokens += words.length;
    let cursor = 0;
    let out = "";
    for (let i = 0; i < words.length;) {
      let next = i + 1;
      for (let period = 1; period <= 16 && i + 3 * period <= words.length; period++) {
        let end = i + period;
        while (end + period <= words.length) {
          let equal = true;
          for (let offset = 0; offset < period; offset++) {
            const k = end + offset;
            if (words[k].text !== words[i + offset].text ||
                words[k - 1].gap !== words[i + (k - i - 1) % period].gap) {
              equal = false; break;
            }
          }
          if (!equal) break;
          end += period;
        }
        const count = (end - i) / period;
        if (count < 3 || codePointLength(text.slice(words[i].start, words[end - 1].end)) < 128) continue;
        out += text.slice(cursor, words[i + period - 1].end) + ` [repeated ${count} times]`;
        cursor = words[end - 1].end;
        next = end;
        break; // The first qualifying period is the shortest exact phrase.
      }
      i = next;
    }
    return out ? out + text.slice(cursor) : text;
  }
}

function plainProse(text: string): boolean {
  // Uncertain syntax stays verbatim. This is background prose, not a parser for
  // runnable commands, source, declarations, receipts or structured literals.
  return !/[`{}\[\]|\\]/.test(text) && !/<\/?[A-Za-z][^>]*>/.test(text) &&
    !/^(?:\s*(?:#{1,6}\s|[-+*]\s|\d+[.)]\s|>|@@|diff --git|\$\s))/m.test(text) &&
    !/\b(?:PASS|FAIL|INCOMPLETE|BLOCKED|sha256|checkpointDigest|inputDigest|summaryDigest)\b/.test(text) &&
    !/\b(?:cwd|runner|command|exitCode|callId)\s*[:=]/i.test(text) &&
    !/\b(?:Next choice|Remaining work|Verification|Decision|TODO)\s*:/i.test(text) &&
    !/(?:^|\n)\s*(?:bun|npm|npx|pnpm|yarn|git|go|cargo|python\d*|bash|sh|curl|rm|sudo|echo|printf|cd|pwd|export|source|eval|exec|set|unset|read|test|cat|sed|awk|rg|grep|find|ls|cp|mv|mkdir|touch|chmod)\s/.test(text) &&
    !/(?:^|\n)\s*(?:(?:const|let|var|function|class|interface|type|import|export|def|return)\s|[A-Za-z_]\w*\s*=)/.test(text) &&
    !/\b[\w./-]+\.(?:ts|js|go|py|rs|sql|json|yaml|toml)\b|https?:\/\/|\b[a-f0-9]{32,}\b/i.test(text);
}

/** Only same-occurrence display duplicates disappear; canonical intent is untouched. */
export function visibleUserIntents(index: ResumeIndex, visibleTurns: ConversationTurn[]): string[] {
  return (index.displayIntents ?? index.recentUserIntents).filter(value => {
    if (index.checkpoint?.pins.some(pin => pin.status === "active" && pin.purpose === "request" && pin.text === value)) return true;
    const occurrence = index.intentOccurrences?.find(item => item.text === value);
    if (!occurrence) return true;
    const matches = visibleTurns.filter(turn => turn.sourceSequence === occurrence.sourceSequence && turn.role === "user" && turn.origin !== "custom");
    return matches.length !== 1 || (matches[0].displayText ?? matches[0].text) !== value;
  });
}
