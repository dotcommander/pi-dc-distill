/** Opt-in local benchmark; never contacts Pi or a provider. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { CompactionSource } from "../lib/compaction-source.ts";
import { pathToFileURL } from "node:url";
import { compareOrdinaryPerformance } from "../lib/offline/performance-gate.ts";
// An isolated baseline checkout can supply both modules. Import lazily so its
// RSS is not charged for loading the candidate compiler into the same worker.
const baselineRoot = process.argv[2] === "--checkpoint-worker" ? process.argv[5] : undefined;
const checkpointWorkerMode = process.argv[2] === "--checkpoint-worker";
// Live compaction runs inside an already loaded Pi host. Both isolated workers
// preload the same installed package before charging compiler/source allocations.
// Keep the absolute high-water measurement alongside the incremental host cost.
let hostPreload: { piCodingAgentVersion: string; elapsedMs: number; peakRssBytes: number } | undefined;
if (checkpointWorkerMode) {
  const started = performance.now();
  await import("@earendil-works/pi-coding-agent");
  const packageInfo = JSON.parse(await readFile(join(import.meta.dir, "../node_modules/@earendil-works/pi-coding-agent/package.json"), "utf8"));
  hostPreload = { piCodingAgentVersion: packageInfo.version, elapsedMs: performance.now() - started, peakRssBytes: process.resourceUsage().maxRSS * 1024 };
}
const compilerLoadStarted = performance.now();
const { canonicalizeCompactionSource } = await import(baselineRoot ? pathToFileURL(join(baselineRoot, "lib/compaction-source.ts")).href : "../lib/compaction-source.ts");
const { compileSessionJsonl } = await import(baselineRoot ? pathToFileURL(join(baselineRoot, "lib/local-compact.ts")).href : "../lib/local-compact.ts");
const compilerLoad = { elapsedMs: performance.now() - compilerLoadStarted, peakRssBytes: process.resourceUsage().maxRSS * 1024 };

// Isolated processes make peak RSS comparable; a shared process's high-water
// counter cannot measure the candidate independently of baseline allocations.
if (process.argv[2] === "--semantic-worker" || process.argv[2] === "--checkpoint-worker") {
  const checkpointWorker = process.argv[2] === "--checkpoint-worker";
  const sealed = await readFile(process.argv[3], "utf8");
  const source: CompactionSource = JSON.parse(sealed);
  const selection = process.argv[4];
  if (selection !== "baseline" && selection !== "coverage") throw new Error("invalid selector");
  const run = () => {
    let input: ReturnType<typeof canonicalizeCompactionSource> | undefined;
    try {
    input = canonicalizeCompactionSource(source);
    return { canonical: { hash: createHash("sha256").update(input.bytes).digest("hex"), byteLength: Buffer.byteLength(input.bytes), digestScope: input.digestScope, recordCount: input.recordCount }, result: compileSessionJsonl(input.bytes, undefined, undefined, true, selection) }; }
    catch (error) {
      if (!checkpointWorker || !(error instanceof Error) || error.name !== "CompactionInputError") throw error;
      return { ...(input ? { canonical: { hash: createHash("sha256").update(input.bytes).digest("hex"), byteLength: Buffer.byteLength(input.bytes), digestScope: input.digestScope, recordCount: input.recordCount } } : {}), rejection: { name: error.name, code: (error as Error & { code?: string }).code, message: error.message } };
    }
  };
  let expected: ReturnType<typeof run> | undefined;
  for (let index = 0; index < 10; index++) expected = run();
  const samples: Array<{ elapsedMs: number; cpu: NodeJS.CpuUsage; memory: NodeJS.MemoryUsage; resourceUsage: NodeJS.ResourceUsage }> = [];
  for (let index = 0; index < 30; index++) {
    const cpu = process.cpuUsage(), start = performance.now();
    const output = run();
    const elapsedMs = performance.now() - start;
    if (JSON.stringify(output) !== JSON.stringify(expected)) throw new Error("nondeterministic selector output");
    samples.push({ elapsedMs, cpu: process.cpuUsage(cpu), memory: process.memoryUsage(), resourceUsage: process.resourceUsage() });
  }
  const sorted = samples.map(sample => sample.elapsedMs).sort((a, b) => a - b);
  const quantile = (fraction: number) => sorted[Math.ceil(sorted.length * fraction) - 1];
  const absolutePeakRssBytes = process.resourceUsage().maxRSS * 1024;
  console.log(JSON.stringify({ runtime: { bun: Bun.version, platform: process.platform, arch: process.arch, execPath: process.execPath }, selection, warmups: 10, repetitions: 30, inputHash: createHash("sha256").update(sealed).digest("hex"), options: { focus: null, recallEnabled: true, ...(hostPreload ? { memoryGeometry: "absolute-lifetime-high-water-with-identical-Pi-host-preload-v1", piCodingAgentVersion: hostPreload.piCodingAgentVersion } : {}) }, ...expected, samples, p50: quantile(.5), p95: quantile(.95), peakRssBytes: absolutePeakRssBytes, absolutePeakRssBytes, incrementalPeakRssBytes: hostPreload ? Math.max(0, absolutePeakRssBytes - hostPreload.peakRssBytes) : undefined, hostPreload, compilerLoad }));
  process.exit(0);
}

if (process.argv[2] === "--gate") {
  const baseline = JSON.parse(await readFile(process.argv[3], "utf8"));
  const candidate = JSON.parse(await readFile(process.argv[4], "utf8"));
  const gate = compareOrdinaryPerformance(baseline.ordinary, candidate.ordinary);
  console.log(JSON.stringify(gate));
  process.exit(gate.passed ? 0 : 1);
}

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

const semantic = process.argv[2] === "--semantic";
const checkpointMode = process.argv[2] === "--checkpoint";
const directory = process.argv[semantic || checkpointMode ? 3 : 2];
const label = process.argv[semantic || checkpointMode ? 4 : 3];
if (!directory || !label || !/^[a-zA-Z0-9_-]+$/.test(label)) {
  throw new Error("usage: bun scripts/benchmark-compiler.ts [--semantic|--checkpoint] <artifact-directory> <unique-label> [baseline-checkpoint-receipt]");
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
if (checkpointMode) {
  const measurements: Record<string, any> = {};
  const failures: string[] = [];
  for (const [name, build] of Object.entries(workloads)) {
    const path = join(directory, `${name}.input.json`);
    try { await readFile(path, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await writeFile(path, JSON.stringify(build()), { flag: "wx" });
    }
    const child = spawnSync(process.execPath, [import.meta.path, "--checkpoint-worker", path, "baseline"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (child.status !== 0 || child.error) { failures.push(`${name}: ${child.error?.message ?? child.stderr}`); continue; }
    try {
      const measurement = JSON.parse(child.stdout);
      measurements[name] = measurement;
      if (measurement.canonical?.byteLength > 20 * 1024 * 1024) failures.push(`${name}: canonical input exceeds envelope`);
      if (measurement.result && Array.from(measurement.result.summary).length > 65_536) failures.push(`${name}: summary exceeds envelope`);
      if (measurement.result?.checkpoint && Array.from(JSON.stringify(measurement.result.checkpoint)).length > 65_536) failures.push(`${name}: checkpoint exceeds envelope`);
      if (name === "ordinary" && measurement.rejection) failures.push("ordinary workload rejected");
    } catch (error) { failures.push(`${name}: invalid worker receipt: ${String(error)}`); }
  }
  const baselinePath = process.argv[5];
  const gate = baselinePath && measurements.ordinary
    ? compareOrdinaryPerformance(JSON.parse(await readFile(baselinePath, "utf8")).ordinary, measurements.ordinary)
    : { passed: false, failures: ["ordinary baseline receipt not supplied"], limits: null };
  failures.push(...gate.failures);
  const report = { schema: 3, mode: "checkpoint-bounded-processing", label, ordinary: measurements.ordinary, nearLimit: Object.fromEntries(Object.entries(measurements).filter(([name]) => name !== "ordinary")), ordinaryGate: gate, passed: failures.length === 0, failures, limitations: ["Near-limit results are measured separately and are not ordinary latency acceptance.", "Baseline and candidate must use identical runtime, input and options; summary changes are expected.", "RSS gate uses absolute lifetime high-water with identical installed Pi host preload. Incremental RSS is advisory only; prior host high-water can mask below-peak allocations in that advisory subtraction. Module-load overhead is reported separately."] };
  await writeFile(join(directory, `${label}.checkpoint.json`), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ passed: report.passed, ordinaryGate: gate, failures }));
  process.exit(failures.length ? 1 : 0);
}
if (semantic) {
  const receipt: Record<string, unknown> = { schema: 2, mode: "semantic-selector-adoption", label, timestamp: new Date().toISOString(), warmups: 10, repetitions: 30, workloads: {}, passed: true, failures: [] };
  const failures: string[] = [];
  for (const [name, build] of Object.entries(workloads)) {
    const path = join(directory, `${name}.input.json`);
    try { await readFile(path, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await writeFile(path, JSON.stringify(build()), { flag: "wx" });
    }
    const results: Record<string, any> = {};
    for (const selection of ["baseline", "coverage"]) {
      const child = spawnSync(process.execPath, [import.meta.path, "--semantic-worker", path, selection], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      if (child.status !== 0 || child.error) {
        results[selection] = { error: child.error?.message ?? child.stderr, exitStatus: child.status };
        failures.push(`${name}:${selection}: worker failed`);
      } else {
        try { results[selection] = JSON.parse(child.stdout); }
        catch { results[selection] = { error: "invalid worker receipt", stdout: child.stdout }; failures.push(`${name}:${selection}: invalid worker receipt`); }
      }
    }
    const { baseline, coverage } = results;
    if (baseline.error || coverage.error) { (receipt.workloads as Record<string, unknown>)[name] = results; continue; }
    if (JSON.stringify(baseline.runtime) !== JSON.stringify(coverage.runtime) || baseline.inputHash !== coverage.inputHash || JSON.stringify(baseline.canonical) !== JSON.stringify(coverage.canonical) || JSON.stringify(baseline.options) !== JSON.stringify(coverage.options)) { failures.push(`${name}: runtime/input/options mismatch`); (receipt.workloads as Record<string, unknown>)[name] = results; continue; }
    const limits = { p50: Math.max(baseline.p50 * 1.10, baseline.p50 + 1), p95: Math.max(baseline.p95 * 1.10, baseline.p95 + 1), peakRssBytes: baseline.peakRssBytes + 8 * 1024 * 1024 };
    for (const key of ["p50", "p95", "peakRssBytes"] as const) if (coverage[key] > limits[key]) failures.push(`${name}: coverage ${key}=${coverage[key]} exceeds ${limits[key]}`);
    (receipt.workloads as Record<string, unknown>)[name] = { ...results, limits, semantic: { sameSummary: baseline.result.summary === coverage.result.summary, baselineSummaryHash: hash(baseline.result.summary), coverageSummaryHash: hash(coverage.result.summary) } };
    console.log(`${name}: baseline p50=${baseline.p50.toFixed(2)} p95=${baseline.p95.toFixed(2)}; coverage p50=${coverage.p50.toFixed(2)} p95=${coverage.p95.toFixed(2)} ms`);
  }
  receipt.passed = failures.length === 0; receipt.failures = failures;
  await writeFile(join(directory, `${label}.semantic.json`), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ passed: receipt.passed, failures }));
  process.exit(failures.length ? 1 : 0);
}
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
