/**
 * dc-audit/lib/diff-scope.ts — diff-aware audit scoping helpers
 * Arg parser and git diff changed-file discovery for audit workflows.
 * @module dc-audit/lib/diff-scope
 */

import { Cmd } from "../../../x/cmd.ts";

type ExecCapture = typeof Cmd.run;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChangedFile {
  readonly path: string;
  readonly status: "modified" | "added" | "renamed" | "copied";
}

interface AuditScopeOptions {
  readonly files: readonly string[];
  readonly ref: string;
  readonly staged: boolean;
}

interface AuditScopeDeps {
  readonly execCapture?: ExecCapture;
}

// ---------------------------------------------------------------------------
// Git diff
// ---------------------------------------------------------------------------

const STATUS_MAP: Record<string, ChangedFile["status"]> = {
  M: "modified",
  A: "added",
  R: "renamed",
  C: "copied",
};

/** Reject refs with chars outside [A-Za-z0-9._/\-] (argv injection guard). */
function validRef(s: string): boolean {
  return s.length > 0 && /^[A-Za-z0-9._/\-]+$/.test(s);
}

function parseDiffOutput(stdout: string): ChangedFile[] {
  const files: ChangedFile[] = [];

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;

    const parts = line.split("\t");
    const statusCode = parts[0]?.[0];
    if (!statusCode) continue;

    const status = STATUS_MAP[statusCode];
    if (!status) continue;

    // Renamed (R100\told\tnew) and copied (C100\told\tnew) have two paths; use the new one.
    const path =
      status === "renamed" || status === "copied" ? parts[2] : parts[1];
    if (path) {
      files.push({ path, status });
    }
  }

  return files;
}

export async function getAuditChangedFiles(
  cwd: string,
  options: AuditScopeOptions,
  deps: AuditScopeDeps = {},
): Promise<ChangedFile[]> {
  if (options.files.length > 0) {
    return options.files.map((path) => ({
      path,
      status: "modified" as const,
    }));
  }

  if (!validRef(options.ref) || options.ref.startsWith("-")) {
    throw new Error("changed-files: invalid ref");
  }

  const execCapture = deps.execCapture ?? Cmd.run;
  const args = ["diff", "--name-status"];
  if (options.staged) {
    args.push("--cached");
  } else {
    args.push(options.ref);
  }

  // Non-zero git exits (not a repo, bad ref) mean "no files"; thrown exec
  // failures (missing git, spawn errors) must propagate, not masquerade as
  // an empty change set.
  const result = await execCapture(["git", ...args], { cwd });
  if (result.exitCode === 0) {
    const files = parseDiffOutput(result.stdout);
    if (files.length > 0) return files;
  }

  // Default mode means "recently changed"; explicit modes should not widen.
  if (!options.staged && options.ref === "HEAD") {
    const fallback = await execCapture(
      ["git", "diff", "--name-status", "HEAD~1"],
      { cwd },
    );
    if (fallback.exitCode === 0) {
      return parseDiffOutput(fallback.stdout);
    }
  }

  return [];
}
