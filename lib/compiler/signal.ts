/**
 * Content signal scoring for excerpt prioritization. Adapted from ctxgo's
 * compact rubric (itself descended from pi-dc-shrink's signal table): every
 * weight is a visible constant, the framework is ported rather than the
 * exact tuning, and scoring is pure and deterministic.
 */
export const SUBSTANTIVE_THRESHOLD = 3;

export const POINTS_DIFF = 5;
export const POINTS_CODE_FENCE = 4;
export const POINTS_TABLE = 4;
export const POINTS_ERRORS = 4;
export const POINTS_ARCH = 3;
export const POINTS_HEADING = 2;
export const POINTS_LONG_FORM = 2;
export const POINTS_PATH = 1;
export const PENALTY_FILLER = -2;
export const PENALTY_SHORT = -2;
export const PENALTY_ACK = -5;

const LONG_FORM_LINES = 5;
const LONG_FORM_CHARS = 800;
const SHORT_STATUS_MAX = 120;
const ACK_MAX_CHARS = 200;

const codeFence = /^(```|~~~)/m;
const tableRow = /^\s*\|.*\|\s*$/m;
const diffHead = /^(diff --git |@@ |\+\+\+ |--- )/m;
const diffAdded = /^\+[^+\s]/m;
const diffRemoved = /^-[^-\s]/m;
const heading = /^(#{1,6}\s|\d+\.\s)/m;
const path = /[\w.-]+\/[\w.-]+/;
const filler = /^(let me|now i'll|now i will|i'll now|i will now|ok,? let me)\b/i;
const ack = /^(great|good|nice|perfect|done|tests pass|looks good|works now)[.!]?$/i;
const arch = /\b(invariant|trade-?off|chose [^.\n]+ instead of|instead of|decided (to|against)|constraint|boundary|fail[- ]closed)\b/i;

function containsDiff(text: string): boolean {
  // Headerless edits require both removed and added lines; a Markdown list or
  // horizontal rule is not a patch. Real unified headers also qualify.
  return diffHead.test(text) || (diffAdded.test(text) && diffRemoved.test(text));
}
function isLongForm(text: string): boolean {
  const lines = text.split("\n").filter(line => line.trim() !== "").length;
  return lines >= LONG_FORM_LINES || text.length >= LONG_FORM_CHARS;
}
function isShortStatus(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length <= SHORT_STATUS_MAX && !containsDiff(trimmed) && !codeFence.test(trimmed)
    && (trimmed.match(/^\s*\|.*\|\s*$/gm) ?? []).length < 2 && !path.test(trimmed);
}
function isAck(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length <= ACK_MAX_CHARS && ack.test(trimmed);
}

/** Error evidence shared by the rubric and excerpt scoring. */
export function errorSignal(text: string): boolean {
  return /\b(panic|traceback|fatal|failed|failure|error:|exit status [1-9]|cannot |could not )/i.test(text);
}

/** Kind-aware excerpt priority: directives and carried summaries are always
 *  substantive; tool rows score only on error evidence; assistant prose uses
 *  the full rubric. */
export function excerptScore(row: { kind: string; text: string }): number {
  if (row.kind === "user" || row.kind === "native-summary" || row.kind === "branch-summary") return SUBSTANTIVE_THRESHOLD;
  if (row.kind === "tool-result" || row.kind === "bash") return errorSignal(row.text) ? POINTS_ERRORS : 0;
  return signalScore(row.text);
}

/** Assistant-turn rubric: content signals up, chatter penalties down. */
export function signalScore(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return PENALTY_SHORT;
  let score = 0;
  if (containsDiff(text)) score += POINTS_DIFF;
  else if (codeFence.test(text)) score += POINTS_CODE_FENCE;
  if (text.split("\n").filter(line => tableRow.test(line)).length >= 2) score += POINTS_TABLE;
  if (errorSignal(text)) score += POINTS_ERRORS;
  if (arch.test(text)) score += POINTS_ARCH;
  if (heading.test(text)) score += POINTS_HEADING;
  if (isLongForm(text)) score += POINTS_LONG_FORM;
  if (path.test(text)) score += POINTS_PATH;
  if (filler.test(trimmed)) score += PENALTY_FILLER;
  // Short-status and ack penalties hit only pure chatter: content that earned
  // any positive signal stays eligible regardless of length (ctxgo over-penalized here).
  if (score <= 0 && isShortStatus(text) && !errorSignal(text) && !arch.test(text)) score += PENALTY_SHORT;
  if (score <= 0 && isAck(text)) score += PENALTY_ACK;
  return score;
}
