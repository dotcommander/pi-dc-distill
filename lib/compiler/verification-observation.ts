import type { VerificationObservation } from "./types.ts";

const EVIDENCE_LIMIT = 300;

/** Only the bounded excerpt is converted to code points; supplied output stays streamed. */
function boundedEvidence(line: string, markerIndex = 0): string {
  // A decisive marker leads long excerpts rather than being buried after a prefix.
  const suffix = line.slice(markerIndex);
  let excerpt = "";
  let count = 0;
  for (const point of suffix) {
    if (count === EVIDENCE_LIMIT - 1) return `${excerpt}…`;
    excerpt += point;
    count++;
  }
  if (markerIndex > 0) return count < EVIDENCE_LIMIT ? `${excerpt}…` : excerpt;
  return excerpt;
}

function passingCase(line: string): boolean {
  // These are runner-owned outcome prefixes/suffixes, not arbitrary mentions of PASS.
  return /^\s*(?:PASS\b|ok\s|[✓✔]|\(pass\)|\.\.\.\s+ok\b)/.test(line)
    || (/^test\s/.test(line) && /\.\.\.\s+ok\s*$/.test(line))
    || /\bPASSED(?:\s+\[[^\]]+\])?\s*$/.test(line);
}

/** Decisive outcome markers shared with previews; test names alone are not outcomes. */
export function verificationFailureIndex(line: string): number {
  if (passingCase(line)) return -1;
  const exit = /\b(?:command exited with code|exit code|exit)\s*[:=]?\s*(-?[1-9][0-9]*)\b/i.exec(line);
  if (exit) return exit.index;
  const count = /\b[1-9][0-9]*\s+(?:fail(?:ed)?|failures?)\b|\b(?:fail(?:ed)?|failures?)\s*:\s*[1-9][0-9]*\b/i.exec(line);
  if (count) return count.index;
  // Recognize terminal formats from TAP, Node, pytest and Rust rather than name words.
  const runnerFailure = /^\s*(?:not ok(?:\s|$)|[✖✗×]\s|FAILED(?:\s|$)|=+\s*FAILURES\s*=+)/.exec(line);
  if (/^test\s/.test(line) && /\.\.\.\s+FAILED\s*$/.test(line)) return 0;
  if (runnerFailure) return runnerFailure.index + runnerFailure[0].search(/\S/);
  const scrubbed = line.replace(/\b0\s+(?:fail(?:ed)?|failures?)\b|\b(?:fail(?:ed)?|failures?)\s*:\s*0\b/gi, (match) => " ".repeat(match.length));
  const explicit = /^\s*FAIL\b|(?:^|\s)(?:---\s+)?FAIL(?:ED)?\s*:|(?:^|\s)\(fail\)|(?:^|\s)FAIL(?=\s*(?:$|[[(]))/i.exec(scrubbed);
  if (explicit) return explicit.index + explicit[0].search(/\S/);
  // Narrative failures remain evidence, but quoted examples and identifiers do not.
  const narrative = /\bfailed\s+(?:unexpectedly|with|to|because|at|on|during|after|before)\b/i.exec(line);
  return narrative?.index ?? -1;
}

export function verificationSkipIndex(line: string): number {
  if (passingCase(line)) return -1;
  const count = /\b[1-9][0-9]*\s+skip(?:ped)?\b|\bskip(?:ped)?\s*:\s*[1-9][0-9]*\b/i.exec(line);
  if (count) return count.index;
  const scrubbed = line.replace(/\b0\s+skip(?:ped)?\b|\bskip(?:ped)?\s*:\s*0\b/gi, (match) => " ".repeat(match.length));
  const marker = /(?:^|\s)SKIP(?:PED)?\s*:|\bno tests to run\b/i.exec(scrubbed);
  return marker ? marker.index + marker[0].search(/\S/) : -1;
}

interface DecisiveLine {
  line: string;
  markerIndex: number;
  previous: string;
  next: string;
  sourceLine: number;
}

function decisiveEvidence(found: DecisiveLine, oversized: boolean, totalLines: number): string {
  const marker = boundedEvidence(found.line, found.line.length > EVIDENCE_LIMIT ? found.markerIndex : 0);
  if (!oversized) return marker;
  let evidence = marker;
  // Failure first, then adjacent context. Reserve the omission indicator before adding context.
  for (const neighbor of [found.previous, found.next]) {
    if (!neighbor) continue;
    const available = EVIDENCE_LIMIT - Array.from(evidence).length - 4;
    if (available <= 0) break;
    let excerpt = "";
    let used = 0;
    for (const point of neighbor) {
      if (used === available) break;
      excerpt += point;
      used++;
    }
    evidence += ` | ${excerpt}`;
  }
  if (found.sourceLine > 1 || found.sourceLine + 1 < totalLines || evidence !== found.line) {
    if (Array.from(evidence).length < EVIDENCE_LIMIT && !evidence.endsWith("…")) evidence += "…";
  }
  return evidence;
}

/** Full supplied output is inspected before preview compression, with bounded retained state.
 * Missing host bytes/status cannot establish a pass; decisive failures still take precedence.
 * Pairing, runner command identity, cwd and mutation chronology belong to the receipt collector.
 */
export function observeVerification(result: string, isError: boolean | undefined): VerificationObservation {
  let failure: DecisiveLine | undefined;
  let skip: DecisiveLine | undefined;
  let first = "";
  let previous = "";
  let summary = "";
  let statusLine = "";
  let unavailableBytes = false;
  let lineNumber = 0;
  let cursor = 0;
  while (cursor <= result.length) {
    const newline = result.indexOf("\n", cursor);
    const end = newline < 0 ? result.length : newline;
    const line = result.slice(cursor, end).trim();
    lineNumber++;
    if (line) {
      if (!first) first = line;
      if (failure && !failure.next && failure.sourceLine < lineNumber) failure.next = line;
      if (skip && !skip.next && skip.sourceLine < lineNumber) skip.next = line;
      if (!failure) {
        const markerIndex = verificationFailureIndex(line);
        if (markerIndex >= 0) failure = { line, markerIndex, previous, next: "", sourceLine: lineNumber };
      }
      if (!skip) {
        const markerIndex = verificationSkipIndex(line);
        if (markerIndex >= 0) skip = { line, markerIndex, previous, next: "", sourceLine: lineNumber };
      }
      if (/(?:\b\d+\s+(?:pass(?:ed)?|fail(?:ed)?|skip(?:ped)?|tests?)\b|\btests?:\s*\d+\b|\b(?:pass|fail|skip)(?:ed)?:\s*\d+\b)/i.test(line)) summary = line;
      if (/^(?:ok\s+|PASS\b|FAIL\b|--- FAIL|\?\s+)/.test(line) || /command exited with code/i.test(line)) statusLine = line;
      // Recognize host notices, not an ordinary passing test named "truncated output".
      if (!passingCase(line) && /^(?:\[?(?:warning:\s*)?output (?:was )?truncated\b|\.\.\.\s*\(\d+ (?:bytes|characters) (?:omitted|truncated)\)|\[showing lines \d+[-–]\d+ of \d+\b|\[output truncated\b)/i.test(line)) unavailableBytes = true;
      previous = line;
    }
    if (newline < 0) break;
    cursor = newline + 1;
  }
  const success = summary || statusLine || first || "no output";
  if (failure) return { status: "FAIL", evidence: decisiveEvidence(failure, result.length > EVIDENCE_LIMIT, lineNumber) };
  if (isError === true) return { status: "FAIL", evidence: boundedEvidence(`tool result isError=true; ${success}`) };
  if (typeof isError !== "boolean") return { status: "INCOMPLETE", evidence: boundedEvidence(`tool result status missing; ${success}`) };
  if (unavailableBytes) return { status: "INCOMPLETE", evidence: boundedEvidence(`host output truncated; ${success}`) };
  if (skip) return { status: "SKIP", evidence: decisiveEvidence(skip, result.length > EVIDENCE_LIMIT, lineNumber) };
  return { status: "PASS", evidence: boundedEvidence(success) };
}
