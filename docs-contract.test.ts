import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createStubCtx } from "#distill-framework/x/testing";
import setupDistill from "./index.ts";

/**
 * Executable runtime-contract drift audit.
 *
 * Compares what the documentation promises (slash commands, autonomous
 * trigger boundaries) against what the extension actually registers on a live
 * Pi API surface. Both drift classes caught here have shipped before:
 * `/compact-status` was advertised but never registered, and `turn_end` was
 * documented as the in-run boundary after the runtime moved to
 * `agent_settled` only. Runtime is authoritative; docs follow.
 */

const root = import.meta.dir;

/** Slash commands Pi owns natively; docs may reference them freely. */
const PI_NATIVE_COMMANDS = new Set(["compact"]);

interface DocFile {
  file: string;
  text: string;
}

async function loadDocs(): Promise<DocFile[]> {
  const top = ["README.md", "CLAUDE.md"].map((name) => join(root, name));
  const docsDir = join(root, "docs");
  const docs = (await readdir(docsDir))
    .filter((name) => name.endsWith(".md"))
    .map((name) => join(docsDir, name));
  return Promise.all(
    [...top, ...docs].map(async (file) => ({ file, text: await readFile(file, "utf8") })),
  );
}

/** Slash commands a doc references: backticked mentions and fenced command lines. */
function slashCommands(text: string): string[] {
  const commands = new Set<string>();
  for (const match of text.matchAll(/`\/([a-zA-Z][\w:-]*)(?:[ <'][^`]*)?`/g)) {
    commands.add(match[1]!.toLowerCase());
  }
  for (const match of text.matchAll(/^\/([a-zA-Z][\w:-]*)/gm)) {
    commands.add(match[1]!.toLowerCase());
  }
  return [...commands];
}

/** Base names from the `| `/command …` | purpose |` rows of the usage table. */
function usageTableCommands(text: string): string[] {
  return [...text.matchAll(/^\| `\/([\w:-]+)[^|`]*`/gm)]
    .map((match) => match[1]!.toLowerCase());
}

function registerExtension(): ReturnType<typeof createStubCtx> {
  // Registration only; session_start is never fired, so no store or
  // user-data directory is touched.
  const stub = createStubCtx();
  setupDistill(stub.pi);
  return stub;
}

describe("runtime-contract drift audit", () => {
  test("command inventory matches the usage table in both directions", async () => {
    const stub = registerExtension();
    const registered = [...stub.registeredCommands.keys()];
    const usage = (await loadDocs()).find((doc) => doc.file.endsWith(join("docs", "usage.md")));
    expect(usage).toBeDefined();
    const table = usageTableCommands(usage!.text);
    expect(table.length).toBeGreaterThan(0);

    for (const command of table) {
      expect(
        registered.includes(command) || PI_NATIVE_COMMANDS.has(command),
        `usage table advertises /${command}, which the runtime does not register and Pi does not own`,
      ).toBe(true);
    }
    for (const command of registered) {
      expect(
        table.includes(command),
        `runtime registers /${command}, missing from the usage table`,
      ).toBe(true);
    }
  });

  test("docs reference only commands that exist at runtime or are Pi-native", async () => {
    const stub = registerExtension();
    const registered = new Set(stub.registeredCommands.keys());
    for (const doc of await loadDocs()) {
      for (const command of slashCommands(doc.text)) {
        expect(
          registered.has(command) || PI_NATIVE_COMMANDS.has(command),
          `${doc.file} references /${command}, which the runtime does not register and Pi does not own`,
        ).toBe(true);
      }
    }
  });

  test("autonomous trigger boundary matches the registered hooks", async () => {
    const stub = registerExtension();

    // Runtime surface: the deliberate agent_settled-only design.
    expect(stub.registeredHooks.has("agent_settled")).toBe(true);
    expect(stub.registeredHooks.has("session_tree")).toBe(true);
    expect(stub.registeredHooks.has("turn_end")).toBe(false);

    // Docs must not claim the unregistered turn_end boundary anywhere.
    for (const doc of await loadDocs()) {
      expect(
        doc.text.includes("turn_end"),
        `${doc.file} claims the unregistered turn_end boundary`,
      ).toBe(false);
    }

    // The active boundary must stay documented where users read about it.
    const docs = await loadDocs();
    const usage = docs.find((doc) => doc.file.endsWith(join("docs", "usage.md")));
    const architecture = docs.find((doc) => doc.file.endsWith(join("docs", "architecture.md")));
    const readme = docs.find((doc) => doc.file.endsWith("README.md"));
    expect(usage?.text).toContain("agent_settled");
    expect(architecture?.text).toContain("agent_settled");
    expect(readme?.text).toContain("agent_settled");
  });
});
