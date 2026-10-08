import { resolveCwd } from "./cwd.ts";
import { sha256Identity } from "../sha256.ts";
import {
  argString, shorten,
  MAX_FILE_PATH_CODE_POINTS, MAX_COMMAND_RUNNER_CODE_POINTS,
  MAX_COMMAND_CODE_POINTS, MAX_COMMAND_CWD_CODE_POINTS, MAX_COMMAND_RESULT_CODE_POINTS,
} from "./helpers.ts";
import type { CommandFact, CompactionSource, FileFact, CertifiedRecord, ObservationFacts } from "./types.ts";

const fileReadTools = new Set(["read", "read_file", "view", "view_file"]);
const fileWriteTools = new Set(["edit", "write", "edit_file", "write_file", "multiedit", "write_to_file", "replace_file_content", "patch_file", "create_file"]);
const fileCreateTools = new Set(["write", "write_file", "write_to_file", "create_file"]);
const commandRunners = new Set(["bash", "shell", "jinn_run_shell", "functions.bash"]);

/** Path spelling is authoritative; never resolve, normalize, or shorten identity. */
export function extractPath(args: Readonly<Record<string, unknown>> | undefined): string | undefined {
  for (const key of ["path", "file_path", "filePath", "file", "targetFile", "TargetFile", "target_file", "target_path", "absolutePath", "AbsolutePath"]) {
    const value = argString(args, key);
    if (value) return value;
  }
  return undefined;
}


function replaceFile(files: Map<string, FileFact>, path: string, cwd: string | null, createCapable: boolean): void {
  const identityDigest = sha256Identity(JSON.stringify(["dc-distill-file", path, cwd]));
  const display = shorten(path, MAX_FILE_PATH_CODE_POINTS);
  // Reinsertion orders the complete observation by its most recent occurrence.
  files.delete(identityDigest);
  files.set(identityDigest, { identityDigest, path: display.text, shortened: display.shortened, createCapable, origin: "current" });
}

function commandFact(runner: string, command: string, cwd: string | null, status: CommandFact["status"], result: string): CommandFact {
  const identityDigest = sha256Identity(JSON.stringify(["dc-distill-command", runner, command, cwd]));
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
  const identified = new Map<string, Extract<CertifiedRecord, { kind: "tool-call" }>>();
  const certified = new Map<number, Extract<CertifiedRecord, { kind: "tool-call" }>>();
  for (const record of source.records) {
    if (record.kind === "tool-call") {
      if (record.pairing.state === "identified") identified.set(record.pairing.id, record);
      else if (record.pairing.state === "certified-idless") certified.set(record.pairing.key, record);
      continue;
    }
    if (record.kind === "bash") {
      const status = record.cancelled || !Number.isInteger(record.exitCode) ? "unknown" : record.exitCode === 0 ? "success" : "error";
      commands.push(commandFact("bash", record.command, resolveCwd(record.cwd, source.session.cwd), status, record.output));
      continue;
    }
    if (record.kind !== "tool-result") continue;
    const pairing = record.pairing;
    if (pairing.state === "unpairable") continue;
    const call = pairing.state === "identified" ? identified.get(pairing.id) : certified.get(pairing.key);
    if (!call || call.name !== record.name) continue;
    if (pairing.state === "identified") identified.delete(pairing.id);
    else certified.delete(pairing.key);
    const canonical = call.name.toLowerCase();
    const cwd = resolveCwd(call.args.cwd, source.session.cwd);
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
