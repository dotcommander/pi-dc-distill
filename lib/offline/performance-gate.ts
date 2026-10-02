/** Receipt comparison only; measurement belongs to isolated benchmark workers. */
export interface PerformanceMeasurement {
  inputHash: string;
  runtime: unknown;
  options: unknown;
  p50: number;
  p95: number;
  /** Absolute lifetime RSS high-water; checkpoint workers preload the identical Pi host. */
  peakRssBytes: number;
}
export function compareOrdinaryPerformance(baseline: PerformanceMeasurement, candidate: PerformanceMeasurement) {
  const failures: string[] = [];
  for (const key of ['inputHash', 'runtime', 'options'] as const) {
    if (JSON.stringify(baseline[key]) !== JSON.stringify(candidate[key])) failures.push(`${key} mismatch`);
  }
  for (const [label, measurement] of [['baseline', baseline], ['candidate', candidate]] as const) {
    for (const key of ['p50', 'p95', 'peakRssBytes'] as const) {
      if (!Number.isFinite(measurement[key]) || measurement[key] < 0) failures.push(`${label} ${key} is invalid`);
    }
    if (measurement.p95 < measurement.p50) failures.push(`${label} percentiles are unordered`);
  }
  const limits = {
    p50: Math.max(baseline.p50 * 1.10, baseline.p50 + 1),
    p95: Math.max(baseline.p95 * 1.10, baseline.p95 + 1),
    peakRssBytes: baseline.peakRssBytes + 8 * 1024 * 1024,
  };
  if (!failures.length) for (const key of ['p50', 'p95', 'peakRssBytes'] as const) {
    if (candidate[key] > limits[key]) failures.push(`${key}=${candidate[key]} exceeds ${limits[key]}`);
  }
  return { passed: failures.length === 0, failures, limits };
}
