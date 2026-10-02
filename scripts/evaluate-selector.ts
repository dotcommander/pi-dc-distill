/** Offline only; seals independent inputs/oracle before executing comparisons. */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evaluateSelectorQuality, qualitySeal } from "../lib/offline/quality-evaluator.ts";
import { evaluateCheckpointQuality, checkpointQualitySeal } from "../lib/offline/checkpoint-evaluator.ts";
const directory = process.argv[2], label = process.argv[3];
if (!directory || !label || !/^[a-zA-Z0-9_-]+$/.test(label)) throw new Error("usage: bun scripts/evaluate-selector.ts <artifact-directory> <unique-label>");
await mkdir(directory, { recursive: true });
await writeFile(join(directory, `${label}.quality-seal.json`), JSON.stringify({ optional: qualitySeal(), checkpoint: checkpointQualitySeal() }, null, 2) + "\n", { flag: "wx" });
const optional = evaluateSelectorQuality();
const checkpoint = evaluateCheckpointQuality();
const report = { schema: 2, passed: checkpoint.passed && optional.passed, checkpoint, optional, limitations: ["Coverage remains an offline research candidate; its adoption score is reported independently from checkpoint correctness."] };
await writeFile(join(directory, `${label}.quality.json`), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ passed: report.passed, comparisons: checkpoint.comparisons.length, optionalPassed: optional.passed, failures: [...checkpoint.failures, ...optional.failures] }));
if (!report.passed) process.exitCode = 1;
