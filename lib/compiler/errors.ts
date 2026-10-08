export type CompactionInputErrorCode = "invalid_input" | "protected_overflow" | "required_analysis_overflow";
export class CompactionInputError extends Error {
  readonly code: CompactionInputErrorCode;
  constructor(message: string, code: CompactionInputErrorCode = "invalid_input") {
    super(message);
    this.code = code;
    this.name = "CompactionInputError";
  }
}
