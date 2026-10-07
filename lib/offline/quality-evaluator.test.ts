import { expect, test } from "bun:test";
import { QUALITY_CORPUS, QUALITY_DECOYS, QUALITY_BOUNDARY_INPUTS } from "./quality-corpus.ts";
import { buildCompactionSource, canonicalizeCompactionSource } from "../compaction-source.ts";
import { evaluateBaselineQuality, markerProblems, sectionPositionProblems, qualitySeal } from "./quality-evaluator.ts";
test("fixed corpus has thirteen immutable sources and independent pressure/noise oracles", () => {
  expect(QUALITY_CORPUS).toHaveLength(13);
  expect(new Set(QUALITY_CORPUS.map(fixture => fixture.id)).size).toBe(13);
  expect(Object.isFrozen(QUALITY_CORPUS[0].oracle)).toBe(true);
  expect(QUALITY_CORPUS.filter(fixture => fixture.oracle.pressure).length).toBeGreaterThan(0);
  expect(QUALITY_CORPUS.find(fixture => fixture.id === "plain-prose-noise")?.oracle.displayNoise).toEqual([{ phrase: "context material", maximumConversationOccurrences: 1 }]);
  expect(qualitySeal()).toMatchObject({ comparisons: 52, repeats: 3 });
  for (const fixture of QUALITY_CORPUS) {
    const input = canonicalizeCompactionSource(fixture.source).bytes;
    for (const decoy of Object.values(QUALITY_DECOYS).flat()) expect(input).not.toContain(decoy.content);
  }
  for (const boundary of QUALITY_BOUNDARY_INPUTS) {
    expect(JSON.stringify(boundary.branchEntries)).toContain("RETAINED_TAIL_DECOY");
    expect(JSON.stringify(boundary.archiveEntries)).toContain("ABANDONED_BRANCH_DECOY");
    const fixture = QUALITY_CORPUS.find(item => item.id === boundary.id)!;
    const rebuilt = buildCompactionSource({ ...boundary.preparation, branchEntries: boundary.branchEntries, sessionId: fixture.source.session.id, cwd: fixture.source.session.cwd, timestamp: fixture.source.session.timestamp });
    expect(rebuilt).toEqual(fixture.source);
    const contaminated = buildCompactionSource({ ...boundary.preparation, branchEntries: boundary.archiveEntries, sessionId: fixture.source.session.id, cwd: fixture.source.session.cwd, timestamp: fixture.source.session.timestamp });
    expect(contaminated.handoff).toBe("ABANDONED_BRANCH_DECOY");
  }
});
test("independent formatting checks reject malformed markers, references and organization", () => {
  expect(markerProblems("<resume-state>\ntasks:\n- a [pending]: do work\n  depends-on: b\n</resume-state>")).toContain("dangling task reference b");
  expect(markerProblems("<verification>\nfail\n</resume-tasks>")).toContain("unbalanced resume-tasks");
  expect(markerProblems("<verification>\nPASS\n</verification>")).toEqual([]);
  expect(markerProblems("<resume-state>\ntasks:\n- a [pending]: do work\n<graph-ready-tasks>\n- missing: requirements unknown or contradicted\n</graph-ready-tasks>\n</resume-state>")).toContain("dangling graph-ready task missing");
  expect(sectionPositionProblems("<resume-tasks>\ntask\n</resume-tasks>\n<verification>\nPASS\n</verification>")).toContain("section out of order: <resume-tasks>");
});

test("baseline report seals all 52 combinations and retains correctness and optional-hit telemetry", () => {
  const report = evaluateBaselineQuality();
  expect(report.schema).toBe(2);
  expect(report.passed).toBe(true);
  expect(report.failures).toEqual([]);
  expect(report.seal).toEqual(qualitySeal());
  expect(report.comparisons).toHaveLength(52);
  expect(new Set(report.comparisons.map(item => item.id)).size).toBe(52);
  expect(Object.keys(report.pressure).sort()).toEqual(["baselineHits", "total"]);
  let baselineHits = 0, total = 0;
  for (const comparison of report.comparisons) {
    expect(comparison).not.toHaveProperty("coverage");
    const baseline = comparison.baseline as { summary: string; hash: string; optionalHits: number; optionalTotal: number; problems: string[] };
    expect(baseline.problems).toEqual([]);
    expect(baseline.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(baseline.summary.length).toBeGreaterThan(0);
    if (comparison.pressure) { baselineHits += baseline.optionalHits; total += baseline.optionalTotal; }
  }
  expect(report.pressure).toEqual({ baselineHits, total });
});
