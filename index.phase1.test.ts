import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Selected Pi profile must be isolated before loading the extension and its SDK.
process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "distill-admission-test-"));
const { createDistillExtension } = await import("./index.ts");
const { createStubCtx, simulate: rawSimulate } = await import("./tests/harness/fake-pi.ts");
const { withPreparationBranch } = await import("./tests/harness/preparation-fixture.ts");
const simulate = { ...rawSimulate, hook: (stub: Parameters<typeof rawSimulate.hook>[0], name: string, event: any) =>
  rawSimulate.hook(stub, name, name === "session_before_compact" ? withPreparationBranch(event, stub.sessionBranch) : event) };

import type { DistillStore as DistillStoreType } from "./lib/store.ts";
const { DistillStore } = await import("./lib/store.ts");
const { DISTILL_CONTINUATION_MESSAGE_TYPE } = await import("./lib/continuation.ts");
const { Monitor } = await import("./lib/monitor.ts");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const event = () => ({
  reason: "manual", signal: new AbortController().signal, branchEntries: [],
  preparation: { messagesToSummarize: [{ role: "user", content: "Preserve this lifecycle task and run its checks." }],
    turnPrefixMessages: [], firstKeptEntryId: "kept", tokensBefore: 120_000 },
});
function fixture(options: Parameters<typeof createDistillExtension>[0] = {}) {
  const stub = createStubCtx();
  const logs: unknown[] = [];
  const dumps: unknown[] = [];
  const store = Object.create(DistillStore.prototype) as DistillStoreType;
  store.initialize = async () => ({ status: "skipped", errors: [] } as any);
  store.appendLog = async (entry) => { logs.push(entry); };
  store.writeDump = async (...args) => { dumps.push(args); return null; };
  store.appendFailure = async () => {};
  createDistillExtension({ storeFactory: () => store,
    loadCompactionSettings: () => ({ enabled: true, reserveTokens: 16_384 }),
    loadFeatureSettings: () => ({ recall: { enabled: false }, toolOutput: { enabled: false } }),
    installCompactionDedupe: async () => null, ...options })(stub.pi);
  return { stub, store, logs, dumps };
}
const compactCalls = (stub: ReturnType<typeof createStubCtx>) => stub.calls.filter((call) => call.api === "ctx.compact");
const continuationCalls = (stub: ReturnType<typeof createStubCtx>) => stub.calls.filter((call) =>
  call.api === "pi.sendMessage" && (call.args[0] as any).customType === DISTILL_CONTINUATION_MESSAGE_TYPE);


describe("Phase 1 host adapter regression boundaries", () => {
  test("first-settled emergency requests once, with settings and concurrency guards intact", async () => {
    const { stub } = fixture();
    await simulate.hook(stub, "session_start", {});
    stub.ctx.getContextUsage = () => ({ tokens: 200_000, contextWindow: 200_000, percent: 100 });
    await simulate.hook(stub, "agent_settled", {});
    expect(compactCalls(stub)).toHaveLength(1);
    await simulate.hook(stub, "agent_settled", {});
    expect(compactCalls(stub)).toHaveLength(1);
    await simulate.hook(stub, "session_compact_failed", { reason: "overflow", fromExtension: true, aborted: true });
    expect(compactCalls(stub)).toHaveLength(1);
    (compactCalls(stub)[0].args[0] as any).onError(new Error("cancelled"));
    await simulate.hook(stub, "agent_settled", {});
    expect(compactCalls(stub)).toHaveLength(2);
    const disabled = fixture({ loadCompactionSettings: () => ({ enabled: false, reserveTokens: 16_384 }) });
    await simulate.hook(disabled.stub, "session_start", {});
    disabled.stub.ctx.getContextUsage = stub.ctx.getContextUsage;
    await simulate.hook(disabled.stub, "agent_settled", {});
    expect(compactCalls(disabled.stub)).toHaveLength(0);
  });
  test("shutdown during initialization cannot install compatibility or restore ownership", async () => {
    let installations = 0;
    const { stub, store } = fixture({ installCompactionDedupe: async () => { installations++; return null; } });
    const init = deferred<any>();
    store.initialize = () => init.promise;
    const starting = simulate.hook(stub, "session_start", {});
    await simulate.hook(stub, "session_shutdown", {});
    init.resolve({ status: "skipped", errors: [] });
    await starting;
    expect(installations).toBe(0);
    expect((await simulate.hook(stub, "session_before_compact", event()))[0]).toEqual({ cancel: true });
    expect(continuationCalls(stub)).toHaveLength(0);
  });
  test("shutdown disposes a compatibility handle that arrives late", async () => {
    const handle = deferred<any>();
    const installationStarted = deferred<void>();
    let disposed = 0;
    const { stub } = fixture({ installCompactionDedupe: () => {
      installationStarted.resolve();
      return handle.promise;
    } });
    const starting = simulate.hook(stub, "session_start", {});
    await installationStarted.promise;
    await simulate.hook(stub, "session_shutdown", {});
    handle.resolve({ dispose: () => { disposed++; } });
    await starting;
    expect(disposed).toBe(1);
    expect((await simulate.hook(stub, "session_before_compact", event()))[0]).toEqual({ cancel: true });
  });
  test("missing session identity cancels interception and never initializes storage", async () => {
    const { stub, store } = fixture();
    let initialized = 0;
    store.initialize = async () => { initialized++; return { status: "skipped", errors: [] } as any; };
    stub.ctx.sessionManager.getSessionId = () => undefined as any;
    await simulate.hook(stub, "session_start", {});
    expect(initialized).toBe(0);
    expect((await simulate.hook(stub, "session_before_compact", event()))[0]).toEqual({ cancel: true });
  });
  test("a compiler result from a retired lifetime cannot replace a newer manual transaction", async () => {
    const { stub, logs } = fixture();
    await simulate.hook(stub, "session_start", {});
    const obsolete = simulate.hook(stub, "session_before_compact", event());
    await simulate.hook(stub, "session_shutdown", {});
    await simulate.hook(stub, "session_start", {});
    expect((await obsolete)[0]).toEqual({ cancel: true });
    const [fresh] = await simulate.hook(stub, "session_before_compact", event());
    expect(fresh).toHaveProperty("compaction.details.version", 13);
    await simulate.hook(stub, "session_compact", { fromExtension: true, compactionEntry: { type: "compaction", ...(fresh as any).compaction } });
    expect(logs).toHaveLength(1);
  });
  test("sibling appends after the compaction entry cannot block the commit", async () => {
    const { stub, logs } = fixture();
    let branch: any[] = [{ type: "message", id: "anchor", message: { role: "user", content: "work" } }];
    stub.ctx.sessionManager.getBranch = () => branch;
    await simulate.hook(stub, "session_start", {});
    const [prepared] = await simulate.hook(stub, "session_before_compact", event());
    const compactionEntry = { type: "compaction", id: "c1", parentId: "anchor", ...(prepared as any).compaction };
    branch = [
      ...branch,
      compactionEntry,
      { type: "custom", id: "x1", customType: "library-loader-residency", data: { clear: true } },
      { type: "message", id: "x2", message: { role: "assistant", content: "reacted" } },
    ];
    await simulate.hook(stub, "session_compact", { fromExtension: true, compactionEntry });
    expect(logs).toHaveLength(1);
  });
  test("a superseding compaction or an abandoned entry cannot commit", async () => {
    const { stub, logs } = fixture();
    let branch: any[] = [{ type: "message", id: "anchor", message: { role: "user", content: "work" } }];
    stub.ctx.sessionManager.getBranch = () => branch;
    await simulate.hook(stub, "session_start", {});
    const [prepared] = await simulate.hook(stub, "session_before_compact", event());
    const compactionEntry = { type: "compaction", id: "c1", parentId: "anchor", ...(prepared as any).compaction };
    branch = [...branch, compactionEntry, { type: "compaction", id: "c2", parentId: "c1" }];
    await simulate.hook(stub, "session_compact", { fromExtension: true, compactionEntry });
    expect(logs).toHaveLength(0);
    branch = [
      { type: "message", id: "anchor", message: { role: "user", content: "work" } },
      { type: "message", id: "x9", message: { role: "user", content: "other branch" } },
    ];
    await simulate.hook(stub, "session_compact", { fromExtension: true, compactionEntry });
    expect(logs).toHaveLength(0);
  });
  test("duplicate commits while a store write awaits cannot duplicate effects", async () => {
    const { stub, store, logs, dumps } = fixture();
    await simulate.hook(stub, "session_start", {});
    const [prepared] = await simulate.hook(stub, "session_before_compact", event());
    const write = deferred<void>();
    store.appendLog = async (entry) => { logs.push(entry); await write.promise; };
    const committed = { fromExtension: true, compactionEntry: { type: "compaction", ...(prepared as any).compaction } };
    const first = simulate.hook(stub, "session_compact", committed);
    await simulate.hook(stub, "session_compact", committed);
    expect(logs).toHaveLength(1);
    write.resolve();
    await first;
    expect(dumps).toHaveLength(1);
  });
  test("old commit cleanup cannot release a replacement attempt or use its store", async () => {
    const { stub, store, logs, dumps } = fixture();
    await simulate.hook(stub, "session_start", {});
    const [prepared] = await simulate.hook(stub, "session_before_compact", event());
    const write = deferred<void>();
    store.appendLog = async (entry) => { logs.push(entry); await write.promise; };
    const oldCommit = simulate.hook(stub, "session_compact", {
      fromExtension: true, compactionEntry: { type: "compaction", ...(prepared as any).compaction },
    });
    await simulate.hook(stub, "session_shutdown", {});
    await simulate.hook(stub, "session_start", {});
    const [fresh] = await simulate.hook(stub, "session_before_compact", event());
    write.resolve();
    await oldCommit;
    expect(dumps).toHaveLength(0);
    expect((await simulate.hook(stub, "session_before_compact", event()))[0]).toEqual({ cancel: true });
    await simulate.hook(stub, "session_compact", { fromExtension: true, compactionEntry: { type: "compaction", ...(fresh as any).compaction } });
    expect(logs).toHaveLength(2);
    expect(dumps).toHaveLength(1);
  });

  for (const version of [8, 9, 10]) for (const interruption of ["shutdown", "navigation", "answered"] as const) {
    test(`deferred v${version} continuation respects ${interruption}`, async () => {
      const { stub } = fixture();
      let branch: any[] = [{ type: "compaction", details: { compactor: "dc-distill", version,
        autonomous: true, attemptId: "deferred" } }];
      stub.ctx.sessionManager.getBranch = () => branch;
      await simulate.hook(stub, "session_start", {});
      if (interruption === "shutdown") await simulate.hook(stub, "session_shutdown", {});
      if (interruption === "navigation") {
        branch = [];
        await simulate.hook(stub, "session_tree", {});
      }
      if (interruption === "answered") branch.push(
        { type: "custom_message", customType: DISTILL_CONTINUATION_MESSAGE_TYPE,
          details: { reason: "autonomous_compaction", attemptId: "deferred" } },
        { type: "message", message: { role: "assistant", content: "continued" } },
      );
      await tick();
      expect(continuationCalls(stub)).toHaveLength(0);
    });
  }
});

test("late autonomous A callbacks cannot release B after a session generation change", async () => {
  const { stub, logs } = fixture();
  await simulate.hook(stub, "session_start", {});
  stub.ctx.getContextUsage = () => ({ tokens: 200_000, contextWindow: 200_000, percent: 100 });
  await simulate.hook(stub, "agent_settled", {});
  const callbacksA = compactCalls(stub)[0]!.args[0] as any;
  await simulate.hook(stub, "session_start", {});
  await simulate.hook(stub, "agent_settled", {});
  callbacksA.onComplete();
  callbacksA.onError(new Error("late A"));
  await simulate.hook(stub, "agent_settled", {});
  expect(compactCalls(stub)).toHaveLength(2);
  const [prepared] = await simulate.hook(stub, "session_before_compact", event());
  const compaction = (prepared as any).compaction;
  await simulate.hook(stub, "session_compact", { fromExtension: true, compactionEntry: {
    type: "compaction", id: "B", parentId: null, timestamp: "2026-10-02T00:00:00Z", ...compaction } });
  expect(logs).toHaveLength(1);
});

test("postcommit artifacts and their failure diagnostics cannot undo a commit or retain its reservation", async () => {
  const { stub, store } = fixture();
  let logAttempts = 0, dumpAttempts = 0;
  store.appendLog = async () => { logAttempts++; throw { toString() { throw new Error("format unavailable"); } }; };
  store.writeDump = async () => { dumpAttempts++; throw new Error("dump unavailable"); };
  store.appendFailure = async () => { throw new Error("diagnostic unavailable"); };
  stub.ctx.ui.notify = () => { throw new Error("notification unavailable"); };
  await simulate.hook(stub, "session_start", {});
  const [prepared] = await simulate.hook(stub, "session_before_compact", event());
  const committed = { fromExtension: true, compactionEntry: { type: "compaction", ...(prepared as any).compaction } };
  await simulate.hook(stub, "session_compact", committed);
  // Independent artifacts retry once on failure; the duplicate event adds no attempts.
  expect(logAttempts).toBe(2);
  expect(dumpAttempts).toBe(2);
  await simulate.hook(stub, "session_compact", committed);
  expect(logAttempts).toBe(2);
  expect(dumpAttempts).toBe(2);
  expect(compactCalls(stub)).toHaveLength(0);
  expect((await simulate.hook(stub, "session_before_compact", event()))[0]).toHaveProperty("compaction.details.version", 13);
});

test("a cancelled native attempt must not wedge later native compactions", async () => {
  const { stub } = fixture();
  await simulate.hook(stub, "session_start", {});
  // Native threshold trigger whose signal aborted at hook entry: dc-distill
  // cancels silently, and the host always follows with an anonymous aborted
  // failure event (no attemptId, no ctx.compact callbacks).
  const aborted = new AbortController();
  aborted.abort();
  const cancelled = await simulate.hook(stub, "session_before_compact",
    { ...event(), reason: "threshold", signal: aborted.signal });
  expect(cancelled[0]).toEqual({ cancel: true });
  await simulate.hook(stub, "session_compact_failed",
    { reason: "threshold", aborted: true, willRetry: false, fromExtension: false });
  // The next native attempt must be intercepted, not cancelled by a stale latch.
  const [retried] = await simulate.hook(stub, "session_before_compact", event());
  expect(retried).toHaveProperty("compaction.details.compactor", "dc-distill");
});

test("a native abort after a returned result releases the dead reservation", async () => {
  const { stub } = fixture();
  await simulate.hook(stub, "session_start", {});
  const [prepared] = await simulate.hook(stub, "session_before_compact", event());
  expect(prepared).toHaveProperty("compaction.details.version", 13);
  // Host aborted after the hook returned its result but before appending it.
  await simulate.hook(stub, "session_compact_failed",
    { reason: "threshold", aborted: true, willRetry: false, fromExtension: false });
  const [retried] = await simulate.hook(stub, "session_before_compact", event());
  expect(retried).toHaveProperty("compaction.details.version", 13);
});

test("an anonymous non-aborted failure still preserves the ambiguous reservation", async () => {
  const { stub } = fixture();
  await simulate.hook(stub, "session_start", {});
  const [prepared] = await simulate.hook(stub, "session_before_compact", event());
  expect(prepared).toHaveProperty("compaction.details.version", 13);
  await simulate.hook(stub, "session_compact_failed",
    { reason: "threshold", aborted: false, errorMessage: "Auto-compaction failed: native summary error", fromExtension: false });
  const [retried] = await simulate.hook(stub, "session_before_compact", event());
  expect(retried).toEqual({ cancel: true });
});

test("monitor checks resume after a cancelled native attempt is released", async () => {
  const { stub } = fixture();
  await simulate.hook(stub, "session_start", {});
  stub.ctx.getContextUsage = () => ({ tokens: 200_000, contextWindow: 200_000, percent: 100 });
  const aborted = new AbortController();
  aborted.abort();
  expect((await simulate.hook(stub, "session_before_compact",
    { ...event(), reason: "threshold", signal: aborted.signal }))[0]).toEqual({ cancel: true });
  await simulate.hook(stub, "session_compact_failed",
    { reason: "threshold", aborted: true, willRetry: false, fromExtension: false });
  await simulate.hook(stub, "agent_settled", {});
  expect(compactCalls(stub)).toHaveLength(1);
});

describe("matching terminal commit rejection", () => {
  for (const change of ["context-revision-changed", "model-changed", "settings-changed", "snapshot-unavailable"] as const) {
    for (const diagnosticThrows of [false, true]) {
      test(`${change} releases only its attempt when diagnostics ${diagnosticThrows ? "throw" : "succeed"}`, async () => {
        let reserveTokens = 16_384;
        const diagnostics: string[] = [];
        const diagnostic = spyOn(Monitor.prototype, "diagnostic").mockImplementation((message) => {
          if (diagnosticThrows) throw new Error("diagnostic unavailable");
          diagnostics.push(message);
        });
        try {
          const { stub, logs, dumps } = fixture({ loadCompactionSettings: () => ({ enabled: true, reserveTokens }) });
          stub.ctx.model = { provider: "fake", id: "original", contextWindow: 200_000 } as any;
          await simulate.hook(stub, "session_start", {});
          const [prepared] = await simulate.hook(stub, "session_before_compact", event());
          const committed = { fromExtension: true, compactionEntry: { type: "compaction", ...(prepared as any).compaction } };
          const originalModel = stub.ctx.model;
          if (change === "context-revision-changed") await simulate.hook(stub, "session_tree", {});
          if (change === "model-changed") stub.ctx.model = { ...originalModel, id: "changed" } as any;
          if (change === "settings-changed") reserveTokens++;
          if (change === "snapshot-unavailable") stub.ctx.model = new Proxy(originalModel!, {
            get() { throw new Error("model unavailable"); },
          });
          await simulate.hook(stub, "session_compact", committed);
          expect(logs).toHaveLength(0);
          expect(dumps).toHaveLength(0);
          expect(continuationCalls(stub)).toHaveLength(0);
          if (!diagnosticThrows) expect(diagnostics).toContain(`compaction commit rejected reason=${change} reservation=released`);
          stub.ctx.model = originalModel;
          const [fresh] = await simulate.hook(stub, "session_before_compact", event());
          expect(fresh).toHaveProperty("compaction.details.version", 13);
          // A late rejected event must not clear the newly prepared reservation.
          await simulate.hook(stub, "session_compact", committed);
          expect((await simulate.hook(stub, "session_before_compact", event()))[0]).toEqual({ cancel: true });
          await simulate.hook(stub, "session_compact", {
            fromExtension: true, compactionEntry: { type: "compaction", ...(fresh as any).compaction },
          });
          expect(logs).toHaveLength(1);
        } finally { diagnostic.mockRestore(); }
      });
    }
  }
  test("foreign terminal events preserve a prepared reservation", async () => {
    const { stub, logs } = fixture();
    await simulate.hook(stub, "session_start", {});
    const [prepared] = await simulate.hook(stub, "session_before_compact", event());
    const entry = { type: "compaction", ...(prepared as any).compaction };
    await simulate.hook(stub, "session_compact", { fromExtension: false, compactionEntry: entry });
    await simulate.hook(stub, "session_compact", { fromExtension: true, compactionEntry: {
      ...entry, details: { ...entry.details, attemptId: "foreign" },
    } });
    expect((await simulate.hook(stub, "session_before_compact", event()))[0]).toEqual({ cancel: true });
    await simulate.hook(stub, "session_compact", { fromExtension: true, compactionEntry: entry });
    expect(logs).toHaveLength(1);
  });
});

test("ambiguous failure reports recovery and a lifecycle reset restores admission", async () => {
  const diagnostics: string[] = [];
  const diagnostic = spyOn(Monitor.prototype, "diagnostic").mockImplementation(message => { diagnostics.push(message); });
  try {
    const { stub, logs, dumps } = fixture();
    await simulate.hook(stub, "session_start", {});
    await simulate.hook(stub, "session_before_compact", event());
    await simulate.hook(stub, "session_compact_failed", { aborted: false, reason: "threshold", errorMessage: "ENOSPC" });
    expect(diagnostics).toContain("compaction failure ownership=ambiguous reservation=retained recovery=originating-terminal-callback-or-session-reset");
    expect((await simulate.hook(stub, "session_before_compact", event()))[0]).toEqual({ cancel: true });
    expect(logs).toHaveLength(0);
    expect(dumps).toHaveLength(0);
    await simulate.hook(stub, "session_shutdown", {});
    await simulate.hook(stub, "session_start", {});
    expect((await simulate.hook(stub, "session_before_compact", event()))[0]).toHaveProperty("compaction.details.version", 13);
  } finally { diagnostic.mockRestore(); }
});

test("ambiguous failure cannot block the originating callback even when diagnostics fail", async () => {
  const diagnostic = spyOn(Monitor.prototype, "diagnostic").mockImplementation(() => { throw new Error("diagnostic unavailable"); });
  try {
    const { stub, store } = fixture();
    store.appendFailure = async () => { throw new Error("failure store unavailable"); };
    await simulate.hook(stub, "session_start", {});
    stub.ctx.getContextUsage = () => ({ tokens: 200_000, contextWindow: 200_000, percent: 100 });
    await simulate.hook(stub, "agent_settled", {});
    const callbacks = compactCalls(stub)[0]!.args[0] as any;
    await simulate.hook(stub, "session_compact_failed", { aborted: false, reason: "threshold", errorMessage: "ENOSPC" });
    await simulate.hook(stub, "agent_settled", {});
    expect(compactCalls(stub)).toHaveLength(1);
    callbacks.onError(new Error("originating failure"));
    expect((await simulate.hook(stub, "session_before_compact", event()))[0]).toHaveProperty("compaction.details.version", 13);
  } finally { diagnostic.mockRestore(); }
});

describe("policy v3 host admission wiring", () => {
  const restoredBranch = (compaction = false) => [{ type: "message", id: "restored", parentId: null,
    timestamp: new Date(100_000).toISOString(), message: { role: "user", content: "Continue" } },
    ...(compaction ? [{ type: "compaction", id: "foreign", parentId: "restored",
      timestamp: new Date(500_000).toISOString(), firstKeptEntryId: "restored", summary: "Foreign summary",
      tokensBefore: 140_000, details: { compactor: "other", version: 8, tokensAfter: 1 } }] : [])];
  test("headroom floor bypasses startup warmup and retains concurrency", async () => {
    const { stub } = fixture({ clock: () => 1_000_000,
      loadCompactionSettings: () => ({ enabled: true, reserveTokens: 50_000 }) });
    await simulate.hook(stub, "session_start", {});
    stub.ctx.getContextUsage = () => ({ tokens: 179_520, contextWindow: 200_000, percent: 90 });
    await simulate.hook(stub, "agent_settled", {});
    await simulate.hook(stub, "agent_settled", {});
    expect(compactCalls(stub)).toHaveLength(1);
  });
  test("trusted restored startup can compact after warmup before synthetic cooldown", async () => {
    const { stub } = fixture({ clock: () => 1_000_000 });
    stub.ctx.sessionManager.getBranch = () => restoredBranch() as any;
    await simulate.hook(stub, "session_start", {});
    stub.ctx.getContextUsage = () => ({ tokens: 130_000, contextWindow: 200_000, percent: 65 });
    await simulate.hook(stub, "agent_settled", {});
    expect(compactCalls(stub)).toHaveLength(0);
    await simulate.hook(stub, "agent_settled", {});
    expect(compactCalls(stub)).toHaveLength(1);
  });
  test("foreign journal commit updates repeat admission without durable success artifacts or duplicate resets", async () => {
    const { stub, logs, dumps } = fixture({ clock: () => 1_000_000 });
    let branch = restoredBranch();
    stub.ctx.sessionManager.getBranch = () => branch as any;
    await simulate.hook(stub, "session_start", {});
    branch = restoredBranch(true);
    const commit = { fromExtension: false, compactionEntry: branch.at(-1) };
    await simulate.hook(stub, "session_compact", commit);
    stub.ctx.getContextUsage = () => ({ tokens: 130_000, contextWindow: 200_000, percent: 65 });
    await simulate.hook(stub, "agent_settled", {});
    await simulate.hook(stub, "agent_settled", {});
    await simulate.hook(stub, "session_compact", commit);
    stub.ctx.getContextUsage = () => ({ tokens: 133_999, contextWindow: 200_000, percent: 67 });
    await simulate.hook(stub, "agent_settled", {});
    expect(compactCalls(stub)).toHaveLength(0);
    stub.ctx.getContextUsage = () => ({ tokens: 134_000, contextWindow: 200_000, percent: 67 });
    await simulate.hook(stub, "agent_settled", {});
    expect(compactCalls(stub)).toHaveLength(1);
    expect(logs).toHaveLength(0);
    expect(dumps).toHaveLength(0);
    expect(continuationCalls(stub)).toHaveLength(0);
  });
});
