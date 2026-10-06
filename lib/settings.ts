import { LEGACY_DUMPS_ENV } from "./legacy.ts";

export interface PiCompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens?: number;
}

export const DEFAULT_PI_COMPACTION_SETTINGS: PiCompactionSettings = {
  enabled: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
};

/** Minimum gap between autonomous compactions. Pi has no equivalent setting. */
export const COMPACTION_COOLDOWN_MS = 120_000;
/** Raw-dump retention when DC_DISTILL_DUMPS enables diagnostic dumps. */
export const DUMP_RETENTION = 20;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

/** Resolve the host's merged snapshot using Pi 0.99.2 token-setting semantics. */
export function resolvePiCompactionSettings(
  settings: unknown,
  model?: { provider: string; id: string },
): PiCompactionSettings {
  const compaction = asRecord(asRecord(settings).compaction);
  const ordinary = compaction.reserveTokens;
  const validate = (value: unknown, field: string) => {
    if (value !== undefined && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`Invalid ${field}: expected a non-negative safe integer.`);
    }
  };
  validate(ordinary, "compaction.reserveTokens");
  validate(compaction.keepRecentTokens, "compaction.keepRecentTokens");
  const key = model ? `${model.provider}/${model.id}` : undefined;
  const entry = key === undefined ? undefined : asRecord(compaction.modelOverrides)[key];
  if (entry !== undefined && (entry === null || typeof entry !== "object" || Array.isArray(entry))) {
    throw new Error(`Invalid compaction.modelOverrides["${key}"]: expected an object.`);
  }
  const override = asRecord(entry).reserveTokens;
  validate(override, `compaction.modelOverrides["${key}"].reserveTokens`);
  validate(asRecord(entry).keepRecentTokens, `compaction.modelOverrides["${key}"].keepRecentTokens`);
  const enabled = compaction.enabled ?? true;
  if (typeof enabled !== "boolean") throw new Error("Invalid compaction.enabled: expected a boolean.");
  return { enabled, reserveTokens: (override ?? ordinary ?? 16_384) as number,
    keepRecentTokens: (asRecord(entry).keepRecentTokens ?? compaction.keepRecentTokens ?? 20_000) as number };
}

export function resolveDistillFeatureSettings(settings: unknown): DistillFeatureSettings {
  return normalizeDistillFeatureSettings(asRecord(asRecord(settings).extensionConfig)["dc-distill"]);
}

export interface DistillFeatureSettings {
  toolOutput: { enabled: boolean };
  recall: { enabled: boolean };
}

export const DEFAULT_DISTILL_FEATURE_SETTINGS: DistillFeatureSettings = {
  toolOutput: { enabled: false },
  recall: { enabled: false },
};

/** Normalize only explicit booleans; omitted or malformed leaves inherit. */
export function normalizeDistillFeatureSettings(
  raw: unknown,
  fallback: DistillFeatureSettings = DEFAULT_DISTILL_FEATURE_SETTINGS,
): DistillFeatureSettings {
  const features = asRecord(raw);
  const toolOutput = asRecord(features.toolOutput);
  const recall = asRecord(features.recall);
  return {
    toolOutput: {
      enabled: typeof toolOutput.enabled === "boolean"
        ? toolOutput.enabled : fallback.toolOutput.enabled,
    },
    recall: {
      enabled: typeof recall.enabled === "boolean"
        ? recall.enabled : fallback.recall.enabled,
    },
  };
}

/** Merge the extension's feature leaves from Pi global and project settings. */
export function mergeDistillFeatureSettings(...settingsFiles: unknown[]): DistillFeatureSettings {
  return settingsFiles.reduce<DistillFeatureSettings>((settings, settingsFile) => {
    const extensionConfig = asRecord(asRecord(settingsFile).extensionConfig);
    return normalizeDistillFeatureSettings(extensionConfig["dc-distill"], settings);
  }, DEFAULT_DISTILL_FEATURE_SETTINGS);
}

/** Raw dumps are diagnostic-only and intentionally require an explicit process opt-in. */
export function dumpsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ["1", "true", "yes"].includes((env.DC_DISTILL_DUMPS ?? env[LEGACY_DUMPS_ENV] ?? "").toLowerCase());
}
