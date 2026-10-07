import { formatInteger } from "./lib/wire-format.ts";
import { join } from "node:path";
import { Path } from "./lib/paths.ts";
import { LEGACY_COMPACTION_CARD_TYPE } from "./lib/legacy.ts";
/** dc-distill: deterministic, local compaction with a prepare/commit lifecycle. */
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { sha256Hex } from "./lib/sha256.ts";
import type {
  CompactionEntry,
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "./lib/sdk.ts";
import { buildSessionContext, estimateTokens } from "./lib/sdk.ts";
import { Diag } from "./lib/diag-support.ts";
import { commonPrefixCodePoints } from "./lib/unicode.ts";
import { Notify, registerBlockSpec } from "./lib/notify-support.ts";
import { Block } from "./lib/tui-block.ts";
import { Tool } from "./lib/tool-result.ts";
import { Entries } from "./lib/entries-support.ts";
import { Events } from "./lib/events-support.ts";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  buildCompactionSource,
  sourceOccurrences,
  canonicalizeCompactionSource,
  CompactionCancelledError,
} from "./lib/compaction-source.ts";
import {
  compactionCardSpec,
  COMPACTION_CARD_TYPE,
  type CompactionCardDetails,
} from "./lib/compaction-card.ts";
import { queueAutonomousContinuation, continuationFenced, fenceContinuation, observeContinuation, cancelContinuationCallback, scheduleContinuationCallback } from "./lib/continuation.ts";
import { recoverContinuation, type RecoveryEntryLike } from "./lib/continuation-recovery.ts";
import { injectFocusEcho } from "./lib/focus-echo.ts";
import { prepareCheckpointUpdate, readCheckpointUpdateBase } from "./lib/checkpoint-update.ts";
import { DISTILL_HANDOFF_ENTRY_TYPE, distillHandoffEntry } from "./lib/handoff.ts";
import { validateCheckpoint, checkpointDigest, checkpointSectionLedger } from "./lib/compiler/checkpoint.ts";
import type { CheckpointSectionLedger } from "./lib/compiler/checkpoint.ts";
import type { ResumeCheckpointV1 } from "./lib/compiler/checkpoint.ts";
import { CompactionInputError, compilerFailureCode } from "./lib/compiler/errors.ts";
import { buildMetricLine } from "./lib/metric.ts";
import { Phase1Controller, type AttemptTicket } from "./lib/phase1-controller.ts";
import { searchRecallEntries } from "./lib/recall.ts";
import {
  DUMP_RETENTION,
  type DistillFeatureSettings,
  dumpsEnabled,
  type PiCompactionSettings,
} from "./lib/settings.ts";
import { projectActiveBranchRecall } from "./lib/recall-projection.ts";
import { DistillStore } from "./lib/store.ts";
import { runStrategies } from "./lib/strategy.ts";
import { Tier } from "./lib/types.ts";
import { registerOutputCompactor } from "./lib/output-compactor.ts";

const VERSION = 15;
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
  readonly ticket: AttemptTicket;
  readonly firstKeptEntryId: string;
  readonly summaryDigest: string;
  readonly checkpoint: ResumeCheckpointV1;
  readonly checkpointDigest: string;
  readonly checkpointSections: CheckpointSectionLedger;
  readonly wireSummary: string;
  readonly canonicalInput: string;
  readonly ts: string;
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  readonly apiTokensBefore?: number;
  readonly exchangesBefore: number;
  readonly callsBefore: number;
  readonly toolTokensBefore: number;
  readonly tier: 1;
  readonly metric: string;
}

interface DistillRuntime extends Phase1Controller {
  store: DistillStore | null;
  pending: PendingCompaction | null;
  lastFailure: string | null;
  recallRecovery: Promise<void> | null;
  recallRequested: { ctx: ExtensionContext; revision: number; committedEntry?: CompactionEntry } | null;
}

function isOwner(runtime: DistillRuntime, ctx: ExtensionContext): boolean {
  return runtime.isOwner(ctx);
}

function clearAttempt(runtime: DistillRuntime, ticket: AttemptTicket | null): void {
  if (runtime.finishAttempt(ticket)) runtime.pending = null;
}

async function reportFailure(
  runtime: DistillRuntime,
  reasons: string[],
  notification?: { ctx: ExtensionContext; message: string },
  store = runtime.store,
): Promise<void> {
  const lease = notification ? runtime.lease(notification.ctx) : null;
  // Diagnostics must not replace the original failure or escape the fail-closed hook.
  try {
    await store?.appendFailure(reasons);
  } catch { /* Failure logging is best effort. */ }
  if (notification?.ctx.hasUI && runtime.isCurrent(lease, notification.ctx)) {
    try {
      Notify.user(notification.ctx, notification.message, "warning");
    } catch { /* A host notification failure must not enable default compaction. */ }
  }
}

/** Formatting diagnostics is itself fallible (getters, proxies, toString). */
function errorText(error: unknown): string {
  try { return error instanceof Error ? error.message : String(error); }
  catch { return "unreportable error"; }
}
function cancellation(error: unknown): boolean {
  try { return error instanceof CompactionCancelledError
    || (error instanceof Error && ["AbortError", "LoaderAbortError"].includes(error.name)); } catch { return false; }
}

function checkAutonomousCompaction(runtime: DistillRuntime, ctx: ExtensionContext): void {
  const evaluation = runtime.assess(ctx);
  const decision = evaluation?.decision;
  if (!decision) return;
  if (decision.tier === Tier.Warn) {
    Notify.toLLM(runtime.pi, WARN_STEER_PROMPT, {
      customType: "dc-distill-warn",
      details: { reason: decision.reason },
      deliverAs: "steer",
      triggerTurn: false,
    });
    return;
  }
  const ticket = runtime.requestAttempt(ctx);
  if (!ticket) return;
  try {
    ctx.compact({
      onComplete: () => { clearAttempt(runtime, ticket); },
      onError: (error: Error) => {
        if (!runtime.ownsAttempt(ticket, ctx)) return;
        // Callback captures submission ownership; an anonymous host event cannot.
        try {
          if (!cancellation(error) && !runtime.failedCompilerAttempt(ticket) && ctx.hasUI) {
            try { Notify.fail(ctx, `Distill failed: ${errorText(error)}`); } catch { /* Total diagnostics. */ }
          }
        } finally { clearAttempt(runtime, ticket); }
      },
    });
  } catch (error) {
    clearAttempt(runtime, ticket);
    throw error;
  }
}

/** Reconcile the durable journal without treating send return as acknowledgement. */
function reconcileContinuation(runtime: DistillRuntime, ctx: ExtensionContext, committedAttemptId?: string): boolean {
  const lease = runtime.lease(ctx);
  if (!lease) return false;
  const revision = runtime.contextRevision;
  const readRecovery = () => recoverContinuation((ctx.sessionManager?.getBranch?.() ?? []) as RecoveryEntryLike[]);
  let recovery: ReturnType<typeof recoverContinuation>;
  try { recovery = readRecovery(); } catch { return false; }
  const attemptId = recovery.attemptId;
  if (!attemptId) return false;
  if (recovery.phase === "delivered" || recovery.phase === "answered") observeContinuation(lease.sessionId, attemptId);
  if (recovery.action === "none" || (committedAttemptId && committedAttemptId !== attemptId)) return false;
  if (continuationFenced(lease.sessionId, attemptId, recovery.action)) return false;
  scheduleContinuationCallback(lease.sessionId, () => {
    if (!runtime.isCurrent(lease, ctx) || revision !== runtime.contextRevision) return;
    let current: ReturnType<typeof recoverContinuation>;
    try { current = readRecovery(); } catch { return; }
    if (current.action === "none" || current.attemptId !== attemptId
      || continuationFenced(lease.sessionId, attemptId, current.action)) return;
    const kind = current.action;
    queueAutonomousContinuation(runtime.pi, ctx, {
      attemptId, resumed: kind === "resume",
      beforeSubmit: () => fenceContinuation(lease.sessionId, attemptId, kind),
    });
  });
  return true;
}

async function independentEffect(runtime: DistillRuntime, label: string, effect: () => unknown): Promise<void> {
  const store = runtime.store;
  try { await effect(); }
  catch (error) {
    // A callback may complete its effect before rejecting. Do not replay it;
    // storage owns any safe internal retry, and journal recovery stays separate.
    const message = `${label} failed: ${errorText(error)}`;
    try { runtime.monitor.diagnostic(message); } catch { /* Independent best effort diagnostics. */ }
    await reportFailure(runtime, [message], undefined, store);
  }
}

/** Coalesce branch recovery and validate its lease/revision inside the destination lock. */
function reconcileRecall(runtime: DistillRuntime, ctx: ExtensionContext, committedEntry?: CompactionEntry): Promise<void> {
  if (!runtime.featureSettings.recall.enabled || !isOwner(runtime, ctx) || !runtime.store) return Promise.resolve();
  runtime.recallRequested = { ctx, revision: runtime.contextRevision, committedEntry };
  if (runtime.recallRecovery) return runtime.recallRecovery;
  runtime.recallRecovery = (async () => {
    while (runtime.recallRequested) {
      const request = runtime.recallRequested;
      runtime.recallRequested = null;
      const lease = runtime.lease(request.ctx);
      const store = runtime.store;
      const isCurrent = () => runtime.featureSettings.recall.enabled && runtime.isCurrent(lease, request.ctx)
        && request.revision === runtime.contextRevision && store === runtime.store;
      if (!lease || !store || !isCurrent()) continue;
      await independentEffect(runtime, "Recall reconciliation", async () => {
        const branch = request.ctx.sessionManager.getBranch();
        const entries = request.committedEntry && !branch.some(entry => entry.id === request.committedEntry!.id)
          ? [...branch, request.committedEntry] : branch;
        const rows = projectActiveBranchRecall(entries, store.projectIdentity, lease.sessionId);
        if (!rows.length) return;
        const result = await store.reconcileRecall(rows, { isCurrent });
        for (const conflict of result.conflicts) {
          try { runtime.monitor.diagnostic(`Recall digest conflict: ${conflict}`); } catch { /* Best effort. */ }
        }
      });
    }
  })().finally(() => { runtime.recallRecovery = null; });
  return runtime.recallRecovery;
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
  // One render and one prospective rebuilt-context estimate. Metrics live only
  // in details and committed artifacts, never in model-facing source text.
  const wireSummary = input.summary;
  const tokensAfter = prospectiveTokens(input.branchEntries, input.firstKeptEntryId, input.tokensBefore, wireSummary);
  return { wireSummary, tokensAfter, summaryTokens: summaryTokenEstimate(wireSummary),
    metric: buildMetricLine(input.apiTokensBefore, input.tokensBefore, tokensAfter) };
}

function createRuntime(pi: ExtensionAPI, options: DistillExtensionOptions): DistillRuntime {
  return Object.assign(new Phase1Controller(pi, options), {
    store: null, pending: null, recallRecovery: null, recallRequested: null,
    lastFailure: null,
  });
}

export interface DistillExtensionOptions {
  /** Internal deterministic lifecycle clock; defaults to Date.now. */
  clock?: () => number;
  storeFactory?: (ctx: ExtensionContext) => DistillStore;
  loadCompactionSettings?: (cwd: string) => PiCompactionSettings;
  loadFeatureSettings?: (cwd: string) => DistillFeatureSettings;
  outputArtifactRoot?: (cwd: string) => string;
}

function createExtension(pi: ExtensionAPI, options: DistillExtensionOptions = {}) {
  const runtime = createRuntime(pi, options);

  const extension = {
    name: "dc-distill",

    setup: (activePi) => {
      registerOutputCompactor(activePi, {
        config: { enabled: true },
        artifactRoot: options.outputArtifactRoot ?? ((cwd) => join(
          runtime.store?.projectRoot ?? Path.project("dc-distill", cwd).path, "tool-output",
        )),
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
        const ticket = runtime.beginPreparation(ctx);
        if (!ticket) return Events.cancelCompact();
        const metrics = runtime.snapshotAttemptMetrics();
        const store = runtime.store;
        if (event.signal.aborted) {
          runtime.cancelPreparation(ticket);
          return Events.cancelCompact();
        }

        const { preparation } = event;
        if (
          (preparation.messagesToSummarize?.length ?? 0) === 0
          && (preparation.turnPrefixMessages?.length ?? 0) === 0
          && !preparation.previousSummary
        ) {
          const firstPause = runtime.pauseCompilerFailure(ticket, ctx, "source", "invalid_input");
          runtime.cancelPreparation(ticket);
          runtime.lastFailure = "No usable messages were available for deterministic compaction.";
          if (firstPause) await reportFailure(runtime, [runtime.lastFailure], {
            ctx, message: `Distill automatic compaction paused: ${runtime.lastFailure}\nManual /compact remains available.`,
          }, store);
          return Events.cancelCompact();
        }

        let failureStage: "source" | "compile" | "validation" | null = null;
        let failureWindow = runtime.contextWindow;
        try {
          // Host metadata access is outside local compiler classification.
          const timestamp = ctx.sessionManager?.getHeader?.()?.timestamp;
          failureStage = "source";
          const source = buildCompactionSource({
            previousSummary: preparation.previousSummary,
            firstKeptEntryId: preparation.firstKeptEntryId,
            messagesToSummarize: preparation.messagesToSummarize as never[],
            turnPrefixMessages: preparation.turnPrefixMessages as never[],
            branchEntries: event.branchEntries,
            sessionId: ticket.lease.sessionId,
            cwd: ctx.cwd,
            timestamp,
          });
          const canonical = canonicalizeCompactionSource(source, event.signal);
          failureStage = "compile";
          const result = await runStrategies({
            userFocus: event.customInstructions,
            recallEnabled: runtime.featureSettings.recall.enabled,
            canonicalInput: canonical.bytes,
            digestScope: canonical.digestScope,
          }, event.signal);
          if (!runtime.snapshotMatches(ticket, ctx)) { runtime.cancelPreparation(ticket); return Events.cancelCompact(); }
          if (!result.ok) {
            const firstPause = !result.cancelled && runtime.pauseCompilerFailure(ticket, ctx, "compile", result.failure?.code ?? "compiler_failure");
            runtime.cancelPreparation(ticket);
            if (result.cancelled) return Events.cancelCompact();
            if (ticket.autonomous && !firstPause && runtime.failedCompilerAttempt(ticket)) return Events.cancelCompact();
            runtime.lastFailure = result.reasons.join(" | ");
            // Bound only the UI excerpt; durable failure logging keeps every reason.
            const reasonPoints = Array.from(runtime.lastFailure);
            const reasonExcerpt = reasonPoints.length > 2_048
              ? `${reasonPoints.slice(0, 2_048).join("")}…`
              : runtime.lastFailure;
            await reportFailure(runtime, result.reasons, {
              ctx, message: firstPause
                ? `Distill automatic compaction paused — deterministic compiler failed.\n${reasonExcerpt}\nManual /compact remains available.`
                : `Distill cancelled — deterministic compiler failed.\n${reasonExcerpt}`,
            }, store);
            return Events.cancelCompact();
          }
          if (event.signal.aborted) throw new CompactionCancelledError();

          const apiTokensBefore = metrics.apiTokensBefore;
          failureStage = "validation";
          const wire = buildWireSummary({
            summary: result.summary,
            apiTokensBefore,
            tokensBefore: preparation.tokensBefore,
            branchEntries: event.branchEntries,
            firstKeptEntryId: preparation.firstKeptEntryId,
          });
          if (Array.from(wire.wireSummary).length > 65_536) {
            throw new CompactionInputError("protected wire summary exceeds 65,536 code points", "protected_overflow");
          }
          if (event.signal.aborted) throw new CompactionCancelledError();

          // Cache-stability observation only: how much of the predecessor's
          // wire summary survives verbatim at the head of the new one.
          if (source.previousSummary) {
            Diag.debug("dc-distill", `cache-stability headStableCodePoints=${commonPrefixCodePoints(source.previousSummary, wire.wireSummary)}`);
          }

          failureStage = null;
          let currentUsage: ReturnType<ExtensionContext["getContextUsage"]>;
          try { currentUsage = ctx.getContextUsage?.(); } catch { currentUsage = undefined; }
          const validWindow = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
          const capacityWindow = validWindow(currentUsage?.contextWindow) ? currentUsage.contextWindow
            : validWindow(ctx.model?.contextWindow) ? ctx.model.contextWindow : undefined;
          failureWindow = capacityWindow;
          failureStage = "validation";
          if (capacityWindow !== undefined && wire.tokensAfter >= capacityWindow) {
            throw new CompactionInputError(`rebuilt context estimate ${wire.tokensAfter} reaches or exceeds context window ${capacityWindow}`, "protected_overflow");
          }
          const capacityStatus = capacityWindow === undefined ? "unknown" as const : "within-window" as const;
          const summaryDigest = sha256Hex(wire.wireSummary);
          const reductionPct = preparation.tokensBefore > 0
            ? Math.round(((preparation.tokensBefore - wire.tokensAfter) / preparation.tokensBefore) * 100)
            : 0;
          const attemptId = ticket.attemptId;
          const checkpoint = validateCheckpoint(result.checkpoint, result.checkpointDigest);
          const checkpointSections = checkpointSectionLedger(checkpoint);
          runtime.pending = Object.freeze({
            ticket,
            firstKeptEntryId: preparation.firstKeptEntryId,
            summaryDigest,
            checkpoint,
            checkpointDigest: result.checkpointDigest,
            checkpointSections,
            wireSummary: wire.wireSummary,
            canonicalInput: canonical.bytes,
            ts: new Date().toISOString(),
            tokensBefore: preparation.tokensBefore,
            tokensAfter: wire.tokensAfter,
            apiTokensBefore: apiTokensBefore || undefined,
            exchangesBefore: metrics.exchangesBefore,
            callsBefore: metrics.callsBefore,
            toolTokensBefore: metrics.toolTokensBefore,
            tier: result.tier,
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
              autonomous: ticket.autonomous,
              tokensAfter: wire.tokensAfter,
              summaryTokens: wire.summaryTokens,
              tokensAfterSource: "pi-rebuilt-message-estimate",
              capacityStatus,
              ...(capacityWindow === undefined ? {} : { contextWindow: capacityWindow }),
              reductionPct,
              apiTokensBefore: apiTokensBefore || undefined,
              readFiles: result.readFiles,
              modifiedFiles: result.modifiedFiles,
              literalAnchors: result.literalAnchors,
              inputDigest: result.inputDigest,
              summaryDigest,
              checkpoint,
              checkpointDigest: result.checkpointDigest,
              checkpointSections,
              digestScope: result.digestScope,
            },
          });
        } catch (error) {
          if (!runtime.snapshotMatches(ticket, ctx)) { runtime.cancelPreparation(ticket); return Events.cancelCompact(); }
          const firstPause = !cancellation(error) && failureStage !== null
            && runtime.pauseCompilerFailure(ticket, ctx, failureStage, compilerFailureCode(error), failureWindow);
          runtime.cancelPreparation(ticket);
          if (cancellation(error)) return Events.cancelCompact();
          if (ticket.autonomous && !firstPause && runtime.failedCompilerAttempt(ticket)) return Events.cancelCompact();
          runtime.lastFailure = errorText(error);
          await reportFailure(runtime, [runtime.lastFailure], {
            ctx, message: firstPause
              ? `Distill automatic compaction paused: ${runtime.lastFailure}\nManual /compact remains available.`
              : `Distill cancelled: ${runtime.lastFailure}`,
          }, store);
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
            try { Diag.warn("dc-distill", `hook ${hookName} failed`, error); } catch { /* Diagnostic reporting is total. */ }
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
        const lease = runtime.start(ctx);
        if (!lease) return;
        runtime.pending = null;
        runtime.lastFailure = null;
        if (runtime.ownerSessionId) cancelContinuationCallback(runtime.ownerSessionId);
        runtime.store = null;
        try {
          const store = options.storeFactory?.(ctx)
            ?? new DistillStore({ projectIdentity: ctx.cwd });
          runtime.store = store;
          const migration = await store.initialize({
            migrateLegacy: runtime.featureSettings.recall.enabled && runtime.featureSettings.toolOutput.enabled,
          });
          if (!runtime.isCurrent(lease, ctx)) return;
          if (migration.status === "failed") runtime.lastFailure = `Legacy migration will retry: ${migration.errors.join(" | ")}`;
        } catch (error) {
          if (!runtime.isCurrent(lease, ctx)) return;
          runtime.lastFailure = `Legacy migration will retry: ${errorText(error)}`;
        }
        if (!runtime.isCurrent(lease, ctx)) return;
        try {
          await reconcileRecall(runtime, ctx);
        } finally {
          // Pi binds RPC listeners after awaited session_start hooks return.
          // Arm the deferred sender last: no asynchronous startup work may
          // yield after this point and let it outrun listener installation.
          if (runtime.isCurrent(lease, ctx)) reconcileContinuation(runtime, ctx);
        }
      },

      session_shutdown: async (_event, ctx) => {
        if (!isOwner(runtime, ctx)) return;
        if (runtime.ownerSessionId) cancelContinuationCallback(runtime.ownerSessionId);
        runtime.recallRequested = null;
        runtime.shutdown(ctx);
        runtime.pending = null;
        runtime.store = null;

      },

      message_end: async (event, ctx) => {
        if (!isOwner(runtime, ctx) || !event.message) return;
        if (event.message.role === "user") {
          if (runtime.ownerSessionId) cancelContinuationCallback(runtime.ownerSessionId);
          runtime.contextChanged(ctx);
        }
        runtime.monitor.record(event.message);
        if (event.message.role === "assistant" && "usage" in event.message) {
          runtime.monitor.recordApiUsage((event.message as { usage?: ApiUsage }).usage);
        }
      },

      model_select: async (_event, ctx) => {
        if (!isOwner(runtime, ctx)) return;
        runtime.contextChanged(ctx);
        runtime.admissionContextChanged(ctx);
        runtime.refreshSettings(ctx);
      },

      input: async (event, ctx) => {
        if (isOwner(runtime, ctx) && event.source !== "extension") runtime.ignoreSettledTurn(ctx);
      },

      tool_call: async (event, ctx) => {
        if (!isOwner(runtime, ctx)) return;
        // message_end precedes persistence. At tool_call the calling assistant
        // is in the journal; sampling here never interrupts pending siblings.
        try {
          const entry = ctx.sessionManager.getBranch().findLast((item) => item.type === "message"
            && item.message.role === "assistant");
          if (entry?.type !== "message" || entry.message.role !== "assistant"
            || entry.message.stopReason === "error" || entry.message.stopReason === "aborted"
            || !entry.message.content.some((block) => block.type === "toolCall" && block.id === event.toolCallId)) return;
          runtime.samplePostCompaction(ctx);
        } catch { /* Unknown journal cannot establish a fresh baseline. */ }
      },

      turn_end: async (event, ctx) => {
        if (!isOwner(runtime, ctx) || event.message.role !== "assistant") return;
        try {
          const branch = ctx.sessionManager.getBranch();
          const assistant = branch.find((entry) => entry.id === event.messageEntryId);
          if (assistant?.type !== "message" || assistant.message.role !== "assistant"
            || event.toolResultEntryIds.length !== event.toolResults.length
            || event.toolResultEntryIds.some((id) => !branch.some((entry) => entry.id === id
              && entry.type === "message" && entry.message.role === "toolResult"))) return;
        } catch { return; }
        if (event.outcome !== "completed" || event.message.stopReason === "error"
          || event.message.stopReason === "aborted") {
          runtime.ignoreTurn(ctx, event.messageEntryId);
          return;
        }
        runtime.samplePostCompaction(ctx);
      },

      // All autonomous bands are decided after the host run settles, using
      // current usage and an exact leaf anchor. Only the journal owns continuation sends.
      agent_settled: async (_event, ctx) => {
        if (reconcileContinuation(runtime, ctx)) return;
        if (runtime.shouldAssessSettled(ctx)) checkAutonomousCompaction(runtime, ctx);
      },

      session_tree: async (_event, ctx) => {
        if (!isOwner(runtime, ctx)) return;
        runtime.contextChanged(ctx);
        runtime.admissionContextChanged(ctx, true);
        reconcileContinuation(runtime, ctx);
        await reconcileRecall(runtime, ctx);
      },

      session_compact: async (event, ctx) => {
        if (!isOwner(runtime, ctx)) return;
        if (!event.fromExtension && runtime.ownerSessionId) cancelContinuationCallback(runtime.ownerSessionId);
        const pending = runtime.pending;
        const incomingDetails = event.compactionEntry.details as Record<string, unknown> | undefined;
        if (!pending || !event.fromExtension || incomingDetails?.compactor !== "dc-distill"
          || incomingDetails?.version !== VERSION || incomingDetails?.attemptId !== pending.ticket.attemptId) {
          runtime.observeHostCompaction(ctx, event.compactionEntry,
            incomingDetails?.compactor !== "dc-distill" || incomingDetails?.version !== VERSION);
        }
        if (!pending) return;
        const ticket = pending.ticket;
        if (!runtime.ownsAttempt(ticket, ctx) || runtime.commitInFlight) return;
        const store = runtime.store;
        const lease = ticket.lease;
        const metrics = runtime.snapshotAttemptMetrics();
        if (!event.fromExtension) return;
        const entry = event.compactionEntry;
        const details = (entry.details ?? {}) as Record<string, unknown>;
        let checkpointMatches = false;
        try {
          const committedCheckpoint = validateCheckpoint(details.checkpoint, pending.checkpointDigest);
          checkpointMatches = checkpointDigest(pending.checkpoint) === pending.checkpointDigest
            && details.checkpointDigest === pending.checkpointDigest
            && checkpointDigest(committedCheckpoint) === pending.checkpointDigest
            && isDeepStrictEqual(pending.checkpointSections, checkpointSectionLedger(pending.checkpoint))
            && isDeepStrictEqual(details.checkpointSections, pending.checkpointSections)
            && isDeepStrictEqual(details.checkpointSections, checkpointSectionLedger(committedCheckpoint));
        } catch { /* Invalid expected v14 state never downgrades to legacy prose. */ }
        let branchMatches = false;
        try {
          const branch = ctx.sessionManager.getBranch();
          const leafId = branch.at(-1)?.id ?? null;
          // The host appends the compaction entry after `session_before_compact`,
          // and sibling extensions may append further entries (for example
          // compaction-reactive markers) before this event runs. Ownership
          // therefore also accepts the entry while it remains the active
          // branch's newest compaction; a superseding compaction or a
          // navigation that abandons the entry cannot commit.
          let lastCompactionId: string | undefined;
          let entryIsNewestCompaction = false;
          for (let i = branch.length - 1; i >= 0; i--) {
            const e = branch[i] as { id?: string; type?: string } | undefined;
            if (!e) continue;
            if (e.type === "compaction" && lastCompactionId === undefined) lastCompactionId = e.id;
            if (e.id !== undefined && e.id === entry.id) {
              entryIsNewestCompaction = e.type === "compaction" && lastCompactionId === entry.id;
              break;
            }
          }
          branchMatches = leafId === ticket.branchAnchor || leafId === entry.id
            || (entry.id !== undefined && entryIsNewestCompaction);
          if (ticket.branchAnchor !== null && entry.parentId !== ticket.branchAnchor) branchMatches = false;
        } catch { /* Unknown ownership cannot authorize a commit. */ }
        const matches = branchMatches && checkpointMatches && details.compactor === "dc-distill"
          && details.version === VERSION
          && details.attemptId === pending.ticket.attemptId
          && entry.firstKeptEntryId === pending.firstKeptEntryId
          && sha256Hex(entry.summary) === pending.summaryDigest
          && details.summaryDigest === pending.summaryDigest;
        // An unowned or stale event cannot clear the current reservation.
        if (!matches) {
          try {
            runtime.monitor.diagnostic(
              `compaction commit ignored reason=identity-mismatch branch=${branchMatches} checkpoint=${checkpointMatches}`
              + ` version=${String(details.version)} attempt=${String(details.attemptId ?? "none")}`);
          } catch { /* Diagnostics cannot prevent scoped terminal cleanup. */ }
          return;
        }

        let releaseReservation = false;
        try {
          const admission = runtime.beginCommitOutcome(ticket, ctx);
          if (!admission.accepted && (admission.reason === "unowned-attempt" || admission.reason === "commit-in-flight")) return;
          releaseReservation = true;
          if (!admission.accepted) {
            try { runtime.monitor.diagnostic(`compaction commit rejected reason=${admission.reason} reservation=released`); }
            catch { /* Rejection diagnostics cannot prevent scoped terminal cleanup. */ }
            return;
          }
          let usage: ReturnType<ExtensionContext["getContextUsage"]>;
          try { usage = ctx.getContextUsage?.(); } catch { usage = undefined; }
          const fullContextAfter = typeof usage?.tokens === "number" && Number.isFinite(usage.tokens) && usage.tokens > 0
            ? usage.tokens
            : undefined;
          runtime.recordCommittedCompaction(fullContextAfter ?? pending.tokensAfter, entry.id);
          runtime.clearCompilerPauseAfterCommit(ctx, entry.id);
          runtime.lastFailure = null;
          if (pending.ticket.autonomous) reconcileContinuation(runtime, ctx, pending.ticket.attemptId);
          await independentEffect(runtime, "Compaction log", () => store?.appendLog({
            ts: pending.ts,
            sessionId: pending.ticket.lease.sessionId,
            tier: pending.tier,
            before: pending.tokensBefore,
            after: pending.tokensAfter,
            rebuiltMessageAfter: pending.tokensAfter,
            fullContextAfter,
            tokenObservation: fullContextAfter === undefined ? "unavailable" : "observed",
            ...(fullContextAfter === undefined ? {} : { observedTokenDelta: fullContextAfter - pending.tokensAfter }),
            fullContextAfterSource: fullContextAfter === undefined
              ? undefined
              : "pi-post-rebuild-context-usage",
            tokenSource: "pi-rebuilt-message-estimate",
            removed: pending.tokensBefore - pending.tokensAfter,
            toolTokens: pending.toolTokensBefore,
            idleS: metrics.idleS,
            exchanges: pending.exchangesBefore,
            sessionCalls: pending.callsBefore,
            apiTokensBefore: pending.apiTokensBefore,
            summaryHead: pending.wireSummary.slice(0, 200),
            summaryLen: pending.wireSummary.length,
            strategy: "algorithmic",
          }));
          if (!runtime.ownsAttempt(ticket, ctx)) return;
          await independentEffect(runtime, "Compaction dump", () => store?.writeDump(
            pending.ts,
            pending.canonicalInput,
            pending.wireSummary,
            {
              enabled: dumpsEnabled(),
              maxDumps: DUMP_RETENTION,
              attemptId: pending.ticket.attemptId,
            },
          ));
          if (!runtime.ownsAttempt(ticket, ctx)) return;
          await reconcileRecall(runtime, ctx, entry);
          if (!runtime.isCurrent(lease, ctx)) return;
          runtime.lastFailure = null;
          if (ctx.hasUI) {
            const observation = fullContextAfter === undefined ? "post-commit observation unavailable"
              : `${formatInteger(fullContextAfter)} observed post-commit; delta ${formatInteger(fullContextAfter - pending.tokensAfter)}`;
            await independentEffect(runtime, "Compaction notification", () => Notify.user(ctx, `Shrunk: ${pending.metric} (${observation})`, "info"));
          }
          if (pending.ticket.autonomous) reconcileContinuation(runtime, ctx, pending.ticket.attemptId);
        } finally {
          if (releaseReservation) clearAttempt(runtime, ticket);
        }
      },

      session_compact_failed: async (event, ctx) => {
        if (!isOwner(runtime, ctx)) return;
        const ticket = runtime.activeAttempt;
        if (!ticket || runtime.commitInFlight) return;
        // Native host failure events may be anonymous. Preserve ambiguous
        // ownership until the captured callback, identified terminal event, or
        // session reset. Guessing from reason/fromExtension could clear B for A.
        const identified = (event as { attemptId?: unknown }).attemptId === ticket.attemptId;
        if (!identified && event.aborted !== true) {
          try { runtime.monitor.diagnostic("compaction failure ownership=ambiguous reservation=retained recovery=originating-terminal-callback-or-session-reset"); }
          catch { /* A diagnostic cannot change conservative reservation ownership. */ }
        }
        try {
          const outcome = event.aborted ? "aborted" : "failed";
          const failure = `Compaction ${outcome} (${errorText(event.reason)}): ${errorText(event.errorMessage ?? "no error message")}`;
          if (identified && !event.aborted) runtime.lastFailure = failure;
          try { runtime.monitor.diagnostic(failure); } catch { /* Total diagnostics. */ }
          if (!event.aborted && !runtime.failedCompilerAttempt(ticket)) await reportFailure(runtime, [failure]);
        } catch { /* A diagnostic must never release an ambiguously owned attempt. */ }
        finally {
          if (identified) clearAttempt(runtime, ticket);
          else if (event.aborted === true
            && (runtime.hasCancelledPreparation() || runtime.pending?.ticket === ticket)) {
            // Native triggers carry no attemptId and no ctx.compact callbacks;
            // their anonymous aborted event is the attempt's only terminal
            // callback. Release only provably dead attempts: one this runtime
            // cancelled, or one whose returned result can no longer be appended.
            clearAttempt(runtime, ticket);
          }
        }
      },
    },

    tools: {
      save_distill_handoff: {
        name: "save_distill_handoff",
        description: "Save near-compaction state as legacy text or one strict distill-handoff-v1/v2 JSON envelope; v2 preserves task dependencies, decisions, rejected hypotheses, and verification needed.",
        parameters: Type.Object({ handoff: Type.String(), checkpoint: Type.Optional(Type.Unknown()) }),
        // Render the returned outcome, including a saved update whose acknowledgement failed.
        renderStyle: "custom",
        renderResult: (result, _options, theme) => {
          const failed = (result as { isError?: boolean }).isError === true;
          const text = result.content.filter((block) => block.type === "text")
            .map((block) => block.text).join(" ");
          const savedWithoutAcknowledgement = failed
            && text.startsWith("Checkpoint update saved; identity acknowledgement failed:");
          return Block.node({
            kind: "rail",
            title: "distill handoff",
            summary: failed ? text || "handoff failed" : "saved for compaction",
            glyph: savedWithoutAcknowledgement ? "warning" : failed ? "failed" : "done",
            state: savedWithoutAcknowledgement ? "warning" : failed ? "error" : "success",
          }, theme);
        },
        run: async (args, exec) => {
          if (!isOwner(runtime, exec.ctx)) return Tool.error("save_distill_handoff is unavailable outside the owner session.");
          const handoff = String(args.handoff ?? "").trim();
          if (!handoff) return Tool.error("save_distill_handoff requires a non-empty handoff.");
          if (args.checkpoint !== undefined) {
            let savedUpdate = false;
            try {
              if (Array.from(JSON.stringify({ handoff, checkpoint: args.checkpoint })).length > 16_384) {
                return Tool.error("Checkpoint update and handoff exceed the 16,384-code-point saved update envelope.");
              }
              const branch = exec.ctx.sessionManager.getBranch();
              const base = readCheckpointUpdateBase(branch);
              const update = prepareCheckpointUpdate(args.checkpoint, { ...base,
                occurrences: sourceOccurrences(branch, runtime.sessionId(exec.ctx)!),
                nextUpdateEntryId: randomUUID(), handoff });
              Entries.append(runtime.pi, DISTILL_HANDOFF_ENTRY_TYPE, { ...distillHandoffEntry(handoff), ...update });
              savedUpdate = true;
              const savedBranch = exec.ctx.sessionManager.getBranch();
              const canonicalBase = readCheckpointUpdateBase(savedBranch);
              const saved = savedBranch.at(-1);
              const entryId = saved?.type === "custom" && saved.customType === DISTILL_HANDOFF_ENTRY_TYPE ? saved.id : undefined;
              return Tool.text(entryId ? "Distill checkpoint update saved." : "Distill checkpoint update saved; host entry identity is unavailable.", {
                details: { customType: DISTILL_HANDOFF_ENTRY_TYPE, checkpointDigest: canonicalBase.checkpointDigest,
                  expectedBase: { checkpointDigest: canonicalBase.checkpointDigest, updateEntryId: entryId ?? null },
                  operations: update.operations, ...(entryId ? {} : { baseIdentityUnknown: true }) } });
            } catch (error) { return Tool.error(`${savedUpdate ? "Checkpoint update saved; identity acknowledgement failed" : "Checkpoint update rejected"}: ${errorText(error)}`); }
          }
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
          scope: Type.Optional(StringEnum(["project", "all"] as const, { default: "project" })),
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
