import { describe, expect, test } from "bun:test";
import { createDistillExtension } from "./index.ts";
import { createStubCtx, simulate } from "./tests/harness/fake-pi.ts";
import { withPreparationBranch } from "./tests/harness/preparation-fixture.ts";
import { buildSessionContext, estimateTokens } from "./lib/sdk.ts";
import { sha256Hex } from "./lib/sha256.ts";

type Stub = ReturnType<typeof createStubCtx>;
function notifyCount(stub: Stub): number { return stub.calls.filter(call => call.api === "ui.notify").length; }
async function host() {
  const stub = createStubCtx();
  createDistillExtension()(stub.pi);
  await simulate.hook(stub, "session_start", { type: "session_start", reason: "startup" });
  return stub;
}
function request(stub: Stub, reason?: string, content = "Latest native request") {
  const event = withPreparationBranch({
    type: "session_before_compact", reason, willRetry: reason === "overflow", signal: new AbortController().signal,
    preparation: { previousSummary: undefined, messagesToSummarize: [{ role: "user", content, timestamp: 1 }],
      turnPrefixMessages: [], firstKeptEntryId: "kept", tokensBefore: 10_000 },
  });
  stub.sessionBranch.splice(0, stub.sessionBranch.length, ...event.branchEntries);
  return event;
}
async function prepare(stub: Stub, event: any): Promise<any> {
  return (await simulate.hook(stub, "session_before_compact", event))[0];
}
function commitEntry(stub: Stub, prepared: any): any {
  return { type: "compaction", id: "committed", parentId: (stub.sessionBranch.at(-1) as any)?.id ?? null,
    timestamp: "2026-10-06T00:00:01.000Z", ...prepared.compaction };
}
async function commit(stub: Stub, entry: any, fromExtension = true) {
  await simulate.hook(stub, "session_compact", { type: "session_compact", compactionEntry: entry, fromExtension });
}

describe("single deterministic host compiler", () => {
  for (const reason of ["manual", "threshold", "overflow", "unfamiliar", undefined]) {
    test(`intercepts ${String(reason)} and returns only current details`, async () => {
      const stub = await host();
      const event = request(stub, reason);
      const result = await prepare(stub, event);
      expect(result.cancel).toBeUndefined();
      expect(JSON.parse(result.compaction.summary).latestRequest.text).toBe("Latest native request");
      expect(Object.keys(result.compaction.details).sort()).toEqual([
        "attemptId", "capacityStatus", "compactor", "summaryDigest", "tokensAfter", "tokensAfterSource",
      ].sort());
      expect(result.compaction.details.capacityStatus).toBe("unknown");
      expect(result.compaction.details.summaryDigest).toBe(sha256Hex(result.compaction.summary));
      expect(notifyCount(stub)).toBe(0);
    });
  }
  test("has no registrations or autonomous work", async () => {
    const stub = await host();
    expect(stub.registeredTools.size).toBe(0);
    expect(stub.registeredCommands.size).toBe(0);
    expect(stub.calls.some(call => ["ctx.compact", "ctx.abort", "pi.sendUserMessage", "pi.sendMessage", "pi.appendEntry"].includes(call.api))).toBe(false);
    expect(stub.registeredHooks.has("agent_settled")).toBe(false);
  });
  test("child start cannot acquire ownership or compile", async () => {
    const stub = await host();
    (stub.ctx.sessionManager as any).getSessionId = () => "child-session";
    await simulate.hook(stub, "session_start", { type: "session_start", reason: "startup" });
    expect(await prepare(stub, request(stub))).toEqual({ cancel: true });
    (stub.ctx.sessionManager as any).getSessionId = () => "stub-session-id";
    expect((await prepare(stub, request(stub))).compaction).toBeDefined();
  });
  test("unstarted sessions cancel instead of falling through", async () => {
    const stub = createStubCtx();
    createDistillExtension()(stub.pi);
    expect(await prepare(stub, request(stub))).toEqual({ cancel: true });
  });
  test("source mismatch and cancellation fail closed without notification", async () => {
    const stub = await host();
    const event = request(stub);
    event.preparation.messagesToSummarize[0] = { ...event.preparation.messagesToSummarize[0], content: "Not the branch" };
    expect(await prepare(stub, event)).toEqual({ cancel: true });
    const aborted = request(stub);
    const controller = new AbortController();
    controller.abort();
    aborted.signal = controller.signal;
    expect(await prepare(stub, aborted)).toEqual({ cancel: true });
    expect(notifyCount(stub)).toBe(0);
  });
  test("estimates exact proposed rebuilt messages and retained tail", async () => {
    const stub = await host();
    (stub.ctx as any).model = { provider: "fixture", id: "fixture", contextWindow: 10_000 };
    const event = request(stub);
    const result = await prepare(stub, event);
    const entry = commitEntry(stub, result);
    const context = buildSessionContext([...event.branchEntries, entry], entry.id);
    expect(result.compaction.details.tokensAfter).toBe(context.messages.reduce((sum, message) => sum + estimateTokens(message), 0));
    expect(result.compaction.details.capacityStatus).toBe("within-window");
    expect(result.compaction.details.contextWindow).toBe(10_000);
  });
  test("rebuilt estimate preserves replayed system content, sections, and tool patches", async () => {
    const stub = await host();
    const event = request(stub);
    const baseContent = "System instructions ".repeat(300);
    const tool = { name: "current_tool", description: "Current tool", parameters: { type: "object", properties: {} } };
    const timestamp = "2026-10-06T00:00:00.000Z";
    event.branchEntries[0].parentId = "system-patch";
    event.branchEntries.unshift(
      { type: "message", id: "system-base", parentId: null, timestamp,
        message: { role: "system", content: baseContent, sections: { policy: "original", removed: "obsolete" },
          toolsAdded: [{ ...tool, name: "removed_tool" }], timestamp: 1 } },
      { type: "message", id: "system-patch", parentId: "system-base", timestamp,
        message: { role: "system", content: "Later instructions", sections: { policy: "replacement", removed: null },
          toolsRemoved: [{ name: "removed_tool" }], toolsAdded: [tool], timestamp: 2 } },
    );
    stub.sessionBranch.splice(0, stub.sessionBranch.length, ...event.branchEntries);
    const result = await prepare(stub, event);
    expect(result.compaction).toBeDefined();
    // Independent expected host entry: replay all system patches, rather than
    // calling the same replay helper used by the extension.
    const entry = commitEntry(stub, result);
    entry.systemMessage = { role: "system", content: `${baseContent}\n\nLater instructions`,
      sections: { policy: "replacement" }, toolsAdded: [tool], timestamp: Date.parse(entry.timestamp) };
    const expected = buildSessionContext([...event.branchEntries, entry], entry.id).messages
      .reduce((sum, message) => sum + estimateTokens(message), 0);
    expect(result.compaction.details.tokensAfter).toBe(expected);
    const withoutSystem = { ...entry };
    delete withoutSystem.systemMessage;
    const omittedSystemEstimate = buildSessionContext([...event.branchEntries, withoutSystem], entry.id).messages
      .reduce((sum, message) => sum + estimateTokens(message), 0);
    expect(expected).toBeGreaterThan(omittedSystemEstimate + 1);
    const tight = await host();
    tight.sessionBranch.splice(0, tight.sessionBranch.length, ...event.branchEntries);
    (tight.ctx as any).model = { provider: "fixture", id: "fixture", contextWindow: expected - 1 };
    // No optional rows can be evicted: the retained system plus mandatory
    // summary crosses capacity, even though omitting the system would fit.
    expect(await prepare(tight, event)).toEqual({ cancel: true });
  });
  test("capacity removes optional whole rows then cancels mandatory overflow", async () => {
    const baseline = await host();
    const event = request(baseline);
    // Optional assistant observations are sizable while mandatory user text stays short.
    const assistant = { role: "assistant", content: [{ type: "text", text: "x".repeat(2_000) }],
      api: "fixture", provider: "fixture", model: "fixture", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop", timestamp: 2 };
    event.preparation.messagesToSummarize.push(assistant);
    const oldTail = event.branchEntries.pop();
    const previous = event.branchEntries.at(-1);
    event.branchEntries.push({ type: "message", id: "assistant", parentId: previous.id, timestamp: previous.timestamp, message: assistant },
      { ...oldTail, parentId: "assistant" });
    baseline.sessionBranch.splice(0, baseline.sessionBranch.length, ...event.branchEntries);
    const original = await prepare(baseline, event);
    expect(JSON.parse(original.compaction.summary).records.length).toBeGreaterThan(0);
    const tight = await host();
    tight.sessionBranch.splice(0, tight.sessionBranch.length, ...event.branchEntries);
    (tight.ctx as any).model = { provider: "fixture", id: "fixture", contextWindow: original.compaction.details.tokensAfter - 50 };
    const reduced = await prepare(tight, event);
    expect(reduced.compaction).toBeDefined();
    expect(JSON.parse(reduced.compaction.summary).records).toEqual([]);
    expect(JSON.parse(reduced.compaction.summary).omitted.excerpts).toBe(1);
    expect(reduced.compaction.details.tokensAfter).toBeLessThanOrEqual((tight.ctx as any).model.contextWindow);
    const impossible = await host();
    (impossible.ctx as any).model = { provider: "fixture", id: "fixture", contextWindow: 1 };
    expect(await prepare(impossible, request(impossible))).toEqual({ cancel: true });
  });
  test("notifies once after matching commit, allowing sibling custom append", async () => {
    const stub = await host();
    const result = await prepare(stub, request(stub));
    const entry = commitEntry(stub, result);
    stub.sessionBranch.push(entry, { type: "custom", id: "sibling", parentId: entry.id,
      timestamp: entry.timestamp, customType: "sibling", data: {} } as any);
    await commit(stub, entry);
    await commit(stub, entry);
    expect(notifyCount(stub)).toBe(1);
  });
  test("historical identical-summary callback wakes matching newest attempt only after append", async () => {
    const stub = await host();
    const result = await prepare(stub, request(stub));
    const current = { ...commitEntry(stub, result), id: "current-attempt" };
    const historical = { ...current, id: "historical-attempt", parentId: null,
      details: { ...current.details, attemptId: "historical-attempt" } };
    // Historical entries remain in Pi's append-only branch even when the
    // effective source projection omits them. Its summary equals the new
    // proposed bytes, but its receipt identity does not match.
    stub.sessionBranch.unshift(historical);
    await commit(stub, historical);
    expect(notifyCount(stub)).toBe(0);
    stub.sessionBranch.push(current, { type: "custom", id: "sibling", parentId: current.id,
      timestamp: current.timestamp, customType: "sibling", data: {} } as any);
    // Pi 1.0.4 may select the first matching summary for the event payload.
    await commit(stub, historical);
    await commit(stub, historical);
    expect(notifyCount(stub)).toBe(1);
  });
  test("historical callback cannot authorize a different newest attempt or foreign wakeup", async () => {
    const stub = await host();
    const result = await prepare(stub, request(stub));
    const current = commitEntry(stub, result);
    const historical = { ...current, id: "historical", parentId: null,
      details: { ...current.details, attemptId: "historical" } };
    stub.sessionBranch.unshift(historical);
    const otherAttempt = { ...current, details: { ...current.details, attemptId: "other-attempt" } };
    stub.sessionBranch.push(otherAttempt);
    await commit(stub, historical);
    expect(notifyCount(stub)).toBe(0);
    stub.sessionBranch.pop();
    stub.sessionBranch.push(current);
    await commit(stub, historical, false);
    expect(notifyCount(stub)).toBe(0);
    await commit(stub, historical);
    expect(notifyCount(stub)).toBe(1);
  });
  test("consumes receipt before reentrant UI notification", async () => {
    const stub = await host();
    const result = await prepare(stub, request(stub));
    const entry = commitEntry(stub, result);
    stub.sessionBranch.push(entry);
    let calls = 0;
    let reentry: Promise<void> | undefined;
    stub.ctx.ui.notify = () => { calls++; reentry = commit(stub, entry); };
    await commit(stub, entry);
    await reentry;
    expect(calls).toBe(1);
  });
  test("consumes receipt before throwing UI notification", async () => {
    const stub = await host();
    const result = await prepare(stub, request(stub));
    const entry = commitEntry(stub, result);
    stub.sessionBranch.push(entry);
    let calls = 0;
    stub.ctx.ui.notify = () => { calls++; throw new Error("UI failed"); };
    await commit(stub, entry);
    await commit(stub, entry);
    expect(calls).toBe(1);
  });
  test("headless commit emits no notification", async () => {
    const stub = await host();
    (stub.ctx as any).hasUI = false;
    const result = await prepare(stub, request(stub));
    const entry = commitEntry(stub, result);
    stub.sessionBranch.push(entry);
    await commit(stub, entry);
    expect(notifyCount(stub)).toBe(0);
  });
  for (const change of ["summary", "details", "attempt", "tokensBefore", "cut", "anchor", "foreign", "abandoned", "superseded", "model", "tree", "generation", "child"]) {
    test(`rejects ${change} commit`, async () => {
      const stub = await host();
      const result = await prepare(stub, request(stub));
      const entry = commitEntry(stub, result);
      if (change === "summary") entry.summary += " ";
      if (change === "details") entry.details = { ...entry.details, tokensAfter: entry.details.tokensAfter + 1 };
      if (change === "attempt") entry.details = { ...entry.details, attemptId: "different-attempt" };
      if (change === "tokensBefore") entry.tokensBefore += 1;
      if (change === "child") (stub.ctx.sessionManager as any).getSessionId = () => "child-session";
      if (change === "cut") entry.firstKeptEntryId = "other";
      if (change === "anchor") entry.parentId = "other";
      if (change !== "abandoned") stub.sessionBranch.push(entry);
      if (change === "superseded") stub.sessionBranch.push({ ...entry, id: "newer", parentId: entry.id });
      if (change === "model") (stub.ctx as any).model = { provider: "fixture", id: "changed", contextWindow: 10_000 };
      if (change === "tree") await simulate.hook(stub, "session_tree", {});
      if (change === "generation") await simulate.hook(stub, "session_start", { type: "session_start", reason: "reload" });
      await commit(stub, entry, change !== "foreign");
      expect(notifyCount(stub)).toBe(0);
    });
  }
  test("announced primary session replacement transfers ownership", async () => {
    const stub = await host();
    await simulate.hook(stub, "session_before_switch", { type: "session_before_switch", reason: "new" });
    (stub.ctx.sessionManager as any).getSessionId = () => "replacement";
    await simulate.hook(stub, "session_start", { type: "session_start", reason: "new" });
    expect((await prepare(stub, request(stub))).compaction).toBeDefined();
  });
  test("native instructions alone supply focus and malformed Unicode cancels", async () => {
    const stub = await host();
    const event = request(stub);
    event.customInstructions = "Native focus";
    const result = await prepare(stub, event);
    expect(JSON.parse(result.compaction.summary).focus).toBe("Native focus");
    const malformed = request(stub);
    malformed.customInstructions = "\ud800";
    expect(await prepare(stub, malformed)).toEqual({ cancel: true });
  });
  test("shutdown invalidates receipt and permits next primary session", async () => {
    const stub = await host();
    const result = await prepare(stub, request(stub));
    const entry = commitEntry(stub, result);
    await simulate.hook(stub, "session_shutdown", {});
    stub.sessionBranch.push(entry);
    await commit(stub, entry);
    expect(notifyCount(stub)).toBe(0);
    (stub.ctx.sessionManager as any).getSessionId = () => "replacement";
    await simulate.hook(stub, "session_start", { type: "session_start", reason: "new" });
    expect((await prepare(stub, request(stub))).compaction).toBeDefined();
  });
});
