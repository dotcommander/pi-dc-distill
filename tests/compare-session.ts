import { resolve } from "node:path";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createCacheRun, finalizeCacheRun, type CacheRun } from "../lib/cache-runs.ts";
import { compileSessionJsonl } from "../lib/local-compact.ts";
import { evaluateSession } from "../lib/session-evaluator.ts";

const fixture = new URL("./fixtures/parser-session.jsonl", import.meta.url);

function section(summary: string, name: string): string {
  const content = summary.match(new RegExp(`<${name}>\\n([\\s\\S]*?)\\n</${name}>`))?.[1];
  assert(content, `Missing ${name} section`);
  return content;
}

/** Replay the public synthetic fixture through the existing evaluator. */
export async function compareSyntheticSession(outputDirectory: string, managedRun?: CacheRun) {
  const report = await evaluateSession({
    sessionFile: fixture.pathname,
    outputDirectory,
    managedRun,
    wholeSession: true,
    force: true,
  });
  const summary = await readFile(resolve(outputDirectory, report.current.file), "utf8");
  const input = await readFile(resolve(outputDirectory, report.input.file), "utf8");
  assert.equal(compileSessionJsonl(input).summary, summary, "Compilation must be deterministic");

  const state = section(summary, "resume-state");
  for (const fact of [
    "objective: Handle empty input while preserving line endings.",
    "Return [] for empty input; preserve non-empty input line endings.",
    "Run CRLF integration coverage.",
  ]) assert(state.includes(fact), `Lost handoff fact: ${fact}`);
  const files = section(summary, "modified-files").split("\n");
  for (const file of ["src/parser.ts", "tests/parser.test.ts"]) {
    assert(files.includes(file), `Lost modified-file observation: ${file}`);
  }
  assert(section(summary, "verification").includes(
    "PASS [bash cwd=/synthetic/pi-dc-distill]: bun test tests/parser.test.ts",
  ), "Lost synthetic verification status");
  assert(report.current.bytes < report.input.bytes, "Summary must be smaller than the fixture");
  return { report, summary };
}

if (import.meta.main) {
  const run = createCacheRun("compare");
  const outputDirectory = run.directory;
  console.log(`Artifacts: ${outputDirectory}`);
  let success = false;
  try {
    const { report, summary } = await compareSyntheticSession(outputDirectory, run);
    const reduction = ((1 - report.current.bytes / report.input.bytes) * 100).toFixed(1);
    console.log(`pi-dc-distill synthetic comparison: PASS`);
    console.log(`Before: ${report.input.bytes} UTF-8 bytes of serialized JSONL (${report.input.entries} records)`);
    console.log(`After:  ${report.current.bytes} UTF-8 bytes of summary (${reduction}% smaller)`);
    console.log("These are fixture byte counts, not model-token or cost estimates.");
    console.log("Preserved: objective, decision, modified files, synthetic verification status, next action.");
    console.log(`Artifacts: ${outputDirectory}\n`);
    console.log(summary);
    success = true;
  } finally { await finalizeCacheRun(run, success); }
}
