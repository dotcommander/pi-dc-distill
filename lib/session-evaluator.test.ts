import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateSession, measureEvaluationText } from "./session-evaluator.ts";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dc-distill-evaluator-"));
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

// The checked-in fixture is public synthetic data; no real sessions are read.
test("synthetic before/after comparison preserves essential facts deterministically", async () => {
  const { compareSyntheticSession } = await import("../tests/compare-session.ts");
  const directory = await temporaryDirectory();
  const outputDirectory = join(directory, "synthetic");
  const first = await compareSyntheticSession(outputDirectory);
  const second = await compareSyntheticSession(outputDirectory);
  expect(second.summary).toBe(first.summary);
  expect(second.report.current.summaryDigest).toBe(first.report.current.summaryDigest);
  expect(first.report.current.bytes).toBeLessThan(first.report.input.bytes);
});


test("measurements distinguish UTF-8 bytes, Unicode code points, and logical lines", () => {
  expect(measureEvaluationText("😀é\r\nx\n")).toEqual({ bytes: 10, characters: 6, lines: 2 });
  expect(measureEvaluationText("")).toEqual({ bytes: 0, characters: 0, lines: 0 });
  expect(measureEvaluationText("\n")).toEqual({ bytes: 1, characters: 1, lines: 1 });
  expect(measureEvaluationText("x\n\n").lines).toBe(2);
  expect(measureEvaluationText("x\ry").lines).toBe(2);
});

test("reports summary-only SDK estimates, budget compliance, options and source provenance", async () => {
  const directory = await temporaryDirectory();
  const session = join(directory, "session.jsonl");
  const historical = join(directory, "historical.md");
  await writeFile(session, `${line({ role: "user", content: "Repair Unicode 😀" })}\n`);
  await writeFile(historical, "😀é\r\nx\n");
  const report = await evaluateSession({ sessionFile: session, historicalFile: historical, outputDirectory: join(directory, "out"), focus: "Preserve 😀", recallEnabled: false });
  const summary = await readFile(join(directory, "out", "current.md"), "utf8");
  expect(report.schemaVersion).toBe(1);
  expect(report.compiler).toEqual({ focus: "Preserve 😀", recallEnabled: false });
  expect(summary).not.toContain("Use `recall_compaction`");
  // The SDK counts UTF-16 units / 4, not Unicode code points / 4.
  expect(report.measurements.historical?.summaryTokens).toBe(2);
  expect(report.measurements.current.summaryTokens).toBe(Math.ceil(summary.length / 4));
  expect(report.measurements.current.characters).toBe(report.current.characters);
  expect(report.measurements.current.budget).toEqual({ operatingCodePoints: 8192, hardCodePoints: 65536, withinOperatingTarget: true, withinHardLimit: true });
  expect(report.measurements.inputToCurrentReductionPct.bytes).toBeCloseTo((1 - report.current.bytes / report.input.bytes) * 100);
  expect(report.provenance.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(report.provenance.sourceFiles.some(({ file }) => file === "lib/compiler/conversation-reducer.ts")).toBe(true);
  expect(report.provenance.sourceFiles.some(({ file }) => file === "lib/bm25.ts")).toBe(true);
  expect(report.provenance.sdkVersion).toBe("0.99.2");
  expect(Object.keys(report.provenance.sdkVersions)).toHaveLength(4);
  expect(report.provenance.packageVersion).toMatch(/^\d+\.\d+\.\d+/);
  expect(report.provenance.revision).toMatch(/^[a-f0-9]{40}$/);
  expect(typeof report.provenance.dirty).toBe("boolean");
  expect(await readFile(join(directory, "out", "report.json"), "utf8")).toBe(`${JSON.stringify(report, null, 2)}\n`);
  const defaultReport = await evaluateSession({ sessionFile: session, outputDirectory: join(directory, "default-out") });
  expect(defaultReport.compiler).toEqual({ focus: null, recallEnabled: true });
  expect(await readFile(join(directory, "default-out", "current.md"), "utf8")).toContain("Use `recall_compaction`");
});

test("keeps historical host-context metrics separate from replay estimates", async () => {
  const directory = await temporaryDirectory();
  const session = join(directory, "session.jsonl");
  await writeFile(session, [
    line({ type: "message", message: { role: "user", content: "Repair task" } }),
    line({ type: "compaction", summary: "😀".repeat(65537), tokensBefore: 123456, details: { tokensAfter: 54321, summaryTokens: 777, tokensAfterSource: "pi-rebuilt-message-estimate" } }),
  ].join("\n"));
  const report = await evaluateSession({ sessionFile: session, outputDirectory: join(directory, "out") });
  expect(report.historicalHostContextMetrics).toEqual({ source: "selected-compaction-details", tokensBefore: 123456, tokensAfter: 54321, summaryTokens: 777, tokensAfterSource: "pi-rebuilt-message-estimate" });
  expect(report.measurements.historical?.summaryTokens).toBe(32769);
  expect(report.measurements.historical?.budget.withinHardLimit).toBe(false);
  expect(report.measurements.historical?.budget.withinOperatingTarget).toBe(false);
});

test("CLI --no-recall reaches the compiler and is recorded in the report", async () => {
  const directory = await temporaryDirectory();
  const session = join(directory, "session.jsonl");
  const output = join(directory, "out");
  await writeFile(session, `${line({ role: "user", content: "CLI task" })}\n`);
  const process = Bun.spawn(["bun", new URL("../bin/dc-distill-session.ts", import.meta.url).pathname, session, "--whole", "--no-recall", "--out", output], { stdout: "pipe", stderr: "pipe" });
  const [exit, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
  expect(stderr).toBe("");
  expect(exit).toBe(0);
  expect(stdout).toContain('"recallEnabled": false');
  const report = JSON.parse(await readFile(join(output, "report.json"), "utf8"));
  expect(report.compiler.recallEnabled).toBe(false);
  expect(await readFile(join(output, "current.md"), "utf8")).not.toContain("Use `recall_compaction`");
});
