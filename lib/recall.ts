/**
 * recall_compaction — search prior compaction summaries.
 *
 * Stores recent summaries in memory and exposes a pi tool for
 * the LLM to search them by section name or keyword.
 *
 * Deterministic, no LLM. Pure search.
 */

import { Path, type PathHandle } from "./paths.ts";

export interface RecallEntry {
  /** ISO timestamp of the compaction */
  ts: string;
  /** Token count before compaction */
  before: number;
  /** Token count after compaction */
  after: number;
  /** The full summary markdown */
  summary: string;
  /** Project owner for version-6 recall. Missing only on legacy entries. */
  project?: string;
  sessionId?: string;
  fullContextAfter?: number;
  fullContextAfterSource?: "pi-post-rebuild-context-usage";
  tokenSource?: string;
  owner?: "legacy-unscoped";
}

const MAX_STORED = 10;
const RECALL_FILE = "recall.json";

/** In-memory ring buffer of recent compaction summaries. */
const store: RecallEntry[] = [];

/** Reset the store (called on session_start). */
export const resetStore = (): void => {
  store.length = 0;
};

/** Record a new compaction summary for recall. */
export const recordSummary = (entry: RecallEntry): void => {
  store.push(entry);
  if (store.length > MAX_STORED) store.shift();
};

/** Get all stored summaries (newest first). */
export const getSummaries = (): RecallEntry[] => [...store].reverse();

export const hydrateSummaries = (entries: RecallEntry[]): void => {
  resetStore();
  for (const entry of entries.slice(-MAX_STORED)) recordSummary(entry);
};

function isRecallEntry(value: unknown): value is RecallEntry {
  if (value === null || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return hasRecallEntryFields(entry);
}

function hasRecallEntryFields(entry: Record<string, unknown>): boolean {
  return typeof entry.ts === "string"
    && typeof entry.before === "number"
    && typeof entry.after === "number"
    && typeof entry.summary === "string";
}

export const loadPersistedSummaries = (
  pathHandle: PathHandle = Path.data("dc-distill"),
): RecallEntry[] => {
  try {
    const parsed = pathHandle.read<unknown>(RECALL_FILE, []);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecallEntry).slice(-MAX_STORED);
  } catch {
    return [];
  }
};

export const persistSummary = (
  entry: RecallEntry,
  pathHandle: PathHandle = Path.data("dc-distill"),
): void => {
  try {
    const entries = [...loadPersistedSummaries(pathHandle), entry].slice(-MAX_STORED);
    pathHandle.write(RECALL_FILE, entries);
  } catch {
    // recall persistence must never crash compaction
  }
};

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

/** Search stored summaries by section name or keyword.
 *  Returns matching content, newest first. */
export const searchSummaries = (
  query: string,
  limit = 3,
): string[] => {
  return searchRecallEntries(getSummaries(), query, limit);
};

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
