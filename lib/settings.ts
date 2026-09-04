import { LEGACY_DUMPS_ENV } from "./legacy.ts";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface PiCompactionSettings {
  enabled: boolean;
  reserveTokens: number;
}

export const DEFAULT_PI_COMPACTION_SETTINGS: PiCompactionSettings = {
  enabled: true,
  reserveTokens: 16_384,
};

/** Minimum gap between autonomous compactions. Pi has no equivalent setting. */
export const COMPACTION_COOLDOWN_MS = 120_000;
/** Raw-dump retention when DC_DISTILL_DUMPS enables diagnostic dumps. */
export const DUMP_RETENTION = 20;

const AGENT_SETTINGS_FILE = join(homedir(), ".pi", "agent", "settings.json");
const PROJECT_SETTINGS_FILE = ".pi/settings.json";

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function positiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.round(value));
}

/**
 * Pi deep-merges global and project settings. Preserve that merge shape for the
 * two compaction keys dc-distill reads without owning a parallel config.
 */
export function normalizePiCompactionSettings(
  raw: unknown,
  fallback: PiCompactionSettings = DEFAULT_PI_COMPACTION_SETTINGS,
): PiCompactionSettings {
  const compaction = asRecord(raw);
  return {
    enabled: typeof compaction.enabled === "boolean"
      ? compaction.enabled
      : fallback.enabled,
    reserveTokens: positiveInteger(compaction.reserveTokens, fallback.reserveTokens),
  };
}

export function mergePiCompactionSettings(...settingsFiles: unknown[]): PiCompactionSettings {
  return settingsFiles.reduce<PiCompactionSettings>(
    (settings, settingsFile) =>
      normalizePiCompactionSettings(asRecord(settingsFile).compaction, settings),
    DEFAULT_PI_COMPACTION_SETTINGS,
  );
}

function readSettingsFile(path: string): unknown {
  try {
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/** Read Pi's global settings followed by the current project's override file. */
export function loadPiCompactionSettings(cwd: string): PiCompactionSettings {
  return mergePiCompactionSettings(
    readSettingsFile(AGENT_SETTINGS_FILE),
    readSettingsFile(join(cwd, PROJECT_SETTINGS_FILE)),
  );
}

/** Raw dumps are diagnostic-only and intentionally require an explicit process opt-in. */
export function dumpsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ["1", "true", "yes"].includes((env.DC_DISTILL_DUMPS ?? env[LEGACY_DUMPS_ENV] ?? "").toLowerCase());
}
