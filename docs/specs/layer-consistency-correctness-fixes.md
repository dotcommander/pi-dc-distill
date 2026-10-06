---
command: prd
version: 3
id: prd-layer-consistency-correctness-fixes
supersedes: none
mode: standalone
status: complete
created_at: 2026-10-06T02:49:30Z
source_baseline:
  revision: 2a078feb56b3007a776ccf37d8ce714053357b91
  worktree: dirty
  wwgd_report: >-
    6ccc76815f38326d1f8e51ad3af518a19ee19073931823f2b861d938905e865c
    (run wwgd-20261005-583608e9, context only; W001-W006 all resolved)
  relevant_dirty_paths:
    - index.ts (sha256 ab8706f87c6fb807c0b3ee674ba85c3d535fac095c334f298bbeebb8eb0edb00)
    - lib/compiler/checkpoint.ts (sha256 65b409e1799e68e70a3440120d58e618ba4665f7a4b97970b30902a5c87951ed)
    - lib/store.ts (sha256 0fa9e7c63818965ea91c7b3c207b8e45623cf9026467d1534b50d7b63709bfd1)
    - lib/output-compactor.ts (sha256 9ebd68c1c7e82a98357d1a416935a5750cbf2980553644513102bf45dac1e524)
    - lib/compiler/verification-display.ts (sha256 c698e75804e37b1f5ce0f62602a139de10260cf3485d7436105bb037c6c46fc3)
    - lib/compiler/budget-formatter.ts (sha256 23b876eee5619de92a327b6e9a8f7b3d46146021b0fccf91a1d6bbacd7002925)
    - lib/recall.ts (sha256 b87ca426ef87f0945f517218182d5473cfd65444e3e4eacacdaf685ef431491f)
    - lib/unicode.ts (sha256 2a1a14f6c87a12f5acc1ef0ed8b10f3e30912f6344d46d1928f2a3a1434ca123)
scope:
  allowed:
    - lib/output-compactor.ts
    - lib/output-compactor.test.ts
    - lib/unicode.ts
    - lib/unicode.test.ts
    - lib/compiler/verification-display.ts
    - lib/compiler/verification-display.test.ts
    - lib/compiler/budget-formatter.ts
    - lib/compiler/budget-formatter.test.ts
    - lib/recall.ts
    - lib/recall.test.ts
    - index.ts
    - index.test.ts
  conditional:
    - lib/store.ts
    - lib/store.test.ts
    - lib/compiler/tool-tracker.ts
    - lib/compiler/tool-tracker.test.ts
  forbidden:
    - docs/**
    - .work/**
    - package.json
    - bun.lock
    - lib/compiler/checkpoint.ts
    - lib/compiler/checkpoint.test.ts
    - lib/compaction-source.ts
    - lib/phase1-controller.ts
    - lib/local-compact.ts
    - lib/recall-projection.ts
    - lib/data-migration.ts
    - lib/continuation-recovery.ts
handoff:
  objective_kind: standalone_prd
  workflow_path: null
  audit_run_id: null
terminal_verification: [TG1, TG2, TG3, TG4]
---

# Layer-consistency correctness fixes: preview Unicode/budget, effect-retry lifetime, protected verification display, recall checkpoint indexing

## Purpose

Fix the four verified correctness defects where the layers around the canonical
checkpoint are less rigorous than the checkpoint itself: tool-output previews
that can emit malformed Unicode and exceed their declared budget, an effect
retry helper that re-invokes effects without ownership or idempotency guards,
a budget-eviction path that silently drops protected verification receipts from
the display section, and a recall search that cannot find checkpoint-preserved
state. Each fix ships with a cross-layer regression proving the boundary end to
end. This contract implements only these correctness fixes; the review's
deletion, clarity, performance, and packaging passes are explicitly out of scope.

## Compilation Basis

### User Intent

The user supplied two current-session review documents about this repository:
`pi-distill-review-evidence.txt` (focused reproduction evidence; the file has
since been removed from Downloads but its content is quoted in session context,
and it cites repomix snapshot SHA-256
`f78b0a4678984dea1ed897057889dd307d030501581e894318646914c58d5fef`) and a
follow-up full review. Both recommend fixing four boundary problems (R01-R04)
before any broad cleanup, and recommend preserving the rigorous state model
while fixing "the consumers that violate it". The user then invoked bare `/prd`
to compile that evidence into an executable contract. Intent is explicit and
singular: one correctness contract for the four defects.

### WWGD Findings

None compiled. `.work/wwgd-report.md` (digest
`6ccc76815f38326d1f8e51ad3af518a19ee19073931823f2b861d938905e865c`, run
`wwgd-20261005-583608e9`, same revision as this baseline) is context only:
all its findings W001-W006 are `disposition: resolved` in
`.work/workflow.yaml`; there are no pending workset findings or uncontracted
siblings that this standalone contract could displace. `.work/diet.md` has no
candidate overlapping this scope (checked for output-compactor,
verification-display, independentEffect, recall.ts, compactText; zero matches).

### ADRs and Accepted Decisions

Binding repository contracts from `AGENTS.md` (pi-dc-distill), treated as
accepted decisions:

- Compaction details are version 14; checkpoint is schema v2 with schema-v1
  historical readability; versions 5-13 remain readable and are never rewritten.
- Formatting must preserve complete headings and balanced XML markers; any
  shortening preserves complete Unicode code points; malformed decoded Unicode
  is rejected with a typed input error.
- Transactional lifecycle: success artifacts (logs, dumps, recall, monitor
  reset, notifications) exist only after a matching owned `session_compact`
  commit; failures never fall through to default compaction (fail closed).
- No LLM anywhere in this extension; deterministic compilation only.
- Trigger policy v3, autonomous admission bands, and the compiler-failure pause
  are unchanged by this contract.
- Peer dependencies remain `"*"`; dev pins 0.99.2; no new dependencies.
- Reviewer's rejected directions carried forward as constraints: do not add a
  strategy registry, do not memoize the entire mutable conversation object, do
  not remove safeguards while reducing adapters.

### Source Baseline

- HEAD `2a078feb56b3007a776ccf37d8ce714053357b91`, worktree dirty (52 entries
  in `git status --short`; ambient in-progress work, preserved as-is).
- Task-relevant dirty paths and content identities are recorded in frontmatter
  `source_baseline.relevant_dirty_paths` (SHA-256 of exact file bytes).
  `index.ts`, `lib/compiler/checkpoint.ts`, `lib/store.ts` (plus their tests
  and `lib/recall-projection.*`, `lib/compiler/checkpoint.test.ts`) are dirty;
  `lib/output-compactor.ts`, `lib/compiler/verification-display.ts`,
  `lib/compiler/budget-formatter.ts`, `lib/recall.ts`, `lib/unicode.ts` are
  clean at HEAD content but hashed identically for drift detection.
- Baseline drift detection is local task-start evidence: `/go` re-hashes these
  paths before its first product write; material change blocks as
  `SOURCE_DRIFT`. It is not a permanent byte-identity requirement on the final
  state; later authorized sibling work reconciles rather than auto-failing.
- Every defect claim below was re-verified against the live working tree on
  2026-10-06; cited line numbers refer to the hashed bytes above.

## Product Contract

### Problem

One review framing, four confirmed defect witnesses. The canonical checkpoint
is rigorous; several consumers around it are not.

1. **R01 — Previews can be malformed Unicode and exceed their budget.**
   `lib/output-compactor.ts` `compactText()` uses raw UTF-16 slices:
   first pass `text.slice(0, headChars)` / `text.slice(-tailChars)` (~lines
   137-141), second pass the same pattern plus an omission marker appended on
   top of a full head+tail allocation (~lines 171-176). Consequences (both
   reproduced by the reviewer against the exact extracted source): an emoji
   crossing a cut boundary becomes an unpaired surrogate (12,000-char policy
   yields a 12,041-char preview containing lone surrogates), and when
   tool-output compaction is enabled that preview is patched into the session
   as tool-result content — later compaction input normalization then rejects
   it with `CompactionInputError invalid_input ("malformed Unicode in
   checkpoint input")`. Additional raw-slice sites in the same preview path:
   `boundedSelectedPreview` priority-line excerpt and single-oversized-line
   fallbacks (~lines 229-253), `jsonPreview` `describe` string excerpts, and
   `inputSummary`. Existing code-point utilities (`lib/unicode.ts`
   `codePointLength`, `codePointPrefix`) are not used by this module.

2. **R02 — The generic effect retry bypasses lifetime checks and idempotency.**
   `index.ts:208-229` `independentEffect()` retries every failed effect once
   unconditionally; callers verify ownership (`runtime.ownsAttempt(ticket,
   ctx)` / `runtime.isCurrent(lease, ctx)`) only after the helper returns
   (post-commit sequence at `index.ts:799-841`). If the first invocation
   suspends, the session retires, and the invocation then rejects, the helper
   starts the effect again under a dead owner. Separately, serialization does
   not make an effect idempotent: `lib/store.ts:134-148` `appendLog` appends
   under `withStoreLock`, so an error surfacing after a successful append
   (e.g., lock release) followed by a blind retry double-appends;
   `writeDump` names include millisecond timestamps (duplicate artifacts on
   retry); notifications would duplicate. Four call sites: "Recall
   reconciliation" (`index.ts:238`), "Compaction log" (799), "Compaction
   dump" (824), "Compaction notification" (841).

3. **R03 — Protected verification rows are silently evicted from display.**
   `lib/compiler/verification-display.ts` `verificationEvictionIndex()` falls
   back to `lines.length - 1` when every row is protected
   (`findLastIndex(...) < 0`), selecting a protected row for removal; the
   budget loop at `lib/compiler/budget-formatter.ts` (~lines 709-726) then
   splices it. With two FAIL receipts under pressure, one FAIL row is silently
   dropped from the rendered `<verification>` section (checkpoint keeps both;
   this is display loss). The stale-pass shortcut in the same ladder
   (`startsWith("PASS ") && includes("[freshness: not established")`) removes
   rows without consulting the protection predicate, so a stale PASS that
   satisfies a required verification identity can be dropped by the shortcut.

4. **R04 — Recall cannot find state compaction successfully preserved.**
   `lib/recall.ts` `MARKER_BLOCKS` (~lines 34-55) omits `checkpoint-v1`, and
   `searchRecallEntries` builds name/keyword candidates exclusively from
   `SUMMARY_PARTS`. But `lib/compiler/checkpoint.ts:399-414` renders pins and
   constraints into a `<checkpoint-v1>...</checkpoint-v1>` block inside every
   compiled summary (recognized as a known section by
   `lib/compiler/section-scanner.ts:3`). Result: a constraint pin's unique
   text survives in a valid summary yet returns zero recall results, while a
   task keyword mirrored into a recognized projection returns one. Preservation
   and retrievability disagree.

### Desired State

- Every preview the extension generates is well-formed Unicode (complete code
  points at every truncation boundary) and fits its declared budget including
  its own omission framing, and remains valid compiler input.
- Post-commit effects never re-invoke after ownership/lifetime loss; retries
  are effect-specific and never duplicate persisted effects.
- Protected verification receipts (required, FAIL, INCOMPLETE) are never
  silently removed from the display section; unavoidable overflow is reported
  through the existing explicit protected-overflow accounting.
- Recall search finds checkpoint-only state (pins, constraints, other
  checkpoint-v1 content) by keyword and by marker name, with existing
  provenance and output budgeting.

### In Scope

- The four fixes above, in `lib/output-compactor.ts` (+ `lib/unicode.ts`
  helpers as needed), `index.ts` (effect scheduling; `lib/store.ts` only if
  retry-contention relocation requires it), `lib/compiler/verification-display.ts`
  + `lib/compiler/budget-formatter.ts`, `lib/recall.ts`.
- Colocated test regressions for each fix, including the four cross-layer
  contracts from the review: preview→compiler-input validity; display
  protection under real budget pressure; preserved-state recallability;
  retired-ownership never starts another effect.

### Non-Goals

- Review Pass 2 (deletion): unused helpers (`removeMarkerLine`,
  `removePartialEffectsRisksForPath`), write-only `lastFocusEcho`, redundant
  `PendingCompaction` fields, `hasLocalCompactor`, `fingerprintKey` parameter,
  `entries-support.ts`/`paths.ts` surface trimming.
- Review Pass 3 (clarity): collector argument-object refactor, manifest→native
  registration rewrite, result-type consolidation, file reorganization.
- Review Pass 4 (performance/packaging): indexed pending-call pairing, direct
  receipt propagation, protected-render reuse, recall unchanged-write short
  circuit, docs/specs package exclusion.
- Review section 5 (enrichment): checkpoint-update tool schema exposure,
  strict-mode expansion, turn-boundary e2e release gate.
- Any change to trigger policy, admission bands, compiler-failure pause,
  continuation recovery, focus echo, or migration.

### Constraints

- No LLM; no new dependencies; fail closed; transactional lifecycle intact.
- Compaction details remain version 14; checkpoint remains schema v2; summary
  wire format, marker vocabulary, and section-ledger keys unchanged;
  versions 5-13 stay readable.
- Tool-output persistence and recall remain independently gated, default off;
  disabled paths return before content/storage.
- Historical recall entries (v5-14) remain readable; no persistence-format
  change.
- Preserve all ambient dirty work; build on the current working-tree bytes
  hashed above.
- Previews remain deterministic; existing preview strategy names and artifact
  record format unchanged.

### Acceptance Criteria

- AC1: For any tool output, every preview produced by `lib/output-compactor.ts`
  contains complete Unicode code points at each truncation boundary and has
  total length (including omission framing) within its declared `maxChars`
  budget, measured in code points.
- AC2: A preview generated by the extension, supplied back as a tool result,
  is accepted by the compiler's Unicode input validation (no
  `invalid_input`/malformed-Unicode rejection attributable to preview bytes).
- AC3: Under operating-budget pressure, rows protected by
  `verificationEvictionIndex`'s predicate (required, FAIL, INCOMPLETE) are
  never silently removed from the rendered verification section; the
  stale-pass shortcut never removes a required receipt; when no legal victim
  exists the existing protected-content-overflow accounting applies.
- AC4: `searchRecallEntries` returns a stored summary whose only matching text
  lives inside `<checkpoint-v1>` (e.g., a unique constraint-pin phrase), by
  keyword query and by name/prefix query `checkpoint`.
- AC5: A post-commit effect whose first invocation fails after its owner has
  retired is invoked exactly once; retries occur only while ownership holds and
  only for effects whose policy permits them; no duplicate log record or dump
  artifact results from a failure after possible persistence.

## Closed Decisions

These implementation decisions are closed for this contract.

- **Preview budget unit is Unicode code points**, consistent with the
  compiler's code-point contracts and `lib/unicode.ts`. All length checks and
  reported `previewChars`/`originalChars` accounting inside
  `lib/output-compactor.ts` use `codePointLength`. `shouldCompact` triggers on
  code-point counts (a truthful refinement of the current UTF-16-unit check).
- **Framing is reserved before body allocation**: both `compactText` passes
  compute the exact omission marker for the chosen budget first, then split
  the remaining budget across head/tail with code-point-safe boundaries
  (extend `lib/unicode.ts` with a suffix-capable helper or equivalent; no new
  dependency).
- **R02 shape**: `independentEffect` becomes an ownership-guarded boundary.
  Each call site supplies its existing ownership predicate
  (`ownsAttempt(ticket, ctx)` for log/dump, `isCurrent` for recall/
  notification); the predicate is re-evaluated before every invocation
  including retries. Retry policy is per effect: log append — no whole-effect
  retry (lock-contention retry, if kept, moves inside `appendLog`'s lock
  acquisition, strictly before any append); dump write — no retry (temp+rename;
  a post-rename failure must not create a second artifact); notification — no
  retry (duplicate UI messages are worse than one miss); recall
  reconciliation — retry permitted only while ownership holds (store-side
  `reconcileRecall` is identity-idempotent and `isCurrent`-fenced). Terminal
  effect failure still reports the best-effort diagnostic and
  `reportFailure`/`appendFailure` (itself never retried as an effect).
- **R03 shape**: `verificationEvictionIndex` gains an explicit no-legal-victim
  result; the budget ladder treats it as category exhaustion and proceeds to
  the next category; the stale-pass shortcut consults the same protection
  predicate. When only protected content remains, the existing
  "protected-content overflow; operating target exceeded" accounting applies.
- **R04 shape**: add `checkpoint-v1` to `MARKER_BLOCKS` in `lib/recall.ts`;
  extraction, attribution, and budgeting reuse the existing marker machinery.
  No projection, rendering, or persistence change.
- **No details.version bump and no wire-format change**: these fixes alter
  preview bytes (opt-in path), display selection under pressure, recall search
  coverage, and effect scheduling only. Details v14 fields, checkpoint schema
  v2, marker vocabulary, and section-ledger keys are untouched (also enforced
  by `forbidden` scope on `lib/compiler/checkpoint.ts`).
- **Line-number citations are to the hashed baseline bytes**; if reality
  differs at execution time, resolve by symbol name
  (`compactText`, `verificationEvictionIndex`, `independentEffect`,
  `searchRecallEntries`) before treating it as drift.

## Technical Contract

### Ownership

- Preview generation and its budget semantics: `lib/output-compactor.ts`
  (single owner), with shared code-point primitives owned by `lib/unicode.ts`.
- Post-commit effect scheduling and retry policy: `index.ts`
  (`independentEffect` and its four call sites). Persistence mechanics remain
  owned by `lib/store.ts`; only pre-publication contention retry may move
  into `appendLog`, keeping the store the single owner of its lock protocol.
- Verification display selection and protection predicate:
  `lib/compiler/verification-display.ts` owns the predicate
  (`required()` + status protection) and `verificationEvictionIndex`; the
  budget ladder in `lib/compiler/budget-formatter.ts` consumes its result
  without redefining protection.
- Recall search candidate surface: `lib/recall.ts` `MARKER_BLOCKS`/
  `SUMMARY_PARTS`. The checkpoint renderer (`lib/compiler/checkpoint.ts`)
  remains authoritative for the marker name and content; recall only indexes
  it.

### Interfaces and Reuse

No new public/module API beyond: a code-point suffix (or equivalent) helper in
`lib/unicode.ts` (application-private, extractable, mirrors `codePointPrefix`
semantics), an explicit no-victim result from `verificationEvictionIndex`
(module-internal semantics change), and `independentEffect`'s call-site
predicate parameter (module-internal). Reuse classification:
application-private but extractable. No cross-project imports introduced.

### State and Lifetime

- Previews are ephemeral derived values; the only durable state they enter is
  tool-result content in the host session (opt-in) and persisted artifacts
  (`OutputArtifactRecord`, format unchanged). No new state.
- `PendingCompaction`, monitor state, leases, and attempt tickets are
  untouched; R02 changes only when effects may (re-)run relative to those
  owners, never their lifecycles.
- Recall candidate parts are derived per query from stored summaries; no
  cache, index, or migration is added.

### Repeat Safety

- Effect invocation identity is (call site, pending compaction attempt).
  Intended final state per effect: exactly one log record, at most one dump
  artifact, one notification per committed compaction, and identity-
  idempotent recall reconciliation. Retries are permitted only pre-publication
  or when identity-idempotent (see Closed Decisions); an ownership loss never
  re-invokes. Concurrency unchanged: effects already run inside the commit
  path's serialized continuation; store locks remain the persistence fence.

### Runtime and Compatibility

- Public behavior deltas: previews become code-point-safe and truly bounded
  (observed bytes may differ at boundaries; this is the defect fix); recall
  gains `checkpoint-v1` as a searchable name/keyword part; verification
  display keeps protected rows under pressure. No CLI, exit-code, schema,
  stdout/stderr, or configuration surface changes. No dependency changes.
  Cancellation/failure containment behavior unchanged (best-effort
  diagnostics; never throw into host callbacks).

### Migration and Deletion

None. No public API is removed; no data format changes; no file moves.

## Target Shape

No structural moves; the fixes land in the existing owners:

```text
lib/unicode.ts                 + code-point suffix/boundary helper (if absent)
lib/output-compactor.ts        compactText both passes + boundedSelectedPreview
                               fallbacks + jsonPreview/inputSummary excerpts:
                               code-point-safe, framing-inclusive budgets
index.ts                       independentEffect: ownership predicate per call
                               site, per-effect retry policy, no post-
                               persistence re-invocation
lib/store.ts                   (conditional) pre-publication lock retry only
lib/compiler/verification-display.ts
                               verificationEvictionIndex: explicit no-victim
                               result; protection predicate shared with the
                               stale-pass shortcut
lib/compiler/budget-formatter.ts
                               eviction ladder: honor no-victim as category
                               exhaustion; stale-pass branch uses predicate
lib/recall.ts                  MARKER_BLOCKS += checkpoint-v1
```

Old behavior that disappears: surrogate-splitting/over-budget previews;
unconditional effect retry; protected-row eviction fallback; invisible
checkpoint state in recall. Everything else — details v14, checkpoint v2,
marker vocabulary, gates, transactional order — is stable.

## Scope and Authority

Frontmatter `scope` is the mutation ceiling. Conditional paths
(`lib/store.ts`, `lib/store.test.ts`, `lib/compiler/tool-tracker.ts`,
`lib/compiler/tool-tracker.test.ts`) may be touched only by the task that
names them explicitly (T2 for store; T3 may move the render/protection
predicate to `tool-tracker.ts` only if cohesion requires it).

Maintainer contract (applies to every task):

- **M1 Ownership:** each behavior keeps one predictable owner (see Ownership);
  trace `independentEffect` callers and `verificationEvictionIndex` consumers
  before changing their boundaries.
- **M2 Cohesion:** fixes stay inside the cited seams; no file splits or moves.
- **M3 Compatibility:** details v14, checkpoint v2, marker vocabulary,
  historical readability, and gate semantics are preserved; the four behavior
  deltas are the authorized objective.
- **M4 Evidence:** every success criterion closes through its named gate;
  unrun checks are never reported as passed.
- **M5 Preservation:** ambient dirty work stays intact; uncertain effect
  (e.g., an interrupted write) is reconciled before retry; no path outside
  `allowed`/`conditional` is touched.

```yaml
local_commit:
  permission: not_granted
  permitted_phases: []
  required_phases: []
  authority_basis: []
```

## Execution Plan

### T1 — Code-point-safe, budget-true tool-output previews

```yaml
id: T1
title: Make every generated preview well-formed Unicode within its declared budget
objective: >-
  All preview shortening paths in lib/output-compactor.ts produce complete-code-point
  text whose total length including omission framing fits the declared maxChars
  budget in code points, and remain valid compiler input.
depends_on: []
owners:
  - lib/output-compactor.ts (compactText both passes, boundedSelectedPreview fallbacks, jsonPreview describe, inputSummary)
  - lib/unicode.ts (codePointLength, codePointPrefix; shared primitive owner)
may_touch:
  - lib/output-compactor.ts
  - lib/output-compactor.test.ts
  - lib/unicode.ts
  - lib/unicode.test.ts
required_changes:
  - "Replace raw UTF-16 slices with code-point-boundary-safe extraction in
    compactText first pass (text.slice(0, headChars)/text.slice(-tailChars),
    baseline ~lines 137-141) and second pass (~lines 171-176); add a suffix
    helper in lib/unicode.ts mirroring codePointPrefix semantics."
  - "Reserve the exact omission-marker/framing cost from maxChars BEFORE
    allocating head/tail in both passes (current second pass yields e.g.
    12,041 chars for a 12,000 budget); include the marker's own bytes in the
    budget."
  - "Apply the same treatment to boundedSelectedPreview priority-line excerpt
    and single-oversized-line fallbacks (~lines 229-253) and jsonPreview/
    inputSummary string excerpts."
  - "Use codePointLength for all budget checks and reported character counts
    in lib/output-compactor.ts (shouldCompact, compactText,
    boundedSelectedPreview, CompactResult.previewChars)."
  - "Regressions in lib/output-compactor.test.ts: surrogate pair crossing
    each cut boundary (head cut, tail cut, second-pass re-cut) stays
    well-formed; preview fits budget including framing; a generated preview
    fed through the compiler's Unicode input validation is accepted
    (cross-layer: valid tool output -> preview -> compiler input)."
must_preserve:
  - "toolOutput.enabled gate semantics (default off; disabled path returns
    before content/storage)"
  - "Preview strategy names and PreviewResult shape; OutputArtifactRecord
    persistence format"
  - "Deterministic previews; sane behavior for tiny budgets (>= 1 code point)"
must_not:
  - "Alter lib/compiler normalization/validation semantics or any live hook"
  - "Change compaction details fields or wire summary structure"
success:
  - id: T1-S1
    acceptance: [AC1, AC2]
    criterion: >-
      Focused suites green including new surrogate-boundary, framing-inclusive
      budget, and preview-as-compiler-input regressions.
    gate_ids: [T1-S1]
stop_if:
  - "Baseline hashes in frontmatter no longer match live files (SOURCE_DRIFT)"
```

### T2 — Lifetime-safe, effect-specific post-commit retries

```yaml
id: T2
title: Never re-invoke a post-commit effect after ownership loss or possible persistence
objective: >-
  independentEffect re-checks captured ownership before every invocation and
  applies per-effect retry policy, so retired owners never start effects and
  persisted effects are never duplicated.
depends_on: []
owners:
  - index.ts independentEffect (~lines 208-229) and post-commit call sites (799, 824, 841; recall at 238)
  - lib/store.ts appendLog/withStoreLock (conditional: pre-publication contention retry)
may_touch:
  - index.ts
  - index.test.ts
required_changes:
  - "Accept an ownership predicate per call site (ownsAttempt(ticket, ctx) for
    log/dump, isCurrent for recall/notification); re-evaluate it before every
    invocation including retries; a false predicate skips the retry and emits
    only the best-effort diagnostic. Evidence: helper currently retries
    unconditionally between caller-side checks that run only after return."
  - "Per-effect retry policy (closed): log append — no whole-effect retry;
    contention retry only inside appendLog's lock acquisition strictly before
    any append (touch lib/store.ts + store.test.ts only for this);
    dump write — no retry; notification — no retry; recall reconciliation —
    retry only while ownership holds (store reconcileRecall is
    identity-idempotent and isCurrent-fenced)."
  - "Retain failure containment: terminal effect failure still runs the
    best-effort diagnostic and reportFailure/appendFailure (never retried as
    an effect); failures never throw into host callbacks."
  - "Regression in index.test.ts: deferred first-invocation failure after
    simulated retirement -> exactly one invocation; retry allowed only when
    ownership holds and policy permits; no duplicate log record or dump
    artifact after a post-persistence failure."
must_preserve:
  - "Transactional lifecycle: success artifacts only after matching owned
    session_compact commit; commit identity checks unchanged"
  - "Monitor/admission/trigger behavior; continuation reconciliation"
must_not:
  - "Introduce retry timers, circuits, or new commands"
  - "Change admission policy or compaction details"
success:
  - id: T2-S1
    acceptance: [AC5]
    criterion: >-
      index.test.ts green including no-retry-after-retirement and
      no-duplicate-persisted-effect regressions.
    gate_ids: [T2-S1]
stop_if:
  - "Baseline hashes in frontmatter no longer match live files (SOURCE_DRIFT)"
```

### T3 — Protected verification display is never silently evicted

```yaml
id: T3
title: Stop evicting protected verification rows under budget pressure
objective: >-
  The budget ladder never silently removes a protected verification row
  (required, FAIL, INCOMPLETE); overflow becomes explicit through the
  existing protected-overflow accounting.
depends_on: []
owners:
  - lib/compiler/verification-display.ts (verificationEvictionIndex, required() predicate)
  - lib/compiler/budget-formatter.ts (eviction ladder ~lines 709-726)
may_touch:
  - lib/compiler/verification-display.ts
  - lib/compiler/verification-display.test.ts
  - lib/compiler/budget-formatter.ts
  - lib/compiler/budget-formatter.test.ts
required_changes:
  - "verificationEvictionIndex returns an explicit no-legal-victim result when
    every candidate row is protected (current fallback lines.length-1 evicts
    a protected FAIL row); the budget ladder treats no-victim as category
    exhaustion and proceeds to the next category."
  - "The stale-pass shortcut (startsWith(\"PASS \") && includes(\"[freshness:
    not established\")) consults the same protection predicate so a stale PASS
    satisfying a required verification identity is never removed by the
    shortcut."
  - "When only protected content remains, the existing 'protected-content
    overflow; operating target exceeded' accounting applies unchanged."
  - "Regressions: all-protected rows (two+ FAILs / required rows) under real
    operating-budget pressure keep every protected row in the rendered
    verification section or report overflow explicitly — never silently
    dropped; required stale passes survive the shortcut; mixed rows still
    evict only unprotected ones."
must_preserve:
  - "Checkpoint retains full identity, chronology, and failures (display-only
    change)"
  - "prioritizeVerificationDisplay selection semantics (limit, categories,
    staleness-skip and omission notices)"
  - "Checkpoint schema/serialization, checkpointDigest, section ledger keys"
must_not:
  - "Redefine the protection predicate to weaken protection (e.g., dropping
    FAIL/INCOMPLETE from it)"
success:
  - id: T3-S1
    acceptance: [AC3]
    criterion: >-
      verification-display and budget-formatter suites green including
      all-protected, required-stale-pass, and mixed-row regressions under
      operating-budget pressure.
    gate_ids: [T3-S1]
stop_if:
  - "Baseline hashes in frontmatter no longer match live files (SOURCE_DRIFT)"
```

### T4 — Recall indexes the checkpoint section

```yaml
id: T4
title: Make checkpoint-preserved state searchable through recall
objective: >-
  searchRecallEntries finds summary state that lives only inside
  <checkpoint-v1> by keyword and by marker name, within existing budgets.
depends_on: []
owners:
  - lib/recall.ts (MARKER_BLOCKS, SUMMARY_PARTS, searchRecallEntries)
  - lib/compiler/checkpoint.ts:399-414 (read-only reference: marker name authority)
may_touch:
  - lib/recall.ts
  - lib/recall.test.ts
required_changes:
  - "Add checkpoint-v1 to MARKER_BLOCKS so the block participates in name and
    keyword candidate construction with existing provenance attribution and
    boundedResults budgeting (extraction reuses extractMarker; renderResult
    closing tag works for marker parts)."
  - "Regressions in lib/recall.test.ts: a stored summary whose only matching
    text is a unique constraint-pin phrase inside <checkpoint-v1> is returned
    by keyword search (currently zero results); name query checkpoint-v1 and
    prefix query checkpoint return the section; a large checkpoint block
    stays within the existing output budget."
must_preserve:
  - "recall.enabled gate semantics (default off; disabled path reads/persists
    nothing)"
  - "Historical entry readability v5-14; RECALL_SEPARATOR wire budget;
    project/all scoping"
must_not:
  - "Change summary rendering, projection shape, persistence, or migration"
success:
  - id: T4-S1
    acceptance: [AC4]
    criterion: >-
      recall suite green including checkpoint-only keyword, name/prefix query,
      and bounded-output regressions.
    gate_ids: [T4-S1]
stop_if:
  - "Baseline hashes in frontmatter no longer match live files (SOURCE_DRIFT)"
```

## Verification Contract

### Task Gates

- T1-S1: `check: {command: "bun test lib/output-compactor.test.ts lib/unicode.test.ts", working_directory: .}`; `pass: exit 0, all tests green, including new surrogate-boundary (head cut, tail cut, second-pass re-cut), framing-inclusive budget, and preview-through-compiler-input-validation regressions`; `covers: {tasks: [T1], success: [T1-S1], acceptance: [AC1, AC2]}`; `run_when: {kind: task_candidate, task: T1}`
- T2-S1: `check: {command: "bun test index.test.ts", working_directory: .}`; `pass: exit 0, all tests green, including no-retry-after-retirement and no-duplicate-persisted-effect regressions`; `covers: {tasks: [T2], success: [T2-S1], acceptance: [AC5]}`; `run_when: {kind: task_candidate, task: T2}`
- T3-S1: `check: {command: "bun test lib/compiler/verification-display.test.ts lib/compiler/budget-formatter.test.ts", working_directory: .}`; `pass: exit 0, all tests green, including all-protected rows, required stale pass surviving the shortcut, and mixed-row eviction regressions`; `covers: {tasks: [T3], success: [T3-S1], acceptance: [AC3]}`; `run_when: {kind: task_candidate, task: T3}`
- T4-S1: `check: {command: "bun test lib/recall.test.ts", working_directory: .}`; `pass: exit 0, all tests green, including checkpoint-only keyword match, checkpoint name/prefix query, and bounded-output regressions`; `covers: {tasks: [T4], success: [T4-S1], acceptance: [AC4]}`; `run_when: {kind: task_candidate, task: T4}`

### Integration Gates

- IG1: `check: {command: "bun test lib/output-compactor.test.ts lib/unicode.test.ts index.test.ts lib/store.test.ts lib/compiler/verification-display.test.ts lib/compiler/budget-formatter.test.ts lib/recall.test.ts lib/compiler/checkpoint.test.ts", working_directory: .}`; `pass: exit 0, all eight suites green together, proving the four fixes and conditional surfaces coexist without cross-suite regressions`; `covers: {tasks: [T1, T2, T3, T4], success: [T1-S1, T2-S1, T3-S1, T4-S1], acceptance: [AC1, AC2, AC3, AC4, AC5]}`; `run_when: {kind: boundary, after_completed_tasks: [T1, T2, T3, T4], before_starting_tasks: []}`

### Terminal Gates

- TG1: `check: {command: "bun test", working_directory: .}`; `pass: exit 0, full repository test suite green`; `covers: {tasks: [T1, T2, T3, T4], success: [T1-S1, T2-S1, T3-S1, T4-S1], acceptance: [AC1, AC2, AC3, AC4, AC5]}`; `run_when: {kind: contract_candidate}`
- TG2: `check: {command: "bun x tsc --noEmit", working_directory: .}`; `pass: exit 0, typecheck clean`; `covers: {tasks: [T1, T2, T3, T4], success: [T1-S1, T2-S1, T3-S1, T4-S1], acceptance: [AC1, AC2, AC3, AC4, AC5]}`; `run_when: {kind: contract_candidate}`
- TG3: `check: {command: "bun run distill:architecture", working_directory: .}`; `pass: exit 0, architecture check green`; `covers: {tasks: [T1, T2, T3, T4], success: [T1-S1, T2-S1, T3-S1, T4-S1], acceptance: [AC1, AC2, AC3, AC4, AC5]}`; `run_when: {kind: contract_candidate}`
- TG4: `check: {command: "git diff --check", working_directory: .}`; `pass: exit 0, no whitespace errors in the working diff`; `covers: {tasks: [T1, T2, T3, T4], success: [T1-S1, T2-S1, T3-S1, T4-S1], acceptance: [AC1, AC2, AC3, AC4, AC5]}`; `run_when: {kind: contract_candidate}`

## Execution Block Conditions

- `SOURCE_DRIFT` — any frontmatter-hashed path changed materially between
  compilation and execution (ambient work overlaps are reconciled, not
  auto-failed; only unexplainable drift blocks).
- `SPEC_CONTRADICTION` — e.g., budget framing cannot be honored simultaneously
  with a min-1-code-point guarantee under a pathological policy.
- `OUT_OF_SCOPE_DEPENDENCY` — a fix provably requires editing a `forbidden`
  path (e.g., `lib/compiler/checkpoint.ts` marker rename) or an unnamed
  conditional path.
- `AMBIENT_WORK_CONFLICT` — ambient dirty work overlaps a target file such
  that edits cannot be separated.
- `GATE_FAILED_UNRESOLVED` — a required gate still fails after bounded
  in-scope repair with materially new strategies exhausted.
- `FINALIZATION_UNRESOLVED` — not applicable while `local_commit` is
  `not_granted`; any commit request returns to the user for authority.

## Exit Criteria

- All task gates T1-S1..T4-S1, integration gate IG1, and terminal gates
  TG1-TG4 green in that order.
- AC1-AC5 each covered by at least one green gate; no acceptance criterion
  left without a falsifier.
- No path outside `scope.allowed`/named-conditional touched; product diff
  limited to the four fixes plus regressions.
- Details version, checkpoint schema, marker vocabulary, and wire format
  unchanged (TG1 includes the existing contract tests that enforce this).
- Workflow State records the receipts; implementation approval remains with
  the user (`/go`).

## Workflow State

```yaml
implementation_approval: pending
execution_protocol: 3
state_revision: 0
execution_status: not_started
current_task: null
tasks:
  T1: pending
  T2: pending
  T3: pending
  T4: pending
completed: []
blocked: []
verification_receipts: []
finalization: null
repair_attempts:
  task_max: 4
  run_max: 12
  consumed_per_task:
    T1: 0
    T2: 0
    T3: 0
    T4: 0
  consumed_run: 0
objective: null
```
