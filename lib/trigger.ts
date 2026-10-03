import type { PiCompactionSettings } from "./settings.ts";
import type { CompactState, CompactDecision } from "./types.ts";
import { Tier } from "./types.ts";

/** Minimum gap between successive auto-compactions (ms). */
const COOLDOWN_MS = 120_000;
/** Minimum new context growth before repeating while still above threshold. */
const MIN_REPEAT_GROWTH = 4_000;
/** Fallbacks preserve safe triggering when an older Pi cannot expose its window. */
const FALLBACK_AUTO_THRESHOLD = 100_000;
const FALLBACK_WARN_THRESHOLD = 140_000;
const FALLBACK_EMERGENCY_THRESHOLD = 160_000;
/** Preferred autonomous boundary when Pi's own safety geometry allows it. */
export const TRIGGER_POLICY_VERSION = 2;
export const TRIGGER_POLICY_NAME = "distill-fixed-cap-lead";
export const AUTO_TARGET_TOKENS = 120_000;
/** dc-distill prefers this lead before Pi's own automatic trigger. */
export const DISTILL_LEAD_TOKENS = 20_000;
/**
 * Answer budget the headroom floor protects. pi-ai clamps every request to
 * min(maxTokens, window - input - PI_AI_SAFETY_MARGIN_TOKENS) with a floor of
 * 1, so past window - 20,480 the model cannot finish a unit and steering is
 * unsatisfiable. Emergency-grade: ordinary guards must not delay it.
 */
export const ANSWER_HEADROOM_TOKENS = 16_384;
/** pi-ai's request-build safety margin subtracted from the context window. */
export const PI_AI_SAFETY_MARGIN_TOKENS = 4_096;
/** Floors make Pi's reserve geometry usable on very small windows. */
const MIN_AUTO_THRESHOLD = 8_000;
const MIN_WARN_THRESHOLD = 4_000;

/**
 * Decide whether compaction should fire.
 *
 * Pi owns the native automatic trigger. dc-distill prefers a fixed 120,000-token
 * autonomous boundary, capped lower when necessary to stay at least 20,000
 * tokens ahead of Pi's reserve-derived trigger when small-window floors allow. No extension settings are read.
 */
export interface TriggerOptions {
  cooldownMs?: number;
  /** Active model context window reported by Pi. */
  contextWindow?: number;
  /** Pi's effective global + project compaction settings. */
  compaction?: PiCompactionSettings;
}

export interface TriggerGeometryViolation {
  field: string;
  message: string;
  value?: number;
}

export interface ResolvedThreshold {
  effective: number;
  source: "policy-capped" | "pi-derived" | "fallback";
}

export interface ResolvedTriggerThresholds {
  auto: ResolvedThreshold;
  warn: ResolvedThreshold;
  headroomFloor: ResolvedThreshold;
  emergency: ResolvedThreshold;
}

export type CompactBlockReason =
  | "invalid-geometry"
  | "invalid-estimate"
  | "disabled"
  | "missing-pi-sync"
  | "post-compaction-sample"
  | "below-auto"
  | "cooldown"
  | "repeat-growth";

export interface CompactEvaluation {
  decision: CompactDecision | null;
  blockedBy: CompactBlockReason | null;
  thresholds: ResolvedTriggerThresholds;
}

export function resolveTriggerThresholds(
  options: TriggerOptions = {},
): ResolvedTriggerThresholds {
  const contextWindow = options.contextWindow;
  if (!contextWindow || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return {
      auto: { effective: FALLBACK_AUTO_THRESHOLD, source: "fallback" },
      warn: { effective: FALLBACK_WARN_THRESHOLD, source: "fallback" },
      headroomFloor: {
        effective: Math.min(
          FALLBACK_EMERGENCY_THRESHOLD,
          Math.max(
            FALLBACK_WARN_THRESHOLD,
            FALLBACK_EMERGENCY_THRESHOLD - ANSWER_HEADROOM_TOKENS - PI_AI_SAFETY_MARGIN_TOKENS,
          ),
        ),
        source: "fallback",
      },
      emergency: { effective: FALLBACK_EMERGENCY_THRESHOLD, source: "fallback" },
    };
  }

  const window = Math.max(1, Math.round(contextWindow));
  const reserve = Math.max(0, Math.round(options.compaction?.reserveTokens ?? 16_384));
  const emergency = window;
  const warnFloor = Math.min(MIN_WARN_THRESHOLD, Math.max(0, emergency - 1));
  // This is Pi's native automatic compaction threshold.
  const piCompactThreshold = Math.min(
    emergency - 1,
    Math.max(warnFloor, window - reserve),
  );
  const autoFloor = Math.min(MIN_AUTO_THRESHOLD, Math.max(0, piCompactThreshold - 1));
  const geometryAuto = Math.min(
    piCompactThreshold - 1,
    Math.max(autoFloor, piCompactThreshold - DISTILL_LEAD_TOKENS),
  );
  const auto = Math.min(AUTO_TARGET_TOKENS, geometryAuto);
  const warn = piCompactThreshold;
  const headroomFloor = Math.min(
    emergency,
    Math.max(warn, window - ANSWER_HEADROOM_TOKENS - PI_AI_SAFETY_MARGIN_TOKENS),
  );

  return {
    auto: {
      effective: auto,
      source: auto < geometryAuto ? "policy-capped" : "pi-derived",
    },
    warn: { effective: warn, source: "pi-derived" },
    headroomFloor: { effective: headroomFloor, source: "pi-derived" },
    emergency: { effective: emergency, source: "pi-derived" },
  };
}

function formatCompactTokens(tokens: number): string {
  return tokens % 1_000 === 0 ? `${tokens / 1_000}k` : tokens.toLocaleString();
}

export function validateTriggerGeometry(
  options: TriggerOptions = {},
): TriggerGeometryViolation[] {
  const cooldownMs = options.cooldownMs ?? COOLDOWN_MS;
  const violations: TriggerGeometryViolation[] = [];

  for (const [field, value] of [
    ["cooldownMs", cooldownMs],
    ["contextWindow", options.contextWindow],
  ] as const) {
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value < 0) {
      violations.push({
        field,
        value,
        message: `${field} must be a finite non-negative number`,
      });
    }
  }

  const thresholds = resolveTriggerThresholds(options);
  for (const [band, threshold] of Object.entries(thresholds)) {
    if (!Number.isFinite(threshold.effective) || threshold.effective <= 0) {
      violations.push({ field: `${band}Threshold`, value: threshold.effective,
        message: `effective ${band} threshold must be finite and positive` });
    }
  }
  if (options.contextWindow !== undefined && Number.isFinite(options.contextWindow) && options.contextWindow < 3) {
    violations.push({ field: "contextWindow", value: options.contextWindow,
      message: "autonomous admission requires a window of at least three tokens" });
  }
  if (thresholds.auto.effective >= thresholds.warn.effective) {
    violations.push({
      field: "warnThreshold",
      value: thresholds.warn.effective,
      message: `effective warn threshold (${thresholds.warn.effective}) must be above effective auto threshold (${thresholds.auto.effective})`,
    });
  }
  if (thresholds.warn.effective >= thresholds.emergency.effective) {
    violations.push({
      field: "emergencyThreshold",
      value: thresholds.emergency.effective,
      message: `effective emergency threshold (${thresholds.emergency.effective}) must be above effective warn threshold (${thresholds.warn.effective})`,
    });
  }
  if (thresholds.headroomFloor.effective < thresholds.warn.effective) {
    violations.push({
      field: "headroomFloorThreshold",
      value: thresholds.headroomFloor.effective,
      message: `effective headroom floor (${thresholds.headroomFloor.effective}) must not be below effective warn threshold (${thresholds.warn.effective})`,
    });
  }
  if (thresholds.headroomFloor.effective > thresholds.emergency.effective) {
    violations.push({
      field: "headroomFloorThreshold",
      value: thresholds.headroomFloor.effective,
      message: `effective headroom floor (${thresholds.headroomFloor.effective}) must not exceed effective emergency threshold (${thresholds.emergency.effective})`,
    });
  }
  if (MIN_REPEAT_GROWTH < 0) {
    violations.push({
      field: "minRepeatGrowth",
      value: MIN_REPEAT_GROWTH,
      message: "minRepeatGrowth must be non-negative",
    });
  }

  return violations;
}

export interface CompactionAssessment extends CompactEvaluation {
  updates: Partial<
    Pick<CompactState, "awaitingPostCompactionSample" | "repeatBaselineTokens" | "missedAuto">
  >;
}

/** Pure assessment: callers explicitly apply returned state updates. */
export function assessCompaction(
  state: Readonly<CompactState>,
  piSynced: boolean,
  options: TriggerOptions,
  now: number,
): CompactionAssessment {
  const thresholds = resolveTriggerThresholds(options);
  const updates: CompactionAssessment["updates"] = {};
  const blocked = (blockedBy: CompactBlockReason): CompactionAssessment => ({
    updates,
    decision: null,
    blockedBy,
    thresholds,
  });
  const decided = (decision: CompactDecision): CompactionAssessment => ({
    updates,
    decision,
    blockedBy: null,
    thresholds,
  });

  // Disabling Pi's auto-compaction also disables dc-distill's monitor. Manual
  // /compact still reaches session_before_compact independently of this path.
  if (options.compaction?.enabled === false) return blocked("disabled");
  if (validateTriggerGeometry(options).length > 0) return blocked("invalid-geometry");

  if (!Number.isFinite(state.tokenEstimate) || state.tokenEstimate < 0) return blocked("invalid-estimate");

  const cooldownMs = options.cooldownMs ?? COOLDOWN_MS;
  const effectiveAuto = thresholds.auto.effective;
  const effectiveWarn = thresholds.warn.effective;
  const effectiveHeadroomFloor = thresholds.headroomFloor.effective;
  const effectiveEmergency = thresholds.emergency.effective;

  // Emergency: approaching Pi's hard context limit — fire regardless of
  // cooldown or sync status. This is the safety net that prevents overflow.
  if (state.tokenEstimate >= effectiveEmergency) {
    return decided({
      tier: Tier.Mechanical,
      reason: "emergency: approaching context limit",
    });
  }

  // Headroom floor: past this line pi-ai's request clamp leaves less than
  // ANSWER_HEADROOM_TOKENS of answer budget and steering cannot finish a unit.
  // Emergency-grade guard bypass; an unsynced estimate only inflates ~2.7x,
  // which fires this earlier — same parity as emergency.
  if (state.tokenEstimate >= effectiveHeadroomFloor) {
    return decided({
      tier: Tier.Mechanical,
      reason: "headroom-floor: answer headroom exhausted — compact now",
    });
  }

  // If we couldn't sync with Pi's real token count, the monitor estimate is
  // inflated (~2.7x). Skip auto-threshold compaction to avoid premature fires.
  if (!piSynced) {
    if (state.tokenEstimate >= effectiveAuto) updates.missedAuto = true;
    return blocked("missing-pi-sync");
  }

  if (state.awaitingPostCompactionSample) {
    updates.awaitingPostCompactionSample = false;
    updates.repeatBaselineTokens =
      state.tokenEstimate >= effectiveAuto ? state.tokenEstimate : null;
    updates.missedAuto = state.tokenEstimate >= effectiveAuto;
    return blocked("post-compaction-sample");
  }

  if (state.tokenEstimate < effectiveAuto) {
    updates.repeatBaselineTokens = null;
    updates.missedAuto = false;
    return blocked("below-auto");
  }

  if (now - state.lastCompactionTime < cooldownMs) {
    // Estimate is at or above auto here; the window is missed while blocked.
    updates.missedAuto = true;
    return blocked("cooldown");
  }

  if (state.repeatBaselineTokens !== null) {
    const growth = state.tokenEstimate - state.repeatBaselineTokens;
    if (growth < MIN_REPEAT_GROWTH) {
      updates.missedAuto = true;
      return blocked("repeat-growth");
    }
  }

  if (state.tokenEstimate >= effectiveWarn) {
    if (state.missedAuto) {
      // The auto window was missed while blocked; steering cannot recover it.
      updates.missedAuto = false;
      return decided({
        tier: Tier.Mechanical,
        reason: "missed-auto-pursuit: auto window missed — compact now",
      });
    }
    return decided({
      tier: Tier.Warn,
      reason: `warn: context exceeded ${formatCompactTokens(effectiveWarn)} tokens — finish current unit`,
    });
  }

  updates.missedAuto = false;
  return decided({
    tier: Tier.Mechanical,
    reason: `auto: context exceeded ${formatCompactTokens(effectiveAuto)} tokens`,
  });
}

/** Compatibility wrapper retains the historical state-update contract. */
export function evaluateCompaction(
  state: CompactState,
  piSynced = true,
  options: TriggerOptions = {},
): CompactEvaluation {
  const { updates, ...evaluation } = assessCompaction(state, piSynced, options, Date.now());
  Object.assign(state, updates);
  return evaluation;
}

export function shouldCompact(
  state: CompactState,
  piSynced = true,
  options: TriggerOptions = {},
): CompactDecision | null {
  return evaluateCompaction(state, piSynced, options).decision;
}
