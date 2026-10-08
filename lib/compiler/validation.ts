import { CompactionInputError } from "./errors.ts";

/** Reject malformed decoded Unicode rather than silently encoding replacement characters. */
export function assertValidUnicode(text: string): void {
  if (!text.isWellFormed()) throw new CompactionInputError("malformed decoded Unicode");
}
/** Structural checks apply before source bounding, including every omitted record. */
export function validateStructuralInput(value: unknown): void {
  let values = 0;
  let containers = 0;
  const active = new Set<object>();
  function visit(item: unknown, depth: number): void {
    if (++values > 1_000_000 || depth > 64) throw new CompactionInputError("source structural guard exceeded", "required_analysis_overflow");
    if (typeof item === "string") { assertValidUnicode(item); return; }
    if (item === null || typeof item === "boolean" || item === undefined) return;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new CompactionInputError("non-finite source number");
      return;
    }
    if (typeof item !== "object") throw new CompactionInputError("unsupported source value");
    if (++containers > 100_000) throw new CompactionInputError("source container guard exceeded", "required_analysis_overflow");
    if (active.has(item)) throw new CompactionInputError("cyclic source value");
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
      throw new CompactionInputError("non-plain source object");
    active.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    for (const key of Object.keys(descriptors)) {
      if (Array.isArray(item) && key === "length") continue;
      assertValidUnicode(key);
      const descriptor = descriptors[key]!;
      if (!('value' in descriptor)) throw new CompactionInputError("source accessor rejected");
      visit(descriptor.value, depth + 1);
    }
    active.delete(item);
  }
  visit(value, 0);
}
