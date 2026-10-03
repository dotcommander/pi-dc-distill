import { sliceU16, HARNESS_ERROR_SKIP, argString, OrderedSet, addMarkerLine, moveKeyToEnd, digest } from "./helpers.ts";
import { type NormalizedBlock, type ToolCallFingerprint, type ToolResultEntry, type PendingToolCall, type VerificationReceipt, type VerificationObservation, type FileReadObservation, type ObservationSnapshot } from "./types.ts";
import { observeVerification } from "./verification-observation.ts";
import { collectSourceAnchorsFromValue, collectActiveTasks } from "./anchors.ts";
import { LEGACY_OUTPUT_NOTICE_PREFIX } from "../legacy.ts";
import { codePointLength } from "../unicode.ts";
import { basename, isAbsolute, resolve, normalize } from "node:path";
import { analyzeShell, shellSegmentHasUnsafeOptions, shellSegmentHasUnsafeCheckOptions } from "./shell-analysis.ts";
import { classifyToolEffect, fileReadTools, fileWriteTools, fileCreateTools, isShellTool } from "./tool-effects.ts";
export { fileWriteTools } from "./tool-effects.ts";

interface WriteRisk {
  call: PendingToolCall;
  identity: string;
  path: string;
  terminalAt?: number;
  failed?: boolean;
}
interface GitObservation {
  command: string;
  cwd?: string;
  scope: string;
  evidence: string;
  mutationEpoch: number;
  freshnessEstablished: boolean;
}
export interface EvidenceState {
  mutationEpoch: number;
  sequence: number;
  duplicateIds: Set<string>;
  risks: WriteRisk[];
  git: GitObservation[];
  fileReads: FileReadObservation[];
  modifiedPaths: Set<string>;
}
export function createEvidenceState(blocks: NormalizedBlock[] = []): EvidenceState {
  const seen = new Set<string>();
  const duplicateIds = new Set<string>();
  for (const block of blocks) if (block.kind === "tool_call" && block.callId) {
    if (seen.has(block.callId)) duplicateIds.add(block.callId);
    seen.add(block.callId);
  }
  return { mutationEpoch: 0, sequence: 0, duplicateIds, risks: [], git: [], fileReads: [], modifiedPaths: new Set() };
}

/** Lexical identity only: no filesystem reads, display truncation or alias names. */
export function pathIdentity(path: string, cwd?: string): string {
  if (isAbsolute(path)) return normalize(path);
  return cwd && isAbsolute(cwd) ? resolve(cwd, path) : `relative:${normalize(path)}`;
}

export function renderEvidenceRisks(state: EvidenceState, risks: OrderedSet): void {
  for (const risk of state.risks) {
    const label = risk.failed ? "Failed" : "Unmatched";
    const effects = risk.failed ? "may have partial effects" : "has unknown effects";
    // Identity and chronology are retained independently of this bounded display.
    const rawPath = risk.path;
    const path = codePointLength(rawPath) <= 100 ? rawPath : `${sliceU16(rawPath, 65)}… [path sha256:${digest(risk.identity).slice(0, 16)}]`;
    addMarkerLine(risks, `${label} ${risk.call.name} for ${path} ${effects}; inspect before retry.`);
  }
}

export function renderGitObservations(state: EvidenceState, rows: OrderedSet): void {
  for (const receipt of state.git) {
    const stale = !receipt.freshnessEstablished || receipt.mutationEpoch < state.mutationEpoch;
    const cwd = receipt.cwd ?? "unknown";
    const command = codePointLength(receipt.command) <= 512 ? receipt.command : `[command sha256:${digest(receipt.command).slice(0, 16)}]`;
    rows.add(`[git receipt, cwd=${codePointLength(cwd) <= 200 ? cwd : `[cwd sha256:${digest(cwd).slice(0, 16)}]`}] scope=${receipt.scope}; ${command}: ${sliceU16(receipt.evidence, 300)}${stale ? " [freshness: not established]" : ""}`);
  }
}

export function extractPath(args: Record<string, unknown> | undefined): string | undefined {
  for (const key of ["path", "file_path", "filePath", "file", "targetFile", "TargetFile", "target_file", "target_path", "absolutePath", "AbsolutePath"]) {
    const value = argString(args, key);
    if (value) return value;
  }
  return undefined;
}

function stripCdPrefix(command: string): string {
  const trimmed = command.trim();
  if (!trimmed.startsWith("cd ")) return trimmed;
  const after = trimmed.slice(3);
  const idx = after.indexOf(" && ");
  if (idx >= 0) return after.slice(idx + 4).trim();
  return basename(after.trim());
}

export function effectiveShellCwd(command: string, fallback?: string): string | undefined {
  const analysis = analyzeShell(command);
  const first = analysis.segments[0];
  if (!analysis.supported || first?.[0] !== "cd" || first.length !== 2 || analysis.operators[0] !== "&&") return fallback;
  const path = first[1];
  if (!path || path.startsWith("-")) return undefined;
  if (isAbsolute(path)) return resolve(path);
  return fallback && isAbsolute(fallback) ? resolve(fallback, path) : undefined;
}

function fingerprintKey(name: string, args: Record<string, unknown> | undefined): string {
  const path = extractPath(args);
  if (path) return path;
  for (const key of ["action", "pattern"]) {
    const value = argString(args, key);
    if (value) return value;
  }
  const command = argString(args, "command");
  if (command) return sliceU16(stripCdPrefix(command), 40);
  const query = argString(args, "query");
  if (query) return sliceU16(query, 40);
  return "";
}

export function renderVerificationReceipt(
  receipt: VerificationReceipt,
  currentMutationEpoch: number,
): string {
  const rawCwd = receipt.cwd ?? "unknown";
  const cwd = codePointLength(rawCwd) <= 200
    ? rawCwd
    : `[cwd sha256:${digest(rawCwd).slice(0, 16)}]`;
  const scope = `${receipt.tool || "shell"} cwd=${cwd}`;
  const isStale = receipt.freshnessEstablished === false || receipt.mutationEpoch < currentMutationEpoch;
  const preserveExactCommand = !isStale || receipt.status === "FAIL" || receipt.status === "INCOMPLETE";
  const command = preserveExactCommand && codePointLength(receipt.command) <= 1_024
    ? receipt.command
    : `[stale command sha256:${digest(receipt.command).slice(0, 16)}]`;
  const evidence = sliceU16(receipt.evidence, 300);
  const stale = isStale
    ? " [freshness: not established after later potentially modifying work]"
    : "";
  return `${receipt.status} [${scope}]: ${command} — ${evidence}${stale}`;
}

export function limitedVerificationSlice(
  receipts: Map<string, VerificationReceipt>,
  mutationEpoch: number,
  limit = 10,
): string[] {
  const all = [...receipts.values()];
  const current = all.filter((receipt) =>
    (receipt.freshnessEstablished !== false && receipt.mutationEpoch >= mutationEpoch) || receipt.status === "FAIL" || receipt.status === "INCOMPLETE");
  const stalePasses = all.filter((receipt) =>
    (receipt.freshnessEstablished === false || receipt.mutationEpoch < mutationEpoch) && receipt.status === "PASS");
  const retained = [...current, ...stalePasses.slice(-1)];
  const values = retained.map((receipt) => renderVerificationReceipt(receipt, mutationEpoch));
  if (stalePasses.length > 1) {
    values.unshift(`... (${stalePasses.length - 1} stale verification receipts omitted)`);
  }
  if (values.length <= limit) return values;
  return [...values.slice(values.length - limit), `... (${values.length - limit} verification rows omitted)`];
}

export function popPendingToolCall(
  calls: PendingToolCall[],
  resultName: string,
  resultCallId?: string,
  duplicateIds = new Set<string>(),
): { call: PendingToolCall; matched: boolean } {
  if (resultCallId) {
    const candidates = calls.map((call, index) => ({ call, index })).filter(({ call }) => call.callId === resultCallId);
    if (duplicateIds.has(resultCallId) || candidates.length !== 1 || candidates[0].call.name !== resultName) {
      return { call: { name: resultName, callId: resultCallId }, matched: false };
    }
    return { call: calls.splice(candidates[0].index, 1)[0], matched: true };
  }
  const candidates = calls
    .map((call, index) => ({ call, index }))
    .filter(({ call }) => call.name === resultName && !call.callId);
  if (candidates.length !== 1) return { call: { name: resultName }, matched: false };
  return { call: calls.splice(candidates[0].index, 1)[0], matched: true };
}

export function shellCommand(call: PendingToolCall): string | undefined {
  if (!isShellTool(call.name)) return undefined;
  const command = argString(call.args, "command") ?? argString(call.args, "cmd");
  return command && command.trim() ? command : undefined;
}

function hasUnsafeReadOptions(args: string[]): boolean {
  return shellSegmentHasUnsafeOptions(args);
}

function isCheckSegment(args: string[]): boolean {
  if (shellSegmentHasUnsafeCheckOptions(args)) return false;
  const [exe, sub, third] = args;
  if (exe === "go") {
    if (args.slice(2).some((arg) => /^-(?:exec|toolexec)(?:=|$)/.test(arg))) return false;
    return ["test", "build", "vet"].includes(sub) || (sub === "mod" && third === "verify");
  }
  if (exe === "bun" && sub === "x") return third === "tsc";
  if (["bun", "npm", "pnpm", "yarn", "cargo"].includes(exe)) return sub === "test";
  if (exe === "ruff") return sub === "check";
  if (exe === "just") return sub === "test" || sub === "build";
  if (exe === "git") return sub === "diff" && args.slice(2, args.indexOf("--") < 0 ? undefined : args.indexOf("--")).includes("--check");
  if (exe === "golangci-lint") return sub === "run";
  return ["pytest", "mypy", "tsc", "typecheck", "lint"].includes(exe);
}

export function isVerificationCommand(command: string): boolean {
  const analysis = analyzeShell(command);
  if (!analysis.supported || analysis.operators.some((operator) => operator !== "&&") || analysis.operators.length !== analysis.segments.length - 1) return false;
  const segments = analysis.segments;
  const leadingCd = segments[0]?.[0] === "cd";
  if (leadingCd && (segments[0].length !== 2 || !segments[0][1] || segments[0][1].startsWith("-"))) return false;
  const checks = leadingCd ? segments.slice(1) : segments;
  return checks.length > 0 && checks.every(isCheckSegment);
}

/** Opaque recipes and emitting builds remain diagnostics, never fresh passes. */
function canEstablishFreshVerification(command: string): boolean {
  const analysis = analyzeShell(command);
  return analysis.supported && analysis.segments.every((args) => {
    if (args[0] === "cd") return true;
    if (args[0] === "just" || (args[0] === "go" && args[1] === "build")) return false;
    const tsc = args[0] === "tsc" || (args[0] === "bun" && args[1] === "x" && args[2] === "tsc");
    if (tsc) {
      let noEmit = false;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--noEmit") noEmit = args[i + 1] !== "false";
        else if (args[i].startsWith("--noEmit=")) noEmit = args[i] === "--noEmit=true";
      }
      return noEmit;
    }
    return true;
  });
}

/** One executable probe, optionally behind a literal leading cd. */
export function gitProbeScope(command: string): string | undefined {
  const analysis = analyzeShell(command);
  if (!analysis.supported) return undefined;
  const segments = analysis.segments;
  const leadingCd = segments[0]?.[0] === "cd";
  if (leadingCd && (segments[0].length !== 2 || analysis.operators[0] !== "&&" || segments[0][1].startsWith("-"))) return undefined;
  const probes = leadingCd ? segments.slice(1) : segments;
  if (probes.length !== 1 || analysis.operators.length !== (leadingCd ? 1 : 0)) return undefined;
  const args = probes[0];
  if (args[0] !== "git" || hasUnsafeReadOptions(args)) return undefined;
  const separator = args.indexOf("--");
  const options = args.slice(2, separator < 0 ? undefined : separator);
  const paths = separator >= 0 && separator < args.length - 1;
  if (args[1] === "status") return `working-tree status${paths || options.some((arg) => !arg.startsWith("-")) ? " (path-limited)" : ""}${options.includes("--untracked-files=no") || options.includes("-uno") ? " (untracked excluded)" : ""}`;
  if (args[1] !== "diff") return undefined;
  const revisions = options.filter((arg) => !arg.startsWith("-"));
  const scope = revisions.length ? "revision comparison" : options.some((arg) => arg === "--cached" || arg === "--staged") ? "index diff" : "worktree diff (unstaged tracked files)";
  return `${scope}${paths ? " (path-limited)" : ""}${options.includes("--check") ? "; whitespace check" : options.includes("--stat") ? "; stat" : options.includes("--name-only") ? "; names" : ""}`;
}

export function isWorkingTreeCommand(command: string): boolean {
  return gitProbeScope(command) !== undefined;
}

function summarizeResultLines(result: string, empty: string): string {
  const lines = result.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 3);
  return lines.length > 0 ? lines.join("; ") : empty;
}

export function verificationIdentity(call: PendingToolCall, sessionCwd?: string): string | undefined {
  const command = shellCommand(call);
  if (!command) return undefined;
  const cwd = effectiveShellCwd(command, argString(call.args, "cwd") ?? sessionCwd);
  if (analyzeShell(command).segments[0]?.[0] === "cd" && !cwd) return undefined;
  return JSON.stringify([call.name, command, cwd ?? null]);
}

function collectShellMarkers(
  call: PendingToolCall,
  result: string,
  isError: boolean,
  verification: Map<string, VerificationReceipt>,
  workingTree: OrderedSet,
  sessionCwd: string | undefined,
  mutationEpoch: number,
  observation?: VerificationObservation,
  state?: EvidenceState,
  fresh = true,
  sourceSequence?: number,
): boolean {
  const command = shellCommand(call);
  if (!command) return false;
  const cwd = effectiveShellCwd(command, argString(call.args, "cwd") ?? sessionCwd);
  let captured = false;
  if (isVerificationCommand(command)) {
    const identity = verificationIdentity(call, sessionCwd);
    if (identity) {
      const observed = observation ?? observeVerification(result, isError);
      verification.delete(identity);
      verification.set(identity, {
        sourceSequence,
        status: observed.status,
        tool: call.name,
        command,
        cwd,
        evidence: observed.evidence,
        mutationEpoch,
        freshnessEstablished: fresh && canEstablishFreshVerification(command) && Boolean(cwd && isAbsolute(cwd)),
      });
    }
    captured = true;
  }
  const gitScope = gitProbeScope(command);
  if (gitScope && !isError && observation?.status !== "INCOMPLETE" && observation?.status !== "FAIL") {
    const evidence = summarizeResultLines(result, "no output from scoped probe; working-tree cleanliness not established");
    if (state) state.git.push({ command, cwd, scope: gitScope, evidence, mutationEpoch, freshnessEstablished: fresh && Boolean(cwd && isAbsolute(cwd)) });
    else workingTree.add(`[git receipt, cwd=${cwd ?? "unknown"}] scope=${gitScope}; ${command}: ${evidence}`);
    captured = true;
  }
  return captured;
}

export function collectConversationToolCall(
  block: NormalizedBlock,
  pendingCalls: PendingToolCall[],
  fingerprints: Map<string, ToolCallFingerprint>,
  fingerprintOrder: string[],
  state?: EvidenceState,
  sessionCwd?: string,
): { pendingTool: string; pendingFile: string } {
  const name = block.name ?? "";
  const args = block.args ?? {};
  const call: PendingToolCall = { name, callId: block.callId, args };
  const path = extractPath(args);
  if (state) {
    call.startedAt = ++state.sequence;
    call.overlappingMutation = pendingCalls.some((pending) => pending.potentiallyModifying);
    call.potentiallyModifying = classifyToolEffect(name, args).potentiallyModifying;
    if (call.potentiallyModifying) state.mutationEpoch++;
    call.startedEpoch = state.mutationEpoch;
    if (fileWriteTools.has(name.toLowerCase())) state.risks.push({ call, path: path ?? "unknown target", identity: path ? pathIdentity(path, argString(args, "cwd") ?? sessionCwd) : `unknown:${state.sequence}` });
  }
  pendingCalls.push(call);
  recordToolFingerprint(name, args, fingerprints, fingerprintOrder);
  const fingerprint = fingerprints.get(`${name}:${fingerprintKey(name, args)}`);
  if (fingerprint) fingerprint.sourceSequence = block.sourceSequence;
  return { pendingTool: name, pendingFile: path ?? "" };
}

function recordToolFileAccess(
  name: string,
  path: string,
  readFiles: OrderedSet,
  modifiedFiles: OrderedSet,
  createdFiles: OrderedSet,
): void {
  const boundedPath = sliceU16(path, 512);
  const canonicalName = name.toLowerCase();
  if (fileReadTools.has(canonicalName)) readFiles.add(boundedPath);
  if (fileWriteTools.has(canonicalName)) modifiedFiles.add(boundedPath);
  if (fileCreateTools.has(canonicalName)) createdFiles.add(boundedPath);
}

function recordToolFingerprint(
  name: string,
  args: Record<string, unknown>,
  fingerprints: Map<string, ToolCallFingerprint>,
  fingerprintOrder: string[],
): void {
  const key = fingerprintKey(name, args);
  const mapKey = `${name}:${key}`;
  const existing = fingerprints.get(mapKey);
  if (existing) {
    existing.count += 1;
    moveKeyToEnd(fingerprintOrder, mapKey);
    return;
  }
  fingerprints.set(mapKey, { name, key, count: 1 });
  fingerprintOrder.push(mapKey);
}

export function collectConversationToolResult(
  block: NormalizedBlock,
  pendingCalls: PendingToolCall[],
  verification: Map<string, VerificationReceipt>,
  workingTree: OrderedSet,
  activeTasks: OrderedSet,
  sourceAnchors: OrderedSet,
  readFiles: OrderedSet,
  modifiedFiles: OrderedSet,
  createdFiles: OrderedSet,
  resumeRisks: OrderedSet,
  errorResults: ToolResultEntry[],
  recentResults: ToolResultEntry[],
  omittedErrorResults: number,
  omittedRecentResults: number,
  sessionCwd: string | undefined,
  mutationEpoch: number,
  lastErrorRun?: { current?: ToolResultEntry },
  state?: EvidenceState,
): { pendingError: boolean; omittedErrorResults: number; omittedRecentResults: number; mutationEpoch: number } {
  const text = (block.text ?? "").trim();
  const ambiguousCandidates = !block.callId
    ? pendingCalls.filter((pending) => !pending.callId && pending.name === (block.name ?? "")).length : 0;
  if (ambiguousCandidates > 1) {
    // Marker rendering escapes this bounded text. Empty results must retain it too.
    addMarkerLine(resumeRisks, `Ambiguous ID-less result for ${sliceU16(block.name ?? "", 48)}: ${ambiguousCandidates} same-name calls remain pending; effects and provenance unresolved.`);
  }
  const { call, matched } = popPendingToolCall(pendingCalls, block.name ?? "", block.callId, state?.duplicateIds);
  const isError = block.isError === true;
  const succeeded = block.isError === false;
  const path = matched ? extractPath(call.args) : undefined;
  let fresh = true;
  if (state) {
    state.sequence++;
    fresh = matched && !call.overlappingMutation && call.startedEpoch === state.mutationEpoch;
    if (matched && call.potentiallyModifying) state.mutationEpoch++;
    // Even an unpaired modifying completion fences older observations.
    if (!matched && classifyToolEffect(block.name ?? "").potentiallyModifying) state.mutationEpoch++;
    mutationEpoch = state.mutationEpoch;
    if (!matched && fileWriteTools.has((block.name ?? "").toLowerCase()) && !pendingCalls.some((pending) => pending.callId === block.callId && pending.name === block.name)) {
      state.risks.push({ call, path: "unknown target", identity: `orphan:${state.sequence}`, terminalAt: state.sequence, failed: isError });
    }
    const risk = state.risks.find((risk) => risk.call === call);
    if (risk) { risk.terminalAt = state.sequence; risk.failed = isError; }
    if (matched && succeeded && path && (fileReadTools.has(call.name.toLowerCase()) || fileWriteTools.has(call.name.toLowerCase()))) {
      const identity = pathIdentity(path, argString(call.args, "cwd") ?? sessionCwd);
      state.risks = state.risks.filter((risk) => risk.identity !== identity || risk.terminalAt === undefined || risk.terminalAt >= (call.startedAt ?? state.sequence));
      if (risk) state.risks = state.risks.filter((item) => item !== risk);
    }
  } else {
    if (classifyToolEffect(block.name ?? "", matched ? call.args : undefined).potentiallyModifying) mutationEpoch++;
  }
  if (state && matched && path) {
    const cwd = argString(call.args, "cwd") ?? sessionCwd;
    const identity = pathIdentity(path, cwd);
    if (fileWriteTools.has(call.name.toLowerCase())) state.modifiedPaths.add(identity);
    if (fileReadTools.has(call.name.toLowerCase())) state.fileReads.push({
      id: `observation:${state.sequence}:${call.callId ?? call.name}`,
      runner: call.name, path: identity, cwd,
      status: isError ? "failed" : succeeded && !block.hostTruncated ? "succeeded" : "incomplete",
      mutationEpoch, freshnessEstablished: fresh && Boolean(cwd && isAbsolute(cwd)),
      imports: Object.freeze([...(block.suppliedImports ?? [])]),
    });
  }
  if (matched && succeeded) {
    collectSourceAnchorsFromValue(sourceAnchors, call.args);
    if (path) recordToolFileAccess(call.name, path, readFiles, modifiedFiles, createdFiles);
  }
  const capturedAsMarker = matched && collectShellMarkers(
    call,
    text,
    isError,
    verification,
    workingTree,
    sessionCwd,
    mutationEpoch,
    block.verificationObservation ?? observeVerification(text, block.isError),
    state,
    fresh,
    block.sourceSequence,
  );
  collectActiveTasks(call, text, isError, activeTasks);
  if (!text || capturedAsMarker) {
    return { pendingError: isError, omittedErrorResults, omittedRecentResults, mutationEpoch };
  }

  const artifactReceipt = extractOutputArtifactReceipt(text);
  const target = path ? `[target: ${path}] ` : "";
  const entry: ToolResultEntry = {
    sourceSequence: block.sourceSequence,
    toolName: block.name ?? "",
    text: artifactReceipt ?? sliceU16(`${target}${text}`, isError ? 500 : 300),
    isError,
    artifactReceipt: Boolean(artifactReceipt),
    count: 1,
  };
  if (entry.isError) {
    if (HARNESS_ERROR_SKIP.some((needle) => text.includes(needle))) {
      return { pendingError: true, omittedErrorResults, omittedRecentResults, mutationEpoch };
    }
    if (
      lastErrorRun?.current &&
      lastErrorRun.current.toolName === entry.toolName &&
      lastErrorRun.current.text === entry.text
    ) {
      lastErrorRun.current.count = (lastErrorRun.current.count ?? 1) + 1;
      lastErrorRun.current.sourceSequence = block.sourceSequence;
    } else {
      errorResults.push(entry);
      if (lastErrorRun) lastErrorRun.current = entry;
      if (errorResults.length > 10) {
        errorResults.shift();
        omittedErrorResults += 1;
      }
    }
  } else {
    if (lastErrorRun) lastErrorRun.current = undefined;
    recentResults.push(entry);
    if (recentResults.length > 15) {
      const removable = recentResults.findIndex((result) => !result.artifactReceipt);
      if (removable >= 0) {
        recentResults.splice(removable, 1);
        omittedRecentResults += 1;
      }
    }
  }
  return { pendingError: isError, omittedErrorResults, omittedRecentResults, mutationEpoch };
}

function extractOutputArtifactReceipt(text: string): string | undefined {
  if (!text.startsWith("[dc-distill] Compacted ") && !text.startsWith(LEGACY_OUTPUT_NOTICE_PREFIX)) return undefined;
  const path = text.match(/^Full output saved; read this path if needed:\s*(.+)$/m)?.[1]?.trim();
  const receipt = text.match(/^Receipt:\s*sha256=([a-f0-9]{64})\s+bytes=(\d+)\s+strategy=(diagnostic|diff|json|test|search|generic)$/m);
  if (!path || !receipt) return undefined;
  return `tool-reported artifact: ${path} sha256=${receipt[1]} bytes=${receipt[2]} strategy=${receipt[3]}`;
}

/** Immutable identities and chronology, taken before presentation shortening. */
export function snapshotObservations(state: EvidenceState, receipts: Map<string, VerificationReceipt>): ObservationSnapshot {
  return Object.freeze({ mutationEpoch: state.mutationEpoch,
    fileReads: Object.freeze(state.fileReads.map((read) => Object.freeze({ ...read, imports: Object.freeze([...read.imports]) }))),
    verification: Object.freeze([...receipts].map(([id, receipt]) => Object.freeze({ ...receipt, id }))),
    modifiedPaths: Object.freeze([...state.modifiedPaths]),
  });
}

/** Advisory priorities only; these never preserve or manufacture a fresh pass. */
export function transcriptChangeImpact(snapshot: ObservationSnapshot): string[] {
  const modified = new Set(snapshot.modifiedPaths);
  if (!modified.size) return [];
  const hints: string[] = [];
  for (const receipt of snapshot.verification) {
    if (!receipt.cwd || !isAbsolute(receipt.cwd)) continue;
    const analysis = analyzeShell(receipt.command);
    if (!analysis.supported) continue;
    const paths = analysis.segments.flatMap((args) => args.slice(1)).filter((arg) => !arg.startsWith("-") && /(?:\/|\.[A-Za-z0-9]+$)/.test(arg));
    const intersections = paths.map((path) => pathIdentity(path, receipt.cwd)).filter((path) => modified.has(path));
    if (intersections.length) hints.push(`Transcript-derived rerun priority (exact command path): receipt ${receipt.id}; runner=${receipt.tool}; cwd=${receipt.cwd}; command=${receipt.command}; modified=${[...new Set(intersections)].join(", ")}`);
  }
  for (const read of snapshot.fileReads) {
    if (read.status !== "succeeded" || !read.cwd || !isAbsolute(read.cwd) || !/(?:test|spec)(?:[./_-]|$)/i.test(read.path)) continue;
    const matches = read.imports.map((path) => resolve(read.path, "..", path)).filter((path) => modified.has(path));
    if (matches.length) hints.push(`Transcript-derived rerun priority (explicit relative import): read ${read.id}; test=${read.path}; modified=${[...new Set(matches)].join(", ")}`);
  }
  return hints.slice(0, 8);
}
