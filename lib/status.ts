import { join } from "node:path";
import { Path } from "#shrink-framework";
import {
  COMPACTION_COOLDOWN_MS,
  DEFAULT_PI_COMPACTION_SETTINGS,
  DUMP_RETENTION,
  dumpsEnabled,
  type PiCompactionSettings,
} from "./settings.ts";
import {
  resolveTriggerThresholds,
  SHRINK_LEAD_TOKENS,
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
  compaction?: PiCompactionSettings;
  dumpEnabled?: boolean;
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
  const compaction = input.compaction ?? DEFAULT_PI_COMPACTION_SETTINGS;
  const thresholds = resolveTriggerThresholds({
    compaction,
    contextWindow: input.contextWindow,
  });
  const cooldownRemaining = Math.max(
    0,
    COMPACTION_COOLDOWN_MS - (now - input.state.lastCompactionTime),
  );
  const dataDir = Path.data("dc-shrink").path;
  const dumpEnabled = input.dumpEnabled ?? dumpsEnabled();

  const lines = [
    "shrink status",
    `  Tokens: ${formatTokens(input.state.tokenEstimate)} estimated${input.hasPiSynced ? " (pi-synced)" : " (local estimate)"}`,
    `  API tokens: ${input.state.apiTokenCount ? formatTokens(input.state.apiTokenCount) : "unknown"}`,
    `  Tool tokens: ${formatTokens(input.state.toolTokens)}`,
    `  Calls since compact: ${input.state.callCount}`,
    `  User exchanges since compact: ${input.state.exchangeCount}`,
    `  Compactions this session: ${input.state.compactionCount}`,
    `  Pi auto-compaction: ${compaction.enabled ? "enabled" : "disabled (dc-shrink monitor standing down)"}`,
    `  Cooldown: ${cooldownRemaining > 0 ? `${Math.ceil(cooldownRemaining / 1000)}s remaining` : "ready"}`,
    `  Configured cooldown: ${Math.ceil(COMPACTION_COOLDOWN_MS / 1000)}s fixed`,
    `  Auto threshold: ${formatThreshold("auto", thresholds.auto, compaction, input.contextWindow)}`,
    `  Warn threshold: ${formatThreshold("warn", thresholds.warn, compaction, input.contextWindow)}`,
    `  Emergency threshold: ${formatThreshold("emergency", thresholds.emergency, compaction, input.contextWindow)}`,
    `  Compactor: ${input.compactorAvailable === false ? "unavailable" : "local TypeScript"}`,
    `  Dumps: ${dumpEnabled ? `enabled, retaining ${DUMP_RETENTION}` : "disabled (set DC_SHRINK_DUMPS=1)"}`,
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
  band: "auto" | "warn" | "emergency",
  threshold: ResolvedThreshold,
  compaction: PiCompactionSettings,
  contextWindow: number | undefined,
): string {
  if (threshold.source === "fallback") {
    return `${formatTokens(threshold.effective)} tokens (fallback; Pi context window unavailable)`;
  }

  const window = formatTokens(contextWindow!);
  if (band === "auto") {
    return `${formatTokens(threshold.effective)} tokens (Pi trigger: ${window} window − ${formatTokens(compaction.reserveTokens)} reserve − fixed ${formatTokens(SHRINK_LEAD_TOKENS)} lead)`;
  }
  if (band === "warn") {
    return `${formatTokens(threshold.effective)} tokens (Pi: ${window} window − ${formatTokens(compaction.reserveTokens)} reserve)`;
  }
  return `${formatTokens(threshold.effective)} tokens (Pi context window)`;
}
