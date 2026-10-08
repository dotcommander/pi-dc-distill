import { describe, expect, test } from "bun:test";
import { createDistillExtension, prospectiveTokenEstimator } from "./index.ts";
import { createPreparationHarness } from "./tests/harness/fake-pi.ts";
import { buildSessionContext, buildSessionProjection, estimateTokens, getCurrentSystemMessage } from "./lib/sdk.ts";
import type { CompactionEntry, SessionEntry, SessionBeforeCompactResult } from "./lib/sdk.ts";
import type { CompactionDetails } from "./lib/compiler/types.ts";

/** Validate the harness boundary before inspecting the typed compaction result. */
function compactionResult(value: unknown): SessionBeforeCompactResult & { compaction: NonNullable<SessionBeforeCompactResult["compaction"]> & { details: CompactionDetails } } {
  if (typeof value !== "object" || value === null || !("compaction" in value) || !value.compaction)
    throw new Error("Expected compaction result");
  return value as SessionBeforeCompactResult & { compaction: NonNullable<SessionBeforeCompactResult["compaction"]> & { details: CompactionDetails } };
}

/** Reference semantics: a full rebuild per estimate, exactly as the eviction loop
 *  previously did. The estimator must reproduce these numbers bit-for-bit. */
function naiveProspectiveTokens(branch: SessionEntry[], firstKeptEntryId: string, tokensBefore: number, summary: string): number {
  let id = "dc-distill-prospective";
  while (branch.some(entry => entry.id === id)) id += "-";
  const timestamp = "1970-01-01T00:00:00.000Z";
  const systemMessage = getCurrentSystemMessage(buildSessionProjection(branch).messages);
  const entry: CompactionEntry = {
    type: "compaction", id, parentId: branch.at(-1)?.id ?? null,
    timestamp, firstKeptEntryId, tokensBefore, summary,
    ...(systemMessage ? { systemMessage: { ...systemMessage, timestamp: new Date(timestamp).getTime() } } : {}),
  };
  const rebuilt = buildSessionContext([...branch, entry], id);
  const count = rebuilt.messages.reduce((sum, message) => sum + estimateTokens(message), 0);
  if (!Number.isFinite(count) || count < 0) throw new Error("invalid rebuilt context estimate");
  return count;
}

function makeBranch(count: number, withSystem: boolean, tailText: string): SessionEntry[] {
  const entries: SessionEntry[] = [];
  let prev: string | null = null;
  for (let i = 0; i < count; i++) {
    const id = `e${i}`;
    const role = withSystem && i === 0 ? "system" : i % 3 === 0 ? "assistant" : "user";
    entries.push({
      type: "message", id, parentId: prev, timestamp: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
      message: { role, content: [{ type: "text", text: i >= count - 10 ? tailText : `msg ${i} discarded body` }] },
    } as SessionEntry);
    prev = id;
  }
  return entries;
}

describe("prospective token estimator", () => {
  const summaries = [
    "initial summary text",
    "",
    "x",
    "summary with unicode 😀 and | pipes \n newlines \\ backslash",
    "a".repeat(8192),
    "<dc-distill-summary>\nnotice: x\n</dc-distill-summary>",
  ];
  test("matches full-rebuild estimation across branch shapes and summaries", () => {
    for (const withSystem of [false, true]) {
      for (const size of [3, 120]) {
        const branch = makeBranch(size, withSystem, "retained tail content walked per estimate. ".repeat(40));
        const firstKept = branch[Math.max(0, size - 10)]!.id;
        const estimate = prospectiveTokenEstimator(branch, firstKept, 4242, summaries[0]!);
        for (const summary of summaries) {
          expect(estimate(summary)).toBe(naiveProspectiveTokens(branch, firstKept, 4242, summary));
        }
        // Repeated eviction-style calls keep matching as the summary shrinks.
        let current = summaries.at(-1)!;
        for (let step = 0; step < 5 && current.length > 1; step++) {
          current = current.slice(0, Math.max(1, current.length - 700));
          expect(estimate(current)).toBe(naiveProspectiveTokens(branch, firstKept, 4242, current));
        }
      }
    }
  });
  test("handles a branch that already contains the prospective id prefix", () => {
    const branch = makeBranch(5, false, "tail");
    (branch[2] as { id: string }).id = "dc-distill-prospective";
    const firstKept = branch[0]!.id;
    const estimate = prospectiveTokenEstimator(branch, firstKept, 1, "s");
    for (const summary of summaries) {
      expect(estimate(summary)).toBe(naiveProspectiveTokens(branch, firstKept, 1, summary));
    }
  });
});


function preparedHost(startReason = "startup") {
  const host = createPreparationHarness();
  createDistillExtension()(host.pi);
  const branch: SessionEntry[] = ["Preserve the user constraint", "continue", "retained native tail"].map((text, i) => ({
    type: "message", id: `prepared-${i}`, parentId: i === 0 ? null : `prepared-${i - 1}`,
    timestamp: "2026-10-07T00:00:00.000Z",
    message: { role: "user", content: text, timestamp: i },
  } as SessionEntry));
  host.setBranch(branch);
  const event = {
    reason: "manual",
    signal: new AbortController().signal,
    branchEntries: branch,
    preparation: {
      messagesToSummarize: branch.slice(0, 2).flatMap(entry => entry.type === "message" ? [entry.message] : []),
      turnPrefixMessages: [], firstKeptEntryId: "prepared-2", tokensBefore: 10000,
    },
  };
  host.emit("session_start", { reason: startReason });
  return { host, event };
}

describe("preparation ownership and lifecycle", () => {
  test("fresh replacement, reload and legitimate fork runtimes bind on their first start", () => {
    for (const reason of ["new", "resume", "reload", "fork"]) {
      const { host, event } = preparedHost(reason);
      expect(compactionResult(host.emit("session_before_compact", event)).compaction).toBeDefined();
    }
  });
  test("registers only preparation/lifecycle hooks, with no success notification hooks", () => {
    const { host } = preparedHost();
    expect([...host.hooks.keys()].sort()).toEqual([
      "model_select", "session_before_compact", "session_before_fork", "session_before_switch",
      "session_shutdown", "session_start", "session_tree",
    ].sort());
  });
  test("intercepts missing and unfamiliar request reasons with minimal details", () => {
    const { host, event } = preparedHost();
    for (const reason of [undefined, "manual", "threshold", "future-reason"]) {
      const result = compactionResult(host.emit("session_before_compact", { ...event, reason }));
      expect(result.compaction?.summary).toContain("<dc-distill-summary>");
      expect(Object.keys(result.compaction.details).sort()).toEqual([
        "capacityStatus", "compactor", "contextWindow", "summaryDigest", "tokensAfter", "tokensAfterSource",
      ].sort());
      expect(result.compaction.details.tokensAfter).toBeLessThanOrEqual(200000);
    }
  });
  test("child sessions cannot replace the primary owner", () => {
    const { host, event } = preparedHost();
    host.setSession("child");
    host.emit("session_start", { reason: "startup" });
    host.emit("session_shutdown");
    expect(host.emit("session_before_compact", event)).toEqual({ cancel: true });
    host.setSession("primary");
    expect(compactionResult(host.emit("session_before_compact", event)).compaction).toBeDefined();
  });
  test("switch and fork never authorize adoption in the old runtime", () => {
    for (const [hook, reason] of [["session_before_switch", "resume"], ["session_before_fork", "fork"]]) {
      const { host, event } = preparedHost();
      host.emit(hook!);
      host.setSession("replacement");
      host.emit("session_start", { reason });
      expect(host.emit("session_before_compact", event)).toEqual({ cancel: true });
      host.setSession("primary");
      expect(compactionResult(host.emit("session_before_compact", event)).compaction).toBeDefined();
    }
  });
  test("shutdown closes an instance even if a later start names the former owner", () => {
    const { host, event } = preparedHost();
    host.emit("session_shutdown");
    host.emit("session_start", { reason: "reload" });
    expect(host.emit("session_before_compact", event)).toEqual({ cancel: true });
  });
  test("throwing model snapshots cancel and subsequent requests recover", () => {
    for (const target of ["model", "contextWindow"]) {
      const { host, event } = preparedHost();
      const model = host.ctx.model;
      const object = target === "model" ? host.ctx : model!;
      const property = target === "model" ? "model" : "contextWindow";
      const original = Object.getOwnPropertyDescriptor(object, property)!;
      Object.defineProperty(object, property, { configurable: true, get() {
        Object.defineProperty(object, property, original);
        throw new Error("private host data");
      } });
      expect(host.emit("session_before_compact", event)).toEqual({ cancel: true });
      expect(compactionResult(host.emit("session_before_compact", event)).compaction).toBeDefined();
    }
  });
  test("relevant synchronous lifecycle changes invalidate preparation", () => {
    for (const hook of ["model_select", "session_tree", "session_before_switch", "session_before_fork", "session_shutdown"]) {
      const { host, event } = preparedHost();
      const changed = { ...event, get customInstructions() {
        host.emit(hook);
        return "preserve user context";
      } };
      expect(host.emit("session_before_compact", changed)).toEqual({ cancel: true });
    }
  });
  test("model and branch changes during preparation cancel", () => {
    for (const change of ["model", "branch"]) {
      const { host, event } = preparedHost();
      const changed = { ...event, get customInstructions() {
        if (change === "model") host.ctx.model = { ...host.ctx.model!, id: "replacement-model" };
        else host.setBranch(event.branchEntries.slice(0, 2));
        return "preserve user context";
      } };
      expect(host.emit("session_before_compact", changed)).toEqual({ cancel: true });
    }
  });
  test("invalid input, cancellation and mandatory capacity failure never fall through", () => {
    const { host, event } = preparedHost();
    const abort = new AbortController(); abort.abort();
    expect(host.emit("session_before_compact", { ...event, signal: abort.signal })).toEqual({ cancel: true });
    expect(host.emit("session_before_compact", { ...event, preparation: { ...event.preparation, tokensBefore: NaN } })).toEqual({ cancel: true });
    expect(host.emit("session_before_compact", { ...event, preparation: { ...event.preparation, messagesToSummarize: [] } })).toEqual({ cancel: true });
    host.ctx.model = { ...host.ctx.model!, contextWindow: 1 };
    expect(host.emit("session_before_compact", event)).toEqual({ cancel: true });
  });
  test("unknown capacity remains explicit", () => {
    const { host, event } = preparedHost();
    host.ctx.model = undefined;
    const result = compactionResult(host.emit("session_before_compact", event));
    expect(result.compaction.details.capacityStatus).toBe("unknown");
    expect(result.compaction.details.contextWindow).toBeUndefined();
  });
});
