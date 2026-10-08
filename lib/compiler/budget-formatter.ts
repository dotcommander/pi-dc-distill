import { codePointLength } from "../unicode.ts";
import { CompactionInputError } from "./errors.ts";
import {
  SUMMARY_FORMAT, SUMMARY_NOTICE, MAX_TEXT_CODE_POINTS,
  MAX_READ_FILES, MAX_MODIFIED_FILES, MAX_COMMANDS,
  MAX_STRUCTURED_SUMMARY_CODE_POINTS,
  TARGET_RESUME_SUMMARY_CODE_POINTS, OPTIONAL_FACTS_CODE_POINTS,
  shorten, conversationalExcerpt, saturatingAdd, emptyOmissions,
} from "./helpers.ts";
import { excerptClass, excerptScore, SUBSTANTIVE_THRESHOLD } from "./signal.ts";
import type { CompactionSource, CompileOptions, DcDistillSummary, ObservationFacts, ObservationOrigin, SummaryRecord, TextObservation, LatestRequest } from "./types.ts";

import { encodeSummary, summaryCost, serializedRowCost, recordRow, fileRow, commandRow, omittedRow } from "./summary-codec.ts";
import { evictOldestOptional } from "./eviction.ts";
export { encodeSummary, decodeSummary } from "./summary-codec.ts";
export { evictOldestOptional } from "./eviction.ts";

function observation(value: string, previousShortened: boolean, origin: ObservationOrigin): TextObservation {
  const reduced = conversationalExcerpt(value, MAX_TEXT_CODE_POINTS);
  return { text: reduced.text, shortened: previousShortened || reduced.shortened, origin };
}

/** Each candidate retains its own typed lane, so heterogeneous facts need no array cast. */
function factCandidate<T>(facts: readonly T[], rows: T[], costs: readonly number[], offset: number,
  limit: number, counter: "readFiles" | "modifiedFiles" | "commands", carried: number) {
  const row = facts.at(-offset);
  const rowCost = costs.at(-offset);
  if (row === undefined || rowCost === undefined || rows.length >= limit) return undefined;
  return { rowCost, counter, omitted: saturatingAdd(carried, facts.length - rows.length - 1), admit: () => rows.unshift(row) };
}

interface ExcerptCandidate { index: number; priority: 1 | 2 | 3; score: number; rowCost: number }
function compareAdmission(a: ExcerptCandidate, b: ExcerptCandidate): number {
  return b.priority - a.priority || (a.priority === 3 ? b.index - a.index
    : a.priority === 2 ? Number(b.score >= SUBSTANTIVE_THRESHOLD) - Number(a.score >= SUBSTANTIVE_THRESHOLD) || b.index - a.index
    : b.score - a.score || b.index - a.index);
}

/** Select complete rows using their escaped serialized cost, never a wire substring. */
export function buildSummary(source: CompactionSource, facts: ObservationFacts, options: CompileOptions = {}): DcDistillSummary {
  const predecessor = source.predecessor;
  const excerptRecords = source.records;
  const newestRequest = source.records.findLast(record => record.kind === "user" && record.nativeUserText === true);
  const latestRequest: LatestRequest | null = newestRequest
    ? { ...observation(newestRequest.text, newestRequest.textShortened === true, "current"), afterRecords: 0 }
    : predecessor?.latestRequest ? { ...observation(predecessor.latestRequest.text, predecessor.latestRequest.shortened, "prior"), afterRecords: 0 } : null;
  const excerpts: SummaryRecord[] = predecessor?.records.map(row => ({ ...row, origin: "prior" })) ?? [];
  const scores = excerpts.map(excerptScore);
  if (newestRequest && predecessor?.latestRequest) {
    const { text, shortened, afterRecords } = predecessor.latestRequest;
    excerpts.splice(afterRecords, 0, { kind: "user", text, shortened, origin: "prior" });
    scores.splice(afterRecords, 0, SUBSTANTIVE_THRESHOLD);
  }
  let requestPosition = predecessor?.latestRequest?.afterRecords ?? 0;
  for (const record of excerptRecords) {
    if (record === newestRequest) requestPosition = excerpts.length;
    else {
      const opaque = record.kind === "native-summary" || record.kind === "branch-summary";
      const reduced = opaque || excerptClass(record.kind) === 1 ? shorten(record.text, MAX_TEXT_CODE_POINTS) : conversationalExcerpt(record.text, MAX_TEXT_CODE_POINTS);
      excerpts.push({ ...reduced, shortened: record.textShortened === true || reduced.shortened, origin: "current", kind: record.kind });
      scores.push(excerptScore(record));
    }
  }
  const base = { ...(predecessor?.omitted ?? emptyOmissions()) };
  base.inputRecords = saturatingAdd(base.inputRecords, source.omittedInputRecords);
  const document: DcDistillSummary = {
    format: SUMMARY_FORMAT, notice: SUMMARY_NOTICE,
    focus: options.focus == null ? null : shorten(options.focus, MAX_TEXT_CODE_POINTS),
    latestRequest, records: [], files: { read: [], modified: [] }, commands: [], omitted: { ...base },
  };
  const omissions = () => {
    document.omitted.excerpts = saturatingAdd(base.excerpts, excerpts.length - document.records.length);
    document.omitted.readFiles = saturatingAdd(base.readFiles, facts.files.read.length - document.files.read.length);
    document.omitted.modifiedFiles = saturatingAdd(base.modifiedFiles, facts.files.modified.length - document.files.modified.length);
    document.omitted.commands = saturatingAdd(base.commands, facts.commands.length - document.commands.length);
  };
  omissions();
  const mandatorySize = summaryCost(document);
  const operatingLimit = Math.max(TARGET_RESUME_SUMMARY_CODE_POINTS, mandatorySize);
  let serializedCost = mandatorySize;
  let factCost = 0;
  let factCount = 0;
  const costs = {
    modified: facts.files.modified.map(row => serializedRowCost(fileRow("modified", row))),
    commands: facts.commands.map(row => serializedRowCost(commandRow(row))),
    read: facts.files.read.map(row => serializedRowCost(fileRow("read", row))),
  };
  // Repeated newest modification, command, read selection; arrays end chronological.
  const rounds = Math.max(facts.files.modified.length, facts.commands.length, facts.files.read.length);
  for (let offset = 1; offset <= rounds; offset++) {
    const candidates = [
      factCandidate(facts.files.modified, document.files.modified, costs.modified, offset, MAX_MODIFIED_FILES, "modifiedFiles", base.modifiedFiles),
      factCandidate(facts.commands, document.commands, costs.commands, offset, MAX_COMMANDS, "commands", base.commands),
      factCandidate(facts.files.read, document.files.read, costs.read, offset, MAX_READ_FILES, "readFiles", base.readFiles),
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const { rowCost, counter, omitted } = candidate;
      const counterDelta = String(omitted).length - String(document.omitted[counter]).length;
      const nextFactCost = factCost + rowCost + (factCount > 0 ? 1 : 0);
      const nextSerializedCost = serializedCost + rowCost + 1 + counterDelta;
      if (nextFactCost > OPTIONAL_FACTS_CODE_POINTS || nextSerializedCost > operatingLimit) continue;
      // A rejection does not prevent a later, smaller candidate from fitting.
      candidate.admit();
      document.omitted[counter] = omitted;
      factCost = nextFactCost;
      factCount++;
      serializedCost = nextSerializedCost;
    }
  }
  // Exhaustive kind classes precede scoring; substantive conversation uses recency.
  // Rendering remains chronological across both groups.
  const priority = excerpts.map((row, index) => ({ index, priority: excerptClass(row.kind), score: scores[index]!, rowCost: serializedRowCost(recordRow(row)) }))
    .sort(compareAdmission);
  // Admission accounts each row's serialized cost once instead of rebuilding
  // and re-encoding the document per candidate: the fixed part comes from one
  // initial encode, per-row lengths from their encoded rows, and the omitted-
  // counter digit width from the accepted count. Exact framing, escaping, and
  // counter-width and request-anchor digit accounting keep every admission decision byte-identical to
  // encoding the trial document.
  omissions();
  const omittedLength = (excerptsOmitted: number): number => codePointLength(omittedRow({ ...document.omitted, excerpts: excerptsOmitted }));
  const fixedCost = serializedCost - omittedLength(document.omitted.excerpts);
  let acceptedCost = 0;
  let acceptedCount = 0;
  let acceptedBefore = 0;
  const taken = excerpts.map(() => false);
  for (const { index, rowCost } of priority) {
    const cost = acceptedCost + rowCost;
    const count = acceptedCount + 1;
    const before = acceptedBefore + Number(index < requestPosition);
    // The fixed document has anchor zero; count only admitted predecessors so
    // no trial document carries an out-of-range anchor.
    const anchorDelta = latestRequest === null ? 0 : String(before).length - 1;
    const total = anchorDelta + fixedCost + omittedLength(saturatingAdd(base.excerpts, excerpts.length - count)) + cost + count;
    if (total <= operatingLimit) { acceptedCost = cost; acceptedCount = count; acceptedBefore = before; taken[index] = true; }
  }
  document.records = excerpts.filter((_, position) => taken[position]);
  if (latestRequest) latestRequest.afterRecords = acceptedBefore;
  omissions();
  while (summaryCost(document) > MAX_STRUCTURED_SUMMARY_CODE_POINTS) {
    if (!evictOldestOptional(document)) throw new CompactionInputError("mandatory summary exceeds serialized limit", "protected_overflow");
  }
  return document;
}
