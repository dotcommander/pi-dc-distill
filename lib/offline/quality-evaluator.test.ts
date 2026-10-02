import { expect, test } from "bun:test";
import { QUALITY_CORPUS, QUALITY_DECOYS, QUALITY_BOUNDARY_INPUTS } from "./quality-corpus.ts";
import { buildCompactionSource, canonicalizeCompactionSource } from "../compaction-source.ts";
import { markerProblems, sectionPositionProblems, qualitySeal } from "./quality-evaluator.ts";
test("fixed corpus has twelve immutable sources and an independent pressure oracle", () => {
  expect(QUALITY_CORPUS).toHaveLength(12);
  expect(new Set(QUALITY_CORPUS.map(fixture => fixture.id)).size).toBe(12);
  expect(Object.isFrozen(QUALITY_CORPUS[0].oracle)).toBe(true);
  expect(QUALITY_CORPUS.filter(fixture => fixture.oracle.pressure).length).toBeGreaterThan(0);
  expect(qualitySeal()).toMatchObject({ comparisons: 48, repeats: 3, minimumPressureImprovementPercentagePoints: 5 });
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
