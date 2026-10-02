import { sanitize, sliceU16, isRecord, checkAbort } from "./helpers.ts";
import { KIND_USER, KIND_ASSISTANT, KIND_TOOL_CALL, KIND_TOOL_RESULT, KIND_THINKING, KIND_COMPACTION, type NormalizedBlock, type SessionMeta } from "./types.ts";
import { isDistillHandoffType, LEGACY_CONTINUATION_MESSAGE_TYPE } from "../legacy.ts";
import { handoffTextFromEntryData } from "../handoff.ts";

function textJoin(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const obj = part as { type?: unknown; text?: unknown };
      return obj?.type === "text" && typeof obj.text === "string" ? obj.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function contentBlocks(content: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(content)) return content as Array<Record<string, unknown>>;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return [];
}

const noiseCustomTypes = new Set([
  "dc-hooks-session",
  "dc-hooks-rules",
  "skilldex-context",
  "knowledge-context",
  "knowledge-overview",
  // Runtime primers and read-cache hints are useful while the original session
  // is live, but they are not work product and will be reinjected on resume.
  "dc-rtk-context",
  "dc-hooks-read-cache",
  "repomap-brief",
  "dc-memory-context",
  "dc-scope-context",
  "session-primer",
  "dc-memory-reminder",
  "dc-hooks-repomap-advisory",
  "extensions-list",
  "pi-hooks-session",
  "pi-hooks-rules",
  "pi-hooks-repomap-advisory",
  "pi-hooks-stop-reminder",
  "pi-session-continuity",
  "vybe-continuity",
  "dc-analyze/scorecard",
  "dc-plan-steer",
  "pm-dispatch",
  "dc-plan-contract-snapshot",
  "dc-plan-execution-snapshot",
  "dc-tasks-health",
  "dc-tasks-snapshot",
  "crisp-context",
  "claudette-context",
  "dc-readonly-context",
  "dc-memory-auto-reflect",
  "goal-continuation",
  "goal-ui",
  "review-start",
  "feynman-explain",
  "tilldone-nudge",
  "proactive-result",
  "agents-md",
  // Exclude behavioral primers and notifications, including our own continuation.
  // Keep dc-audit-decision and dc-git-report because they carry work product.
  "dc-ocpd-context",
  "dc-pm-steer",
  "dc-crunch-continuation",
  "dc-distill-continuation",
  LEGACY_CONTINUATION_MESSAGE_TYPE,
  "subagent-notification",
  "dc-audit-run",
]);

function isSystemUserContent(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith("<skill ") ||
    trimmed.startsWith("<skill>") ||
    trimmed.startsWith("Context was compacted") ||
    trimmed.startsWith("## Active Tasks") ||
    trimmed.startsWith('<bard type="BARD">')
  );
}

const compactionMetricRE = /^_\d+.*tokens.*reduction_/;

const compactionNoisePrefixes = [
  "[User] Working directory:",
  "[User] # Project-specific rules",
  "[User] ## Memory",
  "[User] ## Active Tasks",
  "[User] [OCPD EXTENSION ACTIVE]",
  "[User] # Recent Pi Sessions",
  "[User] Memory reminder:",
];

const compactionNoiseContains = ["skill matches", "kb matches", "[rtk filter active]"];

function isCompactionNoiseLine(line: string): boolean {
  if (compactionMetricRE.test(line)) return false;
  if (!line.startsWith("[User] ")) return false;
  if (compactionNoisePrefixes.some((prefix) => line.startsWith(prefix))) return true;
  const content = line.slice("[User] ".length);
  return compactionNoiseContains.some((needle) => content.includes(needle));
}

function stripNoiseFromCompaction(text: string): string {
  return text
    .split("\n")
    .filter((line) => !isCompactionNoiseLine(line))
    .join("\n");
}

function normalizeUser(blocks: Array<Record<string, unknown>>): NormalizedBlock[] {
  const out: NormalizedBlock[] = [];
  const raw = textJoin(blocks);
  const text = sanitize(raw).trim();
  if (text) {
    if (isSystemUserContent(text)) return [];
    out.push({ kind: KIND_USER, text, origin: "human" });
  }
  for (const block of blocks) {
    if (block.type === "image") {
      out.push({ kind: KIND_USER, text: `[image: ${String(block.mimeType ?? "")}]`, origin: "human" });
    }
  }
  return out.length > 0 ? out : [{ kind: KIND_USER, text: "", origin: "human" }];
}

function normalizeAssistant(blocks: Array<Record<string, unknown>>): NormalizedBlock[] {
  const out: NormalizedBlock[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      out.push({ kind: KIND_ASSISTANT, text: sanitize(String(block.text ?? "")) });
    } else if (block.type === "thinking") {
      out.push({
        kind: KIND_THINKING,
        text: sanitize(String(block.thinking ?? "")),
        redacted: Boolean(block.redacted),
      });
    } else if (block.type === "toolCall") {
      out.push({
        kind: KIND_TOOL_CALL,
        name: String(block.name ?? ""),
        callId: typeof block.id === "string" ? block.id : undefined,
        args: isRecord(block.arguments) ? block.arguments : {},
      });
    }
  }
  return out;
}

// Agent-authored handoff: the agent wraps its forward plan in <handoff>…</handoff>
// in response to the dc-distill warn steer. We surface the LAST such block (the
// freshest intent) as the leading <current-intent> section. Returns undefined
// when the text contains no handoff marker — the summary then degrades to
// byte-identical output.

const handoffRE = /<handoff>([\s\S]*?)<\/handoff>/gi;

function extractHandoff(text: string): string | undefined {
  let last: string | undefined;
  for (const match of text.matchAll(handoffRE)) {
    const inner = match[1].trim();
    if (inner) last = inner;
  }
  return last;
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

interface NormalizedEntry {
  main: NormalizedBlock[];
  usefulRecordCount: number;
}

const emptyNormalizedEntry: NormalizedEntry = {
  main: [],
  usefulRecordCount: 0,
};

function normalizeSessionEntry(entry: Record<string, unknown>, meta: SessionMeta): NormalizedEntry {
  switch (entry.type) {
    case "session":
      meta.id = typeof entry.id === "string" ? entry.id : meta.id;
      meta.cwd = typeof entry.cwd === "string" ? entry.cwd : meta.cwd;
      meta.timestamp = typeof entry.timestamp === "string" ? entry.timestamp : meta.timestamp;
      return emptyNormalizedEntry;
    case "model_change":
      updateSessionModel(entry, meta);
      return emptyNormalizedEntry;
    case "custom_message":
      return normalizeCustomMessage(entry, meta);
    case "custom":
      return normalizeCustomEntry(entry, meta);
    case "message":
      return normalizeMessageEntry(entry, meta);
    case "compaction":
      return normalizeSummaryEntry(entry.summary, meta, stripNoiseFromCompaction);
    case "branch_summary":
      return normalizeSummaryEntry(entry.summary, meta, (text) => text);
    default:
      return emptyNormalizedEntry;
  }
}

function updateSessionModel(entry: Record<string, unknown>, meta: SessionMeta): void {
  const provider = typeof entry.provider === "string" ? entry.provider : "";
  const modelId = typeof entry.modelId === "string" ? entry.modelId : "";
  if (provider) meta.model = `${provider}/${modelId}`;
}

function normalizeCustomMessage(entry: Record<string, unknown>, meta: SessionMeta): NormalizedEntry {
  const customType = typeof entry.customType === "string" ? entry.customType : "";
  const content = contentBlocks(entry.content);
  const contentText = sanitize(textJoin(content)).trim();
  if (isDistillHandoffType(customType)) {
    const handoff = handoffTextFromEntryData((entry as { data?: unknown }).data) ?? handoffTextFromEntryData(contentText);
    return saveHandoff(meta, handoff);
  }
  if (customType === "bard-context") {
    // BARD is advisory scratch analysis. Decisions and implementation evidence
    // belong in the ordinary conversation/tool record; replaying the analysis
    // itself wastes context and can pull a resumed model back to an old task.
    return emptyNormalizedEntry;
  }
  if (customType === "goal-ui") {
    captureGoalState(contentText, meta);
    return { ...emptyNormalizedEntry, usefulRecordCount: contentText ? 1 : 0 };
  }
  if (noiseCustomTypes.has(customType)) return emptyNormalizedEntry;
  const hasImage = content.some((block) => block.type === "image");
  if (!contentText && !hasImage) return emptyNormalizedEntry;
  const main = normalizeUser(content).map((block) => ({
    ...block,
    origin: "custom" as const,
    customType,
  }));
  return { main, usefulRecordCount: 1 };
}

function captureGoalState(contentText: string, meta: SessionMeta): void {
  const trimmed = contentText.trim();
  if (/^Goal cleared\b/i.test(trimmed)) {
    meta.goalStatus = undefined;
    meta.goalObjective = undefined;
    return;
  }
  if (/^Goal waiting for user input\b/i.test(trimmed)) {
    meta.goalStatus = "waiting-for-user";
    return;
  }
  const status = contentText.match(/^Status:\s*(.+)$/mi)?.[1]?.trim();
  const objective = contentText.match(/^Objective:\s*(.+)$/mi)?.[1]?.trim();
  if (status) meta.goalStatus = sliceU16(status, 80);
  if (objective) meta.goalObjective = sliceU16(objective, 1_024);
}

function normalizeCustomEntry(entry: Record<string, unknown>, meta: SessionMeta): NormalizedEntry {
  if (!isDistillHandoffType(entry.customType)) return emptyNormalizedEntry;
  return saveHandoff(meta, handoffTextFromEntryData((entry as { data?: unknown }).data));
}

function saveHandoff(meta: SessionMeta, handoff: string | undefined): NormalizedEntry {
  if (!handoff) return emptyNormalizedEntry;
  meta.handoff = sanitize(handoff);
  meta.handoffSource = "saved";
  return { ...emptyNormalizedEntry, usefulRecordCount: 1 };
}

function normalizeMessageEntry(entry: Record<string, unknown>, meta: SessionMeta): NormalizedEntry {
  const message = isRecord(entry.message) ? entry.message : {};
  const blocks = contentBlocks(message.content);
  if (message.role === "user") {
    return { main: normalizeUser(blocks), usefulRecordCount: 1 };
  }
  if (message.role === "assistant") {
    captureAssistantHandoff(blocks, meta);
    return { main: normalizeAssistant(blocks), usefulRecordCount: 1 };
  }
  if (message.role === "toolResult") {
    return {
      main: [{
        kind: KIND_TOOL_RESULT,
        name: typeof message.toolName === "string" ? message.toolName : "",
        callId: typeof message.toolCallId === "string" ? message.toolCallId : undefined,
        text: sanitize(textJoin(blocks)),
        isError: Boolean(message.isError),
      }],
      usefulRecordCount: 1,
    };
  }
  return emptyNormalizedEntry;
}

function captureAssistantHandoff(blocks: Array<Record<string, unknown>>, meta: SessionMeta): void {
  const handoff = extractHandoff(sanitize(textJoin(blocks)));
  if (handoff && meta.handoffSource !== "saved") {
    meta.handoff = handoff;
    meta.handoffSource = "assistant";
  }
}

function normalizeSummaryEntry(
  summary: unknown,
  meta: SessionMeta,
  transform: (text: string) => string,
): NormalizedEntry {
  const text = transform(sanitize(typeof summary === "string" ? summary : "")).trim();
  if (!text) return emptyNormalizedEntry;
  meta.priorSummaries.push(text);
  return {
    main: [{ kind: KIND_COMPACTION, text }],
    usefulRecordCount: 1,
  };
}

export function normalizeSessionJsonl(content: string, signal?: AbortSignal): { blocks: NormalizedBlock[]; meta: SessionMeta; usefulRecordCount: number; invalidRecordCount: number } {
  const main: NormalizedBlock[] = [];
  const meta: SessionMeta = { priorSummaries: [] };
  let usefulRecordCount = 0;
  let invalidRecordCount = 0;

  let lineNumber = 0;
  for (const line of content.split(/\n/)) {
    if (lineNumber++ % 128 === 0) checkAbort(signal);
    if (!line.trim()) continue;
    const entry = parseLine(line);
    if (!isRecord(entry)) {
      invalidRecordCount++;
      continue;
    }

    const normalized = normalizeSessionEntry(entry, meta);
    usefulRecordCount += normalized.usefulRecordCount;
    main.push(...normalized.main);
  }

  return { blocks: main, meta, usefulRecordCount, invalidRecordCount };
}

const noiseTools = new Set(["TodoWrite", "TodoRead", "ToolSearch", "WebSearch", "AskUser", "ExitSpecMode", "GenerateDroid"]);

const noiseStrings = [
  "Continue from where you left off.",
  "No response requested.",
  "IMPORTANT: TodoWrite was not called yet.",
];

const noiseXMLWrappers = [
  /<system-reminder[^>]*>[\s\S]*?<\/system-reminder>/g,
  /<ide_opened_file[^>]*>[\s\S]*?<\/ide_opened_file>/g,
  /<command-message[^>]*>[\s\S]*?<\/command-message>/g,
  /<context-window-usage[^>]*>[\s\S]*?<\/context-window-usage>/g,
];

export function filterNoise(blocks: NormalizedBlock[]): NormalizedBlock[] {
  const out: NormalizedBlock[] = [];
  for (const block of blocks) {
    if (block.kind === KIND_THINKING) continue;
    if ((block.kind === KIND_TOOL_CALL || block.kind === KIND_TOOL_RESULT) && noiseTools.has(block.name ?? "")) {
      continue;
    }
    if (block.kind === KIND_USER) {
      const trimmed = (block.text ?? "").trim();
      if (noiseStrings.some((needle) => trimmed.includes(needle))) continue;
      let cleaned = block.text ?? "";
      for (const wrapper of noiseXMLWrappers) cleaned = cleaned.replace(wrapper, "");
      cleaned = cleaned.trim();
      if (!cleaned) continue;
      out.push({ ...block, kind: KIND_USER, text: cleaned });
      continue;
    }
    out.push(block);
  }
  return out;
}

const maxCompressedLen = 500;

const toolResultHeadLines = 5;

const errorHeadLines = 4;

const errorTailLines = 2;

const filePathRE = /(?:^|[\s:])(\/?(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+\.[A-Za-z0-9]+)/gm;

const exitCodeRE = /\b(?:exit code|Exit code|exit)\s*[:=]?\s*(\d+)\b/;

const errorLineRE = /^\s*(?:Error|error|ERROR|Fatal|fatal|FATAL|Exception|Traceback|FAIL|Warning:)/;

function compressResultText(text: string, isError: boolean): string {
  const trimmed = text.trimEnd();
  if (trimmed.length <= maxCompressedLen) return trimmed;
  const lines = trimmed.split("\n");
  const parts: string[] = [];
  const firstLine = (lines[0] ?? "").trim().slice(0, 200);
  if (firstLine) parts.push(firstLine);
  if (isError) {
    for (const line of lines) {
      if (!errorLineRE.test(line)) continue;
      const errorLine = line.trim().slice(0, 200);
      if (errorLine && errorLine !== firstLine) parts.push(errorLine);
      if (parts.length >= errorHeadLines) break;
    }
  }
  const paths = Array.from(new Set(Array.from(trimmed.matchAll(filePathRE)).map((m) => m[0].trim())))
    .filter((path) => !path.startsWith("/dev/") && !path.startsWith("/proc/"))
    .slice(0, 5);
  if (paths.length > 0) parts.push(`paths: ${paths.join(", ")}`);
  const exitCode = lines.slice(-3).map((line) => exitCodeRE.exec(line)?.[1]).find(Boolean);
  if (exitCode && exitCode !== "0") parts.push(`exit: ${exitCode}`);
  const lastLine = (lines.at(-1) ?? "").trim().slice(0, 200);
  if (lastLine && lastLine !== firstLine && !parts.includes(lastLine)) parts.push(lastLine);

  const keptLines =
    isError && parts.length > 6
      ? [...parts.slice(0, errorHeadLines), ...parts.slice(parts.length - errorTailLines)]
      : parts.slice(0, toolResultHeadLines);

  const compressed = keptLines.join("\n");
  if (trimmed.length - compressed.length < 100) return trimmed;
  return `${compressed}\n...(${lines.length - keptLines.length} lines omitted)`;
}

export function compressToolResults(blocks: NormalizedBlock[]): NormalizedBlock[] {
  return blocks.map((block) =>
    block.kind === KIND_TOOL_RESULT
      ? { ...block, text: compressResultText(block.text ?? "", Boolean(block.isError)) }
      : block,
  );
}
