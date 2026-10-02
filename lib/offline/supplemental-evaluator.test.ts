import { expect, test } from "bun:test";
import { SUPPLEMENTAL_CORPUS } from "./supplemental-corpus.ts";
import { evaluateSupplementalCycles, evaluateSupplementalGenerated, generatedSupplementalCases, supplementalSeal } from "./supplemental-evaluator.ts";

test("six supplemental fixtures freeze independent facts and safety oracles across five cycles", () => {
  expect(SUPPLEMENTAL_CORPUS).toHaveLength(6);
  for (const fixture of SUPPLEMENTAL_CORPUS) {
    expect(fixture.cycles).toHaveLength(5);
    expect(Object.isFrozen(fixture.cycles[0]!.required)).toBe(true);
    expect(Object.isFrozen(fixture.cycles[0]!.safety)).toBe(true);
  }
  const before = supplementalSeal();
  const report = evaluateSupplementalCycles();
  expect(report.failures).toEqual([]);
  expect(report.cycles).toHaveLength(30);
  expect(report.retention.constraints.total).toBeGreaterThan(0);
  expect(report.retention.decisions.total).toBeGreaterThan(0);
  expect(supplementalSeal()).toEqual(before);
}, 30_000);

test("128 seeded cases enforce conservative evidence and bounded deterministic wire rendering", () => {
  const before = generatedSupplementalCases();
  expect(before).toHaveLength(128);
  expect(before.some(item => !item.invalid && item.rejectionAllowed)).toBe(true);
  expect(before.some(item => !item.rejectionAllowed)).toBe(true);
  expect(new Set(before.map(item => item.category)).size).toBe(5);
  expect(generatedSupplementalCases()).toEqual(before);
  const report = evaluateSupplementalGenerated();
  expect(report.failures).toEqual([]);
  expect(report.receipts).toHaveLength(128);
  expect(report.receipts.some(item => item.outcome === "typed-rejection")).toBe(true);
}, 60_000);
