/**
 * Tool facade — task-shaped wrappers for pi execute() return values.
 *
 * Composes `textResult` / `errorResult` from ./_text-result for the
 * canonical shape; adds `json` and `empty` convenience methods.
 *
 * `Tool.register(pi, def)` — envelope facade that absorbs Guard.tool wrap +
 * pi.registerTool call into a single typed contract. `def.run` receives typed
 * args (Static<P>) and ToolExecutionContext; the Guard.tool wrap is automatic.
 *
 * Render policy (MinimalToolRow, summarizeOutput, defaultRenderCall) lives in
 * ./_tool-render.ts. This file owns contract types and the Tool shape only.
 *
 * @module dc-framework/lib/tool
 */

import type { TObject, Static } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "../pi/coding-agent";
import { truncateHead } from "../pi/coding-agent";
import {
  cancelledResult,
  textResult,
  errorResult,
  type ToolCancelledDetails,
  type ToolResult,
} from "./_text-result.ts";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  toolExecutionContext,
  type ToolExecutionContext,
  type ToolUpdateHandler,
} from "./_tool-execute.ts";
import { Guard } from "./guard.ts";
import {
  assertNotRegistered,
  assertRegistered,
  createSinkSlot,
  registeredNames,
} from "./_fake.ts";
import { rawOn } from "./_pi-on.ts";
import { pi as appPi } from "./_app.ts";
import { BASH_CLASS_TOOL_PATTERN, defaultRenderers } from "./_tool-render.ts";

export { BASH_CLASS_TOOL_PATTERN };

const sinkSlot = createSinkSlot();

type MarkedToolResult = {
  content: unknown;
  details: object;
};

// Pi ignores isError on an execute() return value. Keep the public result
// shape intact, then match its exact call/result pair in tool_result and patch
// the flag there. The outer weak keys keep registrations scoped to one Pi.
const markedErrorDetails = new WeakSet<object>();
const pendingErrorResults = new WeakMap<
  ExtensionAPI,
  Map<string, MarkedToolResult>
>();
const bridgedApis = new WeakSet<ExtensionAPI>();
const MAX_PENDING_ERROR_RESULTS = 256;

function markErrorResult<T extends object>(result: T): T {
  const markedDetails = (result as { details?: unknown }).details;
  if (markedDetails && typeof markedDetails === "object") {
    markedErrorDetails.add(markedDetails);
  }
  return result;
}

function trackMarkedResult(
  piArg: ExtensionAPI,
  toolCallId: string,
  result: unknown,
): void {
  if (!result || typeof result !== "object") {
    return;
  }
  const resultDetails = (result as { details?: unknown }).details;
  if (
    !resultDetails ||
    typeof resultDetails !== "object" ||
    !markedErrorDetails.has(resultDetails)
  ) {
    return;
  }
  let pending = pendingErrorResults.get(piArg);
  if (!pending) {
    pending = new Map();
    pendingErrorResults.set(piArg, pending);
  }
  if (pending.size >= MAX_PENDING_ERROR_RESULTS) {
    const oldestToolCallId = pending.keys().next().value;
    if (typeof oldestToolCallId === "string") {
      const oldest = pending.get(oldestToolCallId);
      pending.delete(oldestToolCallId);
      if (oldest) markedErrorDetails.delete(oldest.details);
    }
  }
  pending.set(toolCallId, {
    content: (result as { content?: unknown }).content,
    details: resultDetails,
  });
}

/** @internal Install before extension setup hooks so downstream consumers see patched failures. */
export function installToolErrorBridge(piArg: ExtensionAPI): void {
  if (bridgedApis.has(piArg) || typeof (piArg as { on?: unknown }).on !== "function") {
    return;
  }
  bridgedApis.add(piArg);
  rawOn(piArg, "tool_result", (event: {
    toolCallId?: unknown;
    content?: unknown;
    details?: unknown;
  }) => {
    if (typeof event.toolCallId !== "string") return undefined;
    const pending = pendingErrorResults.get(piArg);
    const marked = pending?.get(event.toolCallId);
    if (!marked) return undefined;
    if (event.content !== marked.content || event.details !== marked.details) {
      return undefined;
    }
    pending?.delete(event.toolCallId);
    markedErrorDetails.delete(marked.details);
    return { isError: true };
  });
}

export interface ToolFake {
  assertRegistered(name: string): void;
  assertNotRegistered(name: string): void;
  registered(): string[];
  restore(): void;
}

function details(d?: object): Record<string, unknown> {
  return (d ?? {}) as Record<string, unknown>;
}

function isToolContentBlock(item: unknown): boolean {
  if (!item || typeof item !== "object") return false;
  const type = (item as { type?: unknown }).type;
  if (type === "text") {
    return typeof (item as { text?: unknown }).text === "string";
  }
  if (type === "image") {
    return (
      typeof (item as { data?: unknown }).data === "string" &&
      typeof (item as { mimeType?: unknown }).mimeType === "string"
    );
  }
  return false;
}

function normalizeToolResult(result: unknown): unknown {
  if (typeof result === "string") return textResult(result);
  if (
    result &&
    typeof result === "object" &&
    Array.isArray((result as { content?: unknown }).content)
  ) {
    const content = (result as { content: unknown[] }).content;
    if (content.every(isToolContentBlock)) return result;
  }
  return markErrorResult(
    errorResult("Tool returned an invalid result shape.", {
      invalidResultType: result === null ? "null" : typeof result,
    }),
  );
}

/** Definition passed to `Tool.register`. */
export interface ToolRegisterDef<P extends TObject> {
  name: string;
  description: string;
  parameters: P;
  /** Async handler. Receives typed args and tool execution context. Must return ToolResult. */
  run: (args: Static<P>, exec: ToolExecutionContext) => Promise<ToolResult>;
  // Optional pi.registerTool pass-through fields
  label?: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  prepareArguments?: Parameters<
    ExtensionAPI["registerTool"]
  >[0]["prepareArguments"];
  executionMode?: Parameters<ExtensionAPI["registerTool"]>[0]["executionMode"];
  renderCall?: Parameters<ExtensionAPI["registerTool"]>[0]["renderCall"];
  renderResult?: Parameters<ExtensionAPI["registerTool"]>[0]["renderResult"];
  /**
   * Display contract for the Pi TUI.
   *
   * The default is "minimalist": Tool.register normalizes call/result chrome
   * for consistent harness output even when older registrations still carry
   * custom renderers. Use "custom" only for tools that intentionally own a
   * specialized component surface.
   */
  renderStyle?: "minimalist" | "custom";
  /** Controls pi-core shell framing. "self" opts out of the Box wrapper for tools that draw their own framing. */
  renderShell?: "default" | "self";
  /** Optional provider-side constrained sampling request for this tool. */
  constrainedSampling?: Parameters<
    ExtensionAPI["registerTool"]
  >[0]["constrainedSampling"];
  /** @deprecated Use renderShell. Kept for existing dc-* tool registrations. */
  n?: "default" | "self";
}

export interface ToolArtifactPreviewOptions {
  prefix: string;
  filename: string;
  maxLines?: number;
  maxBytes?: number;
  details?: object;
  truncatedMessage?: (path: string) => string;
}

export interface ToolShape {
  text(text: string, opts?: { details?: object }): ToolResult;
  json(value: unknown, opts?: { details?: object }): ToolResult;
  error(text: string, opts?: { details?: object }): ToolResult;
  empty(): ToolResult;
  cancelled(label?: string): ToolResult;
  artifactPreview(
    text: string,
    opts: ToolArtifactPreviewOptions,
  ): Promise<ToolResult>;
  /** Omitting pi resolves it from the App container. */
  register<P extends TObject>(def: ToolRegisterDef<P>): void;
  register<P extends TObject>(pi: ExtensionAPI, def: ToolRegisterDef<P>): void;
  fake(): ToolFake;
}

export const Tool: ToolShape = {
  text(text: string, opts?: { details?: object }): ToolResult {
    return textResult(text, details(opts?.details));
  },

  json(value: unknown, opts?: { details?: object }): ToolResult {
    return textResult(JSON.stringify(value, null, 2), details(opts?.details));
  },

  error(text: string, opts?: { details?: object }): ToolResult {
    return markErrorResult(errorResult(text, details(opts?.details)));
  },

  empty(): ToolResult {
    return textResult("", {});
  },

  cancelled(label?: string): ToolResult {
    return cancelledResult(label);
  },

  async artifactPreview(
    text: string,
    opts: ToolArtifactPreviewOptions,
  ): Promise<ToolResult> {
    const dir = await mkdtemp(join(tmpdir(), `${opts.prefix}-`));
    const outputPath = join(dir, opts.filename);
    await writeFile(outputPath, text, "utf8");

    const preview = truncateHead(text, {
      maxLines: opts.maxLines ?? 80,
      maxBytes: opts.maxBytes ?? 8 * 1024,
    });
    const lines = [preview.content.trim()];
    if (preview.truncated) {
      lines.push("");
      lines.push(
        opts.truncatedMessage?.(outputPath) ??
          `Preview truncated. Read ${outputPath} for the full output.`,
      );
    }

    return textResult(lines.filter(Boolean).join("\n"), {
      outputPath,
      outputDir: dir,
      truncated: preview.truncated,
      ...(opts.details ?? {}),
    });
  },

  /** Register a tool with pi. Wraps `def.run` in Guard.tool automatically. Omitting pi resolves it from the App container. */
  register<P extends TObject>(
    a: ExtensionAPI | ToolRegisterDef<P>,
    b?: ToolRegisterDef<P>,
  ): void {
    const piArg = b === undefined ? appPi() : (a as ExtensionAPI);
    const def = (b === undefined ? a : b) as ToolRegisterDef<P>;
    if (sinkSlot.tap("register", [def.name])) return;
    installToolErrorBridge(piArg);
    const renderers = defaultRenderers(def);
    piArg.registerTool({
      name: def.name,
      description: def.description,
      parameters: def.parameters,
      ...(def.label !== undefined && { label: def.label }),
      ...(def.promptSnippet !== undefined && {
        promptSnippet: def.promptSnippet,
      }),
      ...(def.promptGuidelines !== undefined && {
        promptGuidelines: def.promptGuidelines,
      }),
      ...(def.prepareArguments !== undefined && {
        prepareArguments: def.prepareArguments,
      }),
      ...(def.executionMode !== undefined && {
        executionMode: def.executionMode,
      }),
      ...(def.constrainedSampling !== undefined && {
        constrainedSampling: def.constrainedSampling,
      }),
      renderCall: renderers.renderCall,
      renderResult: renderers.renderResult,
      renderShell: renderers.renderShell,
      execute: Guard.tool(
        async (
          toolCallId: string,
          args: Static<P>,
          signal: AbortSignal | undefined,
          onUpdate: unknown,
          ctx: ExtensionContext,
        ) => {
          const exec = toolExecutionContext(
            toolCallId,
            signal ?? new AbortController().signal,
            onUpdate as Parameters<typeof toolExecutionContext>[2],
            ctx,
          );
          const result = normalizeToolResult(await def.run(args, exec));
          trackMarkedResult(piArg, toolCallId, result);
          return result as any;
        },
      ),
    } as any);
  },

  fake(): ToolFake {
    const { sink, restore } = sinkSlot.install();
    const handle: ToolFake = {
      assertRegistered: (name) =>
        assertRegistered(sink.byMethod("register"), "tool", name),
      assertNotRegistered: (name) =>
        assertNotRegistered(sink.byMethod("register"), "tool", name),
      registered: () => registeredNames(sink.byMethod("register")),
      restore,
    };
    return handle;
  },
};

export type { ToolResult };
export type { ToolCancelledDetails };
export type {
  ToolCallId,
  ToolExecutionContext,
  ToolUpdate,
  ToolUpdateHandler,
} from "./_tool-execute.ts";
