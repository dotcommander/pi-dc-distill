import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateSession } from "./session-evaluator.ts";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dc-shrink-evaluator-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function line(value: unknown): string {
  return JSON.stringify(value);
}

describe("past-session evaluator", () => {
  test("compiles a whole session when it has no historical compaction", async () => {
    const directory = await temporaryDirectory();
    const session = join(directory, "session.jsonl");
    await writeFile(session, [
      line({ type: "session", id: "s1", cwd: "/tmp/project", timestamp: "2026-01-01T00:00:00Z" }),
      line({ type: "message", message: { role: "user", content: "Fix the parser." } }),
      line({ type: "message", message: { role: "assistant", content: "Parser fixed and tests pass." } }),
      "",
    ].join("\n"));

    const report = await evaluateSession({ sessionFile: session, outputDirectory: join(directory, "out") });

    expect(report.mode).toBe("whole-session");
    expect(report.input.entries).toBe(3);
    expect(report.current.usefulRecordCount).toBeGreaterThan(0);
    expect(await readFile(join(directory, "out", "current.md"), "utf8")).toContain("Fix the parser");
  });

  test("selects a historical compaction and compares its body", async () => {
    const directory = await temporaryDirectory();
    const session = join(directory, "session.jsonl");
    const prefix = [
      line({ type: "session", id: "s1", cwd: "/tmp/project", timestamp: "2026-01-01T00:00:00Z" }),
      line({ type: "message", message: { role: "user", content: "First task." } }),
    ];
    const seed = join(directory, "seed.jsonl");
    await writeFile(seed, `${prefix.join("\n")}\n`);
    const seedReport = await evaluateSession({ sessionFile: seed, outputDirectory: join(directory, "seed-out") });
    const summary = (await readFile(join(directory, "seed-out", "current.md"), "utf8")).trimEnd();
    await writeFile(session, [
      ...prefix,
      line({ type: "compaction", id: "c1", timestamp: "2026-01-01T01:00:00Z", summary: `_1k → 1k_\n\n${summary}` }),
      line({ type: "message", message: { role: "user", content: "Second task." } }),
      line({ type: "compaction", id: "c2", summary: "later" }),
      "",
    ].join("\n"));

    const report = await evaluateSession({
      sessionFile: session,
      outputDirectory: join(directory, "out"),
      compaction: "first",
    });

    expect(report.selectedCompaction).toEqual({
      ordinal: 1,
      line: 3,
      id: "c1",
      timestamp: "2026-01-01T01:00:00Z",
    });
    expect(report.historical?.bodyMatchesCurrent).toBe(true);
    expect(report.input.entries).toBe(2);
  });

  test("does not overwrite an existing evaluation without force", async () => {
    const directory = await temporaryDirectory();
    const session = join(directory, "session.jsonl");
    const outputDirectory = join(directory, "out");
    await writeFile(session, `${line({ type: "message", message: { role: "user", content: "Task" } })}\n`);
    await evaluateSession({ sessionFile: session, outputDirectory });
    await expect(evaluateSession({ sessionFile: session, outputDirectory })).rejects.toThrow(/EEXIST/);
    await expect(evaluateSession({ sessionFile: session, outputDirectory, force: true })).resolves.toBeDefined();
  });

  test("whole-session mode compiles a canonical dump containing a previous summary", async () => {
    const directory = await temporaryDirectory();
    const session = join(directory, "before.jsonl");
    await writeFile(session, [
      line({ type: "session", id: "s1", cwd: "/tmp/project", timestamp: "2026-01-01T00:00:00Z" }),
      line({ type: "compaction", summary: "Previous summary" }),
      line({ type: "message", message: { role: "user", content: "Current task" } }),
      "",
    ].join("\n"));

    const report = await evaluateSession({
      sessionFile: session,
      outputDirectory: join(directory, "out"),
      wholeSession: true,
    });

    expect(report.mode).toBe("whole-session");
    expect(report.input.entries).toBe(3);
    expect(await readFile(join(directory, "out", "current.md"), "utf8")).toContain("Current task");
  });

  test("adapts legacy dumps containing bare Pi messages", async () => {
    const directory = await temporaryDirectory();
    const session = join(directory, "legacy-before.jsonl");
    await writeFile(session, [
      line({ role: "user", content: "Repair TASK-13" }),
      line({ role: "assistant", content: [{ type: "text", text: "TASK-13 repaired." }] }),
      "",
    ].join("\n"));

    const report = await evaluateSession({
      sessionFile: session,
      outputDirectory: join(directory, "out"),
      wholeSession: true,
    });

    expect(report.inputFormat).toBe("legacy-message-jsonl");
    expect(await readFile(join(directory, "out", "input.jsonl"), "utf8")).toStartWith('{"type":"message"');
    expect(await readFile(join(directory, "out", "current.md"), "utf8")).toContain("TASK-13 repaired");
  });

  test("compares a retained historical after dump with a whole legacy before dump", async () => {
    const directory = await temporaryDirectory();
    const session = join(directory, "legacy-before.jsonl");
    const historical = join(directory, "legacy-after.md");
    await writeFile(session, `${line({ role: "user", content: "Preserve TASK-13" })}\n`);
    await writeFile(historical, "Historical TASK-13 summary\n");

    const report = await evaluateSession({
      sessionFile: session,
      outputDirectory: join(directory, "out"),
      wholeSession: true,
      historicalFile: historical,
    });

    expect(report.historical?.sourceFile).toBe(historical);
    expect(report.historical?.bodyMatchesCurrent).toBe(false);
    expect(await readFile(join(directory, "out", "historical.md"), "utf8")).toBe("Historical TASK-13 summary\n");
  });
});
