/**
 * recall_compaction — search prior compaction summaries.
 *
 * Queries explicit summary entries by section name or keyword.
 * DistillStore owns all recall persistence.
 *
 * Deterministic, no LLM. Pure search.
 */

import type { CompactionRecallEntry } from "./recall-entry.ts";

export type RecallEntry = CompactionRecallEntry;

/** Extract a named section from summary markdown. */
const extractSection = (text: string, heading: string): string | null => {
  const tag = `## ${heading}`;
  const start = text.indexOf(tag);
  if (start < 0) return null;
  const after = text.slice(start + tag.length);
  let end = after.length;
  for (const marker of ["\n## ", "\n### ", "\n<"]) {
    const idx = after.indexOf(marker);
    if (idx > 0 && idx < end) end = idx;
  }
  const sepIdx = after.indexOf("\n\n---\n\n");
  if (sepIdx > 0 && sepIdx < end) end = sepIdx;
  return after.slice(0, end).trim() || null;
};

const SECTIONS = ["Session", "User Focus", "Conversation"] as const;

const MARKER_BLOCKS = [
  "read-files",
  "modified-files",
  "recent-tool-calls",
  "recent-tool-results",
  "verification",
  "working-tree",
  "source-anchors",
  "active-tasks",
  "resume-tasks",
  "resume-index",
] as const;

/** Extract a `<name>...</name>` marker block from summary markdown. */
const extractMarker = (text: string, name: string): string | null => {
  const open = `<${name}>`;
  const close = `</${name}>`;
  const start = text.indexOf(open);
  if (start < 0) return null;
  const end = text.indexOf(close, start);
  if (end < 0) return null;
  return text.slice(start + open.length, end).trim() || null;
};

interface SummaryPart {
  /** lowercase name matched against name-queries */
  name: string;
  /** label prefixed to results */
  label: string;
  extract: (text: string) => string | null;
}

const SUMMARY_PARTS: SummaryPart[] = [
  ...SECTIONS.map((s) => ({
    name: s.toLowerCase(),
    label: `## ${s}`,
    extract: (t: string) => extractSection(t, s),
  })),
  ...MARKER_BLOCKS.map((m) => ({
    name: m,
    label: `<${m}>`,
    extract: (t: string) => extractMarker(t, m),
  })),
];

/** Search an explicit recall set, allowing callers to choose project/all scope. */
export const searchRecallEntries = (
  entries: RecallEntry[],
  query: string,
  limit = 3,
): string[] => {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  // Name query: q names a heading section or marker block (exact or prefix).
  const named = SUMMARY_PARTS.filter(
    (part) => part.name === q || part.name.startsWith(q),
  );

  const results: string[] = [];
  for (const entry of entries) {
    if (results.length >= limit) break;
    const parts = named.length > 0 ? named : SUMMARY_PARTS;
    for (const part of parts) {
      const content = part.extract(entry.summary);
      if (!content) continue;
      if (named.length === 0 && !content.toLowerCase().includes(q)) continue;
      results.push(
        `[${entry.ts} | ${entry.before}→${entry.after} tokens]\n${part.label}\n${content}`,
      );
      break; // one part per entry
    }
  }
  return results;
};
