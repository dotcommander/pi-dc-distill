import { describe, expect, test } from "bun:test";
import { readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import setupDistill from "./index.ts";
import { createStubCtx } from "./tests/harness/fake-pi.ts";

const root = import.meta.dir;
const activeDocuments = [
  "README.md", "AGENTS.md", "docs/README.md", "docs/algorithm.md",
  "docs/architecture.md", "docs/usage.md", "docs/settings.md",
  "docs/troubleshooting.md", "docs/releasing.md",
];

async function documents() {
  return Promise.all(activeDocuments.map(async (file) => ({
    file, text: await readFile(join(root, file), "utf8"),
  })));
}

function slashCommands(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/`\/([a-zA-Z][\w:-]*)(?:[ <'][^`]*)?`/g)) names.add(match[1]!);
  for (const match of text.matchAll(/^\/([a-zA-Z][\w:-]*)/gm)) names.add(match[1]!);
  return [...names];
}

describe("current product documentation contract", () => {
  test("advertised commands are Pi-native and extension registration adds no commands or tools", async () => {
    const stub = createStubCtx();
    setupDistill(stub.pi);
    expect(stub.registeredCommands.size).toBe(0);
    expect(stub.registeredTools.size).toBe(0);
    expect(stub.registeredHooks.has("session_before_compact")).toBe(true);
    expect(stub.registeredHooks.has("session_compact")).toBe(true);
    for (const doc of await documents()) {
      for (const name of slashCommands(doc.text)) {
        expect(name, `${doc.file} advertises a non-native command`).toBe("compact");
      }
    }
    const usage = await readFile(join(root, "docs/usage.md"), "utf8");
    expect(usage).toContain("| `/compact [instructions]` | Pi's native");
  });

  test("package publication files cover the documented production allowlist", async () => {
    const architecture = await readFile(join(root, "docs/architecture.md"), "utf8");
    const sentence = architecture.split("\n").find((line) => line.startsWith("The production allowlist is"));
    expect(sentence).toBeDefined();
    const modules: string[] = [];
    for (const match of sentence!.matchAll(/`([^`]+)`/g)) {
      const part = match[1]!;
      const brace = part.match(/^(.*)\/\{([^}]+)\}\.ts$/);
      if (brace) for (const name of brace[2]!.split(",")) modules.push(`${brace[1]}/${name}.ts`);
      else if (part.endsWith(".ts")) modules.push(part);
    }
    expect(modules.length).toBeGreaterThan(0);
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    for (const module of modules)
      expect(pkg.files as string[], `${module} missing from package.json files`).toContain(module);
  });

  test("active docs cannot promise retired public entrypoints or numbered schemas", async () => {
    for (const doc of await documents()) {
      expect(doc.text, doc.file).not.toMatch(/details\.version|checkpointSections|compileSessionJsonl\(|compileSessionFile\(|request-candidate-v\d|schema-v\d/);
      expect(doc.text, doc.file).not.toMatch(/bun run distill:(?:quality|performance|compare|demo)|dc-distill-session/);
    }
  });

  test("cutover and archive boundaries preserve history without advertising compatibility", async () => {
    const readme = await readFile(join(root, "README.md"), "utf8");
    expect(readme).toContain("Start a fresh session");
    expect(readme).toContain("Existing incompatible sessions must use the old extension");
    expect(readme).toContain("Stored data and existing session files are preserved");
    const index = await readFile(join(root, "docs/README.md"), "utf8");
    expect(index).toContain(".work/docs-archive/");
    for (const moved of ["docs/specs/", "docs/adr/", "docs/compiler-benchmark.md", "docs/assets/"]) expect(index).not.toContain(moved);
    expect(index).toContain("excluded from the current product contract and package publication");
    const archivedAdr = await readFile(join(root, ".work/docs-archive/adr/0002-remove-vendored-framework.md"), "utf8");
    expect(archivedAdr).toContain("# ADR 0002");
    expect(await readlink(join(root, "CLAUDE.md"))).toBe("AGENTS.md");
  });
});
