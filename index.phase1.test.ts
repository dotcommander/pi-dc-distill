import { describe, expect, test } from "bun:test";
import { createDistillExtension } from "./index.ts";
import { createStubCtx, simulate as rawSimulate } from "./tests/harness/fake-pi.ts";
import { withPreparationBranch } from "./tests/harness/preparation-fixture.ts";
const simulate = { ...rawSimulate, hook: (stub: Parameters<typeof rawSimulate.hook>[0], name: string, event: any) =>
  rawSimulate.hook(stub, name, name === "session_before_compact" ? withPreparationBranch(event, stub.sessionBranch) : event) };

import { DistillStore } from "./lib/store.ts";
import { DISTILL_CONTINUATION_MESSAGE_TYPE } from "./lib/continuation.ts";

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
  const store = Object.create(DistillStore.prototype) as DistillStore;
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
  await simulate.hook(stub, "session_compact", committed);
  expect(logAttempts).toBe(1);
  expect(dumpAttempts).toBe(1);
  expect(compactCalls(stub)).toHaveLength(0);
  expect((await simulate.hook(stub, "session_before_compact", event()))[0]).toHaveProperty("compaction.details.version", 13);
});
