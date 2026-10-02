export class CompactionInputError extends Error {
  constructor(message: string, readonly code: "invalid_input" | "invalid_checkpoint" | "protected_overflow" | "required_analysis_overflow" = "invalid_input") {
    super(message);
    this.name = "CompactionInputError";
  }
}
