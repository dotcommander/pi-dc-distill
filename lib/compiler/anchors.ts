import { sanitize, sliceU16, isRecord, argString, OrderedSet, addMarkerLine } from "./helpers.ts";
import { type NormalizedBlock, type PendingToolCall } from "./types.ts";

const pathAnchorRE = /(?:https?:\/\/[^\s<>"'()[\]]+|~?\/[^\s<>"'()[\]]+|(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._~@%+=-]+\.[A-Za-z0-9]{1,8})/g;

function hasPathExtension(anchor: string): boolean {
  const lastSlash = anchor.lastIndexOf("/");
  const lastDot = anchor.lastIndexOf(".");
  return lastDot > lastSlash + 1 && lastDot < anchor.length - 1;
}

function isSourceAnchor(anchor: string): boolean {
  if (anchor.length < 2 || anchor === "//" || anchor === "/dev/null") return false;
  if (anchor.startsWith("http://") || anchor.startsWith("https://") || anchor.startsWith("~/")) return true;
  if (anchor.startsWith("/")) return ["/Users/", "/opt/", "/tmp/", "/var/", "/home/", "/Volumes/", "/private/", "/etc/"].some((prefix) => anchor.startsWith(prefix));
  return anchor.includes("/") && hasPathExtension(anchor);
}

function collectSourceAnchorsFromText(set: OrderedSet, text: string): void {
  for (const match of text.matchAll(pathAnchorRE)) {
    let anchor = match[0].replace(/^[`'"<>{}.,;:[\]]+|[`'"<>{}.,;:[\]]+$/g, "");
    anchor = anchor.replace(/\)+$/g, "");
    if (isSourceAnchor(anchor)) addMarkerLine(set, anchor);
  }
}

export function collectSourceAnchorsFromUserText(set: OrderedSet, text: string): void {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (["Timestamp:", "Working directory:", "Branch:"].some((prefix) => trimmed.startsWith(prefix))) continue;
    collectSourceAnchorsFromText(set, trimmed);
  }
}

export function collectSourceAnchorsFromValue(set: OrderedSet, value: unknown): void {
  if (typeof value === "string") {
    collectSourceAnchorsFromText(set, value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectSourceAnchorsFromValue(set, item);
  } else if (isRecord(value)) {
    for (const key of Object.keys(value).sort()) collectSourceAnchorsFromValue(set, value[key]);
  }
}

const uuidAnchorRE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

const longHexAnchorRE = /\b[0-9a-f]{32,64}\b/gi;

const mixedShortHexAnchorRE = /\b(?=[0-9a-f]{8,16}\b)(?=[0-9a-f]*[a-f])[0-9a-f]+\b/gi;

const issueAnchorRE = /(?:\b[A-Z][A-Z0-9]+-\d+\b|(?<![\w/])#\d+\b)/g;

const digitBearingPairRE = /\b[A-Za-z][A-Za-z0-9_.-]{1,40}\s*[:=]\s*[^\s<>"'`|,;()[\]{}]*\d[^\s<>"'`|,;()[\]{}]*/g;

const absolutePathAnchorRE = /\/(?:Users|private|tmp|var|opt|home|Volumes|etc)\/[^\s<>"'()[\]{}|]+/g;

const literalAnchorMaxCount = 24;

const literalAnchorMaxChars = 2_000;

function normalizeLiteralAnchor(raw: string): string {
  return sanitize(raw)
    .trim()
    .replace(/^[`'"<>{}.,;:[\]]+|[`'"<>{}.,;:[\]]+$/g, "")
    .replace(/\)+$/g, "");
}

function addLiteralAnchor(set: OrderedSet, raw: string): void {
  const anchor = normalizeLiteralAnchor(raw);
  if (!anchor) return;
  set.add(sliceU16(anchor, 220));
}

interface LiteralAnchorCandidate {
  value: string;
  index: number;
  end: number;
  kind: "uuid" | "long-hex" | "short-hex" | "path" | "issue" | "pair";
}

function isBookkeepingPair(value: string, fullText: string, matchIndex: number): boolean {
  const norm = value.trim().toLowerCase();
  if (/^(?:in-progress|open|blocked|done|tools):\s*\d+$/i.test(norm)) {
    return true;
  }
  if (/^offset=\d+$/i.test(norm)) {
    const windowStart = Math.max(0, matchIndex - 40);
    const windowEnd = Math.min(fullText.length, matchIndex + value.length + 40);
    const windowText = fullText.slice(windowStart, windowEnd);
    if (/use\s+offset=|offset=\d+\s+to\s+continue/i.test(windowText)) {
      return true;
    }
  }
  return false;
}

function literalAnchorCandidates(text: string): LiteralAnchorCandidate[] {
  const candidates: LiteralAnchorCandidate[] = [];
  for (const [kind, re] of [
    ["uuid", uuidAnchorRE],
    ["long-hex", longHexAnchorRE],
    ["short-hex", mixedShortHexAnchorRE],
    ["path", absolutePathAnchorRE],
    ["issue", issueAnchorRE],
    ["pair", digitBearingPairRE],
  ] as const) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) {
      const index = match.index ?? 0;
      if (kind === "pair" && isBookkeepingPair(match[0], text, index)) {
        continue;
      }
      candidates.push({ value: match[0], index, end: index + match[0].length, kind });
    }
  }
  const priority = (kind: LiteralAnchorCandidate["kind"]): number =>
    ({ uuid: 0, "long-hex": 1, path: 2, issue: 3, pair: 4, "short-hex": 5 })[kind];
  const accepted: LiteralAnchorCandidate[] = [];
  for (const candidate of candidates.sort((a, b) => a.index - b.index || priority(a.kind) - priority(b.kind) || b.value.length - a.value.length)) {
    if (accepted.some((existing) => candidate.index < existing.end && candidate.end > existing.index)) continue;
    accepted.push(candidate);
  }
  return accepted;
}

function collectLiteralAnchorsFromText(set: OrderedSet, text: string): void {
  let shortHexCount = 0;
  for (const candidate of literalAnchorCandidates(text)) {
    if (candidate.kind === "short-hex") {
      shortHexCount++;
      if (shortHexCount > 6) continue;
    }
    addLiteralAnchor(set, candidate.value);
  }
}

export function collectLiteralAnchors(blocks: NormalizedBlock[]): string[] {
  const set = new OrderedSet();
  for (const block of blocks) {
    if (block.text) collectLiteralAnchorsFromText(set, block.text);
    if (block.args) collectLiteralAnchorsFromValue(set, block.args);
  }
  const out: string[] = [];
  let chars = 0;
  for (const anchor of set.slice()) {
    const nextChars = chars + anchor.length;
    if (out.length >= literalAnchorMaxCount || nextChars > literalAnchorMaxChars) break;
    out.push(anchor);
    chars = nextChars;
  }
  const omitted = set.slice().length - out.length;
  if (omitted > 0) out.push(`... (${omitted} literal anchors omitted)`);
  return out;
}

function collectLiteralAnchorsFromValue(set: OrderedSet, value: unknown): void {
  if (typeof value === "string") {
    collectLiteralAnchorsFromText(set, value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectLiteralAnchorsFromValue(set, item);
  } else if (isRecord(value)) {
    for (const key of Object.keys(value).sort()) collectLiteralAnchorsFromValue(set, value[key]);
  }
}

export function collectActiveTasks(call: PendingToolCall, result: string, isError: boolean, tasks: OrderedSet): void {
  const toolName = call.name;
  if (!toolName.toLowerCase().includes("task")) return;
  if (isError) return;
  const terminal = new Set(["done", "complete", "completed", "failed", "cancelled", "canceled"]);
  const removeTask = (id: string) => {
    for (const line of tasks.slice()) {
      if (line.startsWith(`${id} `) || line.includes(`Task ${id};`)) tasks.remove(line);
    }
  };
  const recordTask = (record: Record<string, unknown>) => {
    const id = String(record.id ?? record.taskId ?? record.task_id ?? "").trim();
    const status = String(record.status ?? record.state ?? "").toLowerCase().trim();
    if (!id) return;
    removeTask(id);
    if (!status || terminal.has(status)) return;
    const agent = String(record.agentId ?? record.agent_id ?? record.agent ?? "").trim();
    const repo = String(record.cwd ?? record.repo ?? record.repository ?? "").trim();
    const title = String(record.title ?? record.task ?? record.objective ?? record.description ?? "").trim();
    addMarkerLine(tasks, [
      `Task ${id};`,
      agent && `agent ${agent};`,
      `${status} at snapshot;`,
      repo && `${repo};`,
      title,
    ].filter(Boolean).join(" "));
  };
  try {
    const parsed = JSON.parse(result);
    const clearTerminalUpdates = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) clearTerminalUpdates(item);
      } else if (isRecord(value)) {
        const id = String(value.taskId ?? value.task_id ?? "").trim();
        const status = String(value.newStatus ?? value.status ?? value.state ?? "").toLowerCase().trim();
        if (id && terminal.has(status)) removeTask(id);
        for (const nested of Object.values(value)) clearTerminalUpdates(nested);
      }
    };
    clearTerminalUpdates(parsed);
    const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.tasks) ? parsed.tasks : isRecord(parsed) ? [parsed] : undefined;
    if (records) {
      for (const record of records) {
        if (!isRecord(record)) continue;
        recordTask(record);
      }
      return;
    }
  } catch {
    // Fall through to line parser.
  }
  for (const match of result.matchAll(/"taskId"\s*:\s*"([0-9a-f]{8})"[\s\S]{0,300}?"newStatus"\s*:\s*"(done|complete|completed|failed|cancelled|canceled)"/gi)) {
    removeTask(match[1]);
  }
  const started = result.match(/TaskAgent\s+([0-9a-f]{8})\s+started[\s\S]*?\n\s*([0-9a-f-]{12,})\s+(running|in-progress|open|blocked)\s+[^·\n]*·\s*([^·\n]+)/i);
  if (started) {
    const [, id, agent, status, title] = started;
    removeTask(id);
    const prompt = argString(call.args, "prompt") ?? "";
    const repo = prompt.match(/(?:patch in|working directory|repo(?:sitory)?)\s+(`?)(\/(?:Users|home|tmp)\/[^\s`),;]+)/i)?.[2] ?? "";
    addMarkerLine(tasks, [
      `Task ${id};`,
      `agent ${agent};`,
      `${status.toLowerCase()} at snapshot;`,
      repo && `${repo};`,
      title.trim(),
    ].filter(Boolean).join(" "));
    return;
  }
  for (const raw of result.split("\n")) {
    const line = raw.trim();
    const lower = line.toLowerCase();
    const status = /\b(running|in-progress|open|blocked|done|complete|completed|failed|cancelled|canceled)\b/.exec(lower)?.[1];
    const id = /\b[0-9a-f]{8}\b/.exec(line)?.[0];
    if (status && id) {
      removeTask(id);
      if (!terminal.has(status)) addMarkerLine(tasks, `Task ${id}; ${status} at snapshot; ${line}`);
    }
  }
}

export function collectTaskAgentNotification(block: NormalizedBlock, tasks: OrderedSet): boolean {
  if (block.origin !== "custom" || block.customType !== "taskagent-notification") return false;
  const text = block.text ?? "";
  const completedAgent = text.match(/\bTask agent\s+([0-9a-f-]{12,})\s+(?:completed|failed|cancelled|canceled)\b/i)?.[1];
  if (completedAgent) {
    for (const line of tasks.slice()) {
      if (line.includes(`agent ${completedAgent};`)) tasks.remove(line);
    }
  }
  return true;
}
