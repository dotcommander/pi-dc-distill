// Explicit-entry recall query contracts.
// Run: bun test lib/recall.test.ts

import { describe, test, expect, beforeEach } from "bun:test";
import { RECALL_SEPARATOR, searchRecallEntries, type RecallEntry } from "./recall.ts";

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

test("recall searches durable retained source context by name and technical terms", () => {
  const entry = makeEntry("2026-10-02", 100, 20, {}, { "retained-context": "version: 1\n[Assistant] [Prior outcome] NativeRepository preserves qualified migration evidence." });
  expect(searchRecallEntries([entry], "retained-context")[0]).toContain("NativeRepository");
  expect(searchRecallEntries([entry], "NativeRepository migration")[0]).toContain("qualified migration evidence");
});

test("recall ranks Chinese keyword queries against Chinese summary content", () => {
  const entries = [
    makeEntry("2026-10-01", 100, 20, { Conversation: "缓存层级调优完成" }),
    makeEntry("2026-10-02", 100, 20, { Conversation: "用户要求修复数据库迁移脚本。" }),
  ];
  const results = searchRecallEntries(entries, "数据库");
  expect(results).toHaveLength(1);
  expect(results[0]).toContain("数据库迁移");
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

  test("multi-word keyword query matches across separated words", () => {
    entries.unshift(makeEntry("2026-01-01T00:00:00Z", 100, 20, V4_PARTS.sections, V4_PARTS.markers));
    // "recall alignment" words are separated by "taxonomy" in "Prioritize recall taxonomy alignment"
    const results = searchRecallEntries(entries, "recall alignment");
    expect(results).toHaveLength(1);
    expect(results[0]).toContain("## User Focus");
    expect(results[0]).toContain("recall taxonomy alignment");
  });

  test("BM25 ranks entry matching all query terms above entry matching single term", () => {
    const entrySingle = makeEntry("2026-01-02T00:00:00Z", 100, 20, {
      Conversation: "User asked about auth only.",
    });
    const entryBoth = makeEntry("2026-01-01T00:00:00Z", 100, 20, {
      Conversation: "User asked about auth and JWT tokens in depth.",
    });
    // Chronologically, entrySingle is newer (2026-01-02), but entryBoth matches both "auth" and "JWT"
    entries.unshift(entryBoth);
    entries.unshift(entrySingle);

    const results = searchRecallEntries(entries, "auth JWT");
    expect(results).toHaveLength(2);
    expect(results[0]).toContain("auth and JWT tokens");
    expect(results[1]).toContain("auth only");
  });

  test("BM25 ranks concise relevant section over verbose passing mention", () => {
    const verboseEntry = makeEntry("2026-01-02T00:00:00Z", 100, 20, {
      Conversation: "Here is a very long log output with lots of text and noise where authentication is mentioned just once casually.",
    });
    const conciseEntry = makeEntry("2026-01-01T00:00:00Z", 100, 20, {
      Conversation: "Authentication core protocol.",
    });
    entries.unshift(conciseEntry);
    entries.unshift(verboseEntry);

    const results = searchRecallEntries(entries, "authentication");
    expect(results).toHaveLength(2);
    expect(results[0]).toContain("Authentication core protocol");
    expect(results[1]).toContain("long log output");
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


describe("Phase 5 recall output", () => {
  test("both section and keyword results carry project and session provenance", () => {
    const entry = { ...makeEntry("now", 100, 20, { Conversation: "unique retrieval evidence" }), project: "/project/a", sessionId: "session-a" };
    for (const query of ["conversation", "retrieval evidence"]) {
      const result = searchRecallEntries([entry], query)[0];
      expect(result).toContain("project: /project/a");
      expect(result).toContain("session: session-a");
    }
    expect(searchRecallEntries([makeEntry("old", 100, 20, { Conversation: "legacy evidence" })], "conversation")[0]).toContain("legacy-unscoped");
  });

  test("new operating-state parts are searchable by name and keyword", () => {
    for (const name of ["resume-state", "current-intent", "resume-risks", "file-evidence", "summary-omissions"]) {
      const entry = makeEntry("now", 100, 20, {}, { [name]: "sentinel operating evidence" });
      expect(searchRecallEntries([entry], name)[0]).toContain(`<${name}>`);
      expect(searchRecallEntries([entry], "sentinel")[0]).toContain(`</${name}>`);
    }
  });

  test("invalid limits reject and positive integral limits clamp to twenty", () => {
    const entries = Array.from({ length: 25 }, (_, i) => makeEntry(String(i), 100, 20, { Conversation: "short" }));
    for (const limit of [NaN, Infinity, -Infinity, 0, -1, 1.5]) {
      expect(() => searchRecallEntries(entries, "conversation", limit)).toThrow("finite positive integer");
    }
    expect(searchRecallEntries(entries, "conversation")).toHaveLength(3);
    expect(searchRecallEntries(entries, "conversation", 100)).toHaveLength(20);
  });

  test("wire budget includes separators and drops complete lower-priority results", () => {
    const entries = ["first", "second", "third"].map((ts) => makeEntry(ts, 100, 20, { Conversation: "😀".repeat(3500) }));
    const results = searchRecallEntries(entries, "conversation");
    const output = results.join(RECALL_SEPARATOR);
    expect(Array.from(output).length).toBeLessThanOrEqual(8192);
    expect(results).toHaveLength(2);
    expect(output).toContain("Recall omitted 1 result(s)");
    expect(output).not.toContain("[third");
    expect(output).not.toContain("�");
  });

  test("oversized marker excerpts retain whole lines and balanced framing", () => {
    const hugePath = "/" + "identity".repeat(2000);
    const entry = makeEntry("now", 100, 20, {}, { "file-evidence": `kept evidence\n${hugePath}\n${"😀".repeat(7900)}\nlast evidence` });
    const output = searchRecallEntries([entry], "file-evidence").join(RECALL_SEPARATOR);
    expect(Array.from(output).length).toBeLessThanOrEqual(8192);
    expect(output).toContain("<file-evidence>");
    expect(output).toContain("</file-evidence>");
    expect(output).toContain("kept evidence");
    expect(output).toContain("last evidence");
    expect(output).toContain("Recall omitted");
    expect(output).not.toContain("/identity");
  });
});


test("oversized recall retains provenance and marker frame together", () => {
  const project = "/" + "p".repeat(8000);
  const entry = { ...makeEntry("now", 100, 20, {}, { "file-evidence": `${"oversized".repeat(2000)}\ntiny evidence` }), project, sessionId: "session-a" };
  const output = searchRecallEntries([entry], "file-evidence").join(RECALL_SEPARATOR);
  expect(Array.from(output).length).toBeLessThanOrEqual(8192);
  expect(output).toContain(`project: ${project} | session: session-a`);
  expect(output.match(/<file-evidence>/g)).toHaveLength(1);
  expect(output.match(/<\/file-evidence>/g)).toHaveLength(1);
  expect(output).toContain("Recall omitted 1 line(s)");
  expect(output).toContain("tiny evidence");
});

test("recall omits an unrepresentable provenance frame as a complete result", () => {
  const project = "/" + "p".repeat(9000);
  const entry = { ...makeEntry("now", 100, 20, {}, { "file-evidence": "tiny evidence" }), project, sessionId: "session-a" };
  const output = searchRecallEntries([entry], "file-evidence").join(RECALL_SEPARATOR);
  expect(Array.from(output).length).toBeLessThanOrEqual(8192);
  expect(output).toContain("Recall omitted 1 result(s)");
  expect(output).not.toContain("tiny evidence");
  expect(output).not.toContain("project:");
  expect(output).not.toContain("<file-evidence>");
  expect(output).not.toContain("</file-evidence>");
});


test("near-ceiling provenance cannot leave a closing marker without its opening", () => {
  const entry = { ...makeEntry("now", 100, 20, {}, { "file-evidence": `x\n${"y".repeat(9000)}` }), project: "", sessionId: "session-a" };
  // Reproduce the prior independent-line budget: the header fit, opening did
  // not, then a tiny content line and the unconditional close survived.
  const emptyHeader = searchRecallEntries([{ ...entry, summary: "<file-evidence>x</file-evidence>" }], "file-evidence")[0].split("\n")[0];
  const targetHeaderLength = 8192 - Array.from("[Recall omitted 4 line(s) from this result.]\n</file-evidence>").length - 3;
  entry.project = "p".repeat(targetHeaderLength - Array.from(emptyHeader).length);
  const output = searchRecallEntries([entry], "file-evidence").join(RECALL_SEPARATOR);
  expect(output).toContain("Recall omitted 1 result(s)");
  expect(output).not.toContain("<file-evidence>");
  expect(output).not.toContain("</file-evidence>");
  expect(output).not.toContain("session-a");
  expect(Array.from(output).length).toBeLessThanOrEqual(8192);
});

test("recall exposes v11 advisory and observed-readiness markers without inventing state", () => {
  const entry = makeEntry("2026-10-02", 100, 20, {}, {
    "change-impact": "transcript-derived rerun priority: bun test src/parser.test.ts",
    "ready-tasks": "- verified-task",
    "graph-ready-tasks": "- blocked-task: requirements unknown or contradicted",
  });
  for (const marker of ["change-impact", "ready-tasks", "graph-ready-tasks"]) {
    const result = searchRecallEntries([entry], marker);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain(`<${marker}>`);
    expect(result[0]).toContain(`</${marker}>`);
  }
  expect(searchRecallEntries([entry], "ready-tasks")[0]).not.toContain("blocked-task");
});

describe("checkpoint recall", () => {
  test("checkpoint-only pins are found by exact section, prefix, and keyword", () => {
    const entry = { ...makeEntry("now", 100, 20, {}, {
      "checkpoint-v1": 'version: 2\npin: Preserve unique quasaranchor <source> & "literal"',
    }), project: "/project/checkpoint", sessionId: "checkpoint-session" };
    for (const query of ["checkpoint-v1", "checkpoint", "quasaranchor"]) {
      const results = searchRecallEntries([entry], query);
      expect(results).toHaveLength(1);
      expect(results[0]).toContain("quasaranchor");
      expect(results[0]).toContain("project: /project/checkpoint | session: checkpoint-session");
      expect(results[0]).toContain("&lt;source&gt; &amp;");
      expect(results[0].match(/<checkpoint-v1>/g)).toHaveLength(1);
      expect(results[0].match(/<\/checkpoint-v1>/g)).toHaveLength(1);
      expect(results[0]).not.toContain("<source>");
    }
  });

  test("large checkpoint blocks retain balanced escaped framing inside the wire limit", () => {
    const entry = makeEntry("now", 100, 20, {}, {
      "checkpoint-v1": `pin: kept <source> & evidence\n${"😀".repeat(9000)}\npin: final evidence`,
    });
    const output = searchRecallEntries([entry], "checkpoint-v1").join(RECALL_SEPARATOR);
    expect(Array.from(output).length).toBeLessThanOrEqual(8192);
    expect(output.match(/<checkpoint-v1>/g)).toHaveLength(1);
    expect(output.match(/<\/checkpoint-v1>/g)).toHaveLength(1);
    expect(output).toContain("kept &lt;source&gt; &amp; evidence");
    expect(output).toContain("final evidence");
    expect(output).toContain("Recall omitted 1 line(s)");
  });

  test("historical entries and existing candidate order remain unchanged", () => {
    const legacy = makeEntry("legacy", 100, 20, { Conversation: "legacy retrieval" }, { "verification": "PASS legacy" });
    expect(searchRecallEntries([legacy], "checkpoint")).toEqual([]);
    expect(searchRecallEntries([legacy], "conversation")[0]).toContain("legacy-unscoped");
    expect(searchRecallEntries([legacy], "verification")[0]).toContain("PASS legacy");
    const tied = makeEntry("now", 100, 20, {}, {
      "retained-context": "sharedquasar", "checkpoint-v1": "sharedquasar",
    });
    expect(searchRecallEntries([tied], "sharedquasar")[0]).toContain("<retained-context>");
    expect(searchRecallEntries([tied], "sharedquasar")[0]).not.toContain("<checkpoint-v1>");
  });
});

test("recall exposes the type-signatures catalog marker by name", () => {
  const entry = makeEntry("2026-10-02", 100, 20, {}, {
    "type-signatures": "- src/widget.ts: export function widget(): void {}",
  });
  const result = searchRecallEntries([entry], "type-signatures");
  expect(result).toHaveLength(1);
  expect(result[0]).toContain("<type-signatures>");
  expect(result[0]).toContain("- src/widget.ts: export function widget(): void {}");
});
