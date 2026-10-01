import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Fs, withLock, writeFileAtomicSync } from "./fs-support.ts";

let dir: string;
let locksDir: string;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("atomic writes", () => {
  test("Fs.writeSync writes exact content and leaves no temp files", () => {
    dir = mkdtempSync(join(tmpdir(), "dc-fs-support-"));
    const target = join(dir, "sub", "sync.txt");
    Fs.writeSync(target, "line1\nline2");
    expect(readFileSync(target, "utf8")).toBe("line1\nline2");
    const leftovers = readdirSync(join(dir, "sub"));
    expect(leftovers).toEqual(["sync.txt"]);
  });

  test("Fs.write (async) writes content atomically", async () => {
    const target = join(dir, "async.txt");
    await Fs.write(target, "async-body");
    expect(readFileSync(target, "utf8")).toBe("async-body");
  });

  test("writeFileAtomicSync replaces existing content", () => {
    const target = join(dir, "replace.json");
    writeFileSync(target, "old", "utf8");
    writeFileAtomicSync(target, "new");
    expect(readFileSync(target, "utf8")).toBe("new");
  });

  test("Fs.read and Fs.exists", async () => {
    const target = join(dir, "read.txt");
    expect(await Fs.exists(target)).toBe(false);
    await Fs.write(target, "body");
    expect(await Fs.exists(target)).toBe(true);
    expect(await Fs.read(target)).toBe("body");
  });
});

describe("withLock", () => {
  test("runs fn under an exclusive lock and releases it", async () => {
    locksDir = join(dir, "locks");
    mkdirSync(locksDir, { recursive: true });
    const lockPath = join(locksDir, "a.lock");
    const value = await withLock(lockPath, "test-owner", async () => 42);
    expect(value).toBe(42);
    // Lock file removed after release.
    expect(await Fs.exists(lockPath)).toBe(false);
  });

  test("second acquisition after release succeeds", async () => {
    const lockPath = join(locksDir, "b.lock");
    await withLock(lockPath, "first", async () => {});
    const second = await withLock(lockPath, "second", async () => "ok");
    expect(second).toBe("ok");
  });

  test("live contention throws after retries exhausted", async () => {
    const lockPath = join(locksDir, "c.lock");
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, owner: "live-holder", acquiredAt: new Date().toISOString() }, null, 2) + "\n",
      "utf8",
    );
    let threw: unknown;
    try {
      await withLock(lockPath, "contender", async () => {}, {
        retries: 1,
        delayMs: 5,
      });
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeInstanceOf(Error);
    expect((threw as Error).message).toContain("Lock held by");
  });

  test("stale lock (dead PID) is taken over and cleaned", async () => {
    const lockPath = join(locksDir, "d.lock");
    // PID 4_194_303 exceeds macOS pid_max; kill(pid, 0) → ESRCH.
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: 4_194_303, owner: "dead-holder", acquiredAt: new Date().toISOString() }, null, 2) + "\n",
      "utf8",
    );
    const value = await withLock(lockPath, "resurrector", async () => "taken");
    expect(value).toBe("taken");
    expect(await Fs.exists(lockPath)).toBe(false);
  });

  test("unparseable lock is discarded via atomic rename", async () => {
    const lockPath = join(locksDir, "e.lock");
    writeFileSync(lockPath, "{not json", "utf8");
    const value = await withLock(lockPath, "sweeper", async () => "cleaned");
    expect(value).toBe("cleaned");
  });

  test("thrown fn still releases the lock", async () => {
    const lockPath = join(locksDir, "f.lock");
    let threw: unknown;
    try {
      await withLock(lockPath, "thrower", async () => {
        throw new Error("fn boom");
      });
    } catch (err) {
      threw = err;
    }
    expect((threw as Error).message).toBe("fn boom");
    expect(await Fs.exists(lockPath)).toBe(false);
  });

  test("lock info file carries pid, owner, acquiredAt", async () => {
    const lockPath = join(locksDir, "g.lock");
    let observed: string | undefined;
    await withLock(lockPath, "inspector", async () => {
      observed = readFileSync(lockPath, "utf8");
    });
    const info = JSON.parse(observed!);
    expect(info.pid).toBe(process.pid);
    expect(info.owner).toBe("inspector");
    expect(typeof info.acquiredAt).toBe("string");
    expect(existsSync(lockPath)).toBe(false);
  });
});
