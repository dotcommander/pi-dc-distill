import { describe, test, expect } from "bun:test";
import { conversationEvictionCandidates } from "../lib/compiler/conversation-reducer.ts";
import { buildResumeIndex } from "../lib/compiler/resume-index.ts";
import { searchRecallEntries, type RecallEntry } from "../lib/recall.ts";
import type { ConversationTurn } from "../lib/compiler/types.ts";

describe("Confirmation of Compaction Summary Improvements", () => {
  test("CONFIRMATION 1: Intent-aware BM25 turn eviction preserves critical architectural context over syntax noise", () => {
    // Realistic scenario: A session has accumulated turns.
    // Turn 1: Unrelated package update diff (high syntax score, zero domain relevance).
    // Turn 2: Critical connection pool leak explanation (clear prose, zero diffs, high domain relevance).
    // Turn 3: Unrelated logger format diff (high syntax score, zero domain relevance).
    // Turn 4: User request focusing on the connection pool leak.
    const turns: ConversationTurn[] = [
      {
        role: "user",
        text: "Setup initial project config.",
      },
      {
        role: "assistant",
        text: "Updated package dependencies.\n```diff\n- lodash: 4.17.20\n+ lodash: 4.17.21\n```",
      },
      {
        role: "assistant",
        text: "Root cause analysis: The PostgreSQL connection pool leak occurs because acquireConnection() does not release idle clients on query timeout. We must set maxPoolSize=20 and idleTimeoutMillis=10000.",
      },
      {
        role: "assistant",
        text: "Formatted logger output.\n```diff\n- format: json\n+ format: pretty\n```",
      },
      {
        role: "user",
        text: "Please fix the connection pool leak in the PostgreSQL client.",
      },
      {
        role: "assistant",
        text: "Work completed: all tests pass.\n```diff\n- pool.status = false\n+ pool.status = true\n```",
      },
    ];

    // Under budget pressure, conversationEvictionCandidates sorts turns in EVICTION order (first = evicted first).
    const evictionOrder = conversationEvictionCandidates(turns);
    const indicesInEvictionOrder = evictionOrder.map((c) => c.index);

    // CONFIRMED: The irrelevant diffs (Turn 1 and Turn 3) are evicted BEFORE the critical
    // connection pool leak analysis (Turn 2).
    const turn2EvictionPos = indicesInEvictionOrder.indexOf(2);
    const turn1EvictionPos = indicesInEvictionOrder.indexOf(1);
    const turn3EvictionPos = indicesInEvictionOrder.indexOf(3);

    expect(turn1EvictionPos).toBeLessThan(turn2EvictionPos);
    expect(turn3EvictionPos).toBeLessThan(turn2EvictionPos);

    console.log("✓ Turn eviction confirmed: irrelevant diffs evicted at positions",
      turn1EvictionPos, "and", turn3EvictionPos, "while critical domain insight preserved until position", turn2EvictionPos);
  });

  test("CONFIRMED 2: Resume index prioritizes domain technical components in recall queries", () => {
    const turns: ConversationTurn[] = [
      {
        role: "user",
        text: "Investigate PostgreSQL connection pool leak in DatabaseManager.",
      },
    ];

    const readFiles = ["temp.txt", "notes.md", "build_output.txt"];
    const modifiedFiles = ["DatabaseManager.ts", "connection_pool.ts"];
    const recentToolCalls = [
      { name: "read", key: "build_output.txt", count: 1 },
      { name: "read", key: "temp.txt", count: 1 },
      { name: "edit", key: "DatabaseManager.ts", count: 1 },
      { name: "edit", key: "connection_pool.ts", count: 1 },
    ];

    const resumeIndex = buildResumeIndex(turns, readFiles, modifiedFiles, recentToolCalls);
    const topQueries = resumeIndex.recallQueries.filter((q) => !q.startsWith("... ("));

    // Technical identifiers from the request may precede observed file names.
    // All retained seeds are recovery terms, rather than copied instructions.
    expect(topQueries).toContain("DatabaseManager.ts");
    expect(topQueries).toContain("connection_pool.ts");
    expect(topQueries.every((query) => /DatabaseManager|connection_pool|PostgreSQL/.test(query))).toBe(true);
    expect(topQueries).not.toContain("build_output.txt");
    expect(topQueries).not.toContain("temp.txt");

    console.log("✓ Recall queries confirmed: Top queries are", topQueries.slice(0, 2), "excluding scratch file temp.txt");
  });

  test("CONFIRMED 3: recall_compaction retrieves prior summary via multi-keyword BM25", () => {
    const historicalEntries: RecallEntry[] = [
      {
        ts: "2026-09-01T00:00:00Z",
        before: 50000,
        after: 2000,
        summary: "## Conversation\nResolved connection pool leak by tuning maxPoolSize in PostgreSQL pool.",
      },
      {
        ts: "2026-09-02T00:00:00Z",
        before: 60000,
        after: 2500,
        summary: "## Conversation\nUpdated README with install instructions and license info.",
      },
    ];

    // Non-contiguous multi-word search that previously failed under .includes(q):
    const results = searchRecallEntries(historicalEntries, "PostgreSQL leak tuning");

    expect(results).toHaveLength(1);
    expect(results[0]).toContain("Resolved connection pool leak");

    console.log("✓ BM25 recall search confirmed: Non-contiguous query matched correctly.");
  });
});

import { compileSessionJsonl } from "../lib/local-compact.ts";

test("architecture, completion caveat and orphan cleanup survive combined budget pressure", () => {
  const user = (text: string) => JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text }] } });
  const assistant = (text: string) => JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text }] } });
  const architecture = "## Architecture\nFive phases: native schema; repositories; jobs and polling; filesystem storage; dependency removal.\n" +
    "`characters`: user reference images. `platform_characters`: chat personas.\n\n## Safety rules\n" +
    "- No browser database access.\n- No double quota decrement.\n- Monotonic terminal states.\n- Durable polling.\n- No paths or secrets to clients.\n\nPhase 1 is implemented. Phases 2–5 are not implemented. Production operations require separate authority.";
  const jsonl = [JSON.stringify({ type: "session", id: "compiler-regression", cwd: "/project" }),
    user("Explain the plan"), assistant(architecture), user("implement"),
    ...Array.from({ length: 25 }, (_, i) => assistant(`### Historical progress ${i}\nInspect src/old-${i}.ts. ${"Checking an old repository contract. ".repeat(50)}`)),
    assistant("Phase 2 is implemented. `DatabaseManager` owns native repositories.\n\n### Verification\n28/28 repository tests; 56/56 focused tests; production build passed. Known pre-existing: 292 svelte-check errors. Unapproved npm test/task lint failures are not acceptance evidence. No commit was created."),
    assistant("Resolved all three stale records: 48fd477f, b2fb03f3, dc149c61. No application files were changed.\n\nNext choice: None — task complete; no response needed."),
  ].join("\n");
  for (const enabled of [false, true]) {
    const summary = compileSessionJsonl(jsonl, undefined, undefined, enabled).summary;
    expect([...summary].length).toBeLessThanOrEqual(8192);
    expect(summary).toContain("[Historical context] ## Architecture");
    expect(summary).toContain("Five phases:");
    expect(summary).toContain("`platform_characters`: chat personas");
    expect(summary).toContain("- No paths or secrets to clients.");
    expect(summary).toContain("[Prior outcome] Phase 2 is implemented.");
    expect(summary).toContain("292 svelte-check errors");
    expect(summary).toContain("48fd477f, b2fb03f3, dc149c61");
    expect(summary).not.toContain("<resume-tasks>");
    expect(summary).not.toContain("recent-user-intent:");
    expect(summary.includes("recall-queries:")).toBe(enabled);
    if (!enabled) expect(summary).not.toContain("recall_compaction");
  }
});

test("pre-trim terminal status prevents budget refresh from recreating tasks", () => {
  const jsonl = [
    { type: "session", id: "terminal-trim", cwd: "/project" },
    { type: "message", message: { role: "user", content: [{ type: "text", text: "finish cleanup" }] } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "Reconciled task records. " + "Routine bookkeeping details. ".repeat(80) + "\nNext choice: None — task complete; no response needed." }] } },
  ].map((row) => JSON.stringify(row)).join("\n");
  const summary = compileSessionJsonl(jsonl, undefined, undefined, false).summary;
  expect(summary).not.toContain("<resume-index>");
  expect(summary).not.toContain("<resume-tasks>");
});
