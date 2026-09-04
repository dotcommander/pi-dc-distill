// Tests for dc-shrink/lib/recall.ts — recordSummary, searchSummaries, extractSection, resetStore
// Run: bun test extensions/dc-app/lib/knowledge/features/shrink/lib/recall.test.ts

import { describe, test, expect, beforeEach } from "bun:test";
import {
  hydrateSummaries,
  loadPersistedSummaries,
  persistSummary,
  recordSummary,
  searchSummaries,
  resetStore,
  getSummaries,
  type RecallEntry,
} from "./recall.ts";

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

describe("recall", () => {
  beforeEach(() => {
    resetStore();
  });

  // ── resetStore / getSummaries ────────────────────────────────────────

  test("getSummaries returns empty array after reset", () => {
    recordSummary(makeEntry("2026-01-01T00:00:00Z", 100, 20, V4_PARTS.sections));
    resetStore();
    expect(getSummaries()).toHaveLength(0);
  });

  test("getSummaries returns entries newest first", () => {
    recordSummary(makeEntry("2026-01-01T00:00:00Z", 100, 20, { Conversation: "First" }));
    recordSummary(makeEntry("2026-01-02T00:00:00Z", 120, 25, { Conversation: "Second" }));
    const summaries = getSummaries();
    expect(summaries).toHaveLength(2);
    expect(summaries[0].ts).toBe("2026-01-02T00:00:00Z");
    expect(summaries[1].ts).toBe("2026-01-01T00:00:00Z");
  });

  test("store is bounded to MAX_STORED (10) entries", () => {
    for (let i = 0; i < 15; i++) {
      recordSummary(makeEntry(`2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`, 100 + i * 10, 20, { Conversation: `Entry ${i}` }));
    }
    expect(getSummaries()).toHaveLength(10);
    // Newest first — should have entries 14 down to 5
    expect(getSummaries()[0].ts).toContain("01-15");
    expect(getSummaries()[9].ts).toContain("01-06");
  });

  test("hydrateSummaries loads bounded entries into memory", () => {
    const entries = Array.from({ length: 12 }, (_, i) =>
      makeEntry(`2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`, 100, 20, { Conversation: `Entry ${i}` })
    );

    hydrateSummaries(entries);

    expect(getSummaries()).toHaveLength(10);
    expect(searchSummaries("Conversation")[0]).toContain("Entry 11");
  });

  test("persistSummary and loadPersistedSummaries round-trip bounded summaries", () => {
    const written: Record<string, unknown> = {};
    const pathHandle = {
      path: "/tmp/dc-shrink-test",
      join: (seg: string) => `/tmp/dc-shrink-test/${seg}`,
      exists: (name: string) => name in written,
      read: <T,>(name: string, defaultValue?: T): T => {
        return (name in written ? written[name] : defaultValue) as T;
      },
      write: (name: string, value: unknown): void => {
        written[name] = value;
      },
      readText: (_name: string, defaultValue?: string): string => defaultValue ?? "",
      writeText: (): void => {},
    };

    for (let i = 0; i < 12; i++) {
      persistSummary(
        makeEntry(`2026-02-${String(i + 1).padStart(2, "0")}T00:00:00Z`, 100, 20, { Conversation: `Saved ${i}` }),
        pathHandle,
      );
    }

    const loaded = loadPersistedSummaries(pathHandle);
    expect(loaded).toHaveLength(10);
    expect(loaded[0].summary).toContain("Saved 2");
    expect(loaded[9].summary).toContain("Saved 11");
  });

  // ── searchSummaries — part name queries ─────────────────────────────

  test("name query conversation returns the Conversation section content", () => {
    recordSummary(makeEntry("2026-01-01T00:00:00Z", 100, 20, V4_PARTS.sections, V4_PARTS.markers));
    const results = searchSummaries("conversation");
    expect(results).toHaveLength(1);
    expect(results[0]).toContain("## Conversation");
    expect(results[0]).toContain("Assistant explained JWT");
  });

  test("name query verification returns the verification marker block content", () => {
    recordSummary(makeEntry("2026-01-01T00:00:00Z", 100, 20, V4_PARTS.sections, V4_PARTS.markers));
    const results = searchSummaries("verification");
    expect(results).toHaveLength(1);
    expect(results[0]).toContain("<verification>");
    expect(results[0]).toContain("PASS bun test lib/recall.test.ts");
  });

  test("name-prefix query matches resume-index", () => {
    recordSummary(makeEntry("2026-01-01T00:00:00Z", 100, 20, V4_PARTS.sections, V4_PARTS.markers));
    const results = searchSummaries("resume-i");
    expect(results).toHaveLength(1);
    expect(results[0]).toContain("<resume-index>");
    expect(results[0]).toContain("Continue with verification");
  });

  test("returns empty for non-existent part", () => {
    recordSummary(makeEntry("2026-01-01T00:00:00Z", 100, 20, V4_PARTS.sections, V4_PARTS.markers));
    expect(searchSummaries("nonexistent-part")).toHaveLength(0);
  });

  test("searches across multiple entries, newest first", () => {
    recordSummary(makeEntry("2026-01-01T00:00:00Z", 100, 20, V4_PARTS.sections, V4_PARTS.markers));
    recordSummary(makeEntry("2026-01-02T00:00:00Z", 120, 25, ARCHIVE_PARTS.sections, ARCHIVE_PARTS.markers));
    const results = searchSummaries("Conversation");
    expect(results).toHaveLength(2);
    expect(results[0]).toContain("Archived old records");
    expect(results[1]).toContain("Assistant explained JWT");
  });

  test("respects limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      recordSummary(makeEntry(`2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`, 100, 20, { Conversation: `Conversation ${i}` }));
    }
    const results = searchSummaries("Conversation", 2);
    expect(results).toHaveLength(2);
  });

  // ── searchSummaries — keyword queries ───────────────────────────────

  test("finds by keyword in a heading section", () => {
    recordSummary(makeEntry("2026-01-01T00:00:00Z", 100, 20, V4_PARTS.sections, V4_PARTS.markers));
    const results = searchSummaries("JWT");
    expect(results).toHaveLength(1);
    expect(results[0]).toContain("## Conversation");
  });

  test("finds by keyword that lives only inside a marker block", () => {
    recordSummary(makeEntry("2026-01-01T00:00:00Z", 100, 20, V4_PARTS.sections, V4_PARTS.markers));
    const results = searchSummaries("/tmp/source/anchors/auth.md");
    expect(results).toHaveLength(1);
    expect(results[0]).toContain("<source-anchors>");
    expect(results[0]).toContain("/tmp/source/anchors/auth.md");
  });

  test("keyword search is case-insensitive", () => {
    recordSummary(makeEntry("2026-01-01T00:00:00Z", 100, 20, V4_PARTS.sections, V4_PARTS.markers));
    expect(searchSummaries("jwt")).toHaveLength(1);
    expect(searchSummaries("Jwt")).toHaveLength(1);
  });

  test("returns empty when keyword not found", () => {
    recordSummary(makeEntry("2026-01-01T00:00:00Z", 100, 20, V4_PARTS.sections, V4_PARTS.markers));
    expect(searchSummaries("nonexistent_keyword_xyz")).toHaveLength(0);
  });

  test("keyword search returns one part per entry (first match)", () => {
    recordSummary(makeEntry("2026-01-01T00:00:00Z", 100, 20, {
      Session: "Shared token evidence",
      Conversation: "Shared token appears later",
    }));
    const results = searchSummaries("Shared token");
    expect(results).toHaveLength(1);
    expect(results[0]).toContain("## Session");
  });

  // ── searchSummaries — edge cases ───────────────────────────────────

  test("returns empty for empty query", () => {
    recordSummary(makeEntry("2026-01-01T00:00:00Z", 100, 20, V4_PARTS.sections));
    expect(searchSummaries("")).toHaveLength(0);
    expect(searchSummaries("   ")).toHaveLength(0);
  });

  test("returns empty when store is empty", () => {
    expect(searchSummaries("Conversation")).toHaveLength(0);
  });

  // ── searchSummaries — result format ─────────────────────────────────

  test("result includes timestamp and token counts", () => {
    recordSummary(makeEntry("2026-01-01T00:00:00Z", 100000, 2000, V4_PARTS.sections));
    const results = searchSummaries("Conversation");
    expect(results[0]).toContain("2026-01-01T00:00:00Z");
    expect(results[0]).toContain("100000→2000");
  });

  test("result includes part label", () => {
    recordSummary(makeEntry("2026-01-01T00:00:00Z", 100, 20, V4_PARTS.sections));
    const results = searchSummaries("Conversation");
    expect(results[0]).toContain("## Conversation");
  });

  // ── Section extraction edge cases ───────────────────────────────────

  test("handles section at end of summary (no trailing ## )", () => {
    const entry = makeEntry("2026-01-01T00:00:00Z", 100, 20, {
      Conversation: "Simple section at the end",
    });
    recordSummary(entry);
    const results = searchSummaries("Conversation");
    expect(results).toHaveLength(1);
    expect(results[0]).toContain("Simple section at the end");
  });

  test("handles section followed by XML marker", () => {
    const summary = "## Conversation\nBuild the API\n\n<read-files>\nmain.go\n</read-files>";
    recordSummary({ ts: "2026-01-01T00:00:00Z", before: 100, after: 20, summary });
    const results = searchSummaries("Conversation");
    expect(results).toHaveLength(1);
    expect(results[0]).toContain("Build the API");
  });

  test("handles missing marker close as no marker match", () => {
    const summary = "## Conversation\nBuild the API\n\n<verification>\nPASS";
    recordSummary({ ts: "2026-01-01T00:00:00Z", before: 100, after: 20, summary });
    expect(searchSummaries("verification")).toHaveLength(0);
  });
});
