import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  Path,
  agentDir,
  assertSafeExtName,
  cacheDir,
  dataDir,
  projectDir,
  projectSlug,
} from "./paths.ts";

// Tests use unique namespaces beneath the selected Pi agent profile.
const STAMP = `${process.pid}-${Date.now().toString(36)}`;
const created: string[] = [];

function trackedDataDir(ext: string): string {
  const p = dataDir(ext);
  created.push(p);
  return p;
}

function trackedCacheDir(ext: string): string {
  const p = cacheDir(ext);
  created.push(p);
  return p;
}

afterAll(() => {
  // Remove only the namespaces this run created; never touch other data.
  for (const p of created) rmSync(p, { recursive: true, force: true });
});

describe("assertSafeExtName", () => {
  test("accepts bare names", () => {
    expect(() => assertSafeExtName("dc-distill")).not.toThrow();
    expect(() => assertSafeExtName("a.b")).not.toThrow();
  });

  test("rejects separators, dot segments, and empties", () => {
    for (const bad of ["", "  ", ".", "..", "a/b", "a\\b", "../other"]) {
      expect(() => assertSafeExtName(bad)).toThrow(TypeError);
    }
  });
});

describe("dataDir / cacheDir", () => {
  test("dataDir creates and returns ~/.pi/agent/data/<ext>", () => {
    const p = trackedDataDir(`dc-pathtest-${STAMP}`);
    expect(p).toBe(join(agentDir(), "data", `dc-pathtest-${STAMP}`));
    expect(existsSync(p)).toBe(true);
  });

  test("cacheDir creates and returns ~/.pi/agent/cache/<ext>", () => {
    const p = trackedCacheDir(`dc-pathtest-${STAMP}`);
    expect(p).toBe(join(agentDir(), "cache", `dc-pathtest-${STAMP}`));
    expect(existsSync(p)).toBe(true);
  });
});

describe("projectSlug / projectDir", () => {
  test("slug is basename + 8-hex hash, stable per cwd", () => {
    const slug = projectSlug("/Users/x/code/vvw");
    expect(slug).toMatch(/^[a-zA-Z0-9-]{1,24}-[0-9a-f]{8}$/);
    expect(slug.startsWith("vvw-")).toBe(true);
    expect(projectSlug("/Users/x/code/vvw")).toBe(slug);
    expect(projectSlug("/Users/x/code/other")).not.toBe(slug);
  });

  test("projectDir lands under data/<ext>/projects/<slug> without cross-profile caching", () => {
    const ext = `dc-pathtest-proj-${STAMP}`;
    const p = projectDir(ext, `${tmpdir()}/proj-one`);
    created.push(p);
    expect(p.startsWith(join(agentDir(), "data", ext, "projects"))).toBe(
      true,
    );
    expect(existsSync(p)).toBe(true);
    expect(projectDir(ext, `${tmpdir()}/proj-one`)).toBe(p);
  });
});

describe("Path facade", () => {
  test("Path.data handle: join containment, read/write round-trip", () => {
    const h = Path.data(`dc-pathtest-h-${STAMP}`);
    created.push(h.path);
    expect(h.path).toBe(join(agentDir(), "data", `dc-pathtest-h-${STAMP}`));
    expect(h.join("recall.json")).toBe(join(h.path, "recall.json"));
    expect(h.exists("recall.json")).toBe(false);
    h.write("recall.json", [{ q: "query" }]);
    expect(h.exists("recall.json")).toBe(true);
    expect(h.read<unknown>("recall.json")).toEqual([{ q: "query" }]);
    // write output is pretty JSON with trailing newline
    const bytes = readFileSync(join(h.path, "recall.json"), "utf8");
    expect(bytes.endsWith("\n")).toBe(true);
    expect(bytes).toContain("\n  ");
  });

  test("read falls back to default only when provided", () => {
    const h = Path.data(`dc-pathtest-h-${STAMP}`);
    expect(h.read<unknown[]>("missing.json", [])).toEqual([]);
    expect(() => h.read("missing.json")).toThrow(/File not found/);
  });

  test("readText/writeText round-trip with fallback", () => {
    const h = Path.cache(`dc-pathtest-h-${STAMP}`);
    created.push(h.path);
    expect(h.readText("notes.txt", "fallback")).toBe("fallback");
    h.writeText("notes.txt", "body");
    expect(h.readText("notes.txt")).toBe("body");
  });

  test("names escaping the base directory throw", () => {
    const h = Path.data(`dc-pathtest-h-${STAMP}`);
    expect(() => h.join("../escape")).toThrow(/escapes base directory/);
    expect(() => h.join("/absolute")).toThrow(/must be relative/);
  });

  test("invalid JSON read throws with file path", () => {
    const h = Path.data(`dc-pathtest-h-${STAMP}`);
    writeFileSync(join(h.path, "bad.json"), "{oops", "utf8");
    expect(() => h.read("bad.json")).toThrow(/Invalid JSON/);
  });

  test("Path.project handle is scoped per cwd", () => {
    const ext = `dc-pathtest-sc-${STAMP}`;
    const a = Path.project(ext, `${tmpdir()}/alpha`).path;
    const b = Path.project(ext, `${tmpdir()}/beta`).path;
    created.push(a, b);
    expect(a).not.toBe(b);
    expect(a).toContain("alpha-");
    expect(b).toContain("beta-");
  });
});

test("agent roots are lazy, expand tilde, and never reuse old project paths", () => {
  const previous = process.env.PI_CODING_AGENT_DIR;
  try {
    delete process.env.PI_CODING_AGENT_DIR;
    expect(agentDir()).toBe(join(homedir(), ".pi", "agent"));
    process.env.PI_CODING_AGENT_DIR = "~/.pi/custom-profile";
    expect(agentDir()).toBe(join(homedir(), ".pi", "custom-profile"));
    process.env.PI_CODING_AGENT_DIR = join(tmpdir(), `profile-one-${STAMP}`);
    const first = projectDir("dc-distill", "/same/project");
    created.push(join(agentDir(), "data"));
    process.env.PI_CODING_AGENT_DIR = join(tmpdir(), `profile-two-${STAMP}`);
    const second = projectDir("dc-distill", "/same/project");
    created.push(join(agentDir(), "data"));
    expect(first).not.toBe(second);
    expect(second.startsWith(agentDir())).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});
