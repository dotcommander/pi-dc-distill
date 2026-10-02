/** Opt-in local benchmark; never contacts Pi or a provider. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalizeCompactionSource, type CompactionSource } from "../lib/compaction-source.ts";
import { compileSessionJsonl } from "../lib/local-compact.ts";

if (process.argv[2] === "--compare") {
  const before = JSON.parse(await readFile(process.argv[3], "utf8"));
  const after = JSON.parse(await readFile(process.argv[4], "utf8"));
  if (before.bun !== after.bun || before.platform !== after.platform || before.arch !== after.arch) throw new Error("runtime mismatch");
  if (JSON.stringify(Object.keys(before.workloads)) !== JSON.stringify(Object.keys(after.workloads))) throw new Error("workload mismatch");
  for (const name of Object.keys(before.workloads)) {
    for (const key of ["inputHash", "inputBytes", "canonical", "result"]) {
      if (JSON.stringify(before.workloads[name][key]) !== JSON.stringify(after.workloads[name][key])) throw new Error(`${name}: ${key} mismatch`);
    }
    console.log(`${name}: complete result and canonical input parity`);
  }
  process.exit(0);
}

const directory = process.argv[2];
const label = process.argv[3];
if (!directory || !label || !/^[a-zA-Z0-9_-]+$/.test(label)) {
  throw new Error("usage: bun scripts/benchmark-compiler.ts <artifact-directory> <unique-label>");
}
await mkdir(directory, { recursive: true });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const base = (messages: CompactionSource["messagesToSummarize"]): CompactionSource => ({
  previousSummary: "Prior task: preserve exact deterministic compiler state.",
  messagesToSummarize: messages, turnPrefixMessages: [],
  session: { id: "sealed-performance-v1", cwd: "/synthetic/project", timestamp: "2026-01-01T00:00:00.000Z" },
});
const workloads: Record<string, () => CompactionSource> = {
  ordinary: () => base(Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `Implement parser slice ${i}: preserve Unicode 😀 and é with deterministic ordering.` }))),
  manyRecords: () => base(Array.from({ length: 340 }, (_, i) => ({ role: "user", content: `record ${i}: ` + "é😀payload ".repeat(5_500) }))),
  oversizedRecord: () => base([{ role: "user", content: "Keep older whole record." }, { role: "user", content: "x".repeat(21 * 1024 * 1024) }]),
  budgetPressureV2: () => {
    const messages: CompactionSource["messagesToSummarize"] = [];
    for (let i = 0; i < 10; i++) {
      for (const [name, args, text] of [["bash", { command: `bun test test/legacy-${i}.test.ts --filter old-scope-${"x".repeat(300)}${i}` }, "1 pass, 0 fail"], ["edit", { path: `src/legacy-${i}.ts` }, "updated"]] as const) {
        const id = `${name}-${i}`;
        messages.push({ role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }] }, { role: "toolResult", toolCallId: id, toolName: name, content: text });
      }
    }
    for (let i = 0; i < 30; i++) messages.push({ role: "assistant", content: `### Old milestone ${i}\nDecision for src/legacy-${i}.ts: ${"historical detail ".repeat(90)}` });
    messages.push({ role: "user", content: "Fix the current parser regression and preserve quoted operators." }, { role: "assistant", content: "Investigating the current parser regression now." });
    return base(messages);
  },
};
const receipt: Record<string, unknown> = { schema: 1, label, timestamp: new Date().toISOString(), bun: Bun.version, platform: process.platform, arch: process.arch, repetitions: 3, workloads: {} };
for (const [name, build] of Object.entries(workloads)) {
  const path = join(directory, `${name}.input.json`);
  let sealed: string;
  try { sealed = await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    sealed = JSON.stringify(build());
    await writeFile(path, sealed, { flag: "wx" });
  }
  const source: CompactionSource = JSON.parse(sealed);
  const run = () => {
    const input = canonicalizeCompactionSource(source);
    const result = compileSessionJsonl(input.bytes);
    return { canonical: { hash: hash(input.bytes), byteLength: Buffer.byteLength(input.bytes), digestScope: input.digestScope, recordCount: input.recordCount }, result };
  };
  const expected = run(); // one unmeasured warmup per workload
  const samples: Array<{ elapsedMs: number; cpu: NodeJS.CpuUsage; memoryBefore: NodeJS.MemoryUsage; memoryAfter: NodeJS.MemoryUsage; resourceUsage: NodeJS.ResourceUsage }> = [];
  for (let i = 0; i < 3; i++) {
    const cpuStart = process.cpuUsage();
    const memoryBefore = process.memoryUsage();
    const start = performance.now();
    const output = run();
    const elapsedMs = performance.now() - start;
    const cpu = process.cpuUsage(cpuStart);
    if (JSON.stringify(output) !== JSON.stringify(expected)) throw new Error(`${name}: nondeterministic result`);
    samples.push({ elapsedMs, cpu, memoryBefore, memoryAfter: process.memoryUsage(), resourceUsage: process.resourceUsage() });
  }
  (receipt.workloads as Record<string, unknown>)[name] = { inputHash: hash(sealed), inputBytes: Buffer.byteLength(sealed), ...expected, samples };
  console.log(`${name}: ${samples.map(sample => sample.elapsedMs.toFixed(1)).join(", ")} ms`);
}
await writeFile(join(directory, `${label}.json`), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
