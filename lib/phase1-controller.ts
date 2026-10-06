import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "./sdk.ts";
import type { CompactionCardDedupeHandle } from "./compaction-card-dedupe.ts";
import { Monitor } from "./monitor.ts";
import { Diag, diagnosticSessionLabel } from "./diag-support.ts";
import {
  DEFAULT_PI_COMPACTION_SETTINGS, DEFAULT_DISTILL_FEATURE_SETTINGS,
  resolvePiCompactionSettings, resolveDistillFeatureSettings,
  type PiCompactionSettings, type DistillFeatureSettings,
} from "./settings.ts";
import { TRIGGER_POLICY_VERSION, assessCompaction, resolveTriggerThresholds, type CompactEvaluation, validateTriggerGeometry } from "./trigger.ts";
import { Tier } from "./types.ts";
import type { CompilerFailureCode } from "./compiler/errors.ts";

export interface SessionLease { readonly sessionId: string; readonly generation: number }
export interface AttemptTicket {
  readonly identity: symbol;
  readonly lease: SessionLease;
  readonly autonomous: boolean;
  readonly attemptId: string;
  readonly contextRevision: number;
  readonly branchAnchor: string | null;
  readonly modelIdentity: string;
  readonly settings: Readonly<PiCompactionSettings>;
}
export interface Phase1Options {
  clock?: () => number;
  loadCompactionSettings?: (cwd: string) => PiCompactionSettings;
  loadFeatureSettings?: (cwd: string) => DistillFeatureSettings;
}
export type CommitRejectionReason = "unowned-attempt" | "commit-in-flight" | "preparation-cancelled"
  | "context-revision-changed" | "model-changed" | "settings-changed" | "snapshot-unavailable";
export type CommitOutcome = { accepted: true } | { accepted: false; reason: CommitRejectionReason };
type SampleStatus = "finite-positive" | "unavailable" | "invalid" | "thrown";
export type CompilerFailureStage = "source" | "compile" | "validation";
interface CompilerPause {
  readonly ticket: AttemptTicket;
  readonly contextWindow: number | undefined;
  readonly stage: CompilerFailureStage;
  readonly code: CompilerFailureCode;
}

/** Shared-runtime lifecycle and autonomous policy; durable transactions stay in index. */
export class Phase1Controller {
  readonly monitor: Monitor;
  readonly clock: () => number;
  ownerSessionId: string | null = null;
  private generation = 0;
  contextRevision = 0;
  compactionSettings: PiCompactionSettings = DEFAULT_PI_COMPACTION_SETTINGS;
  featureSettings: DistillFeatureSettings = DEFAULT_DISTILL_FEATURE_SETTINGS;
  contextWindow?: number;
  warmupTurnsRemaining = 1;
  private lastWarnTime = 0;
  private diagnosticKey: string | null = null;
  private startupCooldownExempt = false;
  private admissionCompactionId: string | null = null;
  private admissionModel = "";
  /** Pending suppressed decided-line burst: consecutive same-key decisions within 5s. */
  private decidedBurst: { key: string; line: string; count: number; firstAt: number } | null = null;
  private settingsValid = true;
  private settingsError: string | null = null;
  private sampleStatus: SampleStatus = "unavailable";
  private ticket: AttemptTicket | null = null;
  private compilerPause: CompilerPause | null = null;
  private assessedTurnId: string | null = null;
  private preparing = false;
  private preparationCancelled = false;
  private committing = false;
  compactionCardDedupe: CompactionCardDedupeHandle | null = null;

  constructor(readonly pi: ExtensionAPI, private readonly options: Phase1Options = {}) {
    this.clock = options.clock ?? Date.now;
    this.monitor = new Monitor(this.clock);
  }

  sessionId(ctx: ExtensionContext): string | null {
    try {
      const id = ctx.sessionManager?.getSessionId?.();
      return typeof id === "string" && id.trim().length > 0 ? id : null;
    } catch { return null; }
  }
  isOwner(ctx: ExtensionContext): boolean {
    return this.ownerSessionId !== null && this.sessionId(ctx) === this.ownerSessionId;
  }
  lease(ctx: ExtensionContext): SessionLease | null {
    return this.isOwner(ctx) ? Object.freeze({ sessionId: this.ownerSessionId!, generation: this.generation }) : null;
  }
  isCurrent(lease: SessionLease | null, ctx: ExtensionContext): boolean {
    return lease !== null && lease.generation === this.generation
      && lease.sessionId === this.ownerSessionId && this.isOwner(ctx);
  }
  start(ctx: ExtensionContext): SessionLease | null {
    const id = this.sessionId(ctx);
    if (!id || (this.ownerSessionId !== null && this.ownerSessionId !== id)) return null;
    this.disposeUI();
    this.generation++;
    this.contextRevision++;
    this.ownerSessionId = id;
    Diag.setOwnerSession(id);
    this.monitor.sessionTag = id;
    this.ticket = null;
    this.preparing = false;
    this.preparationCancelled = false;
    this.committing = false;
    this.compilerPause = null;
    this.assessedTurnId = null;
    this.monitor.reset();
    this.warmupTurnsRemaining = 1;
    this.lastWarnTime = 0;
    this.diagnosticKey = null;
    this.startupCooldownExempt = false;
    this.admissionCompactionId = null;
    this.admissionModel = this.modelIdentity(ctx);
    this.decidedBurst = null;
    this.sampleStatus = "unavailable";
    this.contextWindow = ctx.model?.contextWindow;
    this.restoreAdmissionBranch(ctx, true);
    this.refreshSettings(ctx);
    this.featureSettings = DEFAULT_DISTILL_FEATURE_SETTINGS;
    try {
      this.featureSettings = this.options.loadFeatureSettings?.(ctx.cwd)
        ?? resolveDistillFeatureSettings(this.pi.getSettings());
    } catch {
      try { this.monitor.diagnostic("feature settings unavailable; optional features disabled"); }
      catch { /* Diagnostics cannot interrupt initialization. */ }
    }
    return this.lease(ctx);
  }
  shutdown(ctx: ExtensionContext): boolean {
    if (!this.isOwner(ctx)) return false;
    this.generation++;
    this.contextRevision++;
    this.ownerSessionId = null;
    this.compilerPause = null;
    Diag.setOwnerSession(null);
    this.ticket = null;
    this.preparing = false;
    this.preparationCancelled = false;
    this.committing = false;
    this.disposeUI();
    return true;
  }
  private disposeUI(): void {
    const handle = this.compactionCardDedupe;
    this.compactionCardDedupe = null;
    try { handle?.dispose(); } catch { /* Compatibility cleanup is best effort. */ }
  }
  attachUI(handle: CompactionCardDedupeHandle | null, lease: SessionLease, ctx: ExtensionContext): void {
    if (!this.isCurrent(lease, ctx)) {
      try { handle?.dispose(); } catch { /* Late handle must not revive ownership. */ }
      return;
    }
    this.disposeUI();
    this.compactionCardDedupe = handle;
  }
  contextChanged(ctx: ExtensionContext): void {
    if (!this.isOwner(ctx)) return;
    this.contextRevision++;
    // Input may reach message_end without an input hook, before persistence.
    // The preceding assistant cannot authorize a settlement in the new context.
    this.ignoreSettledTurn(ctx);
    this.contextWindow = ctx.model?.contextWindow;
  }
  /** Only lifecycle branch/model changes rebase admission, never ordinary user turns. */
  admissionContextChanged(ctx: ExtensionContext, branchChanged = false): void {
    if (!this.isOwner(ctx)) return;
    const modelChanged = this.admissionModel !== this.modelIdentity(ctx);
    if (this.compilerPause && this.compilerPause.ticket.modelIdentity !== this.modelIdentity(ctx)) this.compilerPause = null;
    this.admissionModel = this.modelIdentity(ctx);
    if (branchChanged) {
      // An unreadable/partial journal cannot prove navigation away from failure.
      try {
        const branch = this.trustedBranch(ctx);
        const anchor = this.compilerPause?.ticket.branchAnchor;
        if (anchor !== undefined && anchor !== null && !branch.some((entry) => entry.id === anchor)) this.compilerPause = null;
      } catch { /* Preserve pause while branch provenance is unavailable. */ }
      this.restoreAdmissionBranch(ctx, false);
    }
    else if (modelChanged && (this.admissionCompactionId !== null
      || this.monitor.state.repeatBaselineTokens !== null || this.monitor.state.awaitingPostCompactionSample)) {
      this.monitor.state.repeatBaselineTokens = null;
      this.monitor.state.awaitingPostCompactionSample = true;
    }
  }
  private restoreAdmissionBranch(ctx: ExtensionContext, startup: boolean): void {
    this.startupCooldownExempt = false;
    try {
      // One immutable startup journal snapshot; never read the append-only file.
      const branch = ctx.sessionManager.getBranch().slice();
      let previousId: string | null = null;
      let latest: { id: string; timestamp: number } | null = null;
      const ids = new Set<string>();
      for (const entry of branch) {
        const time = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
        if (typeof entry.id !== "string" || !entry.id.trim() || ids.has(entry.id)
          || typeof entry.type !== "string" || !Number.isFinite(time) || time < 0 || time > this.clock()
          || (entry.parentId ?? null) !== previousId) throw new Error("Untrusted branch journal");
        ids.add(entry.id);
        previousId = entry.id;
        if (entry.type === "compaction") latest = { id: entry.id, timestamp: time };
      }
      if (latest) {
        if (latest.id !== this.admissionCompactionId) {
          this.admissionCompactionId = latest.id;
          this.monitor.restoreCompaction(latest.timestamp);
        } else if (!startup) {
          this.monitor.state.repeatBaselineTokens = null;
          this.monitor.state.awaitingPostCompactionSample = true;
        }
      } else if (startup && branch.length > 0) {
        this.startupCooldownExempt = true;
      } else if (!startup) {
        this.admissionCompactionId = null;
        this.monitor.restoreCompaction(this.clock());
      }
    } catch {
      this.admissionCompactionId = null;
      this.monitor.restoreCompaction(this.clock());
    }
  }
  /** Foreign/manual/legacy commits affect admission only, never extension success artifacts. */
  observeHostCompaction(ctx: ExtensionContext, entry: { id?: string }, allowPauseReset = true): void {
    if (!this.isOwner(ctx) || !entry.id) return;
    const alreadyObserved = entry.id === this.admissionCompactionId;
    try {
      const newest = ctx.sessionManager.getBranch().filter((item) => item.type === "compaction").at(-1);
      if (!newest || newest.id !== entry.id) return;
      const time = Date.parse(newest.timestamp);
      // Reset only on a provable active journal commit, never a mismatched event.
      const trustedNewest = this.trustedBranch(ctx).findLast((item) => item.type === "compaction");
      if (allowPauseReset && trustedNewest?.id === entry.id && isDeepStrictEqual(trustedNewest, entry)
        && !((trustedNewest.details as Record<string, unknown> | undefined)?.compactor === "dc-distill"
          && (trustedNewest.details as Record<string, unknown> | undefined)?.version === 14)
        && Number.isFinite(time) && time >= 0 && time <= this.clock()) this.compilerPause = null;
      if (alreadyObserved) return;
      this.startupCooldownExempt = false;
      this.admissionCompactionId = entry.id;
      this.monitor.restoreCompaction(Number.isFinite(time) && time >= 0 && time <= this.clock() ? time : this.clock());
    } catch {
      // A committed journal that cannot be inspected cannot preserve a startup exemption.
      if (alreadyObserved) return;
      this.startupCooldownExempt = false;
      this.admissionCompactionId = entry.id;
      this.monitor.restoreCompaction(this.clock());
    }
  }
  refreshSettings(ctx: ExtensionContext): boolean {
    try {
      this.compactionSettings = this.options.loadCompactionSettings?.(ctx.cwd)
        ?? resolvePiCompactionSettings(this.pi.getSettings(), ctx.model);
      this.compactionSettings = { ...this.compactionSettings, keepRecentTokens: this.compactionSettings.keepRecentTokens === undefined ? 20_000 : this.compactionSettings.keepRecentTokens };
      // Injected settings obey the same effective contract as host snapshots.
      if (typeof this.compactionSettings.enabled !== "boolean"
        || !Number.isSafeInteger(this.compactionSettings.reserveTokens)
        || this.compactionSettings.reserveTokens < 0
        || !Number.isSafeInteger(this.compactionSettings.keepRecentTokens)
        || this.compactionSettings.keepRecentTokens! < 0) throw new Error("Invalid effective compaction settings");
      this.settingsValid = true;
      this.settingsError = null;
      if (this.compilerPause && (this.compilerPause.ticket.settings.enabled !== this.compactionSettings.enabled
        || this.compilerPause.ticket.settings.reserveTokens !== this.compactionSettings.reserveTokens
        || this.compilerPause.ticket.settings.keepRecentTokens !== this.compactionSettings.keepRecentTokens)) this.compilerPause = null;
    } catch (error) {
      this.settingsValid = false;
      try { this.settingsError = error instanceof Error ? error.message : String(error); }
      catch { this.settingsError = "unreportable settings error"; }
      this.compactionSettings = { ...DEFAULT_PI_COMPACTION_SETTINGS, enabled: false };
    }
    return this.settingsValid;
  }
  get activeAttempt(): AttemptTicket | null { return this.ticket; }
  get commitInFlight(): boolean { return this.committing; }
  get inFlight(): boolean { return this.ticket !== null; }
  requestAttempt(ctx: ExtensionContext): AttemptTicket | null {
    const lease = this.lease(ctx);
    if (!lease || this.ticket || this.compilerPause) return null;
    this.ticket = this.createTicket(lease, ctx, true);
    this.monitor.state.lastCompactionTime = this.clock();
    return this.ticket;
  }
  beginPreparation(ctx: ExtensionContext): AttemptTicket | null {
    const lease = this.lease(ctx);
    if (!lease || this.preparing || this.preparationCancelled || this.committing) return null;
    this.refreshSettings(ctx);
    this.ticket ??= this.createTicket(lease, ctx, false);
    this.preparing = true;
    return this.ticket;
  }
  private createTicket(lease: SessionLease, ctx: ExtensionContext, autonomous: boolean): AttemptTicket {
    let branchAnchor: string | null = null;
    try { branchAnchor = ctx.sessionManager.getBranch().at(-1)?.id ?? null; } catch { /* Unknown branch stays explicit. */ }
    return Object.freeze({ identity: Symbol("distill-attempt"), lease, autonomous, attemptId: randomUUID(),
      contextRevision: this.contextRevision, branchAnchor,
      modelIdentity: this.modelIdentity(ctx), settings: Object.freeze({ ...this.compactionSettings }) });
  }
  private modelIdentity(ctx: ExtensionContext): string {
    return JSON.stringify([ctx.model?.provider, ctx.model?.id, ctx.model?.contextWindow]);
  }
  /** A terminal callback can still release a cancelled reservation; cancellation itself cannot. */
  cancelPreparation(ticket: AttemptTicket): void {
    if (this.ticket === ticket) this.preparationCancelled = true;
  }
  /** Whether the active attempt cancelled its own preparation, so no result can commit. */
  hasCancelledPreparation(): boolean {
    return this.ticket !== null && this.preparing && this.preparationCancelled;
  }
  snapshotMatches(ticket: AttemptTicket, ctx: ExtensionContext, checkBranch = true): boolean {
    if (!this.ownsAttempt(ticket, ctx) || ticket.contextRevision !== this.contextRevision
      || ticket.modelIdentity !== this.modelIdentity(ctx)) return false;
    this.refreshSettings(ctx);
    if (ticket.settings.enabled !== this.compactionSettings.enabled
      || ticket.settings.reserveTokens !== this.compactionSettings.reserveTokens
      || ticket.settings.keepRecentTokens !== this.compactionSettings.keepRecentTokens) return false;
    if (!checkBranch) return true;
    try { return ticket.branchAnchor === (ctx.sessionManager.getBranch().at(-1)?.id ?? null); }
    catch { return false; }
  }
  ownsAttempt(ticket: AttemptTicket, ctx: ExtensionContext): boolean {
    return this.ticket === ticket && this.isCurrent(ticket.lease, ctx);
  }
  /** Arm before cancellation/reporting; only still-owned local compiler failures count. */
  pauseCompilerFailure(ticket: AttemptTicket, ctx: ExtensionContext, stage: CompilerFailureStage, code: CompilerFailureCode,
    contextWindow = this.contextWindow): boolean {
    if (!ticket.autonomous || !this.snapshotMatches(ticket, ctx) || this.compilerPause) return false;
    this.compilerPause = Object.freeze({ ticket, contextWindow, stage, code });
    try { this.monitor.diagnostic(`compiler-paused attempt=${ticket.attemptId} generation=${ticket.lease.generation} stage=${stage} code=${code}`); }
    catch { /* Reporting must not disable the pause. */ }
    return true;
  }
  hasCompilerPause(): boolean { return this.compilerPause !== null; }
  failedCompilerAttempt(ticket: AttemptTicket): boolean { return this.compilerPause?.ticket === ticket; }
  clearCompilerPauseAfterCommit(ctx: ExtensionContext, entryId: string | undefined): void {
    if (!this.isOwner(ctx) || !entryId) return;
    try {
      const newest = this.trustedBranch(ctx).findLast((entry) => entry.type === "compaction");
      if (newest?.id === entryId) this.compilerPause = null;
    } catch { /* Unprovable commit cannot clear failure admission. */ }
  }
  private trustedBranch(ctx: ExtensionContext): SessionEntry[] {
    const branch = ctx.sessionManager.getBranch().slice();
    const ids = new Set<string>();
    let parent: string | null = null;
    for (const entry of branch) {
      if (!entry.id || ids.has(entry.id) || (entry.parentId ?? null) !== parent) throw new Error("Untrusted branch lineage");
      ids.add(entry.id);
      parent = entry.id;
    }
    return branch;
  }
  beginCommit(ticket: AttemptTicket, ctx: ExtensionContext): boolean {
    return this.beginCommitOutcome(ticket, ctx).accepted;
  }
  beginCommitOutcome(ticket: AttemptTicket, ctx: ExtensionContext): CommitOutcome {
    try {
      if (!this.ownsAttempt(ticket, ctx)) return { accepted: false, reason: "unowned-attempt" };
      if (this.committing) return { accepted: false, reason: "commit-in-flight" };
      if (this.preparationCancelled) return { accepted: false, reason: "preparation-cancelled" };
      if (ticket.contextRevision !== this.contextRevision) return { accepted: false, reason: "context-revision-changed" };
      if (ticket.modelIdentity !== this.modelIdentity(ctx)) return { accepted: false, reason: "model-changed" };
      this.refreshSettings(ctx);
      if (ticket.settings.enabled !== this.compactionSettings.enabled
        || ticket.settings.reserveTokens !== this.compactionSettings.reserveTokens
        || ticket.settings.keepRecentTokens !== this.compactionSettings.keepRecentTokens) return { accepted: false, reason: "settings-changed" };
      this.committing = true;
      return { accepted: true };
    } catch { return { accepted: false, reason: "snapshot-unavailable" }; }
  }
  finishAttempt(ticket: AttemptTicket | null): boolean {
    if (ticket === null || this.ticket !== ticket) return false;
    this.ticket = null;
    this.preparing = false;
    this.preparationCancelled = false;
    this.committing = false;
    this.diagnosticKey = null;
    return true;
  }
  snapshotAttemptMetrics() {
    const state = this.monitor.state;
    return Object.freeze({ apiTokensBefore: state.apiTokenCount, exchangesBefore: state.exchangeCount,
      callsBefore: state.callCount, toolTokensBefore: state.toolTokens, idleS: Math.round(this.monitor.idleMs / 1000) });
  }
  recordCommittedCompaction(tokensAfter: number, entryId?: string): void {
    this.startupCooldownExempt = false;
    this.admissionCompactionId = entryId ?? this.admissionCompactionId;
    this.monitor.recordCompaction(tokensAfter);
  }

  private observeUsage(ctx: ExtensionContext): boolean {
    try {
      const usage = ctx.getContextUsage();
      const tokens = usage?.tokens;
      const synced = this.monitor.syncFromPi(tokens);
      this.sampleStatus = synced ? "finite-positive"
        : tokens == null ? "unavailable" : "invalid";
      this.contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? this.contextWindow;
      if (this.compilerPause && typeof this.contextWindow === "number" && Number.isFinite(this.contextWindow)
        && this.contextWindow > 0 && this.contextWindow !== this.compilerPause.contextWindow) this.compilerPause = null;
      return synced;
    } catch {
      this.sampleStatus = "thrown";
      this.contextWindow = ctx.model?.contextWindow ?? this.contextWindow;
      return false;
    }
  }
  /** Host-only fresh sampling: no admission, warmup, warning or cooldown effects. */
  samplePostCompaction(ctx: ExtensionContext): boolean {
    if (!this.isOwner(ctx)) return false;
    if (this.admissionModel !== this.modelIdentity(ctx)) this.admissionContextChanged(ctx);
    this.refreshSettings(ctx);
    const options = { contextWindow: ctx.model?.contextWindow ?? this.contextWindow, compaction: this.compactionSettings };
    if (!this.settingsValid || !this.compactionSettings.enabled || this.inFlight
      || validateTriggerGeometry(options).length > 0) return false;
    if (!this.observeUsage(ctx)) return false;
    const sampledOptions = { ...options, contextWindow: this.contextWindow };
    if (validateTriggerGeometry(sampledOptions).length > 0) return false;
    if (!this.monitor.state.awaitingPostCompactionSample) return true;
    const auto = resolveTriggerThresholds(sampledOptions).auto.effective;
    const aboveAuto = this.monitor.state.tokenEstimate >= auto;
    this.monitor.state.awaitingPostCompactionSample = false;
    this.monitor.state.repeatBaselineTokens = aboveAuto ? this.monitor.state.tokenEstimate : null;
    this.monitor.state.missedAuto = aboveAuto;
    return true;
  }
  ignoreTurn(ctx: ExtensionContext, turnId: string): void {
    if (this.isOwner(ctx) && turnId) this.assessedTurnId = turnId;
  }
  /** Native input supersedes admission for the preceding assistant turn. */
  ignoreSettledTurn(ctx: ExtensionContext): void {
    if (!this.isOwner(ctx)) return;
    try {
      const latest = ctx.sessionManager.getBranch().findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
      if (latest) this.assessedTurnId = latest.id;
    } catch { /* Unavailable journal has no usable turn identity. */ }
  }
  shouldAssessSettled(ctx: ExtensionContext): boolean {
    if (!this.isOwner(ctx)) return false;
    try {
      const latest = ctx.sessionManager.getBranch().findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
      if (latest?.type === "message" && latest.message.role === "assistant") {
        if (latest.message.stopReason === "error" || latest.message.stopReason === "aborted") return false;
        if (latest.id === this.assessedTurnId) return false;
        this.assessedTurnId = latest.id;
      }
      // A queued native input or continuation owns the next run. Consume this
      // settlement identity so a duplicate cannot submit after the queue drains.
      return !ctx.hasPendingMessages();
    } catch { return false; }
  }
  assess(ctx: ExtensionContext): CompactEvaluation | null {
    if (!this.isOwner(ctx)) return null;
    if (this.admissionModel !== this.modelIdentity(ctx)) this.admissionContextChanged(ctx);
    this.refreshSettings(ctx);
    const synced = this.observeUsage(ctx);
    const options = { contextWindow: this.contextWindow, compaction: this.compactionSettings,
      skipStartupCooldown: this.startupCooldownExempt && synced };
    const thresholds = resolveTriggerThresholds(options);
    const block = (reason: string): null => { this.logBlock(ctx, reason, thresholds); return null; };
    if (!this.settingsValid) return block("invalid-settings");
    if (!this.compactionSettings.enabled) return block("disabled");
    if (validateTriggerGeometry(options).length > 0) return block("invalid-geometry");
    if (this.inFlight) return block("in-flight");
    const tokens = this.monitor.state.tokenEstimate;
    const urgent = Number.isFinite(tokens) && tokens >= thresholds.headroomFloor.effective;
    if (!urgent && this.warmupTurnsRemaining > 0) {
      this.warmupTurnsRemaining--;
      return block("warmup");
    }
    const { updates, ...evaluation } = assessCompaction(this.monitor.state, synced, options, this.clock());
    if (evaluation.decision?.tier === Tier.Mechanical && this.compilerPause) {
      // Preserve pursuit intent rather than consuming it on a blocked decision.
      return block("compiler-paused");
    }
    Object.assign(this.monitor.state, updates);
    if (!evaluation.decision) {
      if (evaluation.blockedBy === "below-auto") this.diagnosticKey = null;
      else if (evaluation.blockedBy) block(evaluation.blockedBy);
      return evaluation;
    }
    if (evaluation.decision.tier === Tier.Warn) {
      if (this.clock() - this.lastWarnTime < 120_000) return block("warning-cooldown");
      this.lastWarnTime = this.clock();
    }
    this.diagnosticKey = null;
    this.logDecided(ctx, evaluation);
    return evaluation;
  }
  private logDecided(ctx: ExtensionContext, evaluation: CompactEvaluation): void {
    try {
      const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";
      const decision = evaluation.decision;
      const tier = decision ? Tier[decision.tier] : "unknown";
      const reason = decision?.reason ?? "unknown";
      const line = ["auto-check decided",
        `tier=${tier}`,
        `reason=${reason}`,
        "source=agent_settled", `policy=v${TRIGGER_POLICY_VERSION}`, `model=${model}`,
        `session=${diagnosticSessionLabel(this.ownerSessionId)}`, `pid=${process.pid}`,
        `tokens=${this.monitor.state.tokenEstimate}`,
      ].join(" ");
      // Burst dedup: suppress consecutive identical decided lines within 5s,
      // then emit one (×N) summary when the burst ends (key change, window
      // expiry, or the next blocked line). Diagnostics are best effort.
      const key = JSON.stringify([tier, reason, model, "agent_settled", this.contextWindow, TRIGGER_POLICY_VERSION,
        Object.entries(evaluation.thresholds).map(([band, value]) => `${band}=${value.effective}`)]);
      const now = this.clock();
      if (this.decidedBurst && this.decidedBurst.key === key && now - this.decidedBurst.firstAt < 5_000) {
        this.decidedBurst.count++;
        return;
      }
      this.flushDecidedBurst();
      this.monitor.diagnostic(line);
      this.decidedBurst = { key, line, count: 1, firstAt: now };
    } catch { /* Diagnostics cannot interrupt policy. */ }
  }
  /** Emit the (×N) summary for a suppressed decided-line burst, if any. */
  private flushDecidedBurst(): void {
    const burst = this.decidedBurst;
    this.decidedBurst = null;
    if (burst && burst.count > 1) {
      try { this.monitor.diagnostic(`${burst.line.replace(/^auto-check decided/, `auto-check decided (×${burst.count})`)}`); }
      catch { /* Diagnostics cannot interrupt policy. */ }
    }
  }
  private logBlock(ctx: ExtensionContext, reason: string, thresholds: CompactEvaluation["thresholds"]): void {
    try {
    this.flushDecidedBurst();
    const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";
    const key = JSON.stringify([reason, model, "agent_settled", this.compactionSettings, this.settingsError,
      this.contextWindow, thresholds, this.sampleStatus]);
    if (key === this.diagnosticKey) return;
    this.diagnosticKey = key;
    try { this.monitor.diagnostic(["auto-check blocked", `reason=${reason}`, "source=agent_settled",
      `session=${diagnosticSessionLabel(this.ownerSessionId)}`, `pid=${process.pid}`,
      `model=${model}`, `enabled=${this.compactionSettings.enabled}`,
      `reserveTokens=${this.compactionSettings.reserveTokens}`, `sample=${this.sampleStatus}`,
      `contextWindow=${this.contextWindow ?? "unknown"}`, `tokens=${this.monitor.state.tokenEstimate}`,
      ...Object.entries(thresholds).map(([band, value]) => `${band}=${value.effective} ${band}Source=${value.source}`),
      this.settingsError ? `error=${this.settingsError}` : "",
    ].filter(Boolean).join(" ")); } catch { /* Diagnostics cannot interrupt policy. */ }
    } catch { /* Formatting is also a diagnostic effect and must be total. */ }
  }
}
