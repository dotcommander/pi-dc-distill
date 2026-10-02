import { sliceU16, OrderedSet, addMarkerLine, addExactMarkerLine, boundedListMarker, boundedValues, isBareConfirmation } from "./helpers.ts";
import { type ConversationTurn, type ToolCallFingerprint, type ResumeIndex, type ResumePlan, type VerificationReceipt } from "./types.ts";
import { codePointLength } from "../unicode.ts";
import { isVerificationCommand, isWorkingTreeCommand } from "./tool-tracker.ts";
import { extractSignals, isReferentialImplementation, hasTerminalNoWorkCompletion, resolvedFrontierIntent } from "./conversation-reducer.ts";
import { displayPath } from "./path-roots.ts";
import { LexicalBudget } from "./lexical-budget.ts";

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

const SCRATCH_TOKENS = new Set([
  "temp",
  "tmp",
  "scratch",
  "untitled",
  "dummy",
]);

function recallSeedSalience(seed: string, intentTokens?: Set<string>, lexical = new LexicalBudget()): number {
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

  if (intentTokens && intentTokens.size > 0) {
    const tokens = new Set(lexical.tokenize(s));
    let matches = 0;
    let isScratch = false;
    for (const t of tokens) {
      if (RECALL_STOPWORDS.has(t)) continue;
      if (SCRATCH_TOKENS.has(t)) isScratch = true;
      if (intentTokens.has(t)) matches++;
    }
    if (matches > 0) score += Math.min(6, matches * 2);
    if (isScratch) score -= 2;
  }

  return score;
}

function isReferentialRequest(text: string): boolean {
  return isReferentialImplementation(text) || /^(?:please\s+)?(?:spec|review|test|explain|summarize|update|change|remove|add|try)\s+(?:it|this|that|them|those)[.!?]?$/i.test(text.trim());
}

/** Recovery lookup seeds are observations, never instructions to resume work. */
export function recoveryRecallQueries(turns: ConversationTurn[], anchors: string[] = [], lexical = new LexicalBudget()): string[] {
  const observed = new Set(anchors.map((value) => value.toLowerCase()));
  const literals = new Set(turns.flatMap((turn) => [...turn.text.matchAll(/`([^`\n]+)`/g)]
    .map((match) => match[1].toLowerCase())));
  const eligible = (value: string): boolean => {
    const tokens = lexical.tokenize(value);
    return !!value && codePointLength(value) <= 160 && !/\s/.test(value) &&
      !/^[a-f0-9-]{8,}$/i.test(value) && !/^https?:/i.test(value) &&
      !/(?:^|[\/])(?:tmp|temp|scratch|\.work)(?:[\/]|$)/i.test(value) &&
      !tokens.some((token) => SCRATCH_TOKENS.has(token) || /^(?:notes|output|build_output)(?:\.|$)/i.test(token)) &&
      !RECALL_STOPWORDS.has(value.toLowerCase()) &&
      (observed.has(value.toLowerCase()) ||
        /[a-z][A-Z]|[A-Z][a-z]+[A-Z]|[a-z]+_[a-z]+|[\w.-]+\.(?:ts|js|go|py|sql|md|json|toml|yaml|yml)/.test(value) ||
        (value.includes("/") && literals.has(value.toLowerCase())));
  };
  const raw = [...anchors];
  for (const turn of turns) {
    raw.push(...(turn.text.match(/`([^`\n]+)`/g) ?? []).map((v) => v.slice(1, -1)));
    raw.push(...(turn.text.match(/[A-Za-z_][A-Za-z0-9_./-]*/g) ?? []));
  }
  const seen = new Set<string>();
  const candidates = raw.map((seed) => seed.replace(/[.,;:!?]+$/g, "")).filter(eligible).filter((seed) => {
    const key = seed.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const query = resolvedFrontierIntent(turns);
  const intentTokens = new Set(lexical.tokenize(query));
  return candidates.map((seed, i) => ({ seed, i, score: recallSeedSalience(seed, intentTokens, lexical) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i).slice(0, 5).map((entry) => entry.seed);
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
  return boundedValues([...modifiedFiles, ...readFiles], 10, "active files", "highest");
}

export function buildResumeIndex(turns: ConversationTurn[], readFiles: string[], modifiedFiles: string[], recentToolCalls: ToolCallFingerprint[], lexical = new LexicalBudget()): ResumeIndex {
  const recallQueries = recoveryRecallQueries(turns, [...modifiedFiles, ...readFiles, ...recentToolCalls.map((call) => call.key)], lexical);
  if (hasTerminalNoWorkCompletion(turns)) return { activeFiles: [], recentUserIntents: [], continuationHints: [], recallQueries };
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
  const intentOccurrences = recentUserIntents.flatMap(text => {
    const candidates = turns.filter(turn => turn.role === "user" && turn.origin !== "custom" &&
      turn.sourceSequence !== undefined && !/[;\n]|\b(?:and|then|also)\b/i.test(turn.text) &&
      !isReferentialRequest(trimResumeLine(turn.text)) && trimResumeLine(turn.text) === text);
    // Identical clipped strings from multiple turns are not occurrence identity.
    return candidates.length === 1 ? [{ text, sourceSequence: candidates[0].sourceSequence! }] : [];
  });
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

  return { activeFiles, recentUserIntents, continuationHints, recallQueries, intentOccurrences };
}

/** Copy source obligations before any evidence display caps or eviction. */
export function buildResumePlan(input: {
  terminalComplete: boolean;
  activeTasks: string[];
  verificationReceipts?: VerificationReceipt[];
  mutationEpoch?: number;
  verification?: string[];
  workingTree: string[];
}): ResumePlan {
  const receipts = input.verificationReceipts ?? [];
  const eligible = receipts.filter((receipt) => receipt.status === "FAIL" || receipt.status === "INCOMPLETE" || !receipt.cwd ||
    (receipt.freshnessEstablished !== false && receipt.mutationEpoch >= (input.mutationEpoch ?? 0)));
  const selected = eligible.findLast((receipt) => receipt.status === "FAIL" || receipt.status === "INCOMPLETE") ?? eligible.at(-1);
  return Object.freeze({
    terminalComplete: input.terminalComplete,
    delegateObligation: input.activeTasks.findLast((line) => !line.startsWith("... (")),
    verification: selected ? Object.freeze({ ...selected }) : undefined,
    // Display strings cannot recover exact command identity safely.
    inspectVerification: !selected && !input.verificationReceipts && !!input.verification?.some((line) => !line.startsWith("... (")),
    inspectGit: input.workingTree.length > 0,
  });
}

function verificationTask(receipt: Readonly<VerificationReceipt>): string {
  const line = `Verify: ${receipt.command} [runner=${receipt.tool}; cwd=${receipt.cwd}]`;
  // Never emit a clipped, sanitized or scope-incomplete command as runnable work.
  if (!receipt.tool || !receipt.cwd || !receipt.command || codePointLength(receipt.command) > 1_024 ||
      codePointLength(receipt.cwd) > 200 || codePointLength(line) > 1_200 ||
      /[\u0000-\u001f\u007f]/.test(line) || receipt.command.trim() !== receipt.command) {
    return "Inspect verification command and runner/working-directory scope before rerunning; exact presentation unavailable.";
  }
  return line;
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
  terminalComplete?: boolean;
  resumePlan?: ResumePlan;
}): string[] {
  const plan = input.resumePlan ?? buildResumePlan({ ...input, terminalComplete: input.terminalComplete ?? false });
  if (plan.terminalComplete) return [];
  const out = new OrderedSet();
  const continuation = input.resumeIndex.continuationHints.at(-1);
  if (!input.resumePlan && continuation && /Next choice:\s*None\b.*no response needed/i.test(continuation)) return [];
  const activeFiles = input.resumeIndex.activeFiles.filter((file) => !file.startsWith("... (")).slice(0, 4);
  const activeTask = plan.delegateObligation;
  if (activeTask) addMarkerLine(out, `Await/check existing delegated task; do not launch a duplicate: ${activeTask}`);
  if (activeFiles.length > 0) {
    addExactMarkerLine(out, boundedListMarker("Reread active files: ", activeFiles.map((file) => displayPath(file, input.pathRoot))));
  }
  if (continuation) addMarkerLine(out, `Continue: ${continuation}`);
  if (plan.verification) addExactMarkerLine(out, verificationTask(plan.verification), 1_200);
  else if (plan.inspectVerification) addExactMarkerLine(out, "Inspect verification command and runner/working-directory scope before rerunning; exact presentation unavailable.");
  const queries = input.resumeIndex.recallQueries.filter((query) => !isVerificationCommand(query) && !isWorkingTreeCommand(query));
  if (input.recallEnabled !== false && queries[0]) addMarkerLine(out, `Recall: recall_compaction ${quoteRecallQuery(queries[0])}`);
  if (plan.inspectGit) addMarkerLine(out, "Check working tree: git status --short");
  return out.slice().slice(0, 4);
}
