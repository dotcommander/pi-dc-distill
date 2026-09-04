import type { AgentSession, AgentSessionEvent } from "../../pi/coding-agent";

/**
 * Subscribe to tool-call beats on a session and forward short labels to onBeat.
 * Filters: tool_execution_start → "tool: <name>(<args summary>)"
 *          tool_execution_end  → "tool: <name> → ok|err"
 * Skips: text_delta, message_start, message_end, and all other event types.
 */
export function collectProgress(
  session: AgentSession,
  onBeat: (label: string) => void,
): { unsubscribe: () => void } {
  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "tool_execution_start") {
      const argsSummary = summarizeArgs(event.args);
      const label = argsSummary
        ? `tool: ${event.toolName}(${argsSummary})`
        : `tool: ${event.toolName}`;
      onBeat(fitLabel(label));
    } else if (event.type === "tool_execution_end") {
      const suffix = event.isError ? "err" : "ok";
      onBeat(fitLabel(`tool: ${event.toolName} → ${suffix}`));
    }
  });
  return { unsubscribe };
}

/** Produce a short, prefix-trimmed summary of tool args for beat labels. */
function summarizeArgs(args: unknown): string {
  if (args == null) return "";
  if (typeof args === "string") return fitLabel(args, 40);
  if (typeof args === "object") {
    const entries = Object.entries(args as Record<string, unknown>);
    if (entries.length === 0) return "";
    // Take the first string-valued entry as the most informative arg
    const first = entries.find(([, v]) => typeof v === "string");
    if (first) return fitLabel(String(first[1]), 40);
    return fitLabel(JSON.stringify(args), 40);
  }
  return fitLabel(String(args), 40);
}

function fitLabel(label: string, max = 80): string {
  const singleLine = label.replace(/\s+/g, " ").trim();
  return singleLine.length > max ? singleLine.slice(0, max - 1) + "…" : singleLine;
}

export function collectResponseText(session: AgentSession) {
  let text = "";
  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "message_start") text = "";
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      text += event.assistantMessageEvent.delta;
    }
  });
  return { getText: () => text, unsubscribe };
}

export function getLastAssistantText(session: AgentSession): string {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const msg = session.messages[i];
    if (msg.role !== "assistant") continue;
    const text = msg.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("")
      .trim();
    if (text) return text;
  }
  return "";
}
