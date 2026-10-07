---
command: prd
version: 3
id: prd-type-catalog
supersedes: none
mode: standalone
status: complete
created_at: 2026-10-06T18:59:45Z
source_baseline:
  revision: 6610c39626a36b2d6bc33f5e64f475042969dc06
  worktree: dirty
  wwgd_report: none
  relevant_dirty_paths:
    - index.ts (sha256 8a95f892d56feeefae7fca73d776f5638f8c0e5efbde5fdcf82cf1c4db6498ad)
    - lib/compiler/budget-formatter.ts (sha256 a6355d192e57fc0ad332c6da024437bd4abb657977267d54b9405aaefb3660a1)
    - lib/unicode.ts (sha256 3cb1635beb7c4eacfbbd0e743e4d721cb3a1d4ed127ed6d663376af39495d8a1)
    - lib/cache-stability.test.ts (untracked; sha256 819ea134c799c5695188d6eb196691ba8a6f8969af7067b53dcd9be753edd5d8)
    - AGENTS.md (instruction file; sha256 12313bd216e81dcf11aef57470ff0a30e3dee422d38d40d0f6a5490d85a48a82)
    - docs/algorithm.md (sha256 443b1817e16754970990014eb15a07aae66201330b108b2e3d627f3a20d0d415)
scope:
  allowed:
    - lib/compiler/type-signatures.ts
    - lib/compiler/type-signatures.test.ts
    - lib/compiler/types.ts
    - lib/local-compact.ts
    - lib/local-compact.test.ts
    - lib/compiler/budget-formatter.ts
    - lib/compiler/budget-formatter.test.ts
    - lib/compiler/section-scanner.ts
    - lib/compiler/section-scanner.test.ts
    - lib/recall.ts
    - lib/recall.test.ts
    - lib/recall-projection.ts
    - lib/continuation-recovery.ts
    - lib/continuation-recovery.test.ts
    - lib/cache-stability.test.ts
    - index.ts
    - index.test.ts
    - lib/phase1-controller.ts
    - AGENTS.md
    - docs/algorithm.md
  conditional:
    - lib/compiler/conversation-reducer.ts
    - lib/compiler/conversation-reducer.test.ts
    - lib/compiler/tool-tracker.ts
    - lib/compiler/tool-tracker.test.ts
    - lib/compiler/tool-effects.ts
    - lib/phase1-controller.test.ts
  forbidden:
    - package.json
    - bun.lock
    - .work/**
    - docs/specs/**
    - tests/e2e/**
    - scripts/**
    - lib/store.ts
    - lib/compaction-source.ts
    - lib/compiler/checkpoint.ts
    - lib/compiler/checkpoint.test.ts
    - lib/checkpoint-update.ts
    - lib/monitor.ts
    - lib/trigger.ts
    - lib/settings.ts
handoff:
  objective_kind: standalone_prd
  workflow_path: null
  audit_run_id: null
terminal_verification: [TG1, TG2, TG3, TG4]
---

# Type Catalog compiler section (details version 15)

## Purpose

After compaction, dc-distill summaries carry `read-files`/`modified-files` as
pointers but no API surface, so the model's first post-compaction action is
typically re-reading those files. This contract adds a bounded, deterministic
`<type-signatures>` catalog of exported declaration lines for observed files,
derived exclusively from successful paired tool results, so the model can plan
its next edit without re-reading. Compiled from `.work/type-catalog-design.md`
(sha256 8b0cb37271b8be3ef6ab0ad800cb569c50bf93920e8cb3bac6ea3baa83084270);
the design's adopted-idea source is `@monotykamary/pi-vcc@0.8.12` (MIT)
`[Type Catalog]`/`[Files And Changes]` — capability adopted only, no
third-party code copied.

## Compilation Basis

### User Intent

Current-session thread: pi-compact and pi-vcc package mining; user challenged
recall value; revised finding left the Type Catalog as the only surviving
adopted candidate. `/go` objective `go:pi-dc-distill:spec-type-catalog-compiler-section`
completed with the design doc (record: `.work/go/spec-type-catalog-compiler-section.md`,
status complete). User then invoked bare `/prd` immediately after that
terminal `Next choice: run /prd on .work/type-catalog-design.md`.

### WWGD Findings

None for this change. The historical audit run `wwgd-20261005-583608e9`
(report digest `6ccc76815f38326d1f8e51ad3af518a19ee19073931823f2b861d938905e865c`,
status complete, findings W001–W006 resolved by `prd-layer-consistency-correctness-fixes`,
status complete) is not the compilation basis and has no pending findings;
no workset conflict exists.

### ADRs and Accepted Decisions

- Repository contract (`AGENTS.md`): deterministic compiler, no LLM anywhere,
  provenance-gated file evidence from successful paired tool results
  (version-9 aliases, version-10 unique call-ID pairing), complete code
  points and balanced markers (never a final substring of structured
  output), 8,192-cp operating target with whole-record eviction ladder,
  65,536-cp hard cap, `details.version` bump on wire-format semantics
  change, historical entries readable and never rewritten, compiler purity
  (no filesystem/process/network/SDK imports under `lib/compiler/`).
- Design doc decisions (frozen input, digest above): marker name, placement,
  per-language extraction table, caps, carry-forward, version 15.
- Cache-stability contract (`lib/cache-stability.test.ts:5-9`): wire summary
  must be deterministic, volatile-data-free, and head-stable across
  successive compactions.

### Source Baseline

Revision `6610c39626a36b2d6bc33f5e64f475042969dc06`, dirty worktree. The
dirty/untracked paths listed in frontmatter carry completed-but-uncommitted
work from the prior standalone PRD plus ambient instruction/doc edits;
execution is sequential work on top, guarded by the recorded hashes
(overlap beyond them is `SOURCE_DRIFT`/`AMBIENT_WORK_CONFLICT`). Load-bearing
grounded seams:

- Assembly: `lib/local-compact.ts:8,50-116,256,294-296` —
  `collectConversationToolResult` populates `readFiles`/`modifiedFiles`/
  `createdFiles` OrderedSets; `observedFiles` feeds the checkpoint; prior
  summaries reach the conversation at `lib/local-compact.ts:454`.
- Rendering: `lib/compiler/budget-formatter.ts:524-628` (`formatSummary`
  marker loop; insertion after the `verification` block at :613, before
  `request-candidate` at :614), `formatFileMarkers` (:225-238) as the
  provenance-preamble pattern, `SectionSink`/`cached()` measure discipline.
- Budget: `enforceOperatingBudget` loop `lib/compiler/budget-formatter.ts:706-755`
  (whole-record eviction ladder; insertion before the `readFiles` branch at
  :730), omission accounting via `note()` → `summary-omissions` (:611,:756);
  hard-cap guard `enforceSummaryLimit` `lib/local-compact.ts:390-397`.
- Parsing/indexing: `lib/compiler/section-scanner.ts:3` known-marker set
  (duplicate or malformed known markers invalidate the scan); `lib/recall.ts:34-55`
  `MARKER_BLOCKS`.
- Version identity: `index.ts:64` (`const VERSION = 14`), guards `index.ts:699,748`;
  `lib/phase1-controller.ts:235` (`?.version === 14`);
  `lib/recall-projection.ts:16` (`details.version < 5 || details.version > 14`);
  `lib/continuation-recovery.ts:55` (`[8..14].includes`), `:79`
  (`version === 13 || version === 14`).

## Product Contract

### Problem

Post-compaction summaries lack any API-surface information about observed
files, forcing re-read tool calls (latency, tokens) after every compaction
before the next edit can be planned.

### Desired State

Every compiled summary whose discarded window contains successful paired
read/write tool results (or whose checkpoint frontier carries prior
signatures) renders one bounded `<type-signatures>` marker with exported
declaration lines for those files, under the caps and ordering below;
extraction is deterministic and provenance-gated; eviction is whole-record
with omission accounting; `details.version` is 15 with all reader matrices
extended; historical v5–14 entries remain readable and unrewritten.

### In Scope

Signature extraction (TS/JS, Python, Go, Rust), catalog assembly with
provenance gating and carry-forward, marker rendering and placement,
budget/eviction semantics, scanner and recall integration, version bump and
reader-matrix extension, repository contract documentation (AGENTS.md,
docs/algorithm.md), and the tests proving each.

### Non-Goals

- Extraction from bash-execution output (`cat`, heredocs) or thinking/prose.
- Symbol cross-referencing, call graphs, import graphs.
- Recall expansion of any kind (rejected this session); raw-session recall
  belongs to the pi-extensions package, not here.
- Checkpoint schema changes (schema stays v2; section ledger stays 17 keys).
- Full-file retention changes; retained-context policy changes.
- New dependencies or third-party code.

### Constraints

- No LLM anywhere; same canonical input ⇒ byte-identical output.
- Complete code points; balanced markers; never a final substring of
  structured output; truncation only on complete-record/item boundaries.
- Compiler purity: `lib/compiler/**` imports no fs/process/network/SDK.
- Provenance: only successful paired tool results (version-9 alias sets,
  version-10 unique call-ID matching) contribute; failed, unpaired,
  bash-execution, and thinking inputs never do.
- Cache stable head: sections through `## Conversation` remain byte-identical
  across successive compactions; the new marker renders after
  `<verification>`.
- Budgets: 8,192-cp operating target via the existing measure/projection
  path; 65,536-cp hard cap; marker soft cap 2,048 cps including framing,
  preamble, and omission notices.
- Dev baseline Pi 0.99.2 pins; peer ranges `"*"`; `bun install --frozen-lockfile`.

### Acceptance Criteria

- AC1: A bounded `<type-signatures>` marker renders for catalogs with
  content: fixed provenance preamble, one `- <display-path>: <signature>`
  line per entry, per-file cap 8 signatures, catalog cap 12 files
  (modified-class first), 512-cp items, and an `omitted:` line whenever caps
  or eviction dropped content; identical canonical input compiles
  byte-identical summaries including the marker.
- AC2: Only successful paired read-capable/write-capable tool results
  contribute signatures; bash-execution, thinking, failed, and unpaired
  inputs produce no entries.
- AC3: The marker renders immediately after `</verification>` and before the
  request-candidate block; the stable head through `## Conversation` is
  preserved byte-identically across successive compactions.
- AC4: The catalog counts toward the operating target; under pressure the
  whole marker is evicted (never partially sliced) before `read-files`
  entries in the ladder, with `summary-omissions` accounting; protected
  content is never displaced; the 65,536 hard-cap guard clears the catalog
  before file lists.
- AC5: Paths in the checkpoint frontier without a fresh observation this
  window carry their prior-summary entries forward; entries drop when the
  path leaves both checkpoint file lists; fresh observations replace carried
  ones.
- AC6: `details.version` is 15; trusted-newest, recall retention (5–15),
  integrity (≥10), and continuation recovery (8–15) guards accept 15;
  historical v5–14 entries remain readable and unrewritten.
- AC7: `scanSections` round-trips the marker (known set, balanced, no
  duplicates), and recall indexes the new marker block for section search.

## Closed Decisions

These implementation decisions are closed for this contract.

1. Marker name `<type-signatures>`; preamble line: `signatures: extracted
   from successful paired tool results; may be stale if a file changed
   outside observation`.
2. Placement: after `</verification>`, before the request-candidate block
   (`lib/compiler/budget-formatter.ts:613-614` insertion), rendered through
   the `cached()`/`SectionSink` measure discipline like sibling markers.
3. Extraction table (single pass, per-line anchored, no nested quantifiers):
   TS/JS (`export ` + `function|async function|class|abstract class|
   interface|type|enum|const|let|var|declare`; `.ts .tsx .mts .cts .js .jsx
   .mjs .cjs`), Python (`class`, `def`/`async def` incl. return
   annotations), Go (exported `func`/`type`), Rust (`pub fn`, `pub async
   fn`, `pub struct`, `pub enum`, `pub trait`, `pub type`, `pub const`,
   `pub static`); other extensions extract nothing.
4. Signature = one logical line trimmed without body; if it ends with `(`,
   `<`, `[`, or `:`, append `…` (deterministic multi-line cut); item cap 512
   cps with complete-code-point truncation.
5. File selection/order: modified-class first then read-class, most recently
   observed path first within a class (recency = sequence number of the
   path's latest successful paired observation in journal order), ties by
   `compareCodeUnits` lexical path; identical `(path, signature)` pairs
   collapse.
6. Eviction: one whole-record branch inserted immediately before the
   `readFiles` branch in the operating-budget loop (`note("type
   signatures")`); `enforceSummaryLimit` clears the catalog before file
   lists.
7. Carry-forward: parse the prior summary's `<type-signatures>` via
   `scanSections`, unescape `&lt;`/`&gt;`, retain entries whose path is in
   the checkpoint frontier (`files.read` ∪ `files.modified`); catalog
   entries store render-ready display paths and unescaped signature text;
   the renderer applies `displayPath`/escaping uniformly to fresh entries.
8. `details.version` = 15; checkpoint schema and the 17-key section ledger
   are unchanged.
9. New pure module `lib/compiler/type-signatures.ts` (extraction + catalog
   build, application-private exports, no new package); tests colocated as
   `lib/compiler/type-signatures.test.ts`.
10. `MARKER_BLOCKS` and the scanner known set each gain `type-signatures`;
    scanner absence in older summaries parses as an empty catalog.

## Technical Contract

### Ownership

- Extraction + catalog semantics: `lib/compiler/type-signatures.ts` (new,
  pure functions; single owner).
- Assembly/wiring: `lib/local-compact.ts` observe loop (where
  `collectConversationToolResult` already streams paired results);
  `ConversationResult` gains `typeSignatures` and an omission counter
  (`lib/compiler/types.ts`).
- Rendering/eviction: `lib/compiler/budget-formatter.ts`
  (`formatTypeSignatures` beside `formatFileMarkers`; eviction branch in
  `enforceOperatingBudget`; hard-cap clearing in `enforceSummaryLimit`).
- Parsing: `lib/compiler/section-scanner.ts` known set.
- Recall indexing: `lib/recall.ts` `MARKER_BLOCKS`; retention range:
  `lib/recall-projection.ts`.
- Version identity: `index.ts` `VERSION`; trusted-newest:
  `lib/phase1-controller.ts`; recovery: `lib/continuation-recovery.ts`.
- Documentation: `AGENTS.md`, `docs/algorithm.md`.

### Capability and Package Structure

One new file inside the existing `lib/compiler` deterministic-transform
capability; no new directory, package, or module boundary (M2: the catalog
is one cohesive concept with one predictable home).

### Interfaces and Reuse

Application-private but extractable pure functions:
`extractSignatures(path, text): string[]` and
`buildTypeSignatures(observations, frontier, priorMarker): entries`. No new
interfaces, classes, or dependency direction changes.

### State and Lifetime

The catalog is per-compaction derived state on `ConversationResult`; never
persisted in the checkpoint or store; rebuilt fresh each compaction;
carry-forward reads only the prior summary's authenticated wire bytes.

### Repeat Safety

Pure deterministic builders; same inputs ⇒ same catalog; no side effects;
no retry/concurrency surface beyond existing compiler determinism
guarantees.

### Runtime and Compatibility

Additive wire-format marker; `details.version` 14 → 15; readers extended as
in AC6; no public API, CLI, schema, exit-code, or ordering changes outside
the summary's late zone; scanner/recall backward compatible.

### Generalization

Not applicable (no `/wwgd` generalization candidate).

### Migration and Deletion

None; purely additive.

## Target Shape

```text
lib/compiler/type-signatures.ts        # pure extraction + catalog build (new)
lib/compiler/type-signatures.test.ts   # unit tests (new)
lib/compiler/types.ts                  # ConversationResult.typeSignatures, omission counter
lib/local-compact.ts                   # collect per-path latest paired text; build catalog; hard-cap clear
lib/compiler/budget-formatter.ts       # formatTypeSignatures; marker after </verification>; eviction branch
lib/compiler/section-scanner.ts        # known += type-signatures
lib/recall.ts                          # MARKER_BLOCKS += type-signatures
lib/recall-projection.ts               # retention 5–15
lib/continuation-recovery.ts           # accepts 15 (list + :79 guard)
index.ts                               # VERSION = 15
lib/phase1-controller.ts               # trusted-newest === 15
AGENTS.md, docs/algorithm.md           # output contract v15 documentation
```

Data flow: paired tool results (journal order) → per-path latest observed
text → `buildTypeSignatures` (+ carry-forward from prior summary, −
non-frontier paths, caps, ordering, dedup) → `formatTypeSignatures` (measure
or wire) → late-zone marker → eviction ladder → wire summary.

## Scope and Authority

Maintainer contract (carried into every task):
M1 each behavior/mutable fact has one predictable owner (above); M2 fewest
concepts per operation — one cohesive module, no fragmentation; M3 preserve
declared behavior/persistence/failure contracts — v5–14 readability, cache
head, budget ladder; M4 source-owned gates, no unrun-check claims; M5
preserve unrelated ambient work (dirty paths in frontmatter are evidence,
not repair targets).

```yaml
local_commit:
  permission: not_granted
  permitted_phases: []
  required_phases: []
  authority_basis: []
```

`may_touch` ceilings come from frontmatter `scope`; conditional paths
require the touching task to name them in `required_changes`.

## Execution Plan

### T1 — Pure signature extraction module

```yaml
id: T1
title: Implement lib/compiler/type-signatures.ts extraction with unit tests
objective: >-
  Pure, deterministic per-language signature extraction exists and passes
  focused unit tests, with no integration yet.
depends_on: []
owners:
  - lib/compiler/type-signatures.ts (new owner)
may_touch:
  - lib/compiler/type-signatures.ts
  - lib/compiler/type-signatures.test.ts
required_changes:
  - Implement Closed Decisions 3-5 (extension mapping, anchored per-line
    patterns without nested quantifiers, one-line signatures with the
    deterministic multi-line cut, 512-cp complete-code-point item cap,
    8-signature per-file cap) plus the pure catalog builder skeleton
    (12-file cap, class ordering, recency tie-break, dedup) per Closed
    Decision 5.
must_preserve:
  - Compiler purity: no fs/process/network/SDK imports.
  - No third-party code (pi-vcc idea only).
must_not:
  - Wire anything into local-compact, budget-formatter, scanner, or recall.
  - Add dependencies or touch conditional paths.
success:
  - id: T1-S1
    acceptance: [AC1]
    criterion: >-
      bun test lib/compiler/type-signatures.test.ts exits 0 covering the
      language table include/exclude cases, multi-line cut, Unicode
      identifiers, 512-cp boundary truncation, and per-file/catalog caps.
    gate_ids: [T1-S1]
stop_if:
  - Anchored per-line patterns cannot express a listed language surface
    without nested quantifiers (then redesign the pattern, not the ladder).
```

### T2 — Catalog assembly with provenance gating and carry-forward

```yaml
id: T2
title: Build ConversationResult.typeSignatures from paired results
objective: >-
  The compiler assembles the catalog exclusively from successful paired
  read/write tool results, with frontier carry-forward, before any
  rendering exists.
depends_on: [T1]
owners:
  - lib/local-compact.ts observe loop (collectConversationToolResult seam at :109)
  - lib/compiler/types.ts (ConversationResult)
may_touch:
  - lib/local-compact.ts
  - lib/compiler/types.ts
  - lib/compiler/type-signatures.ts
  - lib/compiler/type-signatures.test.ts
  - lib/local-compact.test.ts
required_changes:
  - Track per-path latest successful paired result text (journal-order
    sequence numbers for recency) at the existing collection seam; call the
    T1 builder with frontier = checkpoint files.read ∪ files.modified and
    the prior summary's scanned `<type-signatures>` block (Closed Decision
    7: scanSections parse, &lt;/&gt; unescape, render-ready display paths);
    store entries and the omission counter on ConversationResult.
  - Extend type-signatures.test.ts with assembly tests: provenance gating
    (AC2), carry-forward refresh/drop (AC5), ordering/caps (AC1).
must_preserve:
  - readFiles/modifiedFiles/createdFiles semantics, checkpoint observedFiles
    feeding, and all existing local-compact behavior (regression gate).
  - v9/v10 pairing discipline unchanged.
must_not:
  - Render any marker; touch scanner/recall/version sites.
  - Extract from bash-execution, thinking, failed, or unpaired inputs.
success:
  - id: T2-S1
    acceptance: [AC1, AC2, AC5]
    criterion: >-
      bun test lib/local-compact.test.ts lib/compiler/type-signatures.test.ts
      exits 0 with the new assembly tests green and no regressions.
    gate_ids: [T2-S1]
stop_if:
  - The prior-summary block is not reachable at the assembly seam without
    crossing forbidden scope (then block OUT_OF_SCOPE_DEPENDENCY).
```

### T3 — Rendering, eviction, parsing, recall, and version 15

```yaml
id: T3
title: Emit the marker and extend every version-15 reader
objective: >-
  Compiled summaries render the bounded late-zone marker; the budget ladder
  evicts it whole with accounting; scanner/recall/indexing accept it; the
  wire format is details version 15 with all guards extended and documented.
depends_on: [T2]
owners:
  - lib/compiler/budget-formatter.ts (formatSummary loop :613-614,
    formatFileMarkers pattern :225-238, enforceOperatingBudget :706-755)
  - lib/compiler/section-scanner.ts:3
  - lib/recall.ts:34-55
  - lib/recall-projection.ts:16
  - lib/continuation-recovery.ts:55,79
  - index.ts:64
  - lib/phase1-controller.ts:235
may_touch:
  - lib/compiler/budget-formatter.ts
  - lib/compiler/budget-formatter.test.ts
  - lib/local-compact.ts
  - lib/compiler/section-scanner.ts
  - lib/compiler/section-scanner.test.ts
  - lib/recall.ts
  - lib/recall.test.ts
  - lib/recall-projection.ts
  - lib/continuation-recovery.ts
  - lib/continuation-recovery.test.ts
  - index.ts
  - index.test.ts
  - lib/phase1-controller.ts
  - AGENTS.md
  - docs/algorithm.md
required_changes:
  - formatTypeSignatures per Closed Decisions 1-2 (cached()/SectionSink
    measure discipline; insertion after </verification>); eviction branch
    per Closed Decision 6 (whole-record, before the readFiles branch,
    note("type signatures"); enforceSummaryLimit clears catalog first);
    2,048-cp marker soft cap with an omitted line inside the marker.
  - Scanner known set and recall MARKER_BLOCKS gain type-signatures
    (Closed Decision 10); recall-projection retention extends to 15;
    continuation-recovery list and :79 guard accept 15.
  - index.ts VERSION = 15; phase1-controller trusted-newest === 15.
  - AGENTS.md/docs/algorithm.md: document the marker (name, preamble,
    caps, placement, carry-forward, eviction tier) and update current-version
    references 14 → 15, readability matrices (integrity 10-15, recovery
    8-15, recall 5-15, historical 5-14 entries remain readable), keeping
    historical sections historical.
  - Extend budget-formatter.test.ts / recall.test.ts /
    continuation-recovery.test.ts with rendering, round-trip (AC7), and
    version-acceptance cases (AC6).
must_preserve:
  - Stable head through ## Conversation (AC3); all existing marker order
    and content; 17-key checkpoint ledger; schema v2.
  - Historical v5-v14 entries readable and unrewritten.
must_not:
  - Change checkpoint schema, store, trigger/admission policy, or e2e
    assets (forbidden paths).
  - Slice the marker partially under budget pressure.
success:
  - id: T3-S1
    acceptance: [AC1, AC3, AC4, AC6, AC7]
    criterion: >-
      bun test lib/compiler/budget-formatter.test.ts lib/recall.test.ts
      lib/continuation-recovery.test.ts exits 0 with the new rendering,
      eviction-accounting, round-trip, and version-15 cases green.
    gate_ids: [T3-S1]
stop_if:
  - Any additional hardcoded version-14 guard is discovered outside allowed
    scope (grep before editing; OUT_OF_SCOPE_DEPENDENCY if not coverable).
```

### T4 — Cross-cutting invariants tests

```yaml
id: T4
title: Determinism, cache head stability, and budget invariants
objective: >-
  The extension's own test suite pins byte-identity, head stability with
  signature churn, whole-marker eviction accounting, and prior-summary
  carry-forward round-trips.
depends_on: [T3]
owners:
  - lib/cache-stability.test.ts (byte-identity/head-stability owner)
  - lib/local-compact.test.ts (lifecycle invariants)
may_touch:
  - lib/cache-stability.test.ts
  - lib/local-compact.test.ts
  - lib/compiler/type-signatures.test.ts
required_changes:
  - Extend lib/cache-stability.test.ts: a window with paired view_file/
    write_to_file content compiles byte-identically twice; a successive
    compaction whose signatures differ preserves the stable head through
    ## Conversation while <type-signatures> lands after </verification>
    (AC1, AC3).
  - Extend local-compact lifecycle tests: whole-marker eviction under
    pressure with summary-omissions accounting and no partial slicing
    (AC4); carry-forward across a real compaction boundary with frontier
    exit dropping entries (AC5); a v14 prior summary without the marker
    parses as an empty catalog (AC6).
must_preserve:
  - Existing cache-stability and local-compact assertions.
must_not:
  - Weaken or delete existing gates to admit new behavior.
success:
  - id: T4-S1
    acceptance: [AC1, AC3, AC4, AC5, AC6]
    criterion: bun test lib/cache-stability.test.ts exits 0 with new cases green.
    gate_ids: [T4-S1]
stop_if: []
```

## Verification Contract

### Task Gates

- T1-S1: {kind: task, check: {command: "bun test lib/compiler/type-signatures.test.ts", working_directory: .}, pass: "exit 0, all tests green", covers: {tasks: [T1], success: [T1-S1], acceptance: [AC1]}, run_when: {kind: task_candidate, task: T1}}
- T2-S1: {kind: task, check: {command: "bun test lib/local-compact.test.ts lib/compiler/type-signatures.test.ts", working_directory: .}, pass: "exit 0, assembly tests green, no regressions", covers: {tasks: [T2], success: [T2-S1], acceptance: [AC1, AC2, AC5]}, run_when: {kind: task_candidate, task: T2}}
- T3-S1: {kind: task, check: {command: "bun test lib/compiler/budget-formatter.test.ts lib/recall.test.ts lib/continuation-recovery.test.ts", working_directory: .}, pass: "exit 0, rendering/round-trip/version cases green", covers: {tasks: [T3], success: [T3-S1], acceptance: [AC1, AC3, AC4, AC6, AC7]}, run_when: {kind: task_candidate, task: T3}}
- T4-S1: {kind: task, check: {command: "bun test lib/cache-stability.test.ts", working_directory: .}, pass: "exit 0, cache-stability cases green", covers: {tasks: [T4], success: [T4-S1], acceptance: [AC1, AC3, AC4, AC5, AC6]}, run_when: {kind: task_candidate, task: T4}}

### Integration Gates

- IG1: {kind: integration, check: {command: "bun test", working_directory: .}, pass: "exit 0, full suite green after T1-T3 integration, before test hardening", covers: {tasks: [T1, T2, T3], success: [T1-S1, T2-S1, T3-S1], acceptance: [AC1, AC2, AC3, AC4, AC5, AC6, AC7]}, run_when: {kind: boundary, after_completed_tasks: [T1, T2, T3], before_starting_tasks: [T4]}}

### Terminal Gates

- TG1: {kind: terminal, check: {command: "bun test", working_directory: .}, pass: "exit 0, full suite green", covers: {tasks: [T1, T2, T3, T4], success: [T1-S1, T2-S1, T3-S1, T4-S1], acceptance: [AC1, AC2, AC3, AC4, AC5, AC6, AC7]}, run_when: {kind: contract_candidate}}
- TG2: {kind: terminal, check: {command: "bun x tsc --noEmit", working_directory: .}, pass: "exit 0, no type errors", covers: {tasks: [T1, T2, T3], success: [T1-S1, T2-S1, T3-S1], acceptance: [AC1, AC6]}, run_when: {kind: contract_candidate}}
- TG3: {kind: terminal, check: {command: "bun run distill:architecture", working_directory: .}, pass: "exit 0, architecture rules satisfied (compiler purity included)", covers: {tasks: [T1, T2, T3], success: [T1-S1, T3-S1], acceptance: [AC1, AC6]}, run_when: {kind: contract_candidate}}
- TG4: {kind: terminal, check: {command: "git diff --check", working_directory: .}, pass: "exit 0, no whitespace errors", covers: {tasks: [T1, T2, T3, T4], success: [T1-S1, T2-S1, T3-S1, T4-S1], acceptance: [AC1]}, run_when: {kind: contract_candidate}}

## Execution Block Conditions

- SOURCE_DRIFT: task-relevant tracked/untracked inputs change materially
  after compilation (compare frontmatter hashes before the first write).
- SPEC_CONTRADICTION: two frozen requirements cannot both hold (e.g. a
  discovered invariants test that requires the marker early-zone).
- MISSING_DECISION: a consequential open decision this contract missed.
- OUT_OF_SCOPE_DEPENDENCY: correctness requires mutating forbidden/unnamed
  paths (e.g. a version-14 guard inside `lib/store.ts`).
- AMBIENT_WORK_CONFLICT: the dirty baseline files change beyond recorded
  hashes from unrelated work.
- EXTERNAL_AUTHORITY_REQUIRED: any dependency/host authority need.
- GATE_FAILED_UNRESOLVED: a required gate still fails with no materially
  new authorized in-scope repair.
- FINALIZATION_UNRESOLVED: recorded finalization intent cannot be
  reconciled (local_commit is not_granted; nothing to reconcile here).

## Exit Criteria

All tasks complete; TG1-TG4 pass on the contract candidate; a compiled
fixture shows the marker after `</verification>` with correct caps and
preamble; byte-identity and head-stability tests green; v14-prior fixture
parses as empty catalog; AGENTS.md/docs/algorithm.md document v15.

## Workflow State

```yaml
implementation_approval: granted
execution_protocol: 3
state_revision: 10
execution_status: complete
current_task: null
tasks:
  T1: complete
  T2: complete
  T3: complete
  T4: complete
completed:
- T1
- T2
- T3
- T4
blocked: []
verification_receipts:
- kind: contract_start
  check: handoff + contract validation + source baseline preflight
  result: passed
  evidence: immutable digest 40864741e26cfddca736006d678e5b372cbf013bf03f7e80e65659d81e4c2adb recomputed and matched (utf8-crlf-lf-v1); HEAD 6610c39626a36b2d6bc33f5e64f475042969dc06; 6/6 baseline dirty-path hashes matched; version-3 task/gate graph validated; go_continuation bind rejected by hook - continued per protocol Continuation
- kind: checkpoint
  checkpoint_id: t1-start-2
  operation_id: T1#impl
  operation_kind: task
  phase: prepared
  contract_digest: 40864741e26cfddca736006d678e5b372cbf013bf03f7e80e65659d81e4c2adb
  intent: create lib/compiler/type-signatures.ts (pure extraction + catalog builder per Closed Decisions 3-5,7) and lib/compiler/type-signatures.test.ts; no integration wiring
  observed_baseline: neither path exists (both new files)
  next_action: write module + tests, then run gate T1-S1
- kind: task_gate
  task: T1
  gate: T1-S1
  check: bun test lib/compiler/type-signatures.test.ts
  result: passed
  evidence: 22 pass / 0 fail, 49 expect() calls, exit 0; covers language table, multi-line cut, Unicode identifiers, 512-cp boundary, per-file/catalog caps, ordering, dedup, carry-forward
- kind: checkpoint
  checkpoint_id: t1-complete-3
  operation_id: T1#impl
  operation_kind: task
  phase: reconciled
  contract_digest: 40864741e26cfddca736006d678e5b372cbf013bf03f7e80e65659d81e4c2adb
  attempted: created lib/compiler/type-signatures.ts + lib/compiler/type-signatures.test.ts
  verified: 'gate T1-S1 passed; semantic review: Closed Decisions 3-5,7 implemented; purity preserved; no integration wiring'
  task_paths:
    lib/compiler/type-signatures.ts: new
    lib/compiler/type-signatures.test.ts: new
  next_action: start T2 assembly wiring at local-compact observe seam
- kind: checkpoint
  checkpoint_id: t2-start-4
  operation_id: T2#impl
  operation_kind: task
  phase: prepared
  contract_digest: 40864741e26cfddca736006d678e5b372cbf013bf03f7e80e65659d81e4c2adb
  intent: 'wire ConversationResult.typeSignatures at local-compact observe seam: per-path latest paired text, frontier from checkpoint files, prior-marker carry-forward; types.ts field; assembly tests'
  observed_baseline: lib/local-compact.ts and lib/compiler/types.ts at compile-time baseline hashes (unmodified since contract)
  next_action: ground seams, then edit local-compact.ts + types.ts + tests
- kind: task_gate
  task: T2
  gate: T2-S1
  check: bun test lib/local-compact.test.ts lib/compiler/type-signatures.test.ts
  result: passed
  evidence: 200 pass / 0 fail, exit 0; 4 new seam tests (paired populate, gating incl. bash/unpaired/failed, re-read refresh via identity join, modified-before-read) + builder-level assembly tests
- kind: checkpoint
  checkpoint_id: t2-complete-5
  operation_id: T2#impl
  operation_kind: task
  phase: reconciled
  contract_digest: 40864741e26cfddca736006d678e5b372cbf013bf03f7e80e65659d81e4c2adb
  attempted: types.ts (signatureObservations/typeSignatures optional fields, LocalCompileResult.typeSignatures); local-compact.ts (set-growth + fileReads identity-join observation at result seam, post-checkpoint assembly, prior-marker helper); local-compact.test.ts (4 seam tests)
  verified: 'gate T2-S1 passed; repair: growth branch decoupled from fileReads join so write-class growth records; boundary noted: write-class text = first paired result text (write repeats have no chronology at this seam without tool-tracker changes, outside T2 scope); carry-forward wiring uses scanSections which returns the section after T3 adds the known-set entry'
  next_action: start T3 rendering/eviction/scanner/recall/version-15
- kind: checkpoint
  checkpoint_id: t3-start-6
  operation_id: T3#impl
  operation_kind: task
  phase: prepared
  contract_digest: 40864741e26cfddca736006d678e5b372cbf013bf03f7e80e65659d81e4c2adb
  intent: formatTypeSignatures + marker after </verification>; eviction branch before readFiles + enforceSummaryLimit catalog clearing; scanner known set + MARKER_BLOCKS + recall-projection 5-15 + continuation-recovery 15; index VERSION 15 + phase1-controller; AGENTS.md/docs/algorithm.md v15 docs; tests
  observed_baseline: budget-formatter.ts/index.ts at baseline hashes (a6355d19/8a95f892); scanner/recall/recovery at committed state
  next_action: ground formatter regions, then edit
- kind: task_gate
  task: T3
  gate: T3-S1
  check: bun test lib/compiler/budget-formatter.test.ts lib/recall.test.ts lib/continuation-recovery.test.ts
  result: passed
  evidence: 174 pass / 0 fail, exit 0 on current source; marker-after-verification, tail eviction + omission notes, hard-cap clearing, scanner/recall round-trip, v15 recovery cases
- kind: checkpoint
  checkpoint_id: t3-complete-7
  operation_id: T3#impl
  operation_kind: task
  phase: reconciled
  contract_digest: 40864741e26cfddca736006d678e5b372cbf013bf03f7e80e65659d81e4c2adb
  attempted: budget-formatter (formatTypeSignaturesSection + block row + tail-eviction branch); local-compact enforceSummaryLimit catalog clearing; scanner known set; recall MARKER_BLOCKS; recall-projection + continuation-recovery v15; index VERSION 15; phase1-controller === 15; AGENTS.md + docs (algorithm/architecture/usage) v15 sweep; version-fixture updates in 5 test files + new T3 tests in budget-formatter/section-scanner/recall/recall-projection test files
  verified: 'gate T3-S1 passed; docs-contract green after final algorithm.md fix; tsc + distill:architecture + git diff --check passed earlier this run; design note: entries array is priority-sorted so eviction is a tail-pop (no kind field needed); parsePriorMarker pins - path: signature wire format'
  next_action: run IG1 full-suite boundary, then start T4 cross-cutting invariants tests
- kind: checkpoint
  checkpoint_id: t4-start-8
  operation_id: T4#impl
  operation_kind: task
  phase: prepared
  contract_digest: 40864741e26cfddca736006d678e5b372cbf013bf03f7e80e65659d81e4c2adb
  intent: cache-stability byte-identity + head-stability-with-churn tests; local-compact lifecycle tests (carry-forward, frontier exit, whole-marker eviction, v14 marker-less prior)
  observed_baseline: cache-stability.test.ts and local-compact.test.ts at post-T3 state
  next_action: write tests, run gate T4-S1
- kind: task_gate
  task: T4
  gate: T4-S1
  check: bun test lib/cache-stability.test.ts
  result: passed
  evidence: '5 pass / 0 fail (2 new: byte-identity with paired view_file/write_to_file content; head stability through ## Session with churned signatures landing after </verification>, prior summary carried verbatim); exit 0'
- kind: repair
  task: T4
  attempt: 1
  issue: 'T4 carry-forward test exposed real T3 gap: normalizer compaction-entry gate, compaction-source predecessor-carry gate, and checkpoint-update base gate only recognized v13/v14 details, so v15 prior compaction entries silently lost checkpoint continuity, authenticatedPriorSummary, and predecessor identity'
  fix: 'extended all three gates to accept version 15 (normalizer: v14+ authentic-summary throw retained; error strings updated to v13/v14/v15)'
  verification: debug script confirmed prior checkpoint files merge across boundary; carry-forward entries survive; full suite green
- kind: checkpoint
  checkpoint_id: t4-complete-8
  operation_id: T4#impl
  operation_kind: task
  phase: reconciled
  contract_digest: 40864741e26cfddca736006d678e5b372cbf013bf03f7e80e65659d81e4c2adb
  attempted: 'lib/cache-stability.test.ts (+2 tests), lib/local-compact.test.ts (+4 tests: carry-forward survival, 50-cap frontier exit displacement, balanced-marker eviction with omission accounting, v14 marker-less prior parses empty); production fix in lib/compiler/normalizer.ts + lib/compaction-source.ts + lib/checkpoint-update.ts (v15 gate)'
  verified: gate T4-S1 passed; local-compact suite 182/182; docs already say v13/v14/v15 (no doc drift)
  next_action: run terminal gates TG1-TG4
- kind: terminal_gate
  gate: TG1
  check: bun test
  result: passed
  evidence: 1338 pass / 0 fail, 31083 expect() calls, exit 0
- kind: terminal_gate
  gate: TG2
  check: bun x tsc --noEmit
  result: passed
  evidence: no output, exit 0
- kind: terminal_gate
  gate: TG3
  check: bun run distill:architecture
  result: passed
  evidence: exit 0, compiler purity rules satisfied
- kind: terminal_gate
  gate: TG4
  check: git diff --check
  result: passed
  evidence: exit 0, no whitespace errors
- kind: state_repair
  check: objective.scope nested mapping to flow mapping; immutable prefix byte-identical; state_revision bump
  result: passed
  evidence: prefix digest 40864741e26cfddca736006d678e5b372cbf013bf03f7e80e65659d81e4c2adb recomputed and matched (utf8-crlf-lf-v1); prdState replica returns bindable; revision 9 to 10
finalization:
  finalized: true
  note: all terminal gates passed; PRD complete
repair_attempts:
  task_max: 4
  run_max: 12
  consumed_per_task:
    T1: 0
    T2: 0
    T3: 0
    T4: 0
  consumed_run: 0
objective:
  scope: {kind: standalone_prd, id: prd-type-catalog, path: docs/specs/type-catalog.md, immutable_digest: 40864741e26cfddca736006d678e5b372cbf013bf03f7e80e65659d81e4c2adb}
  status: complete
  operation: null
  retry_history: []
  waiting: null
```
