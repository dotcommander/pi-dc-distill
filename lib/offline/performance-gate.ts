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

export interface CompilerMeasurement extends PerformanceMeasurement {
  warmups: number;
  repetitions: number;
  canonical?: unknown;
  result?: unknown;
  rejection?: unknown;
}
/** Cache acceptance requires identical complete outputs, including typed rejection. */
export function compareCachingPerformance(
  baseline: { ordinary: CompilerMeasurement; nearLimit: Record<string, CompilerMeasurement> },
  candidate: { ordinary: CompilerMeasurement; nearLimit: Record<string, CompilerMeasurement> },
) {
  const ordinaryGate = compareOrdinaryPerformance(baseline.ordinary, candidate.ordinary);
  const failures = ordinaryGate.failures.map(value => `ordinary: ${value}`);
  const before: Record<string, CompilerMeasurement> = { ordinary: baseline.ordinary, ...baseline.nearLimit };
  const after: Record<string, CompilerMeasurement> = { ordinary: candidate.ordinary, ...candidate.nearLimit };
  const names = Object.keys(before).sort();
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(after).sort())) failures.push('workload set mismatch');
  for (const name of names) {
    const left = before[name], right = after[name];
    if (!left || !right) { failures.push(`${name}: missing measurement`); continue; }
    const identity = compareOrdinaryPerformance(left, right);
    // Only ordinary latency is an adoption guard, but RSS and valid identity
    // apply to every workload, including protected-overflow rejection cases.
    failures.push(...identity.failures.filter(value => !value.startsWith('p50=') && !value.startsWith('p95=')).map(value => `${name}: ${value}`));
    for (const measurement of [left, right]) if (measurement.warmups !== 10 || measurement.repetitions !== 30) failures.push(`${name}: requires 10 warmups and 30 samples`);
    for (const key of ['canonical', 'result', 'rejection'] as const) {
      if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) failures.push(`${name}: complete ${key} parity mismatch`);
    }
    if ((left.result === undefined) === (left.rejection === undefined) || (right.result === undefined) === (right.rejection === undefined)) failures.push(`${name}: missing or ambiguous output`);
  }
  for (const name of ['unicodeLexical', 'protectedOverflow', 'readinessIdentity']) {
    if (!baseline.nearLimit[name] || !candidate.nearLimit[name]) failures.push(`${name}: required parity workload missing`);
  }
  const pressure = baseline.nearLimit.budgetPressureV2, cached = candidate.nearLimit.budgetPressureV2;
  const pressureP50Limit = pressure ? pressure.p50 * .90 : null;
  if (!pressure || !cached) failures.push('budgetPressureV2 measurement missing');
  else if (!(pressure.p50 > 0) || cached.p50 > pressure.p50 * .90) failures.push(`budgetPressureV2: p50 must improve at least 10% (limit=${pressureP50Limit})`);
  return { passed: failures.length === 0, failures: [...new Set(failures)], ordinaryGate, pressureP50Limit };
}
