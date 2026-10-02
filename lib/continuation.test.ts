import { describe, expect, test } from "bun:test";
import { createStubCtx } from "../tests/harness/fake-pi.ts";

import {
  DISTILL_CONTINUATION_MESSAGE_TYPE,
  DISTILL_CONTINUATION_PROMPT,
  queueAutonomousContinuation,
} from "./continuation.ts";

describe("distill continuation delivery", () => {
  test("queues hidden custom continuation instead of visible user input", () => {
    const stub = createStubCtx();

    expect(queueAutonomousContinuation(stub.pi, stub.ctx)).toBe("submitted_unknown");

    expect(stub.calls.some((call) => call.api === "pi.sendUserMessage")).toBe(
      false,
    );
    const call = stub.calls.find((entry) => entry.api === "pi.sendMessage");
    expect(call).toBeDefined();
    expect(call?.args[0]).toEqual({
      customType: DISTILL_CONTINUATION_MESSAGE_TYPE,
      content: DISTILL_CONTINUATION_PROMPT,
      display: false,
      details: { reason: "autonomous_compaction" },
    });
    expect(call?.args[1]).toEqual({ triggerTurn: true });
  });

  test("journals the attempt id and resume marker in delivery details", () => {
    const stub = createStubCtx();

    expect(
      queueAutonomousContinuation(stub.pi, stub.ctx, {
        attemptId: "attempt-1",
        resumed: true,
      }),
    ).toBe("submitted_unknown");

    const call = stub.calls.find((entry) => entry.api === "pi.sendMessage");
    expect(call).toBeDefined();
    expect(call?.args[0]).toMatchObject({
      customType: DISTILL_CONTINUATION_MESSAGE_TYPE,
      details: {
        reason: "autonomous_compaction",
        attemptId: "attempt-1",
        resumed: true,
      },
    });
  });

  test("does not queue while user input is pending", () => {
    const stub = createStubCtx();
    (stub.ctx as any).isIdle = () => false;

    expect(queueAutonomousContinuation(stub.pi, stub.ctx)).toBe("deferred");
    expect(stub.calls.some((call) => call.api === "pi.sendMessage")).toBe(
      false,
    );
  });

  test("drops the continuation instead of throwing when the captured ctx is stale", () => {
    const stub = createStubCtx();
    (stub.ctx as any).isIdle = () => {
      throw new Error(
        "This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload().",
      );
    };

    expect(queueAutonomousContinuation(stub.pi, stub.ctx)).toBe("unavailable");
    expect(stub.calls.some((call) => call.api === "pi.sendMessage")).toBe(
      false,
    );
  });
});

 test("fences before a throwing sender; submission outcome stays uncertain", () => {
  const stub = createStubCtx();
  let fenced = false;
  stub.pi.sendMessage = (() => { expect(fenced).toBe(true); throw new Error("after possible submission"); }) as any;
  expect(queueAutonomousContinuation(stub.pi, stub.ctx, { beforeSubmit: () => { fenced = true; } })).toBe("submitted_unknown");
});
