import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStubCtx, simulate } from "#shrink-framework/x/testing";
import { buildSessionContext, estimateTokens } from "#shrink-framework/pi/coding-agent";
import { createShrinkExtension } from "./index.ts";
import { SHRINK_HANDOFF_ENTRY_TYPE } from "./lib/handoff.ts";
import { ShrinkStore } from "./lib/store.ts";

const testRoot = mkdtempSync(join(tmpdir(), "dc-shrink-index-tests-"));
const extension = createShrinkExtension({
  loadCompactionSettings: () => ({
    enabled: true,
    reserveTokens: 16_384,
  }),
  storeFactory: (ctx) => new ShrinkStore({
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

describe("dc-shrink entrypoint", () => {
  test("importing the feature performs no user-data writes", () => {
    const home = mkdtempSync(join(tmpdir(), "dc-shrink-import-home-"));
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
    expect(existsSync(join(home, ".pi", "data", "dc-shrink"))).toBe(false);
    expect(existsSync(join(home, ".pi", "data", "shrink"))).toBe(false);
  });

  test("routes user notifications through the active context", async () => {
    const source = await readFile(
      new URL("./index.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/Notify\.user\(\s*(?:`|"|')/);
    expect(source).toContain("compaction: runtime.compactionSettings");
    expect(source).toContain("if (!runtime.compactionSettings.enabled) {");
  });

  test("does not register compact-status as a slash command", () => {
    const stub = createStubCtx();
    extension(stub.pi);

    expect(stub.registeredCommands.has("compact-status")).toBe(false);
    expect(stub.registeredCommands.has("shrink")).toBe(false);
    expect(stub.registeredCommands.has("compact")).toBe(false);
  });

  test("replaces and disposes the active Pi compatibility installation", async () => {
    const stub = createStubCtx();
    (stub.ctx as { mode: string }).mode = "tui";
    const disposed: number[] = [];
    let installed = 0;
    createShrinkExtension({
      storeFactory: (ctx) => new ShrinkStore({
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

describe("dc-shrink host compaction override", () => {
  async function writeSession(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "dc-shrink-entrypoint-"));
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
            compactor: "dc-shrink",
            version: 7,
            tokensAfterSource: "pi-rebuilt-message-estimate",
          },
        },
      });
      expect(Array.from((result as any).compaction.summary).length).toBeLessThanOrEqual(65_536);
    }
  });

  test("keeps manual compaction available when Pi disables auto-compaction", async () => {
    const disabled = createShrinkExtension({
      loadCompactionSettings: () => ({
        enabled: false,
        reserveTokens: 16_384,
      }),
      storeFactory: (ctx) => new ShrinkStore({
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
      compaction: { details: { compactor: "dc-shrink", version: 7 } },
    });
  });

  test("tokensAfter matches Pi's rebuilt message-context calculation", async () => {
    const stub = createStubCtx();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});
    const timestamp = "2026-07-13T00:00:00.000Z";
    const branchEntries = [
      { type: "message", id: "discarded", parentId: null, timestamp, message: { role: "user", content: "discard me", timestamp: 1 } },
      { type: "message", id: "retained", parentId: "discarded", timestamp, message: { role: "user", content: "retain me", timestamp: 2 } },
    ] as any[];
    const event = compactEvent("manual");
    (event as any).branchEntries = branchEntries;
    event.preparation.firstKeptEntryId = "retained";
    event.preparation.messagesToSummarize = [{ role: "user", content: "discard me" }];

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
    compaction = (restaged as any).compaction;

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

describe("dc-shrink subagent safety", () => {
  function compactCalls(stub: ReturnType<typeof createStubCtx>): unknown[] {
    return stub.calls.filter((call) => call.api === "ctx.compact");
  }

  test("autonomous hooks do not compact a non-primary (subagent) session", async () => {
    const stub = createStubCtx();
    extension(stub.pi);

    // Primary session latches its id at session_start.
    await simulate.hook(stub, "session_start", {});

    // Simulate a different in-process session id (a taskagent subagent
    // that loaded dc-shrink in-process). getSessionId now reports a
    // different id than the latched primary one.
    stub.ctx.sessionManager.getSessionId = () => "subagent-session-id";
    stub.cmdCtx.sessionManager.getSessionId = () => "subagent-session-id";

    await simulate.hook(stub, "turn_end", {});
    await simulate.hook(stub, "agent_settled", {});

    expect(compactCalls(stub).length).toBe(0);
  });

  test("stands down the monitor when Pi disables auto-compaction", async () => {
    const disabled = createShrinkExtension({
      loadCompactionSettings: () => ({
        enabled: false,
        reserveTokens: 16_384,
      }),
      storeFactory: (ctx) => new ShrinkStore({
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

  test("turn_end compacts the primary session and agent_settled does not duplicate it", async () => {
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
    expect(compactCalls(stub).length).toBe(1);

    await simulate.hook(stub, "agent_settled", {});
    expect(compactCalls(stub).length).toBe(1);
  });

  test("session_compact_failed clears an autonomous attempt for a later retry", async () => {
    const stub = createStubCtx();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});
    await simulate.hook(stub, "agent_settled", {});
    stub.ctx.getContextUsage = () => ({
      tokens: 200_000,
      contextWindow: 200_000,
      percent: 100,
    });

    await simulate.hook(stub, "turn_end", {});
    expect(compactCalls(stub).length).toBe(1);

    await simulate.hook(stub, "session_compact_failed", {
      reason: "threshold",
      errorMessage: "test failure",
      aborted: false,
      willRetry: false,
      fromExtension: true,
    });
    await simulate.hook(stub, "turn_end", {});
    expect(compactCalls(stub).length).toBe(2);
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
    const childTool = await simulate.tool(stub, "save_shrink_handoff", { handoff: "child" });
    expect(childTool).toMatchObject({ isError: true });
    const childRecall = await simulate.tool(stub, "recall_compaction", { query: "Conversation" });
    expect(childRecall).toMatchObject({ isError: true });
    const childNotifications = notificationText(stub).length;
    await simulate.hook(stub, "session_compact", {
      fromExtension: true,
      compactionEntry: { type: "compaction", id: "child", details: { compactor: "dc-shrink", version: 6 } },
    });
    expect(notificationText(stub)).toHaveLength(childNotifications);
    await simulate.hook(stub, "session_shutdown", { reason: "quit" });

    stub.ctx.sessionManager.getSessionId = () => ownerId;
    stub.cmdCtx.sessionManager.getSessionId = () => ownerId;
    const ownerTool = await simulate.tool(stub, "save_shrink_handoff", { handoff: "owner" });
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
    expect(replacement).toMatchObject({ compaction: { details: { version: 7 } } });
  });
});

describe("dc-shrink handoff capture", () => {
  test("registers save_shrink_handoff for hidden continuation capture", async () => {
    const stub = createStubCtx();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});

    expect(stub.registeredTools.has("save_shrink_handoff")).toBe(true);

    const result = await simulate.tool(stub, "save_shrink_handoff", {
      handoff: "Next: run the focused footer test.",
    });

    expect(stub.calls).toContainEqual({
      api: "pi.appendEntry",
      args: [
        SHRINK_HANDOFF_ENTRY_TYPE,
        expect.objectContaining({
          handoff: "Next: run the focused footer test.",
        }),
      ],
    });
    expect(result).toMatchObject({
      content: [{ type: "text", text: "Shrink handoff saved." }],
      details: { customType: SHRINK_HANDOFF_ENTRY_TYPE },
    });
  });

  test("save_shrink_handoff rejects empty handoffs", async () => {
    const stub = createStubCtx();
    extension(stub.pi);
    await simulate.hook(stub, "session_start", {});

    const result = await simulate.tool(stub, "save_shrink_handoff", {
      handoff: "   ",
    });

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: "save_shrink_handoff requires a non-empty handoff.",
        },
      ],
    });
  });
});
