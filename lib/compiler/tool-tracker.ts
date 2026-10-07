import {
  argString, digest, shorten,
  MAX_FILE_PATH_CODE_POINTS, MAX_COMMAND_RUNNER_CODE_POINTS,
  MAX_COMMAND_CODE_POINTS, MAX_COMMAND_CWD_CODE_POINTS, MAX_COMMAND_RESULT_CODE_POINTS,
} from "./helpers.ts";
import type { CommandFact, CompactionSource, FileFact, NormalizedRecord, ObservationFacts } from "./types.ts";

const fileReadTools = new Set(["read", "read_file", "view", "view_file"]);
const fileWriteTools = new Set(["edit", "write", "edit_file", "write_file", "multiedit", "write_to_file", "replace_file_content", "patch_file", "create_file"]);
const fileCreateTools = new Set(["write", "write_file", "write_to_file", "create_file"]);
const commandRunners = new Set(["bash", "shell", "jinn_run_shell", "functions.bash"]);

/** Certify before bounding so omitted records cannot create or redirect a pair. */
export function certifyIdlessPairs(records: readonly NormalizedRecord[]): void {
  const pending = new Map<string | undefined, NormalizedRecord[]>();
  let ordinal = 0;
  for (const record of records) {
    if (record.callId || (record.kind !== "tool-call" && record.kind !== "tool-result")) continue;
    record.idlessPairingKey = null;
    if (record.kind === "tool-call") {
      const calls = pending.get(record.name) ?? [];
      calls.push(record);
      pending.set(record.name, calls);
    } else {
      const calls = pending.get(record.name) ?? [];
      if (calls.length !== 1 || !calls[0].name || calls[0].name !== record.name) continue;
      calls[0].idlessPairingKey = record.idlessPairingKey = ordinal++;
      pending.delete(record.name);
    }
  }
}

/** Path spelling is authoritative; never resolve, normalize, or shorten identity. */
export function extractPath(args: Record<string, unknown> | undefined): string | undefined {
  for (const key of ["path", "file_path", "filePath", "file", "targetFile", "TargetFile", "target_file", "target_path", "absolutePath", "AbsolutePath"]) {
    const value = argString(args, key);
    if (value) return value;
  }
  return undefined;
}

function launchDirectory(call: NormalizedRecord, sessionCwd: string): string | null {
  return (argString(call.args, "cwd") ?? call.cwd ?? sessionCwd) || null;
}

function replaceFile(files: Map<string, FileFact>, path: string, cwd: string | null, createCapable: boolean): void {
  const identityDigest = digest(JSON.stringify(["dc-distill-file", path, cwd]));
  const display = shorten(path, MAX_FILE_PATH_CODE_POINTS);
  // Reinsertion orders the complete observation by its most recent occurrence.
  files.delete(identityDigest);
  files.set(identityDigest, { identityDigest, path: display.text, shortened: display.shortened, createCapable, origin: "current" });
}

function commandFact(runner: string, command: string, cwd: string | null, status: CommandFact["status"], result: string): CommandFact {
  const identityDigest = digest(JSON.stringify(["dc-distill-command", runner, command, cwd]));
  const displayRunner = shorten(runner, MAX_COMMAND_RUNNER_CODE_POINTS);
  const displayCommand = shorten(command, MAX_COMMAND_CODE_POINTS);
  const displayCwd = cwd === null ? null : shorten(cwd, MAX_COMMAND_CWD_CODE_POINTS);
  const displayResult = shorten(result, MAX_COMMAND_RESULT_CODE_POINTS);
  return {
    identityDigest, runner: displayRunner.text, command: displayCommand.text,
    cwd: displayCwd?.text ?? null, status, result: displayResult.text,
    shortened: displayRunner.shortened || displayCommand.shortened || Boolean(displayCwd?.shortened) || displayResult.shortened,
    origin: "current",
  };
}

/** Only current typed calls participate in pairing; prior rows are display observations. */
export function extractObservations(source: CompactionSource): ObservationFacts {
  const read = new Map<string, FileFact>();
  const modified = new Map<string, FileFact>();
  for (const fact of source.predecessor?.files.read ?? []) read.set(fact.identityDigest, { ...fact, origin: "prior" });
  for (const fact of source.predecessor?.files.modified ?? []) modified.set(fact.identityDigest, { ...fact, origin: "prior" });
  const commands: CommandFact[] = (source.predecessor?.commands ?? []).map((fact) => ({ ...fact, origin: "prior" }));
  const duplicateIds = new Set(source.duplicateCallIds);
  const seenCallIds = new Set<string>();
  const seenResultIds = new Set<string>();
  // Also guard callers supplying a typed source directly, before any pairing occurs.
  for (const record of source.records) {
    if (!record.callId || (record.kind !== "tool-call" && record.kind !== "tool-result")) continue;
    const seen = record.kind === "tool-call" ? seenCallIds : seenResultIds;
    if (seen.has(record.callId)) duplicateIds.add(record.callId);
    seen.add(record.callId);
  }
  const identified = new Map<string, NormalizedRecord>();
  const unidentified = new Map<string | undefined, NormalizedRecord[]>();
  const certified = new Map<number, NormalizedRecord>();
  for (const record of source.records) {
    if (record.kind === "tool-call") {
      if (record.callId) identified.set(record.callId, record);
      else if (typeof record.idlessPairingKey === "number") certified.set(record.idlessPairingKey, record);
      else if (record.idlessPairingKey === undefined) {
        const calls = unidentified.get(record.name) ?? [];
        calls.push(record);
        unidentified.set(record.name, calls);
      }
      continue;
    }
    if (record.kind === "bash") {
      if (record.command === undefined) continue;
      const status = record.cancelled || !Number.isInteger(record.exitCode) ? "unknown" : record.exitCode === 0 ? "success" : "error";
      commands.push(commandFact("bash", record.command, record.cwd || source.session.cwd || null, status, record.output ?? record.text));
      continue;
    }
    if (record.kind !== "tool-result") continue;
    if (record.callId && duplicateIds.has(record.callId)) continue;
    if (!record.callId && record.idlessPairingKey === null) continue;
    const candidates = record.callId ? [identified.get(record.callId)]
      : typeof record.idlessPairingKey === "number" ? [certified.get(record.idlessPairingKey)]
      : unidentified.get(record.name) ?? [];
    if (candidates.length !== 1) continue;
    const call = candidates[0];
    if (!call?.name || call.name !== record.name) continue;
    if (record.callId) identified.delete(record.callId);
    else if (typeof record.idlessPairingKey === "number") certified.delete(record.idlessPairingKey);
    else unidentified.delete(record.name);
    const canonical = call.name.toLowerCase();
    const cwd = launchDirectory(call, source.session.cwd);
    const path = extractPath(call.args);
    if (record.isError === false && path) {
      if (fileReadTools.has(canonical)) replaceFile(read, path, cwd, false);
      if (fileWriteTools.has(canonical)) replaceFile(modified, path, cwd, fileCreateTools.has(canonical));
    }
    if (commandRunners.has(canonical)) {
      const command = argString(call.args, "command") ?? argString(call.args, "cmd");
      if (command !== undefined) commands.push(commandFact(call.name, command, cwd,
        record.isError === false ? "success" : record.isError === true ? "error" : "unknown", record.text));
    }
  }
  return { files: { read: [...read.values()], modified: [...modified.values()] }, commands };
}
