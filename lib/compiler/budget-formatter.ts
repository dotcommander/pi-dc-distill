import { codePointLength } from "../unicode.ts";
import { CompactionInputError } from "./errors.ts";
import {
  SUMMARY_FORMAT, SUMMARY_NOTICE, MAX_TEXT_CODE_POINTS,
  MAX_READ_FILES, MAX_MODIFIED_FILES, MAX_COMMANDS,
  MAX_STRUCTURED_SUMMARY_CODE_POINTS,
  TARGET_RESUME_SUMMARY_CODE_POINTS, OPTIONAL_FACTS_CODE_POINTS,
  shorten, saturatingAdd, emptyOmissions,
} from "./helpers.ts";
import { excerptScore } from "./signal.ts";
import type { CompactionSource, CompileOptions, DcDistillSummary, ObservationFacts, SummaryRecord, TextObservation } from "./types.ts";

import { encodeSummary, summaryCost, serializedRowCost, recordRow, fileRow, commandRow } from "./summary-codec.ts";
import { evictOldestOptional } from "./eviction.ts";
export { encodeSummary, decodeSummary } from "./summary-codec.ts";
export { evictOldestOptional } from "./eviction.ts";

function observation(value: string, previousShortened = false, prior = false): TextObservation {
  const reduced = shorten(value, MAX_TEXT_CODE_POINTS);
  return { text: reduced.text, shortened: previousShortened || reduced.shortened, origin: prior ? "prior" : "current" };
}

/** Each candidate retains its own typed lane, so heterogeneous facts need no array cast. */
function factCandidate<T>(facts: readonly T[], rows: T[], costs: readonly number[], offset: number,
  limit: number, counter: keyof DcDistillSummary["omitted"], carried: number) {
  const row = facts.at(-offset);
  const rowCost = costs.at(-offset);
  if (row === undefined || rowCost === undefined || rows.length >= limit) return undefined;
  return { rowCost, counter, omitted: saturatingAdd(carried, facts.length - rows.length - 1), admit: () => rows.unshift(row) };
}

/** Select complete rows using their escaped serialized cost, never a wire substring. */
export function buildSummary(source: CompactionSource, facts: ObservationFacts, options: CompileOptions = {}): DcDistillSummary {
  const predecessor = source.predecessor;
  const excerptRecords = source.records;
  const newestRequest = source.records.findLast(record => record.kind === "user" && record.nativeUserText === true);
  const latestRequest = newestRequest ? observation(newestRequest.text) : predecessor?.latestRequest ? observation(predecessor.latestRequest.text, predecessor.latestRequest.shortened, true) : null;
  const excerpts: SummaryRecord[] = predecessor?.records.map(row => ({ ...row, origin: "prior" })) ?? [];
  for (const record of excerptRecords) {
    if (record !== newestRequest) excerpts.push({ ...observation(record.text, record.textShortened === true), kind: record.kind });
  }
  const base = { ...(predecessor?.omitted ?? emptyOmissions()) };
  base.inputRecords = saturatingAdd(base.inputRecords, source.omittedInputRecords);
  const document: DcDistillSummary = {
    format: SUMMARY_FORMAT, notice: SUMMARY_NOTICE,
    focus: options.focus == null ? null : shorten(options.focus, MAX_TEXT_CODE_POINTS).text,
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
  // User excerpts claim budget newest-first; other rows retain signal priority.
  // Rendering remains chronological across both groups.
  const priority = excerpts.map((row, index) => ({ index, user: row.kind === "user", score: excerptScore(row) }))
    .sort((a, b) => Number(b.user) - Number(a.user) || (a.user ? b.index - a.index : b.score - a.score || b.index - a.index));
  // Admission accounts each row's serialized cost once instead of rebuilding
  // and re-encoding the document per candidate: the fixed part comes from one
  // initial encode, per-row lengths from their encoded rows, and the omitted-
  // counter digit width from the accepted count. Exact framing, escaping, and
  // counter-width accounting keeps every admission decision byte-identical to
  // encoding the trial document.
  omissions();
  const omittedLength = (excerptsOmitted: number): number =>
    codePointLength(`omitted: input=${document.omitted.inputRecords} excerpts=${excerptsOmitted} reads=${document.omitted.readFiles} modified=${document.omitted.modifiedFiles} commands=${document.omitted.commands}`);
  const fixedCost = serializedCost - omittedLength(document.omitted.excerpts);
  const rowCosts = excerpts.map(row => serializedRowCost(recordRow(row)));
  let acceptedCost = 0;
  let acceptedCount = 0;
  const taken = excerpts.map(() => false);
  for (const { index } of priority) {
    const cost = acceptedCost + rowCosts[index]!;
    const count = acceptedCount + 1;
    const total = fixedCost + omittedLength(saturatingAdd(base.excerpts, excerpts.length - count)) + cost + count;
    if (total <= operatingLimit) { acceptedCost = cost; acceptedCount = count; taken[index] = true; }
  }
  document.records = excerpts.filter((_, position) => taken[position]);
  omissions();
  while (summaryCost(document) > MAX_STRUCTURED_SUMMARY_CODE_POINTS) {
    if (!evictOldestOptional(document)) throw new CompactionInputError("mandatory summary exceeds serialized limit", "protected_overflow");
  }
  return document;
}
