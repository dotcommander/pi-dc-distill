import { createHash } from "node:crypto";
import { canonicalizeCompactionSource } from "../compaction-source.ts";
import { compileSessionJsonl } from "../local-compact.ts";
import { QUALITY_CORPUS, QUALITY_DECOYS, QUALITY_BOUNDARY_INPUTS, type QualityFixture } from "./quality-corpus.ts";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export const qualitySeal = () => ({ schema: 1, corpusHash: hash(JSON.stringify(QUALITY_CORPUS)), oracleHash: hash(JSON.stringify(QUALITY_CORPUS.map(({ id, oracle }) => ({ id, oracle })))), boundaryHash: hash(JSON.stringify(QUALITY_BOUNDARY_INPUTS)), decoyHash: hash(JSON.stringify(QUALITY_DECOYS)), comparisons: QUALITY_CORPUS.length * 4, repeats: 3, minimumPressureImprovementPercentagePoints: 5 });
export function markerProblems(summary: string): string[] {
  const stack: string[] = [], problems: string[] = [];
  for (const match of summary.matchAll(/<(\/?)([a-z][a-z-]*)(?:\s[^<>]*?)?>/g)) {
    if (match[1]) { if (stack.pop() !== match[2]) problems.push(`unbalanced ${match[2]}`); }
    else stack.push(match[2]);
  }
  if (stack.length) problems.push(`unclosed markers: ${stack.join(",")}`);
  if (Array.from(summary).length > 65_536) problems.push("hard code-point ceiling exceeded");
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(summary)) problems.push("broken Unicode code point");
  const handoff = summary.match(/<resume-state>\n([\s\S]*?)\n<\/resume-state>/)?.[1];
  if (handoff) {
    if (Array.from(`<resume-state>\n${handoff}\n</resume-state>`).length > 3_072) problems.push("handoff projection exceeds budget");
    const ids = new Set([...handoff.matchAll(/^- ([A-Za-z][\w.-]*) \[(?:done|pending|blocked)\]:/gm)].map(match => match[1]));
    for (const match of handoff.matchAll(/^  depends-on: (.*)$/gm)) for (const id of match[1].split(", ")) if (!ids.has(id)) problems.push(`dangling task reference ${id}`);
    for (const match of handoff.matchAll(/^blocker: .*; task: ([A-Za-z][\w.-]*)$/gm)) if (!ids.has(match[1])) problems.push(`dangling blocker ${match[1]}`);
    const ready = section(summary, "ready-tasks");
    for (const match of ready.matchAll(/^- ([A-Za-z][\w.-]*)$/gm)) if (!ids.has(match[1])) problems.push(`dangling ready task ${match[1]}`);
    const graphReady = section(summary, "graph-ready-tasks");
    for (const match of graphReady.matchAll(/^- ([A-Za-z][\w.-]*)(?::[^\n]*)?$/gm)) if (!ids.has(match[1])) problems.push(`dangling graph-ready task ${match[1]}`);
  }
  return problems;
}
export function section(summary: string, name: string): string {
  const marker = summary.match(new RegExp(`<${name}>\\n([\\s\\S]*?)\\n</${name}>`))?.[1];
  if (marker !== undefined) return marker;
  // v1/v2 compatibility projections use complete label blocks within resume-state.
  if (name === "ready-tasks") return summary.match(/^ready-tasks:\n((?:- [A-Za-z][\w.-]*(?:[^\n]*)\n?)+)/m)?.[1] ?? "";
  return "";
}
const positions = ["## Session", "<goal-state>", "## User Focus", "## Conversation", "<retained-context>", "<read-files>", "<modified-files>", "<recent-tool-calls>", "<recent-tool-results>", "<working-tree>", "<source-anchors>", "<literal-anchors>", "<resume-index>", "<full-session-recovery>", "<summary-omissions>", "<verification>", "<resume-state>", "<resume-risks>", "<resume-tasks>"];
export function sectionPositionProblems(summary: string): string[] {
  let previous = -1;
  const problems: string[] = [];
  for (const token of positions) {
    const current = summary.indexOf(token);
    if (current < 0) continue;
    if (current < previous) problems.push(`section out of order: ${token}`);
    previous = current;
  }
  return problems;
}
function inspect(fixture: QualityFixture, summary: string) {
  const problems = [...markerProblems(summary), ...sectionPositionProblems(summary)];
  for (const fact of fixture.oracle.requiredFacts) if (!summary.includes(fact)) problems.push(`required fact missing: ${fact}`);
  for (const fact of fixture.oracle.forbiddenFacts) if (summary.includes(fact)) problems.push(`forbidden fact leaked: ${fact}`);
  for (const assertion of fixture.oracle.safety) {
    const text = section(summary, assertion.section);
    for (const fact of assertion.includes ?? []) if (!text.includes(fact)) problems.push(`${assertion.section} safety fact missing: ${fact}`);
    for (const fact of assertion.excludes ?? []) if (text.includes(fact)) problems.push(`${assertion.section} unsafe fact: ${fact}`);
  }
  const conversation = summary.match(/## Conversation\n([\s\S]*?)(?=\n<(?:[a-z][a-z-]*)[>\s]|$)/)?.[1] ?? "";
  for (const assertion of fixture.oracle.displayNoise ?? []) {
    const occurrences = conversation.split(assertion.phrase).length - 1;
    if (occurrences > assertion.maximumConversationOccurrences) problems.push(`conversation noise: ${assertion.phrase} occurs ${occurrences} times`);
  }
  return { problems, optionalHits: fixture.oracle.optionalFacts.filter(fact => summary.includes(fact)).length, optionalTotal: fixture.oracle.optionalFacts.length };
}
export function evaluateSelectorQuality() {
  const seal = qualitySeal(); // captured BEFORE either strategy executes
  const comparisons: Array<Record<string, unknown>> = [];
  const failures: string[] = [];
  let pressureBaseline = 0, pressureCoverage = 0, pressureTotal = 0;
  for (const fixture of QUALITY_CORPUS) for (const focused of [false, true]) for (const recallEnabled of [false, true]) {
    const input = canonicalizeCompactionSource(fixture.source);
    const key = `${fixture.id}:focus=${focused}:recall=${recallEnabled}`;
    const outputs = {} as Record<"baseline" | "coverage", { summary: string; hash: string; optionalHits: number; optionalTotal: number; problems: string[] }>;
    for (const selection of ["baseline", "coverage"] as const) {
      const runs: ReturnType<typeof compileSessionJsonl>[] = [];
      const compileProblems: string[] = [];
      for (let repeat = 0; repeat < 3; repeat++) {
        try { runs.push(compileSessionJsonl(input.bytes, focused ? fixture.focus : undefined, undefined, recallEnabled, selection)); }
        catch (error) { compileProblems.push(`repeat ${repeat + 1}: compilation failed: ${error instanceof Error ? error.message : String(error)}`); }
      }
      const summary = runs[0]?.summary ?? "";
      const inspected = inspect(fixture, summary);
      inspected.problems.push(...compileProblems);
      if (runs.some(run => JSON.stringify(run) !== JSON.stringify(runs[0]))) inspected.problems.push("nonidentical output across three repeats");
      for (const problem of inspected.problems) failures.push(`${key}:${selection}: ${problem}`);
      outputs[selection] = { summary, hash: hash(summary), ...inspected };
    }
    if (outputs.coverage.optionalHits < outputs.baseline.optionalHits) failures.push(`${key}: optional-fact recall decreased`);
    if (fixture.oracle.pressure) {
      pressureBaseline += outputs.baseline.optionalHits; pressureCoverage += outputs.coverage.optionalHits; pressureTotal += outputs.baseline.optionalTotal;
    }
    comparisons.push({ id: key, inputHash: hash(input.bytes), digestScope: input.digestScope, pressure: fixture.oracle.pressure, ...outputs });
  }
  const improvementPercentagePoints = pressureTotal ? (pressureCoverage - pressureBaseline) / pressureTotal * 100 : 0;
  if (improvementPercentagePoints < 5) failures.push(`pressure optional-fact improvement ${improvementPercentagePoints.toFixed(2)} percentage points below 5`);
  if (JSON.stringify(seal) !== JSON.stringify(qualitySeal())) failures.push("frozen corpus or independent oracle changed during evaluation");
  return { schema: 1, seal, runtime: { bun: Bun.version, platform: process.platform, arch: process.arch, execPath: process.execPath }, passed: failures.length === 0, failures, pressure: { baselineHits: pressureBaseline, coverageHits: pressureCoverage, total: pressureTotal, improvementPercentagePoints }, comparisons };
}
