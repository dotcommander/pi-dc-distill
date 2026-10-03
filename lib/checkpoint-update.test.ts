import { describe, expect, test } from "bun:test";
import { checkpointDigest, emptyCheckpoint } from "./compiler/checkpoint.ts";
import { prepareCheckpointUpdate, readCheckpointUpdateBase, validateCheckpointUpdate, type CheckpointUpdateContext } from "./checkpoint-update.ts";
import { sha256Hex } from "./sha256.ts";
import { DISTILL_HANDOFF_ENTRY_TYPE } from "./handoff.ts";

function context(text = "Keep release authorization explicit."): CheckpointUpdateContext {
  return { checkpoint: null, checkpointDigest: null, updateEntryId: null, nextUpdateEntryId: "update-1",
    occurrences: [{ message: { role: "user", content: [{ type: "text", text }] }, reference: {
      sessionId: "session", entryId: "user-1", messageIndex: 0, blockIndex: 0, contentDigest: sha256Hex(text), sourceKind: "user",
    } }] };
}
function update(operations: unknown[], ctx = context()) {
  return { version: 1, expectedBase: { checkpointDigest: ctx.checkpointDigest, updateEntryId: ctx.updateEntryId }, operations };
}
const pin = { op: "pin", id: "P1", purpose: "constraint", source: { kind: "excerpt", excerpt: "release authorization" } };

describe("explicit checkpoint updates", () => {
  test("pins attributed exact user text with canonical references and deterministic identity", () => {
    const result = prepareCheckpointUpdate(update([pin]), context());
    expect(result.checkpoint.pins[0]).toMatchObject({ id: "P1", text: "release authorization", status: "active", source: { entryId: "user-1", start: 5, end: 26, sourceKind: "user" } });
    expect(result.checkpointDigest).toBe(checkpointDigest(result.checkpoint));
    expect(context().checkpoint).toBeNull();
  });
  test("stale bases and unknown targets reject before any caller state changes", () => {
    const ctx = context();
    expect(() => prepareCheckpointUpdate({ ...update([pin]), expectedBase: { checkpointDigest: "a".repeat(64), updateEntryId: null } }, ctx)).toThrow("Stale");
    expect(() => prepareCheckpointUpdate(update([pin, { op: "resolve", target: { kind: "task", id: "missing" }, reason: "done" }]), ctx)).toThrow("Unknown");
    expect(ctx.checkpoint).toBeNull();
  });
  test("ambiguous excerpts, stale content, tool output and older user excerpts are ineligible", () => {
    const ambiguous = context("release authorization release authorization");
    expect(() => prepareCheckpointUpdate(update([pin]), ambiguous)).toThrow("uniquely");
    const stale = context(); stale.occurrences[0].reference.contentDigest = "0".repeat(64);
    expect(() => prepareCheckpointUpdate(update([pin]), stale)).toThrow("changed");
    const forged = context(); forged.occurrences[0].message.role = "toolResult"; forged.occurrences[0].reference.sourceKind = "tool-observation";
    expect(() => prepareCheckpointUpdate(update([pin]), forged)).toThrow("No eligible");
    const older = context(); older.occurrences.push({ ...context("new user request").occurrences[0], reference: { ...context("new user request").occurrences[0].reference, entryId: "user-2" } });
    expect(() => prepareCheckpointUpdate(update([pin]), older)).toThrow("latest");
  });
  test("exact spans preserve Unicode code points and reject nonunique occurrences", () => {
    const ctx = context("😀 keep this");
    const span = { ...pin, source: { kind: "span", entryId: "user-1", messageIndex: 0, blockIndex: 0, start: 0, end: 1 } };
    expect(prepareCheckpointUpdate(update([span]), ctx).checkpoint.pins[0].text).toBe("😀");
    ctx.occurrences.push(ctx.occurrences[0]);
    expect(() => prepareCheckpointUpdate(update([span]), ctx)).toThrow("Ambiguous");
  });
  test("resolution declares done without changing evidence requirements or observations", () => {
    const ctx = context(); ctx.checkpoint = emptyCheckpoint();
    ctx.checkpoint.preconditions.push({ id: "V1", kind: "verification-pass", runner: "bash", command: "bun test", cwd: "/work" });
    ctx.checkpoint.tasks.push({ id: "T1", status: "pending", action: "Verify", "depends-on": [], blocker: "", requires: ["V1"] });
    ctx.checkpointDigest = checkpointDigest(ctx.checkpoint);
    const result = prepareCheckpointUpdate(update([{ op: "resolve", target: { kind: "task", id: "T1" }, reason: "declared completed" }], ctx), ctx);
    expect(result.checkpoint.tasks[0]).toMatchObject({ status: "done", requires: ["V1"], resolution: { reason: "declared completed" } });
    expect(result.checkpoint.evidence).toEqual(ctx.checkpoint.evidence);
    expect(ctx.checkpoint.tasks[0].status).toBe("pending");
  });
  test("new graph declarations do not retire missing or prose-done prior work", () => {
    const ctx = context(); ctx.checkpoint = emptyCheckpoint();
    ctx.checkpoint.tasks.push({ id: "T1", status: "pending", action: "Verify", "depends-on": [], blocker: "", requires: [] });
    ctx.checkpointDigest = checkpointDigest(ctx.checkpoint);
    ctx.handoff = `\`\`\`distill-handoff-v2\n${JSON.stringify({ objective: "Continue", invariants: [], decisions: [], "rejected-hypotheses": [], tasks: [{ id: "T1", status: "done", action: "Verify", "depends-on": [], blocker: "" }], "verification-needed": [] })}\n\`\`\``;
    expect(prepareCheckpointUpdate(update([], ctx), ctx).checkpoint.tasks[0].status).toBe("pending");
    ctx.handoff = "Nothing remaining; all tasks completed.";
    expect(prepareCheckpointUpdate(update([], ctx), ctx).checkpoint.tasks[0].status).toBe("pending");
  });
  test("supersession retains attribution and rejects cross-kind and conflicting reuse", () => {
    const ctx = context();
    const second = { ...pin, id: "P2" };
    const supersede = { op: "supersede", target: { kind: "pin", id: "P1" }, replacement: { kind: "pin", id: "P2" }, reason: "updated constraint" };
    const result = prepareCheckpointUpdate(update([pin, second, supersede]), ctx);
    expect(result.checkpoint.pins[0]).toMatchObject({ status: "superseded", resolution: { replacement: "P2" } });
    expect(() => prepareCheckpointUpdate(update([pin, pin]), ctx)).toThrow("reuse");
    expect(() => prepareCheckpointUpdate(update([pin, { ...supersede, replacement: { kind: "task", id: "T1" } }]), ctx)).toThrow("cross-kind");
    expect(() => prepareCheckpointUpdate(update([pin, second, supersede, { ...supersede, target: { kind: "pin", id: "P2" }, replacement: { kind: "pin", id: "P1" } }]), ctx)).toThrow();
  });
  test("source pins may be reused only while active and user attributed", () => {
    const result = prepareCheckpointUpdate(update([pin, { ...pin, id: "P2", source: { kind: "pin", id: "P1" } }]), context());
    expect(result.checkpoint.pins[1].source).toEqual(result.checkpoint.pins[0].source);
    expect(() => prepareCheckpointUpdate(update([pin, { op: "resolve", target: { kind: "pin", id: "P1" }, reason: "no longer applicable" }, { ...pin, id: "P2", source: { kind: "pin", id: "P1" } }]), context())).toThrow("inactive");
  });
  test("required limits reject deep, malformed Unicode and oversized updates", () => {
    expect(() => validateCheckpointUpdate(update(Array.from({ length: 33 }, () => pin)))).toThrow("32");
    expect(() => validateCheckpointUpdate(update([{ ...pin, source: { kind: "excerpt", excerpt: "x".repeat(2049) } }]))).toThrow();
    expect(() => validateCheckpointUpdate(update([{ ...pin, source: { kind: "excerpt", excerpt: "\ud800" } }]))).toThrow("Unicode");
    let nested: unknown = {}; for (let i = 0; i < 65; i++) nested = { child: nested };
    expect(() => validateCheckpointUpdate(nested)).toThrow("structural");
    const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
    expect(() => validateCheckpointUpdate(cyclic)).toThrow("cyclic");
  });
  test("custom update bases use observed Pi entry identity and forged tool envelopes are ignored", () => {
    const saved = prepareCheckpointUpdate(update([pin]), context());
    const branch = [{ type: "message", message: { role: "toolResult", content: saved } }, { type: "custom", id: "actual-entry", customType: DISTILL_HANDOFF_ENTRY_TYPE, data: saved }];
    const base = readCheckpointUpdateBase(branch);
    expect(base).toMatchObject({ updateEntryId: "actual-entry", checkpoint: { updateEntryId: "actual-entry" } });
    expect(base.checkpointDigest).toBe(checkpointDigest(base.checkpoint!));
    expect(base.checkpointDigest).not.toBe(saved.checkpointDigest);
    expect(readCheckpointUpdateBase(branch.slice(0, 1)).checkpoint).toBeNull();
    expect(() => readCheckpointUpdateBase([{ type: "compaction", details: { compactor: "dc-distill", version: 13 } }])).toThrow("missing");
  });
});


test("equivalent reordered precondition keys are accepted atomically", () => {
  const ctx = context(); ctx.checkpoint = emptyCheckpoint();
  ctx.checkpoint.preconditions.push({ id: "V1", kind: "verification-pass", runner: "bash", command: "bun test", cwd: "/work" });
  ctx.checkpointDigest = checkpointDigest(ctx.checkpoint);
  const handoff = { objective: "Continue", invariants: [], decisions: [], "rejected-hypotheses": [], tasks: [], "verification-needed": [], preconditions: [{ cwd: "/work", command: "bun test", runner: "bash", kind: "verification-pass", id: "V1" }] };
  ctx.handoff = `\`\`\`distill-handoff-v3\n${JSON.stringify(handoff)}\n\`\`\``;
  expect(prepareCheckpointUpdate(update([], ctx), ctx).checkpoint.preconditions).toEqual(ctx.checkpoint.preconditions);
  handoff.preconditions[0].command = "bun test changed";
  ctx.handoff = `\`\`\`distill-handoff-v3\n${JSON.stringify(handoff)}\n\`\`\``;
  expect(() => prepareCheckpointUpdate(update([], ctx), ctx)).toThrow("Conflicting precondition");
});
