import { describe, expect, test } from "bun:test";
import {
  compactionCardSpec,
  type CompactionCardDetails,
} from "./compaction-card.ts";

const details: CompactionCardDetails = {
  tokensBefore: 163_201,
  tokensAfter: 22_695,
  apiTokensBefore: 161_997,
  reductionPct: 86,
  summaryTokens: 4_463,
  compactor: "dc-distill",
  version: 6,
  tier: 1,
  digestScope: "compaction-input",
};

describe("compaction card", () => {
  test("renders compact metrics in the house record style", () => {
    expect(compactionCardSpec({ content: "Summary", details }, false))
      .toEqual({
        kind: "record",
        title: "Context compacted",
        glyph: "arrowLoop",
        state: "success",
        fields: [
          { label: "Before est.", value: "163,201 tokens" },
          {
            label: "Rebuilt est.",
            value: "22,695 tokens",
            tone: "success",
          },
          {
            label: "Reduced",
            value: "140,506 tokens (86%)",
            tone: "success",
          },
          { label: "API before", value: "161,997 tokens" },
          { label: "Summary", value: "4,463 tokens" },
          {
            label: "Method",
            value: "dc-distill v6 · deterministic · tier 1",
          },
          { label: "Evidence", value: "compaction-input" },
        ],
      });
  });

  test("adds the continuation summary only when expanded", () => {
    const spec = compactionCardSpec(
      { content: "## Resume\nContinue the move.", details },
      true,
    );

    expect(spec).toMatchObject({
      kind: "stack",
      children: [
        { kind: "record", title: "Context compacted" },
        { kind: "divider", title: "Continuation summary" },
        { kind: "markdown", content: "## Resume\nContinue the move." },
      ],
    });
  });
});

// This exercises the project-local pinned SDK; it is not installed native-TUI proof.
describe("native Pi compaction rendering", () => {
  test("the native handler renders one expanded card with deterministic metrics", async () => {
    const sdkUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
    const { InteractiveMode } = await import(new URL("./modes/interactive/interactive-mode.js", sdkUrl).href);
    const { CompactionSummaryMessageComponent } = await import(
      new URL("./modes/interactive/components/compaction-summary-message.js", sdkUrl).href);
    const { initTheme, getMarkdownTheme } = await import(new URL("./modes/interactive/theme/theme.js", sdkUrl).href);
    initTheme("dark", false);
    const children: object[] = [];
    const mode = Object.setPrototypeOf({
      isInitialized: true, toolOutputExpanded: true,
      footer: { invalidate() {} },
      settingsManager: { getShowTerminalProgress: () => false, getShowCacheMissNotices: () => false },
      clearStatusIndicator() {},
      chatContainer: { clear() { children.length = 0; }, addChild(child: object) { children.push(child); } },
      sessionManager: { buildContextEntries: () => [{ type: "compaction" }] },
      pendingTools: new Map(), getMarkdownThemeWithSettings: getMarkdownTheme,
      flushCompactionQueue() {}, ui: { requestRender() {} },
    }, InteractiveMode.prototype);
    await InteractiveMode.prototype.handleEvent.call(mode, {
      type: "compaction_end", aborted: false, result: {
        summary: "_160,078 → 4,914 tokens (97% reduction)_", tokensBefore: 160_078,
        details: { compactor: "dc-distill", version: 15, tokensAfter: 4_914 },
      },
    });
    const cards = children.filter((child) => child instanceof CompactionSummaryMessageComponent);
    expect(cards).toHaveLength(1);
    const rendered = (cards[0] as { render(width: number): string[] }).render(100).join("\n");
    expect(rendered).toContain("160,078");
    expect(rendered).toContain("4,914");
    expect(rendered).toContain("97%");
  });
});
