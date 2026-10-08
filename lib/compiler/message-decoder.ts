import type { convertToLlm } from "../sdk.ts";
import { CompactionInputError } from "./errors.ts";
import { isRecord } from "./helpers.ts";

/** SDK discriminants constrain the known host roles, without trusting incoming host data. */
type SdkMessage = Parameters<typeof convertToLlm>[0][number];
type SdkRole = SdkMessage["role"];
type Role<R extends SdkRole> = { role: R };
export type DecodedMessage =
  | (Role<"system">)
  | (Role<"user" | "assistant" | "custom"> & { content: unknown })
  | (Role<"toolResult"> & { content: unknown; toolName: string; toolCallId: unknown; isError: unknown })
  | (Role<"bashExecution"> & { command: string; output: string; exitCode: unknown; cancelled: unknown; cwd: unknown })
  | (Role<"branchSummary" | "compactionSummary"> & { summary: string });

/** Validate every recognized text block, even beside a usable native-user text block. */
function validateTextBlocks(content: unknown, role: unknown): void {
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!isRecord(block)) throw new CompactionInputError(role === "assistant" ? "invalid assistant block" : "invalid message content block");
    if (block.type === "text" && typeof block.text !== "string")
      throw new CompactionInputError(role === "assistant" ? "invalid assistant text" : "invalid message text");
  }
}

/** Decode only the SDK fields consumed by the compiler; timestamps and provider metadata are opaque. */
export function decodeMessage(value: unknown): DecodedMessage {
  if (!isRecord(value)) throw new CompactionInputError("invalid preparation message");
  validateTextBlocks(value.content, value.role);
  switch (value.role) {
    case "system": return { role: "system" };
    case "user": case "assistant": case "custom": return { role: value.role, content: value.content };
    case "toolResult":
      if (typeof value.toolName !== "string") throw new CompactionInputError("invalid tool result name");
      return { role: value.role, content: value.content, toolName: value.toolName, toolCallId: value.toolCallId, isError: value.isError };
    case "bashExecution":
      if (typeof value.command !== "string" || typeof value.output !== "string") throw new CompactionInputError("invalid bash execution");
      return { role: value.role, command: value.command, output: value.output, exitCode: value.exitCode, cancelled: value.cancelled, cwd: value.cwd };
    case "branchSummary": case "compactionSummary":
      if (typeof value.summary !== "string") throw new CompactionInputError("invalid summary message");
      return { role: value.role, summary: value.summary };
    default: throw new CompactionInputError("unsupported source message role");
  }
}
