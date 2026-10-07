import { renderRequestCandidate } from "./request-candidate.ts";
import { verificationEvictionIndex, verificationProtection } from "./verification-display.ts";
import { renderCheckpoint, checkpointReadyTasks } from "./checkpoint.ts";
import { scanSections } from "./section-scanner.ts";
import { formatInteger } from "../wire-format.ts";
import { LexicalBudget } from "./lexical-budget.ts";
import { visibleUserIntents } from "./display-projection.ts";
import { resolvedFrontierIntent } from "./conversation-reducer.ts";
import { evaluatePreconditions } from "./observed-readiness.ts";
import type { ObservationSnapshot } from "./types.ts";
import { TARGET_RESUME_SUMMARY_CODE_POINTS, sanitize, sliceU16 } from "./helpers.ts";
import { type ToolCallFingerprint, type ToolResultEntry, type SessionMeta, type ResumeIndex, type ConversationResult } from "./types.ts";
import { conversationEvictionCandidates, hasTerminalNoWorkCompletion, retireHistoricalControls, selectAssistantFrontier } from "./conversation-reducer.ts";
import { buildResumeIndex, buildResumeTasks, buildResumePlan } from "./resume-index.ts";
import { displayPath, choosePathRoot } from "./path-roots.ts";
import { codePointLength } from "../unicode.ts";
import { parseAnyStructuredDistillHandoff, readyDistillHandoffTasks, type ParsedStructuredDistillHandoff, type DistillHandoffTask } from "../handoff.ts";

type RenderedSection = string | number;
/** Shared wire emission: numeric mode counts exactly the same escaped fragments. */
class SectionSink {
  private fragments?: string[];
  private cost = 0;
  private lines = 0;
  constructor(private readonly measure: boolean) {}
  raw(text: string): this {
    if (this.measure) this.cost += codePointLength(text);
    else (this.fragments ??= []).push(text);
    return this;
  }
  escaped(text: string, amp = false): this {
    if (!this.measure) return this.raw((amp ? text.replace(/&/g, "&amp;") : text).replace(/</g, "&lt;").replace(/>/g, "&gt;"));
    this.cost += codePointLength(text);
    for (let index = 0; index < text.length; index++) {
      const unit = text.charCodeAt(index);
      if (unit === 60 || unit === 62) this.cost += 3;
      else if (amp && unit === 38) this.cost += 4;
    }
    return this;
  }
  line(): this { if (this.lines++) this.raw("\n"); return this; }
  value(): RenderedSection { return this.measure ? this.cost : (this.fragments ?? []).join(""); }
}
function markerBlock(name: string, lines: readonly string[], measure = false, amp = false): RenderedSection {
  const sink = new SectionSink(measure);
  let opened = false;
  for (const line of lines) {
    const cleaned = sanitize(line).trim();
    if (!cleaned) continue;
    if (!opened) { sink.line().raw(`<${name}>`); opened = true; }
    sink.line().escaped(cleaned, amp);
  }
  if (opened) sink.line().raw(`</${name}>`);
  return sink.value();
}
function exactLineMarkerBlock(name: string, lines: readonly string[], measure = false): RenderedSection {
  return markerBlock(name, lines, measure, true);
}

export const HANDOFF_BLOCK_CODE_POINTS = 3_072;
export const HANDOFF_FIELD_CODE_POINTS = 512;

interface HandoffField { text: string; limit: number }
interface HandoffRecord {
  category: string;
  fields: HandoffField[];
  render: (fields: string[]) => string;
  task?: DistillHandoffTask;
  owner?: HandoffRecord;
  requirementLimit?: number;
}

/** Count the escaped wire excerpt, retaining complete escape sequences and code points. */
function handoffExcerpt(field: HandoffField): { text: string; shortened: boolean } {
  const source = sanitize(field.text).trim().split(/\s+/).filter(Boolean).join(" ");
  const escaped = source.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (codePointLength(escaped) <= field.limit) return { text: escaped, shortened: false };
  let text = "";
  let length = 0;
  for (const point of source) {
    const atom = point === "<" ? "&lt;" : point === ">" ? "&gt;" : point;
    if (length + codePointLength(atom) > field.limit - 1) break;
    text += atom;
    length += codePointLength(atom);
  }
  return { text: `${text}…`, shortened: true };
}

/** A projection only: source envelopes and full-graph readiness are never mutated. */
export function renderStructuredHandoff(handoff: ParsedStructuredDistillHandoff, snapshot?: ObservationSnapshot): string {
  const all: HandoffRecord[] = [];
  const record = (category: string, values: string[], render: HandoffRecord["render"], task?: DistillHandoffTask) => {
    const item: HandoffRecord = { category, requirementLimit: task && "requires" in task ? (task.requires as string[]).length : undefined, fields: values.map((text) => ({ text, limit: HANDOFF_FIELD_CODE_POINTS })), render, task };
    all.push(item);
    return item;
  };
  const objective = record("objective", [handoff.objective], ([text]) => `objective: ${text}`);
  const strings = (category: string, values: string[]) => values.map((value) =>
    record(category, [value], ([text]) => `${category}:\n- ${text}`));
  const initial = [objective];
  let rest: HandoffRecord[];
  let readyIds = new Set<string>();
  let graphReadyIds = new Set<string>();
  const predicateStates = "version" in handoff && handoff.version === 3 ? evaluatePreconditions(handoff.preconditions, snapshot) : new Map();
  let taskById = new Map<string, DistillHandoffTask>();
  if ("version" in handoff) {
    // Readiness uses the intact graph. Rendering priority uses source order.
    graphReadyIds = new Set(readyDistillHandoffTasks(handoff).map((task) => task.id));
    readyIds = new Set(handoff.tasks.filter((task) => graphReadyIds.has(task.id) && (!("requires" in task) || (task.requires as string[]).every((id) => predicateStates.get(id) === "satisfied"))).map((task) => task.id));
    taskById = new Map(handoff.tasks.map((task): [string, DistillHandoffTask] => [task.id, task]));
    const invariants = strings("invariants", handoff.invariants);
    const tasks = handoff.tasks.map((task) => record("tasks", [task.action],
      ([action]) => `tasks:\n- ${task.id} [${task.status}]: ${action}`, task));
    const blockers = new Map(handoff.tasks.filter((task) => task.blocker).map((task) => {
      const blocker = record("blockers", [task.blocker], ([text]) => `blocker: ${text}; task: ${task.id}`);
      blocker.owner = tasks.find((item) => item.task!.id === task.id)!;
      return [task.id, blocker] as const;
    }));
    const firstTask = tasks.find((item) => readyIds.has(item.task!.id)) ?? tasks.find((item) => item.task!.status !== "done");
    if (invariants[0]) initial.push(invariants[0]);
    if (firstTask) {
      initial.push(firstTask);
      const blocker = blockers.get(firstTask.task!.id);
      if (blocker) initial.push(blocker);
    }
    rest = [
      ...invariants,
      ...tasks.filter((item) => readyIds.has(item.task!.id)),
      ...blockers.values(),
      ...strings("verification-needed", handoff["verification-needed"]),
      ...tasks.filter((item) => item.task!.status !== "done" && !readyIds.has(item.task!.id)),
      ...handoff.decisions.map((item) => record("decisions", [item.text, item.rationale],
        ([text, rationale]) => `decisions:\n- ${item.id}: ${text}; rationale: ${rationale}`)),
      ...handoff["rejected-hypotheses"].map((item) => record("rejected-hypotheses", [item.claim, item.evidence],
        ([claim, evidence]) => `rejected-hypotheses:\n- ${item.id}: ${claim}; evidence: ${evidence}`)),
      ...tasks.filter((item) => item.task!.status === "done"),
    ];
  } else {
    const next = strings("next", handoff.next);
    const blockers = strings("blocker", handoff.blocker);
    if (next[0]) initial.push(next[0]);
    if (blockers[0]) initial.push(blockers[0]);
    rest = [...next, ...blockers, ...strings("verification-needed", handoff["verification-needed"]),
      ...strings("decision", handoff.decision), ...strings("done", handoff.done)];
  }
  const selected = [...initial];
  const render = () => {
    const retained = new Set(selected);
    const retainedIds = new Set(selected.flatMap((item) => item.task ? [item.task.id] : []));
    const omitted = new Map<string, number>();
    for (const item of all) if (!retained.has(item)) omitted.set(item.category, (omitted.get(item.category) ?? 0) + 1);
    let shortened = 0;
    const lines = ["<resume-state>", "provenance: explicit handoff; task state, not verification",
      "projection: partial task state; readiness from intact source graph"];
    if ("version" in handoff) lines.push(`version: ${handoff.version}`);
    for (const item of selected) {
      const fields = item.fields.map(handoffExcerpt);
      shortened += fields.filter((field) => field.shortened).length;
      lines.push(item.render(fields.map((field) => field.text)));
      if (item.task) {
        if ("requires" in item.task) {
          const requirements = item.task.requires as string[];
          // Predicate references are rendered together with their states; no dangling IDs.
          const visible = requirements.slice(0, item.requirementLimit ?? requirements.length);
          if (visible.length) lines.push(`  requires: ${visible.map((id) => `${id}=${predicateStates.get(id) ?? "unknown"}`).join(", ")}`);
          if (visible.length < requirements.length) lines.push(`  omitted requirements: ${requirements.length - visible.length}; readiness from intact predicates`);
        }
        const dependencies = item.task["depends-on"];
        const retainedDependencies = dependencies.filter((id) => retainedIds.has(id));
        const omittedStatuses = new Map<string, number>();
        for (const id of dependencies) if (!retainedIds.has(id)) {
          const status = taskById.get(id)!.status;
          omittedStatuses.set(status, (omittedStatuses.get(status) ?? 0) + 1);
        }
        if (retainedDependencies.length) lines.push(`  depends-on: ${retainedDependencies.join(", ")}`);
        if (omittedStatuses.size) lines.push(`  omitted dependencies: ${[...omittedStatuses].map(([status, count]) => `${status}=${count}`).join(", ")}`);
      }
    }
    const retainedReady = selected.flatMap((item) => item.task && readyIds.has(item.task.id) ? [item.task.id] : []);
    if (retainedReady.length) {
      if ("version" in handoff && handoff.version === 3) lines.push("<ready-tasks>", ...retainedReady.map((id) => `- ${id}`), "</ready-tasks>");
      else lines.push("ready-tasks:", ...retainedReady.map((id) => `- ${id}`));
    }
    const graphReady = selected.flatMap((item) => item.task && graphReadyIds.has(item.task.id) && !readyIds.has(item.task.id) ? [item.task.id] : []);
    if (graphReady.length) lines.push("<graph-ready-tasks>", ...graphReady.map((id) => `- ${id}: requirements unknown or contradicted`), "</graph-ready-tasks>");
    lines.push(`omitted records: ${omitted.size ? [...omitted].map(([category, count]) => `${category}=${count}`).join(", ") : "none"}`,
      `shortened fields: ${shortened}`, "</resume-state>");
    return lines.join("\n");
  };
  // Preserve the initial frontier; reduce its lowest-priority excerpts first if
  // framing, references and omission receipts leave less room than expected.
  for (let index = initial.length - 1; codePointLength(render()) > HANDOFF_BLOCK_CODE_POINTS && index >= 0; index--) {
    for (const field of initial[index].fields.toReversed()) {
      while (field.limit > 1 && codePointLength(render()) > HANDOFF_BLOCK_CODE_POINTS) field.limit--;
    }
  }
  // Long predicate identities are optional complete rows: omit whole references,
  // preserving their count and intact readiness instead of slicing an ID.
  while (codePointLength(render()) > HANDOFF_BLOCK_CODE_POINTS) {
    const item = selected.findLast((record) => (record.requirementLimit ?? 0) > 0);
    if (!item) break;
    item.requirementLimit = item.requirementLimit! - 1;
  }
  for (const item of rest) {
    if (selected.includes(item)) continue;
    // A blocker stays with its owner task even when that task would otherwise
    // appear at the later unresolved-work priority.
    const candidate = [...(item.owner && !selected.includes(item.owner) ? [item.owner] : []), item];
    selected.push(...candidate);
    // A candidate can expand references in previously retained tasks too.
    if (codePointLength(render()) > HANDOFF_BLOCK_CODE_POINTS) selected.splice(selected.length - candidate.length);
  }
  return render();
}

function escapeAngles(line: string): string {
  return sliceU16(line, 512).replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeMarkerText(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatFileMarkers(readFiles: string[], modifiedFiles: string[], omittedReadFiles = 0, omittedModifiedFiles = 0, pathRoot?: string, measure = false): RenderedSection {
  const sink = new SectionSink(measure);
  if (readFiles.length || modifiedFiles.length) {
    for (const line of ["<file-evidence>", "read-files: successful tool-observed access; not proof of current existence", "modified-files: successful tool-reported write; not a Git working-tree receipt", "</file-evidence>"]) sink.line().raw(line);
  }
  for (const [tag, paths, omitted, label] of [["read-files", readFiles, omittedReadFiles, "read"], ["modified-files", modifiedFiles, omittedModifiedFiles, "modified"]] as const) {
    if (!paths.length && !(omitted > 0)) continue;
    sink.line().raw(`<${tag}>`);
    for (const path of paths) sink.line().escaped(sliceU16(displayPath(path, pathRoot), 512));
    if (omitted > 0) sink.line().raw(`... (${omitted} ${label} files omitted)`);
    sink.line().raw(`</${tag}>`);
  }
  return sink.value();
}
function formatRecentToolCalls(calls: ToolCallFingerprint[], measure = false): RenderedSection {
  const sink = new SectionSink(measure);
  if (calls.length) {
    sink.line().raw("<recent-tool-calls>");
    for (const call of calls) sink.line().escaped(sliceU16(`${call.key ? `${call.name}:${call.key}` : call.name}${call.count > 1 ? ` (x${call.count})` : ""}`, 512));
    sink.line().raw("</recent-tool-calls>");
  }
  return sink.value();
}
/** Catalog lines use `- path: signature` so parsePriorMarker round-trips them. */
function formatTypeSignaturesSection(catalog: NonNullable<ConversationResult["typeSignatures"]>, pathRoot: string | undefined, measure = false): RenderedSection {
  const sink = new SectionSink(measure);
  const lines: string[] = [];
  for (const entry of catalog.entries) {
    const path = sliceU16(displayPath(entry.path, pathRoot), 512);
    for (const signature of entry.signatures) lines.push(`- ${path}: ${sliceU16(signature, 512)}`);
  }
  const omissions: string[] = [];
  if (catalog.omittedFiles > 0) omissions.push(`... (${catalog.omittedFiles} catalog files omitted)`);
  if (catalog.omittedSignatures > 0) omissions.push(`... (${catalog.omittedSignatures} signatures omitted)`);
  if (!lines.length && !omissions.length) return sink.value();
  sink.line().raw("<type-signatures>");
  for (const line of lines) sink.line().escaped(line);
  for (const line of omissions) sink.line().raw(line);
  sink.line().raw("</type-signatures>");
  return sink.value();
}
function formatRecentToolResults(results: ToolResultEntry[], measure = false): RenderedSection {
  const sink = new SectionSink(measure);
  if (results.length) {
    sink.line().raw("<recent-tool-results>");
    for (const result of results) {
      const countSuffix = (result.count ?? 1) > 1 ? ` (x${result.count})` : "";
      sink.line().escaped(sliceU16(`${result.toolName}${result.isError ? " [ERROR]" : ""}: ${result.text.replace(/\n/g, " ").split(/\s+/).filter(Boolean).join(" ")}${countSuffix}`, 512));
    }
    sink.line().raw("</recent-tool-results>");
  }
  return sink.value();
}
function formatResumeIndex(index: ResumeIndex, visibleTurns: ConversationResult["turns"], measure = false): RenderedSection {
  const sink = new SectionSink(measure);
  let opened = false;
  for (const [label, values] of [["recent-user-intent", visibleUserIntents(index, visibleTurns)], ["continuation", index.continuationHints], ["recall-queries", index.recallQueries]] as const) {
    if (!values.length) continue;
    if (!opened) { sink.line().raw("<resume-index>"); opened = true; }
    sink.line().raw(`${label}:`);
    for (const value of values) {
      const attributed = label === "recent-user-intent" && !index.recentUserIntents.includes(value);
      sink.line().raw(attributed ? "- [Attributed user context] " : "- ").escaped(sanitize(value).trim().split(/\s+/).filter(Boolean).join(" "));
    }
  }
  if (opened) sink.line().raw("</resume-index>");
  return sink.value();
}

function markerContent(text: string, tag: string): string | undefined {
  const scanned = scanSections(text);
  return scanned.valid ? scanned.sections.get(tag) || undefined : undefined;
}

function latestVerificationState(text: string): string | undefined {
  const verification = markerContent(text, "verification");
  if (!verification) return undefined;
  const latest = new Map<string, string>();
  for (const line of verification.split("\n")) {
    const match = line.match(/^(?:PASS|FAIL|SKIP|BLOCKED|INCOMPLETE)(\s+\[[^\]]+\])?:\s*(.*?)(?:\s+—|$)/);
    if (!match) continue;
    const key = `${match[1] ?? ""}:${match[2]}`;
    latest.delete(key);
    latest.set(key, line);
  }
  return [...latest.values()].join("\n") || undefined;
}

/**
 * Prior dc-distill output is already a structured recovery record. Carry its
 * forward-looking state instead of recursively embedding stale conversation,
 * tool output, and superseded verification receipts on every compaction.
 */

function filterPriorResumeIndex(value: string): string {
  const kept: string[] = [];
  let include = false;
  for (const line of value.split("\n")) {
    if (/^[a-z-]+:$/.test(line.trim())) {
      include = ["recent-user-intent:", "continuation:"].includes(line.trim());
    }
    if (include) kept.push(line);
  }
  return kept.join("\n").trim();
}

function filterPriorResumeTasks(value: string): string {
  return value
    .split("\n")
    .filter((line) => !/^(?:Reread active files|Recall):/.test(line.trim()))
    .join("\n")
    .trim();
}

function summarizePriorState(summary: string): string {
  const parts: string[] = [];
  if (!scanSections(summary).valid) return `Ambiguous prior summary (opaque):\n${escapeMarkerText(sliceU16(summary, 2_000))}`;
  const resumeState = markerContent(summary, "resume-state");
  if (resumeState) parts.push(`<resume-state>\n${escapeMarkerText(resumeState)}\n</resume-state>`);
  const currentIntent = markerContent(summary, "current-intent");
  if (currentIntent) parts.push(`<current-intent>\n${escapeMarkerText(currentIntent)}\n</current-intent>`);
  const userFocus = scanSections(summary).headings.get("User Focus");
  if (userFocus) parts.push(`## User Focus\n${escapeMarkerText(userFocus)}`);
  const verification = latestVerificationState(summary);
  if (verification) parts.push(`<verification>\n${escapeMarkerText(verification)}\n</verification>`);
  for (const tag of [
    "resume-risks",
    "working-tree",
    "resume-tasks",
    "resume-index",
  ] as const) {
    const raw = markerContent(summary, tag);
    const value = tag === "resume-index"
      ? filterPriorResumeIndex(raw ?? "")
      : tag === "resume-tasks"
        ? filterPriorResumeTasks(raw ?? "")
        : raw;
    if (value) parts.push(`<${tag}>\n${escapeMarkerText(value)}\n</${tag}>`);
  }
  if (parts.length === 0) {
    if (markerContent(summary, "retained-context") || readRetainedContext([summary]).length > 0) return "";
    return `Legacy prior summary (opaque):\n${escapeMarkerText(sliceU16(summary, 2_000))}`;
  }
  const budget = 3_800;
  const kept: string[] = [];
  let used = 0;
  for (const part of parts) {
    const size = codePointLength(part) + (kept.length > 0 ? 2 : 0);
    if (used + size > budget) break;
    kept.push(part);
    used += size;
  }
  if (kept.length < parts.length) kept.push(`... (${parts.length - kept.length} prior-state sections omitted)`);
  return kept.join("\n\n");
}

function formatPriorSummaries(summaries: string[], preserveAll = false): string {
  summaries = summaries.filter((summary) => summarizePriorState(summary));
  if (summaries.length === 0) return "";
  if (preserveAll) {
    return `## Prior Summaries\n${summaries
      .map((summary, index) => `[Prior ${index + 1} retained state]\n${summarizePriorState(summary)}`)
      .join("\n\n")}`;
  }
  const state = summarizePriorState(summaries.at(-1) ?? "");
  const omitted = summaries.length - 1;
  const rows = omitted > 0 ? [`... (${omitted} older summaries superseded)`] : [];
  rows.push(`[Prior 1 retained state]\n${state}`);
  return `## Prior Summaries\n${rows.join("\n\n")}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

type ContextExcerpt = NonNullable<ConversationResult["retainedContext"]>[number];
const CONTEXT_PROVENANCE = "provenance: source excerpts; prior outcomes are source reports, not fresh verification or current task state";

type MarkdownFence = { character: string; length: number };

function nextMarkdownFence(line: string, fence: MarkdownFence | undefined): MarkdownFence | undefined {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!match) return fence;
  const run = match[1];
  if (fence) {
    return run[0] === fence.character && run.length >= fence.length && /^\s*$/.test(match[2])
      ? undefined : fence;
  }
  // Backtick fence info strings cannot themselves contain a backtick.
  if (run[0] === "`" && match[2].includes("`")) return undefined;
  return { character: run[0], length: run.length };
}

function retainedEnvelope(summary: string): string | null | undefined {
  const scanned = scanSections(summary);
  return scanned.valid ? scanned.sections.get("retained-context") : null;
}

function contextTurnIndexes(conv: ConversationResult): Map<number, ContextExcerpt["kind"]> {
  const frontier = selectAssistantFrontier(conv.turns);
  const selected = new Map<number, ContextExcerpt["kind"]>();
  conv.turns.forEach((turn, index) => {
    if (index === frontier.completion) selected.set(index, "outcome");
    else if (conv.terminalComplete && index === frontier.latestReply) selected.set(index, "context");
    else if (index === frontier.proposal) selected.set(index, "proposal");
    else if (index < frontier.latestUser && /^#{1,6}\s/m.test(turn.text) &&
      /^(?:\d+[.)]|[-*])\s/m.test(turn.text)) selected.set(index, "context");
  });
  return selected;
}

function distinctContext(excerpts: ContextExcerpt[]): ContextExcerpt[] {
  const seen = new Set<string>();
  return excerpts.filter((excerpt) => {
    const key = `${excerpt.role}\n${excerpt.kind}\n${excerpt.text}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

/** Canonical excerpts are carried verbatim, never summarized recursively. */
export function readRetainedContext(summaries: string[]): ContextExcerpt[] {
  const excerpts: ContextExcerpt[] = [];
  for (const summary of summaries) {
    const retained = retainedEnvelope(summary);
    if (retained !== undefined) {
      if (!retained?.startsWith(`version: 1\n${CONTEXT_PROVENANCE}\n`)) continue;
      const records = retained.slice(`version: 1\n${CONTEXT_PROVENANCE}\n`.length);
      const pattern = /<context-excerpt role="(user|assistant)" kind="(outcome|proposal|context)">\n([^<]*?)\n<\/context-excerpt>(?:\n|$)/gy;
      const parsed: ContextExcerpt[] = [];
      let consumed = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(records))) {
        const text = match[3].replace(/^\[(?:Assistant|User)\] \[(?:Prior outcome|Referenced proposal|Historical context)\] /, "")
          .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
        parsed.push({ role: match[1] as ContextExcerpt["role"], kind: match[2] as ContextExcerpt["kind"], text });
        consumed = pattern.lastIndex;
      }
      if (consumed === records.length) excerpts.push(...parsed);
      continue;
    }
    // Legacy generated Conversation records: scan the whole section, not an
    // opaque prefix. Only recognized outcome/proposal/structured context moves.
    const conversation = scanSections(summary).headings.get("Conversation");
    if (!conversation) continue;
    const turns: ConversationResult["turns"] = [];
    const visibleTurns: ConversationResult["turns"] = [];
    let fence: MarkdownFence | undefined;
    for (const line of conversation.split("\n")) {
      const record = !fence && line.match(/^\[(User|Assistant)\]\s+(?:\[(?:Current outcome|Historical context)\]\s*)?(.*)$/);
      const nextFence = nextMarkdownFence(record ? record[2] : line, fence);
      if (record) {
        const role = record[1].toLowerCase() as "user" | "assistant";
        turns.push({ role, text: record[2] });
        visibleTurns.push({ role, text: nextFence ? "" : record[2] });
      } else if (turns.length) {
        turns.at(-1)!.text += `\n${line}`;
        if (!fence && !nextFence && !/^ {0,3}>/.test(line)) visibleTurns.at(-1)!.text += `\n${line}`;
      }
      fence = nextFence;
    }
    // Classification uses only prose outside examples; retained source bytes
    // still include the complete original turn, including any fenced examples.
    const legacy = { turns: visibleTurns, terminalComplete: hasTerminalNoWorkCompletion(visibleTurns) } as ConversationResult;
    for (const [index, kind] of contextTurnIndexes(legacy)) excerpts.push({ role: turns[index].role, kind, text: turns[index].text.trim() });
  }
  return distinctContext(excerpts);
}

function formatRetainedContext(conv: ConversationResult, measure = false): RenderedSection {
  const current = [...contextTurnIndexes(conv)].map(([index, kind]) => ({ role: conv.turns[index].role, kind, text: conv.turns[index].displayText ?? conv.turns[index].text }));
  const excerpts = distinctContext([...(conv.retainedContext ?? []), ...current]);
  const sink = new SectionSink(measure);
  if (excerpts.length) {
    sink.line().raw("<retained-context>").line().raw("version: 1").line().raw(CONTEXT_PROVENANCE);
    for (const excerpt of excerpts) sink.line().raw(`<context-excerpt role="${excerpt.role}" kind="${excerpt.kind}">\n[${excerpt.role === "assistant" ? "Assistant" : "User"}] [${excerpt.kind === "outcome" ? "Prior outcome" : "Historical context"}] `).escaped(excerpt.text, true).raw("\n</context-excerpt>");
    sink.line().raw("</retained-context>");
  }
  return sink.value();
}

export interface SummaryProjection {
  structured: ParsedStructuredDistillHandoff | null;
  handoffBlock: string;
  measureOnly?: boolean;
  renderedCost?: number;
}
export function prepareSummaryProjection(meta: SessionMeta, conv: ConversationResult): SummaryProjection {
  const handoff = meta.handoff?.trim();
  const checkpoint = conv.checkpoint;
  const attributed = handoff ? parseAnyStructuredDistillHandoff(handoff) : undefined;
  const structured: ParsedStructuredDistillHandoff | null = checkpoint && (checkpoint.objective || checkpoint.tasks.length) ? {
    version: 3, objective: checkpoint.objective, tasks: checkpoint.tasks, invariants: checkpoint.constraints, decisions: checkpoint.decisions,
    preconditions: checkpoint.preconditions, "rejected-hypotheses": attributed && "tasks" in attributed ? attributed["rejected-hypotheses"] : [], "verification-needed": attributed?.["verification-needed"] ?? [],
  } : handoff ? parseAnyStructuredDistillHandoff(handoff) ?? null : null;
  return { structured, handoffBlock: structured ? renderStructuredHandoff(structured, conv.observationSnapshot) : handoff ? `<current-intent>\n${escapeAngles(handoff)}\n</current-intent>` : "" };
}
/** Fixed first line of every compiled summary: it describes only the discarded
 * prefix, and the retained tail carries newer state. Static by design — no
 * timestamp, so identical input keeps producing byte-identical summaries. */
const SUMMARY_SCOPE_NOTE = "This summary covers only the entries Pi discarded at compaction; newer state lives in the retained messages that follow it in context.";

/** Late request-candidate block. Stable sections render ahead of this
 * per-request churn so a provider prefix cache can survive past them across
 * successive compactions; pinned by lib/cache-stability.test.ts. */
function renderCandidateSection(meta: SessionMeta, conv: ConversationResult, measure: boolean): RenderedSection {
  if (!conv.requestCandidate) return "";
  const candidate = renderRequestCandidate(conv.requestCandidate);
  const text = (!conv.checkpoint?.objective && !meta.goalObjective)
    ? `${candidate}\n\nNo declared objective; attributed request is context only.`
    : candidate;
  return measure ? codePointLength(text) : text;
}

export function formatSummary(meta: SessionMeta, conv: ConversationResult, userFocus?: string, projection?: SummaryProjection): string {
  const parts: RenderedSection[] = [];
  const measure = projection?.measureOnly ?? false;
  parts.push(measure ? codePointLength(SUMMARY_SCOPE_NOTE) : SUMMARY_SCOPE_NOTE, "");
  if (conv.checkpoint) { const text = renderCheckpoint(conv.checkpoint); if (text) parts.push(measure ? codePointLength(text) : text, ""); }
  const { structured, handoffBlock } = projection ?? prepareSummaryProjection(meta, conv);
  const metaSink = new SectionSink(measure);
  if (meta.id || meta.cwd || meta.model || meta.timestamp) {
    metaSink.line().raw("## Session");
    for (const [label, value] of [["Session ID", meta.id], ["CWD", meta.cwd], ["Model", meta.model], ["Started", meta.timestamp]] as const) if (value) metaSink.line().raw(`${label}: `).escaped(value);
    parts.push(metaSink.value(), "");
  }
  if (conv.pathRoot) parts.push(new SectionSink(measure).raw("<path-root>").escaped(conv.pathRoot).raw("</path-root>").value(), "");
  if (meta.goalStatus || meta.goalObjective) {
    const sink = new SectionSink(measure).line().raw("<goal-state>");
    if (meta.goalStatus) sink.line().raw("Status: ").escaped(meta.goalStatus);
    if (meta.goalObjective) sink.line().raw("Objective: ").escaped(meta.goalObjective);
    parts.push(sink.line().raw("</goal-state>").value(), "");
  }
  if (userFocus?.trim()) parts.push(new SectionSink(measure).raw("## User Focus\n").escaped(sliceU16(userFocus.trim(), 2_048)).value(), "");
  const prior = (!meta.priorSummaries.length || conv.terminalComplete || hasTerminalNoWorkCompletion(conv.turns)) ? "" : (() => {
    const text = formatPriorSummaries(meta.priorSummaries, conv.turns.length === 0);
    return measure ? codePointLength(text) : text;
  })();
  if (prior) parts.push(prior, "");
  parts.push((() => {
    const sink = new SectionSink(measure);
    sink.raw("## Conversation");
    if (conv.turns.length) {
      sink.raw("\n");
      const frontier = selectAssistantFrontier(conv.turns);
      const contextIndexes = contextTurnIndexes(conv);
      let first = true;
      for (let index = 0; index < conv.turns.length; index++) {
        if (contextIndexes.has(index)) continue;
        const turn = conv.turns[index];
        const label = turn.role === "user" && turn.origin === "custom" ? `Context${turn.customType ? `: ${turn.customType}` : ""}` : turn.role[0].toUpperCase() + turn.role.slice(1);
        const context = turn.role !== "assistant" ? "" : index === frontier.completion ? "[Current outcome] " : index < frontier.latestUser ? "[Historical context] " : "";
        if (!first) sink.raw("\n");
        first = false;
        sink.raw("[").escaped(label).raw(`] ${context}`).escaped(turn.displayText ?? turn.text);
      }
    }
    return sink.value();
  })());
  for (const block of [
    formatRetainedContext(conv, measure),
    formatFileMarkers(
      conv.readFiles,
      conv.modifiedFiles,
      conv.omittedReadFiles,
      conv.omittedModifiedFiles,
      conv.pathRoot, measure,
    ),
    formatRecentToolCalls(conv.recentToolCalls, measure),
    formatRecentToolResults(conv.recentToolResults, measure),
    markerBlock("working-tree", conv.workingTree, measure),
    markerBlock("source-anchors", conv.sourceAnchors, measure),
    markerBlock("active-tasks", conv.activeTasks, measure),
    markerBlock("literal-anchors", conv.literalAnchors, measure),
    (() => {
      const contexts = contextTurnIndexes(conv);
      return formatResumeIndex(conv.resumeIndex, conv.turns.filter((_, index) => !contexts.has(index)), measure);
    })(),
    meta.id ? new SectionSink(measure)
      .raw("<full-session-recovery>\nFull transcript: `ctxgo show session --provider pi --provider-session ").escaped(shellQuote(meta.id!))
      .raw("`\nSource JSONL: `ctxgo locate session --provider pi --provider-session ").escaped(shellQuote(meta.id!))
      .raw("`\n</full-session-recovery>").value() : "",
    markerBlock("summary-omissions", conv.budgetOmissions, measure),
    exactLineMarkerBlock("change-impact", conv.changeImpact ?? [], measure),
    exactLineMarkerBlock("verification", conv.verification, measure),
    conv.typeSignatures ? formatTypeSignaturesSection(conv.typeSignatures!, conv.pathRoot, measure) : "",
    renderCandidateSection(meta, conv, measure),
    measure ? codePointLength(handoffBlock) : handoffBlock,
    markerBlock("resume-risks", conv.resumeRisks, measure),
    exactLineMarkerBlock("resume-tasks", filterGeneratedTasks(conv.resumeTasks, structured), measure),
  ]) {
    if (block) parts.push("", block);
  }
  if (projection?.measureOnly) {
    let total = Math.max(0, parts.length - 1);
    for (const part of parts) total += typeof part === "number" ? part : codePointLength(part);
    projection.renderedCost = total;
    return "";
  }
  return parts.join("\n");
}

export function enforceOperatingBudget(
  meta: SessionMeta,
  conv: ConversationResult,
  userFocus?: string,
  recallEnabled = true,
): void {
  if (arguments.length > 4) throw new TypeError("enforceOperatingBudget no longer accepts a selector argument");
  conv.lexical ??= new LexicalBudget();
  conv.terminalComplete ??= hasTerminalNoWorkCompletion(conv.turns);
  conv.resumePlan ??= buildResumePlan({ ...conv, terminalComplete: conv.terminalComplete });
  const omitted = new Map<string, number>();
  const note = (label: string) => omitted.set(label, (omitted.get(label) ?? 0) + 1);
  const originalIntents = conv.resumeIndex.displayIntents ?? conv.resumeIndex.recentUserIntents;
  const originalOccurrences = conv.resumeIndex.intentOccurrences;
  const refreshResume = () => {
    conv.resumeIndex = buildResumeIndex(
      conv.turns,
      conv.readFiles,
      conv.modifiedFiles,
      conv.recentToolCalls,
      conv.lexical,
    );
    // A hidden duplicate must become visible again if its conversation row goes.
    conv.resumeIndex.displayIntents = originalIntents;
    conv.resumeIndex.intentOccurrences = originalOccurrences;
    if (conv.checkpoint) {
      conv.resumeIndex.checkpoint = conv.checkpoint;
      conv.resumeIndex.activeFiles = [...new Set([...conv.checkpoint.files.modified, ...conv.checkpoint.files.read])].slice(-50);
      const pinnedRequests = conv.checkpoint.pins.filter(pin => pin.status === "active" && pin.purpose === "request").map(pin => pin.text);
      if (pinnedRequests.length) {
        conv.resumeIndex.recentUserIntents = pinnedRequests;
        conv.resumeIndex.intentOccurrences = undefined;
        conv.resumeIndex.displayIntents = undefined;
      }
      if (conv.checkpoint.tasks.length) conv.resumeIndex.continuationHints = conv.checkpoint.tasks.filter(task => task.status !== "done").map(task => task.action);
    }
    if (conv.terminalComplete && !conv.checkpoint?.tasks.length && !conv.checkpoint?.pins.some(pin => pin.status === "active")) {
      conv.resumeIndex.activeFiles = [];
      conv.resumeIndex.recentUserIntents = [];
      conv.resumeIndex.displayIntents = [];
      conv.resumeIndex.continuationHints = [];
    }
    if (!recallEnabled) conv.resumeIndex.recallQueries = [];
    conv.pathRoot = choosePathRoot(
      [...conv.readFiles, ...conv.modifiedFiles, ...conv.resumeIndex.activeFiles],
      meta.cwd,
    );
    conv.resumeTasks = conv.checkpoint?.tasks.length ? checkpointReadyTasks(conv.checkpoint).map(id => { const task = conv.checkpoint!.tasks.find(t => t.id === id)!; return `${id}: ${task.action}`; }) : buildResumeTasks({
      resumePlan: conv.resumePlan,
      recentToolCalls: conv.recentToolCalls,
      verification: conv.verification,
      workingTree: conv.workingTree,
      sourceAnchors: conv.sourceAnchors,
      activeTasks: conv.activeTasks,
      resumeIndex: conv.resumeIndex,
      pathRoot: conv.pathRoot,
      recallEnabled,
      terminalComplete: conv.terminalComplete,
    });
  };
  refreshResume();
  // Reserve room for the omission receipt, separator and optional recall note.
  const target = TARGET_RESUME_SUMMARY_CODE_POINTS - 1_024;
  const measureCurrent = () => {
    // Evictions mutate arrays in place; each state gets a fresh projection.
    const projection = prepareSummaryProjection(meta, conv);
    projection.measureOnly = true;
    formatSummary(meta, conv, userFocus, projection);
    return projection.renderedCost!;
  };
  let renderedCost = measureCurrent();
  const isProtectedVerification = verificationProtection(conv.checkpoint);
  const staleVerificationIndex = () => conv.verification.findIndex(line => !isProtectedVerification(line)
    && line.startsWith("PASS ") && line.includes("[freshness: not established"));
  let guard = 0;
  while (renderedCost > target && guard++ < 1_000) {
    if (conv.recentToolResults.length > 0 && conv.recentToolResults.some((result) => !result.artifactReceipt)) {
      const removable = conv.recentToolResults.findIndex((result) => !result.artifactReceipt);
      conv.recentToolResults.splice(removable, 1);
      note("recent tool results");
    } else if (conv.sourceAnchors.length > 0) {
      conv.sourceAnchors.shift();
      note("source anchors");
    } else if (conv.literalAnchors.length > 0) {
      conv.literalAnchors.shift();
      note("literal anchors");
    } else if (conv.recentToolCalls.length > 0) {
      conv.recentToolCalls.shift();
      note("recent tool calls");
    } else if (staleVerificationIndex() >= 0) {
      const stale = staleVerificationIndex();
      conv.verification.splice(stale, 1);
      note("stale verification receipts");
    } else if (conv.workingTree.length > 0) {
      conv.workingTree.shift();
      note("working-tree receipts");
    } else if (conv.activeTasks.length > 0) {
      conv.activeTasks.shift();
      note("active tasks");
    } else if (conv.typeSignatures && conv.typeSignatures.entries.length > 0) {
      // Entries are sorted by descending retention priority (modified before
      // read before carried, newest first), so the tail is always the lowest-
      // priority complete record. Catalogs are rebuilt from paired results
      // each compaction; a dropped entry is recoverable evidence, not state.
      const dropped = conv.typeSignatures.entries.at(-1)!;
      conv.typeSignatures = { ...conv.typeSignatures, entries: conv.typeSignatures.entries.slice(0, -1), omittedFiles: conv.typeSignatures.omittedFiles + 1, omittedSignatures: conv.typeSignatures.omittedSignatures + dropped.signatures.length };
      note("type-signature files");
    } else if (conv.readFiles.length > 0) {
      conv.readFiles.shift();
      conv.omittedReadFiles += 1;
    } else if (conv.modifiedFiles.length > 0) {
      conv.modifiedFiles.shift();
      conv.omittedModifiedFiles += 1;
    } else if (conv.verification.length > 1 && verificationEvictionIndex(conv.verification, conv.checkpoint) >= 0) {
      conv.verification.splice(verificationEvictionIndex(conv.verification, conv.checkpoint), 1);
      note("verification receipts");
    } else if (conv.turns.length > 1) {
      const frontierQuery = userFocus?.trim() || meta.handoff?.trim() || undefined;
      const candidates = conversationEvictionCandidates(conv.turns, frontierQuery, conv.lexical);
      if (candidates.length > 0) {
        conv.turns.splice(candidates[0].index, 1);
        note("conversation turns");
      } else {
        if (!evictRetainedContext(conv) && !evictRequestCandidate(conv)) break;
        note("retained context excerpts");
      }
    } else {
      if (!evictRetainedContext(conv) && !evictRequestCandidate(conv)) break;
      note("retained context excerpts");
    }
    refreshResume();
    renderedCost = measureCurrent();
  }
  const omissions = [...omitted.entries()].map(([label, count]) =>
    `${count} ${label} omitted for the ${formatInteger(TARGET_RESUME_SUMMARY_CODE_POINTS)}-code-point operating target`);
  if (renderedCost > target) {
    omissions.push("protected-content overflow; operating target exceeded");
  }
  if (conv.lexical.incomplete) omissions.push("optional lexical indexing incomplete: operation budget exhausted");
  conv.budgetOmissions = omissions;
  // Retire controls only after selection: savings must not re-admit old scaffolding.
  // The next rendering is the canonical summary used by metrics and hashing.
  retireHistoricalControls(conv.turns, conv.terminalComplete);
}

function evictRequestCandidate(conv: ConversationResult): boolean {
  if (!conv.requestCandidate) return false;
  if (conv.requestCandidate.proposal) conv.requestCandidate = { ...conv.requestCandidate, proposal: undefined };
  else conv.requestCandidate = undefined;
  return true;
}

function evictRetainedContext(conv: ConversationResult): boolean {
  const excerpts = conv.retainedContext ?? [];
  const newestOutcome = excerpts.findLastIndex((excerpt) => excerpt.kind === "outcome");
  const newestProposal = excerpts.findLastIndex((excerpt) => excerpt.kind === "proposal");
  const index = excerpts.findIndex((_, i) => i !== newestOutcome && i !== newestProposal);
  if (index < 0) return false;
  excerpts.splice(index, 1); return true;
}

/** Suppress only an exact explicitly named structured task ID, never similar prose. */
export function filterGeneratedTasks(tasks: readonly string[], handoff: ParsedStructuredDistillHandoff | null | undefined): string[] {
  if (!handoff || !("version" in handoff)) return [...tasks];
  const ids = new Set(handoff.tasks.map((task) => task.id));
  return [...new Set(tasks)].filter((line) => {
    const references = [...line.matchAll(/\b(?:taskId|task_id|task-id|task)\s*(?:[:=]\s*|\s+)["'`]?([A-Za-z][A-Za-z0-9._-]*)(?![A-Za-z0-9._-])["'`]?(?=$|[\s,;:)])/g)].map((match) => match[1]);
    return !references.some((id) => ids.has(id));
  });
}
