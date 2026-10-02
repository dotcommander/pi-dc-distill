import { createCacheRun, protectCacheOutput, type CacheRun } from "./cache-runs.ts";
import { sha256Hex } from "./sha256.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  const result = compileSessionJsonl(input, options.focus);
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
  const report: SessionEvaluationReport = {
    schemaVersion: 1,
    sessionFile,
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
