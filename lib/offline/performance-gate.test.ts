import { expect, test } from 'bun:test';
import { compareOrdinaryPerformance, type PerformanceMeasurement } from './performance-gate.ts';
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
