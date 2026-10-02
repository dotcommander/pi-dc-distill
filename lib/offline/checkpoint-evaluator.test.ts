import { expect, test } from 'bun:test';
import { CHECKPOINT_CORPUS } from './checkpoint-corpus.ts';
import { checkpointQualitySeal, evaluateCheckpointQuality, inspectCheckpointOracle } from './checkpoint-evaluator.ts';
test('checkpoint oracle detects missing declared work, pins, decisions and exact evidence independently', () => {
  const fixture = CHECKPOINT_CORPUS.find(value => value.id === "unresolved-work-and-old-user-pin")!;
  const damaged = JSON.parse(JSON.stringify(fixture.initial));
  damaged.tasks = []; damaged.pins = []; damaged.decisions = [];
  damaged.evidence.verification[0].command += ' ';
  const problems = inspectCheckpointOracle(damaged, '', fixture.cycles[0]!.oracle);
  expect(problems.some(value => value.includes('task parser'))).toBe(true);
  expect(problems.some(value => value.includes('pin local-only'))).toBe(true);
  expect(problems.some(value => value.includes('decision deterministic'))).toBe(true);
  expect(problems.some(value => value.includes('exact evidence missing'))).toBe(true);
});
test('protected carry retains declared work and old pins while mutation makes prior verification historical', () => {
  const seal = checkpointQualitySeal();
  const report = evaluateCheckpointQuality();
  expect(report.failures).toEqual([]);
  expect(report.comparisons).toHaveLength(27);
  expect(report.comparisons.filter(value => value.selection === 'checkpoint-protected').every(value => value.problems.length === 0)).toBe(true);
  expect(report.comparisons.some(value => value.selection === 'recent-only' && value.problems.length > 0)).toBe(true);
  expect(checkpointQualitySeal()).toEqual(seal);
}, 30_000);
