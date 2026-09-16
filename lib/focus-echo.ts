// Focus echo: duplicate the highest-signal post-compaction continuation hints
// near the active user turn so they survive lost-in-the-middle effects.
// The context transform is ephemeral (not persisted), so the echo is rebuilt
// and re-injected every turn while a shrink summary is present in context.

interface EchoMessage {
  role?: string;
  content?: unknown;
  summary?: unknown;
}

export interface FocusEchoResult {
  messages: unknown[];
  echoText: string;
}

const ECHO_MARKER = "<shrink-focus-echo>";
const MAX_ITEMS = 6;
const MAX_LINE = 180;
const MAX_ECHO_CHARS = 1200;

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((item): item is Record<string, unknown> =>
      item !== null && typeof item === "object")
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("\n");
}

function extractMessageText(message: unknown): string {
  if (message === null || typeof message !== "object") return "";
  const value = message as EchoMessage;
  if (value.role === "compactionSummary" && typeof value.summary === "string") {
    return value.summary;
  }
  return textFromContent(value.content);
}

function roleOf(message: unknown): string | undefined {
  if (message === null || typeof message !== "object") return undefined;
  const role = (message as EchoMessage).role;
  return typeof role === "string" ? role : undefined;
}

function extractTag(text: string, tag: string): string {
  const match = text.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i"));
  return match?.[1]?.trim() ?? "";
}

function cleanLine(line: string): string {
  return line
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LINE);
}

function linesFromBlock(block: string): string[] {
  return block
    .split(/\n/)
    .map(cleanLine)
    .filter((line) => line.length > 0)
    .filter((line) => !/^#+\s+/.test(line))
    .slice(0, MAX_ITEMS);
}

function extractHeading(text: string, heading: string): string {
  const re = new RegExp(
    `^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s+|^<|(?![\\s\\S]))`,
    "im",
  );
  const match = text.match(re);
  if (!match?.[1]) return "";
  return linesFromBlock(match[1])[0] ?? "";
}

function uniq(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function compactItems(items: string[]): string[] {
  return uniq(items.map(cleanLine).filter(Boolean)).slice(0, MAX_ITEMS);
}

function buildEcho(summary: string): string | null {
  const userFocus = extractHeading(summary, "User Focus");
  const structuredState = linesFromBlock(extractTag(summary, "resume-state"))
    .filter((line) => !line.startsWith("provenance:"));
  const currentIntent = linesFromBlock(extractTag(summary, "current-intent"));
  const risks = linesFromBlock(extractTag(summary, "resume-risks"));
  const resume = linesFromBlock(extractTag(summary, "resume-index"));
  const readFiles = compactItems(linesFromBlock(extractTag(summary, "read-files")));
  const modifiedFiles = compactItems(linesFromBlock(extractTag(summary, "modified-files")));

  if (!hasEchoSignal(userFocus, structuredState, currentIntent, risks, resume, readFiles, modifiedFiles)) {
    return null;
  }

  const lines = [ECHO_MARKER];
  if (structuredState.length > 0) {
    lines.push("Explicit resume state:");
    for (const item of structuredState) lines.push(`- ${item}`);
  } else if (currentIntent.length > 0) {
    lines.push(`Current intent: ${currentIntent.join(" ")}`);
  }
  if (userFocus) lines.push(`Focus: ${userFocus}`);
  if (risks.length > 0) lines.push(`Resume risks: ${risks.join("; ")}`);
  if (modifiedFiles.length > 0) lines.push(`Modified files: ${modifiedFiles.join(", ")}`);
  if (readFiles.length > 0) lines.push(`Read files: ${readFiles.join(", ")}`);
  if (resume.length > 0) {
    lines.push("Resume index:");
    for (const item of resume) lines.push(`- ${item}`);
  }
  lines.push("</shrink-focus-echo>");

  const echo = lines.join("\n");
  if (echo.length <= MAX_ECHO_CHARS) return echo;
  const closing = `\n</shrink-focus-echo>`;
  const prefix = `${ECHO_MARKER}\n`;
  const body = lines.slice(1, -1).join("\n");
  const budget = MAX_ECHO_CHARS - prefix.length - closing.length - "\n...".length;
  return `${prefix}${Array.from(body).slice(0, Math.max(0, budget)).join("").trimEnd()}\n...${closing}`;
}

function hasEchoSignal(
  userFocus: string,
  structuredState: string[],
  currentIntent: string[],
  risks: string[],
  resume: string[],
  readFiles: string[],
  modifiedFiles: string[],
): boolean {
  return (
    !!userFocus ||
    structuredState.length > 0 ||
    currentIntent.length > 0 ||
    risks.length > 0 ||
    resume.length > 0 ||
    readFiles.length > 0 ||
    modifiedFiles.length > 0
  );
}

function detectShrinkSummary(messages: unknown[]): string | null {
  for (const message of messages) {
    if (roleOf(message) !== "compactionSummary") continue;
    const text = extractMessageText(message);
    if (
      text.includes("<resume-state>") ||
      text.includes("<current-intent>") ||
      text.includes("<resume-risks>") ||
      text.includes("<resume-index>") ||
      text.includes("<read-files>") ||
      text.includes("<modified-files>")
    ) {
      return text;
    }
  }
  return null;
}

function hasEcho(messages: unknown[]): boolean {
  return messages.some((message) => extractMessageText(message).includes(ECHO_MARKER));
}

function findLastUserIndex(messages: unknown[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (roleOf(messages[i]) === "user") return i;
  }
  return -1;
}

export function injectFocusEcho(
  messages: unknown[],
): FocusEchoResult | undefined {
  if (hasEcho(messages)) return undefined;
  const summary = detectShrinkSummary(messages);
  if (!summary) return undefined;
  const echoText = buildEcho(summary);
  if (!echoText) return undefined;
  const lastUserIndex = findLastUserIndex(messages);
  if (lastUserIndex < 0) return undefined;

  const echoMessage = {
    role: "user",
    content: [{ type: "text", text: echoText }],
  };
  const next = [...messages];
  next.splice(lastUserIndex, 0, echoMessage);
  return { messages: next, echoText };
}

export const __test__ = {
  ECHO_MARKER,
  buildEcho,
};
