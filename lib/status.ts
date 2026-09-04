import { join } from "node:path";
import { Path } from "#shrink-framework";
import { DEFAULT_SHRINK_SETTINGS, type ShrinkSettings } from "./settings.ts";
import {
  resolveTriggerThresholds,
  type ResolvedThreshold,
} from "./trigger.ts";
import type { CompactState } from "./types.ts";

export interface ShrinkStatusInput {
  state: CompactState;
  inFlight: boolean;
  warmupTurnsRemaining: number;
  hasPiSynced: boolean;
  pendingMetric: string | null;
  lastEcho: string | null;
  settings?: ShrinkSettings;
  compactorAvailable?: boolean;
  lastFailure?: string | null;
  contextWindow?: number;
  now?: number;
}

function formatTokens(tokens: number): string {
  return Math.round(tokens).toLocaleString();
}

export function formatShrinkStatus(input: ShrinkStatusInput): string {
  const now = input.now ?? Date.now();
  const cooldownMs = input.settings?.cacheTtlMs ?? DEFAULT_SHRINK_SETTINGS.cacheTtlMs;
  const settings = input.settings ?? DEFAULT_SHRINK_SETTINGS;
  const thresholds = resolveTriggerThresholds({
    autoThresholdTokens: settings.autoThresholdTokens,
    warnThresholdTokens: settings.warnThresholdTokens,
    emergencyThresholdTokens: settings.emergencyThresholdTokens,
    autoThresholdPct: settings.autoThresholdPct,
    warnThresholdPct: settings.warnThresholdPct,
    emergencyThresholdPct: settings.emergencyThresholdPct,
    contextWindow: input.contextWindow,
  });
  const cooldownRemaining = Math.max(
    0,
    cooldownMs - (now - input.state.lastCompactionTime),
  );
  const dataDir = Path.data("dc-shrink").path;

  const lines = [
    "shrink status",
    `  Tokens: ${formatTokens(input.state.tokenEstimate)} estimated${input.hasPiSynced ? " (pi-synced)" : " (local estimate)"}`,
    `  API tokens: ${input.state.apiTokenCount ? formatTokens(input.state.apiTokenCount) : "unknown"}`,
    `  Tool tokens: ${formatTokens(input.state.toolTokens)}`,
    `  Calls since compact: ${input.state.callCount}`,
    `  User exchanges since compact: ${input.state.exchangeCount}`,
    `  Compactions this session: ${input.state.compactionCount}`,
    `  Cooldown: ${cooldownRemaining > 0 ? `${Math.ceil(cooldownRemaining / 1000)}s remaining` : "ready"}`,
    `  Configured cooldown: ${Math.ceil(cooldownMs / 1000)}s`,
    `  Auto threshold: ${formatThreshold(thresholds.auto, input.contextWindow)}`,
    `  Warn threshold: ${formatThreshold(thresholds.warn, input.contextWindow)}`,
    `  Emergency threshold: ${formatThreshold(thresholds.emergency, input.contextWindow)}`,
    `  Compactor: ${input.compactorAvailable === false ? "unavailable" : "local TypeScript"}`,
    `  Dumps: ${formatDumpStatus(input.settings)}`,
    `  In flight: ${input.inFlight ? "yes" : "no"}`,
    `  Warmup turns remaining: ${input.warmupTurnsRemaining}`,
  ];

  if (input.state.repeatBaselineTokens !== null) {
    lines.push(`  Repeat baseline: ${formatTokens(input.state.repeatBaselineTokens)} tokens`);
  }
  if (input.pendingMetric) {
    lines.push(`  Pending metric: ${input.pendingMetric}`);
  }
  if (input.lastFailure) {
    lines.push(`  Last failure: ${input.lastFailure}`);
  }
  if (input.lastEcho) {
    lines.push("  Last focus echo:");
    for (const line of input.lastEcho.split("\n")) lines.push(`    ${line}`);
  }

  lines.push(`  Log: ${join(dataDir, "compact-log.jsonl")}`);
  lines.push(`  Dump dir: ${join(dataDir, "compact-dumps")}`);
  return lines.join("\n");
}

function formatThreshold(
  threshold: ResolvedThreshold,
  contextWindow: number | undefined,
): string {
  const pct = `${Math.round(threshold.percentage * 100)}%`;
  if (threshold.percentageTokens === null) {
    return `${formatTokens(threshold.effective)} tokens (absolute ${formatTokens(threshold.absolute)}; ${pct} source unavailable without context window)`;
  }

  return `${formatTokens(threshold.effective)} tokens (${threshold.source}; absolute ${formatTokens(threshold.absolute)}, ${pct} of ${formatTokens(contextWindow!)} = ${formatTokens(threshold.percentageTokens)})`;
}

function formatDumpStatus(settings: ShrinkSettings | undefined): string {
  const effective = settings ?? DEFAULT_SHRINK_SETTINGS;
  if (!effective.dumpCompactions) return "disabled";
  return `enabled, retaining ${effective.dumpRetention}`;
}
