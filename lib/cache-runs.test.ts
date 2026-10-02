import { spawn } from "node:child_process";
import { expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { CACHE_RUN_MARKER, createCacheRun, finalizeCacheRun, protectCacheOutput, type CacheRun } from "./cache-runs.ts";
import { Fs } from "./fs-support.ts";

const root = () => mkdtempSync(join(tmpdir(), "distill-cache-test-"));
const marker = (directory: string) => JSON.parse(readFileSync(join(directory, CACHE_RUN_MARKER), "utf8"));

test("twelve completed successes and failures retain ten; preserve active, unmanaged, malformed and symlink runs", async () => {
  const cache = root();
  const active = createCacheRun("evaluations", cache);
  const parent = dirname(active.directory);
  const unmanaged = join(parent, "unmanaged");
  const malformed = join(parent, "malformed");
  mkdirSync(unmanaged); mkdirSync(malformed);
  writeFileSync(join(malformed, CACHE_RUN_MARKER), '{"version":1}');
  const outside = root();
  writeFileSync(join(outside, "keep.txt"), "preserved");
  symlinkSync(outside, join(parent, "linked"));
  const runs: CacheRun[] = [];
  for (let index = 0; index < 12; index++) {
    const run = createCacheRun("evaluations", cache);
    runs.push(run);
    await finalizeCacheRun(run, index % 2 === 0);
  }
  expect(runs.filter(run => existsSync(run.directory))).toHaveLength(10);
  expect(existsSync(runs[0]!.directory)).toBe(false);
  expect(existsSync(runs[1]!.directory)).toBe(false);
  expect(marker(runs[11]!.directory).result).toBe("failure");
  for (const directory of [active.directory, unmanaged, malformed, join(parent, "linked")]) expect(existsSync(directory)).toBe(true);
  expect(readFileSync(join(outside, "keep.txt"), "utf8")).toBe("preserved");
});

test("concurrent finalization serializes retention and counts failed completions", async () => {
  const cache = root();
  const runs = Array.from({ length: 12 }, () => createCacheRun("compare", cache));
  await Promise.all(runs.map((run, index) => finalizeCacheRun(run, index % 2 === 0)));
  expect(runs.filter(run => existsSync(run.directory))).toHaveLength(10);
  expect(readdirSync(dirname(runs[0]!.directory)).filter(name => name.startsWith("run-"))).toHaveLength(10);
});

test("explicit outputs protect their managed ancestor before writes and remain outside retention", async () => {
  const cache = root();
  const run = createCacheRun("evaluations", cache);
  await finalizeCacheRun(run, true);
  await protectCacheOutput(join(run.directory, "nested-output"));
  expect(marker(run.directory).protected).toBe(true);
  for (let index = 0; index < 12; index++) await finalizeCacheRun(createCacheRun("evaluations", cache), true);
  expect(existsSync(run.directory)).toBe(true);
  const explicit = join(cache, "explicit");
  mkdirSync(explicit);
  await protectCacheOutput(explicit);
  expect(existsSync(join(explicit, CACHE_RUN_MARKER))).toBe(false);
});

test("cleanup errors report but do not reject the caller's result", async () => {
  const run = createCacheRun("demo", root());
  const lock = spyOn(Fs, "withLock").mockRejectedValue(new Error("cleanup denied"));
  const warning = spyOn(console, "warn").mockImplementation(() => {});
  try {
    await expect(finalizeCacheRun(run, false)).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalled();
    expect(marker(run.directory).completedAt).toBeUndefined();
  } finally { lock.mockRestore(); warning.mockRestore(); }
});

test("explicit outputs through symlink aliases protect the real managed run", async () => {
  const cache = root();
  const run = createCacheRun("evaluations", cache);
  await finalizeCacheRun(run, true);
  const alias = join(cache, "alias");
  symlinkSync(run.directory, alias);
  await protectCacheOutput(join(alias, "missing", "output"));
  expect(marker(run.directory).protected).toBe(true);
  for (let index = 0; index < 12; index++) await finalizeCacheRun(createCacheRun("evaluations", cache), true);
  expect(existsSync(run.directory)).toBe(true);
  expect(existsSync(alias)).toBe(true);
});

test("independent processes finalize under the same category lock", async () => {
  const cache = root();
  const runs = Array.from({ length: 12 }, () => createCacheRun("e2e", cache));
  const module = new URL("./cache-runs.ts", import.meta.url).href;
  await Promise.all(runs.map((run, index) => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", `import { finalizeCacheRun } from ${JSON.stringify(module)}; await finalizeCacheRun(${JSON.stringify(run)}, ${index % 2 === 0});`], {
      env: process.env, stdio: ["ignore", "pipe", "pipe"],
    });
    let errors = "";
    child.stderr.on("data", data => { errors += data; });
    child.once("error", reject);
    child.once("exit", code => code === 0 && errors === "" ? resolve() : reject(new Error(`child=${code}: ${errors}`)));
  })));
  expect(runs.filter(run => existsSync(run.directory))).toHaveLength(10);
  expect(runs.filter(run => existsSync(run.directory)).every(run => marker(run.directory).completedAt !== undefined)).toBe(true);
}, 30_000);
