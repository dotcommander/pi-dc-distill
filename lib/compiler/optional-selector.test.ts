import { describe, expect, test } from "bun:test";
import { prefilterOptionalRecords, selectOptionalRecords, type OptionalSelectionRecord } from "./optional-selector.ts";
const record = (id: string, features: OptionalSelectionRecord["features"], cost = 10, sequence = 0): OptionalSelectionRecord => ({ id, kind: "anchor", features, renderedCost: cost, sourceSequence: sequence });
describe("bounded optional coverage", () => {
  test("unique frontier coverage outranks repeated facts and uses weight 4/2/1", () => {
    const result = selectOptionalRecords({ mandatory: [{ id: "protected", features: { paths: ["src/old.ts"] } }], frontierFeatures: ["parser"], mandatoryRenderedCost: 5, renderedBudget: 25, candidates: [record("repeated", { paths: ["src/old.ts"] }, 10, 20), record("parser", { frontier: ["parser", "parser"] }), record("evidence", { evidence: ["failure"] }), record("path", { paths: ["src/new.ts"] })] });
    expect(result.selectedIds).toEqual(["parser", "evidence"]);
    expect(result.diagnostics.coverage).toBe(7);
  });
  test("ties use gain, lower cost, newest source then stable id", () => {
    const result = selectOptionalRecords({ mandatory: [], frontierFeatures: ["x"], mandatoryRenderedCost: 0, renderedBudget: 10, candidates: [record("b", { frontier: ["x"] }, 10, 2), record("a", { frontier: ["x"] }, 10, 2), record("old", { frontier: ["x"] }, 10, 1)] });
    expect(result.selectedIds).toEqual(["a"]);
  });
  test("zero-cost positive coverage precedes paid coverage", () => {
    const result = selectOptionalRecords({ mandatory: [], frontierFeatures: ["x"], mandatoryRenderedCost: 0, renderedBudget: 1, candidates: [record("paid", { frontier: ["x"] }, 1), record("free", { paths: ["free.ts"] }, 0)] });
    expect(result.selectedIds).toEqual(["free", "paid"]);
  });
  test("new coverage changes remaining priorities without counting repeated features", () => {
    const result = selectOptionalRecords({ mandatory: [], frontierFeatures: ["x"], mandatoryRenderedCost: 0, renderedBudget: 6, candidates: [record("a", { frontier: ["x"], paths: ["a.ts"] }, 2), record("b", { frontier: ["x"] }, 2), record("c", { evidence: ["failure"] }, 2)] });
    expect(result.selectedIds).toEqual(["a", "c", "b"]);
    expect(result.diagnostics.coverage).toBe(7);
  });
  test("rejected candidates never cover shared features and renderer invocation order stays exact", () => {
    const renders: string[][] = [];
    const result = selectOptionalRecords({ mandatory: [], frontierFeatures: ["x"], renderedBudget: 2, candidates: [record("oversized", { frontier: ["x"] }, 0), record("shared", { frontier: ["x"] }, 1), record("other", { paths: ["other.ts"] }, 1)], renderCost: (ids) => {
      renders.push([...ids]);
      return ids.includes("oversized") ? 10 : ids.length;
    } });
    expect(result.selectedIds).toEqual(["shared", "other"]);
    expect(result.diagnostics.coverage).toBe(5);
    expect(renders).toEqual([[], ["oversized"], ["shared"], ["shared", "other"], ["shared", "other"]]);
  });
  test("complete renderer accounts for changing omission digit length and framing", () => {
    const result = selectOptionalRecords({ mandatory: [], frontierFeatures: [], renderedBudget: 23, candidates: [record("a", { paths: ["a.ts"] }, 10), record("b", { paths: ["b.ts"] }, 10)], renderCost: (ids, omitted) => 8 + ids.length * 10 + String(omitted.anchor).length });
    expect(result.selectedIds).toHaveLength(1);
    expect(result.diagnostics.renderedCost).toBe(19);
  });
  test("candidate/feature bounds report omissions, protected overflow preserves mandatory", () => {
    const result = selectOptionalRecords({ mandatory: [{ id: "protected" }], frontierFeatures: [], mandatoryRenderedCost: 101, renderedBudget: 100, candidates: Array.from({ length: 40 }, (_, i) => record(`id${i}`, { paths: Array.from({ length: 130 }, (_, j) => `path${j}`) }, 1, i)) });
    expect(result.selectedIds).toEqual([]);
    expect(result.omittedCounts.anchor).toBe(40);
    expect(result.diagnostics).toMatchObject({ considered: 32, prefiltered: 8, shortenedFeatures: 80, protectedOverflow: true });
  });
  test("pure prefilter admits the exact same capped candidates and omissions as all-fit selection", () => {
    const candidates = Array.from({ length: 40 }, (_, i) => ({ ...record(`id${i}`, { frontier: i % 2 ? ["parser"] : [], paths: [`file${i}.ts`] }, 1, i), structuralPriority: i === 0 ? 10 : 0 }));
    const prefiltered = prefilterOptionalRecords({ candidates, frontierFeatures: ["parser"] });
    const selected = selectOptionalRecords({ mandatory: [], candidates, frontierFeatures: ["parser"], renderedBudget: 100, mandatoryRenderedCost: 0 });
    expect(new Set(prefiltered.candidateIds)).toEqual(new Set(selected.selectedIds));
    expect(prefiltered.omittedCounts).toEqual(selected.omittedCounts);
    expect(prefiltered.candidateIds[0]).toBe("id0");
    expect(prefiltered.candidateIds[1]).toBe("id39");
    expect(prefiltered.candidateIds).toHaveLength(32);
    expect(prefiltered.omittedCounts.anchor).toBe(8);
  });
  test("prefilter stable ties and feature bounds match the greedy admission path", () => {
    const candidates = [record("b", { frontier: ["x", "x"] }, 1, 1), record("a", { frontier: ["x"] }, 1, 1), ...Array.from({ length: 32 }, (_, i) => record(`old${i}`, { paths: Array.from({ length: 130 }, (_, n) => `path${n}`) }, 1, 0))];
    const result = prefilterOptionalRecords({ candidates, frontierFeatures: ["x"] });
    expect(result.candidateIds.slice(0, 2)).toEqual(["a", "b"]);
    expect(result.omittedCounts.anchor).toBe(2);
  });
  test("duplicate identities and missing complete mandatory costs fail closed", () => {
    expect(() => selectOptionalRecords({ mandatory: [], candidates: [], frontierFeatures: [], renderedBudget: 1 })).toThrow();
    expect(() => selectOptionalRecords({ mandatory: [{ id: "a" }], candidates: [record("a", {})], frontierFeatures: [], renderedBudget: 1, mandatoryRenderedCost: 0 })).toThrow();
  });
});
