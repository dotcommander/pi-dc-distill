// Tests for dc-shrink/lib/focus-echo.ts
// Run: bun test extensions/dc-app/lib/knowledge/features/shrink/lib/focus-echo.test.ts

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
- extensions/dc-app/lib/knowledge/features/shrink/index.ts
- extensions/dc-app/lib/knowledge/features/shrink/lib/monitor.ts
</read-files>

<modified-files>
- extensions/dc-app/lib/knowledge/features/shrink/index.ts
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
    expect(result?.echoText).toStartWith("<shrink-focus-echo>");
    expect(result?.echoText).toEndWith("</shrink-focus-echo>");
  });
});
