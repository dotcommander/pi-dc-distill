import { TARGET_RESUME_SUMMARY_CODE_POINTS, sanitize, sliceU16 } from "./helpers.ts";
import { type ToolCallFingerprint, type ToolResultEntry, type SessionMeta, type ResumeIndex, type ConversationResult } from "./types.ts";
import { conversationEvictionCandidates, hasTerminalNoWorkCompletion } from "./conversation-reducer.ts";
import { buildResumeIndex, buildResumeTasks } from "./resume-index.ts";
import { displayPath, choosePathRoot } from "./path-roots.ts";
import { codePointLength } from "../unicode.ts";
import { parseAnyStructuredDistillHandoff, readyDistillHandoffTasks, type StructuredDistillHandoff, type StructuredDistillHandoffV2 } from "../handoff.ts";

function escapeResumeLine(line: string): string {
  return sanitize(line).trim().split(/\s+/).filter(Boolean).join(" ").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function markerBlock(name: string, lines: string[]): string {
  const escaped = lines.map((line) => sanitize(line).trim().replace(/</g, "&lt;").replace(/>/g, "&gt;")).filter(Boolean);
  return escaped.length > 0 ? [`<${name}>`, ...escaped, `</${name}>`].join("\n") : "";
}

// Verification identity is exact runner, command bytes: emit lines verbatim
// after sanitize() (ANSI/control-char stripping) and outer trim only.

function exactLineMarkerBlock(name: string, lines: string[]): string {
  const escaped = lines.map((line) => sanitize(line).trim()).filter(Boolean);
  return escaped.length > 0 ? [`<${name}>`, ...escaped, `</${name}>`].join("\n") : "";
}

function renderStructuredHandoff(handoff: StructuredDistillHandoff): string {
  const lines = [
    "<resume-state>",
    "provenance: explicit handoff; task state, not verification",
    `objective: ${escapeResumeLine(handoff.objective)}`,
  ];
  for (const key of ["done", "next", "blocker", "decision", "verification-needed"] as const) {
    const items = handoff[key];
    if (items.length === 0) continue;
    lines.push(`${key}:`, ...items.map((item) => `- ${escapeResumeLine(item)}`));
  }
  lines.push("</resume-state>");
  return lines.join("\n");
}

function renderStructuredHandoffV2(handoff: StructuredDistillHandoffV2): string {
  const lines = [
    "<resume-state>",
    "provenance: explicit handoff; task state, not verification",
    "version: 2",
    `objective: ${escapeResumeLine(handoff.objective)}`,
  ];
  const renderStrings = (name: string, values: string[]) => {
    if (values.length > 0) lines.push(`${name}:`, ...values.map((value) => `- ${escapeResumeLine(value)}`));
  };
  renderStrings("invariants", handoff.invariants);
  if (handoff.decisions.length > 0) {
    lines.push("decisions:", ...handoff.decisions.map((decision) =>
      `- ${decision.id}: ${escapeResumeLine(decision.text)}; rationale: ${escapeResumeLine(decision.rationale)}`));
  }
  if (handoff["rejected-hypotheses"].length > 0) {
    lines.push("rejected-hypotheses:", ...handoff["rejected-hypotheses"].map((hypothesis) =>
      `- ${hypothesis.id}: ${escapeResumeLine(hypothesis.claim)}; evidence: ${escapeResumeLine(hypothesis.evidence)}`));
  }
  if (handoff.tasks.length > 0) {
    lines.push("tasks:", ...handoff.tasks.flatMap((task) => {
      const taskLines = [`- ${task.id} [${task.status}]: ${escapeResumeLine(task.action)}`];
      if (task["depends-on"].length > 0) taskLines.push(`  depends-on: ${task["depends-on"].join(", ")}`);
      if (task.blocker) taskLines.push(`  blocker: ${escapeResumeLine(task.blocker)}`);
      return taskLines;
    }));
  }
  const ready = readyDistillHandoffTasks(handoff);
  if (ready.length > 0) {
    lines.push("ready-tasks:", ...ready.map((task) => `- ${task.id}: ${escapeResumeLine(task.action)}`));
  }
  renderStrings("verification-needed", handoff["verification-needed"]);
  lines.push("</resume-state>");
  return lines.join("\n");
}

function escapeAngles(line: string): string {
  return sliceU16(line, 512).replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeMarkerText(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatFileMarkers(
  readFiles: string[],
  modifiedFiles: string[],
  omittedReadFiles = 0,
  omittedModifiedFiles = 0,
  pathRoot?: string,
): string {
  const parts: string[] = [];
  if (readFiles.length > 0 || modifiedFiles.length > 0) {
    parts.push(
      "<file-evidence>",
      "read-files: successful tool-observed access; not proof of current existence",
      "modified-files: successful tool-reported write; not a Git working-tree receipt",
      "</file-evidence>",
    );
  }
  if (readFiles.length > 0 || omittedReadFiles > 0) {
    parts.push("<read-files>", ...readFiles.map((path) => escapeAngles(displayPath(path, pathRoot))));
    if (omittedReadFiles > 0) parts.push(`... (${omittedReadFiles} read files omitted)`);
    parts.push("</read-files>");
  }
  if (modifiedFiles.length > 0 || omittedModifiedFiles > 0) {
    parts.push("<modified-files>", ...modifiedFiles.map((path) => escapeAngles(displayPath(path, pathRoot))));
    if (omittedModifiedFiles > 0) parts.push(`... (${omittedModifiedFiles} modified files omitted)`);
    parts.push("</modified-files>");
  }
  return parts.join("\n");
}

function formatRecentToolCalls(calls: ToolCallFingerprint[]): string {
  if (calls.length === 0) return "";
  return [
    "<recent-tool-calls>",
    ...calls.map((call) => escapeAngles(`${call.key ? `${call.name}:${call.key}` : call.name}${call.count > 1 ? ` (x${call.count})` : ""}`)),
    "</recent-tool-calls>",
  ].join("\n");
}

function formatRecentToolResults(results: ToolResultEntry[]): string {
  if (results.length === 0) return "";
  return [
    "<recent-tool-results>",
    ...results.map((result) => {
      const countSuffix = (result.count ?? 1) > 1 ? ` (x${result.count})` : "";
      return escapeAngles(`${result.toolName}${result.isError ? " [ERROR]" : ""}: ${result.text.replace(/\n/g, " ").split(/\s+/).filter(Boolean).join(" ")}${countSuffix}`);
    }),
    "</recent-tool-results>",
  ].join("\n");
}

function formatResumeIndex(index: ResumeIndex): string {
  const lines = ["<resume-index>"];
  for (const [label, values] of [
    ["recent-user-intent", index.recentUserIntents],
    ["continuation", index.continuationHints],
    ["recall-queries", index.recallQueries],
  ] as const) {
    if (values.length === 0) continue;
    lines.push(`${label}:`, ...values.map((value) => `- ${escapeResumeLine(value)}`));
  }
  if (lines.length === 1) return "";
  lines.push("</resume-index>");
  return lines.join("\n");
}

function markerContent(text: string, tag: string): string | undefined {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = text.indexOf(open);
  if (start < 0) return undefined;
  const end = text.indexOf(close, start + open.length);
  if (end < 0) return undefined;
  return text.slice(start + open.length, end).trim() || undefined;
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
  const resumeState = markerContent(summary, "resume-state");
  if (resumeState) parts.push(`<resume-state>\n${escapeMarkerText(resumeState)}\n</resume-state>`);
  const currentIntent = markerContent(summary, "current-intent");
  if (currentIntent) parts.push(`<current-intent>\n${escapeMarkerText(currentIntent)}\n</current-intent>`);
  const userFocus = summary.match(/^## User Focus\n([\s\S]*?)(?=\n## |\n<|$)/m)?.[1]?.trim();
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

export function formatSummary(meta: SessionMeta, conv: ConversationResult, userFocus?: string): string {
  const parts: string[] = [];
  // Agent-authored handoff leads the summary: it is the freshest forward-looking
  // intent and the highest-value recovery signal. XML-marker style matches the
  // other activity blocks. Absent → no part pushed → byte-identical output.
  const handoff = meta.handoff?.trim();
  if (handoff) {
    const structured = parseAnyStructuredDistillHandoff(handoff);
    parts.push(
      structured
        ? "version" in structured
          ? renderStructuredHandoffV2(structured)
          : renderStructuredHandoff(structured)
        : `<current-intent>\n${escapeAngles(handoff)}\n</current-intent>`,
      "",
    );
  }
  if (meta.goalStatus || meta.goalObjective) {
    const goalLines = [
      meta.goalStatus ? `Status: ${escapeMarkerText(meta.goalStatus)}` : "",
      meta.goalObjective ? `Objective: ${escapeMarkerText(meta.goalObjective)}` : "",
    ].filter(Boolean);
    parts.push(`<goal-state>\n${goalLines.join("\n")}\n</goal-state>`, "");
  }
  const metaLines = [
    meta.id ? `Session ID: ${escapeMarkerText(meta.id)}` : "",
    meta.cwd ? `CWD: ${meta.cwd}` : "",
    meta.model ? `Model: ${meta.model}` : "",
    meta.timestamp ? `Started: ${meta.timestamp}` : "",
  ].filter(Boolean);
  if (metaLines.length > 0) parts.push(`## Session\n${metaLines.join("\n")}`, "");
  if (conv.pathRoot) {
    parts.push(`<path-root>${escapeMarkerText(conv.pathRoot)}</path-root>`, "");
  }
  const prior = hasTerminalNoWorkCompletion(conv.turns)
    ? ""
    : formatPriorSummaries(meta.priorSummaries, conv.turns.length === 0);
  if (prior) parts.push(prior, "");
  if (userFocus?.trim()) parts.push(`## User Focus\n${escapeMarkerText(sliceU16(userFocus.trim(), 2_048))}`, "");
  parts.push(
    conv.turns.length > 0
      ? `## Conversation\n${conv.turns.map((turn) => {
        const label = turn.role === "user" && turn.origin === "custom"
          ? `Context${turn.customType ? `: ${turn.customType}` : ""}`
          : turn.role[0].toUpperCase() + turn.role.slice(1);
        return `[${label}] ${turn.text}`;
      }).join("\n")}`
      : "## Conversation",
  );
  for (const block of [
    formatFileMarkers(
      conv.readFiles,
      conv.modifiedFiles,
      conv.omittedReadFiles,
      conv.omittedModifiedFiles,
      conv.pathRoot,
    ),
    formatRecentToolCalls(conv.recentToolCalls),
    formatRecentToolResults(conv.recentToolResults),
    exactLineMarkerBlock("verification", conv.verification),
    markerBlock("resume-risks", conv.resumeRisks),
    markerBlock("working-tree", conv.workingTree),
    markerBlock("source-anchors", conv.sourceAnchors),
    markerBlock("active-tasks", conv.activeTasks),
    markerBlock("literal-anchors", conv.literalAnchors),
    markerBlock("resume-tasks", conv.resumeTasks),
    formatResumeIndex(conv.resumeIndex),
    meta.id
      ? `<full-session-recovery>\nFull transcript: \`ctxgo show session --provider pi --provider-session ${shellQuote(meta.id)}\`\nSource JSONL: \`ctxgo locate session --provider pi --provider-session ${shellQuote(meta.id)}\`\n</full-session-recovery>`
      : "",
    markerBlock("summary-omissions", conv.budgetOmissions),
  ]) {
    if (block) parts.push("", block);
  }
  return parts.join("\n");
}

export function enforceOperatingBudget(
  meta: SessionMeta,
  conv: ConversationResult,
  userFocus?: string,
  recallEnabled = true,
): void {
  const omitted = new Map<string, number>();
  const note = (label: string) => omitted.set(label, (omitted.get(label) ?? 0) + 1);
  const refreshResume = () => {
    conv.resumeIndex = buildResumeIndex(
      conv.turns,
      conv.readFiles,
      conv.modifiedFiles,
      conv.recentToolCalls,
    );
    if (!recallEnabled) conv.resumeIndex.recallQueries = [];
    conv.pathRoot = choosePathRoot(
      [...conv.readFiles, ...conv.modifiedFiles, ...conv.resumeIndex.activeFiles],
      meta.cwd,
    );
    conv.resumeTasks = buildResumeTasks({
      recentToolCalls: conv.recentToolCalls,
      verification: conv.verification,
      workingTree: conv.workingTree,
      sourceAnchors: conv.sourceAnchors,
      activeTasks: conv.activeTasks,
      resumeIndex: conv.resumeIndex,
      pathRoot: conv.pathRoot,
      recallEnabled,
    });
  };
  // Reserve room for the omission receipt, separator, recall note, and metric prefix.
  const target = TARGET_RESUME_SUMMARY_CODE_POINTS - 1_024;
  let guard = 0;
  while (codePointLength(formatSummary(meta, conv, userFocus)) > target && guard++ < 1_000) {
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
    } else if (conv.verification.some((line) => line.includes("[freshness: not established"))) {
      const stale = conv.verification.findIndex((line) => line.includes("[freshness: not established"));
      conv.verification.splice(stale, 1);
      note("stale verification receipts");
    } else if (conv.turns.length > 1) {
      const candidates = conversationEvictionCandidates(conv.turns);
      if (candidates.length > 0) {
        conv.turns.splice(candidates[0].index, 1);
        note("conversation turns");
      } else if (conv.readFiles.length > 0) {
        conv.readFiles.shift();
        conv.omittedReadFiles += 1;
      } else if (conv.modifiedFiles.length > 0) {
        conv.modifiedFiles.shift();
        conv.omittedModifiedFiles += 1;
      } else if (conv.workingTree.length > 1) {
        conv.workingTree.shift();
        note("working-tree receipts");
      } else if (conv.verification.length > 1) {
        conv.verification.shift();
        note("verification receipts");
      } else if (conv.activeTasks.length > 1) {
        conv.activeTasks.shift();
        note("active tasks");
      } else {
        break;
      }
    } else if (conv.readFiles.length > 0) {
      conv.readFiles.shift();
      conv.omittedReadFiles += 1;
    } else if (conv.modifiedFiles.length > 0) {
      conv.modifiedFiles.shift();
      conv.omittedModifiedFiles += 1;
    } else if (conv.workingTree.length > 1) {
      conv.workingTree.shift();
      note("working-tree receipts");
    } else if (conv.verification.length > 1) {
      conv.verification.shift();
      note("verification receipts");
    } else {
      break;
    }
    refreshResume();
  }
  const omissions = [...omitted.entries()].map(([label, count]) =>
    `${count} ${label} omitted for the ${TARGET_RESUME_SUMMARY_CODE_POINTS.toLocaleString()}-code-point operating target`);
  if (codePointLength(formatSummary(meta, conv, userFocus)) > target) {
    omissions.push("protected-content overflow; operating target exceeded");
  }
  conv.budgetOmissions = omissions;
}
