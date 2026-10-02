/**
 * recall_compaction — search prior compaction summaries.
 *
 * Queries explicit summary entries by section name or keyword.
 * DistillStore owns all recall persistence.
 *
 * Deterministic, no LLM. Pure search.
 */

import type { CompactionRecallEntry } from "./recall-entry.ts";
import { bm25Rank } from "./bm25.ts";
import { codePointLength } from "./unicode.ts";

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
  "retained-context",
  "resume-state",
  "current-intent",
  "resume-risks",
  "file-evidence",
  "summary-omissions",
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
  "change-impact",
  "ready-tasks",
  "graph-ready-tasks",
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

interface CandidatePart {
  entry: RecallEntry;
  entryIndex: number;
  part: SummaryPart;
  partIndex: number;
  content: string;
}

/** The tool joins results with this separator; include it in the wire budget. */
export const RECALL_SEPARATOR = "\n\n---\n\n";
const MAX_OUTPUT_POINTS = 8192;
const points = codePointLength;
const escapeMarkers = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const oneLine = (text: string): string => escapeMarkers(text.replace(/\s+/g, " ").trim());

function renderResult(entry: RecallEntry, part: SummaryPart, content: string): string {
  const provenance = `project: ${oneLine(entry.project ?? entry.owner ?? "legacy-unscoped")} | session: ${oneLine(entry.sessionId ?? "legacy-unscoped")}`;
  const header = `[${oneLine(entry.ts)} | ${entry.before}→${entry.after} tokens | ${provenance}]`;
  const closing = part.label.startsWith("<") ? `\n</${part.name}>` : "";
  return `${header}\n${part.label}\n${escapeMarkers(content)}${closing}`;
}

function boundedResults(results: string[]): string[] {
  const retained = [...results];
  let omitted = 0;
  const notice = () => omitted ? `\n[Recall omitted ${omitted} result(s) to fit the output budget.]` : "";
  while (retained.length > 1 && points(retained.join(RECALL_SEPARATOR) + notice()) > MAX_OUTPUT_POINTS) {
    retained.pop();
    omitted++;
  }
  if (!retained.length) return [];
  if (points(retained.join(RECALL_SEPARATOR) + notice()) <= MAX_OUTPUT_POINTS) {
    retained[retained.length - 1] += notice();
    return retained;
  }
  // Attribution and marker framing are mandatory as one indivisible record.
  // Only body lines may be omitted; never restore a close without its opening.
  const lines = retained[0].split("\n");
  const frame = lines.splice(0, 2);
  const closing = /^<\/[a-z-]+>$/.test(lines.at(-1) ?? "") ? lines.pop()! : "";
  const excerptNotice = (count: number) => `[Recall omitted ${count} line(s) from this result.]`;
  const renderExcerpt = (body: string[], count: number) =>
    [...frame, ...body, excerptNotice(count), ...(closing ? [closing] : [])].join("\n") + notice();
  if (points(renderExcerpt([], lines.length)) > MAX_OUTPUT_POINTS) {
    omitted++;
    return [notice().trimStart()];
  }
  const kept: string[] = [];
  let omittedLines = 0;
  for (const line of lines) {
    // Reserve the largest possible omission count while choosing whole lines.
    if (points(renderExcerpt([...kept, line], lines.length)) <= MAX_OUTPUT_POINTS) kept.push(line);
    else omittedLines++;
  }
  return [renderExcerpt(kept, omittedLines)];
}

/** Search an explicit recall set, allowing callers to choose project/all scope. */
export const searchRecallEntries = (
  entries: RecallEntry[],
  query: string,
  limit = 3,
): string[] => {
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit <= 0) {
    throw new RangeError("Recall limit must be a finite positive integer.");
  }
  limit = Math.min(limit, 20);
  const q = query.toLowerCase().trim();
  if (!q) return [];

  // Name query: q names a heading section or marker block (exact or prefix).
  const named = SUMMARY_PARTS.filter(
    (part) => part.name === q || part.name.startsWith(q),
  );

  if (named.length > 0) {
    const results: string[] = [];
    for (const entry of entries) {
      if (results.length >= limit) break;
      for (const part of named) {
        const content = part.extract(entry.summary);
        if (!content) continue;
        results.push(renderResult(entry, part, content));
        break; // one part per entry
      }
    }
    return boundedResults(results);
  }

  // Keyword query: rank all available parts across entries using BM25
  const candidates: CandidatePart[] = [];
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    const entry = entries[entryIndex];
    for (let partIndex = 0; partIndex < SUMMARY_PARTS.length; partIndex++) {
      const part = SUMMARY_PARTS[partIndex];
      const content = part.extract(entry.summary);
      if (content) {
        candidates.push({ entry, entryIndex, part, partIndex, content });
      }
    }
  }

  if (candidates.length === 0) return [];

  const ranked = bm25Rank(candidates, (c) => c.content, query);
  const seenEntries = new Set<number>();
  const results: string[] = [];

  for (const match of ranked) {
    if (seenEntries.has(match.doc.entryIndex)) continue;
    seenEntries.add(match.doc.entryIndex);
    results.push(renderResult(match.doc.entry, match.doc.part, match.doc.content));
    if (results.length >= limit) break;
  }

  return boundedResults(results);
};
