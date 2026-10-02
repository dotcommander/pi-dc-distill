import { argString } from "./helpers.ts";
import { analyzeShell, shellSegmentHasUnsafeOptions } from "./shell-analysis.ts";

export const fileReadTools = new Set(["read", "read_file", "view", "view_file"]);
export const fileWriteTools = new Set(["edit", "write", "edit_file", "write_file", "multiedit", "write_to_file", "replace_file_content", "patch_file", "create_file"]);
export const fileCreateTools = new Set(["write", "write_file", "write_to_file", "create_file"]);
const nativeReadTools = new Set(["grep", "find", "ls"]);
// Local metadata exemptions are exact, unlike the established file aliases.
const metadataTools = new Set(["save_distill_handoff", "recall_compaction"]);

export function isShellTool(name: string): boolean {
  return ["bash", "shell", "jinn_run_shell", "functions.bash"].includes(name.toLowerCase());
}

export function isKnownReadOnlyShellCommand(command: string): boolean {
  const analysis = analyzeShell(command);
  return analysis.supported && analysis.segments.every((args) => {
    if (shellSegmentHasUnsafeOptions(args)) return false;
    if (["pwd", "ls", "rg", "grep", "find", "cat", "head", "tail"].includes(args[0])) return true;
    return args[0] === "git" && ["status", "diff"].includes(args[1]);
  });
}

export interface ToolEffect {
  kind: "read" | "metadata" | "write" | "shell" | "unknown";
  fileRead: boolean;
  fileWrite: boolean;
  fileCreate: boolean;
  potentiallyModifying: boolean;
}

/** Effects are conservative; recognizing a search never grants file provenance. */
export function classifyToolEffect(name: string, args?: Record<string, unknown>): ToolEffect {
  const canonical = name.toLowerCase();
  const fileRead = fileReadTools.has(canonical);
  const fileWrite = fileWriteTools.has(canonical);
  const fileCreate = fileCreateTools.has(canonical);
  const kind: ToolEffect["kind"] = metadataTools.has(name) ? "metadata"
    : fileRead || nativeReadTools.has(canonical) ? "read"
    : fileWrite ? "write" : isShellTool(name) ? "shell" : "unknown";
  const command = argString(args, "command") ?? argString(args, "cmd");
  const potentiallyModifying = kind === "write" || kind === "unknown"
    || (kind === "shell" && (!command || !isKnownReadOnlyShellCommand(command)));
  return { kind, fileRead, fileWrite, fileCreate, potentiallyModifying };
}
