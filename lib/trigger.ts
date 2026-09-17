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
export const AUTO_TARGET_TOKENS = 120_000;
/** dc-shrink stays at least this far before Pi's own automatic trigger. */
export const SHRINK_LEAD_TOKENS = 20_000;
/** Floors make Pi's reserve geometry usable on very small windows. */
const MIN_AUTO_THRESHOLD = 8_000;
const MIN_WARN_THRESHOLD = 4_000;

/**
 * Decide whether compaction should fire.
 *
 * Pi owns the native automatic trigger. dc-shrink prefers a fixed 120,000-token
 * autonomous boundary, capped lower when necessary to stay at least 20,000
 * tokens ahead of Pi's reserve-derived trigger. No extension settings are read.
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
  emergency: ResolvedThreshold;
}

export type CompactBlockReason =
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
      emergency: { effective: FALLBACK_EMERGENCY_THRESHOLD, source: "fallback" },
    };
  }

  const window = Math.max(1, Math.round(contextWindow));
  const reserve = Math.max(1, Math.round(options.compaction?.reserveTokens ?? 16_384));
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
    Math.max(autoFloor, piCompactThreshold - SHRINK_LEAD_TOKENS),
  );
  const auto = Math.min(AUTO_TARGET_TOKENS, geometryAuto);
  const warn = piCompactThreshold;

  return {
    auto: {
      effective: auto,
      source: auto < geometryAuto ? "policy-capped" : "pi-derived",
    },
    warn: { effective: warn, source: "pi-derived" },
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
  if (MIN_REPEAT_GROWTH < 0) {
    violations.push({
      field: "minRepeatGrowth",
      value: MIN_REPEAT_GROWTH,
      message: "minRepeatGrowth must be non-negative",
    });
  }

  return violations;
}

export function evaluateCompaction(
  state: CompactState,
  piSynced = true,
  options: TriggerOptions = {},
): CompactEvaluation {
  const thresholds = resolveTriggerThresholds(options);
  const blocked = (blockedBy: CompactBlockReason): CompactEvaluation => ({
    decision: null,
    blockedBy,
    thresholds,
  });
  const decided = (decision: CompactDecision): CompactEvaluation => ({
    decision,
    blockedBy: null,
    thresholds,
  });

  // Disabling Pi's auto-compaction also disables dc-shrink's monitor. Manual
  // /compact still reaches session_before_compact independently of this path.
  if (options.compaction?.enabled === false) return blocked("disabled");

  const cooldownMs = options.cooldownMs ?? COOLDOWN_MS;
  const effectiveAuto = thresholds.auto.effective;
  const effectiveWarn = thresholds.warn.effective;
  const effectiveEmergency = thresholds.emergency.effective;

  // Emergency: approaching Pi's hard context limit — fire regardless of
  // cooldown or sync status. This is the safety net that prevents overflow.
  if (state.tokenEstimate >= effectiveEmergency) {
    return decided({
      tier: Tier.Mechanical,
      reason: "emergency: approaching context limit",
    });
  }

  // If we couldn't sync with Pi's real token count, the monitor estimate is
  // inflated (~2.7x). Skip auto-threshold compaction to avoid premature fires.
  if (!piSynced) return blocked("missing-pi-sync");

  if (state.awaitingPostCompactionSample) {
    state.awaitingPostCompactionSample = false;
    state.repeatBaselineTokens =
      state.tokenEstimate >= effectiveAuto ? state.tokenEstimate : null;
    return blocked("post-compaction-sample");
  }

  if (state.tokenEstimate < effectiveAuto) {
    state.repeatBaselineTokens = null;
    return blocked("below-auto");
  }

  if (Date.now() - state.lastCompactionTime < cooldownMs) return blocked("cooldown");

  if (state.repeatBaselineTokens !== null) {
    const growth = state.tokenEstimate - state.repeatBaselineTokens;
    if (growth < MIN_REPEAT_GROWTH) return blocked("repeat-growth");
  }

  if (state.tokenEstimate >= effectiveWarn) {
    return decided({
      tier: Tier.Warn,
      reason: `warn: context exceeded ${formatCompactTokens(effectiveWarn)} tokens — finish current unit`,
    });
  }

  return decided({
    tier: Tier.Mechanical,
    reason: `auto: context exceeded ${formatCompactTokens(effectiveAuto)} tokens`,
  });
}

export function shouldCompact(
  state: CompactState,
  piSynced = true,
  options: TriggerOptions = {},
): CompactDecision | null {
  return evaluateCompaction(state, piSynced, options).decision;
}
