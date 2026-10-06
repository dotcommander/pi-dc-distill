export type CompactionInputErrorCode =
  | "invalid_input"
  | "invalid_checkpoint"
  | "protected_overflow"
  | "required_analysis_overflow";

export type CompilerFailureCode = CompactionInputErrorCode | "compiler_failure";

export class CompactionInputError extends Error {
  constructor(message: string, readonly code: CompactionInputErrorCode = "invalid_input") {
    super(message);
    this.name = "CompactionInputError";
  }
}

export function compilerFailureCode(error: unknown): CompilerFailureCode {
  return error instanceof CompactionInputError ? error.code : "compiler_failure";
}
