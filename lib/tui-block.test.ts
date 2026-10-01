import { describe, expect, test } from "bun:test";
import { Block, type TuiThemeLike } from "./tui-block.ts";

const IDENTITY: TuiThemeLike = {
  fg: (_c, t) => t,
  bold: (t) => t,
};

describe("Block.render", () => {
  test("rail spec renders title, glyph, and summary", () => {
    const lines = Block.render(
      {
        kind: "rail",
        title: "distill handoff",
        summary: "saved for compaction",
        glyph: "done",
        state: "success",
      },
      IDENTITY,
      80,
    );
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("✓");
    expect(lines[0]).toContain("distill handoff");
    expect(lines[0]).toContain("→");
    expect(lines[0]).toContain("saved for compaction");
  });

  test("record spec renders title + fields with count", () => {
    const lines = Block.render(
      {
        kind: "record",
        title: "Compaction",
        fields: [
          { label: "reduction", value: "85%" },
          { label: "tokens", value: "149215 → 21894" },
        ],
      },
      IDENTITY,
      80,
    );
    const text = lines.join("\n");
    expect(text).toContain("Compaction  2 fields");
    expect(text).toContain("reduction");
    expect(text).toContain("149215 → 21894");
  });

  test("divider renders titled rule at width", () => {
    const lines = Block.render(
      { kind: "divider", title: "Continuation summary", tone: "muted" },
      IDENTITY,
      40,
    );
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("Continuation summary");
    expect(lines[0]).toContain("─");
  });

  test("stack flattens children", () => {
    const lines = Block.render(
      {
        kind: "stack",
        children: [
          { kind: "markdown", content: "# Title" },
          { kind: "divider", title: "sep" },
        ],
      },
      IDENTITY,
      60,
    );
    expect(lines.join("\n")).toContain("# Title");
    expect(lines.join("\n")).toContain("sep");
  });

  test("width 0 renders nothing", () => {
    expect(Block.render({ kind: "banner", title: "x" }, IDENTITY, 0)).toEqual(
      [],
    );
  });
});

describe("Block.node", () => {
  test("rail node produces renderable component that fits width", () => {
    const node = Block.node(
      {
        kind: "rail",
        title: "distill handoff",
        summary: "saved for compaction",
        glyph: "done",
        state: "success",
      },
      IDENTITY,
    );
    const lines = node.render(60);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]!.length).toBeLessThanOrEqual(60);
    expect(typeof node.invalidate).toBe("function");
  });

  test("markdown node returns Markdown component", () => {
    const node = Block.node({ kind: "markdown", content: "# hi" }, IDENTITY);
    expect(node).toBeDefined();
  });

  test("stack node returns a Container of children", () => {
    const node = Block.node(
      {
        kind: "stack",
        children: [
          { kind: "record", title: "a", fields: [{ label: "l", value: "v" }] },
        ],
      },
      IDENTITY,
    );
    expect(node.render(80).join("\n")).toContain("a  1 field");
  });
});
