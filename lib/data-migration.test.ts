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

    const result = migrateDistillData({ legacyDir, currentDir, now: () => new Date("2026-01-01T00:00:00Z") });

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

    const result = migrateDistillData({ legacyDir, currentDir });

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

    const result = migrateDistillData({ legacyDir, currentDir });

    expect(result.status).toBe("migrated");
    expect(result.preserved).toEqual([".legacy-migration-conflicts/config.json"]);
    expect(readFileSync(join(currentDir, "config.json"), "utf8")).toBe("current");
    expect(readFileSync(join(currentDir, ".legacy-migration-conflicts", "config.json"), "utf8")).toBe("legacy");
  });

  test("skips after the migration flag exists", () => {
    const root = tempRoot();
    const legacyDir = join(root, legacyName());
    const currentDir = join(root, "dc-distill");
    mkdirSync(legacyDir, { recursive: true });
    mkdirSync(currentDir, { recursive: true });
    writeFileSync(join(legacyDir, "placeholder"), "legacy", { flag: "w" });
    writeFileSync(join(currentDir, ".migrated-from-legacy-distill"), "{}\n");

    const result = migrateDistillData({ legacyDir, currentDir });

    expect(result.status).toBe("skipped");
  });

  test("routes migration flag-file write through atomic Fs.writeSync", async () => {
    const root = tempRoot();
    const legacyDir = join(root, legacyName());
    const currentDir = join(root, "dc-distill");
    await write(join(legacyDir, "settings.json"), "{\"key\":1}\n");

    const spy = spyOn(Fs, "writeSync" as any);
    try {
      migrateDistillData({ legacyDir, currentDir, now: () => new Date("2026-01-01T00:00:00Z") });
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

    const result = migrateDistillData({ legacyDir, currentDir });

    expect(result.status).toBe("failed");
    expect(existsSync(join(currentDir, ".migrated-from-legacy-distill"))).toBe(false);
  });

  test("marker-write failure retries idempotently without creating conflicts", async () => {
    const root = tempRoot();
    const legacyDir = join(root, legacyName());
    const currentDir = join(root, "dc-distill");
    await write(join(legacyDir, "settings.json"), "{\"key\":1}\n");

    const spy = spyOn(Fs, "writeSync" as any).mockImplementationOnce(() => {
      throw new Error("forced marker failure");
    });
    const first = migrateDistillData({ legacyDir, currentDir });
    spy.mockRestore();
    expect(first.status).toBe("failed");
    expect(existsSync(join(currentDir, ".migrated-from-legacy-distill"))).toBe(false);

    const retry = migrateDistillData({ legacyDir, currentDir });
    expect(retry.status).toBe("migrated");
    expect(existsSync(join(currentDir, ".migrated-from-legacy-distill"))).toBe(true);
    expect(existsSync(join(currentDir, ".legacy-migration-conflicts", "settings.json"))).toBe(false);
  });
});
