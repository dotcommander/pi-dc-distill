import { CompactionInputError } from "./errors.ts";
import { assertStructuralBounds, validateCheckpoint } from "./checkpoint.ts";
import { outsideExampleLines } from "./section-scanner.ts";
import { sanitize, sliceU16, isRecord, checkAbort, digest } from "./helpers.ts";
import { KIND_USER, KIND_ASSISTANT, KIND_TOOL_CALL, KIND_TOOL_RESULT, KIND_THINKING, KIND_COMPACTION, type NormalizedBlock, type SessionMeta } from "./types.ts";
import { isDistillHandoffType, LEGACY_CONTINUATION_MESSAGE_TYPE } from "../legacy.ts";
import { handoffTextFromEntryData } from "../handoff.ts";
import { observeVerification } from "./verification-observation.ts";

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

// Historical summaries have lost typed provenance. Remove only exact standalone
// filler there; headings, prefixes, and substring matches may be human instructions.
function stripNoiseFromCompaction(text: string): string {
  return text.split("\n").filter((line) => {
    if (!line.startsWith("[User] ")) return true;
    return !noiseStrings.includes(line.slice("[User] ".length).trim());
  }).join("\n");
}

function normalizeUser(blocks: Array<Record<string, unknown>>): NormalizedBlock[] {
  const out: NormalizedBlock[] = [];
  for (const block of blocks) {
    // Keep original occurrences separate so a pin's block identity and digest
    // remain authoritative, including repeated text and interleaved images.
    if (block.type === "text") {
      const text = sanitize(typeof block.text === "string" ? block.text : "").trim();
      if (text) out.push({ kind: KIND_USER, text, requestText: String(block.text), nativeUserText: true, origin: "human" });
    } else if (block.type === "image") {
      out.push({ kind: KIND_USER, text: `[image: ${String(block.mimeType ?? "")}]`, nativeUserText: false, origin: "human" });
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

function extractHandoff(text: string): string | undefined {
  if (text.length > 262_144) return undefined;
  const lines = text.split("\n"), outside = outsideExampleLines(lines);
  // Inline backticks and quotations cannot authorize a handoff. Markers still
  // support inline prose and multiline bodies at unquoted boundaries.
  let offset = 0;
  const eligible = new Set<number>();
  let delimiter: string | undefined;
  for (let line = 0; line < lines.length; line++) {
    const value = lines[line];
    if (outside[line] || delimiter?.startsWith("`")) for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (ch === "\\") { i++; continue; }
      if (ch === "`") {
        let end = i + 1;
        while (value[end] === "`") end++;
        const run = value.slice(i, end);
        if (delimiter === run) delimiter = undefined;
        else if (!delimiter) delimiter = run;
        i = end - 1;
        continue;
      }
      if (delimiter) {
        if (ch === delimiter && (ch !== "'" || i + 1 === value.length || /[\s).,;:!?]/.test(value[i + 1]))) delimiter = undefined;
        continue;
      }
      // Apostrophes inside words are contractions, not quotation boundaries.
      if ((ch === "'" || ch === '"' || ch === "“") && (i === 0 || /[\s([{:=]/.test(value[i - 1]))) {
        delimiter = ch === "“" ? "”" : ch;
        continue;
      }
      if (ch === "<" && /^<\/?handoff>/i.test(value.slice(i))) eligible.add(offset + i);
    }
    offset += value.length + 1;
  }
  let start: number | undefined, last: string | undefined;
  for (const match of text.matchAll(/<\/?handoff>/gi)) {
    if (!eligible.has(match.index!)) continue;
    if (match[0].toLowerCase() === "<handoff>") {
      if (start !== undefined) return undefined;
      start = match.index! + match[0].length;
    } else {
      if (start === undefined) return undefined;
      const inner = text.slice(start, match.index).trim(); if (inner) last = inner;
      start = undefined;
    }
  }
  return start === undefined ? last : undefined;
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
      if (entry.checkpoint !== undefined) { if (typeof entry.checkpointDigest !== "string") throw new CompactionInputError("missing checkpoint digest", "invalid_checkpoint"); meta.checkpoint = validateCheckpoint(entry.checkpoint, entry.checkpointDigest); }
      if (typeof entry.checkpointDigest === "string") meta.checkpointDigest = entry.checkpointDigest;
      if (typeof entry.predecessorEntryId === "string") meta.predecessorEntryId = entry.predecessorEntryId;
      if (Array.isArray(entry.checkpointUpdates)) meta.checkpointUpdates = entry.checkpointUpdates.map((update: unknown) => {
        if (!isRecord(update) || typeof update.entryId !== "string" || typeof update.checkpointDigest !== "string") throw new CompactionInputError("invalid saved checkpoint update", "invalid_checkpoint");
        return { checkpoint: validateCheckpoint(update.checkpoint, update.checkpointDigest), checkpointDigest: update.checkpointDigest, entryId: update.entryId };
      });
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
      meta.authenticatedPriorSummary = undefined;
      if (isRecord(entry.details) && entry.details.compactor === "dc-distill" && (entry.details.version === 13 || entry.details.version === 14 || entry.details.version === 15)) {
        if (typeof entry.details.checkpointDigest !== "string") throw new CompactionInputError("missing v13/v14/v15 checkpoint digest", "invalid_checkpoint");
        meta.checkpoint = validateCheckpoint(entry.details.checkpoint, entry.details.checkpointDigest);
        const authenticSummary = typeof entry.summary === "string" && typeof entry.id === "string" &&
          typeof entry.details.summaryDigest === "string" && digest(entry.summary) === entry.details.summaryDigest;
        if (entry.details.version >= 14 && !authenticSummary)
          throw new CompactionInputError("invalid_checkpoint: v14+ prior wire summary digest mismatch", "invalid_checkpoint");
        if (authenticSummary) meta.authenticatedPriorSummary = entry.summary as string;
        meta.checkpointDigest = entry.details.checkpointDigest;
        meta.predecessorEntryId = typeof entry.id === "string" ? entry.id : undefined;
      }
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
  (meta.declarations ??= []).push(sanitize(handoff));
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
        hostTruncated: message.truncated === true || (isRecord(message.details) && (message.details.truncated === true || (isRecord(message.details.truncation) && message.details.truncation.truncated === true))),
        isError: typeof message.isError === "boolean" ? message.isError : undefined,
      }],
      usefulRecordCount: 1,
    };
  }
  return emptyNormalizedEntry;
}

function captureAssistantHandoff(blocks: Array<Record<string, unknown>>, meta: SessionMeta): void {
  const handoff = extractHandoff(sanitize(textJoin(blocks)));
  if (handoff) (meta.declarations ??= []).push(handoff);
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
  let recordCount = 0;
  const budget = { visited: 0, containers: 0 };
  for (const line of content.split(/\n/)) {
    if (lineNumber++ % 128 === 0) checkAbort(signal);
    if (!line.trim()) continue;
    const entry = parseLine(line);
    if (!isRecord(entry)) {
      invalidRecordCount++;
      continue;
    }

    if (entry.type !== "session" && ++recordCount > 50_000) throw new CompactionInputError("discarded record limit exceeded", "required_analysis_overflow");
    assertStructuralBounds(entry, budget);
    const priorDeclarations = meta.declarations?.length ?? 0;
    const normalized = normalizeSessionEntry(entry, meta);
    const message = isRecord(entry.message) ? entry.message : {};
    const hasBlockReferences = Array.isArray(entry.sourceReferences);
    const original = hasBlockReferences ? contentBlocks(message.content) : [];
    const assistantIndices = hasBlockReferences && message.role === "assistant"
      ? original.flatMap((block,index) => ["text","thinking","toolCall"].includes(String(block.type)) ? [index] : []) : [];
    const userIndices = hasBlockReferences && message.role === "user"
      ? original.flatMap((block,index) => block.type === "image" || (block.type === "text" && typeof block.text === "string" && sanitize(block.text).trim()) ? [index] : []) : [];
    const referenceFor = (index: number) => {
      if (!Array.isArray(entry.sourceReferences)) {
        if (isRecord(entry.sourceReference)) return entry.sourceReference as unknown as NormalizedBlock["sourceReference"];
        if (entry.type === "message" && typeof entry.id === "string" && message.role === "user") {
          const content = contentBlocks(message.content);
          const eligible = content.flatMap((part, blockIndex) => part.type === "image" || (part.type === "text" && typeof part.text === "string" && sanitize(part.text).trim()) ? [blockIndex] : []);
          const blockIndex = eligible[index];
          const source = content[blockIndex];
          if (source?.type === "text" && typeof source.text === "string") return { sessionId: meta.id, entryId: entry.id,
            blockIndex, contentDigest: digest(source.text), sourceKind: "user" as const };
        }
        return undefined;
      }
      const blockIndex = message.role === "assistant" ? assistantIndices[index] : message.role === "user" ? userIndices[index] : original.length === 1 ? 0 : undefined;
      const references = entry.sourceReferences.filter(ref => isRecord(ref) && ref.blockIndex === blockIndex);
      return blockIndex !== undefined && references.length === 1 ? references[0] as NormalizedBlock["sourceReference"] : undefined;
    };
    for (let index = priorDeclarations; index < (meta.declarations?.length ?? 0); index++) {
      let source = referenceFor(0);
      if (message.role === "assistant" && Array.isArray(entry.sourceReferences)) {
        const handoff = meta.declarations![index];
        const matches = original.flatMap((block,blockIndex) => block.type === "text" && sanitize(String(block.text ?? "")).includes(handoff) ? [blockIndex] : []);
        if (matches.length !== 1) throw new CompactionInputError("ambiguous declaration source occurrence", "invalid_checkpoint");
        const references = entry.sourceReferences.filter(ref => isRecord(ref) && ref.blockIndex === matches[0]);
        if (references.length !== 1) throw new CompactionInputError("missing declaration source occurrence", "invalid_checkpoint");
        source = references[0] as NormalizedBlock["sourceReference"];
      }
      (meta.declarationSources ??= [])[index] = source;
    }
    usefulRecordCount += normalized.usefulRecordCount;
    main.push(...normalized.main.map((block,index) => ({ ...block,
      sourceReference: referenceFor(index),
      sourceKind: ["user", "bash", "agent-declaration", "tool-observation", "legacy"].includes(String(entry.sourceKind)) ? entry.sourceKind as NormalizedBlock["sourceKind"] : block.kind === KIND_USER && block.origin !== "custom" ? "user" : block.kind === KIND_ASSISTANT ? "agent-declaration" : block.kind === KIND_TOOL_RESULT ? "tool-observation" : "legacy",
    })));
  }

  return { blocks: main, meta, usefulRecordCount, invalidRecordCount };
}

const noiseStrings = [
  "Continue from where you left off.",
  "No response requested.",
  "IMPORTANT: TodoWrite was not called yet.",
];

const noiseXMLWrappers = [
  /<\/?system-reminder\b[^>]*>/g,
  /<\/?ide_opened_file\b[^>]*>/g,
  /<\/?command-message\b[^>]*>/g,
  /<\/?context-window-usage\b[^>]*>/g,
];

export function filterNoise(blocks: NormalizedBlock[]): NormalizedBlock[] {
  const out: NormalizedBlock[] = [];
  for (const block of blocks) {
    if (block.kind === KIND_THINKING) continue;
    if (block.kind === KIND_USER) {
      let cleaned = block.text ?? "";
      for (const wrapper of noiseXMLWrappers) cleaned = cleaned.replace(wrapper, "");
      cleaned = cleaned.trim();
      if (!cleaned || noiseStrings.includes(cleaned)) continue;
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

const errorLineRE = /^\s*(?:[A-Za-z]*Error\b|Fatal\b|Exception\b|Traceback\b|(?:---\s+)?FAIL\b|Warning:)/i;

function compressResultText(text: string, isError: boolean): string {
  const trimmed = text.trimEnd();
  if (trimmed.length <= maxCompressedLen) return trimmed;
  const lines = trimmed.split("\n");
  if (isError) {
    // Source positions, rather than text equality, define retained/omitted lines.
    // Reserve the final two nonblank lines before selecting explicit diagnostics.
    const positions = lines.flatMap((line, index) => line.trim() ? [index] : []);
    const selected = new Set(positions.slice(-errorTailLines));
    let diagnostics = 0;
    for (let index = 0; index < lines.length && diagnostics < errorHeadLines; index++) {
      if (!selected.has(index) && errorLineRE.test(lines[index])) {
        selected.add(index);
        diagnostics++;
      }
    }
    const kept = [...selected].sort((a, b) => a - b);
    const compressed = kept.map((index) => sliceU16(lines[index].trim(), 200)).join("\n");
    if (trimmed.length - compressed.length < 100) return trimmed;
    return `${compressed}\n...(${lines.length - selected.size} lines omitted)`;
  }
  const parts: string[] = [];
  const firstLine = sliceU16((lines[0] ?? "").trim(), 200);
  if (firstLine) parts.push(firstLine);
  const paths = Array.from(new Set(Array.from(trimmed.matchAll(filePathRE)).map((m) => m[0].trim())))
    .filter((path) => !path.startsWith("/dev/") && !path.startsWith("/proc/"))
    .slice(0, 5);
  if (paths.length > 0) parts.push(`paths: ${paths.join(", ")}`);
  const exitCode = lines.slice(-3).map((line) => exitCodeRE.exec(line)?.[1]).find(Boolean);
  if (exitCode && exitCode !== "0") parts.push(`exit: ${exitCode}`);
  const lastLine = sliceU16((lines.at(-1) ?? "").trim(), 200);
  if (lastLine && lastLine !== firstLine && !parts.includes(lastLine)) parts.push(lastLine);

  const keptLines = parts.slice(0, toolResultHeadLines);

  const compressed = keptLines.join("\n");
  if (trimmed.length - compressed.length < 100) return trimmed;
  return `${compressed}\n...(${lines.length - keptLines.length} lines omitted)`;
}

export function compressToolResults(blocks: NormalizedBlock[]): NormalizedBlock[] {
  return blocks.map((block) =>
    block.kind === KIND_TOOL_RESULT
      ? {
          ...block,
          suppliedImports: [...new Set(Array.from((block.text ?? "").matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)["'](\.\.?\/[^"'\n]+\.[A-Za-z0-9]+)["']/g), (match) => match[1]))],
          verificationObservation: block.verificationObservation ?? observeVerification(block.text ?? "", block.hostTruncated && block.isError !== true ? undefined : block.isError),
          text: compressResultText(block.text ?? "", Boolean(block.isError)),
        }
      : block,
  );
}
