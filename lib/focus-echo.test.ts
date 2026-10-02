// Tests for dc-distill/lib/focus-echo.ts
// Run: bun test extensions/dc-app/lib/knowledge/features/distill/lib/focus-echo.test.ts

import { describe, expect, test } from "bun:test";
import { __test__, injectFocusEcho } from "./focus-echo.ts";

const user = (text: string) => ({ role: "user", content: [{ type: "text", text }] });
const assistant = (text: string) => ({
  role: "compactionSummary",
  summary: text,
});

describe("injectFocusEcho", () => {
  test("returns undefined when no compaction summary is present", () => {
    expect(injectFocusEcho([user("hello"), assistant("ordinary reply")])).toBeUndefined();
  });

  test("injects a bounded echo before the last user message", () => {
    const summary = assistant(`_reduced context_

## User Focus
Finish the compact-status command.

<read-files>
- extensions/dc-app/lib/knowledge/features/distill/index.ts
- extensions/dc-app/lib/knowledge/features/distill/lib/monitor.ts
</read-files>

<modified-files>
- extensions/dc-app/lib/knowledge/features/distill/index.ts
</modified-files>

<resume-index>
- Continue wiring /compact-status.
- Run focused Bun tests.
</resume-index>`);

    const result = injectFocusEcho([user("start"), summary, user("continue")]);

    expect(result).toBeDefined();
    expect(result?.messages).toHaveLength(4);
    expect((result?.messages[2] as any).content[0].text).toContain(__test__.ECHO_MARKER);
    expect((result?.messages[2] as any).content[0].text).toContain("Focus: Finish the compact-status command.");
    expect((result?.messages[3] as any).content[0].text).toBe("continue");
  });

  test("prioritizes explicit resume state and risks in the echo", () => {
    const summary = assistant(`<resume-state>
provenance: explicit handoff; task state, not verification
objective: Finish parser repair.
next:
- Run parser tests.
</resume-state>
<resume-risks>
Failed edit may have partial effects; inspect before retry.
</resume-risks>`);
    const result = injectFocusEcho([summary, user("continue")]);

    expect(result?.echoText).toContain("Explicit resume state:");
    expect(result?.echoText).toContain("objective: Finish parser repair.");
    expect(result?.echoText).toContain("Resume risks:");
    expect(result?.echoText).not.toContain("provenance: explicit handoff");
  });

  test("deduplicates an existing echo marker", () => {
    const summary = assistant("<resume-index>\n- Resume here.\n</resume-index>");
    const existing = user(`${__test__.ECHO_MARKER}\nResume index:\n- Resume here.`);

    expect(injectFocusEcho([summary, existing, user("continue")])).toBeUndefined();
  });

  test("does not double-inject an echoed message list", () => {
    const summary = assistant("<resume-index>\n- Resume here.\n</resume-index>");
    const result = injectFocusEcho([summary, user("continue")]);

    expect(result).toBeDefined();
    expect(injectFocusEcho(result?.messages ?? [])).toBeUndefined();
  });

  test("keeps the echo marker balanced when bounded", () => {
    const summary = assistant(`<resume-index>\n${"continue the detailed plan ".repeat(200)}\n</resume-index>`);
    const result = injectFocusEcho([summary, user("continue")]);
    expect(result?.echoText.length).toBeLessThanOrEqual(1200);
    expect(result?.echoText).toStartWith("<distill-focus-echo>");
    expect(result?.echoText).toEndWith("</distill-focus-echo>");
  });
});


describe("Phase 5 focus echo bounds", () => {
  test("risks and intent precede state and supporting references", () => {
    const echo = __test__.buildEcho(`<resume-state>objective: ${"support ".repeat(300)}\nblocker: Await approval.</resume-state>
<resume-risks>Inspect the failed mutation first.</resume-risks>
<current-intent>Repair the parser.</current-intent>
<read-files>/src/parser.ts</read-files>`)!;
    expect(echo).toContain("Await approval.");
    expect(echo).toContain("Inspect the failed mutation first.");
    expect(echo).toContain("Current intent: Repair the parser.");
    expect(echo.indexOf("Blocker:")).toBeLessThan(echo.indexOf("Resume risks:"));
    expect(echo.indexOf("Resume risks:")).toBeLessThan(echo.indexOf("Current intent:"));
    expect(echo).toContain("Focus echo omitted");
    expect(Array.from(echo).length).toBeLessThanOrEqual(1200);
  });

  test("uses code points and preserves complete path identities", () => {
    const path = "/" + "😀".repeat(600);
    const oversized = "/" + "long-identity".repeat(200);
    const echo = __test__.buildEcho(`<current-intent>Resume.</current-intent>
<modified-files>${path}\n${oversized}</modified-files>`)!;
    expect(echo).toContain(path);
    expect(echo).not.toContain("/long-identity");
    expect(echo.length).toBeGreaterThan(1200);
    expect(Array.from(echo).length).toBeLessThanOrEqual(1200);
    expect(echo).toContain("Focus echo omitted 1 item(s).");
    expect(echo).toEndWith("</distill-focus-echo>");
  });

  test("summary text cannot introduce unbalanced nested marker framing", () => {
    const echo = __test__.buildEcho("<resume-risks>literal <risk> marker remains text</resume-risks>")!;
    expect(echo).toContain("&lt;risk&gt;");
    expect(echo.match(/<distill-focus-echo>/g)).toHaveLength(1);
    expect(echo.match(/<\/distill-focus-echo>/g)).toHaveLength(1);
  });
});
