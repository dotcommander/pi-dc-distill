import { describe, expect, test } from "bun:test";
import { DisplayProjectionBudget, DISPLAY_SCAN_LIMITS, visibleUserIntents } from "./display-projection.ts";
import { buildResumeIndex } from "./resume-index.ts";
import { formatSummary, enforceOperatingBudget } from "./budget-formatter.ts";
import { trimTurn, turnPreviewLimit, trimTurnWithLimit } from "./conversation-reducer.ts";
import { compileSessionJsonl } from "../local-compact.ts";
import { emptyCheckpoint, buildCheckpoint, checkpointDigest, checkpointReadyTasks } from "./checkpoint.ts";
import { digest } from "./helpers.ts";
import type { ConversationResult, ConversationTurn } from "./types.ts";

const noise = "context material ".repeat(2000);
const user = (text: string) => JSON.stringify({ type: "message", message: { role: "user", content: text } });
function conversation(turns: ConversationTurn[]): ConversationResult {
  return { turns, readFiles: [], modifiedFiles: [], omittedReadFiles: 0, omittedModifiedFiles: 0,
    recentToolCalls: [], recentToolResults: [], verification: [], workingTree: [], sourceAnchors: [], literalAnchors: [],
    activeTasks: [], resumeRisks: [], budgetOmissions: [], resumeTasks: [], resumeIndex: buildResumeIndex(turns, [], [], []) };
}

describe("bounded plain prose display", () => {
  test("shortest exact phrase retains the request and a unique suffix before clipping", () => {
    const source = `DEMO-ANCHOR must survive compaction. ${noise}Keep the unique suffix 42; do not retire unfinished work.`;
    const projected = new DisplayProjectionBudget().project(source);
    expect(projected).toBe("DEMO-ANCHOR must survive compaction. context material [repeated 2000 times] Keep the unique suffix 42; do not retire unfinished work.");
    expect(trimTurn(projected)).toBe(projected);
    expect(trimTurn(source)).not.toContain("unique suffix");
    const result = compileSessionJsonl(user(source), undefined, undefined, false);
    expect(result.summary).toContain(projected);
    const conversationText = result.summary.match(/## Conversation\n([\s\S]*?)(?=\n<(?:[a-z][a-z-]*)[>\s]|$)/)?.[1] ?? "";
    expect(conversationText).not.toContain("context material context material");
  });
  test("compression keeps a unique tail within the original long-form preview cap", () => {
    const source = `DEMO-ANCHOR must survive compaction. ${Array.from({ length: 62 }, (_, i) => `detail${i}`).join(" ")} ${"context material ".repeat(14)}Unique suffix 42; do not retire unfinished work.`;
    const projected = new DisplayProjectionBudget().project(source);
    expect(source.length).toBeGreaterThanOrEqual(800);
    expect(source.length).toBeLessThanOrEqual(1000);
    expect(projected.length).toBeGreaterThan(500);
    expect(projected.length).toBeLessThan(800);
    expect(trimTurn(source)).toBe(source);
    expect(trimTurn(projected)).not.toContain("Unique suffix 42");
    const result = compileSessionJsonl(user(source), undefined, undefined, false);
    expect(result.summary).toContain(projected);
    expect(result.summary).toContain("Unique suffix 42; do not retire unfinished work.");
    // The original age treatment still applies; projection does not grant a larger cap.
    const agedLimit = turnPreviewLimit(source, 5);
    expect(trimTurnWithLimit(source, agedLimit)).toBe(trimTurn(source, 5));
    expect(trimTurnWithLimit(projected, agedLimit)).not.toContain("Unique suffix 42");
  });
  test("numbers, negation and similar phrases never become interchangeable", () => {
    const source = "Do not change setting 12. ".repeat(6) + "Do change setting 12. Do not change setting 13. Unique tail.";
    expect(new DisplayProjectionBudget().project(source)).toBe("Do not change setting 12. [repeated 6 times] Do change setting 12. Do not change setting 13. Unique tail.");
    const varied = Array.from({ length: 20 }, (_, i) => `Keep setting ${i}; do ${i % 2 ? "not " : ""}change this one.`).join(" ");
    expect(new DisplayProjectionBudget().project(varied)).toBe(varied);
    const spacing = "alpha beta ".repeat(6) + "alpha  beta ".repeat(6);
    expect(new DisplayProjectionBudget().project(spacing)).toBe(spacing); // Each exact run is below 128 points.
  });
  test("Unicode phrases preserve complete code points, spacing, case and punctuation", () => {
    const projected = new DisplayProjectionBudget().project("日本語 😀 é & café ".repeat(12) + "fin 😀");
    expect(projected).toBe("日本語 😀 é & café [repeated 12 times] fin 😀");
    expect(new DisplayProjectionBudget().project("red blue red blue ".repeat(12))).toBe("red blue [repeated 24 times] ");
    const summary = compileSessionJsonl(user("日本語 😀 é & café ".repeat(12) + "literal < 2 > 1 😀"), undefined, undefined, false).summary;
    expect(summary).toContain("日本語 😀 é & café [repeated 12 times] literal &lt; 2 &gt; 1 😀");
  });
  test("protected, structured, code, command, table, diff and evidence content bypass compression", () => {
    for (const source of [
      "```text\n" + noise + "\n```", "<handoff>" + noise + "</handoff>", '{"text":"' + noise + '"}',
      "| column | value |\n| data | " + noise + "|", "diff --git a/a b/a\n@@ -1 +1 @@\n+" + noise,
      "bun test " + noise, "PASS [bash cwd=/repo]: " + noise, "checkpointDigest: " + noise,
      "Decision: " + noise, "`exact literal` " + noise,
      "echo " + noise, "printf " + noise, "const value = 1; ".repeat(30), "value=plain ".repeat(30),
    ]) expect(new DisplayProjectionBudget().project(source)).toBe(source);
    expect(new DisplayProjectionBudget().project(noise, true)).toBe(noise);
    for (const source of ["echo " + noise, "printf " + noise, "const value = 1; ".repeat(30), "value=plain ".repeat(30)]) {
      expect(compileSessionJsonl(user(source), undefined, undefined, false).summary).toContain(trimTurn(source.trim()));
    }
  });
  test("only complete records can spend the independent code-point and token budgets", () => {
    const budget = new DisplayProjectionBudget();
    const overRecord = "x".repeat(DISPLAY_SCAN_LIMITS.recordCodePoints + 1);
    expect(budget.project(overRecord)).toBe(overRecord);
    expect(budget.project(noise)).toContain("[repeated 2000 times]");
    const tokenBudget = new DisplayProjectionBudget();
    const manyTokens = "a ".repeat(16_000);
    expect(tokenBudget.project(manyTokens)).toContain("[repeated 16000 times]");
    expect(tokenBudget.project(manyTokens)).toContain("[repeated 16000 times]");
    expect(tokenBudget.project(noise)).toBe(noise);
    expect(tokenBudget.project("word ".repeat(100))).toBe("word ".repeat(100));
    const pointBudget = new DisplayProjectionBudget();
    const longWords = ("long".repeat(99) + " ").repeat(160);
    for (let i = 0; i < 4; i++) expect(pointBudget.project(longWords)).toContain("repeated 160 times");
    expect(pointBudget.project(noise)).toBe(noise);
    expect(trimTurn(pointBudget.project(noise))).toBe(trimTurn(noise));
  });
  test("production exhaustion retains the existing preview without partially compressing a record", () => {
    const source = "a ".repeat(32_769) + "UNSEEN-SUFFIX";
    const result = compileSessionJsonl(user(source), undefined, undefined, false);
    expect(result.summary).toContain(trimTurn(source));
    expect(result.summary).not.toContain("[repeated");
  });
  test("small-record fast path preserves Unicode boundary accounting and does not spend phrase tokens", () => {
    const budget = new DisplayProjectionBudget();
    const padding = "x".repeat(DISPLAY_SCAN_LIMITS.recordCodePoints - 128);
    for (let i = 0; i < 4; i++) expect(budget.project(padding)).toBe(padding);
    expect(budget.project("😀".repeat(63))).toBe("😀".repeat(63));
    expect(budget.project("word ".repeat(85))).toBe("word [repeated 85 times] ");
    // The UTF-16 upper bound no longer fits, but the actual code points do.
    expect(budget.project("😀".repeat(13))).toBe("😀".repeat(13));
    expect(budget.project(noise)).toBe(noise);
    const tokens = new DisplayProjectionBudget();
    const short = "a ".repeat(20);
    for (let i = 0; i < 1700; i++) expect(tokens.project(short)).toBe(short);
    expect(tokens.project(noise)).toContain("[repeated 2000 times]");
  });
});

describe("ordinary intent display occurrence", () => {
  test("unique same-occurrence equality disappears only while its conversation is visible", () => {
    const turns: ConversationTurn[] = [{ role: "user", text: "Fix the parser", sourceSequence: 4 }];
    const index = buildResumeIndex(turns, [], [], []);
    expect(index.recentUserIntents).toEqual(["Fix the parser"]);
    expect(visibleUserIntents(index, turns)).toEqual([]);
    expect(visibleUserIntents(index, [])).toEqual(["Fix the parser"]);
    expect(visibleUserIntents(index, [{ ...turns[0], sourceSequence: 5 }])).toEqual(["Fix the parser"]);
    expect(visibleUserIntents(index, [{ ...turns[0], displayText: "Fix the parser…" }])).toEqual(["Fix the parser"]);
    const conv = conversation(turns);
    expect(formatSummary({ priorSummaries: [] }, conv)).not.toContain("recent-user-intent:");
    conv.turns = [];
    enforceOperatingBudget({ priorSummaries: [] }, conv, undefined, false);
    expect(formatSummary({ priorSummaries: [] }, conv)).toContain("recent-user-intent:\n- [Attributed user context] Fix the parser");
  });
  test("ambiguous occurrences, reference-expanded, combined and clipped intents stay", () => {
    for (const turns of [
      [{ role: "user", text: "Fix the parser", sourceSequence: 1 }, { role: "user", text: "Fix the parser", sourceSequence: 2 }],
      [{ role: "assistant", text: "Use a strict recursive parser", sourceSequence: 1 }, { role: "user", text: "Implement that", sourceSequence: 2 }],
      [{ role: "user", text: "Fix parser and update schema", sourceSequence: 1 }],
      [{ role: "user", text: "Long ordinary request " + "unique background ".repeat(20), sourceSequence: 1 }],
    ] as ConversationTurn[][]) {
      const index = buildResumeIndex(turns, [], [], []);
      expect(visibleUserIntents(index, turns)).toEqual(index.recentUserIntents);
    }
  });
  test("checkpoint request pins remain displayed even alongside equal conversation prose", () => {
    const text = "Fix the parser";
    const conv = conversation([{ role: "user", text, sourceSequence: 1 }]);
    conv.checkpoint = emptyCheckpoint();
    conv.checkpoint.pins = [{ id: "request", purpose: "request", text, status: "active", source: { entryId: "user", blockIndex: 0, start: 0, end: text.length, contentDigest: digest(text), sourceKind: "user" } }];
    enforceOperatingBudget({ priorSummaries: [] }, conv, undefined, false);
    expect(formatSummary({ priorSummaries: [] }, conv)).toContain("recent-user-intent:\n- Fix the parser");
  });
  test("operating-budget eviction restores only attributed preview while checkpoint and refreshed intents stay intact", () => {
    const conv = conversation([
      { role: "user", text: "Earlier request", sourceSequence: 1 },
      { role: "user", text: "Latest request", sourceSequence: 2 },
      { role: "assistant", text: "Current context " + noise, sourceSequence: 3 },
    ]);
    conv.checkpoint = emptyCheckpoint();
    conv.checkpoint.constraints = ["Preserve storage"];
    const before = checkpointDigest(conv.checkpoint);
    expect(formatSummary({ priorSummaries: [] }, conv)).not.toContain("recent-user-intent:");
    enforceOperatingBudget({ priorSummaries: [] }, conv, undefined, false);
    expect(conv.turns.some(turn => turn.sourceSequence === 1)).toBe(false);
    expect(conv.resumeIndex.recentUserIntents).toEqual(["Latest request"]);
    expect(formatSummary({ priorSummaries: [] }, conv)).toContain("recent-user-intent:\n- [Attributed user context] Earlier request");
    expect(checkpointDigest(conv.checkpoint)).toBe(before);
  });
});

test("populated checkpoint identity and stale exact evidence survive repeated noisy compaction", () => {
  const base = emptyCheckpoint();
  const protectedText = "Do not delete storage " + "protected phrase ".repeat(12);
  base.pins = [{ id: "constraint", purpose: "constraint", text: protectedText, status: "active", source: { entryId: "user-pin", blockIndex: 0, start: 0, end: protectedText.length, contentDigest: digest(protectedText), sourceKind: "user" } }];
  const declaration = { version: 3 as const, objective: "Finish unfinished work", invariants: ["Keep user storage"], decisions: [], "rejected-hypotheses": [], "verification-needed": [], tasks: [{ id: "unfinished", action: "Repair parser", status: "pending" as const, "depends-on": [], blocker: "", requires: ["verified"] }], preconditions: [{ id: "verified", kind: "verification-pass" as const, runner: "bash", command: "bun test  --filter 'exact'", cwd: "/repo" }] };
  const observed = { mutationEpoch: 0, fileReads: [], modifiedPaths: [], verification: [{ id: "check", tool: "bash", command: "bun test  --filter 'exact'", cwd: "/repo", status: "PASS" as const, evidence: "3 pass", mutationEpoch: 0, freshnessEstablished: true }] };
  const passed = buildCheckpoint(base, declaration, observed);
  expect(checkpointReadyTasks(passed)).toContain("unfinished");
  const checkpoint = buildCheckpoint(passed, undefined, { ...observed, verification: [], mutationEpoch: 2, modifiedPaths: ["/repo/parser"] }, "prior");
  expect(checkpointReadyTasks(checkpoint)).not.toContain("unfinished");
  const compile = (state: typeof checkpoint, focus?: string) => compileSessionJsonl([
    JSON.stringify({ type: "session", id: "noise", cwd: "/repo", checkpoint: state, checkpointDigest: checkpointDigest(state), predecessorEntryId: "prior" }),
    user(protectedText), user(`DEMO-ANCHOR must survive compaction. ${noise}Unique suffix.`),
  ].join("\n"), focus, undefined, false);
  const first = compile(checkpoint), second = compile(first.checkpoint);
  const focused = compile(checkpoint, "DEMO-ANCHOR");
  expect(focused.summary).not.toBe(first.summary);
  expect(focused.checkpoint).toEqual(first.checkpoint);
  expect(focused.checkpointDigest).toBe(first.checkpointDigest);
  expect(compile(checkpoint).checkpointDigest).toBe(first.checkpointDigest);
  expect(first.checkpoint.predecessor).toEqual({ checkpointDigest: checkpointDigest(checkpoint), entryId: "prior" });
  expect(second.checkpoint.predecessor).toEqual({ checkpointDigest: first.checkpointDigest, entryId: "prior" });
  const { predecessor: _predecessor, ...protectedState } = checkpoint;
  const expectedState = { ...protectedState, evidence: { ...checkpoint.evidence, pendingMutations: [] } };
  for (const result of [first, second]) {
    const { predecessor: _advancedPredecessor, ...actualState } = result.checkpoint;
    expect(actualState).toEqual(expectedState);
    expect(result.checkpointDigest).toBe(checkpointDigest(result.checkpoint));
  }
  expect(second.checkpoint.tasks[0].status).toBe("pending");
  expect(second.checkpoint.evidence.verification[0]).toEqual(checkpoint.evidence.verification[0]);
  expect(checkpointReadyTasks(second.checkpoint)).not.toContain("unfinished");
  expect(second.summary).toContain(protectedText);
  expect(second.summary).toContain("context material [repeated 2000 times] Unique suffix.");
  expect(JSON.stringify(second.checkpoint)).not.toMatch(/displayText|intentOccurrences|displayIntents/);
});
