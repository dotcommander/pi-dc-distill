import { compareCodeUnits } from "./wire-format.ts";
import type { CompactionRecallEntry } from "./recall-entry.ts";
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Path, projectSlug } from "./paths.ts";
import { Fs } from "./fs-support.ts";
import { migrateDistillData, type DistillDataMigrationResult } from "./data-migration.ts";
import type { CompactEvent } from "./types.ts";

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_RECALL = 10;
const OWNER = `dc-distill:${process.pid}`;
const localWriteQueues = new Map<string, Promise<void>>();

export type RecallScope = "project" | "all";

export type StoredRecallEntry = CompactionRecallEntry;

export interface DistillStoreOptions {
  dataDir?: string;
  projectRoot?: string;
  projectsRoot?: string;
  projectIdentity?: string;
  legacyDir?: string;
  now?: () => Date;
  pid?: number;
}

export interface DumpWriteOptions {
  enabled?: boolean;
  maxDumps?: number;
  attemptId?: string;
}

export interface DumpPair {
  beforePath: string;
  afterPath: string;
}

function isRecallEntry(value: unknown): value is StoredRecallEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.ts === "string"
    && typeof entry.before === "number"
    && typeof entry.after === "number"
    && typeof entry.summary === "string";
}

function compareRecall(a: StoredRecallEntry, b: StoredRecallEntry): number {
  const difference = Date.parse(a.ts) - Date.parse(b.ts);
  return (Number.isFinite(difference) ? difference : compareCodeUnits(a.ts, b.ts))
    || compareCodeUnits(JSON.stringify([a.project, a.sessionId, a.compactionEntryId, a.summaryDigest, a.summary]), JSON.stringify([b.project, b.sessionId, b.compactionEntryId, b.summaryDigest, b.summary]));
}

function normalizeAttempt(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48);
  return safe || "attempt";
}

function dumpSlug(ts: string, pid: number, attemptId: string): string {
  const date = new Date(ts);
  const iso = Number.isNaN(date.valueOf()) ? new Date(0).toISOString() : date.toISOString();
  return `${iso.replace(/[-:]/g, "").replace("T", "-").replace("Z", "")}-${pid}-${normalizeAttempt(attemptId)}`;
}

async function readRecall(path: string): Promise<StoredRecallEntry[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(parsed)) {
      throw new TypeError("Recall file must contain a JSON array");
    }
    return parsed.filter(isRecallEntry);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function withStoreLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  const previous = localWriteQueues.get(lockPath) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(() => Fs.withLock(lockPath, OWNER, fn));
  const settled = operation.then(() => undefined, () => undefined);
  localWriteQueues.set(lockPath, settled);
  try {
    return await operation;
  } finally {
    if (localWriteQueues.get(lockPath) === settled) localWriteQueues.delete(lockPath);
  }
}

export class DistillStore {
  readonly dataDir: string;
  readonly projectRoot: string;
  readonly projectsRoot: string;
  readonly projectIdentity: string;
  readonly legacyDir?: string;
  private readonly customDataDir: boolean;
  private readonly now: () => Date;
  private readonly pid: number;

  constructor(options: DistillStoreOptions = {}) {
    this.customDataDir = options.dataDir !== undefined;
    this.dataDir = options.dataDir ?? Path.data("dc-distill").path;
    this.projectRoot = options.projectRoot
      ?? join(options.projectsRoot ?? join(this.dataDir, "projects"), projectSlug(resolve(options.projectIdentity ?? process.cwd())));
    this.projectsRoot = options.projectsRoot ?? join(this.dataDir, "projects");
    this.projectIdentity = resolve(options.projectIdentity ?? process.cwd());
    this.legacyDir = options.legacyDir;
    this.now = options.now ?? (() => new Date());
    this.pid = options.pid ?? process.pid;
  }

  async initialize(options: { migrateLegacy?: boolean } = {}): Promise<DistillDataMigrationResult> {
    // Whole-source markers cannot finalize a migration with optional data omitted.
    if (options.migrateLegacy === false) {
      return { status: "skipped", copied: [], merged: [], preserved: [], errors: [] };
    }
    return migrateDistillData({
      legacyDir: this.legacyDir ?? (this.customDataDir ? join(dirname(this.dataDir), "dc-crunch") : undefined),
      priorDir: this.customDataDir && this.legacyDir === undefined ? join(dirname(this.dataDir), "dc-shrink") : undefined,
      currentDir: this.dataDir,
      now: this.now,
    });
  }

  async appendLog(event: CompactEvent | Record<string, unknown>): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const path = join(this.dataDir, "compact-log.jsonl");
    await withStoreLock(`${path}.lock`, async () => {
      try {
        if ((await stat(path)).size > MAX_LOG_BYTES) {
          await rm(`${path}.old`, { force: true });
          await rename(path, `${path}.old`);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await appendFile(path, `${JSON.stringify(event)}\n`);
    });
  }

  async appendFailure(reasons: string[]): Promise<void> {
    await this.appendLog({ ts: this.now().toISOString(), kind: "failure", reasons });
  }

  async persistRecall(entry: StoredRecallEntry): Promise<void> {
    await mkdir(this.projectRoot, { recursive: true });
    const owned: StoredRecallEntry = {
      ...entry,
      project: entry.project ?? this.projectIdentity,
    };
    await this.reconcileRecall([owned]);
  }

  /** Replay original host records under the same lock as ordinary recall writes. */
  async reconcileRecall(incoming: StoredRecallEntry[], options: { isCurrent?: () => boolean } = {}): Promise<{ conflicts: string[]; published: boolean }> {
    if (options.isCurrent && !options.isCurrent()) return { conflicts: [], published: false };
    await mkdir(this.projectRoot, { recursive: true });
    const path = join(this.projectRoot, "recall.json");
    return withStoreLock(`${path}.lock`, async () => {
      if (options.isCurrent && !options.isCurrent()) return { conflicts: [], published: false };
      const entries = await readRecall(path);
      const conflicts: string[] = [];
      const bridged = new Set<number>();
      const identity = (e: StoredRecallEntry) => e.compactionEntryId && e.project && e.sessionId
        ? JSON.stringify([resolve(e.project), e.sessionId, e.compactionEntryId]) : undefined;
      for (const candidate of incoming) {
        const owned = { ...candidate, project: resolve(candidate.project ?? this.projectIdentity) };
        const key = identity(owned);
        const existing = key ? entries.find(e => identity(e) === key) : undefined;
        if (existing) {
          if (existing.summaryDigest !== owned.summaryDigest || existing.summary !== owned.summary
            || existing.before !== owned.before || existing.after !== owned.after) conflicts.push(key!);
          continue;
        }
        const legacy = key ? entries.findIndex((e, i) => !bridged.has(i) && !e.compactionEntryId
          && e.project !== undefined && resolve(e.project) === owned.project && e.sessionId === owned.sessionId
          && e.summary === owned.summary && e.before === owned.before && e.after === owned.after) : -1;
        if (legacy >= 0) {
          bridged.add(legacy);
          // Bridge one-to-one while preserving historical payload and timestamp.
          entries[legacy] = { ...entries[legacy]!, compactionEntryId: owned.compactionEntryId,
            summaryDigest: owned.summaryDigest, attemptId: owned.attemptId };
        } else entries.push(owned);
      }
      const ordered = entries.sort(compareRecall).slice(-MAX_RECALL);
      if (options.isCurrent && !options.isCurrent()) return { conflicts, published: false };
      const stale = new Error("Recall reconciliation became obsolete");
      try {
        await Fs.write(path, `${JSON.stringify(ordered, null, 2)}\n`, 3, () => {
          if (options.isCurrent && !options.isCurrent()) throw stale;
        });
      } catch (error) {
        if (error === stale) return { conflicts, published: false };
        throw error;
      }
      return { conflicts, published: true };
    });
  }

  async loadRecall(scope: RecallScope = "project"): Promise<StoredRecallEntry[]> {
    if (scope === "project") {
      return (await readRecall(join(this.projectRoot, "recall.json")))
        .filter((entry) => entry.project !== undefined)
        .sort((a, b) => compareRecall(b, a));
    }

    const entries: StoredRecallEntry[] = [];
    try {
      for (const project of await readdir(this.projectsRoot, { withFileTypes: true })) {
        if (!project.isDirectory()) continue;
        const projectEntries = await readRecall(join(this.projectsRoot, project.name, "recall.json"));
        entries.push(...projectEntries.filter((entry) => entry.project !== undefined));
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const legacy = await readRecall(join(this.dataDir, "recall.json"));
    entries.push(...legacy.map((entry) => ({ ...entry, owner: "legacy-unscoped" as const })));
    return entries.sort((a, b) => compareRecall(b, a));
  }

  async writeDump(
    ts: string,
    canonicalInput: string | Uint8Array,
    wireSummary: string,
    options: DumpWriteOptions = {},
  ): Promise<DumpPair | null> {
    if (options.enabled !== true) return null;
    const dir = join(this.dataDir, "compact-dumps");
    await mkdir(dir, { recursive: true });
    const lockPath = join(dir, ".lock");
    return withStoreLock(lockPath, async () => {
      const slug = dumpSlug(ts, this.pid, options.attemptId ?? crypto.randomUUID().slice(0, 8));
      const beforePath = join(dir, `${slug}-before.jsonl`);
      const afterPath = join(dir, `${slug}-after.txt`);
      const beforeTmp = `${beforePath}.tmp`;
      const afterTmp = `${afterPath}.tmp`;
      try {
        await Fs.write(
          beforeTmp,
          typeof canonicalInput === "string" ? canonicalInput : Buffer.from(canonicalInput),
        );
        await Fs.write(afterTmp, wireSummary);
        await rename(beforeTmp, beforePath);
        await rename(afterTmp, afterPath);
      } catch (error) {
        await rm(beforeTmp, { force: true });
        await rm(afterTmp, { force: true });
        await rm(beforePath, { force: true });
        await rm(afterPath, { force: true });
        throw error;
      }
      await this.pruneDumps(options.maxDumps, dir);
      return { beforePath, afterPath };
    });
  }

  private async pruneDumps(maxDumps: number | undefined, dir: string): Promise<void> {
    if (maxDumps === undefined || maxDumps < 0) return;
    const names = await readdir(dir);
    const suffix = /-(before\.jsonl|after\.txt)$/;
    const slugs = names.filter(name => name.endsWith("-before.jsonl") && names.includes(name.replace(/-before\.jsonl$/, "-after.txt")))
      .map(name => name.replace(suffix, "")).sort();
    for (const slug of slugs.slice(0, Math.max(0, slugs.length - maxDumps))) {
      await rm(join(dir, `${slug}-before.jsonl`), { force: true });
      await rm(join(dir, `${slug}-after.txt`), { force: true });
    }
  }
}
