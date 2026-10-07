import { expect, test } from "bun:test";
import { codePointLength, codePointPrefix } from "./unicode.ts";

test("code-point scans retain string-iterator semantics at all prefix limits", () => {
  const samples = ["", "ASCII", "😀a𝄞", "e\u0301😀", "\ud800x\udc00", "\ud800\ud800\udc00\udc00", "a\r\nb"];
  for (const text of samples) {
    expect(codePointLength(text)).toBe(Array.from(text).length);
    for (const limit of [-Infinity, -20, -2, -1, -0, 0, 1, 2, 3, 20, 1.9, NaN, Infinity]) {
      expect(codePointPrefix(text, limit)).toBe(Array.from(text).slice(0, limit).join(""));
    }
  }
});

test("clipped prefixes preserve astral, combining, and isolated surrogate output", () => {
  const head = "😀e\u0301𝄞\ud800x\udc00";
  const text = head + "z".repeat(1_000_000);
  expect(codePointPrefix(text, 7)).toBe(head);
  expect(codePointLength(codePointPrefix(text, 7))).toBe(7);
});
