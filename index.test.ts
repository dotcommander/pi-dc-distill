import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStubCtx, simulate as rawSimulate } from "./tests/harness/fake-pi.ts";
import { withPreparationBranch } from "./tests/harness/preparation-fixture.ts";
const simulate = { ...rawSimulate, hook: (stub: Parameters<typeof rawSimulate.hook>[0], name: string, event: any) =>
  rawSimulate.hook(stub, name, name === "session_before_compact" ? withPreparationBranch(event, stub.sessionBranch) : event) };

import { buildSessionContext, estimateTokens } from "./lib/sdk.ts";
import { createDistillExtension } from "./index.ts";
import { DISTILL_HANDOFF_ENTRY_TYPE } from "./lib/handoff.ts";
import { DISTILL_CONTINUATION_MESSAGE_TYPE } from "./lib/continuation.ts";
import { DistillStore } from "./lib/store.ts";
import { checkpointDigest as canonicalCheckpointDigest, checkpointSectionLedger, type ResumeCheckpointV1 } from "./lib/compiler/checkpoint.ts";

const testRoot = mkdtempSync(join(tmpdir(), "dc-distill-index-tests-"));
const extension = createDistillExtension({
  loadFeatureSettings: () => ({ toolOutput: { enabled: true }, recall: { enabled: true } }),
  loadCompactionSettings: () => ({
    enabled: true,
    reserveTokens: 16_384,
  }),
  storeFactory: (ctx) => new DistillStore({
    dataDir: join(testRoot, "data"),
    projectRoot: join(testRoot, "projects", encodeURIComponent(ctx.cwd)),
    projectsRoot: join(testRoot, "projects"),
    projectIdentity: ctx.cwd,
    legacyDir: join(testRoot, "missing-legacy"),
  }),
});

function notificationText(stub: ReturnType<typeof createStubCtx>): string[] {
  return stub.calls
    .filter((call) => call.api === "ui.notify")
    .map((call) => String(call.args[0]));
}

function failureReportingFixture(rejectLog: boolean) {
  const root = mkdtempSync(join(tmpdir(), "dc-distill-failure-reporting-"));
  const failures: string[][] = [];
  const store = new DistillStore({
    dataDir: join(root, "data"),
    projectRoot: join(root, "project"),
    projectsRoot: join(root, "projects"),
    projectIdentity: "failure-reporting-test",
    legacyDir: join(root, "missing-legacy"),
  });
  store.appendFailure = async (reasons) => {
    failures.push([...reasons]);
    if (rejectLog) throw new Error("failure log unavailable");
  };
  const stub = createStubCtx();
  createDistillExtension({
    storeFactory: () => store,
    loadCompactionSettings: () => ({ enabled: true, reserveTokens: 16_384 }),
  })(stub.pi);
  return { stub, failures, root };
}

describe("dc-distill entrypoint", () => {
  test("importing the feature performs no user-data writes", () => {
    const home = mkdtempSync(join(tmpdir(), "dc-distill-import-home-"));
    const moduleUrl = new URL("./index.ts", import.meta.url).href;
    const child = Bun.spawnSync([
      process.execPath,
      "--eval",
      `await import(${JSON.stringify(moduleUrl)})`,
    ], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(child.exitCode).toBe(0);
    expect(existsSync(join(home, ".pi", "data", "dc-distill"))).toBe(false);
    expect(existsSync(join(home, ".pi", "data", "distill"))).toBe(false);
  });

  test("routes user notifications through the active context", async () => {
    const source = await readFile(
      new URL("./index.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/Notify\.user\(\s*(?:`|"|')/);
    expect(source).toMatch(/runtime\.assess\(ctx,\s*["']agent_settled["'],\s*revalidate\)/);
  });

  test("does not register compact-status as a slash command", () => {
    const stub = createStubCtx();
    extension(stub.pi);

    expect(stub.registeredCommands.has("compact-status")).toBe(false);
    expect(stub.registeredCommands.has("distill")).toBe(false);
    expect(stub.registeredCommands.has("compact")).toBe(false);
  });

  test("replaces and disposes the active Pi compatibility installation", async () => {
    const stub = createStubCtx();
    (stub.ctx as { mode: string }).mode = "tui";
    const disposed: number[] = [];
    let installed = 0;
    createDistillExtension({
      storeFactory: (ctx) => new DistillStore({
        dataDir: join(testRoot, "lifecycle-data"),
        projectRoot: join(testRoot, "lifecycle-projects", encodeURIComponent(ctx.cwd)),
        projectsRoot: join(testRoot, "lifecycle-projects"),
        projectIdentity: ctx.cwd,
        legacyDir: join(testRoot, "missing-lifecycle-legacy"),
      }),
      installCompactionDedupe: async () => {
        const id = ++installed;
        return { dispose: () => disposed.push(id) };
      },
    })(stub.pi);

    await simulate.hook(stub, "session_start", {});
    const ownerId = stub.ctx.sessionManager.getSessionId();
    stub.ctx.sessionManager.getSessionId = () => "child-session";
    await simulate.hook(stub, "session_start", { reason: "fork" });
    expect(installed).toBe(1);
    expect(disposed).toEqual([]);

    stub.ctx.sessionManager.getSessionId = () => ownerId;
    await simulate.hook(stub, "session_start", {});
    expect(installed).toBe(2);
    expect(disposed).toEqual([1]);

    await simulate.hook(stub, "session_shutdown", {});
    expect(disposed).toEqual([1, 2]);
  });
});

describe("dc-distill host compaction override", () => {
  async function writeSession(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "dc-distill-entrypoint-"));
    const file = join(dir, "session.jsonl");
    await writeFile(
      file,
      [
        {
          type: "session",
          id: "contract-session",
          cwd: "/tmp/project",
          timestamp: "2026-07-13T00:00:00.000Z",
        },
        {
          type: "message",
          message: {
            role: "user",
            content: "Preserve TASK-13 and continue the compact contract test.",
          },
        },
      ]
        .map((entry) => JSON.stringify(entry))
        .join("\n") + "\n",
    );
    return file;
  }

  function compactEvent(reason: "manual" | "threshold" | "overflow") {
    return {
      reason,
      customInstructions: reason === "manual" ? "Keep TASK-13" : undefined,
      signal: new AbortController().signal,
      branchEntries: [],
      preparation: {
        messagesToSummarize: [{ role: "user", content: "Preserve TASK-13" }],
        turnPrefixMessages: [],
        previousSummary: undefined,
        firstKeptEntryId: "entry-after-compact",
        tokensBefore: 120_000,
      },
    };
  }

  test("uses one reason-agnostic deterministic override for every host trigger", async () => {
    const stub = createStubCtx();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});
    const hooks = stub.registeredHooks.get("session_before_compact") ?? [];
    expect(hooks).toHaveLength(1);

    const sessionFile = await writeSession();
    stub.ctx.sessionManager.getSessionFile = () => sessionFile;

    for (const reason of ["manual", "threshold", "overflow"] as const) {
      const [result] = await simulate.hook(
        stub,
        "session_before_compact",
        compactEvent(reason),
      );
      expect(result).toMatchObject({
        compaction: {
          firstKeptEntryId: "entry-after-compact",
          tokensBefore: 120_000,
          details: {
            compactor: "dc-distill",
            version: 14,
            tokensAfterSource: "pi-rebuilt-message-estimate",
          },
        },
      });
      const details = (result as any).compaction.details;
      expect(details.checkpoint.version).toBe(2);
      expect(details.checkpointSections).toEqual(checkpointSectionLedger(details.checkpoint));
      expect(Object.keys(details.checkpointSections.sections)).toHaveLength(17);
      expect(Array.from((result as any).compaction.summary).length).toBeLessThanOrEqual(65_536);
      await simulate.hook(stub, "session_compact_failed", { reason, aborted: true, fromExtension: true, attemptId: (result as any).compaction.details.attemptId });
    }
  });

  test("keeps manual compaction available when Pi disables auto-compaction", async () => {
    const disabled = createDistillExtension({
      loadCompactionSettings: () => ({
        enabled: false,
        reserveTokens: 16_384,
      }),
      storeFactory: (ctx) => new DistillStore({
        dataDir: join(testRoot, "manual-disabled-data"),
        projectRoot: join(testRoot, "manual-disabled-projects", encodeURIComponent(ctx.cwd)),
        projectsRoot: join(testRoot, "manual-disabled-projects"),
        projectIdentity: ctx.cwd,
        legacyDir: join(testRoot, "missing-manual-disabled-legacy"),
      }),
    });
    const stub = createStubCtx();
    disabled(stub.pi);
    await simulate.hook(stub, "session_start", {});

    const [result] = await simulate.hook(
      stub,
      "session_before_compact",
      compactEvent("manual"),
    );

    expect(result).toMatchObject({
      compaction: { details: { compactor: "dc-distill", version: 14 } },
    });
  });

  test("metric uses Pi's preparation estimate and matches rebuilt context with API telemetry", async () => {
    const stub = createStubCtx();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});
    await simulate.hook(stub, "message_end", {
      message: { role: "assistant", content: [], usage: { totalTokens: 95_000 } },
    });
    const timestamp = "2026-07-13T00:00:00.000Z";
    const branchEntries = [
      { type: "message", id: "discarded", parentId: null, timestamp, message: { role: "user", content: "discard me", timestamp: 1 } },
      { type: "message", id: "retained", parentId: "discarded", timestamp, message: { role: "user", content: "retain me", timestamp: 2 } },
    ] as any[];
    const event = compactEvent("manual");
    (event as any).branchEntries = branchEntries;
    event.preparation.firstKeptEntryId = "retained";
    event.preparation.tokensBefore = 100_000;
    event.preparation.messagesToSummarize = [branchEntries[0].message];

    const [prepared] = await simulate.hook(stub, "session_before_compact", event);
    const compaction = (prepared as any).compaction;
    const entry = {
      type: "compaction",
      id: "parity-compaction",
      parentId: "retained",
      timestamp,
      ...compaction,
    } as any;
    const rebuilt = buildSessionContext([...branchEntries, entry], entry.id);
    const expected = rebuilt.messages.reduce((sum, message) => sum + estimateTokens(message), 0);
    expect(compaction.details.tokensAfter).toBe(expected);
    const reductionPct = Math.round(((100_000 - expected) / 100_000) * 100);
    expect(compaction.summary).not.toContain(" est → ");
    expect(compaction.details.reductionPct).toBe(reductionPct);
    expect(compaction.tokensBefore).toBe(100_000);
    expect(compaction.details.apiTokensBefore).toBe(95_000);
    expect(compaction.details.reductionPct).toBe(reductionPct);
    expect(compaction.details.summaryDigest).toBe(
      createHash("sha256").update(compaction.summary).digest("hex"),
    );
  });

  test("cancels when deterministic compaction fails", async () => {
    const stub = createStubCtx();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});
    const event = compactEvent("overflow");
    event.preparation.messagesToSummarize = [];

    const [result] = await simulate.hook(
      stub,
      "session_before_compact",
      event,
    );

    expect(result).toEqual({ cancel: true });
  });

  test("compiler failure without UI logs the reason and cancels without notification or success effects", async () => {
    const { stub, failures, root } = failureReportingFixture(false);
    stub.ctx.hasUI = false;
    await simulate.hook(stub, "session_start", {});
    const event = compactEvent("overflow");
    event.preparation.messagesToSummarize = [{ role: "unsupported", content: "filtered" }];
    const [result] = await simulate.hook(stub, "session_before_compact", event);
    expect(result).toEqual({ cancel: true });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.[0]).toMatch(/^algorithmic:/);
    expect(notificationText(stub)).toEqual([]);
    expect(stub.calls.filter((call) => call.api === "ctx.compact" || call.api === "pi.sendMessage")).toHaveLength(0);
    expect(existsSync(join(root, "data", "compact-log.jsonl"))).toBe(false);
    expect(existsSync(join(root, "project", "recall.json"))).toBe(false);
  });

  for (const rejectLog of [false, true]) {
    for (const failurePath of ["compiler-result", "thrown-error"] as const) {
      for (const rejectNotification of [false, true]) {
        test(`failure reporting preserves cancellation for ${failurePath} with rejecting log=${rejectLog}, notification=${rejectNotification}`, async () => {
          const { stub, failures, root } = failureReportingFixture(rejectLog);
          await simulate.hook(stub, "session_start", {});
          const event = compactEvent("overflow");
          if (failurePath === "compiler-result") {
            // Nonempty preparation reaches runStrategies but has no eligible records.
            event.preparation.messagesToSummarize = [{ role: "unsupported", content: "filtered" }];
          } else {
            const circular: any = { role: "user" };
            circular.content = circular;
            event.preparation.messagesToSummarize = [circular];
          }
          let notificationAttempts = 0;
          const notifications: Array<{ message: string; level?: string }> = [];
          stub.ctx.ui.notify = (message, level) => {
            notificationAttempts++;
            notifications.push({ message, level });
            if (rejectNotification) throw new Error("notification unavailable");
          };

          const [result] = await simulate.hook(stub, "session_before_compact", event);
          expect(result).toEqual({ cancel: true });
          expect(failures).toHaveLength(1);
          expect(failures[0]?.[0]).toMatch(failurePath === "compiler-result" ? /^algorithmic:/ : /cyclic|circular/i);
          expect(notificationAttempts).toBe(1);
          expect(notifications[0]?.level).toBe("warning");
          if (failurePath === "compiler-result") {
            expect(notifications[0]?.message).toStartWith("Distill cancelled — deterministic compiler failed.\n");
            expect(notifications[0]?.message).toContain(failures[0]!.join(" | "));
          }
          expect(stub.calls.filter((call) => call.api === "ctx.compact" || call.api === "pi.sendMessage")).toHaveLength(0);
          expect(existsSync(join(root, "data", "compact-log.jsonl"))).toBe(false);
          expect(existsSync(join(root, "project", "recall.json"))).toBe(false);
        });
      }
    }
  }

  test("stages success until the matching host append commits", async () => {
    const stub = createStubCtx();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});

    const [prepared] = await simulate.hook(
      stub,
      "session_before_compact",
      compactEvent("manual"),
    );
    let compaction = (prepared as any).compaction;
    expect(compaction.details.summaryDigest).toBe(
      createHash("sha256").update(compaction.summary).digest("hex"),
    );
    expect(notificationText(stub)).toEqual([]);

    await simulate.hook(stub, "session_compact", {
      fromExtension: false,
      compactionEntry: {
        type: "compaction",
        id: "foreign",
        parentId: null,
        timestamp: new Date().toISOString(),
        ...compaction,
      },
    });
    expect(notificationText(stub)).toEqual([]);

    const [restaged] = await simulate.hook(
      stub,
      "session_before_compact",
      compactEvent("manual"),
    );
    expect(restaged).toEqual({ cancel: true });

    await simulate.hook(stub, "session_compact", {
      fromExtension: true,
      compactionEntry: {
        type: "compaction",
        id: "committed",
        parentId: null,
        timestamp: new Date().toISOString(),
        ...compaction,
      },
    });
    expect(notificationText(stub).join("\n")).toContain("Shrunk:");
    const compactLog = (await readFile(join(testRoot, "data", "compact-log.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line));
    expect(compactLog.at(-1)?.sessionId).toBe(stub.ctx.sessionManager.getSessionId());

    const notifications = notificationText(stub).length;
    await simulate.hook(stub, "session_compact", {
      fromExtension: true,
      compactionEntry: {
        type: "compaction",
        id: "duplicate",
        parentId: null,
        timestamp: new Date().toISOString(),
        ...compaction,
      },
    });
    expect(notificationText(stub)).toHaveLength(notifications);
  });

  test("tampered v14 section ledger cannot commit or emit success artifacts", async () => {
    const { stub, root } = failureReportingFixture(false);
    await simulate.hook(stub, "session_start", {});
    const [prepared] = await simulate.hook(stub, "session_before_compact", compactEvent("manual"));
    const compaction = (prepared as any).compaction;
    const tampered = { ...compaction, details: { ...compaction.details,
      checkpointSections: { ...compaction.details.checkpointSections,
        sections: { ...compaction.details.checkpointSections.sections, tasks: 99999 } } } };
    await simulate.hook(stub, "session_compact", { fromExtension: true,
      compactionEntry: { type: "compaction", id: "tampered-ledger", parentId: null, ...tampered } });
    expect(existsSync(join(root, "data", "compact-log.jsonl"))).toBe(false);
    expect(existsSync(join(root, "project", "recall.json"))).toBe(false);
    expect((await simulate.hook(stub, "session_before_compact", compactEvent("manual")))[0]).toEqual({ cancel: true });
    await simulate.hook(stub, "session_compact", { fromExtension: true,
      compactionEntry: { type: "compaction", id: "matched-ledger", parentId: null, ...compaction } });
    expect(existsSync(join(root, "data", "compact-log.jsonl"))).toBe(true);
  });

  for (const historicalVersion of [5, 6, 7, 8, 9, 10, 11, 12, 13]) test(`rejects a historical v${historicalVersion} append for a newly prepared v14 transaction`, async () => {
    const { stub, root } = failureReportingFixture(false);
    await simulate.hook(stub, "session_start", {});
    const [prepared] = await simulate.hook(stub, "session_before_compact", compactEvent("manual"));
    const compaction = (prepared as any).compaction;
    expect(compaction.details.version).toBe(14);

    await simulate.hook(stub, "session_compact", {
      fromExtension: true,
      compactionEntry: {
        type: "compaction",
        id: "historical-version-mismatch",
        parentId: null,
        timestamp: new Date().toISOString(),
        ...compaction,
        details: { ...compaction.details, version: historicalVersion },
      },
    });
    expect(notificationText(stub).join("\n")).not.toContain("Shrunk:");
    expect(existsSync(join(root, "data", "compact-log.jsonl"))).toBe(false);
    expect(existsSync(join(root, "project", "recall.json"))).toBe(false);

    // A stale mismatched event preserves ownership. Only matching commit releases it.
    expect((await simulate.hook(stub, "session_before_compact", compactEvent("manual")))[0]).toEqual({ cancel: true });
    await simulate.hook(stub, "session_compact", { fromExtension: true,
      compactionEntry: { type: "compaction", id: "matching-current", ...compaction } });
    const [replacement] = await simulate.hook(stub, "session_before_compact", compactEvent("manual"));
    expect(replacement).toMatchObject({ compaction: { details: { version: 14 } } });
    await simulate.hook(stub, "session_compact", {
      fromExtension: true,
      compactionEntry: { type: "compaction", id: "matching-v11", ...(replacement as any).compaction },
    });
    expect(existsSync(join(root, "data", "compact-log.jsonl"))).toBe(true);
  });

  test("non-owner before-compact cancels instead of allowing host fallback", async () => {
    const stub = createStubCtx();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});
    stub.ctx.sessionManager.getSessionId = () => "child-session";

    const [result] = await simulate.hook(
      stub,
      "session_before_compact",
      compactEvent("overflow"),
    );
    expect(result).toEqual({ cancel: true });
  });
});

describe("dc-distill subagent safety", () => {
  function compactCalls(stub: ReturnType<typeof createStubCtx>): unknown[] {
    return stub.calls.filter((call) => call.api === "ctx.compact");
  }

  test("autonomous hooks do not compact a non-primary (subagent) session", async () => {
    const stub = createStubCtx();
    extension(stub.pi);

    // Primary session latches its id at session_start.
    await simulate.hook(stub, "session_start", {});

    // Simulate a different in-process session id (a taskagent subagent
    // that loaded dc-distill in-process). getSessionId now reports a
    // different id than the latched primary one.
    stub.ctx.sessionManager.getSessionId = () => "subagent-session-id";
    stub.cmdCtx.sessionManager.getSessionId = () => "subagent-session-id";

    await simulate.hook(stub, "turn_end", {});
    await simulate.hook(stub, "agent_settled", {});

    expect(compactCalls(stub).length).toBe(0);
  });

  test("stands down the monitor when Pi disables auto-compaction", async () => {
    const disabled = createDistillExtension({
      loadCompactionSettings: () => ({
        enabled: false,
        reserveTokens: 16_384,
      }),
      storeFactory: (ctx) => new DistillStore({
        dataDir: join(testRoot, "disabled-data"),
        projectRoot: join(testRoot, "disabled-projects", encodeURIComponent(ctx.cwd)),
        projectsRoot: join(testRoot, "disabled-projects"),
        projectIdentity: ctx.cwd,
        legacyDir: join(testRoot, "missing-disabled-legacy"),
      }),
    });
    const stub = createStubCtx();
    disabled(stub.pi);
    await simulate.hook(stub, "session_start", {});
    stub.ctx.getContextUsage = () => ({ tokens: 200_000, contextWindow: 200_000, percent: 100 });

    await simulate.hook(stub, "agent_settled", {});
    await simulate.hook(stub, "agent_settled", {});

    expect(compactCalls(stub)).toEqual([]);
  });

  test("waits for agent_settled before compacting the primary session", async () => {
    const stub = createStubCtx();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});

    // The first completed low-level run is the startup warmup.
    await simulate.hook(stub, "turn_end", {});
    await simulate.hook(stub, "agent_settled", {});

    stub.ctx.getContextUsage = () => ({
      tokens: 200_000,
      contextWindow: 200_000,
      percent: 100,
    });

    await simulate.hook(stub, "turn_end", {});
    expect(compactCalls(stub).length).toBe(0);

    await simulate.hook(stub, "agent_settled", {});
    expect(compactCalls(stub).length).toBe(1);
  });

  test("captured terminal callback clears an autonomous attempt for a later retry", async () => {
    const stub = createStubCtx();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});
    await simulate.hook(stub, "agent_settled", {});
    stub.ctx.getContextUsage = () => ({
      tokens: 200_000,
      contextWindow: 200_000,
      percent: 100,
    });

    await simulate.hook(stub, "agent_settled", {});
    expect(compactCalls(stub).length).toBe(1);

    await simulate.hook(stub, "session_compact_failed", {
      reason: "threshold",
      errorMessage: "test failure",
      aborted: false,
      willRetry: false,
      fromExtension: true,
    });
    await simulate.hook(stub, "agent_settled", {});
    expect(compactCalls(stub).length).toBe(1);
    (compactCalls(stub)[0] as any).args[0].onError(new Error("original terminal failure"));
    await simulate.hook(stub, "agent_settled", {});
    expect(compactCalls(stub).length).toBe(2);
  });

  test("captured callback releases the autonomous latch when failure logging rejects", async () => {
    const { stub, failures, root } = failureReportingFixture(true);
    await simulate.hook(stub, "session_start", {});
    await simulate.hook(stub, "agent_settled", {});
    stub.ctx.getContextUsage = () => ({ tokens: 200_000, contextWindow: 200_000, percent: 100 });
    await simulate.hook(stub, "agent_settled", {});
    expect(compactCalls(stub)).toHaveLength(1);

    await simulate.hook(stub, "session_compact_failed", {
      reason: "threshold", errorMessage: "original host failure", aborted: false,
      willRetry: false, fromExtension: true,
    });
    expect(failures).toEqual([["Compaction failed (threshold): original host failure"]]);
    (compactCalls(stub)[0] as any).args[0].onError(new Error("original terminal failure"));
    await simulate.hook(stub, "agent_settled", {});
    expect(compactCalls(stub)).toHaveLength(2);
    expect(existsSync(join(root, "data", "compact-log.jsonl"))).toBe(false);
    expect(existsSync(join(root, "project", "recall.json"))).toBe(false);
  });

  test("isolates hooks, tools, commands, shutdown, and owner recovery", async () => {
    const stub = createStubCtx();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});
    const ownerId = stub.ctx.sessionManager.getSessionId();
    await simulate.hook(stub, "message_end", {
      message: { role: "user", content: "p".repeat(400) },
    });

    stub.ctx.sessionManager.getSessionId = () => "child-session";
    stub.cmdCtx.sessionManager.getSessionId = () => "child-session";
    await simulate.hook(stub, "session_start", { reason: "fork" });
    await simulate.hook(stub, "session_start", { reason: "resume" });
    await simulate.hook(stub, "message_end", {
      message: { role: "user", content: "c".repeat(400) },
    });
    const [childContext] = await simulate.hook(stub, "context", {
      messages: [
        { role: "compactionSummary", summary: "child summary" },
        { role: "user", content: "child focus" },
      ],
    });
    expect(childContext).toBeUndefined();
    const childTool = await simulate.tool(stub, "save_distill_handoff", { handoff: "child" });
    expect(childTool).toMatchObject({ isError: true });
    const childRecall = await simulate.tool(stub, "recall_compaction", { query: "Conversation" });
    expect(childRecall).toMatchObject({ isError: true });
    const childNotifications = notificationText(stub).length;
    await simulate.hook(stub, "session_compact", {
      fromExtension: true,
      compactionEntry: { type: "compaction", id: "child", details: { compactor: "dc-distill", version: 6 } },
    });
    expect(notificationText(stub)).toHaveLength(childNotifications);
    await simulate.hook(stub, "session_shutdown", { reason: "quit" });

    stub.ctx.sessionManager.getSessionId = () => ownerId;
    stub.cmdCtx.sessionManager.getSessionId = () => ownerId;
    const ownerTool = await simulate.tool(stub, "save_distill_handoff", { handoff: "owner" });
    expect(ownerTool).not.toMatchObject({ isError: true });

    await simulate.hook(stub, "session_shutdown", { reason: "new" });
    stub.ctx.sessionManager.getSessionId = () => "replacement-session";
    stub.cmdCtx.sessionManager.getSessionId = () => "replacement-session";
    await simulate.hook(stub, "session_start", { reason: "new" });
    const [replacement] = await simulate.hook(
      stub,
      "session_before_compact",
      {
        reason: "manual",
        signal: new AbortController().signal,
        branchEntries: [],
        preparation: {
          messagesToSummarize: [{ role: "user", content: "replacement works" }],
          turnPrefixMessages: [],
          firstKeptEntryId: "replacement-tail",
          tokensBefore: 1000,
        },
      },
    );
    expect(replacement).toMatchObject({ compaction: { details: { version: 14 } } });
  });
});

describe("dc-distill durable continuation recovery", () => {
  function recoveryStub() {
    const stub = createStubCtx();
    const id = `recovery-${crypto.randomUUID()}`;
    stub.ctx.sessionManager.getSessionId = () => id;
    stub.cmdCtx.sessionManager.getSessionId = () => id;
    return stub;
  }

  function tick(): Promise<void> {
    return new Promise<void>((resolve) => setImmediate(resolve));
  }

  function compactEvent(reason: "manual" | "threshold" | "overflow") {
    return {
      reason,
      customInstructions: undefined,
      signal: new AbortController().signal,
      branchEntries: [],
      preparation: {
        messagesToSummarize: [{ role: "user", content: "Preserve TASK-13" }],
        turnPrefixMessages: [],
        previousSummary: undefined,
        firstKeptEntryId: "entry-after-compact",
        tokensBefore: 120_000,
      },
    };
  }

  function continuationMessages(stub: ReturnType<typeof createStubCtx>): Record<string, any>[] {
    return stub.calls
      .filter((call) => call.api === "pi.sendMessage")
      .map((call) => call.args[0] as Record<string, any>);
  }

  function autonomousBranch(...after: unknown[]): any[] {
    return [
      { type: "message", message: { role: "user", content: "work" } },
      {
        type: "compaction",
        details: {
          compactor: "dc-distill",
          version: 8,
          autonomous: true,
          attemptId: "attempt-1",
        },
      },
      ...after,
    ];
  }

  test("busy-to-idle settlement recovers before another autonomous check", async () => {
    const stub = recoveryStub();
    let idle = false;
    stub.ctx.isIdle = () => idle;
    stub.ctx.sessionManager.getBranch = () => autonomousBranch();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});
    await tick();
    expect(continuationMessages(stub)).toHaveLength(0);
    idle = true;
    stub.ctx.getContextUsage = () => ({ tokens: 200000, contextWindow: 200000, percent: 100 });
    await simulate.hook(stub, "agent_settled", {});
    await tick();
    expect(continuationMessages(stub)).toHaveLength(1);
    expect(stub.calls.filter(call => call.api === "ctx.compact")).toHaveLength(0);
  });

  test("uncertain send is fenced across reload and return to an unjournalled branch", async () => {
    const stub = recoveryStub();
    let sends = 0;
    stub.pi.sendMessage = (() => { sends++; throw new Error("unknown outcome"); }) as any;
    stub.ctx.sessionManager.getBranch = () => autonomousBranch();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});
    await tick();
    expect(sends).toBe(1);
    stub.ctx.sessionManager.getBranch = () => [];
    await simulate.hook(stub, "session_tree", {});
    stub.ctx.sessionManager.getBranch = () => autonomousBranch();
    await simulate.hook(stub, "session_tree", {});
    await simulate.hook(stub, "session_start", {});
    await tick();
    expect(sends).toBe(1);
    // A fresh extension instance must retain the same process fence too.
    const fresh = recoveryStub();
    fresh.ctx.sessionManager.getSessionId = stub.ctx.sessionManager.getSessionId;
    fresh.ctx.sessionManager.getBranch = () => autonomousBranch();
    extension(fresh.pi);
    await simulate.hook(fresh, "session_start", {});
    await tick();
    expect(continuationMessages(fresh)).toHaveLength(0);
  });

  test("delayed journal observation cannot authorize a resume of our same-process send", async () => {
    const stub = recoveryStub();
    stub.ctx.sessionManager.getBranch = () => autonomousBranch();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});
    await tick();
    stub.ctx.sessionManager.getBranch = () => autonomousBranch({ type: "custom_message",
      customType: DISTILL_CONTINUATION_MESSAGE_TYPE, details: { attemptId: "attempt-1" } });
    await simulate.hook(stub, "session_tree", {});
    await simulate.hook(stub, "agent_settled", {});
    await tick();
    expect(continuationMessages(stub)).toHaveLength(1);
  });

  test("owner replacement makes an old callback obsolete", async () => {
    const stub = recoveryStub();
    stub.ctx.sessionManager.getBranch = () => autonomousBranch();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});
    stub.ctx.sessionManager.getSessionId = () => "replacement-owner";
    await tick();
    expect(continuationMessages(stub)).toHaveLength(0);
  });

  test("shutdown cancels callbacks without erasing possible submission fences", async () => {
    const stub = recoveryStub();
    stub.ctx.sessionManager.getBranch = () => autonomousBranch();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});
    await simulate.hook(stub, "session_shutdown", {});
    await tick();
    expect(continuationMessages(stub)).toHaveLength(0);
  });

  test("delivers a committed autonomous continuation after restart", async () => {
    const stub = recoveryStub();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});
    stub.ctx.sessionManager.getBranch = () => autonomousBranch();

    await simulate.hook(stub, "session_start", { reason: "resume" });
    await tick();

    const messages = continuationMessages(stub);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      customType: DISTILL_CONTINUATION_MESSAGE_TYPE,
      details: { reason: "autonomous_compaction", attemptId: "attempt-1" },
    });

    // A tree switch does not redeliver the same attempt.
    await simulate.hook(stub, "session_tree", {});
    await tick();
    expect(continuationMessages(stub)).toHaveLength(1);
  });

  for (const version of [9, 10]) test(`recovers a v${version} autonomous attempt exactly once across repeated tree events`, async () => {
    const stub = recoveryStub();
    extension(stub.pi);
    const branch = autonomousBranch();
    branch[1].details.version = version;
    stub.ctx.sessionManager.getBranch = () => branch;
    await simulate.hook(stub, "session_start", {});
    await tick();
    await simulate.hook(stub, "session_tree", {});
    await tick();
    await simulate.hook(stub, "session_tree", {});
    await tick();
    expect(continuationMessages(stub)).toHaveLength(1);
    expect(continuationMessages(stub)[0]?.details.attemptId).toBe("attempt-1");
  });

  test("nudges exactly once for a delivered but unanswered continuation", async () => {
    const stub = recoveryStub();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});
    stub.ctx.sessionManager.getBranch = () => autonomousBranch(
      {
        type: "custom_message",
        customType: DISTILL_CONTINUATION_MESSAGE_TYPE,
        details: { reason: "autonomous_compaction", attemptId: "attempt-1" },
      },
    );

    await simulate.hook(stub, "session_start", { reason: "resume" });
    await tick();

    const messages = continuationMessages(stub);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      customType: DISTILL_CONTINUATION_MESSAGE_TYPE,
      details: { reason: "autonomous_compaction", attemptId: "attempt-1", resumed: true },
    });

    await simulate.hook(stub, "session_tree", {});
    await tick();
    expect(continuationMessages(stub)).toHaveLength(1);
  });

  test("a genuine user interruption supersedes a delivered unanswered continuation", async () => {
    const stub = recoveryStub();
    extension(stub.pi);
    stub.ctx.sessionManager.getBranch = () => autonomousBranch(
      { type: "custom_message", customType: DISTILL_CONTINUATION_MESSAGE_TYPE,
        details: { reason: "autonomous_compaction", attemptId: "attempt-1" } },
      { type: "message", message: { role: "user", content: "new objective" } },
    );
    await simulate.hook(stub, "session_start", { reason: "resume" });
    await tick();
    expect(continuationMessages(stub)).toHaveLength(0);
  });

  test("stands down when the continuation was answered", async () => {
    const stub = recoveryStub();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});
    stub.ctx.sessionManager.getBranch = () => autonomousBranch(
      {
        type: "custom_message",
        customType: DISTILL_CONTINUATION_MESSAGE_TYPE,
        details: { reason: "autonomous_compaction", attemptId: "attempt-1" },
      },
      { type: "message", message: { role: "assistant", content: "continued work" } },
    );

    await simulate.hook(stub, "session_start", { reason: "resume" });
    await simulate.hook(stub, "session_tree", {});
    await tick();

    expect(continuationMessages(stub)).toEqual([]);
  });

  test("ignores manual and pre-v8 compactions", async () => {
    const stub = recoveryStub();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});
    stub.ctx.sessionManager.getBranch = (): any[] => [
      {
        type: "compaction",
        details: { compactor: "dc-distill", version: 7, attemptId: "legacy" },
      },
      {
        type: "compaction",
        details: { compactor: "dc-distill", version: 8, autonomous: false, attemptId: "manual" },
      },
    ];

    await simulate.hook(stub, "session_start", { reason: "resume" });
    await simulate.hook(stub, "session_tree", {});
    await tick();

    expect(continuationMessages(stub)).toEqual([]);
  });

  test("non-owner sessions never reconcile a continuation", async () => {
    const stub = recoveryStub();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});
    stub.ctx.sessionManager.getBranch = () => autonomousBranch();
    stub.ctx.sessionManager.getSessionId = () => "child-session";
    stub.cmdCtx.sessionManager.getSessionId = () => "child-session";

    await simulate.hook(stub, "session_tree", {});
    await tick();

    expect(continuationMessages(stub)).toEqual([]);
  });

  test("a committed autonomous attempt delivers once and survives duplicate events", async () => {
    const stub = recoveryStub();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});

    // Consume the warmup turn, then cross the emergency threshold so the
    // autonomous monitor latches an attempt and requests host compaction.
    await simulate.hook(stub, "agent_settled", {});
    stub.ctx.getContextUsage = () => ({
      tokens: 200_000,
      contextWindow: 200_000,
      percent: 100,
    });
    await simulate.hook(stub, "agent_settled", {});
    expect(stub.calls.filter((call) => call.api === "ctx.compact")).toHaveLength(1);

    const [prepared] = await simulate.hook(
      stub,
      "session_before_compact",
      compactEvent("overflow"),
    );
    const compaction = (prepared as any).compaction;
    expect(compaction.details.autonomous).toBe(true);
    // The host append precedes session_compact; recovery reads that active branch.
    stub.ctx.sessionManager.getBranch = (): any[] => [{ type: "compaction", ...compaction }];

    await simulate.hook(stub, "session_compact", {
      fromExtension: true,
      compactionEntry: {
        type: "compaction",
        id: "committed",
        parentId: null,
        timestamp: new Date().toISOString(),
        ...compaction,
      },
    });
    await tick();

    const messages = continuationMessages(stub);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      customType: DISTILL_CONTINUATION_MESSAGE_TYPE,
      details: {
        reason: "autonomous_compaction",
        attemptId: compaction.details.attemptId,
      },
    });

    // A duplicate commit event for the same attempt cannot redeliver.
    await simulate.hook(stub, "session_compact", {
      fromExtension: true,
      compactionEntry: {
        type: "compaction",
        id: "duplicate",
        parentId: null,
        timestamp: new Date().toISOString(),
        ...compaction,
      },
    });
    await tick();
    expect(continuationMessages(stub)).toHaveLength(1);

    // Journal-driven recovery for the same attempt is suppressed in-memory
    // even before the delivered message would appear in the branch.
    stub.ctx.sessionManager.getBranch = (): any[] => [
      {
        type: "compaction",
        ...compaction,
      },
    ];
    await simulate.hook(stub, "session_tree", {});
    await tick();
    expect(continuationMessages(stub)).toHaveLength(1);
  });
});

describe("dc-distill handoff capture", () => {
  async function checkpointAdapter() {
    const stub = createStubCtx();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});
    const branch: any[] = [{ type: "message", id: "user-pin-source", parentId: null,
      timestamp: new Date().toISOString(), message: { role: "user",
        content: [{ type: "text", text: "Keep release authorization explicit." }], timestamp: Date.now() } }];
    stub.ctx.sessionManager.getBranch = () => branch;
    const append = stub.pi.appendEntry.bind(stub.pi);
    stub.pi.appendEntry = (customType, data) => {
      append(customType, data);
      branch.push({ type: "custom", id: `host-update-${branch.length}`, customType, data });
      // Pi's appendEntry returns void; only getBranch exposes the saved identity.
    };
    return { stub, branch };
  }

  const checkpointPin = { op: "pin", id: "P1", purpose: "constraint",
    source: { kind: "excerpt", excerpt: "release authorization" } };
  const initialCheckpoint = { version: 1, expectedBase: { checkpointDigest: null, updateEntryId: null },
    operations: [checkpointPin] };

  function renderHandoff(stub: ReturnType<typeof createStubCtx>, result: any) {
    const tones: string[] = [];
    const theme = { fg: (tone: string, text: string) => { tones.push(tone); return text; },
      bold: (text: string) => text };
    const render = stub.registeredTools.get("save_distill_handoff")!.renderResult!;
    const node = render(result, { expanded: false, isPartial: false }, theme as any, {} as any);
    return { text: node.render(200).join("\n"), tones };
  }

  test("checkpoint adapter acknowledges the observed host identity and accepts its next base", async () => {
    const { stub, branch } = await checkpointAdapter();
    const result: any = await simulate.tool(stub, "save_distill_handoff", {
      handoff: "Retain release authorization.", checkpoint: initialCheckpoint,
    });
    expect(result.isError).not.toBe(true);
    const saved = branch.at(-1);
    expect(saved.id).toBe("host-update-1");
    expect(saved.data.entryId).not.toBe(saved.id);
    const canonical = { ...saved.data.checkpoint, updateEntryId: saved.id } as ResumeCheckpointV1;
    expect(result.details.expectedBase).toEqual({
      checkpointDigest: canonicalCheckpointDigest(canonical), updateEntryId: "host-update-1",
    });
    expect(result.details.checkpointDigest).toBe(result.details.expectedBase.checkpointDigest);
    expect(result.details.operations[0].source).toMatchObject({
      sessionId: "stub-session-id", entryId: "user-pin-source", sourceKind: "user", start: 5, end: 26,
      contentDigest: createHash("sha256").update("Keep release authorization explicit.").digest("hex"),
    });
    const next: any = await simulate.tool(stub, "save_distill_handoff", {
      handoff: "The explicit pin was resolved.", checkpoint: { version: 1,
        expectedBase: result.details.expectedBase,
        operations: [{ op: "resolve", target: { kind: "pin", id: "P1" }, reason: "User resolved the constraint." }] },
    });
    expect(next.isError).not.toBe(true);
    expect(next.details.expectedBase.updateEntryId).toBe("host-update-2");
    expect(branch.at(-1).data.checkpoint.pins[0].status).toBe("resolved");
    expect(stub.calls.filter(call => call.api === "pi.appendEntry")).toHaveLength(2);
    const rendered = renderHandoff(stub, next);
    expect(rendered.text).toContain("✓");
    expect(rendered.text).toContain("saved for compaction");
    expect(rendered.tones).toContain("success");
  });

  test("stale checkpoint base rejects atomically and renders failure", async () => {
    const { stub, branch } = await checkpointAdapter();
    await simulate.tool(stub, "save_distill_handoff", { handoff: "Save the pin.", checkpoint: initialCheckpoint });
    const before = structuredClone(branch);
    const result: any = await simulate.tool(stub, "save_distill_handoff", {
      handoff: "Stale retry.", checkpoint: initialCheckpoint,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Stale checkpoint base");
    expect(branch).toEqual(before);
    expect(stub.calls.filter(call => call.api === "pi.appendEntry")).toHaveLength(1);
    const rendered = renderHandoff(stub, result);
    expect(rendered.text).toContain("✗");
    expect(rendered.text).toContain("Stale checkpoint base");
    expect(rendered.text).not.toContain("saved for compaction");
    expect(rendered.tones).toContain("error");
  });

  test("oversized checkpoint envelope rejects without append and renders its error", async () => {
    const { stub, branch } = await checkpointAdapter();
    const result: any = await simulate.tool(stub, "save_distill_handoff", {
      handoff: "x".repeat(16_384), checkpoint: initialCheckpoint,
    });
    expect(result.isError).toBe(true);
    expect(branch).toHaveLength(1);
    expect(stub.calls.some(call => call.api === "pi.appendEntry")).toBe(false);
    const rendered = renderHandoff(stub, result);
    expect(rendered.text).toContain("✗");
    expect(rendered.text).toContain("16,384-code-point");
    expect(rendered.text).not.toContain("saved for compaction");
  });

  test("post-append base read failure acknowledges the saved update and renders a warning", async () => {
    const { stub, branch } = await checkpointAdapter();
    let reads = 0;
    stub.ctx.sessionManager.getBranch = () => {
      if (++reads === 2) throw new Error("branch acknowledgement unavailable");
      return branch;
    };
    const result: any = await simulate.tool(stub, "save_distill_handoff", {
      handoff: "Save the pin.", checkpoint: initialCheckpoint,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Checkpoint update saved; identity acknowledgement failed: branch acknowledgement unavailable");
    expect(branch.at(-1).data.checkpoint.pins[0].text).toBe("release authorization");
    expect(stub.calls.filter(call => call.api === "pi.appendEntry")).toHaveLength(1);
    const rendered = renderHandoff(stub, result);
    expect(rendered.text).toContain("⚠");
    expect(rendered.text).toContain("Checkpoint update saved; identity acknowledgement failed");
    expect(rendered.text).not.toContain("saved for compaction");
    expect(rendered.tones).toContain("warning");
    expect(rendered.tones).not.toContain("success");
  });

  test("registers save_distill_handoff for hidden continuation capture", async () => {
    const stub = createStubCtx();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});

    expect(stub.registeredTools.has("save_distill_handoff")).toBe(true);

    const result = await simulate.tool(stub, "save_distill_handoff", {
      handoff: "Next: run the focused footer test.",
    });

    expect(stub.calls).toContainEqual({
      api: "pi.appendEntry",
      args: [
        DISTILL_HANDOFF_ENTRY_TYPE,
        expect.objectContaining({
          handoff: "Next: run the focused footer test.",
        }),
      ],
    });
    expect(result).toMatchObject({
      content: [{ type: "text", text: "Distill handoff saved." }],
      details: { customType: DISTILL_HANDOFF_ENTRY_TYPE },
    });
  });

  test("save_distill_handoff rejects empty handoffs", async () => {
    const stub = createStubCtx();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});

    const result = await simulate.tool(stub, "save_distill_handoff", {
      handoff: "   ",
    });

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: "save_distill_handoff requires a non-empty handoff.",
        },
      ],
    });
  });
});


describe("optional feature gates", () => {
  test("default tool outputs follow the store's selected data root", async () => {
    const root = mkdtempSync(join(tmpdir(), "dc-distill-selected-store-"));
    const stub = createStubCtx();
    const store = new DistillStore({ dataDir: root, projectIdentity: stub.ctx.cwd });
    createDistillExtension({
      storeFactory: () => store,
      loadFeatureSettings: () => ({ toolOutput: { enabled: true }, recall: { enabled: false } }),
    })(stub.pi);
    await simulate.hook(stub, "session_start", {});
    const patch: any = (await simulate.hook(stub, "tool_result", {
      toolName: "read", toolCallId: "selected-output", input: {},
      content: [{ type: "text", text: "x".repeat(13000) }], isError: false,
    })).find(Boolean);
    const artifactPath = patch.details.dcDistillOutputCompactor.artifactPath;
    expect(artifactPath.startsWith(join(store.projectRoot, "tool-output") + "/")).toBe(true);
    expect(existsSync(artifactPath)).toBe(true);
    await simulate.hook(stub, "session_shutdown", {});
  });

  for (const toolOutput of [false, true]) {
    for (const recall of [false, true]) {
      test(`independent tool output=${toolOutput}, recall=${recall} gates at registration, start, commit, context and shutdown`, async () => {
        const root = mkdtempSync(join(tmpdir(), "dc-distill-feature-gates-"));
        const stub = createStubCtx();
        const store = new DistillStore({
          dataDir: join(root, "data"), projectRoot: join(root, "project"),
          projectsRoot: join(root, "projects"), projectIdentity: stub.ctx.cwd,
          legacyDir: join(root, "missing-legacy"),
        });
        const migrationFlags: boolean[] = [];
        const initialize = store.initialize.bind(store);
        store.initialize = async (options) => {
          migrationFlags.push(options?.migrateLegacy !== false);
          return initialize(options);
        };
        let reads = 0;
        const load = store.loadRecall.bind(store);
        store.loadRecall = async (scope) => { reads++; return load(scope); };
        createDistillExtension({
          storeFactory: () => store,
          outputArtifactRoot: () => join(root, "tool-output"),
          loadCompactionSettings: () => ({ enabled: true, reserveTokens: 16384 }),
          loadFeatureSettings: () => ({ toolOutput: { enabled: toolOutput }, recall: { enabled: recall } }),
        })(stub.pi);
        const output = { toolName: "read", toolCallId: "feature-output", input: {},
          content: [{ type: "text", text: "x".repeat(13000) }], isError: false };
        expect((await simulate.hook(stub, "tool_result", output))[0]).toBeUndefined();
        await simulate.hook(stub, "session_start", {});
        expect(migrationFlags).toEqual([toolOutput && recall]);
        const patch = (await simulate.hook(stub, "tool_result", output)).find(Boolean);
        if (toolOutput) {
          expect(patch, JSON.stringify(notificationText(stub))).toBeDefined();
          expect(existsSync((patch as any).details.dcDistillOutputCompactor.artifactPath)).toBe(true);
        } else expect(patch).toBeUndefined();
        const [prepared] = await simulate.hook(stub, "session_before_compact", {
          reason: "manual", signal: new AbortController().signal, branchEntries: [],
          preparation: { messagesToSummarize: [{ role: "user", content: "Repair src/parser.ts and continue next." }],
            turnPrefixMessages: [], firstKeptEntryId: "keep", tokensBefore: 120000 },
        });
        const compaction = (prepared as any).compaction;
        expect(compaction.details.compactor).toBe("dc-distill");
        expect(compaction.summary.includes("recall_compaction")).toBe(recall);
        await simulate.hook(stub, "session_compact", { fromExtension: true,
          compactionEntry: { type: "compaction", id: "commit", parentId: null,
            timestamp: new Date().toISOString(), ...compaction } });
        expect(existsSync(join(root, "data", "compact-log.jsonl"))).toBe(true);
        expect(existsSync(join(root, "project", "recall.json"))).toBe(recall);
        const response: any = await simulate.tool(stub, "recall_compaction", { query: "Conversation" });
        expect(reads).toBe(recall ? 1 : 0);
        if (!recall) expect(response.content[0].text).toContain("Recall is disabled");
        const [echo] = await simulate.hook(stub, "context", { messages: [
          { role: "compactionSummary", summary: compaction.summary },
          { role: "user", content: "Continue" },
        ] });
        expect(Boolean(echo)).toBe(recall);
        await simulate.hook(stub, "session_shutdown", {});
        expect((await simulate.hook(stub, "tool_result", output))[0]).toBeUndefined();
      });
    }
  }

  test("missing feature settings disable optional work without deleting existing recall", async () => {
    const root = mkdtempSync(join(tmpdir(), "dc-distill-default-features-"));
    const projectRoot = join(root, "project");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(projectRoot));
    const previous = '[{"ts":"2026-01-01T00:00:00Z","before":10,"after":5,"summary":"old","project":"old"}]';
    await writeFile(join(projectRoot, "recall.json"), previous);
    const stub = createStubCtx();
    stub.ctx.cwd = root;
    let reads = 0;
    const store = new DistillStore({ dataDir: join(root, "data"), projectRoot,
      legacyDir: join(root, "missing-legacy") });
    store.loadRecall = async () => { reads++; throw new Error("disabled read must not happen"); };
    createDistillExtension({ storeFactory: () => store })(stub.pi);
    await simulate.hook(stub, "session_start", {});
    const response: any = await simulate.tool(stub, "recall_compaction", { query: "old", scope: "all" });
    expect(response.content[0].text).toContain("Recall is disabled");
    expect(reads).toBe(0);
    expect(await readFile(join(projectRoot, "recall.json"), "utf8")).toBe(previous);
    expect((await simulate.hook(stub, "tool_result", { toolName: "read", content: [{ type: "text", text: "x".repeat(13000) }] }))[0]).toBeUndefined();
  });
});


describe("effective host settings", () => {
  const compactCalls = (stub: ReturnType<typeof createStubCtx>) => stub.calls.filter((call) => call.api === "ctx.compact");
  const compactEvent = (_reason: "manual") => ({
    reason: "manual", signal: new AbortController().signal, branchEntries: [],
    preparation: { messagesToSummarize: [{ role: "user", content: "Preserve the current settings task and continue implementation." }],
      turnPrefixMessages: [], firstKeptEntryId: "settings-keep", tokensBefore: 120000 },
  });

  test("refreshes on model selection and checks, preserves feature snapshots, and recovers from invalid settings", async () => {
    const root = mkdtempSync(join(tmpdir(), "dc-distill-host-settings-"));
    const stub = createStubCtx();
    const store = new DistillStore({ dataDir: join(root, "data"), projectRoot: join(root, "project"),
      projectsRoot: join(root, "projects"), projectIdentity: stub.ctx.cwd, legacyDir: join(root, "missing") });
    let settings: any = { compaction: { enabled: false }, extensionConfig: { "dc-distill": { recall: { enabled: false } } } };
    let reads = 0;
    stub.pi.getSettings = () => { reads++; return settings; };
    createDistillExtension({ storeFactory: () => store })(stub.pi);
    await simulate.hook(stub, "session_start", {});
    const startupReads = reads;
    const selected: string[] = [];
    settings.compaction.modelOverrides = {
      get "fake/first"() { selected.push("first"); return { reserveTokens: 50000 }; },
      get "fake/second"() { selected.push("second"); return { reserveTokens: 0 }; },
    };
    stub.ctx.model = { provider: "fake", id: "first", contextWindow: 200000 } as any;
    await simulate.hook(stub, "model_select", {});
    expect(reads).toBe(startupReads + 1);
    expect(selected).toEqual(["first"]);
    stub.ctx.model = { provider: "fake", id: "second", contextWindow: 200000 } as any;
    stub.ctx.getContextUsage = () => ({ tokens: 200000, contextWindow: 200000, percent: 100 });
    await simulate.hook(stub, "agent_settled", {});
    expect(reads).toBe(startupReads + 2);
    expect(selected).toEqual(["first", "second"]);
    expect(compactCalls(stub)).toHaveLength(0);
    settings = { compaction: { reserveTokens: -1 }, extensionConfig: { "dc-distill": { recall: { enabled: true } } } };
    await simulate.hook(stub, "agent_settled", {});
    expect(compactCalls(stub)).toHaveLength(0);
    // Manual interception remains deterministic despite invalid autonomous geometry.
    const [manual] = await simulate.hook(stub, "session_before_compact", compactEvent("manual"));
    expect(manual).toHaveProperty("compaction.details.compactor", "dc-distill");
    await simulate.hook(stub, "session_compact_failed", { reason: "manual", aborted: true, fromExtension: true, attemptId: (manual as any).compaction.details.attemptId });
    const recall = stub.registeredTools.get("recall_compaction")!;
    const result = await recall.execute("settings-recall", { scope: "project" }, new AbortController().signal, undefined, stub.ctx as any);
    expect(JSON.stringify(result)).toContain("Recall is disabled");
    settings = { compaction: { enabled: true, reserveTokens: 0 } };
    await simulate.hook(stub, "agent_settled", {}); // startup warmup
    await simulate.hook(stub, "agent_settled", {}); // emergency bypasses cooldown
    expect(compactCalls(stub)).toHaveLength(1);
    await simulate.hook(stub, "session_shutdown", {});
  });

  test("unavailable snapshots disable optional work and autonomous requests", async () => {
    const root = mkdtempSync(join(tmpdir(), "dc-distill-unavailable-settings-"));
    const stub = createStubCtx();
    stub.pi.getSettings = () => { throw new Error("host snapshot unavailable"); };
    createDistillExtension({ storeFactory: () => new DistillStore({ dataDir: join(root, "data"),
      projectRoot: join(root, "project"), projectsRoot: join(root, "projects"), legacyDir: join(root, "missing") }) })(stub.pi);
    await simulate.hook(stub, "session_start", {});
    stub.ctx.getContextUsage = () => ({ tokens: 200000, contextWindow: 200000, percent: 100 });
    await simulate.hook(stub, "agent_settled", {});
    expect(compactCalls(stub)).toHaveLength(0);
    const [manual] = await simulate.hook(stub, "session_before_compact", compactEvent("manual"));
    expect(manual).toHaveProperty("compaction.details.compactor", "dc-distill");
    await simulate.hook(stub, "session_shutdown", {});
  });
});
