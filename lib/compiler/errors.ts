export type CompactionInputErrorCode = "invalid_input" | "incompatible_summary" | "protected_overflow" | "required_analysis_overflow";
export class CompactionInputError extends Error {
  constructor(message: string, readonly code: CompactionInputErrorCode = "invalid_input") {
    super(message);
    this.name = "CompactionInputError";
  }
}
