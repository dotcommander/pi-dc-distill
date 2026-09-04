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
