import { createHash } from 'node:crypto';
import type { ResumeCheckpointV1 } from '../compiler/checkpoint.ts';
import type { CompactionSource } from '../compaction-source.ts';

/**
 * Generation-survival corpus: phase-shaped, marathon-length sessions with
 * facts planted exactly once at or before generation 0. Survival of every
 * fact is probed at each compaction generation. Oracles are authored from
 * the requested behavior and never harvested from compiler output.
 */
export type SurvivalState = 'pin' | 'task' | 'decision' | 'evidence';
export interface SurvivalFact {
  id: string;
  class: 'protected' | 'prose' | 'anchor';
  text: string;
  /** Structured checkpoint identity for protected facts. */
  state?: SurvivalState;
  cwd?: string;
}
export interface SurvivalFixture {
  id: string;
  initial: ResumeCheckpointV1;
  facts: SurvivalFact[];
  cycles: Array<{ messages: CompactionSource['messagesToSummarize'] }>;
}

const cwd = '/survival/oracle';
const constraint = 'Never generate invoices against production endpoints.';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
// Controlled prior snapshot, not a claim of live Pi authentication.
const initial: ResumeCheckpointV1 = {
  version: 1, objective: 'Ship the billing v2 schema migration with exact verification', files: { read: [], modified: [] },
  tasks: [
    { id: 'analyze', action: 'Map nullable v2 columns in the billing adapter', status: 'pending', 'depends-on': [], blocker: '', requires: [] },
    { id: 'migrate', action: 'Rewrite the adapter mapping with zero-total collapse', status: 'pending', 'depends-on': ['analyze'], blocker: '', requires: ['v2-suite'] },
    { id: 'verify', action: 'Run the exact v2 suite before declaring done', status: 'pending', 'depends-on': [], blocker: '', requires: [] },
  ],
  pins: [{ id: 'no-production', purpose: 'constraint', text: constraint, status: 'active', source: { sessionId: 'survival-oracle', entryId: 'origin-user-entry', messageIndex: 0, blockIndex: 0, start: 0, end: constraint.length, contentDigest: hash(constraint), sourceKind: 'user' } }],
  constraints: [constraint],
  decisions: [{ id: 'adapter-owns-nulls', text: 'Nullable columns are normalized in the adapter, never by callers', rationale: 'Callers cannot distinguish legacy absence from v2 null.' }],
  preconditions: [{ id: 'v2-suite', kind: 'verification-pass', runner: 'bash', command: 'bun test adapters/billing-v2.test.ts', cwd }],
  evidence: { mutationEpoch: 0, fileReads: [], verification: [{ id: 'origin-check', tool: 'bash', command: 'bun test adapters/billing-v2.test.ts', cwd, evidence: '18 pass, 0 fail', status: 'PASS', mutationEpoch: 0, freshnessEstablished: true }], modifiedPaths: [] },
  risks: [], failures: [], omittedResolvedFailures: 0, predecessor: null, updateEntryId: null,
};
const protectedFacts: SurvivalFact[] = [
  { id: 'pin-constraint', class: 'protected', text: constraint, state: 'pin' },
  { id: 'task-analyze', class: 'protected', text: 'Map nullable v2 columns in the billing adapter', state: 'task' },
  { id: 'task-migrate', class: 'protected', text: 'Rewrite the adapter mapping with zero-total collapse', state: 'task' },
  { id: 'task-verify', class: 'protected', text: 'Run the exact v2 suite before declaring done', state: 'task' },
  { id: 'decision-nulls', class: 'protected', text: 'Nullable columns are normalized in the adapter, never by callers', state: 'decision' },
  { id: 'evidence-suite', class: 'protected', text: 'bun test adapters/billing-v2.test.ts', state: 'evidence', cwd },
];
const proseFacts: SurvivalFact[] = [
  { id: 'prose-fixture-path-line', class: 'prose', text: 'The staging invoice fixture lives at tests/fixtures/invoice-v2.json' },
  { id: 'prose-rounding', class: 'prose', text: 'Legacy rounding stays banker rounding until the audit lands' },
  { id: 'prose-retry-budget', class: 'prose', text: 'The webhook retry budget is 3 attempts over 90 seconds' },
  { id: 'prose-zero-totals', class: 'prose', text: 'Nullable line items collapse to zero totals, never null totals' },
  { id: 'prose-rollout-window', class: 'prose', text: 'The v2 rollout window opens after invoice batch 4821 completes' },
];
const anchorFacts: SurvivalFact[] = [
  { id: 'anchor-fixture-path', class: 'anchor', text: 'tests/fixtures/invoice-v2.json' },
  { id: 'anchor-schema-url', class: 'anchor', text: 'https://billing.example.invalid/v2/invoices' },
  { id: 'anchor-revision-digest', class: 'anchor', text: 'd3f1a9c04be2716f5a8c2e9401b7d6c3a5e8f219' },
];
const facts: SurvivalFact[] = [...protectedFacts, ...proseFacts, ...anchorFacts];
/** The plan is stated exactly once; later turns never restate any probe fact. */
const plan = [
  'Migration plan for the billing adapter v2, stated once for the whole session:',
  ...proseFacts.map(fact => fact.text),
  `Reference schema: ${anchorFacts[1]!.text}`,
  `Reference revision digest: ${anchorFacts[2]!.text}`,
].join('\n');
const statusLines = [
  'Continue with the next migration step.',
  'Adapter mapping analysis complete; proceeding to the rewrite.',
  'Schema mapping drafted; the collapse branch still needs coverage.',
  'Reviewing the migration diff against the v2 reference before verification.',
];
function thinCycle(generation: number): CompactionSource['messagesToSummarize'] {
  const messages: CompactionSource['messagesToSummarize'] = [];
  if (generation % 4 === 2) messages.push({ role: 'user', content: 'continue' });
  messages.push({ role: 'assistant', content: statusLines[generation % statusLines.length]! });
  if (generation % 3 === 1) {
    messages.push({ role: 'assistant', content: [{ type: 'toolCall', id: `probe-${generation}`, name: 'bash', arguments: { command: `grep -n nullable adapters/billing-${generation}.ts` } }] });
    messages.push({ role: 'toolResult', toolCallId: `probe-${generation}`, toolName: 'bash', content: `billing-${generation}.ts:42: nullable columns mapped`, isError: false });
  }
  return messages;
}
const marathonCycles = Array.from({ length: 12 }, (_, generation) => ({ messages: generation === 0 ? [
  { role: 'user', content: plan } as const,
  { role: 'assistant', content: [{ type: 'toolCall', id: 'origin-read', name: 'read', arguments: { path: anchorFacts[0]!.text } }] } as const,
  { role: 'toolResult', toolCallId: 'origin-read', toolName: 'read', content: '{ "rounding": "banker", "nullable_line_items": true }', isError: false } as const,
  { role: 'assistant', content: [{ type: 'toolCall', id: 'origin-suite', name: 'bash', arguments: { command: 'bun test adapters/billing-v2-mapping.test.ts' } }] } as const,
  { role: 'toolResult', toolCallId: 'origin-suite', toolName: 'bash', content: '7 pass, 0 fail', isError: false } as const,
  ...thinCycle(0) as CompactionSource['messagesToSummarize'],
] : thinCycle(generation) }));
/** Optional padding records pressure the operating budget each generation. */
function pressureCycle(generation: number): CompactionSource['messagesToSummarize'] {
  const padding = Array.from({ length: 3 }, (_, index) => ({
    role: 'assistant',
    content: `Optional ledger note ${generation}.${index}: ${'🧮🧾'.repeat(900)}`,
  } as const));
  return [...padding, ...thinCycle(generation)] as CompactionSource['messagesToSummarize'];
}
const pressureCycles = Array.from({ length: 8 }, (_, generation) => ({
  messages: generation === 0 ? [{ role: 'user', content: plan } as const, ...pressureCycle(0)] : pressureCycle(generation),
}));
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
export const SURVIVAL_CWD = cwd;
export const SURVIVAL_CORPUS: readonly SurvivalFixture[] = freeze([
  { id: 'phase-plan-marathon-12-generations', initial: JSON.parse(JSON.stringify(initial)), facts, cycles: marathonCycles },
  { id: 'phase-plan-under-pressure-8-generations', initial: JSON.parse(JSON.stringify(initial)), facts, cycles: pressureCycles },
]);
