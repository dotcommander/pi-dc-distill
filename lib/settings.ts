import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Path } from "#shrink-framework";

export interface ShrinkSettings {
  cacheTtlMs: number;
  autoThresholdTokens: number;
  warnThresholdTokens: number;
  emergencyThresholdTokens: number;
  autoThresholdPct: number;
  warnThresholdPct: number;
  emergencyThresholdPct: number;
  dumpCompactions: boolean;
  dumpRetention: number;
}

export const DEFAULT_SHRINK_SETTINGS: ShrinkSettings = {
  cacheTtlMs: 120_000,
  autoThresholdTokens: 100_000,
  warnThresholdTokens: 140_000,
  emergencyThresholdTokens: 160_000,
  autoThresholdPct: 0.75,
  warnThresholdPct: 0.85,
  emergencyThresholdPct: 0.92,
  dumpCompactions: false,
  dumpRetention: 20,
};

const SETTINGS_FILE = "settings.json";
const AGENT_SETTINGS_FILE = join(homedir(), ".pi", "agent", "settings.json");
const MIN_CACHE_TTL_MS = 10_000;
const MAX_CACHE_TTL_MS = 3_600_000;
const MIN_AUTO_THRESHOLD_TOKENS = 10_000;
const MAX_AUTO_THRESHOLD_TOKENS = 160_000;
const MIN_WARN_THRESHOLD_TOKENS = 11_000;
const MAX_WARN_THRESHOLD_TOKENS = 320_000;
const MIN_EMERGENCY_THRESHOLD_TOKENS = 12_000;
const MAX_EMERGENCY_THRESHOLD_TOKENS = 500_000;
const MAX_DUMP_RETENTION = 500;
const MIN_AUTO_THRESHOLD_PCT = 0.5;
const MAX_AUTO_THRESHOLD_PCT = 0.95;
const MIN_WARN_THRESHOLD_PCT = 0.5;
const MAX_WARN_THRESHOLD_PCT = 0.97;
const MIN_EMERGENCY_THRESHOLD_PCT = 0.6;
const MAX_EMERGENCY_THRESHOLD_PCT = 0.98;

function numberInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function fractionInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeShrinkSettings(
  raw: unknown,
  fallback: ShrinkSettings = DEFAULT_SHRINK_SETTINGS,
): ShrinkSettings {
  const source =
    raw !== null && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : {};
  const autoThresholdPct = fractionInRange(
    source.autoThresholdPct,
    fallback.autoThresholdPct,
    MIN_AUTO_THRESHOLD_PCT,
    MAX_AUTO_THRESHOLD_PCT,
  );
  const warnThresholdPct = Math.min(
    MAX_WARN_THRESHOLD_PCT,
    Math.max(
      autoThresholdPct + 0.01,
      fractionInRange(
        source.warnThresholdPct,
        fallback.warnThresholdPct,
        MIN_WARN_THRESHOLD_PCT,
        MAX_WARN_THRESHOLD_PCT,
      ),
    ),
  );
  const autoThresholdTokens = numberInRange(
    source.autoThresholdTokens,
    fallback.autoThresholdTokens,
    MIN_AUTO_THRESHOLD_TOKENS,
    MAX_AUTO_THRESHOLD_TOKENS,
  );
  const warnThresholdTokens = Math.max(
    autoThresholdTokens + 1_000,
    numberInRange(
      source.warnThresholdTokens,
      fallback.warnThresholdTokens,
      MIN_WARN_THRESHOLD_TOKENS,
      MAX_WARN_THRESHOLD_TOKENS,
    ),
  );

  return {
    cacheTtlMs: numberInRange(
      source.cacheTtlMs,
      fallback.cacheTtlMs,
      MIN_CACHE_TTL_MS,
      MAX_CACHE_TTL_MS,
    ),
    autoThresholdTokens,
    warnThresholdTokens,
    emergencyThresholdTokens: Math.max(
      warnThresholdTokens + 1_000,
      numberInRange(
        source.emergencyThresholdTokens,
        fallback.emergencyThresholdTokens,
        MIN_EMERGENCY_THRESHOLD_TOKENS,
        MAX_EMERGENCY_THRESHOLD_TOKENS,
      ),
    ),
    autoThresholdPct,
    warnThresholdPct,
    emergencyThresholdPct: Math.min(
      MAX_EMERGENCY_THRESHOLD_PCT,
      Math.max(
        warnThresholdPct + 0.01,
        fractionInRange(
          source.emergencyThresholdPct,
          fallback.emergencyThresholdPct,
          MIN_EMERGENCY_THRESHOLD_PCT,
          MAX_EMERGENCY_THRESHOLD_PCT,
        ),
      ),
    ),
    dumpCompactions: booleanValue(
      source.dumpCompactions,
      fallback.dumpCompactions,
    ),
    dumpRetention: numberInRange(
      source.dumpRetention,
      fallback.dumpRetention,
      0,
      MAX_DUMP_RETENTION,
    ),
  };
}

export function mergeShrinkSettings(...sources: unknown[]): ShrinkSettings {
  return sources.reduce<ShrinkSettings>(
    (settings, source) => normalizeShrinkSettings(source, settings),
    DEFAULT_SHRINK_SETTINGS,
  );
}

function readAgentExtensionConfig(): unknown {
  try {
    if (!existsSync(AGENT_SETTINGS_FILE)) return {};
    const settings = JSON.parse(readFileSync(AGENT_SETTINGS_FILE, "utf8"));
    return settings?.extensionConfig?.["dc-shrink"] ?? {};
  } catch {
    return {};
  }
}

function readDataSettings(): unknown {
  try {
    return Path.data("dc-shrink").read(SETTINGS_FILE, {});
  } catch {
    return {};
  }
}

export function loadShrinkSettings(): ShrinkSettings {
  return mergeShrinkSettings(readAgentExtensionConfig(), readDataSettings());
}
