import { describe, expect, test } from "bun:test";
import { renderStructuredHandoff, HANDOFF_BLOCK_CODE_POINTS, HANDOFF_FIELD_CODE_POINTS } from "./budget-formatter.ts";
import { parseAnyStructuredDistillHandoff, readyDistillHandoffTasks, DISTILL_HANDOFF_ENTRY_TYPE, type StructuredDistillHandoffV2 } from "../handoff.ts";
import { compileSessionJsonl } from "../local-compact.ts";
import { codePointLength } from "../unicode.ts";

const empty = (): StructuredDistillHandoffV2 => ({
  version: 2, objective: "Finish scoped work.", invariants: [], decisions: [],
  "rejected-hypotheses": [], tasks: [], "verification-needed": [],
});
const envelope = (value: object, version = 2) => {
  const { version: _, ...payload } = value as StructuredDistillHandoffV2;
  return `\`\`\`distill-handoff-v${version}\n${JSON.stringify(payload)}\n\`\`\``;
};
const omitted = (block: string, category: string) => {
  const receipt = block.match(/^omitted records: (.*)$/m)?.[1] ?? "";
  return Number(receipt.match(new RegExp(`(?:^|, )${category}=(\\d+)`))?.[1] ?? 0);
};
const taskIds = (block: string) => [...block.matchAll(/^- ([A-Za-z][\w.-]*) \[(?:done|pending|blocked)\]:/gm)].map((match) => match[1]);
function expectBounded(block: string) {
  expect(codePointLength(block)).toBeLessThanOrEqual(HANDOFF_BLOCK_CODE_POINTS);
  expect(block.match(/^<resume-state>$/gm)).toHaveLength(1);
  expect(block.match(/^<\/resume-state>$/gm)).toHaveLength(1);
  expect(block).toContain("projection: partial task state");
  const retained = new Set(taskIds(block));
  for (const match of block.matchAll(/^  depends-on: (.*)$/gm)) {
    for (const id of match[1].split(", ")) expect(retained.has(id)).toBe(true);
  }
  for (const match of block.matchAll(/^blocker: .*; task: ([A-Za-z][\w.-]*)$/gm)) expect(retained.has(match[1])).toBe(true);
  const ready = block.match(/^ready-tasks:\n((?:- [A-Za-z][\w.-]*\n)+)/m)?.[1] ?? "";
  for (const line of ready.trim().split("\n").filter(Boolean)) expect(retained.has(line.slice(2))).toBe(true);
}

describe("bounded structured handoff projection", () => {
  test("counts escaping and supplementary Unicode in field excerpts and keeps original envelopes", () => {
    const handoff = { ...empty(), objective: "<😀>".repeat(680), invariants: ["Keep every original source field."],
      tasks: [{ id: "First", status: "pending" as const, action: "😀".repeat(2048), "depends-on": [], blocker: "" }] };
    const original = envelope(handoff);
    const parsed = parseAnyStructuredDistillHandoff(original)!;
    expect(parsed).toBeDefined();
    const snapshot = JSON.stringify(parsed);
    const block = renderStructuredHandoff(parsed);
    expectBounded(block);
    const objective = block.match(/^objective: (.*)$/m)![1];
    const action = block.match(/^- First \[pending\]: (.*)$/m)![1];
    expect(codePointLength(objective)).toBeLessThanOrEqual(HANDOFF_FIELD_CODE_POINTS);
    expect(codePointLength(action)).toBe(HANDOFF_FIELD_CODE_POINTS);
    expect(objective).not.toMatch(/&(?:l|lt|g|gt)?…$/);
    expect(block).toContain("shortened fields: 2");
    expect(JSON.stringify(parsed)).toBe(snapshot);
    expect(parseAnyStructuredDistillHandoff(original)).toEqual(parsed);
  });

  test("preserves initial unresolved task and blocker before lower priority history", () => {
    const handoff = { ...empty(), objective: "<".repeat(1800), invariants: [">".repeat(1800), "second invariant"],
      tasks: [
        { id: "History", status: "done" as const, action: "completed history", "depends-on": [], blocker: "" },
        { id: "Blocked", status: "blocked" as const, action: "😀".repeat(1800), "depends-on": [], blocker: ">".repeat(1800) },
      ], decisions: Array.from({ length: 12 }, (_, i) => ({ id: `D${i}`, text: "optional decision", rationale: "optional rationale" })) };
    const parsed = parseAnyStructuredDistillHandoff(envelope(handoff))!;
    expect(parsed).toBeDefined();
    const block = renderStructuredHandoff(parsed);
    expectBounded(block);
    expect(block).toContain("Blocked [blocked]");
    expect(block).toContain("blocker: &gt;");
    expect(block).toContain("shortened fields: 4");
    expect(block.indexOf("Blocked [blocked]")).toBeLessThan(block.indexOf("decisions:"));
    expect(omitted(block, "decisions")).toBeGreaterThan(0);
  });

  test("uses full graph readiness while omitting dependency IDs by status and count", () => {
    const longId = (i: number) => `T${i}_${"x".repeat(59)}`;
    const handoff: StructuredDistillHandoffV2 = { ...empty(),
      tasks: [
        ...Array.from({ length: 20 }, (_, i) => ({ id: longId(i), status: "done" as const, action: "history ".repeat(50), "depends-on": [], blocker: "" })),
        { id: "Ready", status: "pending", action: "Operate after completed prerequisites.", "depends-on": Array.from({ length: 20 }, (_, i) => longId(i)), blocker: "" },
        { id: "Blocked", status: "blocked", action: "Wait for external state.", "depends-on": [], blocker: "External gate" },
        { id: "Unresolved", status: "pending", action: "Cannot run yet.", "depends-on": ["Blocked"], blocker: "" },
      ] };
    const parsed = parseAnyStructuredDistillHandoff(envelope(handoff)) as StructuredDistillHandoffV2;
    expect(parsed).toBeDefined();
    expect(readyDistillHandoffTasks(parsed).map((task) => task.id)).toEqual(["Ready"]);
    const block = renderStructuredHandoff(parsed);
    expectBounded(block);
    const retained = taskIds(block);
    expect(block).toContain("ready-tasks:\n- Ready\n");
    expect(block).not.toContain("ready-tasks:\n- Unresolved");
    const omittedDone = handoff.tasks.filter((task) => task.status === "done" && !retained.includes(task.id)).length;
    expect(block).toContain(`omitted dependencies: done=${omittedDone}`);
    expect(omitted(block, "tasks")).toBe(handoff.tasks.length - retained.length);
  });

  test("retains an owner record with each additional blocker and counts omitted bundles", () => {
    const handoff: StructuredDistillHandoffV2 = { ...empty(), objective: "<".repeat(2048), invariants: [">".repeat(2048)],
      tasks: Array.from({ length: 32 }, (_, i) => ({ id: `Blocked${i}`, status: "blocked", action: "<".repeat(80), "depends-on": [], blocker: ">".repeat(80) })),
    };
    const parsed = parseAnyStructuredDistillHandoff(envelope(handoff))!;
    expect(parsed).toBeDefined();
    const block = renderStructuredHandoff(parsed);
    expectBounded(block);
    const blockers = [...block.matchAll(/^blocker: .*; task: (\w+)$/gm)];
    expect(blockers.length).toBeGreaterThan(1);
    expect(omitted(block, "blockers")).toBe(32 - blockers.length);
    expect(omitted(block, "tasks")).toBe(32 - taskIds(block).length);
  });

  test("bounds maximum item counts, reports exact omissions and preserves operational summary evidence", () => {
    const handoff: StructuredDistillHandoffV2 = { ...empty(), objective: "<resume-state>".repeat(80),
      invariants: Array.from({ length: 32 }, (_, i) => `Invariant ${i}: ${"<😀>".repeat(12)}`),
      tasks: Array.from({ length: 32 }, (_, i) => ({ id: `T${i}`, status: "pending", action: `Action ${i}: ${"<😀>".repeat(12)}`, "depends-on": [], blocker: "" })),
      decisions: Array.from({ length: 32 }, (_, i) => ({ id: `D${i}`, text: "decision", rationale: "rationale" })),
      "rejected-hypotheses": Array.from({ length: 32 }, (_, i) => ({ id: `H${i}`, claim: "claim", evidence: "evidence" })),
      "verification-needed": Array.from({ length: 32 }, (_, i) => `Check ${i}`),
    };
    const saved = envelope(handoff);
    const parsed = parseAnyStructuredDistillHandoff(saved)!;
    expect(parsed).toBeDefined();
    const block = renderStructuredHandoff(parsed);
    expectBounded(block);
    expect(omitted(block, "tasks")).toBe(32 - taskIds(block).length);
    expect(omitted(block, "invariants")).toBe(32 - (block.match(/^invariants:$/gm)?.length ?? 0));
    for (const category of ["decisions", "rejected-hypotheses", "verification-needed"]) {
      expect(omitted(block, category)).toBe(32 - (block.match(new RegExp(`^${category}:$`, "gm"))?.length ?? 0));
    }
    const summary = compileSessionJsonl([
      { type: "session", id: "budget", cwd: "/tmp/project" },
      { type: "message", message: { role: "user", content: [{ type: "text", text: "Continue the scoped repair." }] } },
      { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "check", name: "bash", arguments: { command: "bun test lib/handoff.test.ts" } }] } },
      { type: "message", message: { role: "toolResult", toolCallId: "check", toolName: "bash", isError: false, content: [{ type: "text", text: "All tests pass" }] } },
      { type: "custom", customType: DISTILL_HANDOFF_ENTRY_TYPE, data: { handoff: saved } },
    ].map((value) => JSON.stringify(value)).join("\n"), undefined, undefined, false).summary;
    expect(codePointLength(summary)).toBeLessThanOrEqual(65536);
    expect(summary).toContain("protected-content overflow; operating target exceeded");
    expect(summary).toContain("PASS [bash cwd=/tmp/project]");
    expect(summary).toContain("bun test lib/handoff.test.ts");
    expect(summary).toContain("[User] Continue the scoped repair.");
  });

  test("projects v1 with next work before completed history and accurate record counts", () => {
    const handoff = { objective: "Finish legacy work.", next: ["<".repeat(2048)], blocker: [">".repeat(2048)],
      done: Array.from({ length: 32 }, (_, i) => `Done ${i}: ${"<".repeat(100)}`), decision: ["Keep source envelopes."], "verification-needed": ["Verify separately."] };
    const parsed = parseAnyStructuredDistillHandoff(envelope(handoff, 1))!;
    expect(parsed).toBeDefined();
    const block = renderStructuredHandoff(parsed);
    expectBounded(block);
    expect(block.indexOf("next:")).toBeLessThan(block.indexOf("done:"));
    expect(omitted(block, "done")).toBe(32 - (block.match(/^done:$/gm)?.length ?? 0));
    expect(block).toContain("shortened fields:");
  });
});
