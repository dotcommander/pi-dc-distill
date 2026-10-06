import { expect, test } from "bun:test";
import { codePointLength, codePointPrefix, codePointSuffix } from "./unicode.ts";

test("code-point scans retain string-iterator semantics at all prefix limits", () => {
  const samples = ["", "ASCII", "😀a𝄞", "e\u0301😀", "\ud800x\udc00", "\ud800\ud800\udc00\udc00", "a\r\nb"];
  for (const text of samples) {
    expect(codePointLength(text)).toBe(Array.from(text).length);
    for (const limit of [-Infinity, -20, -2, -1, -0, 0, 1, 2, 3, 20, 1.9, NaN, Infinity]) {
      expect(codePointPrefix(text, limit)).toBe(Array.from(text).slice(0, limit).join(""));
    }
  }
});

test("code-point suffixes use prefix limit normalization and keep zero empty", () => {
  const samples = ["", "ASCII", "😀a𝄞", "e\u0301😀", "\ud800x\udc00", "\ud800\ud800\udc00\udc00"];
  for (const text of samples) {
    const characters = Array.from(text);
    for (const limit of [-Infinity, -20, -2, -1, -0, 0, 1, 2, 3, 20, 1.9, NaN, Infinity]) {
      let count = Number.isNaN(limit) ? 0 : Math.trunc(limit);
      if (count < 0) count = Math.max(0, characters.length + count);
      expect(codePointSuffix(text, limit)).toBe(count > 0 ? characters.slice(-count).join("") : "");
    }
  }
});
