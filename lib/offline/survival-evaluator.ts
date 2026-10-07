import { createHash } from 'node:crypto';
import { canonicalizeCompactionSource, type CompactionSource } from '../compaction-source.ts';
import { compileSessionJsonl } from '../local-compact.ts';
import { checkpointDigest, type ResumeCheckpointV1 } from '../compiler/checkpoint.ts';
import { markerProblems } from './quality-evaluator.ts';
import { SURVIVAL_CORPUS, SURVIVAL_CWD, type SurvivalFact } from './survival-corpus.ts';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const strategies = ['recent-only', 'baseline', 'checkpoint-protected'] as const;
type Strategy = (typeof strategies)[number];

/** Structured identity probe: exact checkpoint state, never prose proximity. */
export function probeCheckpointState(checkpoint: ResumeCheckpointV1, fact: SurvivalFact): boolean {
  switch (fact.state) {
    case 'pin': return checkpoint.pins.some(pin => pin.text === fact.text && pin.status === 'active');
    case 'task': return checkpoint.tasks.some(task => task.action === fact.text && task.status === 'pending');
    case 'decision': return checkpoint.decisions.some(decision => decision.text === fact.text);
    case 'evidence': return checkpoint.evidence.verification.some(receipt => receipt.command === fact.text && receipt.cwd === fact.cwd && receipt.status === 'PASS');
    default: return false;
  }
}
export const survivalSeal = () => ({ schema: 1, corpusHash: hash(JSON.stringify(SURVIVAL_CORPUS)), oracleHash: hash(JSON.stringify(SURVIVAL_CORPUS.map(({ id, facts }) => ({ id, facts })))), generations: SURVIVAL_CORPUS.reduce((total, fixture) => total + fixture.cycles.length, 0), strategies: strategies.length });
interface Tally { hits: number; total: number }
const tally = (facts: SurvivalFact[], present: (fact: SurvivalFact) => boolean): Tally => ({ hits: facts.filter(present).length, total: facts.length });
/**
 * Generation-survival measurement across sequential compactions. Protected
 * checkpoint-state survival is asserted only for checkpoint-protected carry;
 * every other curve is measured, not gated, so budget policy changes remain
 * comparable instead of coupled to this receipt.
 */
export function evaluateSurvivalQuality() {
  const seal = survivalSeal(); // frozen corpus captured before any compilation
  const failures: string[] = [];
  const curves: Array<{ fixture: string; selection: Strategy; generation: number; inputHash: string; summaryDigest?: string; summaryCodePoints?: number; state: Tally; summary: Record<'protected' | 'prose' | 'anchor', Tally> }> = [];
  const outcomes: Array<{ fixture: string; selection: Strategy; generations: number; state: Tally & { firstLossGeneration: number | null }; summary: Record<'protected' | 'prose' | 'anchor', Tally & { firstLossGeneration: number | null }> }> = [];
  for (const fixture of SURVIVAL_CORPUS) {
    const protectedFacts = fixture.facts.filter(fact => fact.class === 'protected');
    const carriedFacts = fixture.facts.filter(fact => fact.class !== 'protected');
    for (const selection of strategies) {
      // The prior generation's summary holds the plan as attributed prose.
      let previousSummary: string | undefined = [
        fixture.initial.objective,
        ...fixture.initial.tasks.map(task => `${task.action} (${task.status})`),
        ...fixture.initial.pins.map(pin => pin.text),
        ...fixture.initial.decisions.map(decision => decision.text),
      ].join('\n');
      let previousCheckpoint: ResumeCheckpointV1 = fixture.initial;
      const firstLoss = { state: null, protected: null, prose: null, anchor: null } as Record<'state' | 'protected' | 'prose' | 'anchor', number | null>;
      const seen = new Map<string, boolean>(); // carried-fact presence memory for no-resurrection
      let finalState: Tally = { hits: 0, total: protectedFacts.length };
      let finalSummary = { protected: { hits: 0, total: protectedFacts.length }, prose: { hits: 0, total: 0 }, anchor: { hits: 0, total: 0 } };
      for (const [generation, cycle] of fixture.cycles.entries()) {
        const messages = cycle.messages;
        const messageReferences = messages.map((message, messageIndex) => message.role === 'user' && typeof message.content === 'string' ? [{ sessionId: 'survival-oracle', entryId: `survival-entry-${generation}`, messageIndex, blockIndex: 0, contentDigest: hash(message.content), sourceKind: 'user' as const }] : []);
        const source: CompactionSource = {
          session: { id: 'survival-oracle', cwd: SURVIVAL_CWD, timestamp: '2026-01-01T00:00:00.000Z' },
          messagesToSummarize: messages, turnPrefixMessages: [], messageReferences,
          occurrences: messages.flatMap((message, index) => messageReferences[index]!.map(reference => ({ message, reference }))),
          ...(selection !== 'recent-only' ? { previousSummary } : {}),
          ...(selection === 'checkpoint-protected' ? { previousSummaryDigest: hash(previousSummary ?? ''), previousCheckpoint, previousCheckpointDigest: checkpointDigest(previousCheckpoint), predecessorEntryId: `survival-${generation}` } : {}),
        };
        const input = canonicalizeCompactionSource(source);
        const curve = { fixture: fixture.id, selection, generation, inputHash: hash(input.bytes), state: { hits: 0, total: protectedFacts.length }, summary: { protected: { hits: 0, total: protectedFacts.length }, prose: { hits: 0, total: 0 }, anchor: { hits: 0, total: 0 } } } as (typeof curves)[number];
        curves.push(curve);
        try {
          const result = compileSessionJsonl(input.bytes, undefined, undefined, false);
          const repeated = compileSessionJsonl(input.bytes, undefined, undefined, false);
          if (JSON.stringify(result) !== JSON.stringify(repeated)) failures.push(`${fixture.id}:${generation}:${selection}: nondeterministic output`);
          for (const problem of markerProblems(result.summary)) failures.push(`${fixture.id}:${generation}:${selection}: ${problem}`);
          curve.summaryDigest = result.summaryDigest;
          curve.summaryCodePoints = Array.from(result.summary).length;
          curve.state = tally(protectedFacts, fact => probeCheckpointState(result.checkpoint, fact));
          const summaryPresence = (fact: SurvivalFact) => result.summary.includes(fact.text);
          curve.summary = {
            protected: tally(protectedFacts, summaryPresence),
            prose: tally(carriedFacts.filter(fact => fact.class === 'prose'), summaryPresence),
            anchor: tally(carriedFacts.filter(fact => fact.class === 'anchor'), summaryPresence),
          };
          // The structural guarantee: protected state survives every generation.
          if (selection === 'checkpoint-protected' && curve.state.hits !== curve.state.total) failures.push(`${fixture.id}:${generation}:${selection}: protected checkpoint state lost ${curve.state.total - curve.state.hits}/${curve.state.total} items`);
          // Carried prose cannot resurrect: the previous summary is its only carrier.
          for (const fact of carriedFacts) {
            const present = summaryPresence(fact);
            if (generation > 0 && present && seen.get(fact.id) === false) failures.push(`${fixture.id}:${generation}:${selection}: dropped fact resurrected: ${fact.id}`);
            seen.set(fact.id, present);
          }
          if (firstLoss.state === null && curve.state.hits < curve.state.total) firstLoss.state = generation;
          for (const cls of ['protected', 'prose', 'anchor'] as const) if (firstLoss[cls] === null && curve.summary[cls].hits < curve.summary[cls].total) firstLoss[cls] = generation;
          finalState = curve.state;
          finalSummary = curve.summary;
          previousSummary = result.summary;
          previousCheckpoint = result.checkpoint;
        } catch (error) {
          failures.push(`${fixture.id}:${generation}:${selection}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      outcomes.push({ fixture: fixture.id, selection, generations: fixture.cycles.length, state: { ...finalState, firstLossGeneration: firstLoss.state }, summary: { protected: { ...finalSummary.protected, firstLossGeneration: firstLoss.protected }, prose: { ...finalSummary.prose, firstLossGeneration: firstLoss.prose }, anchor: { ...finalSummary.anchor, firstLossGeneration: firstLoss.anchor } } });
    }
  }
  if (JSON.stringify(seal) !== JSON.stringify(survivalSeal())) failures.push('survival corpus or fact oracle mutated');
  return {
    schema: 1, seal, passed: failures.length === 0, failures, curves, outcomes,
    limitations: [
      'Protected-state survival is asserted only for checkpoint-protected carry; recent-only and baseline measure loss without gating.',
      'Summary-projection survival is measured, not asserted: display budgets may legitimately shorten projections while checkpoint state stays exact.',
      'Offline chaining is not installed Pi, provider acceptance, crash-atomic delivery, or model attention evidence.',
    ],
  };
}
