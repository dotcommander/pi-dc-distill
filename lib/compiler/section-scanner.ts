/** Bounded structural recognition; example text never opens a control section. */
export interface ScannedSections { valid: boolean; sections: Map<string, string>; headings: Map<string, string> }
const known = new Set(["read-files", "modified-files", "resume-state", "current-intent", "verification", "resume-risks", "working-tree", "resume-tasks", "resume-index", "retained-context", "goal-state", "path-root", "file-evidence", "literal-anchors", "active-tasks", "source-anchors", "recent-tool-calls", "recent-tool-results", "budget-omissions", "summary-omissions", "change-impact", "checkpoint-v1", "ready-tasks", "graph-ready-tasks", "task-state", "full-session-recovery"]);
export function outsideExampleLines(lines: readonly string[]): boolean[] {
  let fence: { char: string; size: number } | undefined;
  return lines.map(line => {
    if (/^\s*>/.test(line)) return false;
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) { if (marker[1][0] !== "`" || !marker[2].includes("`")) fence = { char: marker[1][0], size: marker[1].length }; }
      else if (marker[1][0] === fence.char && marker[1].length >= fence.size && !marker[2].trim()) fence = undefined;
      return false;
    }
    return !fence && !/^(?: {4}|\t)/.test(line);
  });
}
const cache = new Map<string, ScannedSections>();
export function scanSections(text: string): ScannedSections {
  const cached = cache.get(text); if (cached) return cached;
  const result: ScannedSections = { valid: true, sections: new Map(), headings: new Map() };
  if (text.length > 262_144) { result.valid = false; return result; }
  const lines = text.split("\n"), outside = outsideExampleLines(lines);
  const stack: Array<{tag: string; start: number}> = [];
  const seen = new Set<string>();
  let heading: {name: string; start: number} | undefined;
  const closeHeading = (end: number) => { if (heading) result.headings.set(heading.name, lines.slice(heading.start, end).join("\n").trim()); heading = undefined; };
  for (let i = 0; i < lines.length; i++) {
    if (!outside[i]) continue;
    const inline = /^<([a-z][a-z0-9-]*)>([^<]*)<\/\1>$/.exec(lines[i]);
    if (inline && known.has(inline[1])) {
      closeHeading(i);
      if (seen.has(inline[1])) { result.valid = false; break; }
      seen.add(inline[1]); result.sections.set(inline[1], inline[2].trim()); continue;
    }
    const token = /^<\/?([a-z][a-z0-9-]*)(?:\s+[^<>]*)?>$/.exec(lines[i]);
    if (!token) {
      const malformed = /^<\/?([a-z][a-z0-9-]*)(?:>|\s)/.exec(lines[i]);
      if (malformed && known.has(malformed[1])) { result.valid = false; break; }
    }
    if (token && (known.has(token[1]) || token[1] === "context-excerpt")) {
      closeHeading(i);
      const tag = token[1], closing = lines[i].startsWith("</");
      if (!closing) {
        if (tag !== "context-excerpt" && seen.has(tag)) { result.valid = false; break; }
        seen.add(tag); stack.push({ tag, start: i + 1 });
      } else {
        const opened = stack.pop();
        if (!opened || opened.tag !== tag) { result.valid = false; break; }
        if (tag !== "context-excerpt") result.sections.set(tag, lines.slice(opened.start, i).join("\n").trim());
      }
      continue;
    }
    if (!stack.length) {
      const match = /^## (Session|User Focus|Prior Summaries|Conversation)$/.exec(lines[i]);
      if (match) { closeHeading(i); if (result.headings.has(match[1])) { result.valid = false; break; } heading = { name: match[1], start: i + 1 }; }
      else if (/^## |^---$/.test(lines[i])) closeHeading(i);
    }
  }
  closeHeading(lines.length);
  if (stack.length) result.valid = false;
  if (!result.valid) { result.sections.clear(); result.headings.clear(); }
  if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  cache.set(text, result); return result;
}
