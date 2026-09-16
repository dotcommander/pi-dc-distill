/** dc-shrink: deterministic, local compaction with a prepare/commit lifecycle. */
import { createHash, randomUUID } from "node:crypto";
import type {
  CompactionEntry,
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "#shrink-framework/pi/coding-agent";
import {
  buildSessionContext,
  estimateTokens,
} from "#shrink-framework/pi/coding-agent";
import { defineExtension, Diag, Notify, Tool } from "#shrink-framework";
import { Entries } from "#shrink-framework/x/entries";
import { Events } from "#shrink-framework/x/events";
import { Block } from "#shrink-framework/x/output";
import { Type } from "typebox";
import {
  buildCompactionSource,
  canonicalizeCompactionSource,
  CompactionCancelledError,
} from "./lib/compaction-source.ts";
import {
  installPiCompactionCardDedupe,
  type CompactionCardDedupeHandle,
} from "./lib/compaction-card-dedupe.ts";
import {
  compactionCardSpec,
  COMPACTION_CARD_TYPE,
  type CompactionCardDetails,
} from "./lib/compaction-card.ts";
import { queueAutonomousContinuation } from "./lib/continuation.ts";
import { injectFocusEcho } from "./lib/focus-echo.ts";
import { SHRINK_HANDOFF_ENTRY_TYPE, shrinkHandoffEntry } from "./lib/handoff.ts";
import { buildMetricLine } from "./lib/metric.ts";
import { Monitor } from "./lib/monitor.ts";
import { searchRecallEntries } from "./lib/recall.ts";
import {
  DUMP_RETENTION,
  DEFAULT_PI_COMPACTION_SETTINGS,
  dumpsEnabled,
  loadPiCompactionSettings,
  type PiCompactionSettings,
} from "./lib/settings.ts";
import { formatShrinkStatus } from "./lib/status.ts";
import { ShrinkStore, type StoredRecallEntry } from "./lib/store.ts";
import { hasLocalCompactor, runStrategies } from "./lib/strategy.ts";
import { shouldCompact } from "./lib/trigger.ts";
import { Tier } from "./lib/types.ts";
import { registerOutputCompactor } from "./lib/output-compactor.ts";

const VERSION = 7;
const WARN_COOLDOWN_MS = 120_000;
const WARN_STEER_PROMPT = [
  "You are near the context boundary — compaction is imminent.",
  "Finish the current atomic unit, then call save_shrink_handoff with either legacy text",
  "or one strict shrink-handoff-v1/v2 JSON block. Prefer v2 when task dependencies, decisions,",
  "or rejected hypotheses matter. Record only explicit current state and exact next actions.",
].join("\n");

interface ApiUsage {
  totalTokens?: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

interface PendingCompaction {
  readonly attemptId: string;
  readonly sessionId: string;
  readonly firstKeptEntryId: string;
  readonly summaryDigest: string;
  readonly wireSummary: string;
  readonly canonicalInput: string;
  readonly ts: string;
  readonly autonomous: boolean;
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  readonly summaryTokens: number;
  readonly apiTokensBefore?: number;
  readonly exchangesBefore: number;
  readonly callsBefore: number;
  readonly toolTokensBefore: number;
  readonly tier: 1;
  readonly readFiles: string[];
  readonly modifiedFiles: string[];
  readonly literalAnchors: string[];
  readonly inputDigest: string;
  readonly digestScope: "compaction-input" | "bounded-compaction-input";
  readonly metric: string;
}

class Latch {
  private armed = false;
  acquire(): boolean {
    if (this.armed) return false;
    this.armed = true;
    return true;
  }
  release(): void { this.armed = false; }
  get held(): boolean { return this.armed; }
}

interface ShrinkRuntime {
  ownerSessionId: string | null;
  pi: ExtensionAPI;
  monitor: Monitor;
  latch: Latch;
  compactionSettings: PiCompactionSettings;
  store: ShrinkStore | null;
  pending: PendingCompaction | null;
  nextAttemptAutonomous: boolean;
  warmupTurnsRemaining: number;
  lastWarnTime: number;
  lastFocusEcho: string | null;
  lastFailure: string | null;
  contextWindow?: number;
  compactionCardDedupe: CompactionCardDedupeHandle | null;
}

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sessionId(ctx: ExtensionContext): string {
  return ctx.sessionManager?.getSessionId?.() ?? "unknown-session";
}

function isOwner(runtime: ShrinkRuntime, ctx: ExtensionContext): boolean {
  return runtime.ownerSessionId !== null && sessionId(ctx) === runtime.ownerSessionId;
}

function clearAttempt(runtime: ShrinkRuntime): void {
  runtime.pending = null;
  runtime.nextAttemptAutonomous = false;
  runtime.latch.release();
}

function cancellation(error: unknown): boolean {
  return error instanceof CompactionCancelledError
    || (error instanceof Error && ["AbortError", "LoaderAbortError"].includes(error.name));
}

function summaryTokenEstimate(summary: string): number {
  return estimateTokens({
    role: "user",
    content: summary,
    timestamp: Date.now(),
  } as never);
}

function prospectiveTokens(
  branchEntries: SessionEntry[],
  firstKeptEntryId: string,
  tokensBefore: number,
  summary: string,
): number {
  const parentId = branchEntries.at(-1)?.id ?? null;
  const entry: CompactionEntry = {
    type: "compaction",
    id: "dc-shrink-prospective",
    parentId,
    timestamp: "1970-01-01T00:00:00.000Z",
    summary,
    firstKeptEntryId,
    tokensBefore,
    details: { compactor: "dc-shrink", version: VERSION },
  };
  const context = buildSessionContext([...branchEntries, entry], entry.id);
  return context.messages.reduce((sum, message) => sum + estimateTokens(message), 0);
}

function buildWireSummary(input: {
  summary: string;
  apiTokensBefore: number;
  tokensBefore: number;
  branchEntries: SessionEntry[];
  firstKeptEntryId: string;
}): { wireSummary: string; tokensAfter: number; summaryTokens: number; metric: string } {
  let after = summaryTokenEstimate(input.summary);
  for (let iteration = 0; iteration < 8; iteration++) {
    const metric = buildMetricLine(input.apiTokensBefore, input.tokensBefore, after);
    const wireSummary = `_${metric}_\n\n${input.summary}`;
    const rebuilt = prospectiveTokens(
      input.branchEntries,
      input.firstKeptEntryId,
      input.tokensBefore,
      wireSummary,
    );
    if (rebuilt === after) {
      return {
        wireSummary,
        tokensAfter: rebuilt,
        summaryTokens: summaryTokenEstimate(wireSummary),
        metric,
      };
    }
    after = rebuilt;
  }

  const metric = input.apiTokensBefore > 0
    ? `${input.apiTokensBefore.toLocaleString()} API / ${input.tokensBefore.toLocaleString()} est → rebuilt context`
    : `${input.tokensBefore.toLocaleString()} → rebuilt context`;
  const wireSummary = `_${metric}_\n\n${input.summary}`;
  return {
    wireSummary,
    tokensAfter: prospectiveTokens(
      input.branchEntries,
      input.firstKeptEntryId,
      input.tokensBefore,
      wireSummary,
    ),
    summaryTokens: summaryTokenEstimate(wireSummary),
    metric,
  };
}

function createRuntime(pi: ExtensionAPI): ShrinkRuntime {
  return {
    ownerSessionId: null,
    pi,
    monitor: new Monitor(),
    latch: new Latch(),
    compactionSettings: DEFAULT_PI_COMPACTION_SETTINGS,
    store: null,
    pending: null,
    nextAttemptAutonomous: false,
    warmupTurnsRemaining: 1,
    lastWarnTime: 0,
    lastFocusEcho: null,
    lastFailure: null,
    compactionCardDedupe: null,
  };
}

export interface ShrinkExtensionOptions {
  storeFactory?: (ctx: ExtensionContext) => ShrinkStore;
  loadCompactionSettings?: (cwd: string) => PiCompactionSettings;
  installCompactionDedupe?: () => Promise<CompactionCardDedupeHandle | null>;
}

function createExtension(pi: ExtensionAPI, options: ShrinkExtensionOptions = {}) {
  const runtime = createRuntime(pi);

  return defineExtension({
    name: "dc-shrink",
    storage: { data: true },

    setup: (activePi) => {
      registerOutputCompactor(activePi);
      Block.registerSpec<CompactionCardDetails>(
        activePi,
        COMPACTION_CARD_TYPE,
        (message, options) =>
          compactionCardSpec(message, options.expanded === true),
      );
      Events.beforeCompact(activePi, async ({ event, ctx }) => {
        if (!isOwner(runtime, ctx)) return Events.cancelCompact();
        if (event.signal.aborted) {
          clearAttempt(runtime);
          return Events.cancelCompact();
        }

        const { preparation } = event;
        if (
          (preparation.messagesToSummarize?.length ?? 0) === 0
          && (preparation.turnPrefixMessages?.length ?? 0) === 0
          && !preparation.previousSummary
        ) {
          clearAttempt(runtime);
          runtime.lastFailure = "No usable messages were available for deterministic compaction.";
          return Events.cancelCompact();
        }

        try {
          const source = buildCompactionSource({
            previousSummary: preparation.previousSummary,
            messagesToSummarize: preparation.messagesToSummarize as never[],
            turnPrefixMessages: preparation.turnPrefixMessages as never[],
            branchEntries: event.branchEntries,
            sessionId: sessionId(ctx),
            cwd: ctx.cwd,
            timestamp: ctx.sessionManager?.getHeader?.()?.timestamp,
          });
          const canonical = canonicalizeCompactionSource(source, event.signal);
          const result = await runStrategies({
            userFocus: event.customInstructions,
            canonicalInput: canonical.bytes,
            digestScope: canonical.digestScope,
          }, event.signal);
          if (!result.ok) {
            clearAttempt(runtime);
            if (result.cancelled) return Events.cancelCompact();
            runtime.lastFailure = result.reasons.join(" | ");
            await runtime.store?.appendFailure(result.reasons);
            if (ctx.hasUI) Notify.user(ctx, "Shrink cancelled — deterministic compiler failed.", "warning");
            return Events.cancelCompact();
          }
          if (event.signal.aborted) throw new CompactionCancelledError();

          const apiTokensBefore = runtime.monitor.state.apiTokenCount;
          const wire = buildWireSummary({
            summary: result.summary,
            apiTokensBefore,
            tokensBefore: preparation.tokensBefore,
            branchEntries: event.branchEntries,
            firstKeptEntryId: preparation.firstKeptEntryId,
          });
          if (Array.from(wire.wireSummary).length > 65_536) {
            throw new Error("wire summary exceeds 65,536 code points");
          }
          if (event.signal.aborted) throw new CompactionCancelledError();

          const summaryDigest = digest(wire.wireSummary);
          const reductionPct = preparation.tokensBefore > 0
            ? Math.round(((preparation.tokensBefore - wire.tokensAfter) / preparation.tokensBefore) * 100)
            : 0;
          const attemptId = randomUUID();
          runtime.pending = Object.freeze({
            attemptId,
            sessionId: sessionId(ctx),
            firstKeptEntryId: preparation.firstKeptEntryId,
            summaryDigest,
            wireSummary: wire.wireSummary,
            canonicalInput: canonical.bytes,
            ts: new Date().toISOString(),
            autonomous: runtime.nextAttemptAutonomous,
            tokensBefore: preparation.tokensBefore,
            tokensAfter: wire.tokensAfter,
            summaryTokens: wire.summaryTokens,
            apiTokensBefore: apiTokensBefore || undefined,
            exchangesBefore: runtime.monitor.state.exchangeCount,
            callsBefore: runtime.monitor.state.callCount,
            toolTokensBefore: runtime.monitor.state.toolTokens,
            tier: result.tier,
            readFiles: result.readFiles,
            modifiedFiles: result.modifiedFiles,
            literalAnchors: result.literalAnchors,
            inputDigest: result.inputDigest,
            digestScope: result.digestScope,
            metric: wire.metric,
          });

          return Events.compact({
            summary: wire.wireSummary,
            firstKeptEntryId: preparation.firstKeptEntryId,
            tokensBefore: preparation.tokensBefore,
            details: {
              compactor: "dc-shrink",
              version: VERSION,
              tier: result.tier,
              attemptId,
              tokensAfter: wire.tokensAfter,
              summaryTokens: wire.summaryTokens,
              tokensAfterSource: "pi-rebuilt-message-estimate",
              reductionPct,
              apiTokensBefore: apiTokensBefore || undefined,
              readFiles: result.readFiles,
              modifiedFiles: result.modifiedFiles,
              literalAnchors: result.literalAnchors,
              inputDigest: result.inputDigest,
              summaryDigest,
              digestScope: result.digestScope,
            },
          });
        } catch (error) {
          clearAttempt(runtime);
          if (cancellation(error)) return Events.cancelCompact();
          runtime.lastFailure = error instanceof Error ? error.message : String(error);
          await runtime.store?.appendFailure([runtime.lastFailure]);
          if (ctx.hasUI) Notify.user(ctx, `Shrink cancelled: ${runtime.lastFailure}`, "warning");
          return Events.cancelCompact();
        }
      });

      Events.context(activePi, async ({ event, ctx }) => {
        if (!isOwner(runtime, ctx)) return undefined;
        const messages = Array.isArray((event as { messages?: unknown }).messages)
          ? (event as { messages: unknown[] }).messages
          : [];
        const transformed = injectFocusEcho(messages);
        if (!transformed) return undefined;
        runtime.lastFocusEcho = transformed.echoText;
        return Events.messages(transformed.messages);
      }, { label: "dc-shrink context focus echo" });
    },

    hooks: {
      session_start: async (_event, ctx) => {
        const currentId = sessionId(ctx);
        if (runtime.ownerSessionId !== null && runtime.ownerSessionId !== currentId) return;
        runtime.compactionCardDedupe?.dispose();
        runtime.compactionCardDedupe = null;
        runtime.ownerSessionId = currentId;
        clearAttempt(runtime);
        runtime.monitor.reset();
        runtime.compactionSettings = options.loadCompactionSettings?.(ctx.cwd)
          ?? loadPiCompactionSettings(ctx.cwd);
        runtime.lastFailure = null;
        runtime.store = options.storeFactory?.(ctx)
          ?? new ShrinkStore({ projectIdentity: ctx.cwd });
        try {
          const migration = await runtime.store.initialize();
          if (migration.status === "failed") {
            runtime.lastFailure = `Legacy migration will retry: ${migration.errors.join(" | ")}`;
          }
        } catch (error) {
          runtime.lastFailure = `Legacy migration will retry: ${error instanceof Error ? error.message : String(error)}`;
        }
        runtime.warmupTurnsRemaining = 1;
        runtime.lastWarnTime = 0;
        runtime.lastFocusEcho = null;
        runtime.contextWindow = undefined;
        if (ctx.mode === "tui") {
          try {
            runtime.compactionCardDedupe = await (
              options.installCompactionDedupe?.() ?? installPiCompactionCardDedupe()
            );
          } catch (error) {
            Diag.warn("dc-shrink", "Pi compaction-card compatibility skipped", error);
          }
        }
      },

      session_shutdown: async (_event, ctx) => {
        if (!isOwner(runtime, ctx)) return;
        runtime.compactionCardDedupe?.dispose();
        runtime.compactionCardDedupe = null;
        clearAttempt(runtime);
        runtime.ownerSessionId = null;
        runtime.store = null;
      },

      message_end: async (event, ctx) => {
        if (!isOwner(runtime, ctx) || !event.message) return;
        runtime.monitor.record(event.message);
        if (event.message.role === "assistant" && "usage" in event.message) {
          runtime.monitor.recordApiUsage((event.message as { usage?: ApiUsage }).usage);
        }
      },

      agent_settled: async (_event, ctx) => {
        if (!isOwner(runtime, ctx)) return;
        let piSynced = false;
        try {
          const usage = ctx.getContextUsage();
          if (usage) {
            piSynced = runtime.monitor.syncFromPi(usage.tokens);
            runtime.contextWindow = usage.contextWindow ?? ctx.model?.contextWindow;
          }
        } catch { /* older Pi */ }

        if (runtime.latch.held) return;
        if (!runtime.compactionSettings.enabled) return;
        if (runtime.warmupTurnsRemaining > 0) {
          runtime.warmupTurnsRemaining--;
          return;
        }
        const decision = shouldCompact(
          runtime.monitor.state,
          piSynced || runtime.monitor.hasPiSynced,
          {
            contextWindow: runtime.contextWindow,
            compaction: runtime.compactionSettings,
          },
        );
        if (!decision) return;
        if (decision.tier === Tier.Warn) {
          if (Date.now() - runtime.lastWarnTime < WARN_COOLDOWN_MS) return;
          runtime.lastWarnTime = Date.now();
          Notify.toLLM(runtime.pi, WARN_STEER_PROMPT, {
            customType: "dc-shrink-warn",
            details: { reason: decision.reason },
            triggerTurn: false,
            deliverAs: "steer",
          });
          return;
        }
        if (!runtime.latch.acquire()) return;
        runtime.nextAttemptAutonomous = true;
        runtime.monitor.state.lastCompactionTime = Date.now();
        ctx.compact({
          onError: (error: Error) => {
            clearAttempt(runtime);
            if (!cancellation(error) && ctx.hasUI) {
              Notify.fail(ctx, `Shrink failed: ${error.message}`);
            }
          },
        });
      },

      session_compact: async (event, ctx) => {
        if (!isOwner(runtime, ctx)) return;
        const pending = runtime.pending;
        if (!pending) return;
        if (!event.fromExtension) {
          clearAttempt(runtime);
          return;
        }
        const entry = event.compactionEntry;
        const details = (entry.details ?? {}) as Record<string, unknown>;
        const matches = details.compactor === "dc-shrink"
          && details.version === VERSION
          && details.attemptId === pending.attemptId
          && entry.firstKeptEntryId === pending.firstKeptEntryId
          && digest(entry.summary) === pending.summaryDigest
          && details.summaryDigest === pending.summaryDigest;
        if (!matches) {
          clearAttempt(runtime);
          return;
        }

        try {
          const usage = ctx.getContextUsage?.();
          const fullContextAfter = typeof usage?.tokens === "number" && usage.tokens > 0
            ? usage.tokens
            : undefined;
          runtime.monitor.recordCompaction(fullContextAfter ?? pending.tokensAfter);
          await runtime.store?.appendLog({
            ts: pending.ts,
            sessionId: pending.sessionId,
            tier: pending.tier,
            before: pending.tokensBefore,
            after: pending.tokensAfter,
            rebuiltMessageAfter: pending.tokensAfter,
            fullContextAfter,
            fullContextAfterSource: fullContextAfter === undefined
              ? undefined
              : "pi-post-rebuild-context-usage",
            tokenSource: "pi-rebuilt-message-estimate",
            removed: pending.tokensBefore - pending.tokensAfter,
            toolTokens: pending.toolTokensBefore,
            idleS: Math.round(runtime.monitor.idleMs / 1000),
            exchanges: pending.exchangesBefore,
            sessionCalls: pending.callsBefore,
            apiTokensBefore: pending.apiTokensBefore,
            summaryHead: pending.wireSummary.slice(0, 200),
            summaryLen: pending.wireSummary.length,
            strategy: "algorithmic",
          });
          await runtime.store?.writeDump(
            pending.ts,
            pending.canonicalInput,
            pending.wireSummary,
            {
              enabled: dumpsEnabled(),
              maxDumps: DUMP_RETENTION,
              attemptId: pending.attemptId,
            },
          );
          const recall: StoredRecallEntry = {
            ts: pending.ts,
            before: pending.tokensBefore,
            after: pending.tokensAfter,
            fullContextAfter,
            fullContextAfterSource: fullContextAfter === undefined
              ? undefined
              : "pi-post-rebuild-context-usage",
            tokenSource: "pi-rebuilt-message-estimate",
            sessionId: pending.sessionId,
            summary: pending.wireSummary,
          };
          await runtime.store?.persistRecall(recall);
          runtime.lastFailure = null;
          runtime.lastFocusEcho = null;
          if (ctx.hasUI) {
            const afterLabel = fullContextAfter ?? pending.tokensAfter;
            Notify.user(ctx, `Shrunk: ${pending.metric} (${afterLabel.toLocaleString()} post-commit)`, "info");
          }
          if (pending.autonomous) {
            setImmediate(() => queueAutonomousContinuation(runtime.pi, ctx));
          }
        } finally {
          clearAttempt(runtime);
        }
      },
    },

    tools: {
      save_shrink_handoff: {
        name: "save_shrink_handoff",
        description: "Save near-compaction state as legacy text or one strict shrink-handoff-v1/v2 JSON envelope; v2 preserves task dependencies, decisions, rejected hypotheses, and verification needed.",
        parameters: Type.Object({ handoff: Type.String() }),
        // Custom rendering: the house rail preserves the handoff completion summary.
        renderStyle: "custom",
        renderResult: (_result, _options, theme) => Block.node({
          kind: "rail",
          title: "shrink handoff",
          summary: "saved for compaction",
          glyph: "done",
          state: "success",
        }, theme),
        run: async (args, exec) => {
          if (!isOwner(runtime, exec.ctx)) return Tool.error("save_shrink_handoff is unavailable outside the owner session.");
          const handoff = String(args.handoff ?? "").trim();
          if (!handoff) return Tool.error("save_shrink_handoff requires a non-empty handoff.");
          Entries.append(runtime.pi, SHRINK_HANDOFF_ENTRY_TYPE, shrinkHandoffEntry(handoff));
          return Tool.text("Shrink handoff saved.", { details: { customType: SHRINK_HANDOFF_ENTRY_TYPE } });
        },
      },

      recall_compaction: {
        name: "recall_compaction",
        description: "Search prior compaction summaries in this project, or explicitly across all projects.",
        parameters: Type.Object({
          query: Type.String(),
          limit: Type.Optional(Type.Number({ default: 3 })),
          scope: Type.Optional(Type.Union([Type.Literal("project"), Type.Literal("all")], { default: "project" })),
        }),
        run: async (args, exec) => {
          try {
            if (!isOwner(runtime, exec.ctx)) return Tool.error("recall_compaction is unavailable outside the owner session.");
            if (!runtime.store) return Tool.text("No active shrink session.");
            const entries = await runtime.store.loadRecall(args.scope === "all" ? "all" : "project");
            const results = searchRecallEntries(entries, String(args.query ?? ""), Number(args.limit ?? 3));
            return Tool.text(results.length ? results.join("\n\n---\n\n") : "No matching summaries found.");
          } catch (error) {
            return Tool.error(`recall_compaction failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        },
      },
    },

  });
}

export default function setupShrink(pi: ExtensionAPI): void {
  createExtension(pi)(pi);
}

export function createShrinkExtension(options: ShrinkExtensionOptions) {
  return (pi: ExtensionAPI): void => createExtension(pi, options)(pi);
}
