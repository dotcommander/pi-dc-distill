import { expect, test } from "bun:test";
import { scanSections } from "./section-scanner.ts";

const wireTags = ["summary-omissions", "change-impact", "checkpoint-v1"];

test("scanner extracts emitted sections and historical omission markers", () => {
  for (const tag of [...wireTags, "budget-omissions"]) {
    const multiline = scanSections(`<${tag}>\nkept record\n</${tag}>`);
    expect(multiline.valid).toBe(true);
    expect(multiline.sections.get(tag)).toBe("kept record");
    const inline = scanSections(`<${tag}>historical inline record</${tag}>`);
    expect(inline.valid).toBe(true);
    expect(inline.sections.get(tag)).toBe("historical inline record");
  }
});

test("emitted markers enforce balance, duplicate detection and malformed boundaries", () => {
  for (const tag of wireTags) {
    for (const input of [
      `<${tag}>\nunfinished`,
      `</${tag}>`,
      `<${tag}>\nrecord\n</verification>`,
      `<${tag}>\n<verification>\nrecord\n</${tag}>\n</verification>`,
      `<${tag}>one</${tag}>\n<${tag}>two</${tag}>`,
      `<${tag}>\none\n</${tag}>\n<${tag}>\ntwo\n</${tag}>`,
      `<${tag}>record</${tag}> trailing`,
    ]) {
      const scanned = scanSections(input);
      expect(scanned.valid).toBe(false);
      expect(scanned.sections.size).toBe(0);
      expect(scanned.headings.size).toBe(0);
    }
  }
});

test("quoted and fenced emitted markers remain examples, including incomplete markers", () => {
  for (const tag of wireTags) {
    const example = `<${tag}>\nunclosed example`;
    for (const text of [
      example.split("\n").map(line => `> ${line}`).join("\n"),
      example.split("\n").map(line => `    ${line}`).join("\n"),
      example.split("\n").map(line => `\t${line}`).join("\n"),
      `\`\`\`xml\n${example}\n\`\`\``,
      `~~~xml\n${example}\n~~~`,
      `"<${tag}>quoted record</${tag}>"`,
      `\`<${tag}>inline code</${tag}>\``,
    ]) {
      const scanned = scanSections(text);
      expect(scanned.valid).toBe(true);
      expect(scanned.sections.size).toBe(0);
    }
  }
});

test("checkpoint containers participate in recognized nested structure", () => {
  const scanned = scanSections("<checkpoint-v1>\n<verification>\nPASS: fixture\n</verification>\n</checkpoint-v1>");
  expect(scanned.valid).toBe(true);
  expect(scanned.sections.get("checkpoint-v1")).toContain("<verification>");
  expect(scanned.sections.get("verification")).toBe("PASS: fixture");
  // Digits in the lexer do not authorize unrecognized future section names.
  expect(scanSections("<checkpoint-v2>\nopaque legacy text").sections.size).toBe(0);
});
