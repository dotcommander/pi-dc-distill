import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const diagUrl = new URL("./diag-support.ts", import.meta.url).href;

function isolated(code: string, setup?: (home: string) => void, debug = "") {
  const home = mkdtempSync(join(tmpdir(), "distill-diag-"));
  setup?.(home);
  const result = spawnSync(process.execPath, ["-e", `import { Diag } from ${JSON.stringify(diagUrl)}; ${code}`], {
    env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: join(home, ".pi", "agent"), PI_DEBUG: debug }, encoding: "utf8",
  });
  expect(result.status).toBe(0);
  return { home, stderr: result.stderr, dir: join(home, ".pi/agent/data/dc-distill") };
}

const oversized = "x".repeat(5 * 1024 * 1024 + 1);

test("diagnostic sinks share dc-distill while preserving historical files and ordered monitor text", () => {
  const { home, dir, stderr } = isolated(`
    Diag.warn("test", "first", new Error("detail"));
    await Promise.all([Diag.monitor("one"), Diag.monitor("two"), Diag.monitor("three")]);
  `, (home) => {
    const old = join(home, ".pi/data/pi-dc-distill");
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, "diag.ndjson"), "historical");
  });
  const entry = JSON.parse(readFileSync(join(dir, "diag.ndjson"), "utf8"));
  expect(entry).toMatchObject({ level: "warn", scope: "test", msg: "first", err: { name: "Error", message: "detail" } });
  expect(Number.isFinite(Date.parse(entry.ts))).toBe(true);
  expect(readFileSync(join(dir, "diag.log"), "utf8").split("\n").filter(Boolean).map((line) => line.slice(25))).toEqual(["one", "two", "three"]);
  expect(readFileSync(join(home, ".pi/data/pi-dc-distill/diag.ndjson"), "utf8")).toBe("historical");
  expect(stderr).toBe("");
});

test("both sinks rotate on later writes and preserve existing archives", () => {
  const { dir } = isolated(`
    Diag.warn("test", "first");
    await Diag.monitor("first");
    const { writeFileSync } = await import("node:fs");
    const { Path } = await import(${JSON.stringify(new URL("./paths.ts", import.meta.url).href)});
    const dir = Path.data("dc-distill");
    writeFileSync(dir.join("diag.log"), "x".repeat(5 * 1024 * 1024 + 1));
    writeFileSync(dir.join("diag.ndjson"), "x".repeat(5 * 1024 * 1024 + 1));
    Diag.debug("test", "second");
    await Diag.monitor("second");
  `, (home) => {
    const dir = join(home, ".pi/agent/data/dc-distill");
    mkdirSync(dir, { recursive: true });
    for (const sink of ["diag.log", "diag.ndjson"]) {
      writeFileSync(join(dir, sink), oversized);
      writeFileSync(join(dir, `${sink}.old`), "preserved archive");
    }
  });
  for (const sink of ["diag.log", "diag.ndjson"]) {
    expect(readFileSync(join(dir, `${sink}.old`), "utf8")).toBe("preserved archive");
    expect(readdirSync(dir).filter((name) => name.startsWith(`${sink}.old.`))).toHaveLength(2);
    expect(readFileSync(join(dir, sink), "utf8")).toContain("second");
  }
});

test("exact threshold remains unrotated until the next append", () => {
  const { dir } = isolated(`Diag.warn("test", "append"); await Diag.monitor("append");`, (home) => {
    const dir = join(home, ".pi/agent/data/dc-distill");
    mkdirSync(dir, { recursive: true });
    for (const sink of ["diag.log", "diag.ndjson"]) writeFileSync(join(dir, sink), "x".repeat(5 * 1024 * 1024));
  });
  expect(readdirSync(dir).sort()).toEqual(["diag.log", "diag.ndjson"]);
});

test("storage failures are best effort and PI_DEBUG still mirrors errors", () => {
  const { stderr } = isolated(`Diag.error("test", "failed", new Error("detail")); await Diag.monitor("ignored");`, (home) => {
    writeFileSync(join(home, ".pi"), "blocks directory");
  }, "stack");
  expect(stderr).toContain("[test] error: failed — detail");
});
