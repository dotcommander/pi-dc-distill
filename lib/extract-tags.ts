/**
 * XML tag content extractor.
 *
 * Extracted from engine/shared.ts (now deleted) since strategy.ts still uses it
 * as a fallback parser for readFiles/modifiedFiles marker blocks.
 */

/** Extract content between XML markers (`<tag>...</tag>`). */
export const extractTagContent = (text: string, tag: string): string[] => {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = text.indexOf(open);
  if (start < 0) return [];
  const end = text.indexOf(close, start);
  if (end < 0) return [];
  return text.slice(start + open.length, end)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
};
