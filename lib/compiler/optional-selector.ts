/** Deterministic bounded weighted coverage; no approximation guarantee is claimed. */
export const OPTIONAL_RECORD_KINDS = ["conversation", "retained-context", "tool-call", "tool-result", "file-observation", "working-tree", "anchor", "stale-verification"] as const;
export type OptionalRecordKind = typeof OPTIONAL_RECORD_KINDS[number];
export interface RecordFeatures { frontier?: readonly string[]; evidence?: readonly string[]; paths?: readonly string[] }
export interface MandatorySelectionRecord { id: string; features?: RecordFeatures }
export interface OptionalSelectionRecord extends MandatorySelectionRecord {
  kind: OptionalRecordKind;
  /** Exact incremental escaped/rendered Unicode code-point cost, including separators. */
  renderedCost: number;
  sourceSequence: number;
  structuralPriority?: number;
}
export interface OptionalSelectionInput {
  mandatory: readonly MandatorySelectionRecord[];
  candidates: readonly OptionalSelectionRecord[];
  frontierFeatures: readonly string[];
  renderedBudget: number;
  /** Without renderCost, this includes all mandatory text, headings and omission framing. */
  mandatoryRenderedCost?: number;
  /** Exact COMPLETE rendering cost, including omissions. Must not mutate input. */
  renderCost?: (selectedIds: readonly string[], omissions: Readonly<Record<OptionalRecordKind, number>>) => number;
}
export interface OptionalSelectionResult {
  selectedIds: string[];
  omittedCounts: Record<OptionalRecordKind, number>;
  diagnostics: { considered: number; prefiltered: number; shortenedFeatures: number; coverage: number; renderedCost: number; protectedOverflow: boolean };
}
const counts = (): Record<OptionalRecordKind, number> => Object.fromEntries(OPTIONAL_RECORD_KINDS.map(kind => [kind, 0])) as Record<OptionalRecordKind, number>;
const stableCompare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

function featureReader(frontier: Set<string>, shortened: () => void) {
  return (value?: RecordFeatures): Map<string, number> => {
    const result = new Map<string, number>();
    const add = (category: string, values: readonly string[] | undefined, weight: number, filter?: Set<string>) => {
      for (const feature of values ?? []) {
        if (!feature || (filter && !filter.has(feature))) continue;
        const key = `${category}:${feature}`;
        if (result.has(key)) continue;
        if (result.size >= 128) { shortened(); continue; }
        result.set(key, weight);
      }
    };
    add("frontier", value?.frontier, 4, frontier);
    add("evidence", value?.evidence, 2);
    add("path", value?.paths, 1);
    return result;
  };
}

/** Shared ranking and admission path for greedy selection and exact all-fit rendering. */
function prepareCandidates(candidates: readonly OptionalSelectionRecord[], seenIds: Set<string>, features: ReturnType<typeof featureReader>) {
  const total = counts();
  const prepared = candidates.map(record => {
    if (!record.id || seenIds.has(record.id)) throw new Error("duplicate or empty record id");
    seenIds.add(record.id);
    if (!OPTIONAL_RECORD_KINDS.includes(record.kind) || !Number.isSafeInteger(record.renderedCost) || record.renderedCost < 0 || !Number.isFinite(record.sourceSequence) || !Number.isFinite(record.structuralPriority ?? 0)) throw new Error("invalid optional record");
    total[record.kind]++;
    const recordFeatures = features(record.features);
    let relevance = 0;
    for (const key of recordFeatures.keys()) if (key.startsWith("frontier:")) relevance++;
    return { record, features: recordFeatures, relevance, gain: 0, remaining: true };
  });
  prepared.sort((a, b) => (b.record.structuralPriority ?? 0) - (a.record.structuralPriority ?? 0) || b.relevance - a.relevance || b.record.sourceSequence - a.record.sourceSequence || stableCompare(a.record.id, b.record.id));
  const perKind = counts();
  const pool = prepared.filter(({ record }) => {
    if (perKind[record.kind] >= 32) return false;
    perKind[record.kind]++; return true;
  }).slice(0, 256);
  return { prepared, pool, total };
}

export function prefilterOptionalRecords(input: Pick<OptionalSelectionInput, "candidates" | "frontierFeatures">): { candidateIds: string[]; omittedCounts: Record<OptionalRecordKind, number> } {
  const { pool, total } = prepareCandidates(input.candidates, new Set(), featureReader(new Set(input.frontierFeatures), () => {}));
  const omittedCounts = { ...total };
  for (const { record } of pool) omittedCounts[record.kind]--;
  return { candidateIds: pool.map(({ record }) => record.id), omittedCounts };
}

export function selectOptionalRecords(input: OptionalSelectionInput): OptionalSelectionResult {
  if (!Number.isSafeInteger(input.renderedBudget) || input.renderedBudget < 0) throw new Error("invalid rendered budget");
  if (!input.renderCost && (!Number.isSafeInteger(input.mandatoryRenderedCost) || input.mandatoryRenderedCost! < 0)) throw new Error("mandatory rendered cost required without renderer");
  let shortenedFeatures = 0;
  const features = featureReader(new Set(input.frontierFeatures), () => { shortenedFeatures++; });
  const seenIds = new Set<string>();
  const covered = new Map<string, number>();
  for (const record of input.mandatory) {
    if (!record.id || seenIds.has(record.id)) throw new Error("duplicate or empty record id");
    seenIds.add(record.id);
    for (const [key, weight] of features(record.features)) covered.set(key, weight);
  }
  const { prepared, pool, total } = prepareCandidates(input.candidates, seenIds, features);
  const selected: typeof pool = [];
  const omissions = () => {
    const result = { ...total };
    for (const { record } of selected) result[record.kind]--;
    return result;
  };
  const renderCost = () => {
    const cost = input.renderCost ? input.renderCost(selected.map(entry => entry.record.id), omissions()) : input.mandatoryRenderedCost! + selected.reduce((sum, entry) => sum + entry.record.renderedCost, 0);
    if (!Number.isSafeInteger(cost) || cost < 0) throw new Error("renderer returned invalid code-point cost");
    return cost;
  };
  const protectedOverflow = renderCost() > input.renderedBudget;
  // Cache each marginal gain and update only candidates sharing newly covered
  // features. A bounded linear winner scan avoids repeated sorting and Map
  // traversal/allocation inside its comparator.
  const sharing = new Map<string, typeof pool>();
  if (!protectedOverflow) for (const entry of pool) for (const [key, weight] of entry.features) {
    if (covered.has(key)) continue;
    entry.gain += weight;
    const entries = sharing.get(key);
    if (entries) entries.push(entry); else sharing.set(key, [entry]);
  }
  const compare = (a: typeof pool[number], b: typeof pool[number]) => {
    const ag = a.gain, bg = b.gain;
    // Cross multiplication avoids division and makes zero-cost ties explicit.
    const az = a.record.renderedCost === 0 && ag > 0, bz = b.record.renderedCost === 0 && bg > 0;
    if (az !== bz) return az ? -1 : 1;
    const ac = Math.max(1, a.record.renderedCost), bc = Math.max(1, b.record.renderedCost);
    return bg * ac - ag * bc || bg - ag || a.record.renderedCost - b.record.renderedCost || b.record.sourceSequence - a.record.sourceSequence || stableCompare(a.record.id, b.record.id);
  };
  let remainingCount = pool.length;
  while (!protectedOverflow && remainingCount > 0) {
    let winner: typeof pool[number] | undefined;
    for (const candidate of pool) if (candidate.remaining && (!winner || compare(candidate, winner) < 0)) winner = candidate;
    const entry = winner!;
    entry.remaining = false;
    remainingCount--;
    selected.push(entry);
    if (renderCost() > input.renderedBudget) { selected.pop(); continue; }
    for (const [key, weight] of entry.features) {
      if (covered.has(key)) continue;
      covered.set(key, weight);
      for (const candidate of sharing.get(key) ?? []) if (candidate.remaining) candidate.gain -= weight;
      sharing.delete(key);
    }
  }
  return { selectedIds: selected.map(entry => entry.record.id), omittedCounts: omissions(), diagnostics: {
    considered: pool.length, prefiltered: prepared.length - pool.length, shortenedFeatures,
    coverage: [...covered.values()].reduce((sum, weight) => sum + weight, 0), renderedCost: renderCost(), protectedOverflow,
  } };
}
