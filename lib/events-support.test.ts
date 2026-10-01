import { describe, expect, test } from "bun:test";
import { Events } from "./events-support.ts";
import { createStubCtx } from "../tests/harness/fake-pi.ts";

const identity = (t: string) => t;

describe("Events.beforeCompact", () => {
  test("registers on session_before_compact and passes results through", async () => {
    const stub = createStubCtx();
    const compaction = {
      summary: "s",
      firstKeptEntryId: "e1",
      tokensBefore: 10,
      details: { compactor: "dc-distill" },
    };
    Events.beforeCompact(stub.pi, async () => Events.compact(compaction));
    const handlers = stub.registeredHooks.get("session_before_compact");
    expect(handlers?.length).toBe(1);
    const result = await handlers![0]!({ preparation: {} }, stub.ctx);
    expect(result).toEqual({ compaction });
  });

  test("handler throw cancels: { cancel: true } — never falls through", async () => {
    const stub = createStubCtx();
    Events.beforeCompact(stub.pi, async () => {
      throw new Error("compiler failure");
    });
    const handlers = stub.registeredHooks.get("session_before_compact");
    const result = await handlers![0]!({}, stub.ctx);
    expect(result).toEqual({ cancel: true });
  });

  test("cancelCompact factory", () => {
    expect(Events.cancelCompact()).toEqual({ cancel: true });
  });
});

describe("Events.context", () => {
  test("registers on context and returns patched messages", async () => {
    const stub = createStubCtx();
    Events.context(stub.pi, async ({ event, ctx, rest }) => {
      expect(ctx).toBe(stub.ctx);
      expect(rest).toEqual([]);
      return Events.messages([...(event as unknown[]), { extra: true }]);
    });
    const handlers = stub.registeredHooks.get("context");
    expect(handlers?.length).toBe(1);
    const result = await handlers![0]!([{ m: 1 }], stub.ctx);
    expect(result).toEqual({ messages: [{ m: 1 }, { extra: true }] });
  });

  test("handler throw recovers to undefined (Pi default behavior)", async () => {
    const stub = createStubCtx();
    Events.context(stub.pi, async () => {
      throw new Error("boom");
    });
    const handlers = stub.registeredHooks.get("context");
    const result = await handlers![0]!([], stub.ctx);
    expect(result).toBeUndefined();
  });

  test("onError receives handler errors", async () => {
    const stub = createStubCtx();
    const seen: unknown[] = [];
    Events.context(
      stub.pi,
      async () => {
        throw new Error("boom");
      },
      { onError: (err) => void seen.push(err) },
    );
    const handlers = stub.registeredHooks.get("context");
    await handlers![0]!([], stub.ctx);
    expect(seen.length).toBe(1);
    expect((seen[0] as Error).message).toBe("boom");
  });
});

describe("Events.toolResult", () => {
  test("registers on tool_result and patches results", async () => {
    const stub = createStubCtx();
    Events.toolResult(stub.pi, async () =>
      Events.toolPatch({ content: { type: "text", text: "patched" }, isError: true }),
    );
    const handlers = stub.registeredHooks.get("tool_result");
    const result = await handlers![0]!({ result: {} }, stub.ctx);
    expect(result).toEqual({
      content: { type: "text", text: "patched" },
      isError: true,
    });
  });

  test("handler throw recovers to undefined", async () => {
    const stub = createStubCtx();
    Events.toolResult(stub.pi, async () => {
      throw new Error("boom");
    });
    const handlers = stub.registeredHooks.get("tool_result");
    const result = await handlers![0]!({}, stub.ctx);
    expect(result).toBeUndefined();
  });

  test("toolPatch factory is identity over the patch shape", () => {
    expect(Events.toolPatch({ details: { a: 1 } })).toEqual({
      details: { a: 1 },
    });
  });
});

describe("Events messages factory", () => {
  test("wraps the message list", () => {
    expect(Events.messages([1, 2])).toEqual({ messages: [1, 2] });
  });
});

describe("identity theme guard", () => {
  test("sanity: identity function used by other suites", () => {
    expect(identity("x")).toBe("x");
  });
});
