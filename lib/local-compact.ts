import { open, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import {
  SHRINK_HANDOFF_ENTRY_TYPE,
  handoffTextFromEntryData,
  parseAnyStructuredShrinkHandoff,
  readyShrinkHandoffTasks,
  type StructuredShrinkHandoff,
  type StructuredShrinkHandoffV2,
} from "./handoff.ts";

const RECALL_NOTE =
  "Use `recall_compaction` to search for prior work, decisions, and context from before this summary. Do not redo work already completed.";
const COMPILE_SEPARATOR = "\n\n---\n\n";
const MAX_STRUCTURED_SUMMARY_CODE_POINTS = 65_300;
const TARGET_RESUME_SUMMARY_CODE_POINTS = 13_024;

const KIND_USER = "user";
const KIND_ASSISTANT = "assistant";
const KIND_BARD = "bard";
const KIND_TOOL_CALL = "tool_call";
const KIND_TOOL_RESULT = "tool_result";
const KIND_THINKING = "thinking";
const KIND_COMPACTION = "compaction";

type BlockKind =
  | typeof KIND_USER
  | typeof KIND_ASSISTANT
  | typeof KIND_BARD
  | typeof KIND_TOOL_CALL
  | typeof KIND_TOOL_RESULT
  | typeof KIND_THINKING
  | typeof KIND_COMPACTION;

interface NormalizedBlock {
  kind: BlockKind;
  text?: string;
  name?: string;
  callId?: string;
  args?: Record<string, unknown>;
  isError?: boolean;
  redacted?: boolean;
}

interface ConversationTurn {
  role: "user" | "assistant" | "bard";
  text: string;
}

interface ToolCallFingerprint {
  name: string;
  key: string;
  count: number;
}

interface ToolResultEntry {
  toolName: string;
  text: string;
  isError: boolean;
  artifactReceipt?: boolean;
  count?: number;
}

interface SessionMeta {
  id?: string;
  cwd?: string;
  model?: string;
  timestamp?: string;
  /** Last agent-authored <handoff>…</handoff> block, captured at compaction
   *  time. Surfaced as the leading <current-intent> section. Undefined when
   *  the agent emitted no handoff — summary then degrades byte-identically. */
  handoff?: string;
  handoffSource?: "assistant" | "saved";
  priorSummaries: string[];
}

interface ResumeIndex {
  activeFiles: string[];
  recentUserIntents: string[];
  continuationHints: string[];
  recallQueries: string[];
}

interface ConversationResult {
  turns: ConversationTurn[];
  /** Successful tool-observed reads; not proof of current existence. */
  readFiles: string[];
  /** Successful tool-reported writes; not a Git working-tree receipt. */
  modifiedFiles: string[];
  omittedReadFiles: number;
  omittedModifiedFiles: number;
  recentToolCalls: ToolCallFingerprint[];
  recentToolResults: ToolResultEntry[];
  verification: string[];
  workingTree: string[];
  sourceAnchors: string[];
  literalAnchors: string[];
  activeTasks: string[];
  resumeRisks: string[];
  budgetOmissions: string[];
  resumeTasks: string[];
  resumeIndex: ResumeIndex;
}

export interface LocalCompileResult {
  summary: string;
  readFiles: string[];
  modifiedFiles: string[];
  literalAnchors: string[];
  inputDigest: string;
  summaryDigest: string;
  digestScope: "compaction-input" | "bounded-compaction-input";
  usefulRecordCount: number;
}

export class CompactionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompactionInputError";
  }
}

const ansiRE = /\x1b\[[0-9;]*[A-Za-z]/g;
const ctrlRE = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

function sanitize(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(ansiRE, "").replace(ctrlRE, "");
}

function sliceU16(text: string, limit: number): string {
  return Array.from(text).slice(0, limit).join("");
}

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

// Harness-control errors with near-zero resume value: dropped from <recent-tool-results>
// even though they are errors (they still count toward edit-loop failure detection upstream).
const HARNESS_ERROR_SKIP = ["File unchanged since last read", "BLOCKED:"];

const noiseCustomTypes = new Set([
  "dc-hooks-session",
  "dc-hooks-rules",
  "skilldex-context",
  "knowledge-context",
  "knowledge-overview",
  // dc-rtk-context is injected once per session by pi-dc-jinn; keep it OUT of this
  // set so compaction preserves the single copy instead of dropping it.
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
  "taskagent-notification",
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
  // Leaking system/extension custom_message types found in real sessions (gitmine
  // follow-up, verified via end-to-end run): behavioral-rule injection, PM/audit
  // steer, compaction continuation primers (incl. dc-shrink's OWN output feeding
  // back in), and subagent task notifications. Kept OUT deliberately: dc-audit-decision
  // and dc-git-report carry real work-product signal.
  "dc-ocpd-context",
  "dc-pm-steer",
  "dc-crunch-continuation",
  "dc-shrink-continuation",
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
    out.push({ kind: KIND_USER, text });
  }
  for (const block of blocks) {
    if (block.type === "image") {
      out.push({ kind: KIND_USER, text: `[image: ${String(block.mimeType ?? "")}]` });
    }
  }
  return out.length > 0 ? out : [{ kind: KIND_USER, text: "" }];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Agent-authored handoff: the agent wraps its forward plan in <handoff>…</handoff>
// in response to the dc-shrink warn steer. We surface the LAST such block (the
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

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("compaction cancelled", "AbortError");
}

interface NormalizedEntry {
  main: NormalizedBlock[];
  bard: NormalizedBlock[];
  usefulRecordCount: number;
}

const emptyNormalizedEntry: NormalizedEntry = {
  main: [],
  bard: [],
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
  if (customType === SHRINK_HANDOFF_ENTRY_TYPE) {
    const handoff = handoffTextFromEntryData((entry as { data?: unknown }).data) ?? handoffTextFromEntryData(contentText);
    return saveHandoff(meta, handoff);
  }
  if (customType === "bard-context") {
    return normalizeBardContext(contentText);
  }
  if (noiseCustomTypes.has(customType)) return emptyNormalizedEntry;
  const hasImage = content.some((block) => block.type === "image");
  return contentText || hasImage
    ? { main: normalizeUser(content), bard: [], usefulRecordCount: 1 }
    : emptyNormalizedEntry;
}

function normalizeCustomEntry(entry: Record<string, unknown>, meta: SessionMeta): NormalizedEntry {
  if (entry.customType !== SHRINK_HANDOFF_ENTRY_TYPE) return emptyNormalizedEntry;
  return saveHandoff(meta, handoffTextFromEntryData((entry as { data?: unknown }).data));
}

function saveHandoff(meta: SessionMeta, handoff: string | undefined): NormalizedEntry {
  if (!handoff) return emptyNormalizedEntry;
  meta.handoff = sanitize(handoff);
  meta.handoffSource = "saved";
  return { ...emptyNormalizedEntry, usefulRecordCount: 1 };
}

function normalizeBardContext(contentText: string): NormalizedEntry {
  const text = sanitize(contentText).trim();
  return text
    ? { main: [], bard: [{ kind: KIND_BARD, text }], usefulRecordCount: 1 }
    : emptyNormalizedEntry;
}

function normalizeMessageEntry(entry: Record<string, unknown>, meta: SessionMeta): NormalizedEntry {
  const message = isRecord(entry.message) ? entry.message : {};
  const blocks = contentBlocks(message.content);
  if (message.role === "user") {
    return { main: normalizeUser(blocks), bard: [], usefulRecordCount: 1 };
  }
  if (message.role === "assistant") {
    captureAssistantHandoff(blocks, meta);
    return { main: normalizeAssistant(blocks), bard: [], usefulRecordCount: 1 };
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
      bard: [],
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
    bard: [],
    usefulRecordCount: 1,
  };
}

function normalizeSessionJsonl(content: string, signal?: AbortSignal): { blocks: NormalizedBlock[]; meta: SessionMeta; usefulRecordCount: number; invalidRecordCount: number } {
  const main: NormalizedBlock[] = [];
  const bard: NormalizedBlock[] = [];
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
    bard.push(...normalized.bard);
  }

  return { blocks: [...main, ...bard], meta, usefulRecordCount, invalidRecordCount };
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

function filterNoise(blocks: NormalizedBlock[]): NormalizedBlock[] {
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
      out.push({ kind: KIND_USER, text: cleaned });
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

function compressToolResults(blocks: NormalizedBlock[]): NormalizedBlock[] {
  return blocks.map((block) =>
    block.kind === KIND_TOOL_RESULT
      ? { ...block, text: compressResultText(block.text ?? "", Boolean(block.isError)) }
      : block,
  );
}

function argString(args: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = args?.[key];
  return typeof value === "string" ? value : undefined;
}

function extractPath(args: Record<string, unknown> | undefined): string | undefined {
  for (const key of ["path", "file_path", "filePath", "file"]) {
    const value = argString(args, key);
    if (value) return value;
  }
  return undefined;
}

function stripCdPrefix(command: string): string {
  const trimmed = command.trim();
  if (!trimmed.startsWith("cd ")) return trimmed;
  const after = trimmed.slice(3);
  const idx = after.indexOf(" && ");
  if (idx >= 0) return after.slice(idx + 4).trim();
  return basename(after.trim());
}

function fingerprintKey(name: string, args: Record<string, unknown> | undefined): string {
  const path = extractPath(args);
  if (path) return path;
  for (const key of ["action", "pattern"]) {
    const value = argString(args, key);
    if (value) return value;
  }
  const command = argString(args, "command");
  if (command) return sliceU16(stripCdPrefix(command), 40);
  const query = argString(args, "query");
  if (query) return sliceU16(query, 40);
  return "";
}

class OrderedSet {
  private readonly set = new Set<string>();
  private readonly order: string[] = [];

  add(value: string): void {
    if (this.set.has(value)) return;
    this.set.add(value);
    this.order.push(value);
  }

  remove(value: string): void {
    if (!this.set.delete(value)) return;
    const idx = this.order.indexOf(value);
    if (idx >= 0) this.order.splice(idx, 1);
  }

  slice(): string[] {
    return [...this.order];
  }
}

function addMarkerLine(set: OrderedSet, line: string): void {
  const normalized = sanitize(line).trim().split(/\s+/).filter(Boolean).join(" ");
  if (normalized) set.add(sliceU16(normalized, 180));
}

function addExactMarkerLine(set: OrderedSet, line: string, limit = 512): void {
  const sanitized = sanitize(line).trim();
  if (sanitized) set.add(sliceU16(sanitized, limit));
}

function limitedSetSlice(set: OrderedSet, limit: number, label: string): string[] {
  const values = set.slice();
  if (values.length <= limit) return values;
  return [...values.slice(values.length - limit), `... (${values.length - limit} ${label} omitted)`];
}

function renderVerificationReceipt(
  receipt: VerificationReceipt,
  currentMutationEpoch: number,
): string {
  const rawCwd = receipt.cwd ?? "unknown";
  const cwd = Array.from(rawCwd).length <= 200
    ? rawCwd
    : `[cwd sha256:${digest(rawCwd).slice(0, 16)}]`;
  const scope = `${receipt.tool || "shell"} cwd=${cwd}`;
  const command = Array.from(receipt.command).length <= 300
    ? receipt.command
    : `[command sha256:${digest(receipt.command).slice(0, 16)}]`;
  const evidence = sliceU16(receipt.evidence, 300);
  const stale = receipt.mutationEpoch < currentMutationEpoch
    ? " [freshness: not established after later potentially modifying work]"
    : "";
  return `${receipt.status} [${scope}]: ${command} — ${evidence}${stale}`;
}

function limitedVerificationSlice(
  receipts: Map<string, VerificationReceipt>,
  mutationEpoch: number,
  limit = 10,
): string[] {
  const values = [...receipts.values()].map((receipt) =>
    renderVerificationReceipt(receipt, mutationEpoch));
  if (values.length <= limit) return values;
  return [...values.slice(values.length - limit), `... (${values.length - limit} verification rows omitted)`];
}

function newestLimited<T>(values: T[], limit: number): { values: T[]; omitted: number } {
  if (values.length <= limit) return { values, omitted: 0 };
  return { values: values.slice(values.length - limit), omitted: values.length - limit };
}

function moveKeyToEnd(order: string[], key: string): void {
  const idx = order.indexOf(key);
  if (idx >= 0) order.splice(idx, 1);
  order.push(key);
}

const fileReadTools = new Set(["read", "read_file", "view"]);
const fileWriteTools = new Set(["edit", "write", "edit_file", "write_file", "multiedit"]);
const fileCreateTools = new Set(["write", "write_file"]);

interface ToolAdjacent {
  tools: string[];
  files: string[];
  hadError: boolean;
}

interface PendingToolCall {
  name: string;
  callId?: string;
  args?: Record<string, unknown>;
}

interface VerificationReceipt {
  status: "PASS" | "FAIL" | "SKIP" | "INCOMPLETE";
  tool: string;
  command: string;
  cwd?: string;
  evidence: string;
  mutationEpoch: number;
}

function popPendingToolCall(
  calls: PendingToolCall[],
  resultName: string,
  resultCallId?: string,
): { call: PendingToolCall; matched: boolean } {
  if (resultCallId) {
    const idx = calls.findIndex((call) => call.callId === resultCallId);
    return idx >= 0
      ? { call: calls.splice(idx, 1)[0], matched: true }
      : { call: { name: resultName, callId: resultCallId }, matched: false };
  }
  const candidates = calls
    .map((call, index) => ({ call, index }))
    .filter(({ call }) => call.name === resultName && !call.callId);
  if (candidates.length !== 1) return { call: { name: resultName }, matched: false };
  return { call: calls.splice(candidates[0].index, 1)[0], matched: true };
}

function isShellTool(name: string): boolean {
  return ["bash", "shell", "jinn_run_shell", "functions.bash"].includes(name.toLowerCase());
}

function shellCommand(call: PendingToolCall): string | undefined {
  if (!isShellTool(call.name)) return undefined;
  const command = argString(call.args, "command") ?? argString(call.args, "cmd");
  return command && command.trim() ? command : undefined;
}

function isVerificationCommand(command: string): boolean {
  const lower = command.toLowerCase().replace(/\s+/g, " ");
  return [
    "go test",
    "go build",
    "go vet",
    "golangci-lint",
    "go mod verify",
    "bun test",
    "npm test",
    "pnpm test",
    "yarn test",
    "cargo test",
    "pytest",
    "ruff",
    "mypy",
    "tsc",
    "typecheck",
    "lint",
    "just test",
    "just build",
    "git diff --check",
  ].some((marker) => lower.includes(marker));
}

function isKnownReadOnlyShellCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  return /^(?:pwd|ls(?:\s|$)|rg(?:\s|$)|grep(?:\s|$)|find(?:\s|$)|cat(?:\s|$)|head(?:\s|$)|tail(?:\s|$)|git\s+(?:status|diff)(?:\s|$))/.test(normalized);
}

function isWorkingTreeCommand(command: string): boolean {
  const lower = command.toLowerCase();
  return (
    lower.includes("git status") ||
    lower.includes("git diff --stat") ||
    lower.includes("git diff --name-only") ||
    lower.includes("git diff --check")
  );
}

function resultEvidence(result: string): string {
  for (const line of result.split("\n").map((value) => value.trim()).filter(Boolean)) {
    if (/^(ok\s+|PASS\b|FAIL\b|--- FAIL|\?\s+)/.test(line) || line.toLowerCase().includes("command exited with code")) {
      return line;
    }
  }
  return result.split("\n").map((value) => value.trim()).find(Boolean) ?? "no output";
}

function verificationStatus(result: string, isError: boolean): "PASS" | "FAIL" | "SKIP" {
  // "0 failed" / "failed: 0" / "0 failures" are pass evidence, not failures.
  const scrubbed = result.replace(/\b0 (?:failed|failures?)\b/gi, "").replace(/\bfail(?:ed|ures?)?:\s*0\b/gi, "");
  const lower = scrubbed.toLowerCase();
  if (isError || /command exited with code [1-9][0-9]*/.test(lower) || scrubbed.includes("FAIL") || lower.includes("failed")) return "FAIL";
  if (lower.includes("skip") || lower.includes("no tests to run")) return "SKIP";
  return "PASS";
}

function summarizeResultLines(result: string, empty: string): string {
  const lines = result.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 3);
  return lines.length > 0 ? lines.join("; ") : empty;
}

function verificationIdentity(call: PendingToolCall, sessionCwd?: string): string | undefined {
  const command = shellCommand(call);
  if (!command) return undefined;
  const cwd = argString(call.args, "cwd") ?? sessionCwd;
  return JSON.stringify([call.name, command, cwd ?? null]);
}

function collectShellMarkers(
  call: PendingToolCall,
  result: string,
  isError: boolean,
  verification: Map<string, VerificationReceipt>,
  workingTree: OrderedSet,
  sessionCwd: string | undefined,
  mutationEpoch: number,
): boolean {
  const command = shellCommand(call);
  if (!command) return false;
  let captured = false;
  if (isVerificationCommand(command)) {
    const identity = verificationIdentity(call, sessionCwd);
    if (identity) {
      verification.delete(identity);
      verification.set(identity, {
        status: verificationStatus(result, isError),
        tool: call.name,
        command,
        cwd: argString(call.args, "cwd") ?? sessionCwd,
        evidence: resultEvidence(result),
        mutationEpoch,
      });
    }
    captured = true;
  }
  if (isWorkingTreeCommand(command) && !isError) {
    const empty = command.toLowerCase().includes("diff") && !command.toLowerCase().includes("check") ? "no diff" : "clean";
    addMarkerLine(workingTree, `[git receipt, cwd=${argString(call.args, "cwd") ?? sessionCwd ?? "unknown"}] ${stripCdPrefix(command)}: ${summarizeResultLines(result, empty)}`);
    captured = true;
  }
  return captured;
}

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

function collectSourceAnchorsFromUserText(set: OrderedSet, text: string): void {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (["Timestamp:", "Working directory:", "Branch:"].some((prefix) => trimmed.startsWith(prefix))) continue;
    collectSourceAnchorsFromText(set, trimmed);
  }
}

function collectSourceAnchorsFromValue(set: OrderedSet, value: unknown): void {
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

function collectLiteralAnchors(blocks: NormalizedBlock[]): string[] {
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

function collectActiveTasks(toolName: string, result: string, tasks: OrderedSet): void {
  if (!toolName.toLowerCase().includes("task")) return;
  try {
    const parsed = JSON.parse(result);
    const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.tasks) ? parsed.tasks : undefined;
    if (records) {
      for (const record of records) {
        if (!isRecord(record)) continue;
        const status = typeof record.status === "string" ? record.status.toLowerCase().trim() : "";
        if (!status || ["done", "complete", "completed"].includes(status)) continue;
        addMarkerLine(tasks, `${String(record.id ?? "").trim()} ${status} ${String(record.title ?? "").trim()}`);
      }
      return;
    }
  } catch {
    // Fall through to line parser.
  }
  for (const raw of result.split("\n")) {
    const line = raw.trim();
    const lower = line.toLowerCase();
    if (lower.includes("done") || lower.includes("complete")) continue;
    const status = /\b(in-progress|open|blocked)\b/.exec(lower)?.[1];
    const id = /\b[0-9a-f]{8}\b/.exec(line)?.[0];
    if (status && id) addMarkerLine(tasks, `${id} ${status} ${line}`);
  }
}

function extractSignals(text: string): {
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
    startsWithFiller: /^(let me|now (let me|i'?ll|i will|update|check|run|fix|try)|i'?ll (just |now )?(check|run|try|update|fix|look)|let'?s (check|see|run|try)|next,? |good[.,!\s]|great[.,!\s]|perfect[.,!\s]|alright[.,!\s])/i.test(trimmed),
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
  return /(?:<!--\s*EXECUTION:\s*COMPLETE\s*-->|Phase\s+\d+\s+is\s+implemented|\b(?:all\s+tests\s+passed|is\s+implemented|tasks?\s+completed)\b)/i.test(text);
}

function isRecencyExemptTurn(text: string, signals = extractSignals(text)): boolean {
  return signals.hasDiff || signals.hasErrDiag || signals.hasFilePath ||
    isCompletionReport(text) ||
    /(?:<resume-state>|<verification>|sha256=[a-f0-9]{64}|Full output saved;|artifactPath|`[^`]+`)/i.test(text);
}

function trimTurn(text: string, ageFromNewest = 0): string {
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

function trimResumeLine(text: string): string {
  return sliceU16(text.trim().split(/\s+/).filter(Boolean).join(" "), 160);
}

function looksLikeContinuation(text: string): boolean {
  const lower = text.toLowerCase();
  return ["[next]", "[in progress]", "[blocked]", "next step", "next:", "todo", "remaining", "continue", "blocked", "follow up", "follow-up"].some((marker) =>
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

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function boundedValues(values: string[], limit: number, label: string, keep: "newest" | "highest" = "newest"): string[] {
  const unique = uniqueValues(values);
  if (unique.length <= limit) return unique;
  const retained = keep === "highest" ? unique.slice(0, limit) : unique.slice(unique.length - limit);
  return [`... (${unique.length - limit} ${label} omitted)`, ...retained];
}

// Bare user confirmations carry no resume value — skip them so recentUserIntents
// captures the actual ask, not "ok"/"continue". Anchored + length-bounded so it
// never swallows a real instruction that merely starts with "yes,".
function isBareConfirmation(text: string): boolean {
  if (/^\s*(y|yes|yep|yeah|ok|okay|sure|go|go ahead|do it|proceed|continue|run it|ship it|approved|thanks|ty)[.!,]?\s*$/i.test(text)) {
    return true;
  }
  return /^(?:\s*\d+[.)]\s*(?:recommended|stand down|yes|no|approve|approved|skip|stop|continue|go)[.!]?\s*)+$/i.test(text);
}

function buildResumeIndex(turns: ConversationTurn[], readFiles: string[], modifiedFiles: string[], recentToolCalls: ToolCallFingerprint[]): ResumeIndex {
  const activeFiles = boundedValues([...modifiedFiles, ...readFiles], 10, "active files");
  const allRecentUserIntents: string[] = [];
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].role === "user") {
      if (isBareConfirmation(turns[i].text)) continue;
      const line = trimResumeLine(turns[i].text);
      if (line) allRecentUserIntents.push(line);
    }
  }
  const recentUserIntents = boundedValues(allRecentUserIntents, 3, "recent user intents");
  const allContinuationHints: string[] = [];
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].role !== "assistant") continue;
    const line = trimResumeLine(turns[i].text);
    if (line && looksLikeContinuation(line)) allContinuationHints.push(line);
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

function compactAssistantTurns(turns: ConversationTurn[], toolAdj: ToolAdjacent[]): ConversationTurn[] {
  const scored = turns.map((turn, index): ScoredTurn => ({
    turn,
    signals: turn.role === "assistant" ? extractSignals(turn.text) : extractSignals(""),
    tools: toolAdj[index]?.tools ?? [],
    files: toolAdj[index]?.files ?? [],
    hadError: toolAdj[index]?.hadError ?? false,
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

function buildResumeTasks(input: {
  readFiles: string[];
  modifiedFiles: string[];
  recentToolCalls: ToolCallFingerprint[];
  verification: string[];
  workingTree: string[];
  sourceAnchors: string[];
  resumeIndex: ResumeIndex;
}): string[] {
  const out = new OrderedSet();
  const activeFiles = appendUniqueLimited([], new Set(), 4, [...input.modifiedFiles, ...input.readFiles]);
  if (activeFiles.length > 0) addMarkerLine(out, `Reread active files: ${activeFiles.join(", ")}`);
  const verificationLines = input.verification.filter((line) => !line.startsWith("... ("));
  const gate = verificationLines.find((line) => /^(?:FAIL|INCOMPLETE|BLOCKED)\b/.test(line))
    ?? verificationLines.at(-1);
  const verify = gate ? verificationCommand(gate) : "";
  if (verify) addExactMarkerLine(out, `Verify: ${verify}`, 512);
  const activeBases = new Set(activeFiles.map(recallQueryFromAnchor));
  const querySources = [
    ...input.sourceAnchors.map(recallQueryFromAnchor),
    ...input.recentToolCalls.map((call) => call.key),
    ...(activeFiles.length === 0 && input.sourceAnchors.length === 0 ? [] : input.resumeIndex.recallQueries),
  ];
  const queries = querySources.filter((query) => query && !activeBases.has(query) && !isVerificationCommand(query) && !isWorkingTreeCommand(query));
  if (queries[0]) addMarkerLine(out, `Recall: recall_compaction ${quoteRecallQuery(queries[0])}`);
  if (input.workingTree.length > 0) addMarkerLine(out, "Check working tree: git status --short");
  return out.slice().slice(0, 4);
}

function collectConversationToolCall(
  block: NormalizedBlock,
  pendingCalls: PendingToolCall[],
  fingerprints: Map<string, ToolCallFingerprint>,
  fingerprintOrder: string[],
): { pendingTool: string; pendingFile: string } {
  const name = block.name ?? "";
  const args = block.args ?? {};
  pendingCalls.push({ name, callId: block.callId, args });
  const path = extractPath(args);
  recordToolFingerprint(name, args, fingerprints, fingerprintOrder);
  return { pendingTool: name, pendingFile: path ?? "" };
}

function recordToolFileAccess(
  name: string,
  path: string,
  readFiles: OrderedSet,
  modifiedFiles: OrderedSet,
  createdFiles: OrderedSet,
): void {
  const boundedPath = sliceU16(path, 512);
  const canonicalName = name.toLowerCase();
  if (fileReadTools.has(canonicalName)) readFiles.add(boundedPath);
  if (fileWriteTools.has(canonicalName)) modifiedFiles.add(boundedPath);
  if (fileCreateTools.has(canonicalName)) createdFiles.add(boundedPath);
}

function recordToolFingerprint(
  name: string,
  args: Record<string, unknown>,
  fingerprints: Map<string, ToolCallFingerprint>,
  fingerprintOrder: string[],
): void {
  const key = fingerprintKey(name, args);
  const mapKey = `${name}:${key}`;
  const existing = fingerprints.get(mapKey);
  if (existing) {
    existing.count += 1;
    moveKeyToEnd(fingerprintOrder, mapKey);
    return;
  }
  fingerprints.set(mapKey, { name, key, count: 1 });
  fingerprintOrder.push(mapKey);
}

function collectConversationToolResult(
  block: NormalizedBlock,
  pendingCalls: PendingToolCall[],
  verification: Map<string, VerificationReceipt>,
  workingTree: OrderedSet,
  activeTasks: OrderedSet,
  sourceAnchors: OrderedSet,
  readFiles: OrderedSet,
  modifiedFiles: OrderedSet,
  createdFiles: OrderedSet,
  resumeRisks: OrderedSet,
  errorResults: ToolResultEntry[],
  recentResults: ToolResultEntry[],
  omittedErrorResults: number,
  omittedRecentResults: number,
  sessionCwd: string | undefined,
  mutationEpoch: number,
  lastErrorRun?: { current?: ToolResultEntry },
): { pendingError: boolean; omittedErrorResults: number; omittedRecentResults: number; mutationEpoch: number } {
  const text = (block.text ?? "").trim();
  const { call, matched } = popPendingToolCall(pendingCalls, block.name ?? "", block.callId);
  const isError = Boolean(block.isError);
  const path = matched ? extractPath(call.args) : undefined;
  if (matched && !isError) {
    collectSourceAnchorsFromValue(sourceAnchors, call.args);
    const command = shellCommand(call);
    if (command && !isKnownReadOnlyShellCommand(command)) mutationEpoch += 1;
    if (path) {
      recordToolFileAccess(call.name, path, readFiles, modifiedFiles, createdFiles);
      if (fileWriteTools.has(call.name.toLowerCase())) mutationEpoch += 1;
    }
  } else if (matched && isError && path && fileWriteTools.has(call.name.toLowerCase())) {
    addMarkerLine(resumeRisks, `Failed ${call.name} for ${path} may have partial effects; inspect before retry.`);
  }
  const capturedAsMarker = matched && collectShellMarkers(
    call,
    text,
    isError,
    verification,
    workingTree,
    sessionCwd,
    mutationEpoch,
  );
  collectActiveTasks(call.name, text, activeTasks);
  if (!text || capturedAsMarker) {
    return { pendingError: isError, omittedErrorResults, omittedRecentResults, mutationEpoch };
  }

  const artifactReceipt = extractOutputArtifactReceipt(text);
  const target = path ? `[target: ${path}] ` : "";
  const entry: ToolResultEntry = {
    toolName: block.name ?? "",
    text: artifactReceipt ?? sliceU16(`${target}${text}`, isError ? 500 : 300),
    isError,
    artifactReceipt: Boolean(artifactReceipt),
    count: 1,
  };
  if (entry.isError) {
    if (HARNESS_ERROR_SKIP.some((needle) => text.includes(needle))) {
      return { pendingError: true, omittedErrorResults, omittedRecentResults, mutationEpoch };
    }
    if (
      lastErrorRun?.current &&
      lastErrorRun.current.toolName === entry.toolName &&
      lastErrorRun.current.text === entry.text
    ) {
      lastErrorRun.current.count = (lastErrorRun.current.count ?? 1) + 1;
    } else {
      errorResults.push(entry);
      if (lastErrorRun) lastErrorRun.current = entry;
      if (errorResults.length > 10) {
        errorResults.shift();
        omittedErrorResults += 1;
      }
    }
  } else {
    if (lastErrorRun) lastErrorRun.current = undefined;
    recentResults.push(entry);
    if (recentResults.length > 15) {
      const removable = recentResults.findIndex((result) => !result.artifactReceipt);
      if (removable >= 0) {
        recentResults.splice(removable, 1);
        omittedRecentResults += 1;
      }
    }
  }
  return { pendingError: isError, omittedErrorResults, omittedRecentResults, mutationEpoch };
}

function extractOutputArtifactReceipt(text: string): string | undefined {
  if (!text.startsWith("[dc-shrink] Compacted ")) return undefined;
  const path = text.match(/^Full output saved; read this path if needed:\s*(.+)$/m)?.[1]?.trim();
  const receipt = text.match(/^Receipt:\s*sha256=([a-f0-9]{64})\s+bytes=(\d+)\s+strategy=(diagnostic|diff|json|test|search|generic)$/m);
  if (!path || !receipt) return undefined;
  return `artifact: ${path} sha256=${receipt[1]} bytes=${receipt[2]} strategy=${receipt[3]}`;
}

function collectConversationTurn(
  block: NormalizedBlock & { kind: "user" | "assistant" | "bard" },
  sourceAnchors: OrderedSet,
  toolAdj: ToolAdjacent[],
  turns: ConversationTurn[],
  pendingTools: string[],
  pendingFiles: string[],
  pendingError: boolean,
): boolean {
  const text = (block.text ?? "").trim();
  if (block.kind === KIND_USER) collectSourceAnchorsFromUserText(sourceAnchors, text);
  if (!text) return false;
  toolAdj.push({ tools: [...pendingTools], files: [...pendingFiles], hadError: pendingError });
  turns.push({ role: block.kind, text });
  return true;
}

function extractConversation(blocks: NormalizedBlock[], sessionCwd?: string): ConversationResult {
  const turns: ConversationTurn[] = [];
  const readFiles = new OrderedSet();
  const modifiedFiles = new OrderedSet();
  const createdFiles = new OrderedSet();
  const fingerprintOrder: string[] = [];
  const fingerprints = new Map<string, ToolCallFingerprint>();
  const errorResults: ToolResultEntry[] = [];
  const recentResults: ToolResultEntry[] = [];
  let omittedErrorResults = 0;
  let omittedRecentResults = 0;
  const verification = new Map<string, VerificationReceipt>();
  const workingTree = new OrderedSet();
  const sourceAnchors = new OrderedSet();
  const literalAnchors = collectLiteralAnchors(blocks);
  const activeTasks = new OrderedSet();
  const resumeRisks = new OrderedSet();
  const pendingCalls: PendingToolCall[] = [];
  const toolAdj: ToolAdjacent[] = [];
  let pendingTools: string[] = [];
  let pendingFiles: string[] = [];
  let pendingError = false;
  let mutationEpoch = 0;
  const lastErrorRun: { current?: ToolResultEntry } = {};

  for (const block of blocks) {
    if (block.kind === KIND_TOOL_CALL) {
      const pending = collectConversationToolCall(
        block,
        pendingCalls,
        fingerprints,
        fingerprintOrder,
      );
      if (pending.pendingTool) pendingTools.push(pending.pendingTool);
      if (pending.pendingFile) pendingFiles.push(pending.pendingFile);
      continue;
    }

    if (block.kind === KIND_TOOL_RESULT) {
      const collected = collectConversationToolResult(
        block,
        pendingCalls,
        verification,
        workingTree,
        activeTasks,
        sourceAnchors,
        readFiles,
        modifiedFiles,
        createdFiles,
        resumeRisks,
        errorResults,
        recentResults,
        omittedErrorResults,
        omittedRecentResults,
        sessionCwd,
        mutationEpoch,
        lastErrorRun,
      );
      if (collected.pendingError) pendingError = true;
      omittedErrorResults = collected.omittedErrorResults;
      omittedRecentResults = collected.omittedRecentResults;
      mutationEpoch = collected.mutationEpoch;
      continue;
    }

    if (block.kind === KIND_THINKING || block.kind === KIND_COMPACTION) continue;
    if (block.kind === KIND_USER || block.kind === KIND_ASSISTANT || block.kind === KIND_BARD) {
      lastErrorRun.current = undefined;
      const recorded = collectConversationTurn(
        block as NormalizedBlock & { kind: "user" | "assistant" | "bard" },
        sourceAnchors,
        toolAdj,
        turns,
        pendingTools,
        pendingFiles,
        pendingError,
      );
      if (!recorded) continue;
      pendingTools = [];
      pendingFiles = [];
      pendingError = false;
    }
  }

  // Ambiguous un-ID'd call/result groups remain pending by design: conservative
  // INCOMPLETE receipts are safer than falsely assigning a result by adjacency.
  for (const [index, call] of pendingCalls.entries()) {
    const identity = verificationIdentity(call, sessionCwd);
    const command = shellCommand(call);
    if (identity && command && isVerificationCommand(command)) {
      verification.set(`${identity}:incomplete:${call.callId ?? index}`, {
        status: "INCOMPLETE",
        tool: call.name,
        command,
        cwd: argString(call.args, "cwd") ?? sessionCwd,
        evidence: "tool call has no matching result",
        mutationEpoch,
      });
    }
    const path = extractPath(call.args);
    if (path && fileWriteTools.has(call.name.toLowerCase())) {
      addMarkerLine(resumeRisks, `Unmatched ${call.name} for ${path} has unknown effects; inspect before retry.`);
    }
  }

  for (const path of createdFiles.slice()) modifiedFiles.remove(path);
  const allRecentToolCalls = fingerprintOrder.map((key) => fingerprints.get(key)).filter((value): value is ToolCallFingerprint => Boolean(value));
  const recentToolCalls = allRecentToolCalls.slice(-20);
  if (allRecentToolCalls.length > recentToolCalls.length) {
    recentToolCalls.unshift({
      name: `... (${allRecentToolCalls.length - recentToolCalls.length} recent tool calls omitted)`,
      key: "",
      count: 1,
    });
  }

  for (let index = 0; index < turns.length; index++) {
    turns[index] = {
      ...turns[index],
      text: trimTurn(turns[index].text, turns.length - index - 1),
    };
  }
  let finalTurns = turns;
  let totalChars = finalTurns.reduce((sum, turn) => sum + turn.text.length, 0);
  while (finalTurns.length > 0 && totalChars > 16_000) {
    const latestSubstantiveIdx = finalTurns.findLastIndex(
      (t) => t.role === "assistant" && (isCompletionReport(t.text) || isSubstantive(extractSignals(t.text))),
    );
    const candidates = finalTurns
      .map((turn, index) => ({ turn, index, score: signalScore(extractSignals(turn.text)) }))
      .filter(({ turn, index }) => !isRecencyExemptTurn(turn.text) && index !== latestSubstantiveIdx);
    if (candidates.length === 0) break;
    candidates.sort((a, b) => a.score - b.score || a.index - b.index);
    const remove = candidates[0].index;
    totalChars -= finalTurns[remove].text.length;
    finalTurns = finalTurns.filter((_, index) => index !== remove);
    toolAdj.splice(remove, 1);
  }
  finalTurns = compactAssistantTurns(finalTurns, toolAdj);

  const boundedReadFiles = newestLimited(readFiles.slice(), 50);
  const boundedModifiedFiles = newestLimited([...modifiedFiles.slice(), ...createdFiles.slice()], 50);
  const finalReadFiles = boundedReadFiles.values;
  const finalModifiedFiles = boundedModifiedFiles.values;
  const finalVerification = limitedVerificationSlice(verification, mutationEpoch);
  const finalWorkingTree = limitedSetSlice(workingTree, 10, "working-tree rows");
  const finalSourceAnchors = limitedSetSlice(sourceAnchors, 10, "source anchors");
  const finalActiveTasks = limitedSetSlice(activeTasks, 10, "active tasks");
  const finalResumeRisks = limitedSetSlice(resumeRisks, 8, "resume risks");
  const resumeIndex = buildResumeIndex(finalTurns, finalReadFiles, finalModifiedFiles, recentToolCalls);

  return {
    turns: finalTurns,
    readFiles: finalReadFiles,
    modifiedFiles: finalModifiedFiles,
    omittedReadFiles: boundedReadFiles.omitted,
    omittedModifiedFiles: boundedModifiedFiles.omitted,
    recentToolCalls,
    recentToolResults: [
      ...(omittedErrorResults + omittedRecentResults > 0 ? [{
        toolName: "...",
        text: `(${omittedErrorResults + omittedRecentResults} recent tool results omitted)`,
        isError: false,
      }] : []),
      ...errorResults,
      ...recentResults,
    ],
    verification: finalVerification,
    workingTree: finalWorkingTree,
    sourceAnchors: finalSourceAnchors,
    literalAnchors,
    activeTasks: finalActiveTasks,
    resumeRisks: finalResumeRisks,
    budgetOmissions: [],
    resumeIndex,
    resumeTasks: buildResumeTasks({
      readFiles: finalReadFiles,
      modifiedFiles: finalModifiedFiles,
      recentToolCalls,
      verification: finalVerification,
      workingTree: finalWorkingTree,
      sourceAnchors: finalSourceAnchors,
      resumeIndex,
    }),
  };
}

// `&` is never entity-escaped in summary lines: `&` cannot forge a marker, and
// escaping it corrupts exact shell bytes (`&&`, URLs) in receipts and commands.
// `<`/`>` stay escaped except where exact command bytes are contractual.
function escapeResumeLine(line: string): string {
  return sanitize(line).trim().split(/\s+/).filter(Boolean).join(" ").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function markerBlock(name: string, lines: string[]): string {
  const escaped = lines.map((line) => sanitize(line).trim().replace(/</g, "&lt;").replace(/>/g, "&gt;")).filter(Boolean);
  return escaped.length > 0 ? [`<${name}>`, ...escaped, `</${name}>`].join("\n") : "";
}

// Verification identity is exact runner, command bytes: emit lines verbatim
// after sanitize() (ANSI/control-char stripping) and outer trim only.
function exactLineMarkerBlock(name: string, lines: string[]): string {
  const escaped = lines.map((line) => sanitize(line).trim()).filter(Boolean);
  return escaped.length > 0 ? [`<${name}>`, ...escaped, `</${name}>`].join("\n") : "";
}

function renderStructuredHandoff(handoff: StructuredShrinkHandoff): string {
  const lines = [
    "<resume-state>",
    "provenance: explicit handoff; task state, not verification",
    `objective: ${escapeResumeLine(handoff.objective)}`,
  ];
  for (const key of ["done", "next", "blocker", "decision", "verification-needed"] as const) {
    const items = handoff[key];
    if (items.length === 0) continue;
    lines.push(`${key}:`, ...items.map((item) => `- ${escapeResumeLine(item)}`));
  }
  lines.push("</resume-state>");
  return lines.join("\n");
}

function renderStructuredHandoffV2(handoff: StructuredShrinkHandoffV2): string {
  const lines = [
    "<resume-state>",
    "provenance: explicit handoff; task state, not verification",
    "version: 2",
    `objective: ${escapeResumeLine(handoff.objective)}`,
  ];
  const renderStrings = (name: string, values: string[]) => {
    if (values.length > 0) lines.push(`${name}:`, ...values.map((value) => `- ${escapeResumeLine(value)}`));
  };
  renderStrings("invariants", handoff.invariants);
  if (handoff.decisions.length > 0) {
    lines.push("decisions:", ...handoff.decisions.map((decision) =>
      `- ${decision.id}: ${escapeResumeLine(decision.text)}; rationale: ${escapeResumeLine(decision.rationale)}`));
  }
  if (handoff["rejected-hypotheses"].length > 0) {
    lines.push("rejected-hypotheses:", ...handoff["rejected-hypotheses"].map((hypothesis) =>
      `- ${hypothesis.id}: ${escapeResumeLine(hypothesis.claim)}; evidence: ${escapeResumeLine(hypothesis.evidence)}`));
  }
  if (handoff.tasks.length > 0) {
    lines.push("tasks:", ...handoff.tasks.flatMap((task) => {
      const taskLines = [`- ${task.id} [${task.status}]: ${escapeResumeLine(task.action)}`];
      if (task["depends-on"].length > 0) taskLines.push(`  depends-on: ${task["depends-on"].join(", ")}`);
      if (task.blocker) taskLines.push(`  blocker: ${escapeResumeLine(task.blocker)}`);
      return taskLines;
    }));
  }
  const ready = readyShrinkHandoffTasks(handoff);
  if (ready.length > 0) {
    lines.push("ready-tasks:", ...ready.map((task) => `- ${task.id}: ${escapeResumeLine(task.action)}`));
  }
  renderStrings("verification-needed", handoff["verification-needed"]);
  lines.push("</resume-state>");
  return lines.join("\n");
}

function escapeAngles(line: string): string {
  return sliceU16(line, 512).replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeMarkerText(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatFileMarkers(
  readFiles: string[],
  modifiedFiles: string[],
  omittedReadFiles = 0,
  omittedModifiedFiles = 0,
): string {
  const parts: string[] = [];
  if (readFiles.length > 0 || modifiedFiles.length > 0) {
    parts.push(
      "<file-evidence>",
      "read-files: successful tool-observed access; not proof of current existence",
      "modified-files: successful tool-reported write; not a Git working-tree receipt",
      "</file-evidence>",
    );
  }
  if (readFiles.length > 0 || omittedReadFiles > 0) {
    parts.push("<read-files>", ...readFiles.map(escapeAngles));
    if (omittedReadFiles > 0) parts.push(`... (${omittedReadFiles} read files omitted)`);
    parts.push("</read-files>");
  }
  if (modifiedFiles.length > 0 || omittedModifiedFiles > 0) {
    parts.push("<modified-files>", ...modifiedFiles.map(escapeAngles));
    if (omittedModifiedFiles > 0) parts.push(`... (${omittedModifiedFiles} modified files omitted)`);
    parts.push("</modified-files>");
  }
  return parts.join("\n");
}

function formatRecentToolCalls(calls: ToolCallFingerprint[]): string {
  if (calls.length === 0) return "";
  return [
    "<recent-tool-calls>",
    ...calls.map((call) => escapeAngles(`${call.key ? `${call.name}:${call.key}` : call.name}${call.count > 1 ? ` (x${call.count})` : ""}`)),
    "</recent-tool-calls>",
  ].join("\n");
}

function formatRecentToolResults(results: ToolResultEntry[]): string {
  if (results.length === 0) return "";
  return [
    "<recent-tool-results>",
    ...results.map((result) => {
      const countSuffix = (result.count ?? 1) > 1 ? ` (x${result.count})` : "";
      return escapeAngles(`${result.toolName}${result.isError ? " [ERROR]" : ""}: ${result.text.replace(/\n/g, " ").split(/\s+/).filter(Boolean).join(" ")}${countSuffix}`);
    }),
    "</recent-tool-results>",
  ].join("\n");
}

function formatResumeIndex(index: ResumeIndex): string {
  const lines = ["<resume-index>"];
  for (const [label, values] of [
    ["active-files", index.activeFiles],
    ["recent-user-intent", index.recentUserIntents],
    ["continuation", index.continuationHints],
    ["recall-queries", index.recallQueries],
  ] as const) {
    if (values.length === 0) continue;
    lines.push(`${label}:`, ...values.map((value) => `- ${escapeResumeLine(value)}`));
  }
  if (lines.length === 1) return "";
  lines.push("</resume-index>");
  return lines.join("\n");
}

function markerContent(text: string, tag: string): string | undefined {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = text.indexOf(open);
  if (start < 0) return undefined;
  const end = text.indexOf(close, start + open.length);
  if (end < 0) return undefined;
  return text.slice(start + open.length, end).trim() || undefined;
}

function latestVerificationState(text: string): string | undefined {
  const verification = markerContent(text, "verification");
  if (!verification) return undefined;
  const latest = new Map<string, string>();
  for (const line of verification.split("\n")) {
    const match = line.match(/^(?:PASS|FAIL|SKIP|BLOCKED|INCOMPLETE)(\s+\[[^\]]+\])?:\s*(.*?)(?:\s+—|$)/);
    if (!match) continue;
    const key = `${match[1] ?? ""}:${match[2]}`;
    latest.delete(key);
    latest.set(key, line);
  }
  return [...latest.values()].join("\n") || undefined;
}

/**
 * Prior dc-shrink output is already a structured recovery record. Carry its
 * forward-looking state instead of recursively embedding stale conversation,
 * tool output, and superseded verification receipts on every compaction.
 */
function filterPriorResumeIndex(value: string): string {
  const kept: string[] = [];
  let include = false;
  for (const line of value.split("\n")) {
    if (/^[a-z-]+:$/.test(line.trim())) {
      include = ["recent-user-intent:", "continuation:"].includes(line.trim());
    }
    if (include) kept.push(line);
  }
  return kept.join("\n").trim();
}

function filterPriorResumeTasks(value: string): string {
  return value
    .split("\n")
    .filter((line) => !/^(?:Reread active files|Recall):/.test(line.trim()))
    .join("\n")
    .trim();
}

function summarizePriorState(summary: string): string {
  const parts: string[] = [];
  const resumeState = markerContent(summary, "resume-state");
  if (resumeState) parts.push(`<resume-state>\n${escapeMarkerText(resumeState)}\n</resume-state>`);
  const currentIntent = markerContent(summary, "current-intent");
  if (currentIntent) parts.push(`<current-intent>\n${escapeMarkerText(currentIntent)}\n</current-intent>`);
  const userFocus = summary.match(/^## User Focus\n([\s\S]*?)(?=\n## |\n<|$)/m)?.[1]?.trim();
  if (userFocus) parts.push(`## User Focus\n${escapeMarkerText(userFocus)}`);
  const verification = latestVerificationState(summary);
  if (verification) parts.push(`<verification>\n${escapeMarkerText(verification)}\n</verification>`);
  for (const tag of [
    "resume-risks",
    "working-tree",
    "resume-tasks",
    "resume-index",
  ] as const) {
    const raw = markerContent(summary, tag);
    const value = tag === "resume-index"
      ? filterPriorResumeIndex(raw ?? "")
      : tag === "resume-tasks"
        ? filterPriorResumeTasks(raw ?? "")
        : raw;
    if (value) parts.push(`<${tag}>\n${escapeMarkerText(value)}\n</${tag}>`);
  }
  if (parts.length === 0) {
    return `Legacy prior summary (opaque):\n${escapeMarkerText(sliceU16(summary, 2_000))}`;
  }
  const budget = 3_800;
  const kept: string[] = [];
  let used = 0;
  for (const part of parts) {
    const size = Array.from(part).length + (kept.length > 0 ? 2 : 0);
    if (used + size > budget) break;
    kept.push(part);
    used += size;
  }
  if (kept.length < parts.length) kept.push(`... (${parts.length - kept.length} prior-state sections omitted)`);
  return kept.join("\n\n");
}

function formatPriorSummaries(summaries: string[]): string {
  if (summaries.length === 0) return "";
  const budget = 4_000;
  const newest = summaries.slice().reverse();
  const kept: string[] = [];
  let used = 0;
  for (const summary of newest) {
    const remaining = budget - used;
    if (remaining <= 0) break;
    const state = summarizePriorState(summary);
    const size = Array.from(state).length;
    if (size > remaining) break;
    kept.unshift(state);
    used += size;
  }
  const omitted = summaries.length - kept.length;
  const rows = kept.map((summary, index) => `[Prior ${index + 1} retained state]\n${summary}`);
  if (omitted > 0) rows.unshift(`... (${omitted} older summaries omitted)`);
  return `## Prior Summaries\n${rows.join("\n\n")}`;
}

function formatSummary(meta: SessionMeta, conv: ConversationResult, userFocus?: string): string {
  const parts: string[] = [];
  // Agent-authored handoff leads the summary: it is the freshest forward-looking
  // intent and the highest-value recovery signal. XML-marker style matches the
  // other activity blocks. Absent → no part pushed → byte-identical output.
  const handoff = meta.handoff?.trim();
  if (handoff) {
    const structured = parseAnyStructuredShrinkHandoff(handoff);
    parts.push(
      structured
        ? "version" in structured
          ? renderStructuredHandoffV2(structured)
          : renderStructuredHandoff(structured)
        : `<current-intent>\n${escapeAngles(handoff)}\n</current-intent>`,
      "",
    );
  }
  const metaLines = [
    meta.cwd ? `CWD: ${meta.cwd}` : "",
    meta.model ? `Model: ${meta.model}` : "",
    meta.timestamp ? `Started: ${meta.timestamp}` : "",
  ].filter(Boolean);
  if (metaLines.length > 0) parts.push(`## Session\n${metaLines.join("\n")}`, "");
  const prior = formatPriorSummaries(meta.priorSummaries);
  if (prior) parts.push(prior, "");
  if (userFocus?.trim()) parts.push(`## User Focus\n${escapeMarkerText(sliceU16(userFocus.trim(), 2_048))}`, "");
  parts.push(
    conv.turns.length > 0
      ? `## Conversation\n${conv.turns.map((turn) => `[${turn.role === "bard" ? "BARD" : turn.role[0].toUpperCase() + turn.role.slice(1)}] ${turn.text}`).join("\n")}`
      : "## Conversation",
  );
  for (const block of [
    formatFileMarkers(
      conv.readFiles,
      conv.modifiedFiles,
      conv.omittedReadFiles,
      conv.omittedModifiedFiles,
    ),
    formatRecentToolCalls(conv.recentToolCalls),
    formatRecentToolResults(conv.recentToolResults),
    exactLineMarkerBlock("verification", conv.verification),
    markerBlock("resume-risks", conv.resumeRisks),
    markerBlock("working-tree", conv.workingTree),
    markerBlock("source-anchors", conv.sourceAnchors),
    markerBlock("active-tasks", conv.activeTasks),
    markerBlock("literal-anchors", conv.literalAnchors),
    markerBlock("resume-tasks", conv.resumeTasks),
    formatResumeIndex(conv.resumeIndex),
    markerBlock("summary-omissions", conv.budgetOmissions),
  ]) {
    if (block) parts.push("", block);
  }
  return parts.join("\n");
}

function enforceOperatingBudget(
  meta: SessionMeta,
  conv: ConversationResult,
  userFocus?: string,
): void {
  const omitted = new Map<string, number>();
  const note = (label: string) => omitted.set(label, (omitted.get(label) ?? 0) + 1);
  const refreshResume = () => {
    conv.resumeIndex = buildResumeIndex(
      conv.turns,
      conv.readFiles,
      conv.modifiedFiles,
      conv.recentToolCalls,
    );
    conv.resumeTasks = buildResumeTasks({
      readFiles: conv.readFiles,
      modifiedFiles: conv.modifiedFiles,
      recentToolCalls: conv.recentToolCalls,
      verification: conv.verification,
      workingTree: conv.workingTree,
      sourceAnchors: conv.sourceAnchors,
      resumeIndex: conv.resumeIndex,
    });
  };
  // Reserve room for the omission receipt, separator, recall note, and metric prefix.
  const target = TARGET_RESUME_SUMMARY_CODE_POINTS - 1_024;
  let guard = 0;
  while (Array.from(formatSummary(meta, conv, userFocus)).length > target && guard++ < 1_000) {
    if (conv.recentToolResults.length > 0 && conv.recentToolResults.some((result) => !result.artifactReceipt)) {
      const removable = conv.recentToolResults.findIndex((result) => !result.artifactReceipt);
      conv.recentToolResults.splice(removable, 1);
      note("recent tool results");
    } else if (conv.sourceAnchors.length > 0) {
      conv.sourceAnchors.shift();
      note("source anchors");
    } else if (conv.literalAnchors.length > 0) {
      conv.literalAnchors.shift();
      note("literal anchors");
    } else if (conv.recentToolCalls.length > 0) {
      conv.recentToolCalls.shift();
      note("recent tool calls");
    } else if (conv.activeTasks.length > 0) {
      conv.activeTasks.shift();
      note("active tasks");
    } else if (conv.turns.length > 1) {
      const latestSubstantiveIdx = conv.turns.findLastIndex(
        (t) => t.role === "assistant" && (isCompletionReport(t.text) || isSubstantive(extractSignals(t.text))),
      );
      const candidates = conv.turns
        .map((turn, index) => ({ turn, index, score: signalScore(extractSignals(turn.text)) }))
        .filter(({ turn, index }) => !isRecencyExemptTurn(turn.text) && index !== latestSubstantiveIdx);
      if (candidates.length > 0) {
        candidates.sort((a, b) => a.score - b.score || a.index - b.index);
        conv.turns.splice(candidates[0].index, 1);
        note("conversation turns");
      } else if (conv.readFiles.length > 0) {
        conv.readFiles.shift();
        conv.omittedReadFiles += 1;
      } else if (conv.modifiedFiles.length > 0) {
        conv.modifiedFiles.shift();
        conv.omittedModifiedFiles += 1;
      } else if (conv.workingTree.length > 1) {
        conv.workingTree.shift();
        note("working-tree receipts");
      } else if (conv.verification.length > 1) {
        conv.verification.shift();
        note("verification receipts");
      } else {
        break;
      }
    } else if (conv.readFiles.length > 0) {
      conv.readFiles.shift();
      conv.omittedReadFiles += 1;
    } else if (conv.modifiedFiles.length > 0) {
      conv.modifiedFiles.shift();
      conv.omittedModifiedFiles += 1;
    } else if (conv.workingTree.length > 1) {
      conv.workingTree.shift();
      note("working-tree receipts");
    } else if (conv.verification.length > 1) {
      conv.verification.shift();
      note("verification receipts");
    } else {
      break;
    }
    refreshResume();
  }
  const omissions = [...omitted.entries()].map(([label, count]) =>
    `${count} ${label} omitted for the ${TARGET_RESUME_SUMMARY_CODE_POINTS.toLocaleString()}-code-point operating target`);
  if (Array.from(formatSummary(meta, conv, userFocus)).length > target) {
    omissions.push("protected-content overflow; operating target exceeded");
  }
  conv.budgetOmissions = omissions;
}

export function compileSessionJsonl(content: string, userFocus?: string, signal?: AbortSignal): LocalCompileResult {
  checkAbort(signal);
  if (!content.trim()) throw new CompactionInputError("compaction input is empty");
  const normalized = normalizeSessionJsonl(content, signal);
  if (normalized.invalidRecordCount > 0) {
    throw new CompactionInputError(
      `compaction input contains ${normalized.invalidRecordCount} malformed record(s)`,
    );
  }
  if (normalized.usefulRecordCount === 0) {
    throw new CompactionInputError("compaction input contains no useful records");
  }
  const conv = extractConversation(
    compressToolResults(filterNoise(normalized.blocks)),
    normalized.meta.cwd,
  );
  enforceOperatingBudget(normalized.meta, conv, userFocus);
  checkAbort(signal);
  let summary = `${formatSummary(normalized.meta, conv, userFocus)}${COMPILE_SEPARATOR}${RECALL_NOTE}`;
  while (Array.from(summary).length > MAX_STRUCTURED_SUMMARY_CODE_POINTS && (conv.readFiles.length > 0 || conv.modifiedFiles.length > 0)) {
    if (conv.readFiles.length >= conv.modifiedFiles.length && conv.readFiles.length > 0) {
      conv.readFiles.shift();
      conv.omittedReadFiles++;
    } else if (conv.modifiedFiles.length > 0) {
      conv.modifiedFiles.shift();
      conv.omittedModifiedFiles++;
    }
    summary = `${formatSummary(normalized.meta, conv, userFocus)}${COMPILE_SEPARATOR}${RECALL_NOTE}`;
  }
  if (Array.from(summary).length > MAX_STRUCTURED_SUMMARY_CODE_POINTS) {
    throw new CompactionInputError(
      `structured summary exceeds ${MAX_STRUCTURED_SUMMARY_CODE_POINTS.toLocaleString()} code points`,
    );
  }
  checkAbort(signal);
  return {
    summary,
    readFiles: conv.readFiles,
    modifiedFiles: conv.modifiedFiles,
    literalAnchors: conv.literalAnchors,
    inputDigest: digest(content),
    summaryDigest: digest(summary),
    digestScope: "compaction-input",
    usefulRecordCount: normalized.usefulRecordCount,
  };
}

const MAX_SESSION_BYTES = 20 * 1024 * 1024;
const HEAD_BYTES = 64 * 1024;

/** Oversized sessions: keep the head (session meta line) + a tail window.
 *  The turn budget drops oldest content anyway, so losing the middle is safe. */
interface BoundedSessionRead {
  content: string;
  digestScope: LocalCompileResult["digestScope"];
}

function digest(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function readSessionBounded(path: string): Promise<BoundedSessionRead> {
  const { size } = await stat(path);
  if (size <= MAX_SESSION_BYTES) {
    return { content: await readFile(path, "utf8"), digestScope: "compaction-input" };
  }
  const handle = await open(path, "r");
  try {
    const head = Buffer.alloc(HEAD_BYTES);
    await handle.read(head, 0, HEAD_BYTES, 0);
    const tailLen = MAX_SESSION_BYTES - HEAD_BYTES;
    const tail = Buffer.alloc(tailLen);
    await handle.read(tail, 0, tailLen, size - tailLen);
    const headText = head.toString("utf8");
    const tailText = tail.toString("utf8");
    // Drop partial lines at both cut points; parseLine skips garbage anyway.
    return {
      content: `${headText.slice(0, headText.lastIndexOf("\n") + 1)}\n${tailText.slice(tailText.indexOf("\n") + 1)}`,
      digestScope: "bounded-compaction-input",
    };
  } finally {
    await handle.close();
  }
}

export async function compileSessionFile(path: string, userFocus?: string): Promise<LocalCompileResult> {
  const input = await readSessionBounded(path);
  const result = compileSessionJsonl(input.content, userFocus);
  return { ...result, digestScope: input.digestScope };
}
