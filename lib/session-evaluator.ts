import { createCacheRun, protectCacheOutput, type CacheRun } from "./cache-runs.ts";
import { sha256Hex } from "./sha256.ts";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { estimateTokens } from "./sdk.ts";
import { TARGET_RESUME_SUMMARY_CODE_POINTS } from "./compiler/helpers.ts";
import { resolve } from "node:path";
import { canonicalRecordFromMessage } from "./compaction-source.ts";
import { compileSessionJsonl, type LocalCompileResult } from "./local-compact.ts";

export type CompactionSelector = "first" | "last" | number;

export interface SessionEvaluationOptions {
  sessionFile: string;
  outputDirectory: string;
  /** Producer-owned run; producer finalizes after its consumers finish. */
  managedRun?: CacheRun;
  compaction?: CompactionSelector;
  wholeSession?: boolean;
  historicalFile?: string;
  focus?: string;
  force?: boolean;
  /** Diagnostic compatibility default is true. */
  recallEnabled?: boolean;
}

export interface SessionEvaluationReport {
  schemaVersion: 1;
  sessionFile: string;
  mode: "whole-session" | "prefix-before-compaction";
  inputFormat: "session-jsonl" | "legacy-message-jsonl";
  selectedCompaction?: {
    ordinal: number;
    line: number;
    id?: string;
    timestamp?: string;
  };
  measurements: {
    semantics: { characters: "unicode-code-points"; lines: "logical-lines-without-terminal-empty-line"; tokens: "Pi SDK estimateTokens on summary text only; not rebuilt host context" };
    input: TextMeasurements;
    current: SummaryMeasurements;
    historical?: SummaryMeasurements;
    inputToCurrentReductionPct: { bytes: number; characters: number; lines: number };
    historicalToCurrentReductionPct?: { bytes: number; characters: number; lines: number; summaryTokens: number };
  };
  compiler: { focus: string | null; recallEnabled: boolean };
  provenance: Awaited<ReturnType<typeof evaluationProvenance>>;
  historicalHostContextMetrics?: { source: "selected-compaction-details"; tokensBefore?: number; tokensAfter?: number; summaryTokens?: number; tokensAfterSource?: string };
  input: { entries: number; bytes: number; sha256: string; file: string };
  current: Pick<LocalCompileResult, "inputDigest" | "summaryDigest" | "digestScope" | "usefulRecordCount"> & {
    characters: number;
    bytes: number;
    file: string;
  };
  historical?: {
    characters: number;
    bytes: number;
    sha256: string;
    bodySha256: string;
    bodyMatchesCurrent: boolean;
    file: string;
    sourceFile?: string;
  };
}

interface TextMeasurements {
  bytes: number;
  characters: number;
  lines: number;
}

interface SummaryMeasurements extends TextMeasurements {
  summaryTokens: number;
  budget: { operatingCodePoints: number; hardCodePoints: number; withinOperatingTarget: boolean; withinHardLimit: boolean };
}

/** A final newline terminates a line; it does not create another empty line. */
export function measureEvaluationText(text: string): TextMeasurements {
  return {
    bytes: Buffer.byteLength(text),
    characters: Array.from(text).length,
    lines: text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length - (/[\r\n]$/.test(text) ? 1 : 0),
  };
}

function measureSummary(summary: string): SummaryMeasurements {
  const measurement = measureEvaluationText(summary);
  return {
    ...measurement,
    summaryTokens: estimateTokens({ role: "user", content: summary, timestamp: 0 }),
    budget: {
      operatingCodePoints: TARGET_RESUME_SUMMARY_CODE_POINTS,
      hardCodePoints: 65_536,
      withinOperatingTarget: measurement.characters <= TARGET_RESUME_SUMMARY_CODE_POINTS,
      withinHardLimit: measurement.characters <= 65_536,
    },
  };
}

function reduction(before: number, after: number): number {
  return before === 0 ? 0 : (1 - after / before) * 100;
}

async function evaluationProvenance() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const sources = ["package.json", "bun.lock", "bin/dc-distill-session.ts", "lib/bm25.ts", "lib/legacy.ts", "lib/json-object-keys.ts", "lib/local-compact.ts", "lib/unicode.ts", "lib/sha256.ts", "lib/handoff.ts", "lib/compaction-source.ts", "lib/session-evaluator.ts", "lib/sdk.ts",
    ...(await readdir(resolve(root, "lib/compiler"))).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).map((name) => `lib/compiler/${name}`),
  ].sort();
  const files = await Promise.all(sources.map(async (file) => ({ file, sha256: sha256Hex(await readFile(resolve(root, file), "utf8")) })));
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const sdkPackages = ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "@earendil-works/pi-agent-core", "@earendil-works/pi-tui"];
  const sdkVersions = Object.fromEntries(await Promise.all(sdkPackages.map(async (name) => {
    const sdk = JSON.parse(await readFile(new URL("../package.json", import.meta.resolve(name)), "utf8"));
    return [name, String(sdk.version)];
  })));
  const git = (args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    return result.status === 0 ? result.stdout.trimEnd() : null;
  };
  const status = git(["status", "--porcelain", "--untracked-files=normal"]);
  return {
    sourceFingerprint: sha256Hex(JSON.stringify(files)),
    sourceFiles: files,
    packageVersion: String(pkg.version),
    sdkVersion: sdkVersions["@earendil-works/pi-coding-agent"],
    sdkVersions,
    revision: git(["rev-parse", "HEAD"]),
    dirty: status === null ? null : status.length > 0,
    gitStatus: status === null ? null : status.split("\n").filter(Boolean),
  };
}

interface ParsedLine {
  raw: string;
  line: number;
  value: Record<string, unknown>;
}



function parseJsonl(content: string): ParsedLine[] {
  const parsed: ParsedLine[] = [];
  for (const [index, raw] of content.split(/\r?\n/).entries()) {
    if (!raw.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new Error(`invalid JSON on line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`line ${index + 1} is not a JSON object`);
    }
    parsed.push({ raw, line: index + 1, value: value as Record<string, unknown> });
  }
  if (parsed.length === 0) throw new Error("session contains no JSONL records");
  return parsed;
}

function chooseCompaction(entries: ParsedLine[], selector: CompactionSelector | undefined): ParsedLine | undefined {
  const compactions = entries.filter(({ value }) => value.type === "compaction");
  if (compactions.length === 0) {
    if (selector !== undefined) throw new Error("the session contains no compaction entries");
    return undefined;
  }
  const selected = selector ?? "last";
  if (selected === "first") return compactions[0];
  if (selected === "last") return compactions.at(-1);
  if (!Number.isInteger(selected) || selected < 1 || selected > compactions.length) {
    throw new Error(`compaction must be first, last, or an ordinal from 1 to ${compactions.length}`);
  }
  return compactions[selected - 1];
}

function historicalBody(summary: string): string {
  return summary.replace(/^_[^\n]*_\n\n/, "");
}

async function writeArtifact(path: string, content: string, force: boolean): Promise<void> {
  await writeFile(path, content, { encoding: "utf8", flag: force ? "w" : "wx" });
}

export async function evaluateSession(options: SessionEvaluationOptions): Promise<SessionEvaluationReport> {
  const sessionFile = resolve(options.sessionFile);
  const outputDirectory = resolve(options.outputDirectory);
  if (options.managedRun?.directory !== outputDirectory) await protectCacheOutput(outputDirectory);
  const entries = parseJsonl(await readFile(sessionFile, "utf8"));
  if (options.wholeSession && options.compaction !== undefined) {
    throw new Error("whole-session mode cannot be combined with a compaction selector");
  }
  const selected = options.wholeSession ? undefined : chooseCompaction(entries, options.compaction);
  const selectedIndex = selected ? entries.indexOf(selected) : entries.length;
  const inputEntries = entries.slice(0, selectedIndex);
  if (inputEntries.length === 0) throw new Error("no records precede the selected compaction");
  const legacyMessageInput = inputEntries.every(({ value }) => typeof value.role === "string" && value.type === undefined);
  const inputRecords = legacyMessageInput
    ? inputEntries.map(({ value, line }) => {
      const record = canonicalRecordFromMessage(value);
      if (!record) throw new Error(`unsupported legacy message role on line ${line}: ${String(value.role)}`);
      return JSON.stringify(record);
    })
    : inputEntries.map(({ raw }) => raw);
  const input = `${inputRecords.join("\n")}\n`;
  const result = compileSessionJsonl(input, options.focus, undefined, options.recallEnabled ?? true);
  const historicalSourceFile = options.historicalFile ? resolve(options.historicalFile) : undefined;
  const historical = historicalSourceFile
    ? await readFile(historicalSourceFile, "utf8")
    : selected && typeof selected.value.summary === "string"
      ? selected.value.summary
      : undefined;
  const inputName = "input.jsonl";
  const currentName = "current.md";
  const historicalName = "historical.md";
  await mkdir(outputDirectory, { recursive: true });

  const ordinal = selected
    ? entries.filter(({ value, line }) => value.type === "compaction" && line <= selected.line).length
    : undefined;
  const inputMeasurement = measureEvaluationText(input);
  const currentMeasurement = measureSummary(result.summary);
  const historicalMeasurement = historical === undefined ? undefined : measureSummary(historical);
  const details = selected?.value.details as Record<string, unknown> | undefined;
  const hostMetrics = details && typeof details === "object" && !Array.isArray(details)
    ? Object.fromEntries(["tokensAfter", "summaryTokens"].filter((key) => typeof details[key] === "number").map((key) => [key, details[key]]))
    : {};
  const report: SessionEvaluationReport = {
    schemaVersion: 1,
    sessionFile,
    compiler: { focus: options.focus ?? null, recallEnabled: options.recallEnabled ?? true },
    provenance: await evaluationProvenance(),
    measurements: {
      semantics: { characters: "unicode-code-points", lines: "logical-lines-without-terminal-empty-line", tokens: "Pi SDK estimateTokens on summary text only; not rebuilt host context" },
      input: inputMeasurement,
      current: currentMeasurement,
      ...(historicalMeasurement ? { historical: historicalMeasurement, historicalToCurrentReductionPct: {
        bytes: reduction(historicalMeasurement.bytes, currentMeasurement.bytes),
        characters: reduction(historicalMeasurement.characters, currentMeasurement.characters),
        lines: reduction(historicalMeasurement.lines, currentMeasurement.lines),
        summaryTokens: reduction(historicalMeasurement.summaryTokens, currentMeasurement.summaryTokens),
      } } : {}),
      inputToCurrentReductionPct: {
        bytes: reduction(inputMeasurement.bytes, currentMeasurement.bytes),
        characters: reduction(inputMeasurement.characters, currentMeasurement.characters),
        lines: reduction(inputMeasurement.lines, currentMeasurement.lines),
      },
    },
    ...(selected ? { historicalHostContextMetrics: {
      source: "selected-compaction-details" as const,
      ...(typeof selected.value.tokensBefore === "number" ? { tokensBefore: selected.value.tokensBefore } : {}),
      ...hostMetrics,
      ...(typeof details?.tokensAfterSource === "string" ? { tokensAfterSource: details.tokensAfterSource } : {}),
    } } : {}),
    mode: selected ? "prefix-before-compaction" : "whole-session",
    inputFormat: legacyMessageInput ? "legacy-message-jsonl" : "session-jsonl",
    ...(selected && ordinal ? {
      selectedCompaction: {
        ordinal,
        line: selected.line,
        ...(typeof selected.value.id === "string" ? { id: selected.value.id } : {}),
        ...(typeof selected.value.timestamp === "string" ? { timestamp: selected.value.timestamp } : {}),
      },
    } : {}),
    input: {
      entries: inputEntries.length,
      bytes: Buffer.byteLength(input),
      sha256: sha256Hex(input),
      file: inputName,
    },
    current: {
      inputDigest: result.inputDigest,
      summaryDigest: result.summaryDigest,
      digestScope: result.digestScope,
      usefulRecordCount: result.usefulRecordCount,
      characters: Array.from(result.summary).length,
      bytes: Buffer.byteLength(result.summary),
      file: currentName,
    },
    ...(historical !== undefined ? {
      historical: {
        characters: Array.from(historical).length,
        bytes: Buffer.byteLength(historical),
        sha256: sha256Hex(historical),
        bodySha256: sha256Hex(historicalBody(historical)),
        bodyMatchesCurrent: historicalBody(historical) === result.summary,
        file: historicalName,
        ...(historicalSourceFile ? { sourceFile: historicalSourceFile } : {}),
      },
    } : {}),
  };

  const force = options.force === true;
  await writeArtifact(resolve(outputDirectory, inputName), input, force);
  await writeArtifact(resolve(outputDirectory, currentName), result.summary, force);
  if (historical !== undefined) {
    await writeArtifact(resolve(outputDirectory, historicalName), historical, force);
  }
  await writeArtifact(resolve(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, force);
  return report;
}

export function defaultEvaluationDirectory(_sessionFile: string): string {
  return createCacheRun("evaluations").directory;
}
