import { appendFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "#shrink-framework/pi/coding-agent";
import { Notify, Path } from "#shrink-framework";
import { Events } from "#shrink-framework/x/events";
import { Fs } from "#shrink-framework/x/fs";

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

export interface OutputArtifactRecord {
  timestamp: string;
  toolName: string;
  toolCallId: string;
  artifactPath: string;
  chars: number;
  lines: number;
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
  return join(Path.project("dc-shrink", cwd).path, "tool-output");
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
      const compact = compactText(
        fullText,
        policyFor(config, Boolean(event.isError)),
      );
      const artifact = await writeArtifact({
        cwd: ctx.cwd || process.cwd(),
        toolName,
        toolCallId,
        text: fullText,
        lines: compact.originalLines,
        artifactRoot,
        writeText,
        appendIndex,
      });

      const notice = [
        `[dc-shrink] Compacted ${toolName} output.`,
        `Input: ${inputSummary(event.input)}`,
        `Original: ${compact.originalLines} lines, ${compact.originalChars} chars.`,
        `Preview: ${compact.previewLines} lines, ${compact.previewChars} chars.`,
        `Full output saved; read this path if needed: ${artifact.artifactPath}`,
        "",
        compact.text,
      ].join("\n");

      const nonText = content.filter((part) => part.type !== "text");
      return Events.toolPatch({
        content: [...nonText, { type: "text", text: notice }],
        details: {
          ...(event.details ?? {}),
          dcShrinkOutputCompactor: {
            compacted: true,
            artifactPath: artifact.artifactPath,
            originalChars: compact.originalChars,
            originalLines: compact.originalLines,
            previewChars: compact.previewChars,
            previewLines: compact.previewLines,
          },
        },
      });
    } catch (error) {
      if (!warned && ctx?.hasUI) {
        warned = true;
        const message = error instanceof Error ? error.message : String(error);
        Notify.user(
          ctx,
          `dc-shrink output compactor failed open: ${message}`,
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
    { label: "dc-shrink/output-compactor/tool_result" },
  );
}
