import { describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Fs } from "./fs-support.ts";
import { migrateDistillData } from "./data-migration.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "dc-distill-migrate-"));
}

function legacyName(): string {
  return `dc-${"cru"}${"nch"}`;
}

async function write(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

describe("migrateDistillData", () => {
  test("copies active legacy data but preserves obsolete settings in place", async () => {
    const root = tempRoot();
    const legacyDir = join(root, legacyName());
    const currentDir = join(root, "dc-distill");
    await write(join(legacyDir, "settings.json"), "{\"cacheTtlMs\":10000}\n");
    await write(join(legacyDir, "compact-dumps", "one-after.txt"), "summary");

    const result = await migrateDistillData({ legacyDir, currentDir, now: () => new Date("2026-01-01T00:00:00Z") });

    expect(result.status).toBe("migrated");
    expect(result.copied).toEqual(["compact-dumps/one-after.txt"]);
    expect(existsSync(join(currentDir, "settings.json"))).toBe(false);
    expect(readFileSync(join(legacyDir, "settings.json"), "utf8")).toBe("{\"cacheTtlMs\":10000}\n");
    expect(existsSync(join(currentDir, ".migrated-from-legacy-distill"))).toBe(true);
  });

  test("merges recall and JSONL files without duplicating entries", async () => {
    const root = tempRoot();
    const legacyDir = join(root, legacyName());
    const currentDir = join(root, "dc-distill");
    await write(join(legacyDir, "recall.json"), JSON.stringify([
      { ts: "2026-01-01T00:00:00Z", before: 10, after: 2, summary: "old" },
      { ts: "2026-01-02T00:00:00Z", before: 11, after: 3, summary: "same" },
    ]));
    await write(join(currentDir, "recall.json"), JSON.stringify([
      { ts: "2026-01-02T00:00:00Z", before: 11, after: 3, summary: "same" },
      { ts: "2026-01-03T00:00:00Z", before: 12, after: 4, summary: "new" },
    ]));
    await write(join(legacyDir, "compact-log.jsonl"), "{\"a\":1}\n{\"b\":2}\n");
    await write(join(currentDir, "compact-log.jsonl"), "{\"b\":2}\n{\"c\":3}\n");

    const result = await migrateDistillData({ legacyDir, currentDir });

    expect(result.status).toBe("migrated");
    expect(result.merged.sort()).toEqual(["compact-log.jsonl", "recall.json"]);
    const recall = JSON.parse(readFileSync(join(currentDir, "recall.json"), "utf8"));
    expect(recall.map((entry: { summary: string }) => entry.summary)).toEqual(["old", "same", "new"]);
    expect(readFileSync(join(currentDir, "compact-log.jsonl"), "utf8")).toBe(
      "{\"a\":1}\n{\"b\":2}\n{\"c\":3}\n",
    );
  });

  test("preserves non-mergeable conflicting files under a conflict directory", async () => {
    const root = tempRoot();
    const legacyDir = join(root, legacyName());
    const currentDir = join(root, "dc-distill");
    await write(join(legacyDir, "config.json"), "legacy");
    await write(join(currentDir, "config.json"), "current");

    const result = await migrateDistillData({ legacyDir, currentDir });

    expect(result.status).toBe("migrated");
    expect(result.preserved).toEqual([".legacy-migration-conflicts/config.json"]);
    expect(readFileSync(join(currentDir, "config.json"), "utf8")).toBe("current");
    expect(readFileSync(join(currentDir, ".legacy-migration-conflicts", "config.json"), "utf8")).toBe("legacy");
  });

  test("skips after the migration flag exists", async () => {
    const root = tempRoot();
    const legacyDir = join(root, legacyName());
    const currentDir = join(root, "dc-distill");
    mkdirSync(legacyDir, { recursive: true });
    mkdirSync(currentDir, { recursive: true });
    writeFileSync(join(legacyDir, "placeholder"), "legacy", { flag: "w" });
    writeFileSync(join(currentDir, ".migrated-from-legacy-distill"), "{}\n");

    const result = await migrateDistillData({ legacyDir, currentDir });

    expect(result.status).toBe("skipped");
  });

  test("routes migration flag-file write through atomic Fs.write", async () => {
    const root = tempRoot();
    const legacyDir = join(root, legacyName());
    const currentDir = join(root, "dc-distill");
    await write(join(legacyDir, "settings.json"), "{\"key\":1}\n");

    const spy = spyOn(Fs, "write");
    try {
      await migrateDistillData({ legacyDir, currentDir, now: () => new Date("2026-01-01T00:00:00Z") });
      expect(spy).toHaveBeenCalledWith(
        join(currentDir, ".migrated-from-legacy-distill"),
        expect.anything(),
      );
    } finally {
      spy.mockRestore();
    }
  });

  test("does not write completion flag when a migration operation fails", async () => {
    const root = tempRoot();
    const legacyDir = join(root, legacyName());
    const currentDir = join(root, "dc-distill");
    await write(join(legacyDir, "recall.json"), "malformed");
    await write(join(currentDir, "recall.json"), "[]");

    const result = await migrateDistillData({ legacyDir, currentDir });

    expect(result.status).toBe("failed");
    expect(existsSync(join(currentDir, ".migrated-from-legacy-distill"))).toBe(false);
  });

  const oldRecall = { ts: "2026-01-01T00:00:00Z", before: 10, after: 2, summary: "old" };
  const sameRecall = { ts: "2026-01-02T00:00:00Z", before: 11, after: 3, summary: "same" };
  const newRecall = { ts: "2026-01-03T00:00:00Z", before: 12, after: 4, summary: "new" };
  const objectEnvelope = '  {"records":[{"summary":"historical"}]}\n';
  const nullEnvelope = "  null\n";
  for (const { label, relativePath, source, destination } of [
    { label: "root object source with no destination", relativePath: "recall.json", source: objectEnvelope, destination: undefined },
    { label: "project null source with no destination", relativePath: "projects/fixture/recall.json", source: nullEnvelope, destination: undefined },
    { label: "identical root object envelopes", relativePath: "recall.json", source: objectEnvelope, destination: objectEnvelope },
    { label: "identical project null envelopes", relativePath: "projects/fixture/recall.json", source: nullEnvelope, destination: nullEnvelope },
    { label: "root null source with a valid destination", relativePath: "recall.json", source: nullEnvelope, destination: JSON.stringify([newRecall]) + "\n" },
    { label: "project object source with a valid destination", relativePath: "projects/fixture/recall.json", source: objectEnvelope, destination: JSON.stringify([newRecall]) + "\n" },
    { label: "root null destination with a valid source", relativePath: "recall.json", source: "[]\n", destination: nullEnvelope },
    { label: "project object destination with a valid source", relativePath: "projects/fixture/recall.json", source: "[]\n", destination: objectEnvelope },
  ]) {
    test(`rejects ${label}, preserves bytes and retries after repair`, async () => {
      const root = tempRoot();
      const legacyDir = join(root, legacyName());
      const currentDir = join(root, "dc-distill");
      const sourcePath = join(legacyDir, relativePath);
      const destinationPath = join(currentDir, relativePath);
      const markerPath = join(currentDir, ".migrated-from-legacy-distill");
      await write(sourcePath, source);
      if (destination !== undefined) await write(destinationPath, destination);

      const result = await migrateDistillData({ legacyDir, currentDir });

      expect(result.status).toBe("failed");
      expect(result.errors).toEqual([`${relativePath}: Recall file must contain a JSON array`]);
      expect(result.copied).toEqual([]);
      expect(result.merged).toEqual([]);
      expect(readFileSync(sourcePath, "utf8")).toBe(source);
      if (destination === undefined) expect(existsSync(destinationPath)).toBe(false);
      else expect(readFileSync(destinationPath, "utf8")).toBe(destination);
      expect(existsSync(markerPath)).toBe(false);

      const repairedSource = JSON.stringify([oldRecall, sameRecall]) + "\n";
      await write(sourcePath, repairedSource);
      if (destination !== undefined) {
        await write(destinationPath, JSON.stringify([sameRecall, newRecall]) + "\n");
      }
      const retry = await migrateDistillData({ legacyDir, currentDir });

      expect(retry.status).toBe("migrated");
      expect(retry.errors).toEqual([]);
      expect(existsSync(markerPath)).toBe(true);
      expect(readFileSync(sourcePath, "utf8")).toBe(repairedSource);
      const migrated = JSON.parse(readFileSync(destinationPath, "utf8"));
      expect(migrated.map((entry: { summary: string }) => entry.summary)).toEqual(
        destination === undefined ? ["old", "same"] : ["old", "same", "new"],
      );
      const completed = await migrateDistillData({ legacyDir, currentDir });
      expect(completed.status).toBe("skipped");
    });
  }

  test("marker-write failure retries idempotently without creating conflicts", async () => {
    const root = tempRoot();
    const legacyDir = join(root, legacyName());
    const currentDir = join(root, "dc-distill");
    await write(join(legacyDir, "settings.json"), "{\"key\":1}\n");

    const spy = spyOn(Fs, "write").mockImplementationOnce(() => {
      throw new Error("forced marker failure");
    });
    const first = await migrateDistillData({ legacyDir, currentDir });
    spy.mockRestore();
    expect(first.status).toBe("failed");
    expect(existsSync(join(currentDir, ".migrated-from-legacy-distill"))).toBe(false);

    const retry = await migrateDistillData({ legacyDir, currentDir });
    expect(retry.status).toBe("migrated");
    expect(existsSync(join(currentDir, ".migrated-from-legacy-distill"))).toBe(true);
    expect(existsSync(join(currentDir, ".legacy-migration-conflicts", "settings.json"))).toBe(false);
  });
});

test("location source has an independent marker and preserves conflicts and absolute references", async () => {
  const root = tempRoot();
  const locationDir = join(root, "old", "dc-distill");
  const currentDir = join(root, "agent", "data", "dc-distill");
  await write(join(locationDir, "tool-output", "index.jsonl"), '{"artifactPath":"/historical/absolute/file"}\n');
  await write(join(locationDir, "raw.txt"), "old");
  await write(join(currentDir, "raw.txt"), "new");
  await write(join(currentDir, ".migrated-from-legacy-distill"), "already branded");
  const options = { locationDir, legacyDir: join(root, "absent"), currentDir };
  const result = await migrateDistillData(options);
  expect(result.status).toBe("migrated");
  expect(existsSync(join(currentDir, ".migrated-from-legacy-location-dc-distill"))).toBe(true);
  expect(readFileSync(join(currentDir, "tool-output", "index.jsonl"), "utf8")).toContain('/historical/absolute/file');
  expect(readFileSync(join(currentDir, "raw.txt"), "utf8")).toBe("new");
  expect(readFileSync(join(locationDir, "raw.txt"), "utf8")).toBe("old");
  expect(result.preserved).toEqual([".legacy-migration-conflicts/dc-distill/raw.txt"]);
});

test("custom profiles migrate only their own legacy namespaces", async () => {
  const previous = process.env.PI_CODING_AGENT_DIR;
  const root = tempRoot();
  try {
    process.env.PI_CODING_AGENT_DIR = join(root, "profile");
    await write(join(root, "profile", "data", "dc-shrink", "own.txt"), "custom");
    const result = await migrateDistillData();
    expect(result.status).toBe("migrated");
    expect(result.copied).toEqual(["own.txt"]);
    expect(readFileSync(join(root, "profile", "data", "dc-distill", "own.txt"), "utf8")).toBe("custom");
    expect(existsSync(join(root, "profile", "data", "dc-distill", ".migrated-from-legacy-location-dc-distill"))).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});

test("conflicting dump JSONL is preserved intact rather than line merged", async () => {
  const root = tempRoot();
  const legacyDir = join(root,"legacy"), currentDir = join(root,"current");
  await write(join(legacyDir,"compact-dumps","one-before.jsonl"),'{"historical":true}\n');
  await write(join(currentDir,"compact-dumps","one-before.jsonl"),'{"current":true}\n');
  const result = await migrateDistillData({legacyDir,currentDir});
  expect(result.merged).toEqual([]);
  expect(readFileSync(join(currentDir,"compact-dumps","one-before.jsonl"),"utf8")).toBe('{"current":true}\n');
  expect(readFileSync(join(currentDir,".legacy-migration-conflicts","compact-dumps","one-before.jsonl"),"utf8")).toBe('{"historical":true}\n');
});

test("migration and live recall writers share the destination lock", async () => {
  const {DistillStore} = await import("./store.ts");
  const root = tempRoot();
  const legacyDir = join(root,"legacy"), currentDir = join(root,"current");
  const projectRoot = join(currentDir,"projects","same");
  const old = {ts:"2026-01-01T00:00:00Z",before:100,after:10,summary:"migrated",project:"/project"};
  await write(join(legacyDir,"projects","same","recall.json"),JSON.stringify([old]));
  const store = new DistillStore({dataDir:currentDir,projectRoot,projectIdentity:"/project"});
  await Promise.all([migrateDistillData({legacyDir,currentDir}),
    store.persistRecall({...old,ts:"2026-01-02T00:00:00Z",summary:"live"})]);
  expect((await store.loadRecall()).map(row=>row.summary).sort()).toEqual(["live","migrated"]);
});
