import { describe, expect, test } from "bun:test";
import {
  Tool,
  cancelledResult,
  errorResult,
  textResult,
} from "./tool-result.ts";

describe("textResult", () => {
  test("builds canonical success shape without details", () => {
    expect(textResult("hello")).toEqual({
      content: [{ type: "text", text: "hello" }],
    });
  });

  test("carries details when provided", () => {
    expect(textResult("hello", { customType: "dc-x" })).toEqual({
      content: [{ type: "text", text: "hello" }],
      details: { customType: "dc-x" },
    });
  });
});

describe("errorResult", () => {
  test("sets isError true", () => {
    expect(errorResult("boom")).toEqual({
      content: [{ type: "text", text: "boom" }],
      isError: true,
    });
  });

  test("keeps details alongside isError", () => {
    expect(errorResult("boom", { code: 1 })).toEqual({
      content: [{ type: "text", text: "boom" }],
      isError: true,
      details: { code: 1 },
    });
  });
});

describe("cancelledResult", () => {
  test("is control flow, not an error", () => {
    expect(cancelledResult()).toEqual({
      content: [{ type: "text", text: "" }],
      details: { cancelled: true },
    });
    expect(cancelledResult("label")).toEqual({
      content: [{ type: "text", text: "" }],
      details: { cancelled: true, label: "label" },
    });
  });
});

describe("Tool facade", () => {
  test("Tool.text mirrors textResult", () => {
    expect(Tool.text("hi")).toEqual(textResult("hi"));
    expect(Tool.text("hi", { details: { a: 1 } })).toEqual(
      textResult("hi", { a: 1 }),
    );
  });

  test("Tool.error mirrors errorResult", () => {
    expect(Tool.error("bad")).toEqual(errorResult("bad"));
    expect(Tool.error("bad", { details: { a: 1 } })).toEqual(
      errorResult("bad", { a: 1 }),
    );
  });
});
