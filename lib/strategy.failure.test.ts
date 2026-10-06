import { describe, expect, test } from "bun:test";
import { CompactionCancelledError } from "./compaction-source.ts";
import {
  CompactionInputError,
  compilerFailureCode,
  type CompactionInputErrorCode,
} from "./compiler/errors.ts";
import { runStrategies } from "./strategy.ts";

// Throw at the strategy's input boundary without mocking shared compiler modules.
function throwingInput(error: unknown) {
  return { get canonicalInput(): string { throw error; } };
}

describe("structured strategy failure identity", () => {
  const inputCodes: CompactionInputErrorCode[] = [
    "invalid_input", "invalid_checkpoint", "protected_overflow", "required_analysis_overflow",
  ];

  for (const code of inputCodes) {
    test(`retains typed ${code} independently of reason text`, async () => {
      const result = await runStrategies(throwingInput(new CompactionInputError("same human reason", code)));
      expect(result).toEqual({
        ok: false,
        cancelled: false,
        reasons: ["algorithmic: same human reason"],
        failure: { code },
      });
    });
  }

  test("classifies actual malformed compiler input", async () => {
    const result = await runStrategies({ canonicalInput: "{malformed" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.cancelled).toBe(false);
    expect(result.failure).toEqual({ code: "invalid_input" });
    expect(result.reasons[0]).toStartWith("algorithmic: ");
  });

  test("missing input is an untyped compiler failure with its existing reason", async () => {
    expect(await runStrategies({})).toEqual({
      ok: false,
      cancelled: false,
      reasons: ["algorithmic: canonical compaction input unavailable"],
      failure: { code: "compiler_failure" },
    });
  });

  test("never derives typed codes from exception messages or code-shaped objects", async () => {
    for (const error of [
      new Error("protected_overflow invalid_checkpoint required_analysis_overflow invalid_input"),
      { code: "protected_overflow", message: "protected_overflow" },
      "invalid_checkpoint",
    ]) {
      expect(compilerFailureCode(error)).toBe("compiler_failure");
      const result = await runStrategies(throwingInput(error));
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.cancelled).toBe(false);
      expect(result.failure).toEqual({ code: "compiler_failure" });
    }
  });

  test("an already-aborted signal omits failure identity", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runStrategies({}, controller.signal);
    expect(result).toEqual({
      ok: false,
      cancelled: true,
      reasons: ["algorithmic: compaction cancelled"],
    });
    expect(Object.hasOwn(result, "failure")).toBe(false);
  });

  for (const error of [
    new CompactionCancelledError(),
    Object.assign(new Error("native abort"), { name: "AbortError" }),
    Object.assign(new Error("loader abort"), { name: "LoaderAbortError" }),
  ]) {
    test(`${error.name} omits failure identity`, async () => {
      const result = await runStrategies(throwingInput(error));
      expect(result).toEqual({
        ok: false,
        cancelled: true,
        reasons: [`algorithmic: ${error.message}`],
      });
      expect(Object.hasOwn(result, "failure")).toBe(false);
    });
  }
});
