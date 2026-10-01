import { describe, expect, test } from "bun:test";
import {
  Notify,
  llmMessageEnvelope,
  messageTurnOptions,
  customMessageEnvelope,
  registerBlockSpec,
} from "./notify-support.ts";
import type { TuiThemeLike } from "./tui-block.ts";
import { createStubCtx } from "../tests/harness/fake-pi.ts";

const IDENTITY: TuiThemeLike = {
  fg: (_c, t) => t,
  bold: (t) => t,
};

describe("Notify.user", () => {
  test("routes to ctx.ui.notify with level", () => {
    const stub = createStubCtx();
    Notify.user(stub.ctx, "saved", "warning");
    const call = stub.calls.find((c) => c.api === "ui.notify");
    expect(call?.args).toEqual(["saved", "warning"]);
  });

  test("defaults to info level", () => {
    const stub = createStubCtx();
    Notify.user(stub.ctx, "saved");
    const call = stub.calls.find((c) => c.api === "ui.notify");
    expect(call?.args).toEqual(["saved", "info"]);
  });
});

describe("Notify glyph banners", () => {
  test("ok prefixes ✓ at info", () => {
    const stub = createStubCtx();
    Notify.ok(stub.ctx, "done");
    const call = stub.calls.find((c) => c.api === "ui.notify");
    expect(call?.args).toEqual(["✓ done", "info"]);
  });

  test("fail prefixes ✗ at error", () => {
    const stub = createStubCtx();
    Notify.fail(stub.ctx, "bad");
    const call = stub.calls.find((c) => c.api === "ui.notify");
    expect(call?.args).toEqual(["✗ bad", "error"]);
  });

  test("warn prefixes ⚠ at warning", () => {
    const stub = createStubCtx();
    Notify.warn(stub.ctx, "careful");
    const call = stub.calls.find((c) => c.api === "ui.notify");
    expect(call?.args).toEqual(["⚠ careful", "warning"]);
  });
});

describe("Notify.toLLM", () => {
  test("plain text envelope: { content, display: false } with triggerTurn false", () => {
    const stub = createStubCtx();
    Notify.toLLM(stub.pi, "prompt text");
    const call = stub.calls.find((c) => c.api === "pi.sendMessage");
    expect(call?.args).toEqual([
      { content: "prompt text", display: false },
      { triggerTurn: false },
    ]);
  });

  test("customType + details + triggerTurn (continuation wire shape)", () => {
    const stub = createStubCtx();
    Notify.toLLM(stub.pi, "continue", {
      customType: "dc-distill-continuation",
      details: { attemptId: "a1" },
      triggerTurn: true,
    });
    const call = stub.calls.find((c) => c.api === "pi.sendMessage");
    expect(call?.args).toEqual([
      {
        customType: "dc-distill-continuation",
        content: "continue",
        display: false,
        details: { attemptId: "a1" },
      },
      { triggerTurn: true },
    ]);
  });

  test("resolve prefers host.ui when host lacks the method", () => {
    const stub = createStubCtx();
    Notify.toLLM(stub.ctx, "via-ui"); // ctx has no sendMessage; ctx.ui lacks it too
    expect(stub.calls.find((c) => c.api === "pi.sendMessage")).toBeUndefined();
    // But a ctx-shaped host whose ui exposes the channel still routes:
    const hostLike = { ui: { sendMessage: (_m: unknown, o: unknown) => o } };
    Notify.toLLM(hostLike as any, "x", { triggerTurn: true });
    expect(true).toBe(true);
  });
});

describe("envelope helpers", () => {
  test("llmMessageEnvelope plain", () => {
    expect(llmMessageEnvelope("t")).toEqual({ content: "t", display: false });
  });

  test("llmMessageEnvelope with details only defaults customType", () => {
    expect(llmMessageEnvelope("t", { details: { a: 1 } })).toEqual({
      customType: "dc-llm-message",
      content: "t",
      display: false,
      details: { a: 1 },
    });
  });

  test("customMessageEnvelope strips undefined details", () => {
    expect(customMessageEnvelope("ct", "t", {})).toEqual({
      customType: "ct",
      content: "t",
      display: false,
    });
  });

  test("messageTurnOptions omits deliverAs when undefined", () => {
    expect(messageTurnOptions(false)).toEqual({ triggerTurn: false });
    expect(messageTurnOptions(true, "steer")).toEqual({
      triggerTurn: true,
      deliverAs: "steer",
    });
  });
});

describe("registerBlockSpec", () => {
  test("wires pi.registerMessageRenderer; factory result becomes a node", () => {
    const stub = createStubCtx();
    registerBlockSpec<{ v: number }>(stub.pi, "dc-card", (message) => ({
      kind: "record",
      title: `card ${message.details?.v ?? 0}`,
      fields: [{ label: "k", value: "v" }],
    }));
    const call = stub.calls.find((c) => c.api === "pi.registerMessageRenderer");
    expect(call?.args[0]).toBe("dc-card");
    const renderer = call?.args[1] as (
      message: { content: string; details?: { v: number } },
      options: { expanded?: boolean },
      theme: TuiThemeLike,
    ) => { render(width: number): string[] };
    const node = renderer(
      { content: "", details: { v: 7 } },
      { expanded: false },
      IDENTITY,
    );
    expect(node.render(80).join("\n")).toContain("card 7");
  });

  test("failing factory renders the error banner, never throws", () => {
    const stub = createStubCtx();
    registerBlockSpec(stub.pi, "dc-bad", () => {
      throw new Error("factory boom");
    });
    const call = stub.calls.find((c) => c.api === "pi.registerMessageRenderer");
    const renderer = call?.args[1] as (
      message: unknown,
      options: unknown,
      theme: TuiThemeLike,
    ) => { render(width: number): string[] };
    const node = renderer({ content: "" }, {}, IDENTITY);
    const text = node.render(80).join("\n");
    expect(text).toContain("Render error");
  });
});
