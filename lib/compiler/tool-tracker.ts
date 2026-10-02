import { sliceU16, HARNESS_ERROR_SKIP, argString, OrderedSet, addMarkerLine, removeMarkerLine, removePartialEffectsRisksForPath, moveKeyToEnd, digest } from "./helpers.ts";
import { type NormalizedBlock, type ToolCallFingerprint, type ToolResultEntry, type PendingToolCall, type VerificationReceipt } from "./types.ts";
import { collectSourceAnchorsFromValue, collectActiveTasks } from "./anchors.ts";
import { LEGACY_OUTPUT_NOTICE_PREFIX } from "../legacy.ts";
import { codePointLength } from "../unicode.ts";
import { basename } from "node:path";

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

function effectiveShellCwd(command: string, fallback?: string): string | undefined {
  const match = command.trim().match(/^cd\s+(?:'([^']+)'|"([^"]+)"|([^;&|\s]+))\s+&&\s+/);
  return match ? (match[1] ?? match[2] ?? match[3]) : fallback;
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

function renderVerificationReceipt(
  receipt: VerificationReceipt,
  currentMutationEpoch: number,
): string {
  const rawCwd = receipt.cwd ?? "unknown";
  const cwd = codePointLength(rawCwd) <= 200
    ? rawCwd
    : `[cwd sha256:${digest(rawCwd).slice(0, 16)}]`;
  const scope = `${receipt.tool || "shell"} cwd=${cwd}`;
  const isStale = receipt.mutationEpoch < currentMutationEpoch;
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
    receipt.mutationEpoch >= mutationEpoch || receipt.status === "FAIL" || receipt.status === "INCOMPLETE");
  const stalePasses = all.filter((receipt) =>
    receipt.mutationEpoch < mutationEpoch && receipt.status === "PASS");
  const retained = [...current, ...stalePasses.slice(-1)];
  const values = retained.map((receipt) => renderVerificationReceipt(receipt, mutationEpoch));
  if (stalePasses.length > 1) {
    values.unshift(`... (${stalePasses.length - 1} stale verification receipts omitted)`);
  }
  if (values.length <= limit) return values;
  return [...values.slice(values.length - limit), `... (${values.length - limit} verification rows omitted)`];
}

const fileReadTools = new Set(["read", "read_file", "view", "view_file"]);

export const fileWriteTools = new Set(["edit", "write", "edit_file", "write_file", "multiedit", "write_to_file", "replace_file_content", "patch_file", "create_file"]);

const fileCreateTools = new Set(["write", "write_file", "write_to_file", "create_file"]);

function popPendingToolCall(
  calls: PendingToolCall[],
  resultName: string,
  resultCallId?: string,
): { call: PendingToolCall; matched: boolean } {
  if (resultCallId) {
    const idx = calls.findIndex((call) => call.callId === resultCallId);
    return idx >= 0
      ? { call: calls.splice(idx, 1)[0], matched: true }
      : { call: { name: resultName, callId: resultCallId }, matched: false };
  }
  const candidates = calls
    .map((call, index) => ({ call, index }))
    .filter(({ call }) => call.name === resultName && !call.callId);
  if (candidates.length !== 1) return { call: { name: resultName }, matched: false };
  return { call: calls.splice(candidates[0].index, 1)[0], matched: true };
}

function isShellTool(name: string): boolean {
  return ["bash", "shell", "jinn_run_shell", "functions.bash"].includes(name.toLowerCase());
}

export function shellCommand(call: PendingToolCall): string | undefined {
  if (!isShellTool(call.name)) return undefined;
  const command = argString(call.args, "command") ?? argString(call.args, "cmd");
  return command && command.trim() ? command : undefined;
}

export function isVerificationCommand(command: string): boolean {
  const controlLines: string[] = [];
  let heredocEnd: string | undefined;
  for (const line of command.split("\n")) {
    if (heredocEnd) {
      if (line.trim() === heredocEnd) heredocEnd = undefined;
      continue;
    }
    controlLines.push(line);
    const match = line.match(/<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/);
    if (match) heredocEnd = match[1];
  }
  const lower = controlLines.join(" ").toLowerCase().replace(/\s+/g, " ");
  return [
    "go test",
    "go build",
    "go vet",
    "golangci-lint",
    "go mod verify",
    "bun test",
    "npm test",
    "pnpm test",
    "yarn test",
    "cargo test",
    "pytest",
    "ruff",
    "mypy",
    "tsc",
    "typecheck",
    "lint",
    "just test",
    "just build",
    "git diff --check",
  ].some((marker) => lower.includes(marker));
}

function isKnownReadOnlyShellCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  return /^(?:pwd|ls(?:\s|$)|rg(?:\s|$)|grep(?:\s|$)|find(?:\s|$)|cat(?:\s|$)|head(?:\s|$)|tail(?:\s|$)|git\s+(?:status|diff)(?:\s|$))/.test(normalized);
}

export function isWorkingTreeCommand(command: string): boolean {
  const lower = command.toLowerCase();
  return (
    lower.includes("git status") ||
    lower.includes("git diff --stat") ||
    lower.includes("git diff --name-only") ||
    lower.includes("git diff --check")
  );
}

function resultEvidence(result: string): string {
  const lines = result.split("\n").map((value) => value.trim()).filter(Boolean);
  const explicitSummary = lines.findLast((line) =>
    /(?:\b\d+\s+(?:pass(?:ed)?|fail(?:ed)?|skip(?:ped)?|tests?)\b|\btests?:\s*\d+\b|\b(?:pass|fail|skip)(?:ed)?:\s*\d+\b)/i.test(line));
  if (explicitSummary) return explicitSummary;
  const statusLine = lines.findLast((line) =>
    /^(ok\s+|PASS\b|FAIL\b|--- FAIL|\?\s+)/.test(line) || line.toLowerCase().includes("command exited with code"));
  return statusLine ?? lines[0] ?? "no output";
}

function verificationStatus(result: string, isError: boolean): "PASS" | "FAIL" | "SKIP" {
  // "0 failed" / "failed: 0" / "0 failures" are pass evidence, not failures.
  const scrubbed = result.replace(/\b0 (?:failed|failures?)\b/gi, "").replace(/\bfail(?:ed|ures?)?:\s*0\b/gi, "");
  const lower = scrubbed.toLowerCase();
  if (isError || /command exited with code [1-9][0-9]*/.test(lower) || scrubbed.includes("FAIL") || lower.includes("failed")) return "FAIL";
  if (lower.includes("skip") || lower.includes("no tests to run")) return "SKIP";
  return "PASS";
}

function summarizeResultLines(result: string, empty: string): string {
  const lines = result.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 3);
  return lines.length > 0 ? lines.join("; ") : empty;
}

export function verificationIdentity(call: PendingToolCall, sessionCwd?: string): string | undefined {
  const command = shellCommand(call);
  if (!command) return undefined;
  const cwd = argString(call.args, "cwd") ?? sessionCwd;
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
): boolean {
  const command = shellCommand(call);
  if (!command) return false;
  const cwd = effectiveShellCwd(command, argString(call.args, "cwd") ?? sessionCwd);
  let captured = false;
  if (isVerificationCommand(command)) {
    const identity = verificationIdentity(call, sessionCwd);
    if (identity) {
      verification.delete(identity);
      verification.set(identity, {
        status: verificationStatus(result, isError),
        tool: call.name,
        command,
        cwd,
        evidence: resultEvidence(result),
        mutationEpoch,
      });
    }
    captured = true;
  }
  if (isWorkingTreeCommand(command) && !isError) {
    const empty = command.toLowerCase().includes("diff") && !command.toLowerCase().includes("check") ? "no diff" : "clean";
    addMarkerLine(workingTree, `[git receipt, cwd=${cwd ?? "unknown"}] ${stripCdPrefix(command)}: ${summarizeResultLines(result, empty)}`);
    captured = true;
  }
  return captured;
}

export function collectConversationToolCall(
  block: NormalizedBlock,
  pendingCalls: PendingToolCall[],
  fingerprints: Map<string, ToolCallFingerprint>,
  fingerprintOrder: string[],
): { pendingTool: string; pendingFile: string } {
  const name = block.name ?? "";
  const args = block.args ?? {};
  pendingCalls.push({ name, callId: block.callId, args });
  const path = extractPath(args);
  recordToolFingerprint(name, args, fingerprints, fingerprintOrder);
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
): { pendingError: boolean; omittedErrorResults: number; omittedRecentResults: number; mutationEpoch: number } {
  const text = (block.text ?? "").trim();
  const { call, matched } = popPendingToolCall(pendingCalls, block.name ?? "", block.callId);
  const isError = Boolean(block.isError);
  const path = matched ? extractPath(call.args) : undefined;
  if (matched && !isError) {
    collectSourceAnchorsFromValue(sourceAnchors, call.args);
    const command = shellCommand(call);
    if (command && !isKnownReadOnlyShellCommand(command)) mutationEpoch += 1;
    if (path) {
      recordToolFileAccess(call.name, path, readFiles, modifiedFiles, createdFiles);
      if (fileWriteTools.has(call.name.toLowerCase())) {
        mutationEpoch += 1;
        removeMarkerLine(
          resumeRisks,
          `Failed ${call.name} for ${path} may have partial effects; inspect before retry.`,
        );
      } else if (fileReadTools.has(call.name.toLowerCase())) {
        // A successful read of the same path is the inspection the marker asks
        // for ("inspect before retry"); it retires the risk without a retry write.
        removePartialEffectsRisksForPath(resumeRisks, path);
      }
    }
  } else if (matched && isError && path && fileWriteTools.has(call.name.toLowerCase())) {
    addMarkerLine(resumeRisks, `Failed ${call.name} for ${path} may have partial effects; inspect before retry.`);
  }
  const capturedAsMarker = matched && collectShellMarkers(
    call,
    text,
    isError,
    verification,
    workingTree,
    sessionCwd,
    mutationEpoch,
  );
  collectActiveTasks(call, text, isError, activeTasks);
  if (!text || capturedAsMarker) {
    return { pendingError: isError, omittedErrorResults, omittedRecentResults, mutationEpoch };
  }

  const artifactReceipt = extractOutputArtifactReceipt(text);
  const target = path ? `[target: ${path}] ` : "";
  const entry: ToolResultEntry = {
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
  return `artifact: ${path} sha256=${receipt[1]} bytes=${receipt[2]} strategy=${receipt[3]}`;
}
