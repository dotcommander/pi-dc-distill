import type { ResumeCheckpointV1 } from "./compiler/checkpoint.ts";
import { compileSessionJsonl } from "./local-compact.ts";
import { compileSessionFile } from "./compile-session-file.ts";
import { CompactionCancelledError } from "./compaction-source.ts";

const MIN_USEFUL_LENGTH = 50;

interface CompactionPrep {
  userFocus?: string;
  recallEnabled?: boolean;
  canonicalInput?: string;
  digestScope?: "compaction-input" | "bounded-compaction-input";
  /** Diagnostic/test compatibility only. Production passes canonicalInput. */
  sessionFile?: string;
}

export type StrategyResult =
  | {
      ok: true;
      tier: 1;
      summary: string;
      checkpoint: ResumeCheckpointV1;
      checkpointDigest: string;
      readFiles: string[];
      modifiedFiles: string[];
      literalAnchors: string[];
      inputDigest: string;
      summaryDigest: string;
      digestScope: "compaction-input" | "bounded-compaction-input";
    }
  | { ok: false; cancelled: boolean; reasons: string[] };

interface CompileResult {
  checkpoint: ResumeCheckpointV1;
  checkpointDigest: string;
  summary: string;
  readFiles: string[];
  modifiedFiles: string[];
  literalAnchors: string[];
  inputDigest: string;
  summaryDigest: string;
  digestScope: "compaction-input" | "bounded-compaction-input";
}

const algorithmic = async (
  prep: CompactionPrep,
  signal?: AbortSignal,
): Promise<CompileResult> => {
  if (signal?.aborted) {
    throw new CompactionCancelledError();
  }

  const result = prep.canonicalInput !== undefined
    ? compileSessionJsonl(prep.canonicalInput, prep.userFocus, signal, prep.recallEnabled)
    : prep.sessionFile
      ? await compileSessionFile(prep.sessionFile, prep.userFocus, prep.recallEnabled)
      : (() => { throw new Error("canonical compaction input unavailable"); })();
  if (signal?.aborted) throw new CompactionCancelledError();
  const summary = result.summary.trim();

  if (summary.length < MIN_USEFUL_LENGTH) {
    throw new Error(`summary too short (${summary.length} chars)`);
  }

  return {
    summary,
    checkpoint: result.checkpoint,
    checkpointDigest: result.checkpointDigest,
    readFiles: result.readFiles,
    modifiedFiles: result.modifiedFiles,
    literalAnchors: result.literalAnchors,
    inputDigest: result.inputDigest,
    summaryDigest: result.summaryDigest,
    digestScope: prep.digestScope ?? result.digestScope,
  };
};

export const hasLocalCompactor = (): boolean => true;

export const runStrategies = async (
  prep: CompactionPrep,
  signal?: AbortSignal,
): Promise<StrategyResult> => {
  const reasons: string[] = [];
  let cancelled = Boolean(signal?.aborted);
  try {
    const result = await algorithmic(prep, signal);
    // algorithmic() already enforces MIN_USEFUL_LENGTH; no re-check needed.
    return {
      ok: true,
      tier: 1,
      summary: result.summary,
      checkpoint: result.checkpoint,
      checkpointDigest: result.checkpointDigest,
      readFiles: result.readFiles,
      modifiedFiles: result.modifiedFiles,
      literalAnchors: result.literalAnchors,
      inputDigest: result.inputDigest,
      summaryDigest: result.summaryDigest,
      digestScope: result.digestScope,
    };
  } catch (err) {
    reasons.push(
      `algorithmic: ${err instanceof Error ? err.message : String(err)}`,
    );
    cancelled = cancelled || err instanceof CompactionCancelledError
      || (err instanceof Error && (err.name === "AbortError" || err.name === "LoaderAbortError"));
  }
  return { ok: false, cancelled, reasons };
};
