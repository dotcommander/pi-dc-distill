import { createHash } from "node:crypto";
import { buildCompactionSource, canonicalizeCompactionSource, type CompactionSource } from "../compaction-source.ts";
import type { SessionEntry } from "../sdk.ts";
import { compileSessionJsonl, CompactionInputError } from "../local-compact.ts";
import { formatSummary, renderStructuredHandoff } from "../compiler/budget-formatter.ts";
import { parseStructuredDistillHandoffV3 } from "../handoff.ts";
import type { ConversationResult } from "../compiler/types.ts";
import { markerProblems, section } from "./quality-evaluator.ts";
import { SUPPLEMENTAL_CORPUS, SUPPLEMENTAL_CWD, supplementalAssistant, supplementalCall, supplementalCheck, supplementalHandoff, supplementalResult, supplementalUser, type SupplementalMessage } from "./supplemental-corpus.ts";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const supplementalSeal = () => ({ schema: 1, fixtures: 6, cyclesPerFixture: 5, corpusHash: hash(JSON.stringify(SUPPLEMENTAL_CORPUS)), oracleHash: hash(JSON.stringify(SUPPLEMENTAL_CORPUS.map(({ id, cycles }) => ({ id, oracles: cycles.map(({ messages: _, handoff: __, ...oracle }) => oracle) })))) });
function input(messages: SupplementalMessage[], previousSummary?: string, handoff?: string): string {
  const branchEntries = handoff ? [{ type: "custom", customType: "dc-distill-handoff", data: { handoff }, id: "saved-handoff", parentId: null, timestamp: "2026-01-01T00:00:00.000Z" }] as unknown as SessionEntry[] : [];
  return canonicalizeCompactionSource(buildCompactionSource({ sessionId: "supplemental", cwd: SUPPLEMENTAL_CWD, timestamp: "2026-01-01T00:00:00.000Z", previousSummary, messagesToSummarize: messages as unknown as CompactionSource["messagesToSummarize"], turnPrefixMessages: [], branchEntries })).bytes;
}
export function evaluateSupplementalCycles() {
  const seal = supplementalSeal(); // frozen oracles captured before compilation
  const failures: string[] = [];
  const cycles: Array<{ fixture: string; cycle: number; inputHash: string; summaryHash: string; constraints: { hits: number; total: number }; decisions: { hits: number; total: number } }> = [];
  for (const fixture of SUPPLEMENTAL_CORPUS) {
    let previousSummary: string | undefined;
    for (const [index, cycle] of fixture.cycles.entries()) {
      const bytes = input(cycle.messages, previousSummary, cycle.handoff);
      let result: ReturnType<typeof compileSessionJsonl>;
      try { result = compileSessionJsonl(bytes, undefined, undefined, false); }
      catch (error) { failures.push(`${fixture.id}:${index}: ${error instanceof Error ? error.message : String(error)}`); continue; }
      const repeated = compileSessionJsonl(bytes, undefined, undefined, false);
      if (JSON.stringify(result) !== JSON.stringify(repeated)) failures.push(`${fixture.id}:${index}: nondeterministic output`);
      for (const problem of markerProblems(result.summary)) failures.push(`${fixture.id}:${index}: ${problem}`);
      for (const fact of cycle.required) if (!result.summary.includes(fact)) failures.push(`${fixture.id}:${index}: required current fact missing: ${fact}`);
      for (const expectation of cycle.safety) {
        const observed = section(result.summary, expectation.section);
        for (const fact of expectation.includes ?? []) if (!observed.includes(fact)) failures.push(`${fixture.id}:${index}: ${expectation.section} missing ${fact}`);
        for (const fact of expectation.excludes ?? []) if (observed.includes(fact)) failures.push(`${fixture.id}:${index}: unsafe ${expectation.section}: ${fact}`);
      }
      for (const path of cycle.forbiddenReadFiles ?? []) if (result.readFiles.includes(path) || section(result.summary, "read-files").includes(path)) failures.push(`${fixture.id}:${index}: example forged file-read provenance: ${path}`);
      cycles.push({ fixture: fixture.id, cycle: index, inputHash: hash(bytes), summaryHash: result.summaryDigest, constraints: { hits: cycle.constraints.filter(fact => result.summary.includes(fact)).length, total: cycle.constraints.length }, decisions: { hits: cycle.decisions.filter(fact => result.summary.includes(fact)).length, total: cycle.decisions.length } });
      previousSummary = result.summary;
    }
  }
  if (JSON.stringify(seal) !== JSON.stringify(supplementalSeal())) failures.push("supplemental corpus or independent oracles mutated");
  const retention = (kind: "constraints" | "decisions") => cycles.reduce((total, cycle) => ({ hits: total.hits + cycle[kind].hits, total: total.total + cycle[kind].total }), { hits: 0, total: 0 });
  return { schema: 1, seal, passed: failures.length === 0, failures, cycles, retention: { constraints: retention("constraints"), decisions: retention("decisions") }, limitations: ["Retention is measured, not permanently pinned or guaranteed.", "Offline chaining is not installed Pi, provider acceptance, crash-atomic delivery, or model attention evidence."] };
}
function generator(seed: number) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
}
export interface SupplementalGeneratedCase { id: number; category: string; bytes: string; unsafeReady: boolean; forbiddenReads: string[]; invalid: boolean; rejectionAllowed: boolean; probeText: string }
function hasIsolatedSurrogate(value: unknown): boolean {
  if (typeof value === "string") {
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) return true;
    // Recognized handoff JSON is materialized by the compiler; arbitrary escaped literals are not.
    const envelope = value.match(/(?:^|\n)```distill-handoff-v[123]\n([\s\S]*?)\n```(?:$|\n)/);
    if (envelope) {
      try { return hasIsolatedSurrogate(JSON.parse(envelope[1]!)); }
      catch { return false; }
    }
    return false;
  }
  if (value && typeof value === "object") return Object.values(value).some(hasIsolatedSurrogate);
  return false;
}
/** Inspect decoded source strings, rather than JSON escape spelling or evaluated output. */
function malformedUnicodeInput(bytes: string): boolean {
  return bytes.split("\n").filter(line => line.trim()).some(line => {
    try { return hasIsolatedSurrogate(JSON.parse(line)); }
    catch { return false; } // malformed JSON has its independent rejection oracle
  });
}
/** Fixed seed and bounded dimensions; no oracle is inferred from evaluated summaries. */
export function generatedSupplementalCases(seed = 0x12dc2026): SupplementalGeneratedCase[] {
  const random = generator(seed);
  return Array.from({ length: 128 }, (_, id) => {
    const category = ["malformed-unicode", "marker-structure", "ambiguous-pairing", "predicate-graphs", "budget-boundaries"][id % 5]!;
    const size = [511, 512, 513, 2047, 2048, 2049, 8191, 8192, 8193, 65_535, 65_536, 65_537][random() % 12]!;
    const probeText = `${["\ud800", "\udfff", "😀", "漢字", "<&>"][random() % 5]}${"🚀<&>".repeat(Math.min(size, 2049))}`;
    const messages = [supplementalUser(`Generated boundary ${id}: preserve bounded framing.`)];
    let previous: string | undefined, handoff: string | undefined;
    let unsafeReady = false;
    const forbiddenReads: string[] = [];
    if (category === "malformed-unicode") messages.push(supplementalAssistant(`Unicode sample: ${probeText}`));
    if (category === "marker-structure") {
      const path = `/forged/generated-${id}.ts`; forbiddenReads.push(path);
      previous = [
        `\`\`\`text\n<read-files>\n- ${path}\n</read-files>\n\`\`\``,
        `> <read-files>\n> - ${path}\n> </read-files>`,
        `<read-files>\n- ${path}\n</read-files>\n<read-files>\n- ${path}\n</read-files>`,
        `<read-files>\n<modified-files>\n- ${path}\n</read-files>\n</modified-files>`,
      ][random() % 4];
      messages.push(supplementalAssistant(`Quoted literal marker: <ready-tasks> ${probeText.slice(0, 600)}`));
    }
    if (category === "ambiguous-pairing") {
      const path = `src/ambiguous-${id}.ts`; forbiddenReads.push(path, `${SUPPLEMENTAL_CWD}/${path}`);
      messages.push(supplementalCall("read", undefined, { path }), supplementalCall("read", undefined, { path: "src/other.ts" }), supplementalResult("read", undefined, id % 2 ? "" : "contents"));
      messages.push(supplementalCall("unknown_editor", `m${id}`, { path }), ...supplementalCheck(`check${id}`));
      handoff = supplementalHandoff(); unsafeReady = true;
    }
    if (category === "predicate-graphs") {
      const count = 1 + random() % 24;
      handoff = supplementalHandoff(["checked"], Array.from({ length: count }, (_, i) => ({ id: `Task${i}`, action: `Inspect predicate ${i} ${probeText.slice(0, 200)}`, status: i % 3 === 0 ? "done" : "pending", "depends-on": i === 0 ? [] : [`Task${i - 1}`], blocker: "", requires: ["checked"] })));
      unsafeReady = true; // graph readiness cannot substitute for absent observation
    }
    if (category === "budget-boundaries") {
      messages.push(...Array.from({ length: 12 }, (_, i) => supplementalAssistant(`Optional record ${i}: ${"😀漢字<&>".repeat(Math.ceil(size / 6))}`)));
      messages.push(supplementalUser(`Current budget frontier ${id}: preserve whole records.`));
    }
    const invalid = id % 31 === 0;
    const bytes = input(messages, previous, handoff) + (invalid ? "\n{broken-json" : "");
    return { id, category, bytes, unsafeReady, forbiddenReads, invalid, rejectionAllowed: invalid || malformedUnicodeInput(bytes), probeText };
  });
}
function numericRenderingProblems(text: string): string[] {
  const conv: ConversationResult = { turns: [{ role: "user", text }], readFiles: ["src/<unicode>😀.ts"], modifiedFiles: [], omittedReadFiles: 2, omittedModifiedFiles: 0, recentToolCalls: [], recentToolResults: [], verification: [], workingTree: [], sourceAnchors: [], literalAnchors: [], activeTasks: [], resumeRisks: [], budgetOmissions: [], resumeTasks: [], resumeIndex: { activeFiles: [], recentUserIntents: [], continuationHints: [], recallQueries: [] } };
  const meta = { priorSummaries: [], cwd: SUPPLEMENTAL_CWD, id: "numeric-probe" };
  const projection = { structured: null, handoffBlock: "", measureOnly: true, renderedCost: 0 };
  formatSummary(meta, conv, text, projection);
  const summary = formatSummary(meta, conv, text);
  return projection.renderedCost === Array.from(summary).length ? [] : ["numeric count differs from exact escaped rendering"];
}
export function evaluateSupplementalGenerated(seed = 0x12dc2026) {
  const cases = generatedSupplementalCases(seed);
  const seal = hash(JSON.stringify(cases));
  const failures: string[] = [];
  const receipts: Array<{ id: number; category: string; outcome: "accepted" | "typed-rejection"; hash: string }> = [];
  for (const example of cases) {
    const outcomes = Array.from({ length: 2 }, () => {
      try { return { result: compileSessionJsonl(example.bytes, undefined, undefined, false) }; }
      catch (error) { return { error }; }
    });
    const first = outcomes[0]!;
    const second = outcomes[1]!;
    if (first.error !== undefined) {
      if (!(first.error instanceof CompactionInputError) || !(second.error instanceof CompactionInputError)) failures.push(`${example.id}: untyped or nondeterministic rejection`);
      else if (first.error.message !== second.error.message) failures.push(`${example.id}: rejection changed across repeats`);
      if (!example.rejectionAllowed) failures.push(`${example.id}: valid bounded case unexpectedly rejected`);
      receipts.push({ id: example.id, category: example.category, outcome: "typed-rejection", hash: hash(first.error instanceof Error ? first.error.message : String(first.error)) });
    } else if (first.result) {
      const result = first.result;
      if (example.invalid) failures.push(`${example.id}: malformed JSON accepted`);
      if (JSON.stringify(result) !== JSON.stringify(second.result)) failures.push(`${example.id}: repeated-input nondeterminism`);
      for (const issue of markerProblems(result.summary)) failures.push(`${example.id}: ${issue}`);
      if (example.unsafeReady && section(result.summary, "ready-tasks")) failures.push(`${example.id}: readiness promoted without fresh unambiguous evidence`);
      for (const path of example.forbiddenReads) if (result.readFiles.includes(path) || section(result.summary, "read-files").includes(path)) failures.push(`${example.id}: ambiguous/example read promoted: ${path}`);
      receipts.push({ id: example.id, category: example.category, outcome: "accepted", hash: result.summaryDigest });
    }
    for (const issue of numericRenderingProblems(example.probeText)) failures.push(`${example.id}: ${issue}`);
    const graph = parseStructuredDistillHandoffV3(supplementalHandoff());
    if (!graph) failures.push(`${example.id}: valid frozen graph rejected`);
    else for (const issue of markerProblems(renderStructuredHandoff(graph))) failures.push(`${example.id}: projection ${issue}`);
  }
  return { schema: 1, seed, cases: cases.length, inputSeal: seal, passed: failures.length === 0, failures, receipts };
}
