import { createHash } from 'node:crypto';
import { canonicalizeCompactionSource, type CompactionSource } from '../compaction-source.ts';
import { compileSessionJsonl } from '../local-compact.ts';
import { checkpointDigest, type ResumeCheckpointV1 } from '../compiler/checkpoint.ts';
import { CHECKPOINT_CORPUS, type CheckpointOracle } from './checkpoint-corpus.ts';
import { markerProblems } from './quality-evaluator.ts';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export function inspectCheckpointOracle(checkpoint: ResumeCheckpointV1, summary: string, oracle: CheckpointOracle): string[] {
  const problems: string[] = [];
  for (const task of oracle.tasks) if (!checkpoint.tasks.some(value => value.id === task.id && value.status === task.status)) problems.push(`task ${task.id} missing or wrong declared status`);
  for (const pin of oracle.pins) if (!checkpoint.pins.some(value => value.id === pin.id && value.text === pin.text && value.status === pin.status && value.source.entryId === pin.entryId && value.source.sourceKind === 'user')) problems.push(`pin ${pin.id} lost text, status or source attribution`);
  for (const decision of oracle.decisions) if (!checkpoint.decisions.some(value => value.id === decision.id && value.text === decision.text)) problems.push(`decision ${decision.id} missing`);
  for (const identity of oracle.evidence) {
    const receipts = checkpoint.evidence.verification.filter(value => value.tool === identity.runner && value.command === identity.command && value.cwd === identity.cwd);
    if (!receipts.length) problems.push(`exact evidence missing: ${identity.command}`);
    else if (!receipts.some(value => (value.mutationEpoch < checkpoint.evidence.mutationEpoch) === identity.historical)) problems.push(`evidence freshness wrong: ${identity.command}`);
  }
  for (const fact of oracle.requiredSummary) if (!summary.includes(fact)) problems.push(`protected summary fact missing: ${fact}`);
  if (oracle.allowedTaskIds && checkpoint.tasks.some(task => !oracle.allowedTaskIds!.includes(task.id))) problems.push('undeclared request promoted into task authority');
  if (oracle.allowedPinIds && checkpoint.pins.some(pin => !oracle.allowedPinIds!.includes(pin.id))) problems.push('undeclared request promoted into pin authority');
  const authority = JSON.stringify(checkpoint);
  for (const text of oracle.forbiddenAuthority ?? []) if (authority.includes(text)) problems.push('context promoted into checkpoint authority');
  if (oracle.requestCandidate) {
    // Independent wire oracle: do not harvest expectations through production's
    // capture/render/parser helpers. Both source identity and edge text matter.
    const match = summary.match(/<request-candidate-v1>\s*([^]*?)\s*<\/request-candidate-v1>/);
    try {
      const candidate = JSON.parse((match?.[1] ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
      if (candidate.source?.entryId !== oracle.requestCandidate.entryId || candidate.source?.sessionId !== 'checkpoint-oracle' || candidate.originalDigest !== oracle.requestCandidate.digest || candidate.source?.contentDigest !== oracle.requestCandidate.digest || candidate.source?.sourceKind !== 'user') problems.push('request candidate source identity lost');
      if (candidate.attribution !== 'native user source; context only, not declared work or authorization') problems.push('request attribution missing');
      for (const text of oracle.requestCandidate.includes) if (!candidate.request?.includes(text)) problems.push(`request context missing: ${text}`);
    } catch { problems.push('request candidate missing or malformed'); }
  }
  return problems;
}
export const checkpointQualitySeal = () => ({ schema: 1, corpusHash: hash(JSON.stringify(CHECKPOINT_CORPUS)), oracleHash: hash(JSON.stringify(CHECKPOINT_CORPUS.map(({ id, cycles }) => ({ id, oracles: cycles.map(cycle => cycle.oracle) })))), comparisons: CHECKPOINT_CORPUS.reduce((n, fixture) => n + fixture.cycles.length * 3, 0) });
export function evaluateCheckpointQuality() {
  const seal = checkpointQualitySeal();
  const failures: string[] = [];
  const comparisons: Array<{ fixture: string; cycle: number; selection: string; inputHash: string; summaryDigest?: string; problems: string[] }> = [];
  for (const fixture of CHECKPOINT_CORPUS) for (const selection of ['recent-only', 'baseline', 'checkpoint-protected'] as const) {
    // Same prior textual facts are available to the summary-only control. This
    // independent prose is attributed context, not a parsed declaration update.
    let previousSummary: string | undefined = [
      fixture.initial.objective,
      ...fixture.initial.tasks.map(task => `${task.id}: ${task.action} (${task.status})`),
      ...fixture.initial.pins.map(pin => `${pin.id}: ${pin.text} (${pin.status}; source ${pin.source.entryId})`),
      ...fixture.initial.decisions.map(decision => `${decision.id}: ${decision.text}`),
    ].join('\n');
    let previousCheckpoint: ResumeCheckpointV1 = fixture.initial;
    for (const [cycleIndex, cycle] of fixture.cycles.entries()) {
      const messages = selection === 'recent-only' ? cycle.messages.slice(-1) : cycle.messages;
      const messageReferences = messages.map((message, messageIndex) => message.role === 'user' && typeof message.content === 'string' ? [{ sessionId: 'checkpoint-oracle', entryId: `request-entry-${cycleIndex}`, messageIndex, blockIndex: 0, contentDigest: hash(message.content), sourceKind: 'user' as const }] : []);
      const source: CompactionSource = {
        session: { id: 'checkpoint-oracle', cwd: '/checkpoint/oracle', timestamp: '2026-01-01T00:00:00.000Z' },
        messagesToSummarize: messages,
        turnPrefixMessages: [],
        messageReferences,
        // Occurrence metadata enables canonical provenance serialization. A
        // reference without its occurrence is intentionally diagnostic-only.
        occurrences: messages.flatMap((message, index) => messageReferences[index]!.map(reference => ({ message, reference }))),
        ...(selection !== 'recent-only' ? { previousSummary } : {}),
        ...(selection === 'checkpoint-protected' ? { previousSummaryDigest: hash(previousSummary ?? ""), previousCheckpoint, previousCheckpointDigest: checkpointDigest(previousCheckpoint), predecessorEntryId: `checkpoint-${cycleIndex}` } : {}),
      };
      const input = canonicalizeCompactionSource(source);
      try {
        const result = compileSessionJsonl(input.bytes, undefined, undefined, false, 'baseline');
        const repeated = compileSessionJsonl(input.bytes, undefined, undefined, false, 'baseline');
        const problems = inspectCheckpointOracle(result.checkpoint, result.summary, cycle.oracle);
        const invariantProblems = markerProblems(result.summary);
        if (JSON.stringify(result) !== JSON.stringify(repeated)) invariantProblems.push('nondeterministic output');
        // Controls measure loss. Only the protected strategy owes the state guarantee.
        for (const problem of [...invariantProblems, ...(selection === 'checkpoint-protected' ? problems : [])]) failures.push(`${fixture.id}:${cycleIndex}:${selection}: ${problem}`);
        comparisons.push({ fixture: fixture.id, cycle: cycleIndex, selection, inputHash: hash(input.bytes), summaryDigest: result.summaryDigest, problems });
        previousSummary = result.summary;
        previousCheckpoint = result.checkpoint;
      } catch (error) {
        const problem = error instanceof Error ? error.message : String(error);
        failures.push(`${fixture.id}:${cycleIndex}:${selection}: ${problem}`);
        comparisons.push({ fixture: fixture.id, cycle: cycleIndex, selection, inputHash: hash(input.bytes), problems: [problem] });
      }
    }
  }
  if (JSON.stringify(seal) !== JSON.stringify(checkpointQualitySeal())) failures.push('checkpoint corpus or oracle mutated');
  return { schema: 1, seal, passed: failures.length === 0, failures, comparisons, limitations: ['Baseline means summary-only carry using the production optional selector; recent-only carries no prior state.', 'Protected comparisons use controlled validated prior snapshots. Live source authentication and update transactions are tested at their owning boundaries.', 'Offline retention does not establish installed runtime, provider acceptance or model attention.'] };
}
