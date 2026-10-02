import { sliceU16, OrderedSet, addMarkerLine, addExactMarkerLine, boundedListMarker, boundedValues, isBareConfirmation } from "./helpers.ts";
import { type ConversationTurn, type ToolCallFingerprint, type ResumeIndex } from "./types.ts";
import { isVerificationCommand, isWorkingTreeCommand } from "./tool-tracker.ts";
import { extractSignals } from "./conversation-reducer.ts";
import { displayPath } from "./path-roots.ts";
import { basename } from "node:path";

function trimResumeLine(text: string): string {
  return sliceU16(text.trim().split(/\s+/).filter(Boolean).join(" "), 160);
}

function looksLikeContinuation(text: string): boolean {
  const lower = text.toLowerCase();
  return ["[next]", "[in progress]", "[blocked]", "next step", "next:", "next choice", "todo", "remaining", "continue", "blocked", "follow up", "follow-up"].some((marker) =>
    lower.includes(marker),
  );
}

const RECALL_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "add",
  "fix",
  "update",
  "change",
  "make",
  "run",
  "test",
  "file",
  "code",
  "this",
  "that",
  "from",
  "into",
  "use",
  "get",
  "set",
]);

function recallSeedSalience(seed: string): number {
  const s = seed.trim();
  if (!s) return Number.NEGATIVE_INFINITY;
  let score = 0;
  if (/[a-z][A-Z]/.test(s) || /_/.test(s) || /[A-Z]{2,}/.test(s)) score += 3;
  if (/\d/.test(s)) score += 2;
  if (/[./\\]/.test(s)) score += 2;
  if (s.length >= 8) score += 2;
  if (s.length <= 3) score -= 3;
  const firstWord = s.toLowerCase().split(/\s+/)[0];
  if (RECALL_STOPWORDS.has(firstWord)) score -= 4;
  return score;
}

function appendUniqueLimited(out: string[], seen: Set<string>, limit: number, values: string[]): string[] {
  for (const raw of values) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= limit) return out;
  }
  return out;
}

function isReferentialRequest(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length > 100) return false;
  return /^(?:please\s+)?(?:spec|fix|do|implement|review|test|run|ship|commit|explain|summarize|update|change|remove|add|try|finish)\s+(?:it|this|that|them|those)(?:[.!?]|\s+please)?$/i.test(normalized);
}

function resolvedUserIntent(turns: ConversationTurn[], index: number): string {
  const request = trimResumeLine(turns[index].text);
  if (!request || !isReferentialRequest(request)) return request;

  for (let i = index - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.role === "assistant" && !extractSignals(turn.text).pureAck) {
      const subject = turn.text
        .split("\n")
        .map((line) => line.replace(/^#{1,6}\s+/, "").trim())
        .find((line) => line.length >= 12);
      if (subject) return trimResumeLine(`${request} — refers to: ${subject}`);
    }
  }
  return request;
}

function selectActiveFiles(readFiles: string[], modifiedFiles: string[]): string[] {
  return boundedValues([...modifiedFiles, ...readFiles], 10, "active files");
}

export function buildResumeIndex(turns: ConversationTurn[], readFiles: string[], modifiedFiles: string[], recentToolCalls: ToolCallFingerprint[]): ResumeIndex {
  const activeFiles = selectActiveFiles(readFiles, modifiedFiles);
  const allRecentUserIntents: string[] = [];
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].role === "user" && turns[i].origin !== "custom") {
      if (isBareConfirmation(turns[i].text)) continue;
      const line = resolvedUserIntent(turns, i);
      if (line) allRecentUserIntents.push(line);
    }
  }
  const recentUserIntents = boundedValues(allRecentUserIntents, 3, "recent user intents");
  const allContinuationHints: string[] = [];
  const latestAssistant = turns.findLastIndex((turn) =>
    turn.role === "assistant" && !extractSignals(turn.text).pureAck);
  if (latestAssistant >= 0 && looksLikeContinuation(turns[latestAssistant].text)) {
    const lines = turns[latestAssistant].text.split("\n").map((line) => line.trim()).filter(Boolean);
    const operational = lines.find((line) =>
      /^(?:What happens when|Implementation is running)/i.test(line) &&
      /\b(?:await|review|verify|rerun|inspect|implement|fix|finish|report|when it(?:'s| is) done|then)\b/i.test(line))
      ?? lines.findLast((line) =>
      !/^Next choice:/i.test(line) &&
      !/^Nothing is committed/i.test(line) &&
      /\b(?:await|review|verify|rerun|inspect|implement|fix|finish|report|when it(?:'s| is) done|then)\b/i.test(line));
    const continuationLine = operational
      ?? lines.findLast((line) => looksLikeContinuation(line) && !/^Next choice:/i.test(line))
      ?? lines.findLast((line) => looksLikeContinuation(line))
      ?? turns[latestAssistant].text;
    const line = trimResumeLine(continuationLine);
    if (line) allContinuationHints.push(line);
  }
  const continuationHints = boundedValues(allContinuationHints, 5, "continuation hints");
  const recallCandidates = [
    ...activeFiles.filter((file) => !file.startsWith("... (")).map((file) => basename(file)),
    ...recentToolCalls.map((call) => call.key).filter(Boolean),
    ...recentUserIntents.filter((intent) => !intent.startsWith("... (")),
  ];
  const rankedRecall = recallCandidates
    .map((seed, i) => ({ seed, i, score: recallSeedSalience(seed) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((entry) => entry.seed);
  const recallQueries = boundedValues(rankedRecall, 5, "recall queries", "highest");
  return { activeFiles, recentUserIntents, continuationHints, recallQueries };
}

function recallQueryFromAnchor(anchor: string): string {
  const trimmed = anchor.trim().replace(/\/+$/g, "");
  if (!trimmed || trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return basename(trimmed);
}

function verificationCommand(line: string): string {
  let out = line.trim();
  const colon = out.indexOf(": ");
  if (colon >= 0) out = out.slice(colon + 2).trim();
  const dash = out.indexOf(" — ");
  if (dash >= 0) out = out.slice(0, dash).trim();
  return out;
}

function quoteRecallQuery(query: string): string {
  return `"${query.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function buildResumeTasks(input: {
  recentToolCalls: ToolCallFingerprint[];
  verification: string[];
  workingTree: string[];
  sourceAnchors: string[];
  activeTasks: string[];
  resumeIndex: ResumeIndex;
  pathRoot?: string;
  recallEnabled?: boolean;
}): string[] {
  const out = new OrderedSet();
  const continuation = input.resumeIndex.continuationHints.at(-1);
  if (continuation && /Next choice:\s*None\b.*no response needed/i.test(continuation)) return [];
  const activeFiles = input.resumeIndex.activeFiles.filter((file) => !file.startsWith("... (")).slice(0, 4);
  const activeTask = input.activeTasks.findLast((line) => !line.startsWith("... ("));
  if (activeTask) addMarkerLine(out, `Await/check existing delegated task; do not launch a duplicate: ${activeTask}`);
  if (activeFiles.length > 0) {
    addExactMarkerLine(out, boundedListMarker("Reread active files: ", activeFiles.map((file) => displayPath(file, input.pathRoot))));
  }
  if (continuation) addMarkerLine(out, `Continue: ${continuation}`);
  const verificationLines = input.verification.filter((line) =>
    !line.startsWith("... (") && !line.includes("[freshness: not established"),
  );
  const gate = verificationLines.findLast((line) => /^(?:FAIL|INCOMPLETE|BLOCKED)\b/.test(line))
    ?? verificationLines.at(-1);
  const verify = gate ? verificationCommand(gate) : "";
  if (verify) addExactMarkerLine(out, `Verify: ${verify}`, 1_200);
  const activeBases = new Set(activeFiles.map(recallQueryFromAnchor));
  const querySources = [
    ...input.sourceAnchors.map(recallQueryFromAnchor),
    ...input.recentToolCalls.map((call) => call.key),
    ...(activeFiles.length === 0 && input.sourceAnchors.length === 0 ? [] : input.resumeIndex.recallQueries),
  ];
  const queries = querySources.filter((query) =>
    query &&
    !query.startsWith("... (") &&
    !activeBases.has(query) &&
    !isVerificationCommand(query) &&
    !isWorkingTreeCommand(query));
  if (input.recallEnabled !== false && queries[0]) addMarkerLine(out, `Recall: recall_compaction ${quoteRecallQuery(queries[0])}`);
  if (input.workingTree.length > 0) addMarkerLine(out, "Check working tree: git status --short");
  return out.slice().slice(0, 4);
}
