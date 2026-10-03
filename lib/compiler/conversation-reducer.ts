import { compareCodeUnits } from "../wire-format.ts";
import { RECENT_REQUEST_GROUPS_TO_KEEP, sliceU16, isBareConfirmation } from "./helpers.ts";
import { type ConversationTurn, type ToolAdjacent } from "./types.ts";
import { codePointLength } from "../unicode.ts";
import { LexicalBudget } from "./lexical-budget.ts";

export function extractSignals(text: string): {
  hasTable: boolean;
  hasDiff: boolean;
  hasHeading: boolean;
  longForm: boolean;
  hasCodeFence: boolean;
  hasFilePath: boolean;
  hasArchTerm: boolean;
  hasErrDiag: boolean;
  startsWithFiller: boolean;
  pureAck: boolean;
  shortStatus: boolean;
} {
  const lines = text.split("\n");
  const trimmed = text.trim();
  return {
    hasCodeFence: text.includes("```"),
    hasTable: lines.filter((line) => line.trim().startsWith("|")).length >= 2,
    hasDiff: lines.filter((line) => /^[-+]{1,2}[^-+]|^@@ /.test(line)).length >= 2,
    hasHeading: /(^#{1,6}\s|^\d+\.\s)/m.test(text),
    hasFilePath: /[\w./-]+\.(go|ts|js|py|rs|md|sql|json|yaml|yml|toml|mod|sum|txt)\b/.test(text),
    hasArchTerm: /(schema|invariant|contract|interface|architecture|tradeoff|because|chose|instead of|root cause|constraint|assumption|decision|deprecated)/i.test(text),
    hasErrDiag: /(fails because|the issue is|panic:|error:|stack|traceback|segfault|root cause)/i.test(text),
    longForm: lines.filter((line) => line.trim()).length >= 5 || text.length >= 800,
    startsWithFiller: /^(let me|stop and breathe|now (let me|i'?ll|i will|update|check|run|fix|try)|i'?ll (just |now )?(check|run|try|update|fix|look)|let'?s (check|see|run|try)|next,? |good[.,!\s]|great[.,!\s]|perfect[.,!\s]|alright[.,!\s])/i.test(trimmed),
    pureAck: (/^\s*(good|great|perfect|excellent|nice|done|fixed)[.!,]?\s*(now|next|.{0,40})?\s*$/i.test(trimmed) ||
      /^\s*(all tests pass|tests pass|build (passes|succeeds|works|is green)|works now|passing now|that works)[.!,]?\s*$/i.test(trimmed)) &&
      trimmed.length < 200,
    shortStatus: trimmed.length < 120 &&
      !text.includes("```") &&
      !/[\w./-]+\.(go|ts|js|py|rs|md|sql|json|yaml|yml|toml|mod|sum|txt)\b/.test(text) &&
      lines.filter((line) => /^[-+]{1,2}[^-+]|^@@ /.test(line)).length < 2 &&
      lines.filter((line) => line.trim().startsWith("|")).length < 2,
  };
}

type Signals = ReturnType<typeof extractSignals>;

function signalScore(signals: Signals): number {
  let score = 0;
  if (signals.hasDiff) score += 5;
  if (signals.hasCodeFence) score += 4;
  if (signals.hasTable) score += 4;
  if (signals.hasErrDiag) score += 4;
  if (signals.hasArchTerm) score += 3;
  if (signals.hasHeading) score += 2;
  if (signals.hasFilePath) score += 1;
  if (signals.longForm) score += 2;
  if (signals.startsWithFiller) score -= 2;
  if (signals.shortStatus) score -= 2;
  if (signals.pureAck) score -= 5;
  return score;
}

function isSubstantive(signals: Signals): boolean {
  return signalScore(signals) >= 3;
}

function isCompletionReport(text: string): boolean {
  const prose = terminalText(text);
  return prose.split(/(?<=[.!?])\s+|\n/).some((statement) => {
    if (/\b(?:not|never|neither|no|cannot|can't|hasn't|haven't|isn't|aren't|wasn't|weren't|didn't)\b/i.test(statement)) return false;
    return /^\s*<!--\s*EXECUTION:\s*COMPLETE\s*-->\s*$/i.test(statement) ||
      /(?:Phase\s+\d+\s+is\s+implemented|\b(?:all\s+tests\s+passed|is\s+implemented|tasks?\s+completed|requested work is complete)\b)/i.test(statement) ||
      /^(?:done|fixed|implemented|completed|shipped)\b(?:$|[\s\p{P}])/iu.test(statement.trim());
  });
}

function hasResumeConstraint(text: string): boolean {
  return /\b(?:blocked|unresolved|incomplete|unfinished|still failing|approval|permission|authority|do not|don't|must not|only|correction|actually|instead|not verified|still needed)\b/i.test(terminalText(text));
}

function sameProvenance(left: ConversationTurn, right: ConversationTurn): boolean {
  return left.requestGroup === right.requestGroup && left.origin === right.origin && left.customType === right.customType;
}

/** One selection shared by procedural reduction and budget eviction. */
export function selectAssistantFrontier(turns: ConversationTurn[]): {
  latestUser: number; latestReply: number; completion: number; proposal: number; pinned: number[];
} {
  const latestUser = turns.findLastIndex((turn) => turn.role === "user" && turn.origin !== "custom");
  const latestReply = turns.findLastIndex((turn) => turn.role === "assistant");
  let completion = -1;
  for (let i = turns.length - 1; i > latestUser; i--) {
    if (turns[i].role === "assistant" && isCompletionReport(terminalText(turns[i].text))) {
      completion = i;
      break;
    }
  }
  let proposal = -1;
  if (latestUser >= 0 && isReferentialImplementation(turns[latestUser].text)) {
    for (let i = latestUser - 1; i >= 0; i--) {
      if (turns[i].role === "assistant" && !extractSignals(turns[i].text).pureAck) { proposal = i; break; }
    }
  }
  return { latestUser, latestReply, completion, proposal,
    pinned: [latestUser, latestReply, completion, proposal].filter((i) => i >= 0) };
}

export function isReferentialImplementation(text: string): boolean {
  return isBareConfirmation(text) || /^(?:please\s+)?(?:implement|fix|do|run|ship|finish)(?:\s+(?:it|this|that))?[.!]?$/i.test(text.trim());
}

function trimCompletion(text: string): string {
  if (codePointLength(text) <= 2_048) return text;
  // Completion markers carry no evidence once the report is selected.
  let out = text.replace(/\n*<!--\s*EXECUTION:\s*COMPLETE\s*-->\s*$/i, "");
  if (codePointLength(out) <= 2_048) return out;
  const sections = out.split(/(?=^#{1,6}\s)/m);
  // Drop complete optional sections, retaining outcomes, caveats and safety.
  for (let i = sections.length - 1; i > 0 && codePointLength(sections.join("")) > 2_048; i--) {
    if (/^#{1,6}\s+(?:changed|files|affected files|implementation details)\b/i.test(sections[i]) &&
        !/\b(?:pre-existing|unapproved|not verified|deferred|caveat|limitation)\b/i.test(sections[i])) sections.splice(i, 1);
  }
  out = sections.join("");
  // Whole paragraph omission preserves complete fences, lists and headings.
  if (codePointLength(out) > 2_048 && !out.includes("```")) {
    const paragraphs = out.split(/\n\s*\n/);
    for (let i = paragraphs.length - 2; i > 0 && codePointLength(paragraphs.join("\n\n")) > 2_048; i--) {
      if (!/\b(?:pre-existing|unapproved|not verified|deferred|caveat|limitation|safety|current state)\b/i.test(paragraphs[i])) paragraphs.splice(i, 1);
    }
    out = paragraphs.join("\n\n");
  }
  return out;
}

function isRecencyExemptTurn(text: string, signals = extractSignals(text)): boolean {
  return signals.hasDiff || signals.hasErrDiag || signals.hasFilePath ||
    isCompletionReport(text) ||
    /(?:<resume-state>|<verification>|sha256=[a-f0-9]{64}|Full output saved;|artifactPath|`[^`]+`)/i.test(text);
}

/** Latest human intent; bare implementation inherits its pinned proposal. */
export function resolvedFrontierIntent(turns: ConversationTurn[], frontierQuery?: string): string {
  if (frontierQuery?.trim()) return frontierQuery;
  const { latestUser, proposal } = selectAssistantFrontier(turns);
  const request = latestUser >= 0 ? turns[latestUser].text : "";
  return proposal >= 0 ? request + "\n" + turns[proposal].text : request;
}

/** Distinct anchored query tokens; sparse prose uses distinct intent tokens. */
export function technicalAnchorOverlap(text: string, query: string, lexical = new LexicalBudget()): number {
  const literals = [...query.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]);
  const identifiers = (query.match(/[A-Za-z_][A-Za-z0-9_./-]*/g) ?? []).filter((value) =>
    /[a-z][A-Z]|[A-Z]{2,}|_|[\/.]/.test(value));
  const anchored = literals.concat(identifiers);
  const intent = new Set(lexical.tokenize(anchored.length ? anchored.join(" ") : query)
    .filter((token) => token.length > 2 && !/^(?:the|and|for|with|this|that|please|implement|fix|update|change|from|into|use)$/.test(token)));
  const observed = new Set(lexical.tokenize(text));
  return Math.min(8, [...intent].filter((token) => observed.has(token)).length);
}

export function conversationEvictionCandidates(
  turns: ConversationTurn[], frontierQuery?: string, lexical = new LexicalBudget(),
): Array<{ index: number; priority: number; score: number }> {
  const pinned = new Set(selectAssistantFrontier(turns).pinned);
  const query = resolvedFrontierIntent(turns, frontierQuery);
  const recentFloor = Math.max(0, turns.length - 8);
  return turns.map((turn, index) => {
    const evidence = isCompletionReport(terminalText(turn.text)) || extractSignals(turn.text).hasErrDiag ||
      /\b(?:pre-existing|unapproved|not verified|deferred|caveat|limitation)\b/i.test(turn.text);
    return { index,
      // Structural retention bands dominate topical overlap; syntax alone does not.
      priority: (index >= recentFloor ? 1_000 : 0) + (turn.protectedRequest ? 200 : 0) + (evidence ? 100 : 0),
      score: technicalAnchorOverlap(turn.text, query, lexical),
    };
  }).filter(({ index }) => !pinned.has(index))
    .sort((a, b) => a.priority - b.priority || a.score - b.score || a.index - b.index);
}

export function trimTurn(text: string, ageFromNewest = 0): string {
  return trimTurnWithLimit(text, turnPreviewLimit(text, ageFromNewest));
}

/** Derive preview policy from the original source, before display projection. */
export function turnPreviewLimit(text: string, ageFromNewest = 0): number | null {
  if (isCompletionReport(terminalText(text))) return null;
  const signals = extractSignals(text);
  const baseLimit = turnTrimLimit(signals);
  const factor = ageFromNewest < 5 ? 1 : ageFromNewest < 20 ? 0.5 : 0.25;
  return isRecencyExemptTurn(text, signals)
    ? baseLimit
    : Math.max(160, Math.floor(baseLimit * factor));
}

/** null retains the existing completion-report treatment. */
export function trimTurnWithLimit(text: string, limit: number | null): string {
  if (limit === null) return trimCompletion(text);
  if (text.length <= limit) return text;
  const clipped = sliceU16(text, limit);
  const cutAt = Math.max(clipped.lastIndexOf(" "), clipped.lastIndexOf("\n"));
  return `${cutAt > limit / 2 ? clipped.slice(0, cutAt) : clipped}…`;
}

function turnTrimLimit(signals: Signals): number {
  if (signals.hasTable || signals.hasDiff) return 2000;
  if (signals.hasHeading || signals.longForm) return 1000;
  return 500;
}

interface ScoredTurn {
  turn: ConversationTurn;
  signals: Signals;
  tools: string[];
  files: string[];
  hadError: boolean;
  drop?: boolean;
  keep?: boolean;
}

function firstNonEmptyLine(text: string): string {
  return text.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

function topK(counts: Map<string, number>, limit: number): string {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || compareCodeUnits(a[0], b[0]))
    .slice(0, limit)
    .map(([key, count]) => count > 1 ? `${key} (×${count})` : key)
    .join(", ");
}

function extractToolFromTurn(turn: ConversationTurn): string {
  const lower = turn.text.toLowerCase();
  for (const tool of ["jinn_edit_file", "jinn_write_file", "jinn_read_file", "bash", "edit", "write", "read"]) {
    if (lower.includes(tool)) return tool;
  }
  return "";
}

function synthesizeRun(run: ScoredTurn[], precededByUser: ConversationTurn | undefined): ConversationTurn {
  const fileCounts = new Map<string, number>();
  const toolCounts = new Map<string, number>();
  for (const item of run) {
    for (const file of item.files) fileCounts.set(file, (fileCounts.get(file) ?? 0) + 1);
    for (const tool of item.tools) toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1);
    if (item.files.length === 0) {
      const file = /[\w./-]+\.(go|ts|js|py|rs|md|sql|json|yaml|yml|toml|mod|sum|txt)\b/.exec(item.turn.text)?.[0];
      if (file) fileCounts.set(file, (fileCounts.get(file) ?? 0) + 1);
    }
    if (item.tools.length === 0) {
      const tool = extractToolFromTurn(item.turn);
      if (tool) toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1);
    }
  }
  const tools = topK(toolCounts, 3);
  const files = topK(fileCounts, 3);
  if (precededByUser) {
    const first = sliceU16(firstNonEmptyLine(run[0].turn.text), 120);
    const last = sliceU16(firstNonEmptyLine(run.at(-1)?.turn.text ?? ""), 300);
    const context = tools || files ? ` — tools: ${tools}; files: ${files}` : "";
    return {
      ...run[0].turn,
      role: "assistant",
      text: `[${run.length} turns after correction${context} — first: ${JSON.stringify(first)}; last: ${JSON.stringify(last)}]`,
      displayText: undefined,
    };
  }
  const tail = sliceU16(firstNonEmptyLine(run.at(-1)?.turn.text ?? ""), 160);
  return {
    ...run[0].turn,
    role: "assistant",
    text: `[${run.length} procedural turns — tools: ${tools}; files: ${files}] last: ${JSON.stringify(tail)}`,
    displayText: undefined,
  };
}

const EDIT_LOOP_MIN_ATTEMPTS = 3;

const EDIT_LOOP_MIN_FAILURES = 2;

// Collapse a run of >=3 assistant turns hitting the same (tool, target) with >=2
// failures into a single [loop: ...] marker. Catches edit wars that score
// substantive (they carry diffs) and so survive every other dedup pass.

function collapseEditLoops(scored: ScoredTurn[]): void {
  let start = -1;
  let end = -1;
  let tool = "";
  let target = "";
  let attempts = 0;
  let failures = 0;
  let lastErr = "";
  const flush = () => {
    if (start >= 0 && attempts >= EDIT_LOOP_MIN_ATTEMPTS && failures >= EDIT_LOOP_MIN_FAILURES) {
      let promote = -1;
      for (let i = end; i >= start; i--) {
        if (!scored[i].drop && scored[i].turn.role === "assistant" && !scored[i].hadError) {
          promote = i;
          break;
        }
      }
      for (let i = start; i <= end; i++) {
        if (scored[i].turn.role === "assistant" && !scored[i].drop) scored[i].drop = true;
      }
      const last = lastErr.length > 120 ? sliceU16(lastErr, 120) + "…" : lastErr;
      scored[start] = {
        ...scored[start],
        turn: {
          ...scored[start].turn,
          role: "assistant",
          text: `[loop: ${tool} ${target} × ${attempts} attempts, ${failures} errors observed; outcome unverified — last: ${JSON.stringify(last)}]`,
          displayText: undefined,
        },
        drop: false,
        keep: true,
      };
      if (promote >= 0 && promote !== start) scored[promote].drop = false;
    }
    start = -1;
    end = -1;
    tool = "";
    target = "";
    attempts = 0;
    failures = 0;
    lastErr = "";
  };
  for (let i = 0; i < scored.length; i++) {
    const st = scored[i];
    if (st.drop || st.keep || st.turn.role !== "assistant") {
      flush();
      continue;
    }
    const t = st.tools[0] ?? "";
    const tgt = st.files[0] ?? "";
    if (!t) {
      flush();
      continue;
    }
    const same = start >= 0 && tool === t && target === tgt && sameProvenance(scored[start].turn, st.turn);
    if (!same) {
      flush();
      start = i;
      tool = t;
      target = tgt;
    }
    end = i;
    attempts++;
    if (st.hadError) {
      failures++;
      lastErr = firstNonEmptyLine(st.turn.text);
    }
  }
  flush();
}

const REP_WINDOW = 10;

const REP_THRESHOLD = 6;

// Collapse scattered procedural noise the contiguous-run pass misses: any
// REP_WINDOW-turn span with >= REP_THRESHOLD non-substantive assistant turns
// collapses those turns into one repetition marker, even
// when they never form a run of 3 (sawtooth: subst, noise, noise, subst, ...).

function collapseDenseRepetition(scored: ScoredTurn[]): void {
  const qualifies = (i: number): boolean => {
    const st = scored[i];
    return st.turn.role === "assistant" && !st.drop && !st.keep && !isSubstantive(st.signals);
  };
  const marked = new Set<number>();
  for (let i = 0; i + REP_WINDOW <= scored.length; i++) {
    if (scored.slice(i, i + REP_WINDOW).some((st) => st.keep || st.turn.role !== "assistant" || !sameProvenance(scored[i].turn, st.turn))) continue;
    let count = 0;
    for (let j = i; j < i + REP_WINDOW; j++) {
      if (qualifies(j)) count++;
    }
    if (count >= REP_THRESHOLD) {
      for (let j = i; j < i + REP_WINDOW; j++) {
        if (qualifies(j)) marked.add(j);
      }
    }
  }
  if (marked.size === 0) return;
  const sorted = [...marked].sort((a, b) => a - b);
  let regionFirst = -1;
  let regionCount = 0;
  let prevIdx = -1;
  const close = () => {
    if (regionFirst >= 0 && regionCount > 0) {
      scored[regionFirst] = {
        ...scored[regionFirst],
        turn: { ...scored[regionFirst].turn, role: "assistant", text: `[${regionCount} repeated procedural turns]`, displayText: undefined },
        drop: false,
        keep: true,
      };
    }
    regionFirst = -1;
    regionCount = 0;
  };
  for (const idx of sorted) {
    if (regionFirst < 0) {
      regionFirst = idx;
      regionCount = 1;
      prevIdx = idx;
      continue;
    }
    if (idx - prevIdx > REP_WINDOW || scored.slice(prevIdx + 1, idx + 1).some((st) => st.keep || st.turn.role !== "assistant" || !sameProvenance(scored[regionFirst].turn, st.turn))) {
      close();
      regionFirst = idx;
      regionCount = 1;
      prevIdx = idx;
      continue;
    }
    scored[idx].drop = true;
    regionCount++;
    prevIdx = idx;
  }
  close();
}

export function compactAssistantTurns(turns: ConversationTurn[], toolAdj: ToolAdjacent[]): ConversationTurn[] {
  const pinned = new Set(selectAssistantFrontier(turns).pinned);
  const scored = turns.map((turn, index): ScoredTurn => ({
    turn,
    signals: turn.role === "assistant" ? extractSignals(turn.text) : extractSignals(""),
    tools: toolAdj[index]?.tools ?? [],
    files: toolAdj[index]?.files ?? [],
    hadError: toolAdj[index]?.hadError ?? false,
    keep: pinned.has(index) || turn.protectedRequest === true || hasResumeConstraint(turn.text),
  })).filter((item) => item.keep || item.turn.role !== "assistant" || !item.signals.pureAck);

  collapseEditLoops(scored);
  collapseDenseRepetition(scored);

  const result: ConversationTurn[] = [];
  let run: ScoredTurn[] = [];
  const flush = () => {
    if (run.length === 0) return;
    if (run.length < 3) {
      result.push(...run.map((item) => item.turn));
    } else {
      const previous = result.at(-1);
      result.push(synthesizeRun(run, previous?.role === "user" ? previous : undefined));
    }
    run = [];
  };

  for (const item of scored) {
    if (item.drop) continue;
    if (item.turn.role !== "assistant" || isSubstantive(item.signals) || item.keep || isCompletionReport(item.turn.text)) {
      flush();
      result.push(item.turn);
      continue;
    }
    if (run.length && !sameProvenance(run[0].turn, item.turn)) flush();
    run.push(item);
  }
  flush();
  return result;
}

type RequestState = "complete" | "open" | "unknown";

/** Shared Markdown boundary scan; an unfinished fence stays excluded to EOF. */
function outsideCodeLines(lines: string[]): boolean[] {
  let fence: { character: string; length: number } | undefined;
  return lines.map((line) => {
    if (/^\s*>/.test(line)) return false;
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) fence = { character: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      return false;
    }
    return !fence && !/^(?: {4}|\t)/.test(line);
  });
}

function terminalText(text: string): string {
  const lines = text.split("\n");
  const outside = outsideCodeLines(lines);
  return lines.filter((_, index) => outside[index]).join("\n")
    .replace(/(`+)[^\n]*?\1/g, "")
    .replace(/"[^"\n]*"|“[^”\n]*”/g, "")
    .replace(/(^|[\s(])'[^'\n]+'(?=$|[\s).,;])/g, "$1")
    .trim();
}

function requestState(turns: ConversationTurn[], group: number): RequestState {
  const userText = turns.find((turn) => turn.requestGroup === group && turn.role === "user")?.text ?? "";
  const assistants = turns.filter((turn) => turn.requestGroup === group && turn.role === "assistant");
  const latest = assistants.at(-1);
  if (!latest) return "unknown";
  const text = terminalText(latest.text);
  const informationalRequest = /\b(?:explain|review|audit|analy[sz]e|summari[sz]e|assess|inspect|investigate|diagnose|report)\b/i.test(userText) &&
    !/\b(?:fix|implement|change|update|remove|add|write|build|finish|complete|resolve|repair)\b/i.test(userText);
  const explicitContinuation = /\b(?:still\s+(?:working|investigating)|i(?:'m| am)\s+(?:working|investigating)|investigation\s+is\s+still\s+open|work\s+remains?\s+open|next\s+[—:-]|todo:|remaining\s+(?:work|task|step)|needs?\s+(?:work|verification)|not\s+all\s+tests\s+passed)\b/i.test(text) ||
    /^(?:(?:currently\s+|still\s+)?(?:investigating|checking|working|looking|reviewing|analy[sz]ing)|(?:investigation|review|analysis|inspection|diagnosis)\s+(?:is\s+)?(?:running|ongoing|pending|in progress)|i(?:'m| am)\s+(?:currently\s+|still\s+)?(?:working|investigating|reviewing|checking|looking|analy[sz]ing)|i(?:'ll| will)\s+(?:investigate|check|review|look))\b/i.test(text);
  if (explicitContinuation || (!informationalRequest && /\b(?:blocked|incomplete|unfinished|unresolved|still\s+(?:open|failing|needed)|remains?\s+(?:broken|open|unfinished|unimplemented)|not\s+(?:implemented|verified|complete)|needs?\s+(?:fix)|remaining\s+issue)\b/i.test(text))) {
    return "open";
  }
  if (isCompletionReport(text) || /^\s*<!--\s*(?:DISPOSITION:\s*IMPLEMENT|EXECUTION:\s*COMPLETE)\s*-->\s*$/im.test(text)) {
    return "complete";
  }
  return informationalRequest && text.length >= 24 ? "complete" : "unknown";
}

export function hasTerminalNoWorkCompletion(turns: ConversationTurn[]): boolean {
  const latest = turns.findLast((turn) => turn.role === "assistant");
  if (!latest) return false;
  const text = terminalText(latest.text);
  return text.split("\n").some((line) => !/\b(?:not|never|isn't|is not|cannot|can't)\b/i.test(line) &&
    (/\bNext choice:\s*None\b[^\n]*(?:no response needed|task complete)/i.test(line) ||
    /\b(?:remaining work:\s*none|nothing to pick up)\b/i.test(line)));
}

/** Retire workflow controls, never the surrounding historical report. */
export function retireHistoricalControls(turns: ConversationTurn[], terminalComplete = hasTerminalNoWorkCompletion(turns)): void {
  if (!terminalComplete) return;
  const latest = turns.findLastIndex((turn) => turn.role === "assistant");
  const protocol = /^\s*<!--\s*(?:DISPOSITION:\s*(?:IMPLEMENT|NEEDS_USER_DECISION\s*[—:-].+)|EXECUTION:\s*(?:COMPLETE|BLOCKED\s*[—:-].+))\s*-->\s*$/i;
  for (let index = 0; index <= latest; index++) {
    const turn = turns[index];
    if (turn.role !== "assistant") continue;
    const lines = turn.text.split("\n");
    const outside = outsideCodeLines(lines);
    // A trailer is the final standalone invitation (apart from protocol markers).
    let trailer = lines.length - 1;
    while (trailer >= 0 && (!lines[trailer].trim() || (outside[trailer] && protocol.test(lines[trailer])))) trailer--;
    const requestedLiteral = (line: string) => turns.some(source => source.role === "user" && source.text.includes(line.trim()) && /\b(?:literal|quote|preserve|exact|print|output)\b/i.test(source.text));
    turn.text = lines.map((line, i) => i === trailer && outside[i] && !requestedLiteral(line) && /Next choice:\s*None\b[^\n]*(?:no response needed|task complete)/i.test(terminalText(line))
        ? line.replace(/\s+Next choice:\s*None\b[^\n]*(?:no response needed|task complete)[^\n]*$/i, "") : line)
      .filter((line, i) => !outside[i] || requestedLiteral(line) || (!protocol.test(line) && !(i === trailer && /^Next choice:\s*\S/i.test(line))))
      .join("\n").trimEnd();
  }
}

export function classifyRequestGroups(turns: ConversationTurn[]): Set<number> {
  let group = -1;
  for (const turn of turns) {
    if (turn.role === "user" && turn.origin !== "custom") group += 1;
    if (group >= 0) turn.requestGroup = group;
  }
  if (group < 0) return new Set();
  const firstProtected = Math.max(0, group - RECENT_REQUEST_GROUPS_TO_KEEP + 1);
  const protectedGroups = new Set<number>();
  for (let value = firstProtected; value <= group; value++) protectedGroups.add(value);
  for (const protectedGroup of protectedGroups) {
    const userIndex = turns.findIndex((turn) => turn.requestGroup === protectedGroup && turn.role === "user");
    const latestAssistant = turns.findLast((turn) =>
      turn.requestGroup === protectedGroup && turn.role === "assistant");
    if (userIndex >= 0) turns[userIndex].protectedRequest = true;
    if (latestAssistant) latestAssistant.protectedRequest = true;
    if (userIndex >= 0 && isReferentialImplementation(turns[userIndex].text)) {
      for (let index = userIndex - 1; index >= 0; index--) {
        const candidate = turns[index];
        if (candidate.role !== "assistant") continue;
        if (/\b(?:proposal|plan|implement|change|fix|contract|scope|next step|will)\b/i.test(candidate.text)) {
          candidate.protectedRequest = true;
        }
        break;
      }
    }
  }
  return protectedGroups;
}

export function removeCompletedHistoricalRequests(
  turns: ConversationTurn[],
  toolAdj: ToolAdjacent[],
  protectedGroups: Set<number>,
): void {
  const completed = new Set<number>();
  const groups = new Set(turns.flatMap((turn) => turn.requestGroup === undefined ? [] : [turn.requestGroup]));
  for (const group of groups) {
    if (!protectedGroups.has(group) && requestState(turns, group) === "complete") completed.add(group);
  }
  for (let index = turns.length - 1; index >= 0; index--) {
    const group = turns[index].requestGroup;
    if (group !== undefined && completed.has(group)) {
      turns.splice(index, 1);
      toolAdj.splice(index, 1);
    }
  }
  const firstUser = turns.findIndex((turn) => turn.role === "user" && turn.origin !== "custom");
  if (firstUser > 0 && !isReferentialImplementation(turns[firstUser].text)) {
    for (let index = firstUser - 1; index >= 0; index--) {
      const signals = extractSignals(turns[index].text);
      if (!signals.startsWithFiller && (signals.hasDiff || signals.hasCodeFence)) continue;
      turns.splice(index, 1);
      toolAdj.splice(index, 1);
    }
  }
}
