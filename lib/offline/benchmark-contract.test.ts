import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = join(import.meta.dir, "../../scripts/benchmark-compiler.ts");
const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

test("retired benchmark modes reject before reading input or silently selecting baseline", () => {
  for (const mode of ["--semantic", "--semantic-worker"]) {
    const result = run(mode);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${mode} is retired`);
    expect(result.stdout).toBe("");
  }
  const coverage = run("--checkpoint-worker", "/nonexistent-sealed-input.json", "coverage");
  expect(coverage.status).not.toBe(0);
  expect(coverage.stderr).toContain("checkpoint worker requires baseline selection; coverage is retired");
  expect(coverage.stdout).toBe("");
});

test("retained compare dispatch checks complete sealed results", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dc-distill-benchmark-contract-"));
  try {
    const baseline = join(directory, "baseline.json"), candidate = join(directory, "candidate.json");
    const receipt = { bun: "same", platform: "same", arch: "same", workloads: { ordinary: { inputHash: "sealed", inputBytes: 12, canonical: { hash: "canonical" }, result: { summary: "exact summary", checkpoint: { version: 2 } } } } };
    await writeFile(baseline, JSON.stringify(receipt));
    await writeFile(candidate, JSON.stringify(receipt));
    const matching = run("--compare", baseline, candidate);
    expect(matching.status).toBe(0);
    expect(matching.stdout).toContain("ordinary: complete result and canonical input parity");
    receipt.workloads.ordinary.result.summary = "changed summary";
    await writeFile(candidate, JSON.stringify(receipt));
    const changed = run("--compare", baseline, candidate);
    expect(changed.status).not.toBe(0);
    expect(changed.stderr).toContain("ordinary: result mismatch");
  } finally { await rm(directory, { recursive: true }); }
});
