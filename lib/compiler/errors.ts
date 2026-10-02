export class CompactionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompactionInputError";
  }
}
