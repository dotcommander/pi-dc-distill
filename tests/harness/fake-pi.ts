/**
 * Minimal fake Pi host for tests — owned port of dc-framework `x/testing`
 * (`lib/_stub-ctx.ts`), trimmed to what `lib/continuation.test.ts` consumes:
 * `createStubCtx` + `simulate` (hook/command/tool drivers).
 *
 * The stub records every API call, captures registrations (hooks, tools,
 * commands), and mirrors `pi.appendEntry` into in-memory session entries so
 * Entries facade reads work without a live session.
 *
 * @module tests/harness/fake-pi
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionToolContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { Compile, type Validator } from "typebox/compile";
import { Value } from "typebox/value";

const validatorCache = new WeakMap<TSchema, Validator>();

function validatorFor(schema: TSchema): Validator {
  const cached = validatorCache.get(schema);
  if (cached) return cached;
  const validator = Compile(schema);
  validatorCache.set(schema, validator);
  return validator;
}

function formatValidationPath(error: {
  keyword?: string;
  instancePath?: string;
  params?: Record<string, unknown>;
}): string {
  if (error.keyword === "required") {
    const requiredProperties = error.params?.requiredProperties;
    const requiredProperty = Array.isArray(requiredProperties)
      ? requiredProperties[0]
      : undefined;
    if (requiredProperty) {
      const basePath = (error.instancePath ?? "")
        .replace(/^\//, "")
        .replace(/\//g, ".");
      return basePath ? `${basePath}.${requiredProperty}` : requiredProperty;
    }
  }
  return (
    (error.instancePath ?? "").replace(/^\//, "").replace(/\//g, ".") ||
    "root"
  );
}

function validationErrorResult(message: string): {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
  isError: true;
} {
  return {
    content: [{ type: "text", text: message }],
    details: {},
    isError: true,
  };
}

function prepareAndValidateToolInput(
  tool: ToolDefinition,
  input: unknown,
): { ok: true; args: unknown } | { ok: false; error: string } {
  try {
    const prepared = tool.prepareArguments
      ? tool.prepareArguments(input)
      : input;
    const args = structuredClone(prepared);
    Value.Convert(tool.parameters, args);
    const validator = validatorFor(tool.parameters);
    if (validator.Check(args)) return { ok: true, args };
    const errors =
      validator
        .Errors(args)
        .map((error) => `  - ${formatValidationPath(error)}: ${error.message}`)
        .join("\n") || "Unknown validation error";
    return {
      ok: false,
      error: `Validation failed for tool "${tool.name}":\n${errors}\n\nReceived arguments:\n${JSON.stringify(prepared, null, 2)}`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface CallRecord {
  api: string; // "pi.registerCommand" | "ui.notify" | "ctx.abort" | ...
  args: unknown[];
}

type CommandHandler = (
  args: string,
  ctx: ExtensionCommandContext,
) => unknown | Promise<unknown>;

interface RegisteredCommand {
  handler: CommandHandler;
  [k: string]: unknown;
}

type HookHandler = (...args: unknown[]) => unknown | Promise<unknown>;

export interface StubCtx {
  pi: ExtensionAPI;
  ctx: ExtensionContext;
  cmdCtx: ExtensionCommandContext;
  calls: CallRecord[];
  registeredCommands: Map<string, RegisteredCommand>;
  registeredTools: Map<string, ToolDefinition>;
  registeredHooks: Map<string, HookHandler[]>;
  sessionEntries: Array<{ type: "custom"; customType: string; data: unknown }>;
  sessionBranch: Array<{ type: "custom"; customType: string; data: unknown }>;
}

export function createStubCtx(): StubCtx {
  const calls: CallRecord[] = [];
  const registeredCommands = new Map<string, RegisteredCommand>();
  const registeredTools = new Map<string, ToolDefinition>();
  const registeredHooks = new Map<string, HookHandler[]>();
  const sessionEntries: Array<{
    type: "custom";
    customType: string;
    data: unknown;
  }> = [];
  const sessionBranch: Array<{
    type: "custom";
    customType: string;
    data: unknown;
  }> = [];
  const r = (api: string, ...args: unknown[]) => void calls.push({ api, args });

  const ui = {
    select: (...a: unknown[]) => (
      r("ui.select", ...a),
      Promise.resolve<string | undefined>(undefined)
    ),
    confirm: (...a: unknown[]) => (
      r("ui.confirm", ...a),
      Promise.resolve(false)
    ),
    input: (...a: unknown[]) => (
      r("ui.input", ...a),
      Promise.resolve<string | undefined>(undefined)
    ),
    notify: (msg: string, type?: string) => r("ui.notify", msg, type),
    onTerminalInput: () => (r("ui.onTerminalInput"), () => {}),
    setStatus: (key: string, text: string | undefined) =>
      r("ui.setStatus", key, text),
    setWorkingMessage: (msg?: string) => r("ui.setWorkingMessage", msg),
    setWorkingVisible: (v: boolean) => r("ui.setWorkingVisible", v),
    setWorkingIndicator: (opts?: unknown) => r("ui.setWorkingIndicator", opts),
    setHiddenThinkingLabel: (label: string) =>
      r("ui.setHiddenThinkingLabel", label),
    setWidget: (key: string, content?: unknown, opts?: unknown) =>
      r("ui.setWidget", key, content, opts),
    setFooter: (factory?: unknown) => r("ui.setFooter", factory),
    setHeader: (factory?: unknown) => r("ui.setHeader", factory),
    setTitle: (title: string) => r("ui.setTitle", title),
    custom: async <T>(factory: unknown) => (
      r("ui.custom", factory),
      undefined as T
    ),
    pasteToEditor: (text: string) => r("ui.pasteToEditor", text),
    setEditorText: (text: string) => r("ui.setEditorText", text),
    getEditorText: () => (r("ui.getEditorText"), ""),
    editor: (...a: unknown[]) => (
      r("ui.editor", ...a),
      Promise.resolve<string | undefined>(undefined)
    ),
    addAutocompleteProvider: (factory: unknown) =>
      r("ui.addAutocompleteProvider", factory),
    setEditorComponent: (factory?: unknown) =>
      r("ui.setEditorComponent", factory),
    getEditorComponent: () => (r("ui.getEditorComponent"), undefined as any),
    theme: {} as any,
    getAllThemes: () => (r("ui.getAllThemes"), [] as any[]),
    getTheme: (name: string) => (r("ui.getTheme", name), undefined as any),
    setTheme: (theme: unknown) => (r("ui.setTheme", theme), { success: true }),
    getToolsExpanded: () => (r("ui.getToolsExpanded"), false),
    setToolsExpanded: (expanded: boolean) => r("ui.setToolsExpanded", expanded),
  } as ExtensionContext["ui"];

  const ctxBase = {
    ui,
    mode: "tui",
    hasUI: true,
    cwd: "/tmp/test",
    sessionManager: {
      getEntries: () => (r("sessionManager.getEntries"), sessionEntries),
      getBranch: () => (r("sessionManager.getBranch"), sessionBranch),
      getSessionId: () => (r("sessionManager.getSessionId"), "stub-session-id"),
    } as any,
    modelRegistry: {} as ExtensionContext["modelRegistry"],
    model: undefined as ExtensionContext["model"],
    scopedModels: [] as ExtensionContext["scopedModels"],
    isProjectTrusted: () => (r("ctx.isProjectTrusted"), true),
    isIdle: () => (r("ctx.isIdle"), true),
    signal: undefined as ExtensionContext["signal"],
    abort: () => r("ctx.abort"),
    hasPendingMessages: () => (r("ctx.hasPendingMessages"), false),
    shutdown: () => r("ctx.shutdown"),
    getContextUsage: () => (r("ctx.getContextUsage"), undefined),
    compact: (opts?: unknown) => r("ctx.compact", opts),
    getSystemPrompt: () => (r("ctx.getSystemPrompt"), ""),
    getSystemPromptOptions: () => (
      r("ctx.getSystemPromptOptions"),
      { cwd: "/tmp/test" }
    ),
  };

  const ctx = ctxBase as ExtensionContext;

  const cmdCtx = {
    ...ctxBase,
    waitForIdle: async () => r("cmdCtx.waitForIdle"),
    newSession: async (opts?: unknown) => (
      r("cmdCtx.newSession", opts),
      { cancelled: false }
    ),
    fork: async (id: string, opts?: unknown) => (
      r("cmdCtx.fork", id, opts),
      { cancelled: false }
    ),
    navigateTree: async (id: string, opts?: unknown) => (
      r("cmdCtx.navigateTree", id, opts),
      { cancelled: false }
    ),
    switchSession: async (p: string, opts?: unknown) => (
      r("cmdCtx.switchSession", p, opts),
      { cancelled: false }
    ),
    reload: async () => r("cmdCtx.reload"),
  } as ExtensionCommandContext;

  const pi = {
    on: (event: string, handler: HookHandler) => {
      r("pi.on", event, handler);
      const list = registeredHooks.get(event) ?? [];
      list.push(handler);
      registeredHooks.set(event, list);
    },
    registerTool: (tool: ToolDefinition) => {
      r("pi.registerTool", tool);
      registeredTools.set(tool.name, tool);
    },
    registerCommand: (name: string, options: RegisteredCommand) => {
      r("pi.registerCommand", name, options);
      registeredCommands.set(name, options);
    },
    registerShortcut: (...a: unknown[]) => r("pi.registerShortcut", ...a),
    registerFlag: (...a: unknown[]) => r("pi.registerFlag", ...a),
    getFlag: (name: string) => (r("pi.getFlag", name), undefined),
    registerMessageRenderer: (...a: unknown[]) =>
      r("pi.registerMessageRenderer", ...a),
    sendMessage: (...a: unknown[]) => r("pi.sendMessage", ...a),
    sendUserMessage: (...a: unknown[]) => r("pi.sendUserMessage", ...a),
    appendEntry: (customType: string, data: unknown) => {
      r("pi.appendEntry", customType, data);
      const entry = { type: "custom" as const, customType, data };
      sessionEntries.push(entry);
      sessionBranch.push(entry);
    },
    setSessionName: (name: string) => r("pi.setSessionName", name),
    getSessionName: () => (
      r("pi.getSessionName"),
      undefined as string | undefined
    ),
    setLabel: (...a: unknown[]) => r("pi.setLabel", ...a),
    exec: (...a: unknown[]) => (
      r("pi.exec", ...a),
      Promise.resolve({ stdout: "", stderr: "", exitCode: 0 })
    ),
    getSettings: () => (r("pi.getSettings"), {}),
    getActiveTools: () => (r("pi.getActiveTools"), [] as string[]),
    getAllTools: () => (r("pi.getAllTools"), [] as any[]),
    setActiveTools: (names: string[]) => r("pi.setActiveTools", names),
    getCommands: () => (r("pi.getCommands"), [] as any[]),
    setModel: (model: unknown) => (
      r("pi.setModel", model),
      Promise.resolve(true)
    ),
    getThinkingLevel: () => (r("pi.getThinkingLevel"), "medium" as any),
    setThinkingLevel: (level: unknown) => r("pi.setThinkingLevel", level),
    registerProvider: (...a: unknown[]) => r("pi.registerProvider", ...a),
    unregisterProvider: (name: string) => r("pi.unregisterProvider", name),
    events: {
      emit: () => {},
      on: () => {},
      off: () => {},
      once: () => {},
    } as any,
  } as unknown as ExtensionAPI;

  return {
    pi,
    ctx,
    cmdCtx,
    calls,
    registeredCommands,
    registeredTools,
    registeredHooks,
    sessionEntries,
    sessionBranch,
  };
}

export const simulate = {
  command: async (
    stub: StubCtx,
    name: string,
    args: string,
  ): Promise<unknown> => {
    const cmd = stub.registeredCommands.get(name);
    if (!cmd) throw new Error(`Command "${name}" not registered`);
    return cmd.handler(args, stub.cmdCtx);
  },
  tool: async (
    stub: StubCtx,
    name: string,
    input: unknown,
  ): Promise<unknown> => {
    const tool = stub.registeredTools.get(name);
    if (!tool) throw new Error(`Tool "${name}" not registered`);
    const prepared = prepareAndValidateToolInput(tool, input);
    // Keep discriminant narrowing with the project's non-strict compiler settings.
    if (prepared.ok === false) return validationErrorResult(prepared.error);
    try {
      return await tool.execute(
        "stub-call-id",
        prepared.args as any,
        new AbortController().signal,
        () => {},
        {
          ...stub.ctx,
          tools: [],
          executeTool: async (name, _args) => ({
            toolCall: { type: "toolCall", id: "stub-call-id/1", name, arguments: {} },
            result: validationErrorResult("Nested tool execution is not implemented by this stub."),
            isError: true,
          }),
        } satisfies ExtensionToolContext,
      );
    } catch (err) {
      // Match Pi's native tool execution boundary: thrown handlers become
      // failed tool results rather than rejected harness promises.
      return validationErrorResult(
        err instanceof Error ? err.message : String(err),
      );
    }
  },
  hook: async (
    stub: StubCtx,
    event: string,
    payload?: unknown,
  ): Promise<unknown[]> => {
    const handlers = stub.registeredHooks.get(event);
    if (!handlers?.length) return [];
    const results: unknown[] = [];
    let currentPayload = payload;
    for (const h of handlers) {
      const result = await h(currentPayload, stub.ctx);
      results.push(result);
      if (
        event === "tool_result" &&
        result &&
        typeof result === "object" &&
        currentPayload &&
        typeof currentPayload === "object"
      ) {
        currentPayload = { ...currentPayload, ...result };
      }
    }
    return results;
  },
};
