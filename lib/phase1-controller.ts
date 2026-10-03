import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "./sdk.ts";
import type { CompactionCardDedupeHandle } from "./compaction-card-dedupe.ts";
import { Monitor } from "./monitor.ts";
import {
  DEFAULT_PI_COMPACTION_SETTINGS, DEFAULT_DISTILL_FEATURE_SETTINGS,
  resolvePiCompactionSettings, resolveDistillFeatureSettings,
  type PiCompactionSettings, type DistillFeatureSettings,
} from "./settings.ts";
import { TRIGGER_POLICY_VERSION, assessCompaction, resolveTriggerThresholds, type CompactEvaluation, validateTriggerGeometry } from "./trigger.ts";
import { Tier } from "./types.ts";

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
  private settingsValid = true;
  private settingsError: string | null = null;
  private sampleStatus: SampleStatus = "unavailable";
  private ticket: AttemptTicket | null = null;
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
    this.ticket = null;
    this.preparing = false;
    this.preparationCancelled = false;
    this.committing = false;
    this.monitor.reset();
    this.warmupTurnsRemaining = 1;
    this.lastWarnTime = 0;
    this.diagnosticKey = null;
    this.sampleStatus = "unavailable";
    this.contextWindow = ctx.model?.contextWindow;
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
    this.contextWindow = ctx.model?.contextWindow;
  }
  refreshSettings(ctx: ExtensionContext): boolean {
    try {
      this.compactionSettings = this.options.loadCompactionSettings?.(ctx.cwd)
        ?? resolvePiCompactionSettings(this.pi.getSettings(), ctx.model);
      // Injected settings obey the same effective contract as host snapshots.
      if (typeof this.compactionSettings.enabled !== "boolean"
        || !Number.isSafeInteger(this.compactionSettings.reserveTokens)
        || this.compactionSettings.reserveTokens < 0) throw new Error("Invalid effective compaction settings");
      this.settingsValid = true;
      this.settingsError = null;
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
    if (!lease || this.ticket) return null;
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
      || ticket.settings.reserveTokens !== this.compactionSettings.reserveTokens) return false;
    if (!checkBranch) return true;
    try { return ticket.branchAnchor === (ctx.sessionManager.getBranch().at(-1)?.id ?? null); }
    catch { return false; }
  }
  ownsAttempt(ticket: AttemptTicket, ctx: ExtensionContext): boolean {
    return this.ticket === ticket && this.isCurrent(ticket.lease, ctx);
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
        || ticket.settings.reserveTokens !== this.compactionSettings.reserveTokens) return { accepted: false, reason: "settings-changed" };
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
  recordCommittedCompaction(tokensAfter: number): void { this.monitor.recordCompaction(tokensAfter); }

  private observeUsage(ctx: ExtensionContext): boolean {
    try {
      const usage = ctx.getContextUsage();
      const tokens = usage?.tokens;
      const synced = this.monitor.syncFromPi(tokens);
      this.sampleStatus = synced ? "finite-positive"
        : tokens == null ? "unavailable" : "invalid";
      this.contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? this.contextWindow;
      return synced;
    } catch {
      this.sampleStatus = "thrown";
      this.contextWindow = ctx.model?.contextWindow ?? this.contextWindow;
      return false;
    }
  }
  assess(ctx: ExtensionContext): CompactEvaluation | null {
    if (!this.isOwner(ctx)) return null;
    this.refreshSettings(ctx);
    const synced = this.observeUsage(ctx);
    const options = { contextWindow: this.contextWindow, compaction: this.compactionSettings };
    const thresholds = resolveTriggerThresholds(options);
    const block = (reason: string): null => { this.logBlock(ctx, reason, thresholds); return null; };
    if (!this.settingsValid) return block("invalid-settings");
    if (!this.compactionSettings.enabled) return block("disabled");
    if (validateTriggerGeometry(options).length > 0) return block("invalid-geometry");
    if (this.inFlight) return block("in-flight");
    const tokens = this.monitor.state.tokenEstimate;
    const emergency = Number.isFinite(tokens) && tokens >= thresholds.emergency.effective;
    if (!emergency && this.warmupTurnsRemaining > 0) {
      this.warmupTurnsRemaining--;
      return block("warmup");
    }
    const { updates, ...evaluation } = assessCompaction(this.monitor.state, synced, options, this.clock());
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
      this.monitor.diagnostic(["auto-check decided",
        `tier=${decision ? Tier[decision.tier] : "unknown"}`,
        `reason=${decision?.reason ?? "unknown"}`,
        "source=agent_settled", `policy=v${TRIGGER_POLICY_VERSION}`, `model=${model}`,
        `tokens=${this.monitor.state.tokenEstimate}`,
      ].join(" "));
    } catch { /* Diagnostics cannot interrupt policy. */ }
  }
  private logBlock(ctx: ExtensionContext, reason: string, thresholds: CompactEvaluation["thresholds"]): void {
    try {
    const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";
    const key = JSON.stringify([reason, model, this.compactionSettings, this.settingsError,
      this.contextWindow, thresholds, this.sampleStatus]);
    if (key === this.diagnosticKey) return;
    this.diagnosticKey = key;
    try { this.monitor.diagnostic(["auto-check blocked", `reason=${reason}`, "source=agent_settled",
      `model=${model}`, `enabled=${this.compactionSettings.enabled}`,
      `reserveTokens=${this.compactionSettings.reserveTokens}`, `sample=${this.sampleStatus}`,
      `contextWindow=${this.contextWindow ?? "unknown"}`, `tokens=${this.monitor.state.tokenEstimate}`,
      ...Object.entries(thresholds).map(([band, value]) => `${band}=${value.effective} ${band}Source=${value.source}`),
      this.settingsError ? `error=${this.settingsError}` : "",
    ].filter(Boolean).join(" ")); } catch { /* Diagnostics cannot interrupt policy. */ }
    } catch { /* Formatting is also a diagnostic effect and must be total. */ }
  }
}
