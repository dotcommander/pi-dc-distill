/**
 * Pure exported-declaration extraction and bounded type-signature catalog
 * assembly. The catalog is derived compaction state only: it is rebuilt from
 * successfully paired tool results each compaction, carry-forward reads only
 * the prior summary's wire bytes, and nothing here is persisted.
 */

import { compareCodeUnits } from "../wire-format.ts";
import { codePointLength, codePointPrefix } from "../unicode.ts";

/** One file's capped exported-declaration lines, in declaration order. */
export interface TypeSignatureEntry {
  readonly path: string;
  readonly signatures: readonly string[];
}

/** Bounded catalog plus omission accounting for cap and ordering drops. */
export interface TypeSignatureCatalog {
  readonly entries: readonly TypeSignatureEntry[];
  readonly omittedFiles: number;
  readonly omittedSignatures: number;
}

/** A successfully paired per-path observation: latest text at journal order. */
export interface SignatureObservation {
  readonly path: string;
  readonly text: string;
  readonly seq: number;
  readonly kind: "modified" | "read";
}

const ITEM_CODE_POINT_CAP = 512;
const SIGNATURES_PER_FILE_CAP = 8;
const FILES_PER_CATALOG_CAP = 12;

// Anchored single-line patterns; longest alternatives first, no nested quantifiers.
const TS_JS_PATTERN = /^export\s+(?:async\s+function|abstract\s+class|function|class|interface|type|enum|const|let|var|declare)\b/;
const PYTHON_PATTERN = /^(?:class|(?:async\s+)?def)\s+[^\s(:]/;
const GO_PATTERN = /^(?:func\s+[A-Z]|func\s+\([^)]*\)\s*[A-Z]|type\s+[A-Z])/;
const RUST_PATTERN = /^pub\s+(?:async\s+fn|fn|struct|enum|trait|type|const|static)\b/;

const PATTERNS_BY_EXTENSION: Readonly<Record<string, (line: string) => boolean>> = {
  ts: (line) => TS_JS_PATTERN.test(line), tsx: (line) => TS_JS_PATTERN.test(line),
  mts: (line) => TS_JS_PATTERN.test(line), cts: (line) => TS_JS_PATTERN.test(line),
  js: (line) => TS_JS_PATTERN.test(line), jsx: (line) => TS_JS_PATTERN.test(line),
  mjs: (line) => TS_JS_PATTERN.test(line), cjs: (line) => TS_JS_PATTERN.test(line),
  py: (line) => PYTHON_PATTERN.test(line),
  go: (line) => GO_PATTERN.test(line),
  rs: (line) => RUST_PATTERN.test(line),
};

/**
 * Extract exported-declaration lines for a file, one logical line each.
 * A line whose declaration continues on the next line — it ends with `(`,
 * `<`, `[`, or `:` — is cut deterministically with a trailing ellipsis.
 * Items are capped at 512 Unicode code points on complete-code-point
 * boundaries; unsupported extensions extract nothing.
 */
export function extractSignatures(path: string, text: string): string[] {
  const dot = path.lastIndexOf(".");
  if (dot < 0 || dot === path.length - 1) return [];
  const pattern = PATTERNS_BY_EXTENSION[path.slice(dot + 1).toLowerCase()];
  if (!pattern) return [];
  const signatures: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || !pattern(line)) continue;
    const signature = /[(\[<:]$/.test(line) ? `${line}…` : line;
    signatures.push(
      codePointLength(signature) > ITEM_CODE_POINT_CAP
        ? codePointPrefix(signature, ITEM_CODE_POINT_CAP)
        : signature,
    );
  }
  return signatures;
}

/** Parse a prior summary's `<type-signatures>` body into path → signatures. */
function parsePriorMarker(body: string | null): Map<string, string[]> {
  const carried = new Map<string, string[]>();
  if (!body) return carried;
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("- ")) continue;
    const item = line.slice(2);
    const separator = item.indexOf(": ");
    if (separator <= 0) continue;
    // The renderer escapes both fields symmetrically, so unescape both here.
    const path = item.slice(0, separator).replaceAll("&lt;", "<").replaceAll("&gt;", ">");
    const signature = item.slice(separator + 2).replaceAll("&lt;", "<").replaceAll("&gt;", ">");
    if (!signature) continue;
    const existing = carried.get(path) ?? [];
    if (!existing.includes(signature)) existing.push(signature);
    carried.set(path, existing);
  }
  return carried;
}

/**
 * Build the bounded catalog: fresh extraction from the latest paired
 * observation per path, carried prior-summary entries only for frontier
 * paths without a fresh observation, modified-class first then read-class
 * then carried, most recently observed path first within a class, ties by
 * lexical path. Identical (path, signature) pairs collapse; per-file and
 * catalog caps drop complete records only, with omission counts.
 */
export function buildTypeSignatures(
  observations: readonly SignatureObservation[],
  frontier: readonly string[],
  priorMarker: string | null,
): TypeSignatureCatalog {
  const fresh = new Map<string, { text: string; seq: number; kind: "modified" | "read" }>();
  for (const observation of observations) {
    const seen = fresh.get(observation.path);
    if (!seen || observation.seq > seen.seq) {
      fresh.set(observation.path, { text: observation.text, seq: observation.seq, kind: observation.kind });
    }
  }
  const frontierSet = new Set(frontier);
  const classRank = { modified: 0, read: 1, carried: 2 } as const;
  const candidates: Array<{ path: string; signatures: string[]; seq: number; rank: number }> = [];
  for (const [path, observation] of fresh) {
    const signatures = extractSignatures(path, observation.text);
    if (signatures.length > 0) {
      candidates.push({ path, signatures, seq: observation.seq, rank: classRank[observation.kind] });
    }
  }
  for (const [path, signatures] of parsePriorMarker(priorMarker)) {
    if (fresh.has(path) || !frontierSet.has(path) || signatures.length === 0) continue;
    candidates.push({ path, signatures, seq: -1, rank: classRank.carried });
  }
  candidates.sort((a, b) => a.rank - b.rank || b.seq - a.seq || compareCodeUnits(a.path, b.path));

  const entries: TypeSignatureEntry[] = [];
  let omittedSignatures = 0;
  for (const candidate of candidates) {
    if (entries.length >= FILES_PER_CATALOG_CAP) break;
    const unique: string[] = [];
    for (const signature of candidate.signatures) {
      if (unique.length >= SIGNATURES_PER_FILE_CAP) {
        omittedSignatures += candidate.signatures.length - unique.length;
        break;
      }
      if (!unique.includes(signature)) unique.push(signature);
    }
    if (unique.length > 0) entries.push({ path: candidate.path, signatures: unique });
  }
  return { entries, omittedFiles: Math.max(0, candidates.length - entries.length), omittedSignatures };
}

/** An empty catalog for windows without signature evidence. */
export function emptyTypeSignatures(): TypeSignatureCatalog {
  return { entries: [], omittedFiles: 0, omittedSignatures: 0 };
}
