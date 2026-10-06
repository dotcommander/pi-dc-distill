import { expect, spyOn, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "distill-boundary-test-"));
const { createDistillExtension } = await import("./index.ts");
const { createStubCtx, simulate } = await import("./tests/harness/fake-pi.ts");
const { DistillStore } = await import("./lib/store.ts");
const { buildSessionProjection } = await import("./lib/sdk.ts");
const Strategy = await import("./lib/strategy.ts");

async function fixture() {
  const stub = createStubCtx();
  let now = 1_000_000;
  let tokens: number | null = null;
  let enabled = true;
  let reserveTokens = 16_384;
  const logs: unknown[] = [];
  const failures: unknown[] = [];
  const branch: any[] = [{ type: "compaction", id: "old", parentId: null,
    timestamp: new Date(500_000).toISOString(), summary: "Previous context.",
    firstKeptEntryId: "warmup", tokensBefore: 100_000, details: { tokensAfter: 1 } }];
  stub.ctx.sessionManager.getBranch = () => branch;
  stub.ctx.model = { provider: "fake", id: "one", contextWindow: 200_000 } as any;
  stub.ctx.getContextUsage = () => ({ tokens, contextWindow: 200_000, percent: 65 });
  const store = Object.create(DistillStore.prototype);
  store.initialize = async () => ({ status: "skipped", errors: [] });
  store.appendLog = async (entry: unknown) => { logs.push(entry); };
  store.appendFailure = async (reasons: unknown) => { failures.push(reasons); };
  store.writeDump = async () => null;
  createDistillExtension({ clock: () => now, storeFactory: () => store,
    loadCompactionSettings: () => ({ enabled, reserveTokens }),
    loadFeatureSettings: () => ({ recall: { enabled: false }, toolOutput: { enabled: false } }),
    installCompactionDedupe: async () => null })(stub.pi);
  await simulate.hook(stub, "session_start", {});
  const assistant = (id: string, stopReason = "toolUse") => stopReason === "aborted"
    ? { ...nativeAbortEntry(branch.at(-1)?.id), id, message: { ...nativeAbortEntry(branch.at(-1)?.id).message, stopReason: "aborted" } }
    : ({ type: "message", id,
    parentId: branch.at(-1)?.id, timestamp: new Date(now).toISOString(),
    message: { role: "assistant", stopReason, content: [{ type: "toolCall", id: `call-${id}`, name: "read", arguments: { path: "file" } }],
      usage: { totalTokens: 190_000 } } });
  const persist = (id: string, isError = false) => {
    const entry = assistant(id);
    branch.push(entry);
    const result = { role: "toolResult", toolCallId: `call-${id}`, toolName: "read", isError, content: [{ type: "text", text: "done" }] };
    const resultId = `result-${id}`;
    branch.push({ type: "message", id: resultId, parentId: id, timestamp: new Date(now).toISOString(), message: result });
    return { message: entry.message, messageEntryId: id, toolResults: [result], toolResultEntryIds: [resultId], outcome: "completed" };
  };
  const calls = (api: string) => stub.calls.filter((call) => call.api === api);
  return { stub, branch, logs, failures, store, assistant, persist, calls,
    tokens: (value: number | null) => { tokens = value; }, disable: () => { enabled = false; },
    reserve: (value: number) => { reserveTokens = value; },
    advance: () => { now += 300_000; }, clock: (value: number) => { now = value; } };
}

function nativeAbortEntry(parentId: string): any {
  return { type: "message", id: "native-abort", parentId, timestamp: new Date(1_000_000).toISOString(),
    message: { role: "assistant", content: [], api: "openai-completions", provider: "fake", model: "one",
      stopReason: "error", errorMessage: "This operation was aborted", timestamp: 1_000_000,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } };
}

test("tools finish across repeated threshold observations before one settled assessment", async () => {
  const f = await fixture();
  const early = f.assistant("first");
  await simulate.hook(f.stub, "message_end", { message: early.message });
  f.branch.push(early);
  f.tokens(130_000);
  await simulate.hook(f.stub, "tool_call", { toolCallId: "call-first", toolName: "read", input: { path: "file" } });
  await simulate.hook(f.stub, "turn_end", f.persist("warmup"));
  expect(f.calls("ctx.abort")).toHaveLength(0);
  expect(f.calls("ctx.compact")).toHaveLength(0);
  await simulate.hook(f.stub, "agent_settled", {});
  await simulate.hook(f.stub, "agent_settled", {});
  expect(f.calls("ctx.compact")).toHaveLength(0);
  f.tokens(133_999);
  await simulate.hook(f.stub, "turn_end", f.persist("short"));
  await simulate.hook(f.stub, "agent_settled", {});
  expect(f.calls("ctx.compact")).toHaveLength(0);
  f.tokens(134_000);
  await simulate.hook(f.stub, "turn_end", f.persist("ready"));
  f.tokens(200_000);
  await simulate.hook(f.stub, "tool_call", { toolCallId: "call-next", toolName: "read", input: { path: "next" } });
  const last = f.persist("finished");
  await simulate.hook(f.stub, "turn_end", last);
  await simulate.hook(f.stub, "turn_end", last);
  expect(f.calls("ctx.abort")).toHaveLength(0);
  expect(f.calls("ctx.compact")).toHaveLength(0);
  let reads = 0;
  f.stub.ctx.getContextUsage = () => { reads++; return { tokens: 200_000, contextWindow: 200_000, percent: 100 }; };
  await simulate.hook(f.stub, "agent_settled", {});
  await simulate.hook(f.stub, "agent_settled", {});
  expect(reads).toBe(1);
  expect(f.calls("ctx.compact")).toHaveLength(1);
  expect(f.branch.at(-1).id).toBe("result-finished");
  expect(f.logs).toHaveLength(0);
  expect(f.calls("pi.sendMessage")).toHaveLength(0);
});

for (const band of [
  { name: "auto", tokens: 134_000, reserve: 16_384, compacts: 1 },
  { name: "warn", tokens: 165_000, reserve: 40_000, compacts: 0 },
  { name: "missed auto pursuit", tokens: 165_000, reserve: 40_000, compacts: 1, baseline: 130_000 },
  { name: "headroom floor", tokens: 179_520, reserve: 16_384, compacts: 1 },
  { name: "emergency", tokens: 200_000, reserve: 16_384, compacts: 1 },
]) {
  test(band.name + " waits for settlement and uses its current usage", async () => {
    const f = await fixture();
    f.reserve(band.reserve);
    f.tokens(band.baseline ?? 100_000);
    await simulate.hook(f.stub, "turn_end", f.persist("baseline"));
    await simulate.hook(f.stub, "agent_settled", {});
    f.tokens(band.tokens);
    for (const id of ["first", "second", "third"]) {
      f.branch.push(f.assistant(id));
      await simulate.hook(f.stub, "tool_call", { toolCallId: "call-" + id, toolName: "read", input: { path: id } });
      await simulate.hook(f.stub, "turn_end", f.persist(id + "-completed"));
      expect(f.calls("ctx.abort")).toHaveLength(0);
      expect(f.calls("ctx.compact")).toHaveLength(0);
      expect(f.calls("pi.sendMessage")).toHaveLength(0);
    }
    await simulate.hook(f.stub, "agent_settled", {});
    await simulate.hook(f.stub, "agent_settled", {});
    expect(f.calls("ctx.compact")).toHaveLength(band.compacts);
    expect(f.calls("pi.sendMessage")).toHaveLength(band.compacts === 0 ? 1 : 0);
    expect(f.calls("ctx.abort")).toHaveLength(0);
  });
}

test("settlement re-checks falling usage instead of using a sampled boundary decision", async () => {
  const f = await fixture();
  f.tokens(200_000);
  await simulate.hook(f.stub, "turn_end", f.persist("finished"));
  f.tokens(100_000);
  await simulate.hook(f.stub, "agent_settled", {});
  expect(f.calls("ctx.compact")).toHaveLength(0);
  expect(f.calls("ctx.abort")).toHaveLength(0);
});

for (const invalidation of ["input", "queued-input", "disabled", "usage", "child"]) {
  test(invalidation + " excludes settlement and duplicate retry", async () => {
    const f = await fixture();
    f.tokens(130_000);
    await simulate.hook(f.stub, "turn_end", f.persist("warmup"));
    await simulate.hook(f.stub, "agent_settled", {});
    f.tokens(134_000);
    await simulate.hook(f.stub, "turn_end", f.persist("ready"));
    if (invalidation === "input") await simulate.hook(f.stub, "input", { source: "rpc" });
    if (invalidation === "queued-input") f.stub.ctx.hasPendingMessages = () => true;
    if (invalidation === "disabled") f.disable();
    if (invalidation === "usage") f.tokens(null);
    if (invalidation === "child") f.stub.ctx.sessionManager.getSessionId = () => "child";
    await simulate.hook(f.stub, "agent_settled", {});
    f.tokens(200_000);
    f.stub.ctx.hasPendingMessages = () => false;
    await simulate.hook(f.stub, "agent_settled", {});
    expect(f.calls("ctx.compact")).toHaveLength(0);
    expect(f.calls("ctx.abort")).toHaveLength(0);
    expect(f.logs).toHaveLength(0);
  });
}

test("hosts without turn_end retain settlement-only admission and duplicate fencing", async () => {
  const f = await fixture();
  f.tokens(130_000);
  f.persist("warmup");
  await simulate.hook(f.stub, "agent_settled", {});
  await simulate.hook(f.stub, "agent_settled", {});
  f.tokens(134_000);
  f.persist("baseline");
  await simulate.hook(f.stub, "agent_settled", {});
  expect(f.calls("ctx.compact")).toHaveLength(0);
  f.tokens(138_000);
  f.persist("grown");
  await simulate.hook(f.stub, "agent_settled", {});
  await simulate.hook(f.stub, "agent_settled", {});
  expect(f.calls("ctx.compact")).toHaveLength(1);
  expect(f.calls("ctx.abort")).toHaveLength(0);
});

test("completed failed-tool siblings survive settlement and exact-leaf preparation", async () => {
  const f = await fixture();
  f.tokens(130_000);
  await simulate.hook(f.stub, "turn_end", f.persist("warmup"));
  await simulate.hook(f.stub, "agent_settled", {});
  f.tokens(134_000);
  const failed = f.persist("failed-read", true);
  failed.message.content[0].arguments.path = "failed-file";
  failed.toolResults[0].content[0].text = "read failed: permission denied";
  failed.message.content.push({ type: "toolCall", id: "call-sibling", name: "read", arguments: { path: "sibling-file" } });
  const sibling = { role: "toolResult", toolCallId: "call-sibling", toolName: "read", isError: false, content: [{ type: "text", text: "sibling succeeded" }] };
  f.branch.push({ type: "message", id: "result-sibling", parentId: f.branch.at(-1).id, timestamp: new Date(1_000_000).toISOString(), message: sibling });
  failed.toolResults.push(sibling);
  failed.toolResultEntryIds.push("result-sibling");
  await simulate.hook(f.stub, "turn_end", failed);
  expect(f.calls("ctx.compact")).toHaveLength(0);
  await simulate.hook(f.stub, "agent_settled", {});
  expect(f.calls("ctx.compact")).toHaveLength(1);
  const [prepared] = await simulate.hook(f.stub, "session_before_compact", preparationFor(f));
  expect(prepared).toHaveProperty("compaction.details.version", 14);
  expect(prepared).toHaveProperty("compaction.firstKeptEntryId", "result-sibling");
  expect(prepared).toHaveProperty("compaction.details.autonomous", true);
  expect((prepared as any).compaction.details.checkpoint.failures).toContainEqual(expect.objectContaining({
    observedOutcome: expect.stringContaining("permission denied"), resolution: null, invocationDigest: expect.any(String),
  }));
  expect(f.branch.find((entry) => entry.id === "result-failed-read").message.isError).toBe(true);
  expect(f.calls("ctx.abort")).toHaveLength(0);
  expect(f.logs).toHaveLength(0);
  expect(f.calls("pi.sendMessage")).toHaveLength(0);
});

for (const invalidation of ["user", "model", "tree", "foreign", "session"]) {
  test(invalidation + " fences old settlement and permits a new completed run", async () => {
    const f = await fixture();
    f.tokens(130_000);
    await simulate.hook(f.stub, "turn_end", f.persist("warmup"));
    await simulate.hook(f.stub, "agent_settled", {});
    f.tokens(134_000);
    await simulate.hook(f.stub, "turn_end", f.persist("old-ready"));
    if (invalidation === "user") await simulate.hook(f.stub, "message_end", { message: { role: "user", content: "new request" } });
    if (invalidation === "model") {
      f.stub.ctx.model = { ...f.stub.ctx.model!, id: "other" };
      await simulate.hook(f.stub, "model_select", {});
    }
    if (invalidation === "tree") {
      f.branch.push(f.assistant("different-old-leaf", "stop"));
      await simulate.hook(f.stub, "session_tree", {});
    }
    if (invalidation === "foreign") {
      const foreign = { type: "compaction", id: "foreign", parentId: f.branch.at(-1).id, timestamp: new Date(600_000).toISOString(),
        summary: "Foreign context.", firstKeptEntryId: "warmup", tokensBefore: 100_000 };
      f.branch.push(foreign);
      await simulate.hook(f.stub, "session_compact", { fromExtension: false, compactionEntry: foreign });
    }
    if (invalidation === "session") {
      await simulate.hook(f.stub, "session_shutdown", {});
      await simulate.hook(f.stub, "session_start", {});
      f.branch.push(f.assistant("cancelled-old-run", "aborted"));
    }
    await simulate.hook(f.stub, "agent_settled", {});
    await simulate.hook(f.stub, "agent_settled", {});
    expect(f.calls("ctx.compact")).toHaveLength(0);
    const user = { role: "user", content: "fresh user request" };
    await simulate.hook(f.stub, "message_end", { message: user });
    f.branch.push({ type: "message", id: "fresh-user", parentId: f.branch.at(-1).id, timestamp: new Date(1_000_000).toISOString(), message: user });
    f.tokens(130_000);
    await simulate.hook(f.stub, "turn_end", f.persist("fresh-baseline"));
    await simulate.hook(f.stub, "agent_settled", {});
    f.tokens(138_000);
    await simulate.hook(f.stub, "turn_end", f.persist("fresh-grown"));
    await simulate.hook(f.stub, "agent_settled", {});
    expect(f.calls("ctx.compact")).toHaveLength(1);
    expect(f.calls("ctx.abort")).toHaveLength(0);
  });
}

for (const outcome of ["error", "aborted"]) {
  test(outcome + " completion and native abort shape cannot authorize settlement", async () => {
    const f = await fixture();
    f.tokens(200_000);
    const failed = f.persist("failed");
    failed.outcome = outcome;
    await simulate.hook(f.stub, "turn_end", failed);
    await simulate.hook(f.stub, "agent_settled", {});
    expect(f.calls("ctx.compact")).toHaveLength(0);
    const aborted = nativeAbortEntry(f.branch.at(-1).id);
    f.branch.push(aborted);
    await simulate.hook(f.stub, "turn_end", { outcome: "error", message: aborted.message, messageEntryId: aborted.id, toolResults: [], toolResultEntryIds: [] });
    await simulate.hook(f.stub, "agent_settled", {});
    await simulate.hook(f.stub, "agent_settled", {});
    expect(f.calls("ctx.compact")).toHaveLength(0);
    expect(f.calls("ctx.abort")).toHaveLength(0);
  });
}

test("urgent sampled fallback survives unavailable settlement usage", async () => {
  const f = await fixture();
  f.tokens(200_000);
  await simulate.hook(f.stub, "turn_end", f.persist("urgent"));
  f.tokens(null);
  await simulate.hook(f.stub, "agent_settled", {});
  await simulate.hook(f.stub, "agent_settled", {});
  expect(f.calls("ctx.compact")).toHaveLength(1);
  expect(f.calls("ctx.abort")).toHaveLength(0);
});


function preparationFor(f: Awaited<ReturnType<typeof fixture>>, previousSummary?: string): any {
  const projected = buildSessionProjection(f.branch).entries;
  const prior = projected.findIndex(entry => entry.sourceEntry.type === "compaction" && entry.messages.length > 0);
  const last = projected.at(-1)!;
  return { reason: "manual", signal: new AbortController().signal, branchEntries: f.branch,
    preparation: { previousSummary: previousSummary ?? (prior >= 0 ? (projected[prior].sourceEntry as any).summary : undefined),
      messagesToSummarize: projected.slice(prior + 1, -1).flatMap(entry => entry.sourceEntry.type === "compaction"
        ? [] : entry.messages.filter(message => message.role !== "system")),
      turnPrefixMessages: [], firstKeptEntryId: last.sourceEntry.id, tokensBefore: 200_000 } };
}
async function submitUrgent(f: Awaited<ReturnType<typeof fixture>>) {
  f.tokens(200_000);
  await simulate.hook(f.stub, "turn_end", f.persist("urgent"));
  await simulate.hook(f.stub, "agent_settled", {});
  expect(f.calls("ctx.abort")).toHaveLength(0);
  expect(f.calls("ctx.compact")).toHaveLength(1);
}
async function laterPrompt(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  const message = { role: "user", content: `Please continue ${id}.` };
  f.branch.push({ type: "message", id: `user-${id}`, parentId: f.branch.at(-1).id, timestamp: new Date(1_000_000).toISOString(), message });
  await simulate.hook(f.stub, "message_end", { message });
  await simulate.hook(f.stub, "turn_end", f.persist(id));
  await simulate.hook(f.stub, "agent_settled", {});
}

for (const failure of ["invalid_input", "invalid_checkpoint", "protected_overflow", "required_analysis_overflow", "compiler_failure", "unstructured"] as const) {
  test(`local ${failure} pauses repeated urgent submissions and reports once despite host terminal callbacks`, async () => {
    const f = await fixture();
    await submitUrgent(f);
    const mock = spyOn(Strategy, "runStrategies").mockResolvedValue({ ok: false, reasons: ["opaque reason"],
      ...(failure === "unstructured" ? {} : { failure: { code: failure } }) } as any);
    try {
      expect((await simulate.hook(f.stub, "session_before_compact", preparationFor(f)))[0]).toEqual({ cancel: true });
    } finally { mock.mockRestore(); }
    const pauseNotices = () => f.calls("ui.notify").filter((call) => String(call.args[0]).includes("automatic compaction paused"));
    expect(pauseNotices()).toHaveLength(1);
    expect(f.failures).toHaveLength(1);
    await simulate.hook(f.stub, "session_compact_failed", { reason: "threshold", aborted: false, errorMessage: "host noticed compiler cancellation" });
    expect(f.failures).toHaveLength(1);
    const callbacks = f.calls("ctx.compact")[0].args[0] as any;
    callbacks.onError(new Error("host noticed compiler cancellation"));
    await simulate.hook(f.stub, "session_compact_failed", { reason: "threshold", aborted: true });
    f.tokens(250_000);
    await laterPrompt(f, "new-turn");
    await laterPrompt(f, "another-turn");
    expect(f.calls("ctx.abort")).toHaveLength(0);
    expect(f.calls("ctx.compact")).toHaveLength(1);
    expect(pauseNotices()).toHaveLength(1);
    expect(f.logs).toHaveLength(0);
    expect(f.calls("pi.sendMessage")).toHaveLength(0);
  });
}
for (const stage of ["empty-source", "source", "compile-exception", "validation", "capacity"]) {
  test(`${stage} local failure is fenced before reporting and keeps manual recovery transactional`, async () => {
    const f = await fixture();
    if (stage === "capacity") {
      f.reserve(0);
      f.stub.ctx.model = { ...f.stub.ctx.model!, contextWindow: 4_000 };
      f.stub.ctx.getContextUsage = () => ({ tokens: 180_000, contextWindow: 4_000, percent: 100 });
    }
    await submitUrgent(f);
    const input = preparationFor(f, stage === "source" ? "Bad Unicode \ud800" : "Previous context.");
    if (stage === "empty-source") input.preparation = { ...input.preparation, previousSummary: undefined, messagesToSummarize: [] };
    let restore = () => {};
    if (stage === "compile-exception") {
      const mock = spyOn(Strategy, "runStrategies").mockRejectedValue(new Error("untyped local compiler exception"));
      restore = () => mock.mockRestore();
    }
    if (stage === "validation") {
      const original = Strategy.runStrategies;
      const mock = spyOn(Strategy, "runStrategies").mockImplementation(async (...args) => {
        const result = await original(...args);
        return result.ok ? { ...result, checkpointDigest: "bad digest" } : result;
      });
      restore = () => mock.mockRestore();
    }
    if (stage === "capacity") {
      const original = Strategy.runStrategies;
      const mock = spyOn(Strategy, "runStrategies").mockImplementation(async (...args) => {
        const result = await original(...args);
        return result.ok ? { ...result, summary: "Capacity payload. ".repeat(3_000) } : result;
      });
      restore = () => mock.mockRestore();
    }
    try { expect((await simulate.hook(f.stub, "session_before_compact", input))[0]).toEqual({ cancel: true }); }
    finally { restore(); }
    expect(f.failures).toHaveLength(1);
    await simulate.hook(f.stub, "session_compact_failed", { reason: "threshold", aborted: true });
    f.tokens(180_000);
    await laterPrompt(f, "still-paused");
    expect(f.calls("ctx.abort")).toHaveLength(0);
    // Failed manual/native attempts are allowed, but cannot reset the pause.
    expect((await simulate.hook(f.stub, "session_before_compact", preparationFor(f, "Bad Unicode \ud800")))[0]).toEqual({ cancel: true });
    await simulate.hook(f.stub, "session_compact_failed", { reason: "manual", aborted: true });
    await laterPrompt(f, "manual-failed");
    expect(f.calls("ctx.abort")).toHaveLength(0);
    if (stage === "capacity") {
      f.branch.splice(1, f.branch.length - 1, { type: "message", id: "compact-tail", parentId: "old", timestamp: new Date(1_000_000).toISOString(), message: { role: "user", content: "Recovery" } });
    }
    const [prepared] = await simulate.hook(f.stub, "session_before_compact", preparationFor(f));
    expect(prepared).toHaveProperty("compaction.details.autonomous", false);
    const compaction = (prepared as any).compaction;
    // Even a newest active entry cannot clear the pause with a mismatched digest.
    const entry = { type: "compaction", id: "recovery", parentId: f.branch.at(-1).id,
      timestamp: new Date(1_000_000).toISOString(), ...compaction };
    f.branch.push(entry);
    await simulate.hook(f.stub, "session_compact", { fromExtension: true, compactionEntry: { ...entry, summary: "tampered" } });
    expect(f.logs).toHaveLength(0);
    expect(f.calls("pi.sendMessage")).toHaveLength(0);
    for (const corruption of ["missing-compactor", "wrong-compactor", "missing-version", "wrong-version"]) {
      const details = { ...entry.details };
      if (corruption === "missing-compactor") delete details.compactor;
      if (corruption === "wrong-compactor") details.compactor = "foreign";
      if (corruption === "missing-version") delete details.version;
      if (corruption === "wrong-version") details.version = 13;
      await simulate.hook(f.stub, "session_compact", { fromExtension: true, compactionEntry: { ...entry, details } });
      expect(f.logs).toHaveLength(0);
    }
    // A new prompt still cannot submit after forged recovery notifications.
    f.tokens(250_000);
    await simulate.hook(f.stub, "agent_settled", {});
    expect(f.calls("ctx.abort")).toHaveLength(0);
    // The genuine recovery remains newest even after ordinary descendant work.
    await simulate.hook(f.stub, "session_compact", { fromExtension: true, compactionEntry: entry });
    expect(f.logs).toHaveLength(1);
    expect(f.calls("pi.sendMessage")).toHaveLength(0);
    f.tokens(250_000);
    await laterPrompt(f, "recovered");
    expect(f.calls("ctx.abort")).toHaveLength(0);
    expect(f.calls("ctx.compact")).toHaveLength(2);
  });
}
for (const exception of ["cancelled", "host-header", "host-submit", "throwing-report"]) {
  test(`${exception} preserves failure classification and reservation ownership`, async () => {
    const f = await fixture();
    await submitUrgent(f);
    const input = preparationFor(f);
    if (exception === "cancelled") {
      const signal = new AbortController(); signal.abort(); input.signal = signal.signal;
    }
    if (exception === "host-header") f.stub.ctx.sessionManager.getHeader = () => { throw new Error("host header unavailable"); };
    if (exception === "throwing-report") {
      f.store.appendFailure = async () => { throw new Error("report unavailable"); };
      f.stub.ctx.ui.notify = () => { throw new Error("notification unavailable"); };
      input.preparation.previousSummary = "Bad Unicode \ud800";
    }
    if (exception !== "host-submit") expect((await simulate.hook(f.stub, "session_before_compact", input))[0]).toEqual({ cancel: true });
    (f.calls("ctx.compact")[0].args[0] as any).onError(new Error("host submission failed"));
    f.tokens(250_000);
    await laterPrompt(f, "later");
    expect(f.calls("ctx.abort")).toHaveLength(0);
    expect(f.calls("ctx.compact")).toHaveLength(exception === "throwing-report" ? 1 : 2);
    expect(f.logs).toHaveLength(0);
    expect(f.calls("pi.sendMessage")).toHaveLength(0);
  });
}

for (const fromExtension of [false, true]) {
  test(`validated newest foreign recovery fromExtension=${fromExtension} clears automatic pause without local success artifacts`, async () => {
    const f = await fixture();
    await submitUrgent(f);
    const mock = spyOn(Strategy, "runStrategies").mockResolvedValue({ ok: false, cancelled: false, reasons: ["local failure"], failure: { code: "compiler_failure" } });
    try { expect((await simulate.hook(f.stub, "session_before_compact", preparationFor(f)))[0]).toEqual({ cancel: true }); }
    finally { mock.mockRestore(); }
    await simulate.hook(f.stub, "session_compact_failed", { reason: "threshold", aborted: true });
    const foreign = { type: "compaction", id: "foreign-recovery", parentId: f.branch.at(-1).id,
      timestamp: new Date(1_000_000).toISOString(), summary: "Recovered by another compactor.",
      firstKeptEntryId: f.branch.at(-1).id, tokensBefore: 200_000,
      ...(fromExtension ? { details: { compactor: "other-extension", version: 1 } } : {}) };
    f.branch.push(foreign);
    await simulate.hook(f.stub, "session_compact", { fromExtension, compactionEntry: foreign });
    expect(f.logs).toHaveLength(0);
    expect(f.calls("pi.sendMessage")).toHaveLength(0);
    f.tokens(250_000);
    await laterPrompt(f, "foreign-recovered");
    expect(f.calls("ctx.abort")).toHaveLength(0);
    expect(f.calls("ctx.compact")).toHaveLength(2);
  });
}
