import { decodeMessage } from "./message-decoder.ts";
import { CompactionInputError } from "./errors.ts";
import { isRecord, MAX_TEXT_CODE_POINTS, shorten } from "./helpers.ts";
import type { RawNormalizedRecord } from "./types.ts";

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap(block => {
    if (!isRecord(block)) throw new CompactionInputError("invalid message content block");
    if (block.type === "text") {
      if (typeof block.text !== "string") throw new CompactionInputError("invalid message text");
      return [block.text];
    }
    if (block.type === "image") return [`[image${typeof block.mimeType === "string" ? `: ${block.mimeType}` : ""}]`];
    return [];
  }).join("\n");
}

function toolId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) throw new CompactionInputError("invalid tool identity");
  return value;
}

/** Keep full tool identities and output until facts have been extracted. */
export function normalizeMessage(value: unknown): RawNormalizedRecord[] {
  const message = decodeMessage(value);
  switch (message.role) {
    case "system": return [];
    case "user": {
      const content = message.content;
      const nativeText = typeof content === "string" ? content : Array.isArray(content)
        ? content.flatMap(block => isRecord(block) && block.type === "text" && typeof block.text === "string" ? [block.text] : []).join("\n") : "";
      // Image-only messages must not replace the latest native user request.
      return [{ kind: "user", text: nativeText || textContent(content), nativeUserText: nativeText.length > 0 }];
    }
    case "assistant": {
      if (typeof message.content === "string") return [{ kind: "assistant", text: message.content }];
      if (!Array.isArray(message.content)) throw new CompactionInputError("invalid assistant content");
      return message.content.flatMap((block): RawNormalizedRecord[] => {
        if (!isRecord(block)) throw new CompactionInputError("invalid assistant block");
        if (block.type === "text") {
          if (typeof block.text !== "string") throw new CompactionInputError("invalid assistant text");
          return [{ kind: "assistant", text: block.text }];
        }
        if (block.type !== "toolCall") return [];
        if (typeof block.name !== "string" || !isRecord(block.arguments)) throw new CompactionInputError("invalid tool call");
        // Display text is bounded here with honest truncation provenance; the
        // full arguments stay in `args` for facts and envelope measurement, so
        // large calls never store their content twice.
        const callId = toolId(block.id);
        const callText = shorten(`${block.name} ${JSON.stringify(block.arguments)}`, MAX_TEXT_CODE_POINTS);
        return [{ kind: "tool-call", text: callText.text, textShortened: callText.shortened || undefined,
          name: block.name, callId, args: block.arguments }];
      });
    }
    case "toolResult": {
      const callId = toolId(message.toolCallId);
      const resultText = shorten(textContent(message.content), MAX_TEXT_CODE_POINTS);
      return [{ kind: "tool-result", text: resultText.text, textShortened: resultText.shortened || undefined, name: message.toolName,
        callId,
        isError: typeof message.isError === "boolean" ? message.isError : undefined }];
    }
    case "bashExecution": {
      const bashText = shorten(`${message.command}\n${message.output}`, MAX_TEXT_CODE_POINTS);
      return [{ kind: "bash", text: bashText.text, textShortened: bashText.shortened || undefined, command: message.command,
        output: message.output, exitCode: typeof message.exitCode === "number" && Number.isInteger(message.exitCode) ? message.exitCode : undefined,
        cancelled: message.cancelled === true, cwd: typeof message.cwd === "string" ? message.cwd : undefined }];
    }
    case "custom": return [{ kind: "custom", text: textContent(message.content) }];
    case "branchSummary":
    case "compactionSummary": {
      return [{ kind: message.role === "branchSummary" ? "branch-summary" : "native-summary", text: message.summary }];
    }
    default: throw new CompactionInputError("unsupported source message role");
  }
}
