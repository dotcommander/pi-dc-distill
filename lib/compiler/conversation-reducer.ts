import { RECENT_REQUEST_GROUPS_TO_KEEP, sliceU16, isBareConfirmation } from "./helpers.ts";
import { type ConversationTurn, type ToolAdjacent } from "./types.ts";

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
  const trimmed = text.trim();
  return /(?:<!--\s*EXECUTION:\s*COMPLETE\s*-->|Phase\s+\d+\s+is\s+implemented|\b(?:all\s+tests\s+passed|is\s+implemented|tasks?\s+completed|requested work is complete)\b)/i.test(trimmed) ||
    /^(?:done|fixed|implemented|completed|shipped)\b[\s\p{P}]/iu.test(trimmed);
}

function isRecencyExemptTurn(text: string, signals = extractSignals(text)): boolean {
  return signals.hasDiff || signals.hasErrDiag || signals.hasFilePath ||
    isCompletionReport(text) ||
    /(?:<resume-state>|<verification>|sha256=[a-f0-9]{64}|Full output saved;|artifactPath|`[^`]+`)/i.test(text);
}

export function conversationEvictionCandidates(turns: ConversationTurn[]): Array<{ index: number; priority: number; score: number }> {
  const pinned = new Set<number>();
  const latestUser = turns.findLastIndex((turn) => turn.role === "user" && turn.origin !== "custom");
  const latestAssistant = turns.findLastIndex((turn) => turn.role === "assistant");
  const latestSubstantive = turns.findLastIndex(
    (turn) => turn.role === "assistant" && (isCompletionReport(turn.text) || isSubstantive(extractSignals(turn.text))),
  );
  for (const index of [latestUser, latestAssistant, latestSubstantive]) {
    if (index >= 0) pinned.add(index);
  }

  const recentFloor = Math.max(0, turns.length - 8);
  return turns
    .map((turn, index) => ({
      index,
      // Age dominates evidence shape: an old path/diff remains valuable, but it
      // cannot make the budget impossible or displace the live frontier.
      priority: (index >= recentFloor ? 1_000 : 0) + (isRecencyExemptTurn(turn.text) ? 100 : 0),
      score: signalScore(extractSignals(turn.text)),
    }))
    .filter(({ index }) => !pinned.has(index) && !turns[index].protectedRequest)
    .sort((a, b) => a.priority - b.priority || a.score - b.score || a.index - b.index);
}

export function trimTurn(text: string, ageFromNewest = 0): string {
  const signals = extractSignals(text);
  const baseLimit = turnTrimLimit(signals);
  const factor = ageFromNewest < 5 ? 1 : ageFromNewest < 20 ? 0.5 : 0.25;
  const limit = isRecencyExemptTurn(text, signals)
    ? baseLimit
    : Math.max(160, Math.floor(baseLimit * factor));
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit);
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
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
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
      role: "assistant",
      text: `[${run.length} turns after correction${context} — first: ${JSON.stringify(first)}; last: ${JSON.stringify(last)}]`,
    };
  }
  const tail = sliceU16(firstNonEmptyLine(run.at(-1)?.turn.text ?? ""), 160);
  return {
    role: "assistant",
    text: `[${run.length} procedural turns — tools: ${tools}; files: ${files}] last: ${JSON.stringify(tail)}`,
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
          role: "assistant",
          text: `[loop: ${tool} ${target} × ${attempts} attempts, ${failures} failed — last: ${JSON.stringify(last)}]`,
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
    if (st.drop || st.turn.role !== "assistant") {
      flush();
      continue;
    }
    const t = st.tools[0] ?? "";
    const tgt = st.files[0] ?? "";
    if (!t) {
      flush();
      continue;
    }
    const same = start >= 0 && tool === t && target === tgt;
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
        turn: { role: "assistant", text: `[${regionCount} repeated procedural turns]` },
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
    if (idx - prevIdx > REP_WINDOW) {
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
  const pinned = new Set([
    turns.findLastIndex((turn) => turn.role === "user" && turn.origin !== "custom"),
    turns.findLastIndex((turn) => turn.role === "assistant"),
    turns.findLastIndex(
      (turn) => turn.role === "assistant" && (isCompletionReport(turn.text) || isSubstantive(extractSignals(turn.text))),
    ),
  ]);
  const scored = turns.map((turn, index): ScoredTurn => ({
    turn,
    signals: turn.role === "assistant" ? extractSignals(turn.text) : extractSignals(""),
    tools: toolAdj[index]?.tools ?? [],
    files: toolAdj[index]?.files ?? [],
    hadError: toolAdj[index]?.hadError ?? false,
    keep: pinned.has(index) || turn.protectedRequest === true,
  })).filter((item) => item.turn.role !== "assistant" || !item.signals.pureAck);

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
    run.push(item);
  }
  flush();
  return result;
}

type RequestState = "complete" | "open" | "unknown";

function terminalText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
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
  const explicitContinuation = /\b(?:still\s+(?:working|investigating)|i(?:'m| am)\s+(?:working|investigating)|investigation\s+is\s+still\s+open|work\s+remains?\s+open|next\s+[—:-]|todo:|remaining\s+(?:work|task|step)|needs?\s+(?:work|verification))\b/i.test(text);
  if (explicitContinuation || (!informationalRequest && /\b(?:blocked|incomplete|unfinished|unresolved|still\s+(?:open|failing|needed)|remains?\s+(?:broken|open|unfinished|unimplemented)|not\s+(?:implemented|verified|complete)|needs?\s+(?:fix)|remaining\s+issue)\b/i.test(text))) {
    return "open";
  }
  if (isCompletionReport(text) || /<!--\s*(?:DISPOSITION:\s*IMPLEMENT|EXECUTION:\s*COMPLETE)\s*-->/i.test(text)) {
    return "complete";
  }
  return informationalRequest && text.length >= 24 ? "complete" : "unknown";
}

export function hasTerminalNoWorkCompletion(turns: ConversationTurn[]): boolean {
  const latest = turns.findLast((turn) => turn.role === "assistant");
  if (!latest) return false;
  const text = terminalText(latest.text);
  return /Next choice:\s*None\b[^\n]*(?:no response needed|task complete)/i.test(text) ||
    /\b(?:remaining work:\s*none|nothing to pick up)\b/i.test(text);
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
    if (userIndex >= 0 && isBareConfirmation(turns[userIndex].text)) {
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
  if (firstUser > 0 && !isBareConfirmation(turns[firstUser].text)) {
    for (let index = firstUser - 1; index >= 0; index--) {
      const signals = extractSignals(turns[index].text);
      if (!signals.startsWithFiller && (signals.hasDiff || signals.hasCodeFence)) continue;
      turns.splice(index, 1);
      toolAdj.splice(index, 1);
    }
  }
}
