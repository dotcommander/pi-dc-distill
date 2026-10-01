import { extractTagContent } from "./extract-tags.ts";
import { compileSessionFile, compileSessionJsonl } from "./local-compact.ts";
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
      readFiles: string[];
      modifiedFiles: string[];
      literalAnchors: string[];
      inputDigest: string;
      summaryDigest: string;
      digestScope: "compaction-input" | "bounded-compaction-input";
    }
  | { ok: false; cancelled: boolean; reasons: string[] };

interface CompileResult {
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
    readFiles: fileListOrSummaryTag(result.readFiles, summary, "read-files"),
    modifiedFiles: fileListOrSummaryTag(
      result.modifiedFiles,
      summary,
      "modified-files",
    ),
    literalAnchors: result.literalAnchors,
    inputDigest: result.inputDigest,
    summaryDigest: result.summaryDigest,
    digestScope: prep.digestScope ?? result.digestScope,
  };
};

function fileListOrSummaryTag(
  files: string[],
  summary: string,
  tagName: string,
): string[] {
  return files.length > 0 ? files : extractTagContent(summary, tagName);
}

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
