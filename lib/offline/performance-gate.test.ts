import { expect, test } from 'bun:test';
import { compareCachingPerformance, compareOrdinaryPerformance, type PerformanceMeasurement } from './performance-gate.ts';
const baseline: PerformanceMeasurement = { inputHash: 'sealed-input', runtime: { bun: 'same' }, options: { recall: false }, p50: 2, p95: 20, peakRssBytes: 100_000_000 };
test('ordinary gate permits exact additive/proportional latency and RSS boundaries', () => {
  expect(compareOrdinaryPerformance(baseline, { ...baseline, p50: 3, p95: 22, peakRssBytes: baseline.peakRssBytes + 8 * 1024 * 1024 }).passed).toBe(true);
  for (const field of ['p50', 'p95', 'peakRssBytes'] as const) {
    const limit = compareOrdinaryPerformance(baseline, baseline).limits[field];
    expect(compareOrdinaryPerformance(baseline, { ...baseline, [field]: limit + 0.01 }).passed).toBe(false);
  }
});
test('performance receipts cannot pass with incompatible inputs or invalid measurements', () => {
  expect(compareOrdinaryPerformance(baseline, { ...baseline, inputHash: 'different' }).passed).toBe(false);
  expect(compareOrdinaryPerformance(baseline, { ...baseline, runtime: { bun: 'other' } }).passed).toBe(false);
  expect(compareOrdinaryPerformance(baseline, { ...baseline, options: {} }).passed).toBe(false);
  expect(compareOrdinaryPerformance(baseline, { ...baseline, p95: Number.NaN }).passed).toBe(false);
  expect(compareOrdinaryPerformance(baseline, { ...baseline, p95: 1 }).passed).toBe(false);
});
const measured = { ...baseline, warmups: 10, repetitions: 30, canonical: { hash: 'canonical' }, result: { summary: '😀 é', checkpoint: { tasks: [] }, omitted: ['older', 'newer'] } };
const cachedReceipts = () => ({
  before: { ordinary: measured, nearLimit: { unicodeLexical: measured, readinessIdentity: measured, protectedOverflow: { ...measured, result: undefined, rejection: { name: "CompactionInputError", code: "protected_overflow" } }, budgetPressureV2: { ...measured, p50: 10, p95: 20 }, rejected: { ...measured, result: undefined, rejection: { name: 'CompactionInputError', code: 'protected_overflow' } } } },
  after: { ordinary: measured, nearLimit: { unicodeLexical: measured, readinessIdentity: measured, protectedOverflow: { ...measured, result: undefined, rejection: { name: "CompactionInputError", code: "protected_overflow" } }, budgetPressureV2: { ...measured, p50: 9, p95: 20 }, rejected: { ...measured, result: undefined, rejection: { name: 'CompactionInputError', code: 'protected_overflow' } } } },
});
test('cache adoption demands ten percent pressure gain and full structured output parity', () => {
  const { before, after } = cachedReceipts();
  expect(compareCachingPerformance(before, after).passed).toBe(true);
  expect(compareCachingPerformance(before, { ...after, nearLimit: { ...after.nearLimit, budgetPressureV2: { ...after.nearLimit.budgetPressureV2, p50: 9.001 } } }).passed).toBe(false);
  expect(compareCachingPerformance(before, { ...after, ordinary: { ...measured, result: { ...measured.result, omitted: ['newer', 'older'] } } }).failures.some(value => value.includes('parity'))).toBe(true);
  expect(compareCachingPerformance(before, { ...after, nearLimit: { ...after.nearLimit, rejected: { ...after.nearLimit.rejected, rejection: { name: 'CompactionInputError', code: 'other' } } } }).passed).toBe(false);
});
test('cache adoption refuses incompatible sampling and RSS regressions', () => {
  const { before, after } = cachedReceipts();
  expect(compareCachingPerformance(before, { ...after, ordinary: { ...measured, repetitions: 29 } }).passed).toBe(false);
  expect(compareCachingPerformance(before, { ...after, nearLimit: { ...after.nearLimit, budgetPressureV2: { ...after.nearLimit.budgetPressureV2, peakRssBytes: baseline.peakRssBytes + 8 * 1024 * 1024 + 1 } } }).passed).toBe(false);
  expect(compareCachingPerformance(before, { ...after, nearLimit: { ...after.nearLimit, budgetPressureV2: { ...after.nearLimit.budgetPressureV2, inputHash: 'changed' } } }).passed).toBe(false);
});
