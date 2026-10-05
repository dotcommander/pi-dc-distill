import { afterEach, beforeEach, expect, test } from 'bun:test';
import { SURVIVAL_CORPUS } from './survival-corpus.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const scratch = mkdtempSync(join(tmpdir(), 'dc-distill-survival-oracle-'));
const previousPiDirectory = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = join(scratch, 'agent');
const { survivalSeal, evaluateSurvivalQuality, probeCheckpointState } = await import('./survival-evaluator.ts');
if (previousPiDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
else process.env.PI_CODING_AGENT_DIR = previousPiDirectory;
let activePiDirectory: string | undefined;
beforeEach(() => { activePiDirectory = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = join(scratch, 'agent'); });
afterEach(() => { if (activePiDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = activePiDirectory; });

test('state probe independently detects lost pin, task, decision and exact evidence', () => {
  const fixture = SURVIVAL_CORPUS[0]!;
  const damaged = JSON.parse(JSON.stringify(fixture.initial));
  damaged.pins = []; damaged.tasks = []; damaged.decisions = [];
  damaged.evidence.verification[0].command += ' ';
  for (const fact of fixture.facts.filter(fact => fact.class === 'protected'))
    expect(probeCheckpointState(damaged, fact)).toBe(false);
  for (const fact of fixture.facts.filter(fact => fact.class === 'protected'))
    expect(probeCheckpointState(fixture.initial, fact)).toBe(true);
});

test('protected carry survives every generation while controls measurably decay', () => {
  const report = evaluateSurvivalQuality();
  expect(report.failures).toEqual([]);
  expect(report.passed).toBe(true);
  expect(report.curves).toHaveLength(survivalSeal().generations * 3);
  // The structural guarantee: exact protected state at every generation.
  for (const curve of report.curves.filter(value => value.selection === 'checkpoint-protected'))
    expect(curve.state.hits).toBe(curve.state.total);
  // The metric discriminates: without checkpoint carry the protected state decays.
  const floor = report.outcomes.filter(value => value.selection === 'recent-only');
  expect(floor.length).toBeGreaterThan(0);
  expect(floor.some(value => value.state.hits < value.state.total)).toBe(true);
  const baseline = report.outcomes.filter(value => value.selection === 'baseline');
  expect(baseline.some(value => value.state.hits < value.state.total)).toBe(true);
}, 60_000);

test('survival receipts are deterministic', () => {
  const first = evaluateSurvivalQuality();
  const second = evaluateSurvivalQuality();
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  expect(survivalSeal()).toEqual(survivalSeal());
}, 60_000);
