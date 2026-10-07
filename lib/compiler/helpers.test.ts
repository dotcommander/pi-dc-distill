import { describe, expect, test } from "bun:test";
import { assertValidUnicode, shorten, saturatingAdd, validateStructuralInput } from "./helpers.ts";

describe("shared source guards", () => {
  test("shortening keeps supplementary code points whole", () => {
    expect(shorten("a😀b", 2)).toEqual({ text: "a😀", shortened: true });
    expect(shorten("a😀", 2)).toEqual({ text: "a😀", shortened: false });
  });
  test("rejects malformed Unicode at every structural depth", () => {
    expect(() => assertValidUnicode("\ud800")).toThrow("malformed decoded Unicode");
    expect(() => validateStructuralInput({ nested: ["\udc00"] })).toThrow();
    expect(() => validateStructuralInput({ ["\ud800"]: "ok" })).toThrow();
    expect(() => validateStructuralInput({ nested: ["😀"] })).not.toThrow();
  });
  test("rejects cyclic and accessor input without invoking accessors", () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expect(() => validateStructuralInput(value)).toThrow("cyclic source value");
    let invoked = false;
    const accessor = Object.defineProperty({}, "text", { enumerable: true, get() { invoked = true; return "text"; } });
    expect(() => validateStructuralInput(accessor)).toThrow("source accessor rejected");
    expect(invoked).toBe(false);
  });
  test("saturates carried omission counts", () => {
    expect(saturatingAdd(Number.MAX_SAFE_INTEGER, 4)).toBe(Number.MAX_SAFE_INTEGER);
    expect(saturatingAdd(3, 4)).toBe(7);
  });
});
