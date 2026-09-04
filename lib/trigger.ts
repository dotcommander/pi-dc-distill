import type { CompactState, CompactDecision } from "./types.ts";
import { Tier } from "./types.ts";

/** Auto-compact when context exceeds this many estimated tokens by default. */
const DEFAULT_AUTO_THRESHOLD = 100_000;
/** Cooperative warning begins at this many tokens by default. */
const DEFAULT_WARN_THRESHOLD = 140_000;
/** Emergency: compact unconditionally regardless of cooldown. */
const DEFAULT_EMERGENCY_THRESHOLD = 160_000;
/** Minimum gap between successive auto-compactions (ms). */
const COOLDOWN_MS = 120_000;
/** Minimum new context growth before repeating while still above threshold. */
const MIN_REPEAT_GROWTH = 4_000;
/** Default fraction of context window for normal auto-compaction. */
const DEFAULT_AUTO_THRESHOLD_PCT = 0.75;
/** Default fraction of context window where the cooperative warn steer fires. */
const DEFAULT_WARN_THRESHOLD_PCT = 0.85;
/** Default fraction of context window for the emergency net. */
const DEFAULT_EMERGENCY_THRESHOLD_PCT = 0.92;

/**
 * Decide whether compaction should fire.
 *
 * Design: at the configured token threshold, auto-compact after cooldown only.
 * No idle-time, min-removable, or exchange-count guardrails —
 * the summary strategy + recall_compaction + dc-tasks interrupted-work
 * signaling handle seamless resumption.
 *
 * Infinite-loop safety (4 guards, evaluated per cycle):
 *   1. Latch (index.ts) — prevents concurrent compaction.
 *   2. Token estimate reset (monitor.recordCompaction) — sets tokenEstimate
 *      to summary size (~20k), so ~80k new tokens must accumulate.
 *   3. Post-compaction baseline — if usage remains above threshold after
 *      compaction, require MIN_REPEAT_GROWTH before repeating.
 *   4. Cooldown (COOLDOWN_MS) — 2 min minimum between successive compactions.
 */
export interface TriggerOptions {
  cooldownMs?: number;
  autoThresholdTokens?: number;
  warnThresholdTokens?: number;
  emergencyThresholdTokens?: number;
  /** Active model context window (tokens). When >0, thresholds become the
   *  smaller of the absolute cap and pct*contextWindow. */
  contextWindow?: number;
  autoThresholdPct?: number;
  warnThresholdPct?: number;
  emergencyThresholdPct?: number;
}

export interface TriggerGeometryViolation {
  field: string;
  message: string;
  value?: number;
}

export interface ResolvedThreshold {
  effective: number;
  absolute: number;
  percentage: number;
  percentageTokens: number | null;
  source: "absolute" | "percentage";
}

export interface ResolvedTriggerThresholds {
  auto: ResolvedThreshold;
  warn: ResolvedThreshold;
  emergency: ResolvedThreshold;
}

export function resolveTriggerThresholds(
  options: TriggerOptions = {},
): ResolvedTriggerThresholds {
  const contextWindow = options.contextWindow;
  return {
    auto: resolveThreshold(
      options.autoThresholdTokens ?? DEFAULT_AUTO_THRESHOLD,
      options.autoThresholdPct ?? DEFAULT_AUTO_THRESHOLD_PCT,
      contextWindow,
    ),
    warn: resolveThreshold(
      options.warnThresholdTokens ?? DEFAULT_WARN_THRESHOLD,
      options.warnThresholdPct ?? DEFAULT_WARN_THRESHOLD_PCT,
      contextWindow,
    ),
    emergency: resolveThreshold(
      options.emergencyThresholdTokens ?? DEFAULT_EMERGENCY_THRESHOLD,
      options.emergencyThresholdPct ?? DEFAULT_EMERGENCY_THRESHOLD_PCT,
      contextWindow,
    ),
  };
}

function formatCompactTokens(tokens: number): string {
  return tokens % 1_000 === 0 ? `${tokens / 1_000}k` : tokens.toLocaleString();
}

export function validateTriggerGeometry(
  options: TriggerOptions = {},
): TriggerGeometryViolation[] {
  const cooldownMs = options.cooldownMs ?? COOLDOWN_MS;
  const autoThresholdTokens =
    options.autoThresholdTokens ?? DEFAULT_AUTO_THRESHOLD;
  const warnThresholdTokens =
    options.warnThresholdTokens ?? DEFAULT_WARN_THRESHOLD;
  const emergencyThresholdTokens =
    options.emergencyThresholdTokens ?? DEFAULT_EMERGENCY_THRESHOLD;
  const autoThresholdPct =
    options.autoThresholdPct ?? DEFAULT_AUTO_THRESHOLD_PCT;
  const warnThresholdPct =
    options.warnThresholdPct ?? DEFAULT_WARN_THRESHOLD_PCT;
  const emergencyThresholdPct =
    options.emergencyThresholdPct ?? DEFAULT_EMERGENCY_THRESHOLD_PCT;
  const cw = options.contextWindow;
  const violations: TriggerGeometryViolation[] = [];

  for (const [field, value] of [
    ["cooldownMs", cooldownMs],
    ["autoThresholdTokens", autoThresholdTokens],
    ["warnThresholdTokens", warnThresholdTokens],
    ["emergencyThresholdTokens", emergencyThresholdTokens],
    ["autoThresholdPct", autoThresholdPct],
    ["warnThresholdPct", warnThresholdPct],
    ["emergencyThresholdPct", emergencyThresholdPct],
    ["contextWindow", cw],
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

  if (MIN_REPEAT_GROWTH < 0) {
    violations.push({
      field: "minRepeatGrowth",
      value: MIN_REPEAT_GROWTH,
      message: "minRepeatGrowth must be non-negative",
    });
  }

  const thresholds = resolveTriggerThresholds(options);
  const effectiveAuto = thresholds.auto.effective;
  const effectiveWarn = thresholds.warn.effective;
  const effectiveEmergency = thresholds.emergency.effective;

  if (effectiveAuto > effectiveWarn) {
    violations.push({
      field: "warnThreshold",
      value: effectiveWarn,
      message: `effective warn threshold (${effectiveWarn}) must be >= effective auto threshold (${effectiveAuto})`,
    });
  }
  if (effectiveWarn > effectiveEmergency) {
    violations.push({
      field: "emergencyThreshold",
      value: effectiveEmergency,
      message: `effective emergency threshold (${effectiveEmergency}) must be >= effective warn threshold (${effectiveWarn})`,
    });
  }

  return violations;
}

export function shouldCompact(
  state: CompactState,
  piSynced = true,
  options: TriggerOptions = {},
): CompactDecision | null {
  const cooldownMs = options.cooldownMs ?? COOLDOWN_MS;
  const thresholds = resolveTriggerThresholds(options);
  const effectiveAuto = thresholds.auto.effective;
  const effectiveWarn = thresholds.warn.effective;
  const effectiveEmergency = thresholds.emergency.effective;

  // Emergency: approaching hard context limit — fire regardless of cooldown
  // or sync status. This is the safety net that prevents context overflow.
  if (state.tokenEstimate >= effectiveEmergency) {
    return {
      tier: Tier.Mechanical,
      reason: "emergency: approaching context limit",
    };
  }

  // If we couldn't sync with pi's real token count, the monitor estimate
  // is inflated (~2.7x). Skip auto-threshold compaction to avoid premature
  // triggers. Emergency above still fires as a safety net.
  if (!piSynced) return null;

  if (state.awaitingPostCompactionSample) {
    state.awaitingPostCompactionSample = false;
    state.repeatBaselineTokens =
      state.tokenEstimate >= effectiveAuto ? state.tokenEstimate : null;
    return null;
  }

  // Below auto-threshold: nothing to do.
  if (state.tokenEstimate < effectiveAuto) {
    state.repeatBaselineTokens = null;
    return null;
  }

  // Cooldown: prevent rapid re-compaction after a recent compact.
  if (Date.now() - state.lastCompactionTime < cooldownMs) return null;

  if (state.repeatBaselineTokens !== null) {
    const growth = state.tokenEstimate - state.repeatBaselineTokens;
    if (growth < MIN_REPEAT_GROWTH) return null;
  }

  // Cooperative window: between the warn floor and the emergency net, steer the
  // agent to finish its atomic unit instead of compacting now. Force compaction
  // only fires at the emergency threshold (handled above).
  if (state.tokenEstimate >= effectiveWarn) {
    return {
      tier: Tier.Warn,
      reason: `warn: context exceeded ${formatCompactTokens(effectiveWarn)} tokens — finish current unit`,
    };
  }

  // Between auto and warn floors: auto-compact at the configured threshold.
  return {
    tier: Tier.Mechanical,
    reason: `auto: context exceeded ${formatCompactTokens(effectiveAuto)} tokens`,
  };
}

function resolveThreshold(
  absolute: number,
  thresholdPct: number,
  contextWindow?: number,
): ResolvedThreshold {
  if (!contextWindow || contextWindow <= 0) {
    return {
      effective: absolute,
      absolute,
      percentage: thresholdPct,
      percentageTokens: null,
      source: "absolute",
    };
  }

  const percentageTokens = Math.round(thresholdPct * contextWindow);
  return {
    effective: Math.min(absolute, percentageTokens),
    absolute,
    percentage: thresholdPct,
    percentageTokens,
    source: percentageTokens < absolute ? "percentage" : "absolute",
  };
}
