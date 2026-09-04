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
