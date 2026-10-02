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

  test.each(["{not json", JSON.stringify({ pid: 4_194_303, owner: "dead", acquiredAt: "old" })])("ambiguous and dead-owner locks remain untouched: %s", async (original) => {
    const lockPath = join(locksDir, `preserved-${crypto.randomUUID()}.lock`);
    writeFileSync(lockPath, original);
    await expect(withLock(lockPath, "contender", async () => {}, { retries: 0 })).rejects.toThrow("Lock held by");
    expect(readFileSync(lockPath, "utf8")).toBe(original);
  });

  test("release preserves a lock replaced by a different owner", async () => {
    const lockPath = join(locksDir, "replaced.lock");
    const replacement = JSON.stringify({ nonce: "other-owner" });
    await withLock(lockPath, "original", async () => {
      rmSync(lockPath);
      writeFileSync(lockPath, replacement);
    });
    expect(readFileSync(lockPath, "utf8")).toBe(replacement);
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


test("atomic pre-publication failure preserves destination and removes temporary file", async () => {
  const target = join(dir, "publication-failure.txt");
  writeFileSync(target, "original");
  const { writeFileAtomic } = await import("./fs-support.ts");
  await expect(writeFileAtomic(target, "new", 0, () => { throw new Error("stop publication"); })).rejects.toThrow("stop publication");
  expect(readFileSync(target, "utf8")).toBe("original");
  expect(readdirSync(dir).filter(name => name.startsWith("publication-failure.txt.tmp"))).toEqual([]);
});

test("multiprocess hard-link publication serializes complete critical sections", async () => {
  const target = join(dir, "multiprocess.txt");
  const lock = `${target}.lock`;
  writeFileSync(target, "0");
  const modulePath = new URL("./fs-support.ts", import.meta.url).pathname;
  const script = `import {withLock} from ${JSON.stringify(modulePath)}; import {readFile,writeFile} from 'node:fs/promises';
    for(let i=0;i<4;i++) await withLock(${JSON.stringify(lock)},'child:'+process.pid,async()=>{
      const value=Number(await readFile(${JSON.stringify(target)},'utf8'));
      await new Promise(r=>setTimeout(r,5)); await writeFile(${JSON.stringify(target)},String(value+1));
    },{retries:200,delayMs:5});`;
  const children = Array.from({length:3}, () => Bun.spawn([process.execPath, "--eval", script], { stdout: "pipe", stderr: "pipe" }));
  expect(await Promise.all(children.map(child => child.exited))).toEqual([0,0,0]);
  expect(readFileSync(target,"utf8")).toBe("12");
});
