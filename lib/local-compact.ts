import { buildSummary, encodeSummary } from "./compiler/budget-formatter.ts";
import { checkAbort, validateStructuralInput } from "./compiler/helpers.ts";
import { extractObservations } from "./compiler/tool-tracker.ts";
import type { CompactionSource, CompileOptions, LocalCompileResult } from "./compiler/types.ts";

export { encodeSummary, decodeSummary, evictOldestOptional } from "./compiler/budget-formatter.ts";

/** Compile authoritative typed input directly; there is no replay/file parsing path. */
export function compileCompactionSource(source: CompactionSource, options: CompileOptions = {}): LocalCompileResult {
  checkAbort(options.signal);
  validateStructuralInput([source, options.focus]);
  const document = buildSummary(source, extractObservations(source), options);
  checkAbort(options.signal);
  return { summary: encodeSummary(document), document };
}
