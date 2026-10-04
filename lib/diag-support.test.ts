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
  expect(entry).toMatchObject({ level: "warn", scope: "test", msg: "first", session: "unknown", err: { name: "Error", message: "detail" } });
  expect(Number.isInteger(entry.pid) && entry.pid > 0).toBe(true);
  expect(Number.isFinite(Date.parse(entry.ts))).toBe(true);
  expect(readFileSync(join(dir, "diag.log"), "utf8").split("\n").filter(Boolean).map((line) => line.slice(25))).toEqual(
    ["one", "two", "three"].map((msg) => `${msg} session=unknown pid=${entry.pid}`),
  );
  expect(readFileSync(join(home, ".pi/data/pi-dc-distill/diag.ndjson"), "utf8")).toBe("historical");
  expect(stderr).toBe("");
});

test("all shared sinks capture full owner provenance and clear it after shutdown", () => {
  const session = "primary-session-full-identity-123456789";
  const { dir } = isolated(`
    Diag.setOwnerSession(${JSON.stringify(session)});
    Diag.warn("test", "owned warn");
    Diag.error("test", "owned error");
    Diag.debug("test", "owned debug");
    const queued = Diag.monitor("owned queued");
    const tagged = Diag.monitor("already tagged session=${session} pid=" + process.pid);
    Diag.setOwnerSession(null);
    Diag.warn("test", "after shutdown");
    await Promise.all([queued, tagged, Diag.monitor("unknown queued")]);
  `);
  const entries = readFileSync(join(dir, "diag.ndjson"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  expect(entries.map((entry) => entry.session)).toEqual([session, session, session, "unknown"]);
  expect(new Set(entries.map((entry) => entry.pid)).size).toBe(1);
  expect(Number.isInteger(entries[0].pid) && entries[0].pid > 0).toBe(true);
  const lines = readFileSync(join(dir, "diag.log"), "utf8").trim().split("\n");
  expect(lines[0]).toContain(`session=${session} pid=${entries[0].pid}`);
  expect(lines[1].match(/session=/g)).toHaveLength(1);
  expect(lines[1].match(/pid=/g)).toHaveLength(1);
  expect(lines[2]).toContain(`session=unknown pid=${entries[0].pid}`);
});

test("invalid owner identity and hostile error formatting remain best effort and total", () => {
  const { dir } = isolated(`
    Diag.setOwnerSession("   ");
    Diag.warn("test", "hostile error", { toString() { throw new Error("cannot format"); } });
    Diag.error("test", "still usable");
    await Diag.monitor("still usable");
  `);
  const entries = readFileSync(join(dir, "diag.ndjson"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  expect(entries).toHaveLength(2);
  expect(entries[0]).toMatchObject({ session: "unknown", err: { message: "unavailable error details" } });
  expect(entries[1]).toMatchObject({ session: "unknown", msg: "still usable" });
});

test("text session provenance escapes whitespace and control characters without losing NDJSON identity", () => {
  const session = "owner\nnext field\t\u0000";
  const { dir } = isolated(`
    Diag.setOwnerSession(${JSON.stringify(session)});
    Diag.warn("test", "identity");
    await Diag.monitor("identity");
  `);
  const entry = JSON.parse(readFileSync(join(dir, "diag.ndjson"), "utf8"));
  expect(entry.session).toBe(session);
  const lines = readFileSync(join(dir, "diag.log"), "utf8").trim().split("\n");
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("session=owner%0Anext%20field%09%00");
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
