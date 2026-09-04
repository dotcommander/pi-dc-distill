/**
 * Command facade — guarded slash-command registration with parsed arguments
 * and named output helpers.
 *
 * @module dc-framework/lib/command
 */

import type { ExtensionAPI, ExtensionCommandContext } from "../pi/coding-agent";
import {
  Args,
  type FlagDef,
  type ParseOptions,
  type ParseResult,
} from "./_args.ts";
import { Guard } from "./guard.ts";
import {
  Notify,
  type DisplayOptions,
  type FromUserOptions,
  type LlmOptions,
  type NotifyLevel,
} from "./notify.ts";
import { assertRegistered, createSinkSlot, registeredNames } from "./_fake.ts";
import { pi as appPi } from "./_app.ts";

const sinkSlot = createSinkSlot();

export interface CommandFake {
  assertRegistered(name: string): void;
  registered(): string[];
  restore(): void;
}

type CommandName = Parameters<ExtensionAPI["registerCommand"]>[0];
type CommandOptions = Parameters<ExtensionAPI["registerCommand"]>[1];

export interface CommandContext {
  readonly raw: string;
  readonly args: ParseResult;
  readonly ctx: ExtensionCommandContext;
  readonly pi: ExtensionAPI;
  user(message: string, level?: NotifyLevel): void;
  display(text: string, options?: DisplayOptions): void;
  editor(text: string): void;
  llm(text: string, options?: LlmOptions): void;
  followUp(text: string, options?: FromUserOptions): void;
  error(message: string): void;
}

export interface CommandDef {
  name: CommandName;
  description: string;
  flags?: FlagDef[];
  parse?: false | ParseOptions;
  label?: string;
  onError?: (err: unknown) => void;
  getArgumentCompletions?: CommandOptions["getArgumentCompletions"];
  run: (cmd: CommandContext) => void | Promise<void>;
}

function emptyParseResult(): ParseResult {
  return {
    flags: {},
    values: {},
    positional: [],
    errors: [],
  };
}

function buildCommandContext(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  raw: string,
  args: ParseResult,
): CommandContext {
  return {
    raw,
    args,
    ctx,
    pi,
    user(message, level = "info") {
      Notify.user(ctx, message, level);
    },
    display(text, options) {
      Notify.display(pi, text, options);
    },
    editor(text) {
      Notify.toEditor(ctx, text);
    },
    llm(text, options) {
      Notify.toLLM(pi, text, options);
    },
    followUp(text, options) {
      Notify.fromUser(pi, text, options);
    },
    error(message) {
      Notify.user(ctx, message, "error");
    },
  };
}

export interface CommandShape {
  /** Omitting pi resolves it from the App container. */
  register(def: CommandDef): void;
  register(pi: ExtensionAPI, def: CommandDef): void;
  fake(): CommandFake;
}

export const Command: CommandShape = {
  /** Register a slash command with pi. Omitting pi resolves it from the App container. */
  register(a: ExtensionAPI | CommandDef, b?: CommandDef): void {
    const piArg = b === undefined ? appPi() : (a as ExtensionAPI);
    const def = (b === undefined ? a : b) as CommandDef;
    if (sinkSlot.tap("register", [def.name])) return;
    piArg.registerCommand(def.name as any, {
      description: def.description,
      ...(def.getArgumentCompletions !== undefined && {
        getArgumentCompletions: def.getArgumentCompletions,
      }),
      handler: Guard.command(
        async (rawInput: string | undefined, ctx: ExtensionCommandContext) => {
          const raw = rawInput ?? "";
          const parseOptions = def.parse === false ? undefined : def.parse;
          const parsed =
            def.parse === false
              ? emptyParseResult()
              : Args.parse(raw, def.flags ?? [], parseOptions);
          await def.run(buildCommandContext(piArg, ctx, raw, parsed));
        },
        {
          label: def.label,
          onError: def.onError,
        },
      ),
    });
  },

  fake(): CommandFake {
    const { sink, restore } = sinkSlot.install();
    const handle: CommandFake = {
      assertRegistered: (name) =>
        assertRegistered(sink.byMethod("register"), "command", name),
      registered: () => registeredNames(sink.byMethod("register")),
      restore,
    };
    return handle;
  },
};
