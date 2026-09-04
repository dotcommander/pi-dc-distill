import { appendFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "#distill-framework/pi/coding-agent";
import { Notify, Path } from "#distill-framework";
import { Events } from "#distill-framework/x/events";
import { Fs } from "#distill-framework/x/fs";

export interface OutputCompactorConfig {
  enabled: boolean;
  maxChars: number;
  maxLines: number;
  headLines: number;
  tailLines: number;
  errorHeadLines: number;
  errorTailLines: number;
}

export interface CompactPolicy {
  headLines: number;
  tailLines: number;
  maxChars: number;
}

export interface CompactResult {
  text: string;
  originalChars: number;
  originalLines: number;
  previewChars: number;
  previewLines: number;
}

export type PreviewStrategy =
  | "diagnostic"
  | "diff"
  | "json"
  | "test"
  | "search"
  | "generic";

export interface PreviewResult extends CompactResult {
  previewStrategy: PreviewStrategy;
}

export interface OutputArtifactRecord {
  timestamp: string;
  toolName: string;
  toolCallId: string;
  artifactPath: string;
  chars: number;
  lines: number;
  contentSha256: string;
  bytes: number;
  previewStrategy: PreviewStrategy;
}

interface TextBlock extends ContentBlock {
  type: "text";
  text: string;
}

interface ContentBlock {
  type?: unknown;
  text?: unknown;
  [key: string]: unknown;
}

interface ToolResultEvent {
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  content?: ContentBlock[];
  details?: Record<string, unknown>;
  isError?: boolean;
}

interface OutputCompactorOptions {
  config?: Partial<OutputCompactorConfig>;
  artifactRoot?: (cwd: string) => string;
  writeText?: (path: string, text: string) => Promise<void>;
  appendIndex?: (path: string, line: string) => Promise<void>;
}

export const DEFAULT_OUTPUT_COMPACTOR_CONFIG: OutputCompactorConfig = {
  enabled: true,
  maxChars: 12_000,
  maxLines: 240,
  headLines: 100,
  tailLines: 60,
  errorHeadLines: 160,
  errorTailLines: 120,
};

export function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.endsWith("\n")
    ? text.split("\n").length - 1
    : text.split("\n").length;
}

export function shouldCompact(
  text: string,
  config: OutputCompactorConfig,
): boolean {
  return text.length > config.maxChars || countLines(text) > config.maxLines;
}

function policyFor(
  config: OutputCompactorConfig,
  isError: boolean,
): CompactPolicy {
  return isError
    ? {
        headLines: config.errorHeadLines,
        tailLines: config.errorTailLines,
        maxChars: config.maxChars,
      }
    : {
        headLines: config.headLines,
        tailLines: config.tailLines,
        maxChars: config.maxChars,
      };
}

export function compactText(
  text: string,
  policy: CompactPolicy,
): CompactResult {
  const originalChars = text.length;
  const originalLines = countLines(text);
  const lines = text.split("\n");
  let preview: string;

  if (lines.length <= policy.headLines + policy.tailLines) {
    if (text.length <= policy.maxChars) {
      preview = text;
    } else {
      const headChars = Math.max(1, Math.floor(policy.maxChars * 0.6));
      const tailChars = Math.max(1, policy.maxChars - headChars);
      const omittedChars = Math.max(0, text.length - headChars - tailChars);
      preview = `${text.slice(0, headChars)}\n\n... omitted ${omittedChars} characters ...\n\n${text.slice(-tailChars)}`;
    }
  } else {
    const head = lines.slice(0, policy.headLines);
    const tail = lines.slice(-policy.tailLines);
    const omitted = lines.length - head.length - tail.length;
    preview = [
      ...head,
      "",
      `... omitted ${omitted} lines ...`,
      "",
      ...tail,
    ].join("\n");
  }

  if (preview.length > policy.maxChars) {
    const headChars = Math.max(1, Math.floor(policy.maxChars * 0.6));
    const tailChars = Math.max(1, policy.maxChars - headChars);
    const omittedChars = Math.max(0, preview.length - headChars - tailChars);
    preview = `${preview.slice(0, headChars)}\n\n... omitted ${omittedChars} preview characters ...\n\n${preview.slice(-tailChars)}`;
  }

  return {
    text: preview,
    originalChars,
    originalLines,
    previewChars: preview.length,
    previewLines: countLines(preview),
  };
}

function boundedSelectedPreview(
  text: string,
  selected: Array<{ index: number; text: string }>,
  policy: CompactPolicy,
): CompactResult | undefined {
  if (selected.length === 0) return undefined;
  const unique = [...new Map(selected.map((line) => [line.index, line])).values()]
    .sort((a, b) => a.index - b.index);
  const kept = unique.slice(0, Math.max(1, policy.headLines + policy.tailLines));
  const sourceLineCount = text.split("\n").length;
  const bodyLines: string[] = [];
  let previous = -1;
  for (const line of kept) {
    const gap = line.index - previous - 1;
    if (gap > 0) bodyLines.push(`... omitted ${gap} lines ...`);
    bodyLines.push(line.text);
    previous = line.index;
  }
  const tailGap = sourceLineCount - previous - 1;
  if (tailGap > 0) bodyLines.push(`... omitted ${tailGap} lines ...`);
  const body = bodyLines.join("\n");
  const bounded = body.length <= policy.maxChars
    ? {
        text: body,
        originalChars: body.length,
        originalLines: countLines(body),
        previewChars: body.length,
        previewLines: countLines(body),
      }
    : compactText(body, policy);
  return {
    ...bounded,
    originalChars: text.length,
    originalLines: countLines(text),
  };
}

function diagnosticPreview(text: string, policy: CompactPolicy, forced: boolean): CompactResult | undefined {
  const lines = text.split("\n");
  const selected: Array<{ index: number; text: string }> = [];
  const diagnostic = /(?:^|\b)(?:error|fatal|exception|panic|traceback|warning|failed|failure)(?:\b|:)|\b[A-Z]{1,5}\d{3,5}\b|(?:^|[ (])[^\s:()]+:\d+(?::\d+)?/i;
  for (let index = 0; index < lines.length; index++) {
    if (!diagnostic.test(lines[index])) continue;
    for (let nearby = Math.max(0, index - 1); nearby <= Math.min(lines.length - 1, index + 1); nearby++) {
      selected.push({ index: nearby, text: lines[nearby] });
    }
  }
  if (forced) {
    for (let index = 0; index < Math.min(lines.length, policy.headLines); index++) {
      selected.push({ index, text: lines[index] });
    }
  }
  for (let index = Math.max(0, lines.length - policy.tailLines); index < lines.length; index++) {
    selected.push({ index, text: lines[index] });
  }
  return boundedSelectedPreview(text, selected, policy);
}

function diffPreview(text: string, policy: CompactPolicy): CompactResult | undefined {
  const lines = text.split("\n");
  const selected: Array<{ index: number; text: string }> = [];
  let sawFile = false;
  let sawHunk = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^(?:diff --git |--- |\+\+\+ )/.test(line)) {
      sawFile = true;
      selected.push({ index, text: line });
    } else if (/^@@ /.test(line)) {
      sawHunk = true;
      selected.push({ index, text: line });
    } else if (sawHunk && /^[+-]/.test(line)) {
      selected.push({ index, text: line });
    }
  }
  return sawFile && sawHunk ? boundedSelectedPreview(text, selected, policy) : undefined;
}

function jsonPreview(text: string, policy: CompactPolicy): CompactResult | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text.trim());
  } catch {
    return undefined;
  }
  const diagnosticKey = (key: string) => /(?:error|errors|message|failure|failed|exception|panic|code|diagnostic)/i.test(key);
  const boundedEntries = (input: Record<string, unknown>) => {
    const entries = Object.entries(input);
    const priority = entries.filter(([key]) => diagnosticKey(key));
    const ordinary = entries.filter(([key]) => !diagnosticKey(key));
    return [...priority, ...ordinary].slice(0, 32);
  };
  const describe = (input: unknown, depth: number): unknown => {
    if (depth >= 3) {
      if (Array.isArray(input)) return { type: "array", count: input.length };
      if (input && typeof input === "object") {
        const record = input as Record<string, unknown>;
        const errorValues = boundedEntries(record)
          .filter(([key]) => diagnosticKey(key))
          .slice(0, 8)
          .map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 160) : value]);
        return {
          type: "object",
          count: Object.keys(record).length,
          ...(errorValues.length > 0 ? { errorValues: Object.fromEntries(errorValues) } : {}),
        };
      }
      return typeof input === "string" ? input.slice(0, 160) : input;
    }
    if (Array.isArray(input)) {
      return { count: input.length, values: input.slice(0, 8).map((item) => describe(item, depth + 1)) };
    }
    if (input && typeof input === "object") {
      return Object.fromEntries(boundedEntries(input as Record<string, unknown>).map(([key, item]) => [key, describe(item, depth + 1)]));
    }
    return typeof input === "string" ? input.slice(0, 256) : input;
  };
  const root = Array.isArray(value)
    ? { root: "array", count: value.length, preview: describe(value, 0) }
    : value && typeof value === "object"
      ? {
          root: "object",
          count: Object.keys(value).length,
          preview: describe(value, 0),
          keys: boundedEntries(value as Record<string, unknown>).map(([key]) => key),
        }
      : { root: typeof value, value: describe(value, 0) };
  const preview = JSON.stringify(root, null, 2);
  const bounded = compactText(preview, policy);
  return { ...bounded, originalChars: text.length, originalLines: countLines(text) };
}

function testPreview(text: string, policy: CompactPolicy): CompactResult | undefined {
  const lines = text.split("\n");
  const runner = /(?:\b(?:bun test|vitest|jest|pytest|go test)\b|\btests?\s+(?:passed|failed|skipped)\b|\bPASS\b|\bFAIL\b)/i;
  if (!runner.test(text)) return undefined;
  const selected = lines
    .map((line, index) => ({ index, text: line }))
    .filter(({ text: line }) => /(?:\bFAIL\b|\bfailed\b|\berror\b|\bpanic\b|\btests?\b|\bpass(?:ed)?\b|\bskip(?:ped)?\b|\d+\s+(?:pass|fail|skip))/i.test(line));
  return boundedSelectedPreview(text, selected, policy);
}

function searchPreview(text: string, policy: CompactPolicy): CompactResult | undefined {
  const lines = text.split("\n");
  const match = /^(.*?):(\d+)(?::\d+)?:/;
  const matches = lines.map((line, index) => ({ line, index, match: match.exec(line) })).filter((item) => item.match);
  if (matches.length < 2) return undefined;
  const perPath = new Map<string, number>();
  const selected: Array<{ index: number; text: string }> = [];
  for (const item of matches) {
    const path = item.match![1];
    const count = perPath.get(path) ?? 0;
    perPath.set(path, count + 1);
    if (count < 8) selected.push({ index: item.index, text: item.line });
  }
  for (const [path, count] of perPath) {
    if (count > 8) selected.push({ index: lines.length + selected.length, text: `... omitted ${count - 8} matches from ${path} ...` });
  }
  return boundedSelectedPreview(text, selected, policy);
}

export function previewOutput(
  text: string,
  policy: CompactPolicy,
  isError = false,
): PreviewResult {
  const candidates: Array<[PreviewStrategy, () => CompactResult | undefined]> = [
    ["diagnostic", () => isError || /(?:^|\n)(?:Error|ERROR|Fatal|Exception|Traceback|panic:)/.test(text) ? diagnosticPreview(text, policy, isError) : undefined],
    ["diff", () => diffPreview(text, policy)],
    ["json", () => jsonPreview(text, policy)],
    ["test", () => testPreview(text, policy)],
    ["search", () => searchPreview(text, policy)],
  ];
  for (const [previewStrategy, build] of candidates) {
    const result = build();
    if (result) return { ...result, previewStrategy };
  }
  return { ...compactText(text, policy), previewStrategy: "generic" };
}

function textBlocks(content: ContentBlock[] | undefined): TextBlock[] {
  return (content ?? []).filter(
    (part): part is TextBlock =>
      part.type === "text" && typeof part.text === "string",
  );
}

function safePart(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "tool"
  );
}

function defaultArtifactRoot(cwd: string): string {
  return join(Path.project("dc-distill", cwd).path, "tool-output");
}

function inputSummary(input: unknown): string {
  try {
    const json = JSON.stringify(input ?? {});
    return json.length > 500 ? `${json.slice(0, 500)}...` : json;
  } catch {
    return "<unserializable input>";
  }
}

async function writeArtifact(args: {
  cwd: string;
  toolName: string;
  toolCallId: string;
  text: string;
  lines: number;
  previewStrategy: PreviewStrategy;
  artifactRoot: (cwd: string) => string;
  writeText: (path: string, text: string) => Promise<void>;
  appendIndex: (path: string, line: string) => Promise<void>;
}): Promise<OutputArtifactRecord> {
  const root = args.artifactRoot(args.cwd);
  const timestamp = new Date().toISOString();
  const stamp = timestamp.replace(/[:.]/g, "-");
  const hash = createHash("sha256")
    .update(`${args.toolName}\n${args.toolCallId}\n${timestamp}`)
    .digest("hex")
    .slice(0, 10);
  const fileName = [
    stamp,
    safePart(args.toolName),
    safePart(args.toolCallId || hash),
    hash,
  ].join("-");
  const artifactPath = join(root, `${fileName}.txt`);

  await args.writeText(artifactPath, args.text);

  const record: OutputArtifactRecord = {
    timestamp,
    toolName: args.toolName,
    toolCallId: args.toolCallId,
    artifactPath,
    chars: args.text.length,
    lines: args.lines,
    contentSha256: createHash("sha256").update(args.text, "utf8").digest("hex"),
    bytes: Buffer.byteLength(args.text, "utf8"),
    previewStrategy: args.previewStrategy,
  };

  const indexPath = join(root, "index.jsonl");
  await args.appendIndex(indexPath, `${JSON.stringify(record)}\n`);

  return record;
}

async function appendLine(path: string, line: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, line, "utf8");
}

export function createOutputCompactor(options: OutputCompactorOptions = {}) {
  const config = {
    ...DEFAULT_OUTPUT_COMPACTOR_CONFIG,
    ...(options.config ?? {}),
  };
  const artifactRoot = options.artifactRoot ?? defaultArtifactRoot;
  const writeText = options.writeText ?? Fs.write;
  const appendIndex = options.appendIndex ?? appendLine;
  let warned = false;

  async function onToolResult(event: ToolResultEvent, ctx: any) {
    try {
      if (!config.enabled) return;
      const content = event.content ?? [];
      const texts = textBlocks(content);
      if (texts.length === 0) return;

      const fullText = texts.map((part) => part.text).join("\n");
      if (!shouldCompact(fullText, config)) return;

      const toolName = event.toolName || "tool";
      const toolCallId = event.toolCallId || "";
      const compact = previewOutput(
        fullText,
        policyFor(config, Boolean(event.isError)),
        Boolean(event.isError),
      );
      const artifact = await writeArtifact({
        cwd: ctx.cwd || process.cwd(),
        toolName,
        toolCallId,
        text: fullText,
        lines: compact.originalLines,
        previewStrategy: compact.previewStrategy,
        artifactRoot,
        writeText,
        appendIndex,
      });

      // The first line, the "Full output saved" line, and the "Receipt:" line are
      // parser anchors consumed by extractOutputArtifactReceipt in local-compact.ts;
      // keep them byte-for-byte and line-anchored.
      const notice = [
        `[dc-distill] Compacted ${toolName} output.`,
        `Input: ${inputSummary(event.input)}`,
        `Original: ${compact.originalLines} lines, ${compact.originalChars} chars.`,
        `Preview: ${compact.previewLines} lines, ${compact.previewChars} chars.`,
        `NOTE (agent): dc-distill auto-compacts any tool result over ${config.maxChars} chars or ${config.maxLines} lines. This is routine behavior, not an error, and nothing was lost.`,
        `Full output saved; read this path if needed: ${artifact.artifactPath}`,
        `NOTE (agent): that file holds the complete, unabridged output; read it there when you need the rest. Going forward, default to chunked reads (offset/limit) and keep commands narrowly scoped so results fit in context on the first pass.`,
        `Receipt: sha256=${artifact.contentSha256} bytes=${artifact.bytes} strategy=${artifact.previewStrategy}`,
        "",
        compact.text,
      ].join("\n");

      const nonText = content.filter((part) => part.type !== "text");
      return Events.toolPatch({
        content: [...nonText, { type: "text", text: notice }],
        details: {
          ...(event.details ?? {}),
          dcDistillOutputCompactor: {
            compacted: true,
            artifactPath: artifact.artifactPath,
            originalChars: compact.originalChars,
            originalLines: compact.originalLines,
            previewChars: compact.previewChars,
            previewLines: compact.previewLines,
            contentSha256: artifact.contentSha256,
            bytes: artifact.bytes,
            previewStrategy: artifact.previewStrategy,
          },
        },
      });
    } catch (error) {
      if (!warned && ctx?.hasUI) {
        warned = true;
        const message = error instanceof Error ? error.message : String(error);
        Notify.user(
          ctx,
          `dc-distill output compactor failed open: ${message}`,
          "warning",
        );
      }
      return;
    }
  }

  return { onToolResult };
}

export function registerOutputCompactor(pi: ExtensionAPI): void {
  const compactor = createOutputCompactor();
  Events.toolResult(
    pi,
    async ({ event, ctx }) => {
      return compactor.onToolResult(event as ToolResultEvent, ctx);
    },
    { label: "dc-distill/output-compactor/tool_result" },
  );
}
