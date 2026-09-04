import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { detectConflicts } from "./conflict-detector.ts";

test("detectConflicts serializes write agents that name the same file", () => {
  const cwd = mkdtempSync(join(tmpdir(), "architect-conflicts-"));
  try {
    mkdirSync(join(cwd, "src"));
    writeFileSync(join(cwd, "src", "owner.ts"), "export {};\n");
    const report = detectConflicts([
      { id: "a", type: "work", prompt: "Edit src/owner.ts" },
      { id: "b", type: "work", prompt: "Update `src/owner.ts`" },
      { id: "c", type: "reader", prompt: "Inspect src/owner.ts" },
    ], cwd, (type) => ({ builtinToolNames: type === "work" ? ["edit"] : ["read"] }));
    expect(report.conflicts).toEqual([{
      agents: ["a", "b"],
      files: [join(cwd, "src", "owner.ts")],
      recommendation: "serialize",
    }]);
    expect(report.safe).toEqual(["c"]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
