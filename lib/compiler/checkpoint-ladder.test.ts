import { describe, test, expect } from "bun:test";
import {
  emptyCheckpoint, buildCheckpoint, checkpointDigest, validateCheckpoint,
  evictCheckpointSection, checkpointSectionLedger, CHECKPOINT_SECTION_KEYS,
  type ResumeCheckpoint, type CheckpointSourceReference,
} from "./checkpoint.ts";
import { digest, sliceU16 } from "./helpers.ts";
import { codePointLength } from "../unicode.ts";
import { CompactionInputError } from "./errors.ts";

const blank = { mutationEpoch: 0, fileReads: [], verification: [], modifiedPaths: [] };
const noRequired = { requiredRead: () => false, requiredVerification: () => false };
const source = (entryId: string): CheckpointSourceReference => ({ entryId, sessionId: "session", blockIndex: 0, start: 0, end: 1, contentDigest: digest(entryId), sourceKind: "tool-observation" });
const read = (i: number) => ({ id: `read-${i}`, runner: "read", path: `/repo/optional-${i}.ts`, cwd: "/repo", status: "succeeded" as const, mutationEpoch: 0, freshnessEstablished: true, imports: [] });

function pressureCheckpoint(): ResumeCheckpoint {
  const c = emptyCheckpoint();
  const longFix = `edit_tool: {"newText":"${"y".repeat(900)}"}`;
  c.objective = "pressure objective";
  c.failures = [
    { id: "failure-a", objective: "pressure objective", signature: digest(`${longFix}\0boom`), invocationDigest: digest(longFix),
      fixExcerpt: sliceU16(longFix, 512), observedOutcome: "z".repeat(900), sources: [source("e1"), source("e2")], resolution: null, occurrences: 1 },
    { id: "failure-b", objective: "pressure objective", signature: digest("other\0boom"),
      fixExcerpt: "other", observedOutcome: "boom", sources: [source("e3")], resolution: null, occurrences: 1 },
  ];
  c.evidence = { ...blank, fileReads: Array.from({ length: 40 }, (_, i) => read(i)) };
  c.files = { read: ["/repo/a.ts", "/repo/b.ts"], modified: ["/repo/c.ts"] };
  return c;
}

describe("CD3 ladder order and purity", () => {
  test("eviction steps apply T3 sources, then T2 unreferenced reads stepped, then T1 excerpts, then optional inventories, then T0 floor", () => {
    const c = pressureCheckpoint();
    // T3: all failure sources clear in one step.
    expect(evictCheckpointSection(c, noRequired.requiredRead, noRequired.requiredVerification)).toMatchObject({ tier: "T3", action: "drop-sources", omittedRecords: 3 });
    expect(c.failures.every(f => f.sources.length === 0)).toBe(true);
    // T2: 40 unreferenced reads -> 20 -> 10 -> 0.
    expect(evictCheckpointSection(c, noRequired.requiredRead, noRequired.requiredVerification)).toMatchObject({ tier: "T2", action: "trim-reads-20", omittedRecords: 20 });
    expect(c.evidence.fileReads).toHaveLength(20);
    expect(evictCheckpointSection(c, noRequired.requiredRead, noRequired.requiredVerification)).toMatchObject({ tier: "T2", action: "trim-reads-10", omittedRecords: 10 });
    expect(evictCheckpointSection(c, noRequired.requiredRead, noRequired.requiredVerification)).toMatchObject({ tier: "T2", action: "trim-reads-0", omittedRecords: 10 });
    expect(c.evidence.fileReads).toHaveLength(0);
    // T1: 900-cp excerpts -> 256 -> 128.
    expect(evictCheckpointSection(c, noRequired.requiredRead, noRequired.requiredVerification)).toMatchObject({ tier: "T1", action: "shorten-excerpts-256" });
    expect(codePointLength((c.failures[0] as { fixExcerpt: string }).fixExcerpt)).toBe(256);
    expect(evictCheckpointSection(c, noRequired.requiredRead, noRequired.requiredVerification)).toMatchObject({ tier: "T1", action: "shorten-excerpts-128" });
    // Optional inventories: display files then unreferenced verification.
    expect(evictCheckpointSection(c, noRequired.requiredRead, noRequired.requiredVerification)).toMatchObject({ tier: "optional", action: "files-read", omittedRecords: 1 });
    expect(evictCheckpointSection(c, noRequired.requiredRead, noRequired.requiredVerification)).toMatchObject({ tier: "optional", action: "files-read", omittedRecords: 1 });
    expect(evictCheckpointSection(c, noRequired.requiredRead, noRequired.requiredVerification)).toMatchObject({ tier: "optional", action: "files-modified", omittedRecords: 1 });
    // T0 floor: identity cores, contracts, mutation frontier stay; nothing left to evict.
    expect(c.failures).toHaveLength(2);
    expect(c.objective).toBe("pressure objective");
    expect(evictCheckpointSection(c, noRequired.requiredRead, noRequired.requiredVerification)).toBeNull();
  });
  test("referenced reads are never evicted by the T2 tier", () => {
    const c = pressureCheckpoint();
    for (const f of c.failures) f.sources = [];
    const requiredRead = (r: { path: string }) => r.path === "/repo/optional-0.ts";
    expect(evictCheckpointSection(c, requiredRead, noRequired.requiredVerification)).toMatchObject({ tier: "T2", action: "trim-reads-20" });
    expect(c.evidence.fileReads.some(r => r.path === "/repo/optional-0.ts")).toBe(true);
  });
  test("buildCheckpoint cancels with protected_overflow only when T0 alone cannot fit", () => {
    const objective = "o".repeat(70_000);
    expect(() => buildCheckpoint(undefined, undefined, blank, undefined, undefined, undefined, [], [], undefined)).not.toThrow();
    const thrower = emptyCheckpoint();
    thrower.objective = objective;
    expect(() => buildCheckpoint(thrower, undefined, blank)).toThrow(CompactionInputError);
    try { buildCheckpoint(thrower, undefined, blank); } catch (error) {
      expect((error as CompactionInputError).code).toBe("protected_overflow");
    }
  });
  test("buildCheckpoint pressure path drops sources before reads before excerpts and attributes omissions", () => {
    const longFix = `edit_tool: {"newText":"${"y".repeat(900)}"}`;
    const failure = { signature: digest(`${longFix}\0${"z".repeat(900)}`), attemptedFix: longFix, observedOutcome: "z".repeat(900), sources: [source("e1"), source("e2")] };
    // 50 reads of ~1,460 cps each exceed the 65,536-cp envelope before the ladder runs.
    const fatRead = (i: number) => ({ ...read(i), path: `/repo/${"x".repeat(1400)}-${i}.ts` });
    const observations = { ...blank, fileReads: Array.from({ length: 50 }, (_, i) => fatRead(i)) };
    const built = buildCheckpoint(undefined, undefined, observations, undefined, undefined, undefined, [], [failure]);
    const stored = built.failures[0] as { fixExcerpt: string; observedOutcome: string };
    expect(built.failures.every(f => f.sources.length === 0)).toBe(true);
    expect(built.evidence.fileReads.length).toBe(20);
    expect(codePointLength(stored.fixExcerpt)).toBe(512);
    expect(codePointLength(stored.observedOutcome)).toBe(512);
    expect(built.risks.some(r => r.startsWith("Optional checkpoint records omitted: ") && Number(r.split(": ")[1]) >= 32)).toBe(true);
    expect(() => validateCheckpoint(JSON.parse(JSON.stringify(built)), checkpointDigest(built))).not.toThrow();
  });
});

describe("section ledger", () => {
  test("ledger enumerates exactly the seventeen fixed section keys with nonnegative costs", () => {
    const c = pressureCheckpoint();
    const ledger = checkpointSectionLedger(c);
    expect(ledger.version).toBe(1);
    expect(Object.keys(ledger.sections).sort()).toEqual([...CHECKPOINT_SECTION_KEYS].sort());
    expect(Object.values(ledger.sections).every(cost => cost >= 0)).toBe(true);
    expect(ledger.sections["failures.sources"]).toBeGreaterThan(0);
    expect(ledger.sections["failures.identityCore"]).toBeGreaterThan(0);
    expect(ledger.ladderOutcomes).toEqual({ sourcesDropped: false, unreferencedReads: 40, maxFixExcerpt: 512 });
  });
  test("ledger records ladder outcomes: dropped sources, trimmed reads, shortened excerpts", () => {
    const c = pressureCheckpoint();
    for (let step = evictCheckpointSection(c, noRequired.requiredRead, noRequired.requiredVerification); step; step = evictCheckpointSection(c, noRequired.requiredRead, noRequired.requiredVerification)) {
      if (step.tier === "optional") break;
    }
    const ledger = checkpointSectionLedger(c);
    expect(ledger.ladderOutcomes.sourcesDropped).toBe(true);
    expect(ledger.ladderOutcomes.unreferencedReads).toBe(0);
    expect(ledger.ladderOutcomes.maxFixExcerpt).toBe(128);
    expect(ledger.sections["failures.sources"]).toBeLessThan(10);
  });
  test("no-pressure build is deterministic and byte-identical across repeated compilation", () => {
    const longFix = `edit_tool: {"newText":"${"y".repeat(400)}"}`;
    const failure = { signature: digest(`${longFix}\0boom`), attemptedFix: longFix, observedOutcome: "boom", sources: [source("e1")] };
    const observations = { ...blank, fileReads: Array.from({ length: 10 }, (_, i) => read(i)) };
    const first = buildCheckpoint(undefined, undefined, observations, undefined, undefined, undefined, [], [failure]);
    const second = buildCheckpoint(undefined, undefined, observations, undefined, undefined, undefined, [], [failure]);
    expect(checkpointDigest(first)).toBe(checkpointDigest(second));
    expect(first.failures[0].sources).toHaveLength(1);
    expect(first.evidence.fileReads).toHaveLength(10);
    const ledger = checkpointSectionLedger(first);
    expect(ledger.ladderOutcomes.sourcesDropped).toBe(false);
    expect(ledger.ladderOutcomes.unreferencedReads).toBe(10);
    expect(ledger.ladderOutcomes.maxFixExcerpt).toBe(codePointLength(longFix));
    const round = validateCheckpoint(JSON.parse(JSON.stringify(first)), checkpointDigest(first));
    expect(checkpointDigest(round)).toBe(checkpointDigest(first));
  });
});
