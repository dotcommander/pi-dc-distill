import { LexicalBudget } from "./compiler/lexical-budget.ts";
import { parseAnyStructuredDistillHandoff } from "./handoff.ts";
import { formatInteger } from "./wire-format.ts";
import { RECALL_NOTE, COMPILE_SEPARATOR, MAX_STRUCTURED_SUMMARY_CODE_POINTS, checkAbort, argString, OrderedSet, limitedSetSlice, newestLimited, digest, sliceU16 } from "./compiler/helpers.ts";
import { KIND_USER, KIND_ASSISTANT, KIND_TOOL_CALL, KIND_TOOL_RESULT, KIND_THINKING, KIND_COMPACTION, type NormalizedBlock, type ConversationTurn, type ToolCallFingerprint, type ToolResultEntry, type ConversationResult, type LocalCompileResult, type ToolAdjacent, type PendingToolCall, type VerificationReceipt } from "./compiler/types.ts";
import { CompactionInputError } from "./compiler/errors.ts";
import { normalizeSessionJsonl, filterNoise, compressToolResults } from "./compiler/normalizer.ts";
import { extractPath, pathIdentity, snapshotObservations, transcriptChangeImpact, renderVerificationReceipt, createEvidenceState, renderEvidenceRisks, renderGitObservations, limitedVerificationSlice, shellCommand, isVerificationCommand, verificationIdentity, effectiveShellCwd, collectConversationToolCall, collectConversationToolResult } from "./compiler/tool-tracker.ts";
import { collectSourceAnchorsFromUserText, collectLiteralAnchors, collectTaskAgentNotification } from "./compiler/anchors.ts";
import { extractSignals, isReferentialImplementation, conversationEvictionCandidates, turnPreviewLimit, trimTurnWithLimit, compactAssistantTurns, hasTerminalNoWorkCompletion, classifyRequestGroups, removeCompletedHistoricalRequests } from "./compiler/conversation-reducer.ts";
import { buildResumeIndex, buildResumeTasks, buildResumePlan } from "./compiler/resume-index.ts";
import { formatSummary, enforceOperatingBudget, readRetainedContext } from "./compiler/budget-formatter.ts";
import { DisplayProjectionBudget } from "./compiler/display-projection.ts";
import { choosePathRoot } from "./compiler/path-roots.ts";
import { buildCheckpoint, validateCheckpoint, checkpointDigest } from "./compiler/checkpoint.ts";
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
  // The sole caller replaces both pending arrays immediately after a recorded turn.
  toolAdj.push({ tools: pendingTools, files: pendingFiles, hadError: pendingError });
  turns.push({
    sourceSequence: block.sourceSequence,
    role: block.kind,
    text,
    origin: block.origin,
    customType: block.customType,
  });
  return true;
}

function extractConversation(blocks: NormalizedBlock[], sessionCwd?: string, previous?: import("./compiler/types.ts").ObservationSnapshot, protectedText: string[] = []): ConversationResult {
  const lexical = new LexicalBudget();
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
  const pendingCalls: PendingToolCall[] = (previous?.pendingMutations ?? []).map(call => ({...call,args:call.args ? {...call.args} : undefined,startedEpoch:0,startedAt:0}));
  const toolAdj: ToolAdjacent[] = [];
  let pendingTools: string[] = [];
  let pendingFiles: string[] = [];
  let pendingError = false;
  const evidenceState = createEvidenceState(blocks);
  for (const call of pendingCalls) if (call.callId && blocks.some(block => block.kind === "tool_call" && block.callId === call.callId)) evidenceState.duplicateIds.add(call.callId);
  let mutationEpoch = 0;
  const lastErrorRun: { current?: ToolResultEntry } = {};

  const selectionSourceSequences: Record<string, number> = {};
  const stampedCounts = new Map<OrderedSet, number>();
  const stampedSets = [readFiles, modifiedFiles, createdFiles, sourceAnchors, workingTree];
  const stampedNames = ["readFiles", "modifiedFiles", "modifiedFiles", "sourceAnchors", "workingTree"];
  const stampStrings = (sequence: number) => {
    for (let index = 0; index < stampedSets.length; index++) {
      const values = stampedSets[index];
      const count = values.size;
      for (let valueIndex = stampedCounts.get(values) ?? 0; valueIndex < count; valueIndex++) {
        selectionSourceSequences[`${stampedNames[index]}\0${values.at(valueIndex)!}`] ??= sequence;
      }
      stampedCounts.set(values, count);
    }
  };
  for (let sourceSequence = 0; sourceSequence < blocks.length; sourceSequence++) {
    const block = blocks[sourceSequence];
    block.sourceSequence = sourceSequence;
    if (collectTaskAgentNotification(block, activeTasks)) continue;
    if (block.kind === KIND_TOOL_CALL) {
      const pending = collectConversationToolCall(
        block,
        pendingCalls,
        fingerprints,
        fingerprintOrder,
        evidenceState,
        sessionCwd,
      );
      mutationEpoch = evidenceState.mutationEpoch;
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
        evidenceState,
      );
      if (collected.pendingError) pendingError = true;
      omittedErrorResults = collected.omittedErrorResults;
      omittedRecentResults = collected.omittedRecentResults;
      mutationEpoch = collected.mutationEpoch;
      stampStrings(sourceSequence);
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
      stampStrings(sourceSequence);
      if (!recorded) continue;
      pendingTools = [];
      pendingFiles = [];
      pendingError = false;
    }
  }

  // Ambiguous un-ID'd call/result groups remain pending by design: conservative
  // INCOMPLETE receipts are safer than falsely assigning a result by adjacency.
  for (const [index, call] of pendingCalls.entries()) {
    const pendingPath = extractPath(call.args);
    if (pendingPath && ["read", "read_file", "view", "view_file"].includes(call.name.toLowerCase())) {
      const cwd = argString(call.args, "cwd") ?? sessionCwd;
      evidenceState.fileReads.push({ id: `pending:${call.callId ?? index}`, runner: call.name,
        path: pathIdentity(pendingPath, cwd), cwd, status: "incomplete", mutationEpoch,
        freshnessEstablished: false, imports: [] });
    }
    const identity = verificationIdentity(call, sessionCwd);
    const command = shellCommand(call);
    if (identity && command && isVerificationCommand(command)) {
      verification.set(`${identity}:incomplete:${call.callId ?? index}`, {
        status: "INCOMPLETE",
        tool: call.name,
        command,
        cwd: effectiveShellCwd(command, argString(call.args, "cwd") ?? sessionCwd),
        evidence: "tool call has no matching result",
        mutationEpoch,
        freshnessEstablished: Boolean(effectiveShellCwd(command, argString(call.args, "cwd") ?? sessionCwd)) && !call.overlappingMutation,
      });
    }
  }
  renderEvidenceRisks(evidenceState, resumeRisks);
  renderGitObservations(evidenceState, workingTree);

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

  const terminalComplete = pendingCalls.length === 0
    && !activeTasks.slice().some(task => task.includes("running at snapshot"))
    && hasTerminalNoWorkCompletion(turns);
  const resumePlan = buildResumePlan({
    terminalComplete,
    activeTasks: activeTasks.slice(),
    verificationReceipts: [...verification.values()],
    mutationEpoch,
    workingTree: workingTree.slice(),
  });
  const protectedGroups = classifyRequestGroups(turns);
  removeCompletedHistoricalRequests(turns, toolAdj, protectedGroups);

  const displayBudget = new DisplayProjectionBudget();
  for (let index = 0; index < turns.length; index++) {
    // These turn objects are created locally and have not escaped extraction.
    const turn = turns[index];
    const sourceText = turn.text;
    const age = turn.protectedRequest ? 0 : turns.length - index - 1;
    const previewLimit = turnPreviewLimit(sourceText, age);
    const displayText = displayBudget.project(sourceText, turn.origin === "custom" || protectedText.some(text => text && sourceText.includes(text)));
    turn.text = trimTurnWithLimit(sourceText, previewLimit);
    if (displayText !== sourceText) turn.displayText = trimTurnWithLimit(displayText, previewLimit);
  }
  let finalTurns = turns;
  let totalChars = finalTurns.reduce((sum, turn) => sum + turn.text.length, 0);
  while (finalTurns.length > 0 && totalChars > 16_000) {
    const candidates = conversationEvictionCandidates(finalTurns, undefined, lexical);
    if (candidates.length === 0) break;
    const remove = candidates[0].index;
    totalChars -= finalTurns[remove].text.length;
    finalTurns = finalTurns.filter((_, index) => index !== remove);
    toolAdj.splice(remove, 1);
  }
  finalTurns = compactAssistantTurns(finalTurns, toolAdj);
  const firstFinalUser = finalTurns.findIndex((turn) => turn.role === "user" && turn.origin !== "custom");
  if (firstFinalUser > 0 && !isReferentialImplementation(finalTurns[firstFinalUser].text)) {
    finalTurns = finalTurns.filter((turn, index) => {
      if (index >= firstFinalUser) return true;
      const signals = extractSignals(turn.text);
      return signals.hasDiff || signals.hasCodeFence;
    });
  }
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

  for (const anchor of literalAnchors) {
    const source = finalTurns.findLast((turn) => turn.text.includes(anchor));
    if (source?.sourceSequence !== undefined) selectionSourceSequences[`literalAnchors\0${anchor}`] = source.sourceSequence;
  }

  const boundedReadFiles = newestLimited(readFiles.slice(), 50);
  const boundedModifiedFiles = newestLimited([...modifiedFiles.slice(), ...createdFiles.slice()], 50);
  let finalReadFiles = terminalComplete ? [] : boundedReadFiles.values;
  let finalModifiedFiles = terminalComplete ? [] : boundedModifiedFiles.values;
  const finalVerification = terminalComplete ? [] : limitedVerificationSlice(verification, mutationEpoch);
  for (const receipt of verification.values()) {
    if (receipt.sourceSequence !== undefined) selectionSourceSequences[`verification\0${renderVerificationReceipt(receipt, mutationEpoch)}`] = receipt.sourceSequence;
  }
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
    : buildResumeIndex(finalTurns, finalReadFiles, finalModifiedFiles, finalRecentToolCalls, lexical);
  const pathRoot = choosePathRoot([...finalReadFiles, ...finalModifiedFiles, ...resumeIndex.activeFiles], sessionCwd);

  const observationSnapshot = Object.freeze({...snapshotObservations(evidenceState, verification), pendingMutations: pendingCalls.filter(call=>call.potentiallyModifying).map(call=>({...call}))});
  return {
    selectionSourceSequences,
    observationSnapshot,
    changeImpact: transcriptChangeImpact(observationSnapshot),
    resumePlan,
    terminalComplete,
    lexical,
    turns: finalTurns,
    readFiles: finalReadFiles,
    modifiedFiles: finalModifiedFiles,
    observedFiles: { read: readFiles.slice(), modified: [...modifiedFiles.slice(), ...createdFiles.slice()] },
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
      resumePlan,
      terminalComplete,
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

// Exact shell identity stays in ResumePlan; command presentation is escaped
// once by the formatter so entities cannot forge summary markers.

// Reject malformed text without rewriting file/command/literal identities.
function rejectMalformedUnicode(values: unknown[]): void {
  const pending = [...values];
  const malformed = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === "string") {
      if (malformed.test(value)) throw new CompactionInputError("compaction input contains malformed Unicode");
    } else if (value && typeof value === "object") {
      const keys = Object.keys(value);
      const record = value as Record<string, unknown>;
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index]; pending.push(key, record[key]);
      }
    }
  }
}

function observedFailures(blocks: NormalizedBlock[]) {
  const calls = new Map<string, NormalizedBlock[]>();
  for (const block of blocks) if (block.kind === KIND_TOOL_CALL && block.callId) {
    const key = `${block.name}\0${block.callId}`; const group = calls.get(key) ?? []; group.push(block); calls.set(key, group);
  }
  return blocks.flatMap(block => {
    if (block.kind !== KIND_TOOL_RESULT || block.isError !== true || /^(?:File unchanged since last read|No changes to apply|Nothing to replace|No changes were made)\b/i.test(block.text ?? "")) return [];
    const group = block.callId ? calls.get(`${block.name}\0${block.callId}`) : undefined;
    const call = group?.length === 1 ? group[0] : undefined;
    const attemptedFix = call ? `${call.name}: ${JSON.stringify(call.args ?? {})}` : "unpaired tool result; attempted fix unknown";
    const observedOutcome = block.text ?? "";
    return [{signature: digest(`${attemptedFix}\0${observedOutcome}`),attemptedFix,observedOutcome,sources: [call?.sourceReference,block.sourceReference].filter((source): source is NonNullable<typeof source> => source !== undefined)}];
  });
}

export function compileSessionJsonl(content: string, userFocus?: string, signal?: AbortSignal, recallEnabled = true, selection: "baseline" | "coverage" = "baseline"): LocalCompileResult {
  checkAbort(signal);
  if (!content.trim()) throw new CompactionInputError("compaction input is empty");
  const normalized = normalizeSessionJsonl(content, signal);
  rejectMalformedUnicode([normalized.blocks, normalized.meta, userFocus, normalized.meta.handoff ? parseAnyStructuredDistillHandoff(normalized.meta.handoff) : undefined]);
  if (normalized.invalidRecordCount > 0) {
    throw new CompactionInputError(
      `compaction input contains ${normalized.invalidRecordCount} malformed record(s)`,
    );
  }
  if (normalized.usefulRecordCount === 0) {
    throw new CompactionInputError("compaction input contains no useful records");
  }
  let previous = normalized.meta.checkpoint;
  if (previous) previous = validateCheckpoint(previous, normalized.meta.checkpointDigest);
  for (const update of normalized.meta.checkpointUpdates ?? []) {
    // Updates are immutable resulting snapshots, resolved before saving by the tool.
    previous = validateCheckpoint(update.checkpoint, update.checkpointDigest);
    previous.updateEntryId = update.entryId;
  }
  const conv = extractConversation(
    compressToolResults(filterNoise(normalized.blocks)),
    normalized.meta.cwd, previous?.evidence,
    previous ? [...previous.pins.filter(pin => pin.status === "active").map(pin => pin.text), ...previous.constraints, ...previous.tasks.map(task => task.action)] : [],
  );
  const declarations = (normalized.meta.declarations ?? []).flatMap((text, index) => { const handoff = parseAnyStructuredDistillHandoff(text); return handoff ? [{ handoff, source: normalized.meta.declarationSources?.[index] }] : []; });
  conv.checkpoint = buildCheckpoint(previous, declarations.map(item => item.handoff),
    conv.observationSnapshot!, normalized.meta.predecessorEntryId, conv.observedFiles, declarations.map(item => item.source), conv.resumeRisks,
    observedFailures(normalized.blocks));
  conv.observationSnapshot = conv.checkpoint.evidence;
  conv.retainedContext = readRetainedContext(normalized.meta.priorSummaries);
  if (!recallEnabled) {
    conv.resumeIndex.recallQueries = [];
    conv.resumeTasks = buildResumeTasks({ ...conv, recallEnabled });
  }
  enforceOperatingBudget(normalized.meta, conv, userFocus, recallEnabled, selection);
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
      `structured summary exceeds ${formatInteger(MAX_STRUCTURED_SUMMARY_CODE_POINTS)} code points`, "protected_overflow",
    );
  }
  checkAbort(signal);
  return {
    summary,
    checkpoint: conv.checkpoint!,
    checkpointDigest: checkpointDigest(conv.checkpoint!),
    readFiles: conv.checkpoint!.files.read.slice(-50).map(path=>sliceU16(path,512)),
    modifiedFiles: conv.checkpoint!.files.modified.slice(-50).map(path=>sliceU16(path,512)),
    literalAnchors: conv.literalAnchors,
    inputDigest: digest(content),
    summaryDigest: digest(summary),
    digestScope: "compaction-input",
    usefulRecordCount: normalized.usefulRecordCount,
  };
}
