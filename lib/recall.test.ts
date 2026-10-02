// Explicit-entry recall query contracts.
// Run: bun test lib/recall.test.ts

import { describe, test, expect, beforeEach } from "bun:test";
import { searchRecallEntries, type RecallEntry } from "./recall.ts";

// --- Fixtures ---

const makeSummary = (
  sections: Record<string, string>,
  markers: Record<string, string> = {},
): string => [
  ...Object.entries(sections).map(([heading, body]) => `## ${heading}\n${body}`),
  ...Object.entries(markers).map(([name, body]) => `<${name}>\n${body}\n</${name}>`),
].join("\n\n");

const makeEntry = (
  ts: string,
  before: number,
  after: number,
  sections: Record<string, string>,
  markers: Record<string, string> = {},
): RecallEntry => ({
  ts,
  before,
  after,
  summary: makeSummary(sections, markers),
});

const V4_PARTS = {
  sections: {
    Session: "Tokens before: 100000; after: 2000",
    "User Focus": "Prioritize recall taxonomy alignment",
    Conversation: "User asked about auth. Assistant explained JWT.",
  },
  markers: {
    "read-files": "lib/recall.ts",
    "modified-files": "lib/recall.ts\nlib/recall.test.ts",
    "recent-tool-calls": "read lib/recall.ts",
    "recent-tool-results": "recall.ts current taxonomy inspected",
    verification: "PASS bun test lib/recall.test.ts",
    "working-tree": "M lib/recall.ts",
    "source-anchors": "/tmp/source/anchors/auth.md",
    "active-tasks": "task-123 in_progress",
    "resume-tasks": "resume recall test rewrite",
    "resume-index": "1. Continue with verification",
  },
};

const ARCHIVE_PARTS = {
  sections: {
    Session: "Tokens before: 120000; after: 2500",
    Conversation: "Archived old records to cold storage",
  },
  markers: {
    verification: "PASS archive smoke test",
    "resume-index": "1. Check archive retention",
  },
};

// --- Tests ---

let entries: RecallEntry[] = [];

describe("recall", () => {
  beforeEach(() => {
    entries = [];
  });

  test("queries only the supplied entries without mutation or ambient state", () => {
    const first = [makeEntry("first", 100, 20, { Conversation: "First scope" })];
    const second = [makeEntry("second", 100, 20, { Conversation: "Second scope" })];
    const snapshot = JSON.stringify(first);
    expect(searchRecallEntries(first, "Conversation")[0]).toContain("First scope");
    expect(searchRecallEntries(second, "Conversation")[0]).toContain("Second scope");
    expect(searchRecallEntries([], "Conversation")).toEqual([]);
    expect(JSON.stringify(first)).toBe(snapshot);
  });

  // ── searchRecallEntries — part name queries ─────────────────────────────

  test("name query conversation returns the Conversation section content", () => {
    entries.unshift(makeEntry("2026-01-01T00:00:00Z", 100, 20, V4_PARTS.sections, V4_PARTS.markers));
    const results = searchRecallEntries(entries, "conversation");
    expect(results).toHaveLength(1);
    expect(results[0]).toContain("## Conversation");
    expect(results[0]).toContain("Assistant explained JWT");
  });

  test("name query verification returns the verification marker block content", () => {
    entries.unshift(makeEntry("2026-01-01T00:00:00Z", 100, 20, V4_PARTS.sections, V4_PARTS.markers));
    const results = searchRecallEntries(entries, "verification");
    expect(results).toHaveLength(1);
    expect(results[0]).toContain("<verification>");
    expect(results[0]).toContain("PASS bun test lib/recall.test.ts");
  });

  test("name-prefix query matches resume-index", () => {
    entries.unshift(makeEntry("2026-01-01T00:00:00Z", 100, 20, V4_PARTS.sections, V4_PARTS.markers));
    const results = searchRecallEntries(entries, "resume-i");
    expect(results).toHaveLength(1);
    expect(results[0]).toContain("<resume-index>");
    expect(results[0]).toContain("Continue with verification");
  });

  test("returns empty for non-existent part", () => {
    entries.unshift(makeEntry("2026-01-01T00:00:00Z", 100, 20, V4_PARTS.sections, V4_PARTS.markers));
    expect(searchRecallEntries(entries, "nonexistent-part")).toHaveLength(0);
  });

  test("searches across multiple entries, newest first", () => {
    entries.unshift(makeEntry("2026-01-01T00:00:00Z", 100, 20, V4_PARTS.sections, V4_PARTS.markers));
    entries.unshift(makeEntry("2026-01-02T00:00:00Z", 120, 25, ARCHIVE_PARTS.sections, ARCHIVE_PARTS.markers));
    const results = searchRecallEntries(entries, "Conversation");
    expect(results).toHaveLength(2);
    expect(results[0]).toContain("Archived old records");
    expect(results[1]).toContain("Assistant explained JWT");
  });

  test("respects limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      entries.unshift(makeEntry(`2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`, 100, 20, { Conversation: `Conversation ${i}` }));
    }
    const results = searchRecallEntries(entries, "Conversation", 2);
    expect(results).toHaveLength(2);
  });

  // ── searchRecallEntries — keyword queries ───────────────────────────────

  test("finds by keyword in a heading section", () => {
    entries.unshift(makeEntry("2026-01-01T00:00:00Z", 100, 20, V4_PARTS.sections, V4_PARTS.markers));
    const results = searchRecallEntries(entries, "JWT");
    expect(results).toHaveLength(1);
    expect(results[0]).toContain("## Conversation");
  });

  test("finds by keyword that lives only inside a marker block", () => {
    entries.unshift(makeEntry("2026-01-01T00:00:00Z", 100, 20, V4_PARTS.sections, V4_PARTS.markers));
    const results = searchRecallEntries(entries, "/tmp/source/anchors/auth.md");
    expect(results).toHaveLength(1);
    expect(results[0]).toContain("<source-anchors>");
    expect(results[0]).toContain("/tmp/source/anchors/auth.md");
  });

  test("keyword search is case-insensitive", () => {
    entries.unshift(makeEntry("2026-01-01T00:00:00Z", 100, 20, V4_PARTS.sections, V4_PARTS.markers));
    expect(searchRecallEntries(entries, "jwt")).toHaveLength(1);
    expect(searchRecallEntries(entries, "Jwt")).toHaveLength(1);
  });

  test("returns empty when keyword not found", () => {
    entries.unshift(makeEntry("2026-01-01T00:00:00Z", 100, 20, V4_PARTS.sections, V4_PARTS.markers));
    expect(searchRecallEntries(entries, "nonexistent_keyword_xyz")).toHaveLength(0);
  });

  test("keyword search returns one part per entry (first match)", () => {
    entries.unshift(makeEntry("2026-01-01T00:00:00Z", 100, 20, {
      Session: "Shared token evidence",
      Conversation: "Shared token appears later",
    }));
    const results = searchRecallEntries(entries, "Shared token");
    expect(results).toHaveLength(1);
    expect(results[0]).toContain("## Session");
  });

  // ── searchRecallEntries — edge cases ───────────────────────────────────

  test("returns empty for empty query", () => {
    entries.unshift(makeEntry("2026-01-01T00:00:00Z", 100, 20, V4_PARTS.sections));
    expect(searchRecallEntries(entries, "")).toHaveLength(0);
    expect(searchRecallEntries(entries, "   ")).toHaveLength(0);
  });

  test("returns empty when store is empty", () => {
    expect(searchRecallEntries(entries, "Conversation")).toHaveLength(0);
  });

  // ── searchRecallEntries — result format ─────────────────────────────────

  test("result includes timestamp and token counts", () => {
    entries.unshift(makeEntry("2026-01-01T00:00:00Z", 100000, 2000, V4_PARTS.sections));
    const results = searchRecallEntries(entries, "Conversation");
    expect(results[0]).toContain("2026-01-01T00:00:00Z");
    expect(results[0]).toContain("100000→2000");
  });

  test("result includes part label", () => {
    entries.unshift(makeEntry("2026-01-01T00:00:00Z", 100, 20, V4_PARTS.sections));
    const results = searchRecallEntries(entries, "Conversation");
    expect(results[0]).toContain("## Conversation");
  });

  // ── Section extraction edge cases ───────────────────────────────────

  test("handles section at end of summary (no trailing ## )", () => {
    const entry = makeEntry("2026-01-01T00:00:00Z", 100, 20, {
      Conversation: "Simple section at the end",
    });
    entries.unshift(entry);
    const results = searchRecallEntries(entries, "Conversation");
    expect(results).toHaveLength(1);
    expect(results[0]).toContain("Simple section at the end");
  });

  test("handles section followed by XML marker", () => {
    const summary = "## Conversation\nBuild the API\n\n<read-files>\nmain.go\n</read-files>";
    entries.unshift({ ts: "2026-01-01T00:00:00Z", before: 100, after: 20, summary });
    const results = searchRecallEntries(entries, "Conversation");
    expect(results).toHaveLength(1);
    expect(results[0]).toContain("Build the API");
  });

  test("handles missing marker close as no marker match", () => {
    const summary = "## Conversation\nBuild the API\n\n<verification>\nPASS";
    entries.unshift({ ts: "2026-01-01T00:00:00Z", before: 100, after: 20, summary });
    expect(searchRecallEntries(entries, "verification")).toHaveLength(0);
  });
});
