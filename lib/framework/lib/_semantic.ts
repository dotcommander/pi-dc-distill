import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export interface SemanticPosition {
  line: number;
  character: number;
}

export interface SemanticRange {
  start: SemanticPosition;
  end: SemanticPosition;
}

export interface SemanticLocation {
  uri?: string;
  file?: string;
  range?: SemanticRange;
}

export interface SemanticSymbol {
  name: string;
  kind?: string;
  file?: string;
  range?: SemanticRange;
  container?: string | null;
}

export interface SemanticDiagnostic {
  message: string;
  severity?: number | string;
  code?: number | string;
  file?: string;
  range?: SemanticRange;
}

export interface SemanticTextEdit {
  file: string;
  range: SemanticRange;
  newText: string;
}

export type SemanticRefactorOperation =
  | "rename_symbol"
  | "rename"
  | "update_imports"
  | "delete_dead_code"
  | "extract_function"
  | "extract_variable"
  | "rename_file"
  | "move_file";

export interface SemanticRefactorRequest {
  operation: SemanticRefactorOperation;
  file: string;
  position: SemanticPosition;
  newName?: string;
  range?: SemanticRange;
}

export type SemanticRefactorResult =
  | { kind: "precise"; edits: SemanticTextEdit[] }
  | { kind: "unavailable"; reason: string };

export interface SemanticProvider {
  definition?(file: string, position: SemanticPosition): Promise<SemanticLocation[] | null>;
  references?(file: string, position: SemanticPosition): Promise<SemanticLocation[] | null>;
  hover?(file: string, position: SemanticPosition): Promise<string | null>;
  documentSymbols?(file: string): Promise<SemanticSymbol[] | null>;
  workspaceSymbols?(query: string): Promise<SemanticSymbol[] | null>;
  diagnostics?(file: string): Promise<SemanticDiagnostic[] | null>;
  refactor?(request: SemanticRefactorRequest): Promise<SemanticRefactorResult>;
}

export type SemanticCapabilityState =
  | { kind: "pending"; provider?: SemanticProvider }
  | { kind: "ready"; provider: SemanticProvider }
  | { kind: "unavailable"; reason: string };

export class SemanticRegistry {
  readonly #states = new Map<string, SemanticCapabilityState>();

  registerPending(workspace: string, provider?: SemanticProvider): void {
    this.#states.set(resolve(workspace), { kind: "pending", provider });
  }

  registerReady(workspace: string, provider: SemanticProvider): void {
    this.#states.set(resolve(workspace), { kind: "ready", provider });
  }

  markReady(workspace: string): boolean {
    const key = resolve(workspace);
    const state = this.#states.get(key);
    if (state?.kind !== "pending" || !state.provider) return false;
    this.#states.set(key, { kind: "ready", provider: state.provider });
    return true;
  }

  markUnavailable(workspace: string, reason: string): void {
    this.#states.set(resolve(workspace), { kind: "unavailable", reason });
  }

  get(workspace: string): SemanticCapabilityState | undefined {
    return this.#states.get(resolve(workspace));
  }

  clear(workspace: string): void {
    this.#states.delete(resolve(workspace));
  }
}

export type SemanticSentinelChangeType = "created" | "changed" | "deleted";

export interface SemanticSentinelChange {
  file: string;
  type: SemanticSentinelChangeType;
}

const IGNORED_SENTINEL_DIRS = new Set([".git", ".pnpm", "coverage", "dist", "node_modules"]);
const ROOT_LOCKFILES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

export function scanSemanticSentinels(workspace: string): Map<string, number> {
  const root = resolve(workspace);
  const snapshot = new Map<string, number>();
  if (!existsSync(root)) return snapshot;
  walkSentinels(root, root, snapshot);
  return snapshot;
}

export function diffSemanticSentinels(
  previous: Map<string, number>,
  next: Map<string, number>,
): SemanticSentinelChange[] {
  const changes: SemanticSentinelChange[] = [];
  for (const [file, mtime] of next) {
    const old = previous.get(file);
    if (old === undefined) {
      changes.push({ file, type: "created" });
    } else if (old !== mtime) {
      changes.push({ file, type: "changed" });
    }
  }
  for (const file of previous.keys()) {
    if (!next.has(file)) changes.push({ file, type: "deleted" });
  }
  return changes.sort((a, b) => a.file.localeCompare(b.file));
}

export function isSemanticSentinelPath(file: string, workspace: string): boolean {
  const root = resolve(workspace);
  return isSentinelPath(resolve(root, file), root);
}

function walkSentinels(root: string, dir: string, snapshot: Map<string, number>): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_SENTINEL_DIRS.has(entry.name)) walkSentinels(root, path, snapshot);
      continue;
    }
    if (!entry.isFile() || !isSentinelPath(path, root)) continue;
    try {
      snapshot.set(path, statSync(path).mtimeMs);
    } catch {
      // Deleted between readdir and stat.
    }
  }
}

function isSentinelPath(file: string, root: string): boolean {
  const name = basename(file);
  if (name === "package.json") return true;
  if (name === "jsconfig.json") return true;
  if (name === "tsconfig.json") return true;
  if (name.startsWith("tsconfig.") && name.endsWith(".json")) return true;
  if (file.endsWith(".d.ts")) return true;
  return dirname(file) === root && ROOT_LOCKFILES.has(name);
}

export interface SemanticCodeAction {
  title: string;
  kind?: string;
  edits?: SemanticTextEdit[];
}

export function normalizeSemanticRefactorOperation(
  operation: SemanticRefactorOperation,
): Exclude<SemanticRefactorOperation, "rename"> {
  return operation === "rename" ? "rename_symbol" : operation;
}

export function semanticActionMatchesOperation(
  action: SemanticCodeAction,
  operation: SemanticRefactorOperation,
): boolean {
  const normalized = normalizeSemanticRefactorOperation(operation);
  const kind = action.kind ?? "";
  const title = action.title.trim().toLowerCase();
  switch (normalized) {
    case "update_imports":
      return (
        kind === "source.organizeImports" ||
        kind.startsWith("source.organizeImports.") ||
        (kind === "" && title === "organize imports")
      );
    case "delete_dead_code":
      return (
        (kind === "quickfix" ||
          kind.startsWith("quickfix.") ||
          kind === "refactor.rewrite" ||
          kind.startsWith("refactor.rewrite.")) &&
        /(unused|dead code|remove unused|remove unreachable|remove declaration)/.test(title)
      );
    case "extract_function":
      return (
        kind === "refactor.extract.function" ||
        kind.startsWith("refactor.extract.function.") ||
        (title.includes("extract") && /\b(function|method)\b/.test(title))
      );
    case "extract_variable":
      return (
        kind === "refactor.extract.constant" ||
        kind.startsWith("refactor.extract.constant.") ||
        kind === "refactor.extract.variable" ||
        kind.startsWith("refactor.extract.variable.") ||
        (title.includes("extract") && /\b(constant|const|variable)\b/.test(title))
      );
    case "rename_symbol":
    case "rename_file":
    case "move_file":
      return false;
  }
}

export function selectPreciseSemanticRefactor(
  operation: SemanticRefactorOperation,
  actions: readonly SemanticCodeAction[],
): SemanticRefactorResult {
  const normalized = normalizeSemanticRefactorOperation(operation);
  if (normalized === "rename_file" || normalized === "move_file") {
    return {
      kind: "unavailable",
      reason: `Refactor operation "${normalized}" is not supported until file/resource edit rollback is owned.`,
    };
  }
  const matching = actions.filter((action) => semanticActionMatchesOperation(action, normalized));
  if (matching.length === 0) {
    return {
      kind: "unavailable",
      reason: `No matching precise code action is available for refactor operation "${normalized}".`,
    };
  }
  const precise = matching.find((action) => action.edits && action.edits.length > 0);
  if (!precise?.edits?.length) {
    return {
      kind: "unavailable",
      reason: `Matching code actions for refactor operation "${normalized}" did not produce precise edits.`,
    };
  }
  return { kind: "precise", edits: precise.edits };
}

export const Semantic = {
  Registry: SemanticRegistry,
  scanSentinels: scanSemanticSentinels,
  diffSentinels: diffSemanticSentinels,
  isSentinelPath: isSemanticSentinelPath,
  normalizeRefactorOperation: normalizeSemanticRefactorOperation,
  actionMatchesOperation: semanticActionMatchesOperation,
  selectPreciseRefactor: selectPreciseSemanticRefactor,
};
