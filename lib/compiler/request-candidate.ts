import { digest } from "./helpers.ts";
import { codePointLength } from "../unicode.ts";
import type { CheckpointSourceReference } from "./checkpoint.ts";
import type { NormalizedBlock } from "./types.ts";
import { extractSignals, isReferentialImplementation } from "./conversation-reducer.ts";

const OPEN = "<request-candidate-v1>";
const CLOSE = "</request-candidate-v1>";
export interface RequestCandidate {
  version: 1;
  attribution: "native user source; context only, not declared work or authorization";
  source: CheckpointSourceReference;
  originalDigest: string;
  request: string;
  proposal?: string;
}
const ATTRIBUTION: RequestCandidate["attribution"] = "native user source; context only, not declared work or authorization";
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Whole edge paragraphs when possible; offsets are Unicode code points in source. */
export function edgeExcerpt(text: string, limit: number): string {
  const total = codePointLength(text);
  if (total <= limit) return text;
  let left = Math.max(0, Math.floor((limit - 96) / 2)), right = total - left;
  let leftOffset = 0, rightOffset = text.length;
  let leading: { point: number; offset: number } | undefined;
  let trailing: { point: number; offset: number } | undefined;
  const paragraphs = text.matchAll(/\n\s*\n/g);
  let boundary = paragraphs.next();
  let point = 0, offset = 0;
  // One incremental UTF-16/code-point scan; retain only the two edge boundaries.
  for (const character of text) {
    point++; offset += character.length;
    if (point === left) leftOffset = offset;
    if (point === right) rightOffset = offset;
    if (!boundary.done && offset === boundary.value.index! + boundary.value[0].length) {
      if (point <= left) leading = { point, offset };
      if (point >= right && !trailing) trailing = { point, offset };
      boundary = paragraphs.next();
    }
  }
  if (leading) { left = leading.point; leftOffset = leading.offset; }
  if (trailing) { right = trailing.point; rightOffset = trailing.offset; }
  return text.slice(0, leftOffset) + `\n[omitted source code points ${left}..${right}]\n` + text.slice(rightOffset);
}
export function renderRequestCandidate(candidate: RequestCandidate): string {
  return `${OPEN}\n${escape(JSON.stringify(candidate))}\n${CLOSE}`;
}
function fit(candidate: RequestCandidate): RequestCandidate | undefined {
  // Framing, JSON escaping and XML escaping share the 4096 point envelope.
  if (codePointLength(renderRequestCandidate(candidate)) > 4096 && candidate.proposal) candidate = { ...candidate, proposal: undefined };
  return codePointLength(renderRequestCandidate(candidate)) <= 4096 ? candidate : undefined;
}
/** Only the caller's digest-authenticated extension predecessor is eligible. */
export function readRequestCandidate(summary: string | undefined): RequestCandidate | undefined {
  if (!summary || summary.split(OPEN).length !== 2 || summary.split(CLOSE).length !== 2) return undefined;
  const start = summary.indexOf(OPEN), end = summary.indexOf(CLOSE);
  if (end < start || codePointLength(summary.slice(start, end + CLOSE.length)) > 4096) return undefined;
  const raw = summary.slice(start + OPEN.length, end).trim();
  if (/[<>]/.test(raw)) return undefined;
  try {
    const value = JSON.parse(raw.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")) as RequestCandidate;
    if (!value || value.version !== 1 || value.attribution !== ATTRIBUTION ||
      Object.keys(value).some(key => !["version", "attribution", "source", "originalDigest", "request", "proposal"].includes(key)) ||
      typeof value.request !== "string" || codePointLength(value.request) > 2048 ||
      (value.proposal !== undefined && (typeof value.proposal !== "string" || codePointLength(value.proposal) > 512)) ||
      !value.source || value.source.sourceKind !== "user" || typeof value.source.entryId !== "string" || !value.source.entryId ||
      !/^[a-f0-9]{64}$/.test(value.originalDigest) || value.source.contentDigest !== value.originalDigest ||
      Object.keys(value.source).some(key => !["sessionId", "entryId", "messageIndex", "blockIndex", "start", "end", "contentDigest", "sourceKind"].includes(key)) ||
      Object.entries(value.source).some(([key, item]) => ["messageIndex", "blockIndex", "start", "end"].includes(key) && (!Number.isInteger(item) || Number(item) < 0)) ||
      (value.source.sessionId !== undefined && typeof value.source.sessionId !== "string") ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(JSON.stringify(value))) return undefined;
    if (escape(JSON.stringify(value)) !== raw) return undefined;
    return fit(value);
  } catch { return undefined; }
}
export function captureRequestCandidate(blocks: NormalizedBlock[], predecessor?: string): RequestCandidate | undefined {
  const index = blocks.findLastIndex(block => block.kind === "user" && block.origin !== "custom" && block.sourceKind === "user" && block.nativeUserText !== false && !!block.text?.trim());
  if (index < 0) return readRequestCandidate(predecessor);
  const block = blocks[index];
  // A new occurrence replaces old context even if it cannot be attributed.
  if (!block.sourceReference || block.sourceReference.sourceKind !== "user") return undefined;
  const text = block.requestText ?? block.text!;
  const proposal = isReferentialImplementation(text) ? blocks.slice(0, index).findLast(item => item.kind === "assistant" && !!item.text?.trim() && !extractSignals(item.text).pureAck)?.text : undefined;
  return fit({ version: 1, attribution: ATTRIBUTION, source: { ...block.sourceReference }, originalDigest: block.sourceReference.contentDigest || digest(text),
    request: edgeExcerpt(text, 2048), ...(proposal ? { proposal: edgeExcerpt(proposal, 512) } : {}) });
}
