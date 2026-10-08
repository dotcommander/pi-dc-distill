import { describe, expect, test } from "bun:test";
import { RuntimeOwnership } from "./ownership.ts";
import { reportCancellation } from "./diagnostics.ts";

describe("single-instance ownership", () => {
  test("invalid starts leave a runtime available for its first valid session", () => {
    const owner = new RuntimeOwnership();
    owner.start(null); owner.start("");
    expect(owner.generation).toBe(0);
    owner.start("primary");
    expect(owner.owns("primary")).toBe(true);
    owner.start("foreign");
    expect(owner.owns("foreign")).toBe(false);
    expect(owner.generation).toBe(1);
  });
  test("cancelled switch and fork invalidation never permits foreign adoption", () => {
    const owner = new RuntimeOwnership(); owner.start("primary");
    owner.invalidate("primary"); owner.invalidate("primary"); owner.start("foreign");
    expect(owner.owns("primary")).toBe(true);
    expect(owner.owns("foreign")).toBe(false);
    expect(owner.generation).toBe(3);
    owner.shutdown("foreign");
    expect(owner.owns("primary")).toBe(true);
  });
  test("closed runtimes cannot reopen; a fresh runtime can bind a replacement or fork", () => {
    const old = new RuntimeOwnership(); old.start("primary"); old.shutdown("primary");
    old.start("primary"); old.start("replacement");
    expect(old.owns("primary")).toBe(false);
    expect(old.owns("replacement")).toBe(false);
    const fresh = new RuntimeOwnership(); fresh.start("replacement");
    expect(fresh.owns("replacement")).toBe(true);
  });
});

describe("cancellation diagnostics", () => {
  test("default and other values are silent, opt-in emits only a fixed code", () => {
    const lines: string[] = [];
    for (const value of [undefined, "", "0", "true"]) reportCancellation("snapshot", () => value, line => lines.push(line));
    expect(lines).toEqual([]);
    reportCancellation("snapshot", () => "1", line => lines.push(line));
    expect(lines).toEqual(["dc-distill:cancel:snapshot\n"]);
  });
  test("the default sink survives a closed stderr descriptor", () => {
    const diagnostics = new URL("./diagnostics.ts", import.meta.url).href;
    const result = Bun.spawnSync([process.execPath, "-e", `
      import { closeSync } from "node:fs";
      import { reportCancellation } from ${JSON.stringify(diagnostics)};
      closeSync(2);
      reportCancellation("source", () => "1");
      console.log("survived");
    `], { stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("survived\n");
  });
  test("throwing environment and sink never escape cancellation", () => {
    expect(() => reportCancellation("source", () => { throw new Error("secret"); })).not.toThrow();
    expect(() => reportCancellation("source", () => "1", () => { throw new Error("secret"); })).not.toThrow();
  });
});
