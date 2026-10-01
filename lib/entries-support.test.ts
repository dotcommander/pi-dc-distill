import { describe, expect, test } from "bun:test";
import { Entries } from "./entries-support.ts";
import { createStubCtx } from "../tests/harness/fake-pi.ts";

describe("Entries.append", () => {
  test("routes through pi.appendEntry", () => {
    const stub = createStubCtx();
    Entries.append(stub.pi, "dc-distill-handoff", { state: "v2" });
    const call = stub.calls.find((c) => c.api === "pi.appendEntry");
    expect(call?.args).toEqual(["dc-distill-handoff", { state: "v2" }]);
    // The stub mirrors appends into the session branch so reads observe them.
    expect(stub.sessionBranch).toEqual([
      { type: "custom", customType: "dc-distill-handoff", data: { state: "v2" } },
    ]);
  });
});

describe("Entries reads", () => {
  function seeded() {
    const stub = createStubCtx();
    stub.sessionBranch.push(
      { type: "custom", customType: "dc-x", data: { n: 1 } },
      { type: "user", data: null } as never,
      { type: "custom", customType: "dc-x", data: { n: 2 } },
      { type: "custom", customType: "other", data: { n: 99 } },
    );
    stub.sessionEntries.push(
      { type: "custom", customType: "dc-x", data: { n: 0 } },
      ...stub.sessionBranch,
    );
    return stub;
  }

  test("readAll returns only matching customType from the branch by default", () => {
    const stub = seeded();
    const found = Entries.readAll(stub.ctx, "dc-x");
    expect(found.map((e) => e.data)).toEqual([{ n: 1 }, { n: 2 }]);
    expect(found[0]!.raw).toEqual({ type: "custom", customType: "dc-x", data: { n: 1 } });
  });

  test("branchOnly: false reads the full entry log", () => {
    const stub = seeded();
    const found = Entries.readAll(stub.ctx, "dc-x", { branchOnly: false });
    expect(found.map((e) => e.data)).toEqual([{ n: 0 }, { n: 1 }, { n: 2 }]);
  });

  test("readLatest scans from the tail", () => {
    const stub = seeded();
    expect(Entries.readLatestData<{ n: number }>(stub.ctx, "dc-x")).toEqual({ n: 2 });
    expect(Entries.readLatest(stub.ctx, "missing")).toBeUndefined();
    expect(Entries.readLatestData(stub.ctx, "missing")).toBeUndefined();
  });
});

describe("Entries.type handle", () => {
  test("handle append + readLatestData round-trip", () => {
    const stub = createStubCtx();
    const handle = Entries.type<{ n: number }>(stub.pi, "dc-handoff");
    expect(handle.customType).toBe("dc-handoff");
    handle.append({ n: 5 });
    expect(handle.readLatestData(stub.ctx)).toEqual({ n: 5 });
    expect(handle.readAll(stub.ctx).length).toBe(1);
  });
});
