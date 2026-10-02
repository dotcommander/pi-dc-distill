/** Managed generated artifacts. Unfinished and unowned directories are never pruned. */
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Path } from "./paths.ts";
import { Fs } from "./fs-support.ts";
import { Diag } from "./diag-support.ts";

export type CacheCategory = "evaluations" | "compare" | "e2e" | "demo";
export const CACHE_RUN_MARKER = ".dc-distill-cache-run.json";
interface RunMarker {
  owner: "dc-distill";
  version: 1;
  category: CacheCategory;
  startedAt: string;
  completedAt?: string;
  result?: "success" | "failure";
  protected: boolean;
}
export interface CacheRun { directory: string; category: CacheCategory }
const categories: CacheCategory[] = ["evaluations", "compare", "e2e", "demo"];
const queues = new Map<string, Promise<void>>();

function readMarker(directory: string): RunMarker | undefined {
  try {
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) return;
    const path = join(directory, CACHE_RUN_MARKER);
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) return;
    const value = JSON.parse(readFileSync(path, "utf8")) as RunMarker;
    if (value.owner !== "dc-distill" || value.version !== 1 || !categories.includes(value.category)
      || typeof value.startedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt))
      || typeof value.protected !== "boolean") return;
    if (value.completedAt !== undefined || value.result !== undefined) {
      if (typeof value.completedAt !== "string" || !Number.isFinite(Date.parse(value.completedAt))
        || (value.result !== "success" && value.result !== "failure")) return;
    }
    return value;
  } catch { return; }
}

async function withCategoryLock<T>(parent: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(parent) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(() => Fs.withLock(
    join(parent, ".retention.lock"), `dc-distill-cache:${process.pid}`, fn,
  ));
  const settled = operation.then(() => undefined, () => undefined);
  queues.set(parent, settled);
  try { return await operation; }
  finally { if (queues.get(parent) === settled) queues.delete(parent); }
}

export function createCacheRun(category: CacheCategory, cacheRoot = Path.cache("dc-distill").path): CacheRun {
  const parent = join(cacheRoot, category);
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, "run-"));
  Fs.writeSync(join(directory, CACHE_RUN_MARKER), JSON.stringify({
    owner: "dc-distill", version: 1, category, startedAt: new Date().toISOString(), protected: false,
  } satisfies RunMarker, null, 2) + "\n");
  return { directory, category };
}

/** Protect an explicit output targeting any directory within an existing managed run. */
export async function protectCacheOutput(output: string): Promise<void> {
  let directory = resolve(output);
  const suffix: string[] = [];
  // Resolve aliases even when the explicit output's final directories do not exist yet.
  while (true) {
    try { directory = join(realpathSync(directory), ...suffix); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(directory);
      if (parent === directory) throw error;
      suffix.unshift(directory.slice(parent.length + (parent.endsWith("/") ? 0 : 1)));
      directory = parent;
    }
  }
  while (dirname(directory) !== directory) {
    const marker = readMarker(directory);
    if (marker) {
      await withCategoryLock(dirname(directory), async () => {
        const current = readMarker(directory);
        if (!current) throw new Error(`Managed output disappeared before protection: ${directory}`);
        await Fs.write(join(directory, CACHE_RUN_MARKER), JSON.stringify({ ...current, protected: true }, null, 2) + "\n");
      });
      return;
    }
    directory = dirname(directory);
  }
}

/** Call only after all subprocesses and artifact consumers have finished. Best effort. */
export async function finalizeCacheRun(run: CacheRun, success: boolean): Promise<void> {
  try {
    const parent = dirname(run.directory);
    await withCategoryLock(parent, async () => {
      const marker = readMarker(run.directory);
      if (!marker || marker.category !== run.category) throw new Error(`Invalid cache ownership: ${run.directory}`);
      await Fs.write(join(run.directory, CACHE_RUN_MARKER), JSON.stringify({
        ...marker, completedAt: new Date().toISOString(), result: success ? "success" : "failure",
      }, null, 2) + "\n");
      const completed: Array<{ directory: string; time: string }> = [];
      for (const entry of await readdir(parent, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const directory = join(parent, entry.name);
        const candidate = readMarker(directory);
        if (directory === run.directory || !candidate || candidate.category !== run.category
          || candidate.protected || !candidate.completedAt) continue;
        completed.push({ directory, time: candidate.completedAt });
      }
      completed.sort((a, b) => b.time.localeCompare(a.time) || b.directory.localeCompare(a.directory));
      for (const candidate of completed.slice(9)) {
        // Recheck immediately before deletion; never follow a replaced symlink.
        const current = readMarker(candidate.directory);
        if (current && current.category === run.category && current.completedAt && !current.protected) {
          await rm(candidate.directory, { recursive: true });
        }
      }
    });
  } catch (error) {
    const message = `Cache finalization failed (${run.directory}): ${String(error)}`;
    console.warn(message);
    Diag.warn("cache-runs", message);
  }
}
