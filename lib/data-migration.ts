import { LEGACY_DATA_NAMESPACE, LEGACY_MIGRATION_FLAG } from "./legacy.ts";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { Path } from "./paths.ts";
import { Fs } from "./fs-support.ts";

const CURRENT_NAMESPACE = "dc-distill";
const LEGACY_NAMESPACE = `dc-${"cru"}${"nch"}`;
const MIGRATION_FLAG = ".migrated-from-legacy-distill";
const CONFLICT_DIR = ".legacy-migration-conflicts";

export interface DistillDataMigrationOptions {
  legacyDir?: string;
  /** Previous branded namespace; explicit legacyDir isolates test/custom stores. */
  priorDir?: string;
  currentDir?: string;
  now?: () => Date;
}

export interface DistillDataMigrationResult {
  status: "skipped" | "migrated" | "failed";
  copied: string[];
  merged: string[];
  preserved: string[];
  errors: string[];
}

function defaultLegacyDir(): string {
  return join(homedir(), ".pi", "data", LEGACY_NAMESPACE);
}

function defaultCurrentDir(): string {
  return Path.data(CURRENT_NAMESPACE).path;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function readJsonArray(path: string): unknown[] {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(parsed) ? parsed : [];
}

function mergeRecallFile(src: string, dst: string): void {
  const entries = [...readJsonArray(src), ...readJsonArray(dst)];
  const seen = new Set<string>();
  const merged: unknown[] = [];
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const key = recallEntryKey(record);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  merged.sort((a, b) => {
    const left = typeof (a as Record<string, unknown>).ts === "string"
      ? String((a as Record<string, unknown>).ts)
      : "";
    const right = typeof (b as Record<string, unknown>).ts === "string"
      ? String((b as Record<string, unknown>).ts)
      : "";
    return left.localeCompare(right);
  });
  // Atomic write: temp+rename so a concurrent boot-time migration (another
  // session) never reads a torn file. The merge is idempotent (dedupe of
  // src∪dst), so concurrent runs compute the same result — last write wins safely.
  const recallTmp = `${dst}.${process.pid}.tmp`;
  writeFileSync(recallTmp, JSON.stringify(merged.slice(-10), null, 2) + "\n");
  renameSync(recallTmp, dst);
}

function recallEntryKey(record: Record<string, unknown>): string {
  return `${record.ts ?? ""}\u0000${record.before ?? ""}\u0000${record.after ?? ""}\u0000${record.summary ?? ""}`;
}

function mergeJsonlFile(src: string, dst: string): void {
  const lines = [
    ...readFileSync(src, "utf8").split(/\n/),
    ...readFileSync(dst, "utf8").split(/\n/),
  ].filter((line) => line.trim().length > 0);
  const unique = [...new Set(lines)];
  const jsonlTmp = `${dst}.${process.pid}.tmp`;
  writeFileSync(jsonlTmp, unique.join("\n") + (unique.length > 0 ? "\n" : ""));
  renameSync(jsonlTmp, dst);
}

function copyConflict(src: string, dstRoot: string, relativePath: string): string {
  const conflictPath = join(dstRoot, CONFLICT_DIR, relativePath);
  mkdirSync(dirname(conflictPath), { recursive: true });
  copyFileSync(src, conflictPath);
  return join(CONFLICT_DIR, relativePath);
}

function migrateEntry(
  src: string,
  dst: string,
  dstRoot: string,
  relativePath: string,
  result: DistillDataMigrationResult,
  conflictPrefix = "",
): void {
  const stat = statSync(src);
  if (stat.isDirectory()) {
    mkdirSync(dst, { recursive: true });
    for (const entry of readdirSync(src)) {
      if (entry.endsWith(".lock") || entry.endsWith(".tmp") || entry === ".lock") continue;
      migrateEntry(
        join(src, entry),
        join(dst, entry),
        dstRoot,
        relativePath ? join(relativePath, entry) : entry,
        result,
        conflictPrefix,
      );
    }
    return;
  }
  if (!stat.isFile()) return;

  try {
    if (!existsSync(dst)) {
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
      result.copied.push(relativePath);
      return;
    }

    if (readFileSync(src).equals(readFileSync(dst))) return;

    if (basename(relativePath) === "recall.json") {
      mergeRecallFile(src, dst);
      result.merged.push(relativePath);
      return;
    }

    if (relativePath.endsWith(".jsonl")) {
      mergeJsonlFile(src, dst);
      result.merged.push(relativePath);
      return;
    }

    result.preserved.push(copyConflict(src, dstRoot, join(conflictPrefix, relativePath)));
  } catch (err) {
    result.errors.push(`${relativePath}: ${errorMessage(err)}`);
  }
}

function migrateDirectory(
  legacyDir: string,
  currentDir: string,
  marker: string,
  now: () => Date,
  conflictPrefix = "",
): DistillDataMigrationResult {
  const result: DistillDataMigrationResult = {
    status: "skipped",
    copied: [],
    merged: [],
    preserved: [],
    errors: [],
  };

  if (!existsSync(legacyDir)) return result;

  mkdirSync(currentDir, { recursive: true });
  const flagPath = join(currentDir, marker);
  if (existsSync(flagPath)) return result;

  for (const entry of readdirSync(legacyDir)) {
    // dc-distill no longer owns a settings file. Preserve legacy settings in
    // place rather than copying dead configuration into current storage.
    if (entry === "settings.json" || entry.startsWith(".migrated-") || entry.endsWith(".lock") || entry.endsWith(".tmp") || entry === ".lock") continue;
    migrateEntry(
      join(legacyDir, entry),
      join(currentDir, entry),
      currentDir,
      entry,
      result,
      conflictPrefix,
    );
  }

  result.status = result.errors.length === 0 ? "migrated" : "failed";
  if (result.status === "failed") return result;
  try {
    Fs.writeSync(
      flagPath,
      JSON.stringify({ ts: now().toISOString(), result }, null, 2) + "\n",
    );
  } catch (err) {
    result.status = "failed";
    result.errors.push(`${marker}: ${errorMessage(err)}`);
  }
  return result;
}

/** Copy prior namespaces without rewriting historical payloads or deleting sources. */
export function migrateDistillData(
  options: DistillDataMigrationOptions = {},
): DistillDataMigrationResult {
  const currentDir = options.currentDir ?? defaultCurrentDir();
  const now = options.now ?? (() => new Date());
  const sources = [
    { dir: options.legacyDir ?? defaultLegacyDir(), marker: MIGRATION_FLAG, prefix: "" },
  ];
  const priorDir = options.priorDir ?? (options.legacyDir === undefined
    ? join(homedir(), ".pi", "data", LEGACY_DATA_NAMESPACE)
    : undefined);
  if (priorDir) sources.push({ dir: priorDir, marker: LEGACY_MIGRATION_FLAG, prefix: LEGACY_DATA_NAMESPACE });
  const results = sources.map(({ dir, marker, prefix }) => {
    try {
      return migrateDirectory(dir, currentDir, marker, now, prefix);
    } catch (error) {
      return { status: "failed" as const, copied: [], merged: [], preserved: [], errors: [errorMessage(error)] };
    }
  });
  return {
    status: results.some((result) => result.status === "failed") ? "failed"
      : results.some((result) => result.status === "migrated") ? "migrated" : "skipped",
    copied: results.flatMap((result) => result.copied),
    merged: results.flatMap((result) => result.merged),
    preserved: results.flatMap((result) => result.preserved),
    errors: results.flatMap((result) => result.errors),
  };
}
