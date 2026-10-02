import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDistillExtension } from "./index.ts";
import { sha256Hex } from "./lib/sha256.ts";
import { DistillStore } from "./lib/store.ts";
import { createStubCtx, simulate as rawSimulate } from "./tests/harness/fake-pi.ts";
import { withPreparationBranch } from "./tests/harness/preparation-fixture.ts";
const simulate = { ...rawSimulate, hook: (stub: Parameters<typeof rawSimulate.hook>[0], name: string, event: any) =>
  rawSimulate.hook(stub, name, name === "session_before_compact" ? withPreparationBranch(event, stub.sessionBranch) : event) };

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(recall = true) {
  const root = mkdtempSync(join(tmpdir(), "distill-phase5-"));
  const stub = createStubCtx();
  const id = crypto.randomUUID();
  stub.ctx.sessionManager.getSessionId = () => id;
  const store = new DistillStore({ dataDir: join(root, "data"), projectRoot: join(root, "project"),
    projectIdentity: stub.ctx.cwd, legacyDir: join(root, "missing") });
  createDistillExtension({ storeFactory: () => store,
    loadFeatureSettings: () => ({ recall: { enabled: recall }, toolOutput: { enabled: false } }),
    loadCompactionSettings: () => ({ enabled: true, reserveTokens: 16384 }),
  })(stub.pi);
  return { stub, store };
}
async function prepareAutonomous(stub: ReturnType<typeof createStubCtx>) {
  stub.ctx.getContextUsage = () => ({ tokens: 200000, contextWindow: 200000, percent: 100 });
  await simulate.hook(stub, "agent_settled", {});
  const [result] = await simulate.hook(stub, "session_before_compact", {
    reason: "overflow", signal: new AbortController().signal, branchEntries: [],
    preparation: { messagesToSummarize: [{ role: "user", content: "Continue repairing src/main.ts" }],
      turnPrefixMessages: [], firstKeptEntryId: "kept", tokensBefore: 120000 },
  });
  const entry = { type: "compaction", id: crypto.randomUUID(), parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z", ...(result as any).compaction };
  stub.ctx.sessionManager.getBranch = () => [entry] as any;
  return entry;
}
function sends(stub: ReturnType<typeof createStubCtx>) {
  return stub.calls.filter(call => call.api === "pi.sendMessage"
    && (call.args[0] as any).customType === "dc-distill-continuation");
}

describe("Phase 5 independent host-commit effects", () => {
  test("every auxiliary failure is isolated and continuation/latch still progress", async () => {
    const { stub, store } = fixture();
    const failures: string[][] = [];
    await simulate.hook(stub, "session_start", {});
    store.appendLog = async () => { throw new Error("log unavailable"); };
    store.writeDump = async () => { throw new Error("dump unavailable"); };
    store.reconcileRecall = async () => { throw new Error("recall unavailable"); };
    store.appendFailure = async reasons => { failures.push(reasons); };
    stub.ctx.ui.notify = () => { throw new Error("notification unavailable"); };
    const entry = await prepareAutonomous(stub);
    await simulate.hook(stub, "session_compact", { fromExtension: true, compactionEntry: entry });
    await tick();
    expect(sends(stub)).toHaveLength(1);
    expect(failures.flat().join("\n")).toContain("Compaction log failed");
    expect(failures.flat().join("\n")).toContain("Compaction dump failed");
    expect(failures.flat().join("\n")).toContain("Recall reconciliation failed");
    expect(failures.flat().join("\n")).toContain("Compaction notification failed");
    // A manual preparation can begin after the failed effects: commit latch released.
    const [next] = await simulate.hook(stub, "session_before_compact", {
      reason: "manual", signal: new AbortController().signal, branchEntries: [],
      preparation: { messagesToSummarize: [{ role: "user", content: "next operation" }],
        turnPrefixMessages: [], firstKeptEntryId: "next", tokensBefore: 1000 },
    });
    expect((next as any).compaction).toBeDefined();
  });

  test("failed initialization does not prevent branch continuation recovery", async () => {
    const { stub, store } = fixture();
    store.initialize = async () => { throw new Error("initialization unavailable"); };
    const attemptId = crypto.randomUUID();
    stub.ctx.sessionManager.getBranch = () => [{ type: "compaction", details: {
      compactor: "dc-distill", version: 12, autonomous: true, attemptId,
    } }] as any;
    await simulate.hook(stub, "session_start", {});
    await tick();
    expect(sends(stub)).toHaveLength(1);
  });

  test("disabled recall bypasses recovery storage at start, commit and tree", async () => {
    const { stub, store } = fixture(false);
    let reconciliations = 0;
    store.reconcileRecall = async () => { reconciliations++; throw new Error("disabled recall touched"); };
    await simulate.hook(stub, "session_start", {});
    const entry = await prepareAutonomous(stub);
    await simulate.hook(stub, "session_compact", { fromExtension: true, compactionEntry: entry });
    await simulate.hook(stub, "session_tree", {});
    await tick();
    expect(reconciliations).toBe(0);
    expect(sends(stub)).toHaveLength(1);
  });

  for (const recallEnabled of [true, false]) {
    test(`restart after host append recovers recall idempotently; recall enabled=${recallEnabled}`, async () => {
      const { stub, store } = fixture(recallEnabled);
      const summary = "## Current intent\nRepair the parser and preserve its verification evidence.";
      const entry = {
        type: "compaction", id: "host-committed-before-crash", parentId: null,
        timestamp: "2025-12-03T04:05:06.000Z", firstKeptEntryId: "kept-entry",
        tokensBefore: 123456, summary,
        details: { compactor: "dc-distill", version: 12, tier: 1,
          autonomous: false, attemptId: "crash-gap-attempt", tokensAfter: 3210,
          summaryTokens: 20, tokensAfterSource: "pi-rebuilt-message-estimate",
          summaryDigest: sha256Hex(summary) },
      };
      // The recovered instance has only Pi's persisted host entry. It never
      // prepared this attempt or received session_compact before the crash.
      stub.ctx.sessionManager.getBranch = () => [entry] as any;
      const recallPath = join(store.projectRoot, "recall.json");
      expect(existsSync(recallPath)).toBe(false);
      let disabledReads = 0;
      let disabledWrites = 0;
      if (!recallEnabled) {
        store.loadRecall = async () => { disabledReads++; throw new Error("disabled recall read"); };
        store.reconcileRecall = async () => { disabledWrites++; throw new Error("disabled recall publication"); };
        store.persistRecall = async () => { disabledWrites++; throw new Error("disabled recall write"); };
      }
      await simulate.hook(stub, "session_start", {});
      if (recallEnabled) {
        const expected = [{ ts: entry.timestamp, before: entry.tokensBefore,
          after: entry.details.tokensAfter, summary, project: resolve(stub.ctx.cwd),
          sessionId: stub.ctx.sessionManager.getSessionId(), compactionEntryId: entry.id,
          summaryDigest: entry.details.summaryDigest, attemptId: entry.details.attemptId,
          tokenSource: "pi-rebuilt-message-estimate" }];
        expect(await store.loadRecall()).toEqual(expected);
        // Repeated session starts and active-branch recovery must keep one row
        // with its original host timestamp, rather than promoting it to now.
        await simulate.hook(stub, "session_start", { reason: "resume" });
        await simulate.hook(stub, "session_tree", {});
        expect(await store.loadRecall()).toEqual(expected);
      } else {
        await simulate.hook(stub, "session_start", { reason: "resume" });
        await simulate.hook(stub, "session_tree", {});
        expect(disabledReads).toBe(0);
        expect(disabledWrites).toBe(0);
        expect(existsSync(recallPath)).toBe(false);
      }
    });
  }

  for (const recallFailure of [false, true]) {
    test(`startup arms continuation only after slow recall settles; failure=${recallFailure}`, async () => {
      const { stub, store } = fixture();
      const summary = "## Current intent\nContinue the interrupted repair.";
      const attemptId = crypto.randomUUID();
      stub.ctx.sessionManager.getBranch = () => [{ type: "compaction", id: "startup-committed",
        timestamp: "2026-01-01T00:00:00.000Z", firstKeptEntryId: "kept", tokensBefore: 1000, summary,
        details: { compactor: "dc-distill", version: 12, autonomous: true, attemptId,
          tokensAfter: 100, tokensAfterSource: "pi-rebuilt-message-estimate", summaryDigest: sha256Hex(summary) },
      }] as any;
      let release!: () => void;
      let entered!: () => void;
      const waiting = new Promise<void>(resolve => { release = resolve; });
      const enteredRecall = new Promise<void>(resolve => { entered = resolve; });
      store.reconcileRecall = async () => {
        entered();
        await waiting;
        if (recallFailure) throw new Error("recall startup publication unavailable");
        return { conflicts: [], published: true };
      };
      const failures: string[][] = [];
      store.appendFailure = async reasons => { failures.push(reasons); };
      let startupComplete = false;
      const send = stub.pi.sendMessage.bind(stub.pi);
      stub.pi.sendMessage = ((...args: Parameters<typeof send>) => {
        // Models RPC event subscribers installed after bindExtensions resolves.
        expect(startupComplete).toBe(true);
        return send(...args);
      }) as typeof stub.pi.sendMessage;
      const start = simulate.hook(stub, "session_start", {}).then(result => {
        startupComplete = true;
        return result;
      });
      await enteredRecall;
      await tick();
      expect(startupComplete).toBe(false);
      expect(sends(stub)).toHaveLength(0);
      release();
      await start;
      await tick();
      expect(sends(stub)).toHaveLength(1);
      expect(failures.flat().some(reason => reason.includes("Recall reconciliation failed"))).toBe(recallFailure);
    });
  }

  test("navigation while waiting on recall publication rejects old revision and coalesces new branch", async () => {
    const { stub, store } = fixture();
    const summary = "Preserved work";
    stub.ctx.sessionManager.getBranch = () => [{ type: "compaction", id: "recoverable",
      timestamp: "2026-01-01T00:00:00.000Z", firstKeptEntryId: "kept", tokensBefore: 1000, summary,
      details: { compactor: "dc-distill", version: 12, attemptId: "recall-recovery",
        tokensAfter: 100, tokensAfterSource: "pi-rebuilt-message-estimate", summaryDigest: sha256Hex(summary) },
    }] as any;
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let operations = 0;
    const freshness: boolean[] = [];
    store.reconcileRecall = async (_rows, options = {}) => {
      operations++;
      if (operations === 1) await waiting;
      freshness.push(options.isCurrent?.() ?? true);
      return { conflicts: [], published: options.isCurrent?.() ?? true };
    };
    const start = simulate.hook(stub, "session_start", {});
    // Allow initialization to reach the first locked recovery operation.
    await tick();
    const tree1 = simulate.hook(stub, "session_tree", {});
    const tree2 = simulate.hook(stub, "session_tree", {});
    release();
    await Promise.all([start, tree1, tree2]);
    expect(freshness).toEqual([false, true]);
    expect(operations).toBe(2);
  });
});
