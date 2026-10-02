import { describe, test, expect } from "bun:test";
import { buildResumeIndex, buildResumeTasks, recoveryRecallQueries } from "./resume-index.ts";
import type { ConversationTurn, ToolCallFingerprint } from "./types.ts";

describe("resume-index recall queries and salience", () => {
  test("ranks domain-relevant technical seeds above generic scratch files", () => {
    const turns: ConversationTurn[] = [
      {
        role: "user",
        text: "Please investigate the TokenAuthenticator verification error in auth_service.",
      },
      {
        role: "assistant",
        text: "Looking into TokenAuthenticator.",
      },
    ];

    const readFiles = ["temp.txt", "notes.md", "scratch.log", "output.json", "build_output.txt"];
    const modifiedFiles = ["TokenAuthenticator.ts", "auth_service.ts"];
    const recentToolCalls: ToolCallFingerprint[] = [
      { name: "read", key: "temp.txt", count: 1 },
      { name: "read", key: "build_output.txt", count: 1 },
      { name: "edit", key: "TokenAuthenticator.ts", count: 1 },
      { name: "edit", key: "auth_service.ts", count: 1 },
    ];

    const index = buildResumeIndex(turns, readFiles, modifiedFiles, recentToolCalls);

    expect(index.recallQueries.length).toBeGreaterThan(0);
    // TokenAuthenticator.ts and auth_service.ts should outrank generic temp.txt and notes.md
    const topQueries = index.recallQueries.filter((q) => !q.startsWith("... ("));
    expect(topQueries[0]).toMatch(/TokenAuthenticator|auth_service/);
    expect(topQueries[1]).toMatch(/TokenAuthenticator|auth_service/);
    expect(topQueries).not.toContain("temp.txt");
  });

  test("emits at most five executable queries without omission sentinels", () => {
    const turns: ConversationTurn[] = [
      { role: "user", text: "Process data files" },
    ];
    const readFiles = [
      "parserA.ts",
      "parserB.ts",
      "parserC.ts",
      "parserD.ts",
      "parserE.ts",
      "parserF.ts",
      "parserG.ts",
    ];
    const index = buildResumeIndex(turns, readFiles, [], []);

    expect(index.recallQueries).toHaveLength(5);
    expect(index.recallQueries.every((query) => !query.startsWith("... (") && [...query].length <= 160)).toBe(true);
  });

  test("generates recall_compaction task with highest-salience query", () => {
    const turns: ConversationTurn[] = [
      { role: "user", text: "Fix AuthTokenProvider" },
      { role: "assistant", text: "Continue: next step is verify" },
    ];
    const index = buildResumeIndex(turns, ["AuthTokenProvider.ts"], [], [
      { name: "read", key: "AuthTokenProvider.ts", count: 1 },
    ]);

    const tasks = buildResumeTasks({
      recentToolCalls: [{ name: "read", key: "AuthTokenProvider.ts", count: 1 }],
      verification: [],
      workingTree: [],
      sourceAnchors: [],
      activeTasks: [],
      resumeIndex: index,
      recallEnabled: true,
    });

    const recallTask = tasks.find((t) => t.startsWith("Recall:"));
    expect(recallTask).toBeDefined();
    expect(recallTask).toContain("recall_compaction");
  });
});

test("terminal state exposes recovery queries separately from operational intent", () => {
  const turns: ConversationTurn[] = [
    { role: "user", text: "Implement DatabaseManager using connection_pool.ts" },
    { role: "assistant", text: "Phase 2 is implemented. DatabaseManager uses `maxPoolSize` in `src/connection_pool.ts`." },
    { role: "assistant", text: "Resolved three orphan records. Next choice: None — task complete; no response needed." },
  ];
  const index = buildResumeIndex(turns, [], [], []);
  expect(index.activeFiles).toEqual([]);
  expect(index.recentUserIntents).toEqual([]);
  expect(index.continuationHints).toEqual([]);
  expect(index.recallQueries).toContain("DatabaseManager");
  expect(index.recallQueries).toContain("maxPoolSize");
  expect(buildResumeTasks({ recentToolCalls: [], verification: ["PASS: bun test"], workingTree: ["dirty"], sourceAnchors: [], activeTasks: ["running"], resumeIndex: index, terminalComplete: true })).toEqual([]);
});

test("recovery seeds reject boilerplate, actions, scratch paths and opaque ids", () => {
  const index = buildResumeIndex([
    { role: "user", text: "Fix TokenAuthenticator" },
    { role: "assistant", text: "Run `git status --short`; inspect `/tmp/scratch/AuthFake.ts`, `build_output.txt`, `48fd477f`, `deadbeef`, `TODO`, and `TokenAuthenticator`." },
  ], [], [], []);
  expect(index.recallQueries).toEqual(["TokenAuthenticator"]);
});

test("path observations and literals retain extensionless paths without admitting prose slashes", () => {
  const queries = recoveryRecallQueries([
    { role: "user", text: "Inspect Makefile and src/compiler" },
    { role: "assistant", text: "The chat/gallery and ledger/runner prose is not a path. Inspect `.github/workflows`." },
  ], ["Makefile", "src/compiler"]);
  expect(queries).toContain("Makefile");
  expect(queries).toContain("src/compiler");
  expect(queries).toContain(".github/workflows");
  expect(queries).not.toContain("chat/gallery");
  expect(queries).not.toContain("ledger/runner");
});

test("query intent follows latest topic or pinned proposal with normalized deduplication", () => {
  const history: ConversationTurn[] = [
    { role: "user", text: "Inspect AuthProvider" },
    { role: "assistant", text: "AuthProvider uses TokenAuthenticator." },
    { role: "assistant", text: "## Proposal\nRepair ImageStorage and symlinkEscape." },
    { role: "user", text: "implement" },
  ];
  const once = recoveryRecallQueries(history);
  const repeated = recoveryRecallQueries([...history, { role: "assistant", text: "AuthProvider ".repeat(50) + "IMAGESTORAGE ImageStorage" }]);
  expect(once[0]).toMatch(/ImageStorage|symlinkEscape/);
  expect(repeated).toEqual(once);
  expect(recoveryRecallQueries([...history, { role: "user", text: "Inspect TokenAuthenticator" }])[0]).toBe("TokenAuthenticator");
});
