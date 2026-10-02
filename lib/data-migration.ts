import { compareCodeUnits } from "./wire-format.ts";
import { LEGACY_DATA_NAMESPACE, LEGACY_MIGRATION_FLAG } from "./legacy.ts";
import { access, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { Path, agentDir } from "./paths.ts";
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
  /** Explicit source for the location migration, isolated from shared HOME. */
  locationDir?: string;
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
  return join(legacyDataRoot(), LEGACY_NAMESPACE);
}

function legacyDataRoot(): string {
  const root = agentDir();
  return root === resolve(homedir(), ".pi", "agent")
    ? join(homedir(), ".pi", "data")
    : join(root, "data");
}

function defaultCurrentDir(): string {
  return Path.data(CURRENT_NAMESPACE).path;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

async function readJsonArray(path: string): Promise<unknown[]> {
  const parsed = JSON.parse(await readFile(path, "utf8"));
  return Array.isArray(parsed) ? parsed : [];
}

async function mergeRecallFile(src: string, dst: string): Promise<void> {
  const entries = [...await readJsonArray(dst), ...await readJsonArray(src)];
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
    return (Date.parse(left) - Date.parse(right) || compareCodeUnits(left, right))
      || compareCodeUnits(JSON.stringify(a), JSON.stringify(b));
  });
  await Fs.write(dst, JSON.stringify(merged.slice(-10), null, 2) + "\n");
}

function recallEntryKey(record: Record<string, unknown>): string {
  return `${record.project ?? ""}\u0000${record.sessionId ?? ""}\u0000${record.compactionEntryId ?? ""}\u0000${record.ts ?? ""}\u0000${record.before ?? ""}\u0000${record.after ?? ""}\u0000${record.summary ?? ""}`;
}

async function mergeJsonlFile(src: string, dst: string): Promise<void> {
  const lines = [
    ...(await readFile(src, "utf8")).split(/\n/),
    ...(await readFile(dst, "utf8")).split(/\n/),
  ].filter((line) => line.trim().length > 0);
  const unique = [...new Set(lines)];
  await Fs.write(dst, unique.join("\n") + (unique.length > 0 ? "\n" : ""));
}

async function copyConflict(src: string, dstRoot: string, relativePath: string): Promise<string> {
  const conflictPath = join(dstRoot, CONFLICT_DIR, relativePath);
  await mkdir(dirname(conflictPath), { recursive: true });
  if (await exists(conflictPath) && !(await readFile(src)).equals(await readFile(conflictPath))) {
    throw new Error(`Conflicting preserved artifact: ${conflictPath}`);
  }
  await Fs.write(conflictPath, await readFile(src));
  return join(CONFLICT_DIR, relativePath);
}

async function migrateEntry(
  src: string,
  dst: string,
  dstRoot: string,
  relativePath: string,
  result: DistillDataMigrationResult,
  conflictPrefix = "",
): Promise<void> {
  const sourceStat = await stat(src);
  if (sourceStat.isDirectory()) {
    await mkdir(dst, { recursive: true });
    for (const entry of await readdir(src)) {
      if (entry.endsWith(".lock") || (entry.endsWith(".tmp") || entry.includes(".tmp-")) || entry === ".lock") continue;
      await migrateEntry(
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
  if (!sourceStat.isFile()) return;

  try {
    await mkdir(dirname(dst), { recursive: true });
    // Destination lock matches the live writer, including all flat dump artifacts.
    const lockPath = relativePath.startsWith("compact-dumps/")
      ? join(dstRoot, "compact-dumps", ".lock") : `${dst}.lock`;
    await Fs.withLock(lockPath, `dc-distill-migration:${process.pid}`, async () => {
      if (!await exists(dst)) {
        if (basename(relativePath) === "recall.json") await readJsonArray(src);
        await Fs.write(dst, await readFile(src)); result.copied.push(relativePath); return;
      }
      if ((await readFile(src)).equals(await readFile(dst))) return;
      if (basename(relativePath) === "recall.json") {
        await mergeRecallFile(src, dst); result.merged.push(relativePath); return;
      }
      if (relativePath === "compact-log.jsonl" || /(^|\/)tool-output\/index\.jsonl$/.test(relativePath)) {
        await mergeJsonlFile(src, dst); result.merged.push(relativePath); return;
      }
      result.preserved.push(await copyConflict(src, dstRoot, join(conflictPrefix, relativePath)));
    });
  } catch (err) { result.errors.push(`${relativePath}: ${errorMessage(err)}`); }

}

async function migrateDirectory(
  legacyDir: string,
  currentDir: string,
  marker: string,
  now: () => Date,
  conflictPrefix = "",
): Promise<DistillDataMigrationResult> {
  const result: DistillDataMigrationResult = {
    status: "skipped",
    copied: [],
    merged: [],
    preserved: [],
    errors: [],
  };

  if (!await exists(legacyDir)) return result;

  await mkdir(currentDir, { recursive: true });
  const flagPath = join(currentDir, marker);
  if (await exists(flagPath)) return result;

  for (const entry of await readdir(legacyDir)) {
    // dc-distill no longer owns a settings file. Preserve legacy settings in
    // place rather than copying dead configuration into current storage.
    if (entry === "settings.json" || entry.startsWith(".migrated-") || entry.endsWith(".lock") || (entry.endsWith(".tmp") || entry.includes(".tmp-")) || entry === ".lock") continue;
    try {
      await migrateEntry(
        join(legacyDir, entry), join(currentDir, entry), currentDir, entry, result, conflictPrefix,
      );
    } catch (error) {
      result.errors.push(`${entry}: ${errorMessage(error)}`);
    }
  }

  result.status = result.errors.length === 0 ? "migrated" : "failed";
  if (result.status === "failed") return result;
  try {
    await Fs.write(
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
export async function migrateDistillData(
  options: DistillDataMigrationOptions = {},
): Promise<DistillDataMigrationResult> {
  const currentDir = options.currentDir ?? defaultCurrentDir();
  const now = options.now ?? (() => new Date());
  const sources = [
    { dir: options.legacyDir ?? defaultLegacyDir(), marker: MIGRATION_FLAG, prefix: "" },
  ];
  const priorDir = options.priorDir ?? (options.legacyDir === undefined
    ? join(legacyDataRoot(), LEGACY_DATA_NAMESPACE)
    : undefined);
  if (priorDir) sources.push({ dir: priorDir, marker: LEGACY_MIGRATION_FLAG, prefix: LEGACY_DATA_NAMESPACE });
  const locationDir = options.locationDir ?? (options.legacyDir === undefined
    ? join(legacyDataRoot(), CURRENT_NAMESPACE) : undefined);
  if (locationDir && resolve(locationDir) !== resolve(currentDir)) sources.unshift({
    dir: locationDir, marker: ".migrated-from-legacy-location-dc-distill", prefix: CURRENT_NAMESPACE,
  });
  const results: DistillDataMigrationResult[] = [];
  for (const { dir, marker, prefix } of sources) {
    try {
      results.push(await migrateDirectory(dir, currentDir, marker, now, prefix));
    } catch (error) {
      results.push({ status: "failed", copied: [], merged: [], preserved: [], errors: [errorMessage(error)] });
    }
  }
  return {
    status: results.some((result) => result.status === "failed") ? "failed"
      : results.some((result) => result.status === "migrated") ? "migrated" : "skipped",
    copied: results.flatMap((result) => result.copied),
    merged: results.flatMap((result) => result.merged),
    preserved: results.flatMap((result) => result.preserved),
    errors: results.flatMap((result) => result.errors),
  };
}
