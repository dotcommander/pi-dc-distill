import { RECALL_NOTE, COMPILE_SEPARATOR, MAX_STRUCTURED_SUMMARY_CODE_POINTS, checkAbort, argString, OrderedSet, addMarkerLine, limitedSetSlice, newestLimited, isBareConfirmation, digest } from "./compiler/helpers.ts";
import { KIND_USER, KIND_ASSISTANT, KIND_TOOL_CALL, KIND_TOOL_RESULT, KIND_THINKING, KIND_COMPACTION, type NormalizedBlock, type ConversationTurn, type ToolCallFingerprint, type ToolResultEntry, type ConversationResult, type LocalCompileResult, type ToolAdjacent, type PendingToolCall, type VerificationReceipt } from "./compiler/types.ts";
import { CompactionInputError } from "./compiler/errors.ts";
import { normalizeSessionJsonl, filterNoise, compressToolResults } from "./compiler/normalizer.ts";
import { extractPath, limitedVerificationSlice, fileWriteTools, shellCommand, isVerificationCommand, verificationIdentity, collectConversationToolCall, collectConversationToolResult } from "./compiler/tool-tracker.ts";
import { collectSourceAnchorsFromUserText, collectLiteralAnchors, collectTaskAgentNotification } from "./compiler/anchors.ts";
import { extractSignals, conversationEvictionCandidates, trimTurn, compactAssistantTurns, hasTerminalNoWorkCompletion, classifyRequestGroups, removeCompletedHistoricalRequests } from "./compiler/conversation-reducer.ts";
import { buildResumeIndex, buildResumeTasks } from "./compiler/resume-index.ts";
import { formatSummary, enforceOperatingBudget } from "./compiler/budget-formatter.ts";
import { choosePathRoot } from "./compiler/path-roots.ts";
import { open, readFile, stat } from "node:fs/promises";
import { codePointLength } from "./unicode.ts";

export { CompactionInputError } from "./compiler/errors.ts";
export type { LocalCompileResult } from "./compiler/types.ts";

function collectConversationTurn(
  block: NormalizedBlock & { kind: "user" | "assistant" },
  sourceAnchors: OrderedSet,
  toolAdj: ToolAdjacent[],
  turns: ConversationTurn[],
  pendingTools: string[],
  pendingFiles: string[],
  pendingError: boolean,
): boolean {
  const text = (block.text ?? "").trim();
  if (block.kind === KIND_USER) collectSourceAnchorsFromUserText(sourceAnchors, text);
  if (!text) return false;
  toolAdj.push({ tools: [...pendingTools], files: [...pendingFiles], hadError: pendingError });
  turns.push({
    role: block.kind,
    text,
    origin: block.origin,
    customType: block.customType,
  });
  return true;
}

function extractConversation(blocks: NormalizedBlock[], sessionCwd?: string): ConversationResult {
  const turns: ConversationTurn[] = [];
  const readFiles = new OrderedSet();
  const modifiedFiles = new OrderedSet();
  const createdFiles = new OrderedSet();
  const fingerprintOrder: string[] = [];
  const fingerprints = new Map<string, ToolCallFingerprint>();
  const errorResults: ToolResultEntry[] = [];
  const recentResults: ToolResultEntry[] = [];
  let omittedErrorResults = 0;
  let omittedRecentResults = 0;
  const verification = new Map<string, VerificationReceipt>();
  const workingTree = new OrderedSet();
  const sourceAnchors = new OrderedSet();
  const activeTasks = new OrderedSet();
  const resumeRisks = new OrderedSet();
  const pendingCalls: PendingToolCall[] = [];
  const toolAdj: ToolAdjacent[] = [];
  let pendingTools: string[] = [];
  let pendingFiles: string[] = [];
  let pendingError = false;
  let mutationEpoch = 0;
  const lastErrorRun: { current?: ToolResultEntry } = {};

  for (const block of blocks) {
    if (collectTaskAgentNotification(block, activeTasks)) continue;
    if (block.kind === KIND_TOOL_CALL) {
      const pending = collectConversationToolCall(
        block,
        pendingCalls,
        fingerprints,
        fingerprintOrder,
      );
      if (pending.pendingTool) pendingTools.push(pending.pendingTool);
      if (pending.pendingFile) pendingFiles.push(pending.pendingFile);
      continue;
    }

    if (block.kind === KIND_TOOL_RESULT) {
      const collected = collectConversationToolResult(
        block,
        pendingCalls,
        verification,
        workingTree,
        activeTasks,
        sourceAnchors,
        readFiles,
        modifiedFiles,
        createdFiles,
        resumeRisks,
        errorResults,
        recentResults,
        omittedErrorResults,
        omittedRecentResults,
        sessionCwd,
        mutationEpoch,
        lastErrorRun,
      );
      if (collected.pendingError) pendingError = true;
      omittedErrorResults = collected.omittedErrorResults;
      omittedRecentResults = collected.omittedRecentResults;
      mutationEpoch = collected.mutationEpoch;
      continue;
    }

    if (block.kind === KIND_THINKING || block.kind === KIND_COMPACTION) continue;
    if (block.kind === KIND_USER || block.kind === KIND_ASSISTANT) {
      lastErrorRun.current = undefined;
      const recorded = collectConversationTurn(
        block as NormalizedBlock & { kind: "user" | "assistant" },
        sourceAnchors,
        toolAdj,
        turns,
        pendingTools,
        pendingFiles,
        pendingError,
      );
      if (!recorded) continue;
      pendingTools = [];
      pendingFiles = [];
      pendingError = false;
    }
  }

  // Ambiguous un-ID'd call/result groups remain pending by design: conservative
  // INCOMPLETE receipts are safer than falsely assigning a result by adjacency.
  for (const [index, call] of pendingCalls.entries()) {
    const identity = verificationIdentity(call, sessionCwd);
    const command = shellCommand(call);
    if (identity && command && isVerificationCommand(command)) {
      verification.set(`${identity}:incomplete:${call.callId ?? index}`, {
        status: "INCOMPLETE",
        tool: call.name,
        command,
        cwd: argString(call.args, "cwd") ?? sessionCwd,
        evidence: "tool call has no matching result",
        mutationEpoch,
      });
    }
    const path = extractPath(call.args);
    if (path && fileWriteTools.has(call.name.toLowerCase())) {
      addMarkerLine(resumeRisks, `Unmatched ${call.name} for ${path} has unknown effects; inspect before retry.`);
    }
  }

  for (const path of createdFiles.slice()) modifiedFiles.remove(path);
  const allRecentToolCalls = fingerprintOrder.map((key) => fingerprints.get(key)).filter((value): value is ToolCallFingerprint => Boolean(value));
  const recentToolCalls = allRecentToolCalls.slice(-20);
  if (allRecentToolCalls.length > recentToolCalls.length) {
    recentToolCalls.unshift({
      name: `... (${allRecentToolCalls.length - recentToolCalls.length} recent tool calls omitted)`,
      key: "",
      count: 1,
    });
  }

  const protectedGroups = classifyRequestGroups(turns);
  removeCompletedHistoricalRequests(turns, toolAdj, protectedGroups);

  for (let index = 0; index < turns.length; index++) {
    turns[index] = {
      ...turns[index],
      text: turns[index].protectedRequest
        ? trimTurn(turns[index].text, 0)
        : trimTurn(turns[index].text, turns.length - index - 1),
    };
  }
  let finalTurns = turns;
  let totalChars = finalTurns.reduce((sum, turn) => sum + turn.text.length, 0);
  while (finalTurns.length > 0 && totalChars > 16_000) {
    const candidates = conversationEvictionCandidates(finalTurns);
    if (candidates.length === 0) break;
    const remove = candidates[0].index;
    totalChars -= finalTurns[remove].text.length;
    finalTurns = finalTurns.filter((_, index) => index !== remove);
    toolAdj.splice(remove, 1);
  }
  finalTurns = compactAssistantTurns(finalTurns, toolAdj);
  const firstFinalUser = finalTurns.findIndex((turn) => turn.role === "user" && turn.origin !== "custom");
  if (firstFinalUser > 0 && !isBareConfirmation(finalTurns[firstFinalUser].text)) {
    finalTurns = finalTurns.filter((turn, index) => {
      if (index >= firstFinalUser) return true;
      const signals = extractSignals(turn.text);
      return signals.hasDiff || signals.hasCodeFence;
    });
  }
  const terminalComplete = hasTerminalNoWorkCompletion(finalTurns);
  if (terminalComplete) {
    finalTurns = finalTurns.filter((turn) =>
      turn.requestGroup !== undefined && protectedGroups.has(turn.requestGroup));
  }
  const literalAnchors = terminalComplete ? [] : collectLiteralAnchors(finalTurns.map((turn) => ({
    kind: turn.role,
    text: turn.text,
    origin: turn.origin,
    customType: turn.customType,
  })));

  const boundedReadFiles = newestLimited(readFiles.slice(), 50);
  const boundedModifiedFiles = newestLimited([...modifiedFiles.slice(), ...createdFiles.slice()], 50);
  let finalReadFiles = terminalComplete ? [] : boundedReadFiles.values;
  let finalModifiedFiles = terminalComplete ? [] : boundedModifiedFiles.values;
  const finalVerification = terminalComplete ? [] : limitedVerificationSlice(verification, mutationEpoch);
  let finalWorkingTree = terminalComplete ? [] : limitedSetSlice(workingTree, 10, "working-tree rows");
  let finalSourceAnchors = terminalComplete ? [] : limitedSetSlice(sourceAnchors, 10, "source anchors");
  const finalActiveTasks = terminalComplete ? [] : limitedSetSlice(activeTasks, 10, "active tasks");
  const delegatedRepo = finalActiveTasks.findLast((line) => line.includes("running at snapshot"))
    ?.match(/(;\s+)(\/(?:Users|home|tmp)\/[^;]+);/)?.[2];
  if (delegatedRepo) {
    const belongsToDelegatedRepo = (value: string) => value === delegatedRepo || value.startsWith(`${delegatedRepo}/`);
    finalReadFiles = finalReadFiles.filter(belongsToDelegatedRepo);
    finalModifiedFiles = finalModifiedFiles.filter(belongsToDelegatedRepo);
    finalSourceAnchors = finalSourceAnchors.filter(belongsToDelegatedRepo);
    finalWorkingTree = finalWorkingTree.filter((line) => line.includes(`cwd=${delegatedRepo}`));
  }
  const finalResumeRisks = terminalComplete ? [] : limitedSetSlice(resumeRisks, 8, "resume risks");
  const finalRecentToolCalls = terminalComplete ? [] : recentToolCalls;
  const resumeIndex = terminalComplete
    ? { activeFiles: [], recentUserIntents: [], continuationHints: [], recallQueries: [] }
    : buildResumeIndex(finalTurns, finalReadFiles, finalModifiedFiles, finalRecentToolCalls);
  const pathRoot = choosePathRoot([...finalReadFiles, ...finalModifiedFiles, ...resumeIndex.activeFiles], sessionCwd);

  return {
    turns: finalTurns,
    readFiles: finalReadFiles,
    modifiedFiles: finalModifiedFiles,
    omittedReadFiles: boundedReadFiles.omitted,
    omittedModifiedFiles: boundedModifiedFiles.omitted,
    recentToolCalls: finalRecentToolCalls,
    recentToolResults: terminalComplete ? [] : [
      ...(omittedErrorResults + omittedRecentResults > 0 ? [{
        toolName: "...",
        text: `(${omittedErrorResults + omittedRecentResults} recent tool results omitted)`,
        isError: false,
      }] : []),
      ...errorResults,
      ...recentResults,
    ],
    verification: finalVerification,
    workingTree: finalWorkingTree,
    sourceAnchors: finalSourceAnchors,
    literalAnchors,
    activeTasks: finalActiveTasks,
    resumeRisks: finalResumeRisks,
    budgetOmissions: [],
    resumeIndex,
    resumeTasks: buildResumeTasks({
      recentToolCalls: finalRecentToolCalls,
      verification: finalVerification,
      workingTree: finalWorkingTree,
      sourceAnchors: finalSourceAnchors,
      activeTasks: finalActiveTasks,
      resumeIndex,
      pathRoot,
    }),
    pathRoot,
  };
}

// `&` is never entity-escaped in summary lines: `&` cannot forge a marker, and
// escaping it corrupts exact shell bytes (`&&`, URLs) in receipts and commands.
// `<`/`>` stay escaped except where exact command bytes are contractual.

export function compileSessionJsonl(content: string, userFocus?: string, signal?: AbortSignal, recallEnabled = true): LocalCompileResult {
  checkAbort(signal);
  if (!content.trim()) throw new CompactionInputError("compaction input is empty");
  const normalized = normalizeSessionJsonl(content, signal);
  if (normalized.invalidRecordCount > 0) {
    throw new CompactionInputError(
      `compaction input contains ${normalized.invalidRecordCount} malformed record(s)`,
    );
  }
  if (normalized.usefulRecordCount === 0) {
    throw new CompactionInputError("compaction input contains no useful records");
  }
  const conv = extractConversation(
    compressToolResults(filterNoise(normalized.blocks)),
    normalized.meta.cwd,
  );
  if (!recallEnabled) {
    conv.resumeIndex.recallQueries = [];
    conv.resumeTasks = buildResumeTasks({ ...conv, recallEnabled });
  }
  enforceOperatingBudget(normalized.meta, conv, userFocus, recallEnabled);
  checkAbort(signal);
  let summary = `${formatSummary(normalized.meta, conv, userFocus)}${recallEnabled ? `${COMPILE_SEPARATOR}${RECALL_NOTE}` : ""}`;
  while (codePointLength(summary) > MAX_STRUCTURED_SUMMARY_CODE_POINTS && (conv.readFiles.length > 0 || conv.modifiedFiles.length > 0)) {
    if (conv.readFiles.length >= conv.modifiedFiles.length && conv.readFiles.length > 0) {
      conv.readFiles.shift();
      conv.omittedReadFiles++;
    } else if (conv.modifiedFiles.length > 0) {
      conv.modifiedFiles.shift();
      conv.omittedModifiedFiles++;
    }
    summary = `${formatSummary(normalized.meta, conv, userFocus)}${recallEnabled ? `${COMPILE_SEPARATOR}${RECALL_NOTE}` : ""}`;
  }
  if (codePointLength(summary) > MAX_STRUCTURED_SUMMARY_CODE_POINTS) {
    throw new CompactionInputError(
      `structured summary exceeds ${MAX_STRUCTURED_SUMMARY_CODE_POINTS.toLocaleString()} code points`,
    );
  }
  checkAbort(signal);
  return {
    summary,
    readFiles: conv.readFiles,
    modifiedFiles: conv.modifiedFiles,
    literalAnchors: conv.literalAnchors,
    inputDigest: digest(content),
    summaryDigest: digest(summary),
    digestScope: "compaction-input",
    usefulRecordCount: normalized.usefulRecordCount,
  };
}

const MAX_SESSION_BYTES = 20 * 1024 * 1024;

const HEAD_BYTES = 64 * 1024;

/** Oversized sessions: keep the head (session meta line) + a tail window.
 *  The turn budget drops oldest content anyway, so losing the middle is safe. */

interface BoundedSessionRead {
  content: string;
  digestScope: LocalCompileResult["digestScope"];
}

async function readSessionBounded(path: string): Promise<BoundedSessionRead> {
  const { size } = await stat(path);
  if (size <= MAX_SESSION_BYTES) {
    return { content: await readFile(path, "utf8"), digestScope: "compaction-input" };
  }
  const handle = await open(path, "r");
  try {
    const head = Buffer.alloc(HEAD_BYTES);
    await handle.read(head, 0, HEAD_BYTES, 0);
    const tailLen = MAX_SESSION_BYTES - HEAD_BYTES;
    const tail = Buffer.alloc(tailLen);
    await handle.read(tail, 0, tailLen, size - tailLen);
    const headText = head.toString("utf8");
    const tailText = tail.toString("utf8");
    // Drop partial lines at both cut points; parseLine skips garbage anyway.
    return {
      content: `${headText.slice(0, headText.lastIndexOf("\n") + 1)}\n${tailText.slice(tailText.indexOf("\n") + 1)}`,
      digestScope: "bounded-compaction-input",
    };
  } finally {
    await handle.close();
  }
}

export async function compileSessionFile(path: string, userFocus?: string, recallEnabled = true): Promise<LocalCompileResult> {
  const input = await readSessionBounded(path);
  const result = compileSessionJsonl(input.content, userFocus, undefined, recallEnabled);
  return { ...result, digestScope: input.digestScope };
}
