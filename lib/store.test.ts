import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DistillStore, type StoredRecallEntry } from "./store.ts";

function root(): string {
  return mkdtempSync(join(tmpdir(), "dc-distill-store-"));
}

function entry(ts: string, summary: string): StoredRecallEntry {
  return {
    ts,
    before: 100_000,
    after: 2_000,
    summary,
    sessionId: `session-${summary}`,
    tokenSource: "pi-rebuilt-message-estimate",
  };
}

describe("DistillStore", () => {
  test("keeps default recall project-scoped and includes labelled legacy only for all", async () => {
    const dataDir = root();
    const projectsRoot = join(dataDir, "projects");
    const alpha = new DistillStore({
      dataDir,
      projectsRoot,
      projectRoot: join(projectsRoot, "alpha"),
      projectIdentity: "/work/alpha",
    });
    const beta = new DistillStore({
      dataDir,
      projectsRoot,
      projectRoot: join(projectsRoot, "beta"),
      projectIdentity: "/work/beta",
    });
    await alpha.persistRecall(entry("2026-01-01T00:00:00Z", "alpha"));
    await beta.persistRecall(entry("2026-01-02T00:00:00Z", "beta"));
    await writeFile(join(dataDir, "recall.json"), JSON.stringify([
      entry("2026-01-03T00:00:00Z", "legacy"),
    ]));

    expect((await alpha.loadRecall()).map((item) => item.summary)).toEqual(["alpha"]);
    const all = await alpha.loadRecall("all");
    expect(all.map((item) => item.summary)).toEqual(["legacy", "beta", "alpha"]);
    expect(all[0].owner).toBe("legacy-unscoped");
    expect(all[1].project).toBe("/work/beta");
  });

  test("all recall skips nondirectory project entries and missing recall files", async () => {
    const dataDir = root();
    const store = new DistillStore({ dataDir, projectIdentity: "/work/valid" });
    await store.persistRecall(entry("2026-01-01T00:00:00Z", "valid"));
    await mkdir(join(store.projectsRoot, "empty"));
    await writeFile(join(store.projectsRoot, ".DS_Store"), "not-json");
    await writeFile(join(store.projectsRoot, ".lock"), "not-json");
    await writeFile(join(dataDir, "recall.json"), JSON.stringify([
      entry("2026-01-02T00:00:00Z", "legacy"),
    ]));

    const all = await store.loadRecall("all");
    expect(all.map(item => item.summary)).toEqual(["legacy", "valid"]);
    expect(all[0].owner).toBe("legacy-unscoped");
    expect(all[1].project).toBe("/work/valid");
  });

  test("all recall preserves corrupt project data errors among valid and nondirectory entries", async () => {
    const dataDir = root();
    const store = new DistillStore({ dataDir, projectIdentity: "/work/valid" });
    await store.persistRecall(entry("2026-01-01T00:00:00Z", "valid"));
    await writeFile(join(store.projectsRoot, ".DS_Store"), "not-json");
    const corrupt = join(store.projectsRoot, "corrupt");
    await mkdir(corrupt);
    await writeFile(join(corrupt, "recall.json"), "not-json");

    await expect(store.loadRecall("all")).rejects.toBeInstanceOf(SyntaxError);
  });

  test("all recall preserves genuine project recall read errors", async () => {
    const dataDir = root();
    const store = new DistillStore({ dataDir, projectIdentity: "/work/valid" });
    await store.persistRecall(entry("2026-01-01T00:00:00Z", "valid"));
    await mkdir(join(store.projectsRoot, "unreadable", "recall.json"), { recursive: true });

    await expect(store.loadRecall("all")).rejects.toMatchObject({ code: "EISDIR" });
  });

  test("locked concurrent recall writers retain the newest ten entries", async () => {
    const dataDir = root();
    const store = new DistillStore({
      dataDir,
      projectRoot: join(dataDir, "projects", "same"),
      projectsRoot: join(dataDir, "projects"),
      projectIdentity: "/work/same",
    });
    await Promise.all(Array.from({ length: 15 }, (_, index) => store.persistRecall(
      entry(`2026-01-${String(index + 1).padStart(2, "0")}T00:00:00Z`, `entry-${index}`),
    )));

    const recalled = await store.loadRecall();
    expect(recalled).toHaveLength(10);
    expect(recalled[0].summary).toBe("entry-14");
    expect(recalled[9].summary).toBe("entry-5");
  });

  test("raw dumps are opt-in, collision-safe, exact, and retention-bounded", async () => {
    const dataDir = root();
    const store = new DistillStore({
      dataDir,
      projectRoot: join(dataDir, "projects", "one"),
      now: () => new Date("2026-01-01T00:00:00.123Z"),
      pid: 4242,
    });
    const ts = "2026-01-01T00:00:00.123Z";
    expect(await store.writeDump(ts, "secret", "summary")).toBeNull();
    expect(existsSync(join(dataDir, "compact-dumps"))).toBe(false);

    const first = await store.writeDump(ts, "{\"one\":1}\n", "first", {
      enabled: true,
      maxDumps: 2,
      attemptId: "attempt-a",
    });
    const second = await store.writeDump(ts, "{\"two\":2}\n", "second", {
      enabled: true,
      maxDumps: 2,
      attemptId: "attempt-b",
    });
    expect(first?.beforePath).not.toBe(second?.beforePath);
    expect(readFileSync(first!.beforePath, "utf8")).toBe("{\"one\":1}\n");
    expect(readFileSync(second!.afterPath, "utf8")).toBe("second");
    expect(readdirSync(join(dataDir, "compact-dumps")).filter((name) => name.endsWith(".tmp"))).toEqual([]);

    await store.writeDump(ts, "three", "third", {
      enabled: true,
      maxDumps: 2,
      attemptId: "attempt-c",
    });
    const afterFiles = readdirSync(join(dataDir, "compact-dumps")).filter((name) => name.endsWith("-after.txt"));
    expect(afterFiles).toHaveLength(2);
  });

  test("migration failure leaves no marker and retries after repair", async () => {
    const dataDir = root();
    const legacyDir = join(root(), "legacy");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, "recall.json"), "not-json");
    await mkdir(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "recall.json"), "[]");
    const store = new DistillStore({ dataDir, legacyDir, projectRoot: join(dataDir, "projects", "one") });

    const failed = await store.initialize();
    expect(failed.status).toBe("failed");
    expect(existsSync(join(dataDir, ".migrated-from-legacy-distill"))).toBe(false);

    await writeFile(join(legacyDir, "recall.json"), JSON.stringify([entry("2026-01-01T00:00:00Z", "fixed")]));
    const repaired = await store.initialize();
    expect(repaired.status).toBe("migrated");
    expect(existsSync(join(dataDir, ".migrated-from-legacy-distill"))).toBe(true);
  });
});


test("deferred migration leaves optional legacy data and markers untouched until enabled", async () => {
  const dir = root();
  const legacyDir = join(dir, "legacy");
  const dataDir = join(dir, "current");
  await mkdir(legacyDir);
  const original = JSON.stringify([entry("2026-01-01T00:00:00Z", "legacy optional state")]);
  await writeFile(join(legacyDir, "recall.json"), original);
  const store = new DistillStore({ dataDir, legacyDir, projectRoot: join(dir, "project") });
  expect((await store.initialize({ migrateLegacy: false })).status).toBe("skipped");
  expect(existsSync(dataDir)).toBe(false);
  expect(readFileSync(join(legacyDir, "recall.json"), "utf8")).toBe(original);
  expect((await store.initialize({ migrateLegacy: true })).status).toBe("migrated");
  expect(existsSync(join(dataDir, "recall.json"))).toBe(true);
  expect(readFileSync(join(legacyDir, "recall.json"), "utf8")).toBe(original);
});

test("selected dataDir owns default project recall and logs", async () => {
  const dataDir = root();
  const store = new DistillStore({ dataDir, projectIdentity: "/selected/project" });
  expect(store.projectRoot.startsWith(join(dataDir, "projects"))).toBe(true);
  expect(store.projectsRoot).toBe(join(dataDir, "projects"));
  await store.persistRecall(entry("2026-01-01T00:00:00Z", "selected"));
  await store.appendLog({ kind: "selected" });
  expect(existsSync(join(store.projectRoot, "recall.json"))).toBe(true);
  expect(existsSync(join(dataDir, "compact-log.jsonl"))).toBe(true);
});

function recovered(id: string, ts = "2026-01-01T00:00:00Z"): StoredRecallEntry {
  return { ...entry(ts, "same"), sessionId: "session", project: "/project",
    compactionEntryId: id, summaryDigest: "a".repeat(64), attemptId: id };
}

test("recall replay bridges legacy rows one-to-one, is idempotent and preserves conflicts", async () => {
  const dataDir = root();
  const store = new DistillStore({ dataDir, projectIdentity: "/project" });
  const historical = { ...entry("2025-01-01T00:00:00Z", "same"), sessionId: "session", project: "/project" };
  await store.persistRecall(historical);
  await store.persistRecall(historical);
  await store.reconcileRecall([recovered("one"), recovered("two")]);
  await store.reconcileRecall([recovered("one"), recovered("two")]);
  const rows = await store.loadRecall();
  expect(rows).toHaveLength(2);
  expect(rows.every(row => row.ts === historical.ts)).toBe(true);
  expect(rows.map(row => row.compactionEntryId).sort()).toEqual(["one", "two"]);
  expect((await store.reconcileRecall([{ ...recovered("one"), summaryDigest: "b".repeat(64) }])).conflicts).toHaveLength(1);
  expect((await store.loadRecall()).find(row => row.compactionEntryId === "one")!.summaryDigest).toBe("a".repeat(64));
});

test("old-branch replay never promotes original timestamps into the newest ten", async () => {
  const dataDir = root();
  const store = new DistillStore({ dataDir, projectIdentity: "/project" });
  const recent = Array.from({length:10}, (_, i) => recovered(`recent-${i}`, `2026-02-${String(i+1).padStart(2,"0")}T00:00:00Z`));
  await store.reconcileRecall(recent);
  await store.reconcileRecall([recovered("old", "2020-01-01T00:00:00Z")]);
  expect((await store.loadRecall()).map(row => row.compactionEntryId)).not.toContain("old");
});

test("navigation while waiting for recall lock cancels publication", async () => {
  const { Fs } = await import("./fs-support.ts");
  const dataDir = root();
  const store = new DistillStore({ dataDir, projectIdentity: "/project" });
  await mkdir(store.projectRoot, {recursive:true});
  let release!: () => void;
  let locked!: () => void;
  const ready = new Promise<void>(resolve => { locked = resolve; });
  const holding = Fs.withLock(join(store.projectRoot,"recall.json.lock"), "holder", async () => {
    locked(); await new Promise<void>(resolve => { release = resolve; });
  });
  await ready;
  let current = true;
  const reconciliation = store.reconcileRecall([recovered("obsolete")], {isCurrent:()=>current});
  current = false; release(); await holding;
  expect((await reconciliation).published).toBe(false);
  expect(await store.loadRecall()).toEqual([]);
});

test("orphan dumps cannot evict complete before/after pairs", async () => {
  const dataDir = root();
  const store = new DistillStore({dataDir});
  const first = await store.writeDump("2026-01-01T00:00:00Z","input","summary",{enabled:true,maxDumps:2,attemptId:"first"});
  await writeFile(join(dataDir,"compact-dumps","99999999-orphan-before.jsonl"),"orphan");
  await store.writeDump("2026-01-02T00:00:00Z","input","summary",{enabled:true,maxDumps:2,attemptId:"second"});
  expect(existsSync(first!.beforePath)).toBe(true);
  expect(existsSync(first!.afterPath)).toBe(true);
});
