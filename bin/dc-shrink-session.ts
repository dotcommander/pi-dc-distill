#!/usr/bin/env bun
import { defaultEvaluationDirectory, evaluateSession, type CompactionSelector } from "../lib/session-evaluator.ts";

const usage = `Usage: dc-shrink-session <session.jsonl> [options]

Replay an old Pi JSONL session through the current deterministic shrink compiler.

Options:
  --compaction <first|last|N>  Replay records before this historical compaction (default: last)
  --whole                      Compile every record, including compaction records (for before dumps)
  --historical <file>          Compare with a retained historical summary/after dump
  --out <directory>            Write artifacts here (default: .work/shrink-evaluations/<session>)
  --focus <text>               Supply the same optional focus accepted by /compact
  --force                      Replace evaluator artifacts already in the output directory
  --help                       Show this help

If the session has no compaction entries, the entire file is compiled.`;

function fail(message: string): never {
  console.error(`dc-shrink-session: ${message}\n\n${usage}`);
  process.exit(2);
}

function parseCompaction(value: string): CompactionSelector {
  if (value === "first" || value === "last") return value;
  const ordinal = Number(value);
  if (!Number.isInteger(ordinal) || ordinal < 1) fail("--compaction must be first, last, or a positive integer");
  return ordinal;
}

async function main(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage);
    return;
  }
  let sessionFile: string | undefined;
  let outputDirectory: string | undefined;
  let compaction: CompactionSelector | undefined;
  let focus: string | undefined;
  let historicalFile: string | undefined;
  let force = false;
  let wholeSession = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--force") {
      force = true;
    } else if (arg === "--whole") {
      wholeSession = true;
    } else if (arg === "--out" || arg === "--focus" || arg === "--compaction" || arg === "--historical") {
      const value = args[++index];
      if (!value) fail(`${arg} requires a value`);
      if (arg === "--out") outputDirectory = value;
      if (arg === "--focus") focus = value;
      if (arg === "--compaction") compaction = parseCompaction(value);
      if (arg === "--historical") historicalFile = value;
    } else if (arg.startsWith("-")) {
      fail(`unknown option: ${arg}`);
    } else if (sessionFile) {
      fail(`unexpected argument: ${arg}`);
    } else {
      sessionFile = arg;
    }
  }
  if (!sessionFile) fail("a Pi session JSONL file is required");
  const out = outputDirectory ?? defaultEvaluationDirectory(sessionFile);
  const report = await evaluateSession({
    sessionFile,
    outputDirectory: out,
    compaction,
    focus,
    force,
    wholeSession,
    historicalFile,
  });
  console.log(JSON.stringify({ outputDirectory: out, ...report }, null, 2));
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`dc-shrink-session: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
