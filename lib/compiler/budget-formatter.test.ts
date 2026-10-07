import { describe, expect, test } from "bun:test";
import { enforceOperatingBudget, formatSummary, prepareSummaryProjection } from "./budget-formatter.ts";
import { buildResumeIndex } from "./resume-index.ts";
import { scanSections } from "./section-scanner.ts";
import { codePointLength } from "../unicode.ts";
import type { ConversationResult, ConversationTurn, SessionMeta } from "./types.ts";
import { emptyCheckpoint } from "./checkpoint.ts";
import { prioritizeVerificationDisplay, verificationEvictionIndex } from "./verification-display.ts";
import { renderVerificationReceipt } from "./tool-tracker.ts";
import { enforceSummaryLimit } from "../local-compact.ts";
import { CompactionInputError } from "./errors.ts";

/** Wire-format contract text: a wording change must update this literal deliberately. */
const SCOPE_NOTE = "This summary covers only the entries Pi discarded at compaction; newer state lives in the retained messages that follow it in context.";

function conversation(turns: ConversationTurn[]): ConversationResult {
  return { turns, readFiles: [], modifiedFiles: [], omittedReadFiles: 0, omittedModifiedFiles: 0,
    recentToolCalls: [], recentToolResults: [], verification: [], workingTree: [], sourceAnchors: [], literalAnchors: [],
    activeTasks: [], resumeRisks: [], budgetOmissions: [], resumeTasks: [], resumeIndex: buildResumeIndex(turns, [], [], []) };
}

const turns: ConversationTurn[] = [
  { role: "user", text: "Fix the parser regression in lib/parse.ts" },
  { role: "assistant", text: "Reproduced and fixed the token loop." },
];

describe("summary scope note", () => {
  test("wire summary starts with the fixed scope note", () => {
    const summary = formatSummary({ priorSummaries: [] }, conversation(turns));
    expect(summary.startsWith(`${SCOPE_NOTE}\n\n`)).toBe(true);
  });

  test("scope note is static: identical across summaries with different session metadata", () => {
    const first = formatSummary({ priorSummaries: [], id: "s-1", timestamp: "2026-10-05T01:00:00Z" }, conversation(turns));
    const second = formatSummary({ priorSummaries: [], id: "s-2", timestamp: "2027-01-01T00:00:00Z" }, conversation(turns));
    expect(first.split("\n")[0]).toBe(SCOPE_NOTE);
    expect(second.split("\n")[0]).toBe(SCOPE_NOTE);
    // No timestamp or other varying component may enter the preamble.
    expect(SCOPE_NOTE).not.toMatch(/\d/);
  });

  test("measure pass counts the scope note identically to the wire render", () => {
    const meta: SessionMeta = { priorSummaries: [], id: "s-1", cwd: "/tmp/project", model: "prov/model", timestamp: "2026-10-05T01:00:00Z" };
    const conv = conversation(turns);
    const projection = prepareSummaryProjection(meta, conv);
    projection.measureOnly = true;
    formatSummary(meta, conv, undefined, projection);
    const wire = formatSummary(meta, conv);
    expect(projection.renderedCost).toBe(codePointLength(wire));
    expect(projection.renderedCost!).toBeGreaterThan(codePointLength(SCOPE_NOTE));
  });

  test("scope-note preamble keeps the structural scanner valid", () => {
    const summary = formatSummary({ priorSummaries: [] }, conversation(turns));
    expect(scanSections(summary).valid).toBe(true);
  });
});

function verificationPressure() {
  const state = emptyCheckpoint();
  state.tasks = [{ id: "work", action: "Keep working", status: "pending", blocker: "", "depends-on": [], requires: ["fresh", "stale"] }];
  state.preconditions = ["fresh", "stale"].map(id => ({ id, kind: "verification-pass" as const,
    runner: "bash", command: `bun test ${id}`, cwd: "/repo" }));
  state.evidence = { ...state.evidence, mutationEpoch: 1, verification: [
    { id: "fresh", tool: "bash", command: "bun test fresh", cwd: "/repo", status: "PASS", evidence: "exit 0", mutationEpoch: 1, freshnessEstablished: true },
    { id: "stale", tool: "bash", command: "bun test stale", cwd: "/repo", status: "PASS", evidence: "exit 0", mutationEpoch: 0, freshnessEstablished: true },
    { id: "failed", tool: "bash", command: "bun test failed", cwd: "/repo", status: "FAIL", evidence: "failed", mutationEpoch: 1, freshnessEstablished: true },
    { id: "pending", tool: "bash", command: "bun test pending", cwd: "/repo", status: "INCOMPLETE", evidence: "pending", mutationEpoch: 1, freshnessEstablished: true },
  ] };
  const conv = conversation([
    { role: "user", text: "Keep the current request." },
    { role: "assistant", text: "Newest outcome " + "O".repeat(3_000) },
    { role: "assistant", text: "Newest proposal " + "P".repeat(3_000) },
  ]);
  conv.checkpoint = state;
  conv.verification = prioritizeVerificationDisplay(state);
  // Mandatory checkpoint text forces eviction beyond earlier optional categories.
  state.objective = "protected objective " + "Q".repeat(9_000);
  conv.retainedContext = [
    { role: "assistant", kind: "outcome", text: "Old outcome " + "X".repeat(2_000) },
    { role: "assistant", kind: "outcome", text: "Newest outcome " + "O".repeat(3_000) },
    { role: "assistant", kind: "proposal", text: "Newest proposal " + "P".repeat(3_000) },
  ];
  return conv;
}

for (const selection of ["baseline", "coverage"] as const) {
  test(`${selection} preserves protected verification after category exhaustion and evicts other optional sections`, () => {
    const conv = verificationPressure();
    const protectedRows = [...conv.verification];
    const mismatch = { ...conv.checkpoint!.evidence.verification[1], id: "stale-other-cwd", cwd: "/other" };
    conv.checkpoint!.evidence = { ...conv.checkpoint!.evidence,
      verification: [...conv.checkpoint!.evidence.verification, mismatch] };
    const optionalRow = renderVerificationReceipt(mismatch, conv.checkpoint!.evidence.mutationEpoch);
    conv.verification.push(optionalRow);
    enforceOperatingBudget({ priorSummaries: [] }, conv, undefined, false, selection);
    for (const row of protectedRows) expect(conv.verification).toContain(row);
    expect(conv.verification).not.toContain(optionalRow);
    expect(verificationEvictionIndex(conv.verification, conv.checkpoint)).toBe(-1);
    expect(conv.retainedContext).toHaveLength(2);
    expect(conv.budgetOmissions.join("\n")).toContain("protected-content overflow");
    const summary = enforceSummaryLimit(() => formatSummary({ priorSummaries: [] }, conv), conv);
    expect(codePointLength(summary)).toBeGreaterThan(8_192);
    expect(codePointLength(summary)).toBeLessThanOrEqual(65_536);
    expect(scanSections(summary).valid).toBe(true);
  });

  test(`${selection} protected-only soft overflow still cancels at the hard wire limit`, () => {
    const conv = verificationPressure();
    conv.checkpoint!.objective = "Q".repeat(66_000);
    const protectedRows = [...conv.verification];
    let failure: unknown;
    try { enforceOperatingBudget({ priorSummaries: [] }, conv, undefined, false, selection); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(CompactionInputError);
    expect((failure as CompactionInputError).code).toBe("protected_overflow");
    expect((failure as CompactionInputError).message).toBe("protected rendered checkpoint overflow");
    for (const row of protectedRows) expect(conv.verification).toContain(row);
  });
}

describe("type-signature catalog rendering and eviction", () => {
  test("marker renders - path: signature lines immediately after verification", () => {
    const conv = conversation(turns);
    conv.verification = ["PASS bun test [freshness: journal]"];
    conv.typeSignatures = { entries: [
      { path: "src/a.ts", signatures: ["export const a = 1;", "export function f(): void {}"] },
      { path: "src/b.tsx", signatures: ["export const el = <div/>;"] },
    ], omittedFiles: 0, omittedSignatures: 0 };
    const summary = formatSummary({ priorSummaries: [] }, conv);
    const markerStart = summary.indexOf("<type-signatures>");
    const verificationEnd = summary.indexOf("</verification>");
    expect(markerStart).toBeGreaterThan(0);
    expect(verificationEnd).toBeGreaterThan(0);
    expect(markerStart).toBeGreaterThan(verificationEnd);
    const between = summary.slice(verificationEnd + "</verification>".length, markerStart);
    expect(between.includes("<")).toBe(false);
    expect(summary).toContain("- src/a.ts: export const a = 1;");
    expect(summary).toContain("- src/a.ts: export function f(): void {}");
    expect(summary).toContain("- src/b.tsx: export const el = &lt;div/&gt;;");
    expect(scanSections(summary).valid).toBe(true);
    expect(scanSections(summary).sections.get("type-signatures")).toContain("- src/a.ts: export const a = 1;");
  });

  test("empty catalog renders no marker", () => {
    const summary = formatSummary({ priorSummaries: [] }, conversation(turns));
    expect(summary.includes("<type-signatures>")).toBe(false);
  });

  test("omission counters render as whole-record receipt lines", () => {
    const conv = conversation(turns);
    conv.typeSignatures = { entries: [], omittedFiles: 3, omittedSignatures: 7 };
    const summary = formatSummary({ priorSummaries: [] }, conv);
    expect(summary).toContain("<type-signatures>");
    expect(summary).toContain("... (3 catalog files omitted)");
    expect(summary).toContain("... (7 signatures omitted)");
  });

  test("budget eviction drops the lowest-priority tail entry first", () => {
    const conv = conversation(turns);
    const big = (path: string) => ({ path, signatures: Array.from({ length: 8 }, (_, i) => `export const ${path}_${i} = "${"x".repeat(480)}";`) });
    conv.typeSignatures = { entries: [big("src/mod.ts"), big("src/read.ts"), big("src/carried.ts")], omittedFiles: 0, omittedSignatures: 0 };
    enforceOperatingBudget({ priorSummaries: [] }, conv, undefined, false);
    const catalog = conv.typeSignatures!;
    expect(catalog.entries.every((entry) => entry.path !== "src/carried.ts")).toBe(true);
    expect(catalog.omittedFiles).toBeGreaterThanOrEqual(1);
    expect(conv.budgetOmissions.join("\n")).toContain("type-signature files");
    expect(catalog.entries.at(0)?.path).toBe("src/mod.ts");
  });

  test("enforceSummaryLimit clears the whole catalog before protected overflow", () => {
    const conv = conversation(turns);
    const entries = Array.from({ length: 160 }, (_, i) => ({ path: `src/big${i}.ts`, signatures: [`${"export const x".repeat(30)} = ${i};`] }));
    conv.typeSignatures = { entries, omittedFiles: 0, omittedSignatures: 0 };
    const meta: SessionMeta = { priorSummaries: [], cwd: "/tmp/project" };
    const summary = enforceSummaryLimit(() => formatSummary(meta, conv), conv);
    expect(codePointLength(summary)).toBeLessThanOrEqual(65_536);
    expect(summary.includes("- src/big0.ts")).toBe(false);
    expect(summary).toContain("catalog files omitted");
    expect(conv.typeSignatures!.entries).toHaveLength(0);
    expect(conv.typeSignatures!.omittedFiles).toBe(160);
  });
});
