import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createStubCtx } from "./tests/harness/fake-pi.ts";
import setupDistill from "./index.ts";

/**
 * Executable runtime-contract drift audit.
 *
 * Compares what the documentation promises (slash commands, autonomous
 * trigger boundaries) against what the extension actually registers on a live
 * Pi API surface. Drift has included nonexistent slash commands and stale
 * timing claims. Sampling and settlement admission are distinct contracts.
 * Runtime is authoritative.
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

    for (const hook of ["tool_call", "turn_end", "agent_settled", "session_tree"]) {
      expect(stub.registeredHooks.has(hook), `missing timing hook ${hook}`).toBe(true);
    }
    expect(stub.registeredHooks.has("agent_before_settle")).toBe(false);

    // Source-level routing audit; behavioral ordering is covered by the
    // boundary tests and the separately invoked scripted real-host fixture.
    const source = await readFile(join(root, "index.ts"), "utf8");
    const controller = await readFile(join(root, "lib", "phase1-controller.ts"), "utf8");
    const toolCall = source.match(/tool_call: async[\s\S]*?(?=\n      turn_end:)/)?.[0];
    const turnEnd = source.match(/turn_end: async[\s\S]*?(?=\n      (?:\/\/[^\n]*\n      )*agent_settled:)/)?.[0];
    const settled = source.match(/agent_settled: async[\s\S]*?(?=\n      session_tree:)/)?.[0];
    expect(toolCall).toBeDefined();
    expect(turnEnd).toBeDefined();
    expect(settled).toBeDefined();
    expect(toolCall).toContain("runtime.samplePostCompaction(ctx)");
    expect(toolCall).not.toMatch(/ctx\.(?:abort|compact)\(|runtime\.(?:requestAttempt|assessTurn|reserveBoundaryStop)\(/);
    expect(turnEnd).toContain('event.outcome !== "completed"');
    expect(turnEnd).toContain("event.toolResultEntryIds");
    expect(turnEnd).toContain("runtime.samplePostCompaction(ctx)");
    expect(turnEnd).not.toMatch(/ctx\.(?:abort|compact)\(|runtime\.(?:requestAttempt|assess|assessTurn|reserveBoundaryStop)\(|checkAutonomousCompaction\(/);
    expect(settled).toContain("checkAutonomousCompaction(runtime, ctx)");
    expect(settled).toContain("runtime.shouldAssessSettled(ctx)");
    expect(source).toMatch(/runtime\.assess\(ctx\)[\s\S]*?runtime\.requestAttempt\(ctx\)[\s\S]*?ctx\.compact\(/);
    expect(source).not.toContain("ctx.abort()");
    expect(controller).not.toMatch(/BoundaryStop|boundaryStop|isOwnedStopAbort|revalidate/);
    expect(controller).toMatch(/samplePostCompaction\(ctx:[\s\S]*?if \(!this\.observeUsage\(ctx\)\) return false/);
    expect(controller).toMatch(/assess\(ctx:[\s\S]*?const synced = this\.observeUsage\(ctx\)/);

    const docs = await loadDocs();
    const usage = docs.find((doc) => doc.file.endsWith(join("docs", "usage.md")))!.text;
    const architecture = docs.find((doc) => doc.file.endsWith(join("docs", "architecture.md")))!.text;
    const algorithm = docs.find((doc) => doc.file.endsWith(join("docs", "algorithm.md")))!.text;
    const agent = await readFile(join(root, "AGENTS.md"), "utf8");
    for (const text of [usage, architecture, algorithm, agent]) {
      for (const boundary of ["tool_call", "turn_end", "agent_settled"]) expect(text).toContain(boundary);
      expect(text).toMatch(/sample-only|Sample-only|do not consume/);
      expect(text).toMatch(/exact-leaf|exact\s+settled\s+leaf/);
      expect(text).toContain("agent_settled");
      expect(text).toContain("120-second");
      expect(text).toContain("4,000");
      expect(text).toMatch(/Unknown|unknown/);
      expect(text).toMatch(/warmup/);
    }
    expect(architecture).toMatch(/sole\s+autonomous\s+decision\s+boundary/);
    expect(architecture).not.toMatch(/30-second lifetime|owned-abort shape|stop intent/);
    expect(agent).toMatch(/agent_before_settle\x60\s+(?:migration\s+)?is\s+deferred/);
    expect(docs.find((doc) => doc.file.endsWith("README.md"))?.text).toContain("agent_settled");
  });

  test("v15 docs describe the checkpoint ledger, reader ranges and protected floor", async () => {
    const agent = await readFile(join(root, "AGENTS.md"), "utf8");
    const docs = await loadDocs();
    const architecture = docs.find(doc => doc.file.endsWith(join("docs", "architecture.md")))!.text;
    const algorithm = docs.find(doc => doc.file.endsWith(join("docs", "algorithm.md")))!.text;
    const usage = docs.find(doc => doc.file.endsWith(join("docs", "usage.md")))!.text;
    for (const text of [agent, architecture, algorithm, usage]) {
      expect(text).toContain("version 15");
      expect(text).toContain("checkpointSections");
      expect(text).toMatch(/schema-v2|checkpoint schema\s*v2/);
      expect(text).toContain("T0");
    }
    expect(agent).toContain("8–15");
    expect(architecture).toContain("10–15");
    expect(architecture).toContain("v15-aware reader");
  });

  /** Settings keys the runtime actually reads; owner: lib/settings.ts normalizeDistillFeatureSettings. */
  const RUNTIME_READ_SETTINGS_KEYS = [
    'extensionConfig["dc-distill"].toolOutput.enabled',
    'extensionConfig["dc-distill"].recall.enabled',
  ] as const;

  test("settings claims match the runtime-read extensionConfig keys", async () => {
    const docs = await loadDocs();
    const settings = docs.find((doc) => doc.file.endsWith(join("docs", "settings.md")));
    expect(settings).toBeDefined();
    for (const key of RUNTIME_READ_SETTINGS_KEYS) {
      expect(
        settings!.text.includes(key),
        `docs/settings.md does not document runtime-read key ${key}`,
      ).toBe(true);
    }
    // Both drift classes shipped before: flags existed undocumented, then docs
    // claimed no extension configuration while the runtime read keys.
    for (const doc of docs) {
      expect(
        doc.text.toLowerCase().includes("no extension configuration"),
        `${doc.file} claims the extension has no extension configuration while the runtime reads extensionConfig keys`,
      ).toBe(false);
    }
  });
});
