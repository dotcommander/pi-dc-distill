import { describe, expect, test } from "bun:test";
import { assertValidUnicode, conversationalExcerpt, EXCERPT_GAP, shorten, saturatingAdd, validateStructuralInput } from "./helpers.ts";

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


describe("bounded conversational source spans", () => {
  test("fitting text and carried snippets remain exact, with literal factual clipping", () => {
    const text = 'literal \" | 😀\n[... excerpt gap ...]';
    expect(conversationalExcerpt(text, 2048)).toEqual({ text, shortened: false });
    const long = "identity ".repeat(400) + "Which later value?";
    expect(shorten(long, 512).text).toBe(Array.from(long).slice(0, 512).join(""));
    expect(shorten(long, 512).text).not.toContain(EXCERPT_GAP);
    const reduced = conversationalExcerpt(long, 2048);
    expect(conversationalExcerpt(reduced.text, 2048)).toEqual({ text: reduced.text, shortened: false });
  });
  test("late prose questions survive a long opening and trailing protocol", () => {
    const question = "Which JSON value is measured after escaping?";
    const input = "Opening context. " + "Inventory detail. ".repeat(180) + question +
      "\n\n# Protocol\n" + "- Ordinary instruction.\n".repeat(180);
    const result = conversationalExcerpt(input, 2048);
    expect(result.shortened).toBe(true);
    expect(result.text).toContain(question);
    expect(result.text).toContain(EXCERPT_GAP);
    expect(Array.from(result.text).length).toBeLessThanOrEqual(2048);
    for (const span of result.text.split(EXCERPT_GAP).map(part => part.trim()).filter(Boolean)) expect(input).toContain(span);
  });
  test("distributed sections retain later findings and deferred qualifications", () => {
    const finding = "- The archived receipt contradicts the completion claim.";
    const qualification = "- Measurement remains pending; this scope is deferred.";
    const input = "# Inventory\n" + "- Listed item without a conclusion.\n".repeat(160) +
      "# Findings\n" + finding + "\n# Deferred\n" + qualification;
    const text = conversationalExcerpt(input, 2048).text;
    expect(text).toContain(finding); expect(text).toContain(qualification);
    expect(text.indexOf(finding)).toBeLessThan(text.indexOf(qualification));
  });
  test("fenced and inline code questions do not displace prose, and Unicode stays whole", () => {
    const codeQuestion = "Should code become a prose question?";
    const input = "Opening prose.\n````ts\n" + "const value = 1;\n".repeat(200) +
      '`' + codeQuestion + '`\n```\n' + "const more = 2;\n".repeat(80) +
      "````\nWhich observed value is still unknown?\n" + "😀|\\\" detail. ".repeat(250);
    const result = conversationalExcerpt(input, 2048);
    expect(result.text).toContain("Which observed value is still unknown?");
    expect(result.text).not.toContain(codeQuestion);
    expect(() => assertValidUnicode(result.text)).not.toThrow();
    for (const limit of [0, 1, 32, 128, 2048]) {
      const clipped = conversationalExcerpt(input, limit);
      expect(Array.from(clipped.text).length).toBeLessThanOrEqual(limit);
      expect(() => assertValidUnicode(clipped.text)).not.toThrow();
    }
  });
});


test("matching inline delimiters retain code inside the complete prose question unit", () => {
  const actual = "Which observed measurement is still pending?";
  const padding = "Ordinary prose context. ".repeat(160);
  for (const code of [
    "``code with `embedded tick` Should this code question be selected?\nmore code``",
    "`code begins\nShould this multiline code question be selected?\ncode ends`",
  ]) {
    const input = padding + "\n" + code + "\n" + actual + "\n" + padding;
    const result = conversationalExcerpt(input, 2048);
    expect(result.text).toContain(actual);
    // Inline code remains inside its containing sentence; it is not a prose-question boundary.
    expect(result.text).toContain(code);
    expect(result.text).toContain(EXCERPT_GAP);
    expect(Array.from(result.text).length).toBeLessThanOrEqual(2048);
    expect(() => assertValidUnicode(result.text)).not.toThrow();
  }
});


describe("coherent Markdown excerpt units", () => {
  const padding = "Ordinary context sentence. ".repeat(180);
  test("inline paths and numbered items retain their complete surrounding claim", () => {
    const item = "1. `module/example.ts` delegates the event and preserves the recorded cursor.";
    const input = item + "\n\n" + padding;
    const text = conversationalExcerpt(input, 2048).text;
    expect(text).toContain(item);
    expect(text).not.toContain("1.\n[... excerpt gap ...]");
    expect(Array.from(text).length).toBeLessThanOrEqual(2048);
  });
  test("colon lead-ins, supporting fences and tables are indivisible", () => {
    const code = 'Reproduction:\n\n```text\nabc█ -> ab█c\n```';
    const table = "| Claim | Evidence | Status |\n| --- | --- | --- |\n| `capability()` preserves dimensions | recorded suite (7/7) | observed |";
    const input = code + "\n\n" + padding + "\n\n" + table;
    const text = conversationalExcerpt(input, 2048).text;
    expect(text).toContain(code); expect(text).toContain(table);
    expect(text.indexOf(code)).toBeLessThan(text.indexOf(table));
  });
  test("headings retain qualifications and terminal lead-ins are not isolated", () => {
    const qualification = "# Limits\n\nThis receipt covers the local probe; the complete host journey remains unmeasured.";
    const input = padding + "\n\n" + qualification + "\n\n# Unfinished\n\nNext step:\n\n1. ";
    const text = conversationalExcerpt(input, 2048).text;
    expect(text).toContain(qualification);
    expect(text).not.toContain("# Unfinished"); expect(text).not.toContain("Next step:");
    expect(text).not.toContain("1.");
  });
  test("attached oversized prose retains complete later questions without orphaning lead-ins", () => {
    const question = "Which recorded value determines the actual display budget?";
    for (const lead of ["# Investigation?", "Recorded context:"]) {
      for (const first of ["Opening context.", "Opening " + "x".repeat(2200) + "."]) {
        const input = lead + "\n\n" + first + " " + "Context remains recorded. ".repeat(120) + question +
          "\n\n# Protocol\n" + "- Follow the ordinary procedure.\n".repeat(100);
        const result = conversationalExcerpt(input, 2048);
        expect(result.shortened).toBe(true);
        expect(result.text).toContain(question);
        expect(Array.from(result.text).length).toBeLessThanOrEqual(2048);
        if (result.text.includes(lead)) expect(result.text).toContain(lead + "\n\n" + first);
        if (first.length > 2048) expect(result.text).not.toContain(lead);
        for (const span of result.text.split(EXCERPT_GAP).map(part => part.trim()).filter(Boolean)) expect(input).toContain(span);
      }
    }
  });
  test("inline delimiters crossing a lead-in preserve question masking at the prose offset", () => {
    const question = "Which budget applies?";
    for (const delimiter of ["`", "``"]) {
      const first = "Recorded " + delimiter + "context:\ncode question? still code" + delimiter +
        " Actual context " + "x".repeat(2200) + ".";
      const input = first + " " + "Other context. ".repeat(100) + question +
        "\n\n# Protocol\n" + "- Ordinary instruction.\n".repeat(100);
      const text = conversationalExcerpt(input, 2048).text;
      expect(text).toContain(question);
      expect(text).not.toContain("code question?");
      expect(text).not.toContain("Recorded ");
      expect(Array.from(text).length).toBeLessThanOrEqual(2048);
      for (const span of text.split(EXCERPT_GAP).map(part => part.trim()).filter(Boolean)) expect(input).toContain(span);
    }
  });
  test("oversized structural blocks are omitted whole and irreducible input uses literal fallback", () => {
    const list = "- Large item " + "x".repeat(2200) + "\n  continuation remains attached.";
    const question = "Which measurement remains pending?";
    const input = list + "\n\n" + question;
    expect(conversationalExcerpt(input, 2048).text).toContain(question);
    expect(conversationalExcerpt(input, 2048).text).not.toContain("Large item");
    const irreducible = "😀".repeat(3000);
    expect(conversationalExcerpt(irreducible, 2048)).toEqual(shorten(irreducible, 2048));
    expect(conversationalExcerpt("# Only a heading\n" + " ".repeat(2200), 32)).toEqual(shorten("# Only a heading\n" + " ".repeat(2200), 32));
  });
});


test("list items retain nested continuations and supporting code as one unit", () => {
  const item = "1. Diagnose the recorded cursor without claiming full host verification.\n" +
    "   - Nested observation retains its qualification.\n" +
    "   ```text\n   abc█ -> ab█c\n   ```";
  const input = item + "\n2. Next item.\n\n" + "Other complete sentence. ".repeat(200);
  const text = conversationalExcerpt(input, 2048).text;
  expect(text).toContain(item);
  expect(text).not.toContain("1.\n[... excerpt gap ...]");
});


test("delimiter-confirmed tables with optional outer pipes remain whole", () => {
  const question = "Next question?";
  for (const outer of [false, true]) {
    const row = (text: string) => outer ? `| ${text} |` : text;
    const table = [row("Claim | Evidence | Status"), row("--- | --- | ---"),
      row("Deploy approved. | no evidence | " + "Qualification remains unresolved. ".repeat(12) + "Superseded; do not deploy.")].join("\n");
    const result = conversationalExcerpt(table + "\n\n" + question, 150);
    expect(result.text).toContain(question);
    expect(result.text).not.toContain("Deploy approved.");
    expect(result.text).not.toContain("no evidence");
    expect(Array.from(result.text).length).toBeLessThanOrEqual(150);
    const fitting = row("Claim | Evidence | Status") + "\n" + row(":--- | ---: | :---:") + "\n" +
      row('`a|b` and a\\|b stay recorded | direct observation | qualified.');
    const selected = conversationalExcerpt(fitting + "\n\n" + "Other complete sentence. ".repeat(150), 2048);
    expect(selected.text).toContain(fitting);
  }
  const prose = "An ordinary a\\|b spelling and `x|y` example. " + "Context sentence. ".repeat(160);
  expect(conversationalExcerpt(prose, 150).text).toContain("An ordinary a\\|b spelling and `x|y` example.");
});
