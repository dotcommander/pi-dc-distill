import { LEGACY_COMPACTION_CARD_TYPE } from "./lib/legacy.ts";
/** dc-distill: deterministic, local compaction with a prepare/commit lifecycle. */
import { createHash, randomUUID } from "node:crypto";
import type {
  CompactionEntry,
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "./lib/sdk.ts";
import { buildSessionContext, estimateTokens } from "./lib/sdk.ts";
import { Diag } from "./lib/diag-support.ts";
import { Notify, registerBlockSpec } from "./lib/notify-support.ts";
import { Block } from "./lib/tui-block.ts";
import { Tool } from "./lib/tool-result.ts";
import { Entries } from "./lib/entries-support.ts";
import { Events } from "./lib/events-support.ts";
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
import { recoverContinuation, type RecoveryEntryLike } from "./lib/continuation-recovery.ts";
import { injectFocusEcho } from "./lib/focus-echo.ts";
import { DISTILL_HANDOFF_ENTRY_TYPE, distillHandoffEntry } from "./lib/handoff.ts";
import { buildMetricLine } from "./lib/metric.ts";
import { Monitor } from "./lib/monitor.ts";
import { searchRecallEntries } from "./lib/recall.ts";
import {
  COMPACTION_COOLDOWN_MS,
  DUMP_RETENTION,
  DEFAULT_PI_COMPACTION_SETTINGS,
  DEFAULT_DISTILL_FEATURE_SETTINGS,
  resolveDistillFeatureSettings,
  type DistillFeatureSettings,
  dumpsEnabled,
  resolvePiCompactionSettings,
  type PiCompactionSettings,
} from "./lib/settings.ts";
import { formatDistillStatus } from "./lib/status.ts";
import { DistillStore, type StoredRecallEntry } from "./lib/store.ts";
import { hasLocalCompactor, runStrategies } from "./lib/strategy.ts";
import {
  evaluateCompaction,
  resolveTriggerThresholds,
  type CompactBlockReason,
  type ResolvedTriggerThresholds,
} from "./lib/trigger.ts";
import { Tier } from "./lib/types.ts";
import { registerOutputCompactor } from "./lib/output-compactor.ts";

const VERSION = 8;
const WARN_COOLDOWN_MS = 120_000;
const WARN_STEER_PROMPT = [
  "You are near the context boundary — compaction is imminent.",
  "Finish the current atomic unit, then call save_distill_handoff with either legacy text",
  "or one strict distill-handoff-v1/v2 JSON block. Prefer v2 when task dependencies, decisions,",
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

interface DistillRuntime {
  ownerSessionId: string | null;
  pi: ExtensionAPI;
  monitor: Monitor;
  latch: Latch;
  compactionSettings: PiCompactionSettings;
  featureSettings: DistillFeatureSettings;
  store: DistillStore | null;
  pending: PendingCompaction | null;
  nextAttemptAutonomous: boolean;
  warmupTurnsRemaining: number;
  lastWarnTime: number;
  lastFocusEcho: string | null;
  lastFailure: string | null;
  lastAutoBlockReason: string | null;
  continuationAttemptId: string | null;
  contextWindow?: number;
  compactionCardDedupe: CompactionCardDedupeHandle | null;
}

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sessionId(ctx: ExtensionContext): string {
  return ctx.sessionManager?.getSessionId?.() ?? "unknown-session";
}

function isOwner(runtime: DistillRuntime, ctx: ExtensionContext): boolean {
  return runtime.ownerSessionId !== null && sessionId(ctx) === runtime.ownerSessionId;
}

function clearAttempt(runtime: DistillRuntime): void {
  runtime.pending = null;
  runtime.nextAttemptAutonomous = false;
  runtime.lastAutoBlockReason = null;
  runtime.latch.release();
}

async function reportFailure(
  runtime: DistillRuntime,
  reasons: string[],
  notification?: { ctx: ExtensionContext; message: string },
): Promise<void> {
  // Diagnostics must not replace the original failure or escape the fail-closed hook.
  try {
    await runtime.store?.appendFailure(reasons);
  } catch { /* Failure logging is best effort. */ }
  if (notification?.ctx.hasUI) {
    try {
      Notify.user(notification.ctx, notification.message, "warning");
    } catch { /* A host notification failure must not enable default compaction. */ }
  }
}

function cancellation(error: unknown): boolean {
  return error instanceof CompactionCancelledError
    || (error instanceof Error && ["AbortError", "LoaderAbortError"].includes(error.name));
}

type AutoCheckSource = "agent_settled";

function syncContextUsage(runtime: DistillRuntime, ctx: ExtensionContext): boolean {
  try {
    const usage = ctx.getContextUsage();
    const piSynced = runtime.monitor.syncFromPi(usage?.tokens);
    runtime.contextWindow = usage?.contextWindow
      ?? ctx.model?.contextWindow
      ?? runtime.contextWindow;
    return piSynced || runtime.monitor.hasPiSynced;
  } catch (error) {
    runtime.monitor.diagnostic(
      `auto-check context usage failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    runtime.contextWindow = ctx.model?.contextWindow ?? runtime.contextWindow;
    return runtime.monitor.hasPiSynced;
  }
}

function logAutoBlock(
  runtime: DistillRuntime,
  source: AutoCheckSource,
  reason: CompactBlockReason | "warmup" | "in-flight",
  thresholds: ResolvedTriggerThresholds,
  piSynced: boolean,
): void {
  const tokens = runtime.monitor.state.tokenEstimate;
  if (tokens < thresholds.auto.effective) {
    runtime.lastAutoBlockReason = null;
    return;
  }
  if (runtime.lastAutoBlockReason === reason) return;
  runtime.lastAutoBlockReason = reason;
  const cooldownRemaining = Math.max(
    0,
    COMPACTION_COOLDOWN_MS - (Date.now() - runtime.monitor.state.lastCompactionTime),
  );
  runtime.monitor.diagnostic([
    "auto-check blocked",
    `reason=${reason}`,
    `source=${source}`,
    `tokens=${tokens}`,
    `piSynced=${piSynced}`,
    `contextWindow=${runtime.contextWindow ?? "unknown"}`,
    `auto=${thresholds.auto.effective}`,
    `warn=${thresholds.warn.effective}`,
    `emergency=${thresholds.emergency.effective}`,
    `cooldownMs=${cooldownRemaining}`,
    `repeatBaseline=${runtime.monitor.state.repeatBaselineTokens ?? "none"}`,
  ].join(" "));
}

function checkAutonomousCompaction(
  runtime: DistillRuntime,
  ctx: ExtensionContext,
  source: AutoCheckSource,
): void {
  if (!isOwner(runtime, ctx)) return;
  const piSynced = syncContextUsage(runtime, ctx);
  const triggerOptions = {
    contextWindow: runtime.contextWindow,
    compaction: runtime.compactionSettings,
  };
  const thresholds = resolveTriggerThresholds(triggerOptions);

  if (runtime.latch.held) {
    logAutoBlock(runtime, source, "in-flight", thresholds, piSynced);
    return;
  }
  if (!runtime.compactionSettings.enabled) {
    runtime.lastAutoBlockReason = null;
    return;
  }
  if (runtime.warmupTurnsRemaining > 0) {
    logAutoBlock(runtime, source, "warmup", thresholds, piSynced);
    if (source === "agent_settled") runtime.warmupTurnsRemaining--;
    return;
  }

  const evaluation = evaluateCompaction(runtime.monitor.state, piSynced, triggerOptions);
  if (!evaluation.decision) {
    if (evaluation.blockedBy === "below-auto" || evaluation.blockedBy === "disabled") {
      runtime.lastAutoBlockReason = null;
    } else if (evaluation.blockedBy) {
      logAutoBlock(runtime, source, evaluation.blockedBy, evaluation.thresholds, piSynced);
    }
    return;
  }

  runtime.lastAutoBlockReason = null;
  const decision = evaluation.decision;
  if (decision.tier === Tier.Warn) {
    if (Date.now() - runtime.lastWarnTime < WARN_COOLDOWN_MS) return;
    runtime.lastWarnTime = Date.now();
    Notify.toLLM(runtime.pi, WARN_STEER_PROMPT, {
      customType: "dc-distill-warn",
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
      // Pi emits session_compact_failed as the terminal lifecycle event; that
      // hook owns durable failure state and releases the latch.
      if (!cancellation(error) && ctx.hasUI) {
        Notify.fail(ctx, `Distill failed: ${error.message}`);
      }
    },
  });
}

/**
 * Reconciles durable autonomous continuation against the active branch.
 * Delivery and the unanswered nudge are journal-driven, so a restart,
 * reload, or tree switch can recover a committed attempt exactly once.
 */
function reconcileContinuation(runtime: DistillRuntime, ctx: ExtensionContext): void {
  let branch: RecoveryEntryLike[];
  try {
    branch = (ctx.sessionManager?.getBranch?.() ?? []) as RecoveryEntryLike[];
  } catch {
    // Stale or readonly session view; the next lifecycle event retries.
    return;
  }
  const recovery = recoverContinuation(branch);
  if (recovery.action === "none") {
    runtime.continuationAttemptId = null;
    return;
  }
  if (runtime.continuationAttemptId === recovery.attemptId) return;
  const { attemptId, action } = recovery;
  if (!attemptId) return;
  setImmediate(() => {
    if (runtime.continuationAttemptId === attemptId) return;
    const delivered = queueAutonomousContinuation(runtime.pi, ctx, {
      attemptId,
      resumed: action === "resume",
    });
    if (delivered) runtime.continuationAttemptId = attemptId;
  });
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
    id: "dc-distill-prospective",
    parentId,
    timestamp: "1970-01-01T00:00:00.000Z",
    summary,
    firstKeptEntryId,
    tokensBefore,
    details: { compactor: "dc-distill", version: VERSION },
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

function createRuntime(pi: ExtensionAPI): DistillRuntime {
  return {
    ownerSessionId: null,
    pi,
    monitor: new Monitor(),
    latch: new Latch(),
    compactionSettings: DEFAULT_PI_COMPACTION_SETTINGS,
    featureSettings: DEFAULT_DISTILL_FEATURE_SETTINGS,
    store: null,
    pending: null,
    nextAttemptAutonomous: false,
    continuationAttemptId: null,
    warmupTurnsRemaining: 1,
    lastWarnTime: 0,
    lastFocusEcho: null,
    lastFailure: null,
    lastAutoBlockReason: null,
    compactionCardDedupe: null,
  };
}

export interface DistillExtensionOptions {
  storeFactory?: (ctx: ExtensionContext) => DistillStore;
  loadCompactionSettings?: (cwd: string) => PiCompactionSettings;
  loadFeatureSettings?: (cwd: string) => DistillFeatureSettings;
  outputArtifactRoot?: (cwd: string) => string;
  installCompactionDedupe?: () => Promise<CompactionCardDedupeHandle | null>;
}

function createExtension(pi: ExtensionAPI, options: DistillExtensionOptions = {}) {
  const runtime = createRuntime(pi);
  const refreshCompactionSettings = (ctx: ExtensionContext): boolean => {
    try {
      runtime.compactionSettings = options.loadCompactionSettings?.(ctx.cwd)
        ?? resolvePiCompactionSettings(pi.getSettings(), ctx.model);
      return true;
    } catch (error) {
      runtime.compactionSettings = { ...DEFAULT_PI_COMPACTION_SETTINGS, enabled: false };
      runtime.monitor.diagnostic(`auto-check blocked reason=invalid-settings: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };

  const extension = {
    name: "dc-distill",

    setup: (activePi) => {
      registerOutputCompactor(activePi, {
        config: { enabled: true },
        artifactRoot: options.outputArtifactRoot,
        isEnabled: (ctx) => isOwner(runtime, ctx) && runtime.featureSettings.toolOutput.enabled,
      });
      registerBlockSpec<CompactionCardDetails>(
        activePi,
        COMPACTION_CARD_TYPE,
        (message, options) =>
          compactionCardSpec(message, options.expanded === true),
      );
      // Historical custom cards remain renderable after the rename.
      registerBlockSpec<CompactionCardDetails>(
        activePi, LEGACY_COMPACTION_CARD_TYPE,
        (message, options) => compactionCardSpec(message, options.expanded === true),
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
            recallEnabled: runtime.featureSettings.recall.enabled,
            canonicalInput: canonical.bytes,
            digestScope: canonical.digestScope,
          }, event.signal);
          if (!result.ok) {
            clearAttempt(runtime);
            if (result.cancelled) return Events.cancelCompact();
            runtime.lastFailure = result.reasons.join(" | ");
            await reportFailure(runtime, result.reasons, {
              ctx, message: "Distill cancelled — deterministic compiler failed.",
            });
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
              compactor: "dc-distill",
              version: VERSION,
              tier: result.tier,
              attemptId,
              autonomous: runtime.nextAttemptAutonomous,
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
          await reportFailure(runtime, [runtime.lastFailure], {
            ctx, message: `Distill cancelled: ${runtime.lastFailure}`,
          });
          return Events.cancelCompact();
        }
      });

      Events.context(activePi, async ({ event, ctx }) => {
        if (!isOwner(runtime, ctx)) return undefined;
        const messages = Array.isArray((event as { messages?: unknown }).messages)
          ? (event as { messages: unknown[] }).messages
          : [];
        if (!runtime.featureSettings.recall.enabled) return;
        const transformed = injectFocusEcho(messages);
        if (!transformed) return undefined;
        runtime.lastFocusEcho = transformed.echoText;
        return Events.messages(transformed.messages);
      }, { label: "dc-distill context focus echo" });

      // Owned replacement for the vendored framework's manifest translation:
      // hooks and tools declared on this extension object are registered on
      // the Pi API directly, with the run-to-execute adaptation and result
      // normalization the framework's Tool.register provided.
      for (const [hookName, hookHandler] of Object.entries(extension.hooks)) {
        activePi.on(hookName, async (event: unknown, hookCtx: ExtensionContext) => {
          try {
            return await hookHandler(event, hookCtx);
          } catch (error) {
            Diag.warn("dc-distill", `hook ${hookName} failed`, error);
            return undefined;
          }
        });
      }
      interface OwnedToolDef {
        name: string;
        description: string;
        parameters: Parameters<ExtensionAPI["registerTool"]>[0]["parameters"];
        renderStyle?: string;
        renderResult?: Parameters<ExtensionAPI["registerTool"]>[0]["renderResult"];
        run: (args: never, exec: unknown) => Promise<unknown>;
      }
      for (const toolDef of Object.values(extension.tools) as OwnedToolDef[]) {
        activePi.registerTool({
          name: toolDef.name,
          description: toolDef.description,
          parameters: toolDef.parameters,
          ...(toolDef.renderStyle === "custom" && toolDef.renderResult !== undefined
            ? { renderResult: toolDef.renderResult }
            : {}),
          execute: async (toolCallId, args, signal, onUpdate, execCtx) => {
            const exec = {
              toolCallId,
              signal: signal ?? new AbortController().signal,
              onUpdate: onUpdate ?? (() => {}),
              ctx: execCtx,
            };
            const result = await toolDef.run(args as never, exec);
            if (typeof result === "string") return Tool.text(result);
            return result;
          },
        } as unknown as Parameters<ExtensionAPI["registerTool"]>[0]);
      }
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
        refreshCompactionSettings(ctx);
        runtime.featureSettings = { ...DEFAULT_DISTILL_FEATURE_SETTINGS };
        try {
          runtime.featureSettings = options.loadFeatureSettings?.(ctx.cwd)
            ?? resolveDistillFeatureSettings(pi.getSettings());
        } catch (error) {
          runtime.monitor.diagnostic(`feature settings unavailable; optional features disabled: ${String(error)}`);
        }
        runtime.lastFailure = null;
        runtime.store = options.storeFactory?.(ctx)
          ?? new DistillStore({ projectIdentity: ctx.cwd });
        try {
          const migration = await runtime.store.initialize({
            migrateLegacy: runtime.featureSettings.recall.enabled && runtime.featureSettings.toolOutput.enabled,
          });
          if (migration.status === "failed") {
            runtime.lastFailure = `Legacy migration will retry: ${migration.errors.join(" | ")}`;
          }
        } catch (error) {
          runtime.lastFailure = `Legacy migration will retry: ${error instanceof Error ? error.message : String(error)}`;
        }
        runtime.warmupTurnsRemaining = 1;
        runtime.lastWarnTime = 0;
        runtime.lastFocusEcho = null;
        runtime.lastAutoBlockReason = null;
        runtime.contextWindow = ctx.model?.contextWindow;
        if (ctx.mode === "tui") {
          try {
            runtime.compactionCardDedupe = await (
              options.installCompactionDedupe?.() ?? installPiCompactionCardDedupe()
            );
          } catch (error) {
            Diag.warn("dc-distill", "Pi compaction-card compatibility skipped", error);
          }
        }
        runtime.continuationAttemptId = null;
        reconcileContinuation(runtime, ctx);
      },

      session_shutdown: async (_event, ctx) => {
        if (!isOwner(runtime, ctx)) return;
        runtime.compactionCardDedupe?.dispose();
        runtime.compactionCardDedupe = null;
        clearAttempt(runtime);
        runtime.ownerSessionId = null;
        runtime.store = null;
        runtime.continuationAttemptId = null;
      },

      message_end: async (event, ctx) => {
        if (!isOwner(runtime, ctx) || !event.message) return;
        runtime.monitor.record(event.message);
        if (event.message.role === "assistant" && "usage" in event.message) {
          runtime.monitor.recordApiUsage((event.message as { usage?: ApiUsage }).usage);
        }
      },

      model_select: async (_event, ctx) => {
        if (!isOwner(runtime, ctx)) return;
        runtime.contextWindow = ctx.model?.contextWindow;
        refreshCompactionSettings(ctx);
      },

      agent_settled: async (_event, ctx) => {
        if (!isOwner(runtime, ctx) || !refreshCompactionSettings(ctx)) return;
        checkAutonomousCompaction(runtime, ctx, "agent_settled");
      },

      session_tree: async (_event, ctx) => {
        if (!isOwner(runtime, ctx)) return;
        reconcileContinuation(runtime, ctx);
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
        const matches = details.compactor === "dc-distill"
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
          if (runtime.featureSettings.recall.enabled) {
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
          }
          runtime.lastFailure = null;
          runtime.lastFocusEcho = null;
          if (ctx.hasUI) {
            const afterLabel = fullContextAfter ?? pending.tokensAfter;
            Notify.user(ctx, `Shrunk: ${pending.metric} (${afterLabel.toLocaleString()} post-commit)`, "info");
          }
          if (pending.autonomous) {
            const attemptId = pending.attemptId;
            setImmediate(() => {
              if (runtime.continuationAttemptId === attemptId) return;
              if (queueAutonomousContinuation(runtime.pi, ctx, { attemptId })) {
                runtime.continuationAttemptId = attemptId;
              }
            });
          }
        } finally {
          clearAttempt(runtime);
        }
      },

      session_compact_failed: async (event, ctx) => {
        if (!isOwner(runtime, ctx)) return;
        if (!runtime.pending && !runtime.latch.held) return;
        const outcome = event.aborted ? "aborted" : "failed";
        const detail = event.errorMessage ?? "no error message";
        const failure = `Compaction ${outcome} (${event.reason}): ${detail}`;
        try {
          if (!event.aborted) {
            runtime.lastFailure = failure;
          }
          try {
            runtime.monitor.diagnostic([
              `compaction ${outcome}`,
              `reason=${event.reason}`,
              `fromExtension=${event.fromExtension}`,
              `willRetry=${event.willRetry}`,
              `detail=${detail}`,
            ].join(" "));
          } catch { /* Terminal diagnostics are best effort. */ }
          if (!event.aborted) {
            await reportFailure(runtime, [failure]);
          }
        } finally {
          clearAttempt(runtime);
        }
      },
    },

    tools: {
      save_distill_handoff: {
        name: "save_distill_handoff",
        description: "Save near-compaction state as legacy text or one strict distill-handoff-v1/v2 JSON envelope; v2 preserves task dependencies, decisions, rejected hypotheses, and verification needed.",
        parameters: Type.Object({ handoff: Type.String() }),
        // Custom rendering: the house rail preserves the handoff completion summary.
        renderStyle: "custom",
        renderResult: (_result, _options, theme) => Block.node({
          kind: "rail",
          title: "distill handoff",
          summary: "saved for compaction",
          glyph: "done",
          state: "success",
        }, theme),
        run: async (args, exec) => {
          if (!isOwner(runtime, exec.ctx)) return Tool.error("save_distill_handoff is unavailable outside the owner session.");
          const handoff = String(args.handoff ?? "").trim();
          if (!handoff) return Tool.error("save_distill_handoff requires a non-empty handoff.");
          Entries.append(runtime.pi, DISTILL_HANDOFF_ENTRY_TYPE, distillHandoffEntry(handoff));
          return Tool.text("Distill handoff saved.", { details: { customType: DISTILL_HANDOFF_ENTRY_TYPE } });
        },
      },

      recall_compaction: {
        name: "recall_compaction",
        description: "Opt-in search of prior compaction summaries in this project or across all projects; disabled by default.",
        parameters: Type.Object({
          query: Type.String(),
          limit: Type.Optional(Type.Number({ default: 3 })),
          scope: Type.Optional(Type.Union([Type.Literal("project"), Type.Literal("all")], { default: "project" })),
        }),
        run: async (args, exec) => {
          try {
            if (!isOwner(runtime, exec.ctx)) return Tool.error("recall_compaction is unavailable outside the owner session.");
            if (!runtime.featureSettings.recall.enabled) {
              return Tool.text('Recall is disabled. Set extensionConfig["dc-distill"].recall.enabled to true in Pi settings and start a new session.');
            }
            if (!runtime.store) return Tool.text("No active distill session.");
            const entries = await runtime.store.loadRecall(args.scope === "all" ? "all" : "project");
            const results = searchRecallEntries(entries, String(args.query ?? ""), Number(args.limit ?? 3));
            return Tool.text(results.length ? results.join("\n\n---\n\n") : "No matching summaries found.");
          } catch (error) {
            return Tool.error(`recall_compaction failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        },
      },
    },

  };

  return extension;
}

export default function setupDistill(pi: ExtensionAPI): void {
  createExtension(pi).setup(pi);
}

export function createDistillExtension(options: DistillExtensionOptions) {
  return (pi: ExtensionAPI): void => {
    createExtension(pi, options).setup(pi);
  };
}
