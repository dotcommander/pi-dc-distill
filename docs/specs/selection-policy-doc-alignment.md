---
command: prd
version: 3
id: prd-selection-policy-doc-alignment
supersedes: none
mode: standalone
status: complete
created_at: 2026-10-07T17:46:23Z
source_baseline:
  revision: ad2e3a6ef6865b4f3ac246064712ccf64d7896ea
  worktree: dirty
  wwgd_report: none
  relevant_dirty_paths:
    - "AGENTS.md (pre-edit sha256 a9d39d979bd1d9cb6ca3cde2a76986d264642c6e1ffd77f0914a021f84420800; dirty from ambient session arc — format-paragraph hunk only, line-29 bounds sentence byte-identical to commit f0b3e97)"
    - "docs/algorithm.md (pre-edit sha256 5fff46dba5f8da72cc0535d8f651c50060eee194eae98c77b9586143e6404c47; 'Selection priority' section is session-arc authored, uncommitted)"
    - "code-surface aggregate sha256 f1abdba0b85f7fe6cb7e47b1367cf72e17fb07dd0cc6e74829623f8ebe0ffd09 over the exact 24-file list named in gate TG1 (production allowlist + all unit/test files + package.json)"
scope:
  allowed:
    - AGENTS.md
    - docs/algorithm.md
  conditional: []
  forbidden:
    - index.ts
    - "lib/**"
    - "tests/**"
    - package.json
    - README.md
    - "docs/README.md, docs/architecture.md, docs/usage.md, docs/settings.md, docs/troubleshooting.md, docs/releasing.md, docs/index.md"
    - ".work/**"
    - "docs/specs/** (this PRD and its sibling temp are the only permitted writes here, by the publication protocol itself, not by task authority)"
handoff:
  objective_kind: standalone_prd
  workflow_path: null
  audit_run_id: null
terminal_verification: [TG1, TG2]
---

# PRD: Align selection-policy prose with the implemented signal-priority selection

## Purpose

Three governing statements currently disagree about how excerpts are selected for the `dc-distill-summary` budget:

1. `AGENTS.md` line 29 (bounds sentence, committed in f0b3e97): "…then newest fitting excerpts rendered chronologically."
2. `docs/algorithm.md` line 87 (session-arc authored): "Substantive rows claim the remaining operating space first…"
3. The implemented, test-pinned algorithm (`lib/compiler/signal.ts` `excerptScore`, `lib/compiler/budget-formatter.ts:292-293`, `lib/compiler/signal.test.ts:20-23`): one score-ordered admission list — signal-priority, newest-first ties, chronological rendering — in which user/branch/native rows score exactly the substantive threshold (3) and can therefore rank below tool-error rows (4) and multi-signal assistant rows.

This PRD resolves the conflict by documentation alignment only: every governing surface states the exact implemented policy. No code, test, package, or observable summary output changes.

## Compilation Basis

### User Intent

The session's `/dig` arc closed all its eligible findings; the review's remaining item was routed explicitly as "the selection-policy doc conflict (needs /prd)". This bare `/prd` continues that escalation's desired outcome: one coherent resolution of the selection-policy contradiction across governing surfaces.

### WWGD Findings

None — standalone mode. Source is the session review routing plus the dig escalation record `.work/dig/claude-static-review.md` (operation `dig-claude-static-review-20261007`), whose P1-7 disposition ("scoring … user rows at threshold") was classified as a product decision with "labeled replay set = new infrastructure (PRD scope)" — i.e., rubric tuning is frozen as ported, and the doc contradiction is the actionable defect.

### ADRs and Accepted Decisions

- Repository contract `AGENTS.md` ("Source and current contract", "Bounds and lifecycle"): the format, bounds, and fact-selection order are frozen; the production allowlist is frozen.
- Commit `1425a17` "Adopt framed text summary format with signal-priority selection": the adopted selection policy is signal-priority. `lib/compiler/signal.ts` header records the rubric as "adapted from ctxgo's compact rubric … the framework is ported rather than the exact tuning" — tuning is deliberately not re-litigated.
- Dig disposition (accepted this session): rubric retuning or tiered admission changes would alter every over-limit summary's observable output and require labeled replay infrastructure; that is a separate objective, not accepted here.

### Source Baseline

- HEAD `ad2e3a6ef6865b4f3ac246064712ccf64d7896ea`, worktree dirty with the session arc (uncommitted under the session's recorded no-commit authority).
- Provenance (decisive): `git log -S 'newest fitting excerpts' -- AGENTS.md` → exactly `f0b3e97` ("Retire legacy runtime surface…"), which precedes `1425a17`; the signal-priority adoption commit updated code but not the AGENTS.md bounds sentence. The dirty-tree AGENTS.md diff touches only the format paragraph — the stale phrase is committed text, not a later deliberate policy statement.
- Load-bearing current-state evidence:
  - `lib/compiler/signal.ts` — `excerptScore`: kinds `user`/`native-summary`/`branch-summary` → `SUBSTANTIVE_THRESHOLD` (3); `tool-result`/`bash` → `errorSignal ? 4 : 0`; all other kinds (`assistant`, `tool-call`, `custom`) → full `signalScore` rubric. `containsDiff ? +5 : codeFence ? +4` (mutually exclusive); table points require ≥ 2 table lines; `errorSignal` is case-insensitive `panic|traceback|fatal|failed|failure|error:|exit status [1-9]|cannot |could not ` (trailing spaces significant); short-status and ack penalties apply only when no positive signal was earned (`score <= 0`).
  - `lib/compiler/budget-formatter.ts:292-293` — admission sorts one list by score descending, ties by larger index (newer) first; `document.records = excerpts.filter(...)` preserves chronological rendering.
  - `lib/compiler/budget-formatter.ts:235` — first eviction tier removes the oldest excerpt scoring below `SUBSTANTIVE_THRESHOLD`: the substantive floor is an eviction guard, not an admission priority.
  - `lib/compiler/signal.test.ts:20-23` — pins user rows at exactly the threshold and tool-result error rows at 4 (above user rows).
  - `docs-contract.test.ts` — scans `AGENTS.md` and all active docs for advertised slash commands; replacement prose must introduce none.
- Frozen drift identities: `AGENTS.md` sha256 `a9d39d979bd1d9cb6ca3cde2a76986d264642c6e1ffd77f0914a021f84420800`; `docs/algorithm.md` sha256 `5fff46dba5f8da72cc0535d8f651c50060eee194eae98c77b9586143e6404c47`; code-surface aggregate sha256 `f1abdba0b85f7fe6cb7e47b1367cf72e17fb07dd0cc6e74829623f8ebe0ffd09` (exact 24-file list in TG1). `/go` must recheck these before the first write.

## Product Contract

### Problem

A maintainer, reviewer, or future agent reading the governing surfaces cannot determine the authoritative excerpt-selection policy: AGENTS.md promises newest-fitting admission, algorithm.md promises substantive-rows-first admission, and the code implements neither exactly (single score-ordered list in which substantive rows are not a protected tier). The contradiction also invites future "fixes" in opposite directions (revert code to newest-first vs. raise user-row scores), both of which would silently change every over-limit summary's observable output.

### Desired State

Every governing surface states exactly the implemented policy: excerpt admission is signal-priority over one score-ordered list, ties prefer the newest row, rendering stays chronological, the substantive threshold guards eviction (not admission), user/branch/native rows score exactly the threshold, tool-result/bash rows score only on error evidence, and assistant/tool-call/custom rows use the full rubric. The rubric table states the code's exact mechanics (diff/fence exclusivity, ≥ 2 table lines, exact error-keyword matching). No code, test, package, or doc-example bytes change.

### In Scope

- The single bounds sentence in `AGENTS.md` line 29 (excerpt-admission clause only).
- The `## Selection priority` section of `docs/algorithm.md` (prose paragraph and rubric-table mechanics rows).

### Non-Goals

- Any rubric retuning (weights, regexes, thresholds) — frozen as ported per the accepted dig disposition.
- Tiered or protected admission for user/branch/native rows (raising their score above the rubric's reach) — an observable-output change requiring labeled replay infrastructure; explicitly not accepted.
- Reverting code to newest-fitting admission.
- Any code, test, package.json, README, usage, architecture, settings, troubleshooting, releasing, or index-doc change.
- Regenerating byte-exact examples (they are already correct because code does not change).

### Constraints

- The frozen `dc-distill-summary` format, bounds, and fact-selection order (AGENTS.md contract) are untouched.
- AGENTS.md's replacement sentence must remain a faithful compression of the detailed contract in `docs/algorithm.md` — the detailed policy lives in algorithm.md.
- `AGENTS.md` line 19's "newest fitting records" (the 20 MiB input-envelope bound, which IS newest-fitting in code) must remain byte-identical.
- Replacement prose must not introduce slash-command tokens (docs-contract.test.ts scans all active docs).
- The observable summary output of every input must be byte-identical before and after this PRD.

### Acceptance Criteria

- AC1: `AGENTS.md` bounds sentence describes signal-priority excerpt admission with newest-first ties and chronological rendering; the phrase "newest fitting excerpts" no longer occurs in AGENTS.md; the input-envelope phrase "newest fitting records" is retained.
- AC2: `docs/algorithm.md` "Selection priority" states the exact implemented admission semantics: one score-ordered admission list; user requests, branch summaries, and native summaries score exactly the substantive threshold (3) regardless of text; tool results and bash rows score only on error evidence; assistant, tool-call, and custom rows use the full rubric; ties prefer the newest row; rendering stays chronological; and the threshold's actual role (eviction guard — rows scoring below it are non-substantive and evicted first on overflow) is stated.
- AC3: the rubric table matches code mechanics exactly: diff content (+5) and code fence (+4) are mutually exclusive with diff precedence; table rows (+4) require at least two table lines; error keywords match case-insensitively with `exit status` + nonzero digit and space-following `cannot`/`could not`.
- AC4: the change is documentation-only: the frozen code-surface aggregate digest is unchanged, and the full approved gate suite passes.

## Closed Decisions

These implementation decisions are closed for this contract.

1. The authoritative selection policy is the implemented signal-priority admission (commit 1425a17's stated adoption; pinned by `lib/compiler/signal.test.ts`; documented in `docs/algorithm.md`). AGENTS.md's "newest fitting excerpts" is a stale pre-adoption compression (provenance: f0b3e97 precedes 1425a17 and the adoption commit did not update the bounds sentence), not a later deliberate policy statement.
2. Resolution is documentation alignment, not code change. The accepted dig disposition freezes the rubric as ported; no observable output may change.
3. The algorithm.md sentence "Substantive rows claim the remaining operating space first" is corrected to the exact implemented semantics rather than raising user-row scores, because the latter changes observable admission order (contradicting decision 2) and the substantive floor's real, implemented role is the first eviction tier.
4. `tool-call` and `custom` kinds are named explicitly as full-rubric rows in algorithm.md (code routes every kind outside {user, native-summary, branch-summary, tool-result, bash} through the assistant rubric).

## Technical Contract

### Ownership

- Governing contract prose: `AGENTS.md` (repository contract; one sentence).
- Detailed algorithm policy: `docs/algorithm.md` "Selection priority" section.
- Selection behavior itself: unchanged owners `lib/compiler/signal.ts` (scoring) and `lib/compiler/budget-formatter.ts` (admission walk, eviction tiers). This PRD performs no behavior mutation.

### Runtime and Compatibility

- Consumers of the edited surfaces: maintainers/reviewers (prose), `docs-contract.test.ts` (scans active docs for advertised slash commands — none may be introduced), and future contract readers. No build output, package export, or runtime behavior consumes these prose bytes.
- All other Technical Contract subsections are not applicable: documentation-only change with no state, lifetime, repeat-safety, generalization, or migration surface. No old path disappears; no interface changes.

## Target Shape

`AGENTS.md` line 29 — replace the final sentence

```text
Give optional facts up to 2,048 serialized code points in repeated newest-modification, newest-command, newest-read order, then newest fitting excerpts rendered chronologically.
```

with

```text
Give optional facts up to 2,048 serialized code points in repeated newest-modification, newest-command, newest-read order. Admit excerpts by signal priority — deterministic content scores with newest-first ties — while rendering stays chronological.
```

`docs/algorithm.md` — replace the section body between the `## Selection priority` heading and the `## Serialized budgets` heading with

````markdown
Excerpt selection is signal-priority, not newest-first. Every excerpt competes in one score-ordered admission list, scored by visible, deterministic constants:

| Signal | Score |
| --- | --- |
| Textual diff content | +5 |
| Code fence (when no diff content) | +4 |
| Table rows (at least two table lines) | +4 |
| Error keywords, matched case-insensitively (panic, traceback, fatal, failed, failure, `error:`, `exit status` with a nonzero digit, `cannot` or `could not` followed by a space) | +4 |
| Architecture or decision language | +3 |
| Heading | +2 |
| Long form (≥ 5 non-empty lines or ≥ 800 characters) | +2 |
| Path-like text | +1 |
| Filler opener | −2 |
| Short status (only when no positive signal was earned) | −2 |
| Acknowledgement (only when no positive signal was earned) | −5 |

Diff content and code fences are mutually exclusive: a row containing a diff scores +5 and never also scores the fence. User requests, branch summaries, and native summaries score exactly the substantive threshold (3) regardless of text; tool results and bash rows score only on error evidence; assistant, tool-call, and custom rows use the full rubric. Admission walks the single list from the highest score down, preferring the newest row on ties, so a tool error or a multi-signal assistant row can rank above a user row. Rendering stays chronological. The substantive threshold guards eviction, not admission: rows scoring below it are non-substantive, and overflow evicts the oldest non-substantive excerpt first.
````

Everything after `## Serialized budgets` (including the eviction-tier paragraph, which the new section text now references precisely) is unchanged. `README.md`, `docs/usage.md`, and all example blocks make no selection-policy claims and remain untouched.

## Scope and Authority

Path scope is the frontmatter `scope`. Semantic mutation authority is limited to the two exact sentence/section replacements in Target Shape; `may_touch` is a ceiling, not an invitation to rewrite either document.

```yaml
local_commit:
  permission: not_granted
  permitted_phases: []
  required_phases: []
  authority_basis:
    - "Session-recorded no-commit authority: the working tree carries the whole session arc uncommitted across five full verifier runs; this PRD adds doc hunks to the same uncommitted surface."
```

Maintainer contract (`lib/engineering/maintainer.md`): not applicable — this is a documentation-only contract; no code is written or repaired. If execution unexpectedly discovers a code need, that is `OUT_OF_SCOPE_DEPENDENCY`, not a license to proceed.

## Execution Plan

### T1 — Replace the stale AGENTS.md bounds sentence

```yaml
id: T1
title: Replace the stale AGENTS.md bounds sentence
objective: AGENTS.md's bounds sentence states signal-priority excerpt admission with newest-first ties and chronological rendering
depends_on: []
owners:
  - "AGENTS.md (repository contract) — the only file this task touches"
  - "Policy source of truth: docs/algorithm.md 'Selection priority' (post-T2 text) and lib/compiler/signal.ts excerptScore"
may_touch:
  - AGENTS.md
required_changes:
  - "In AGENTS.md line 29, replace the exact sentence 'Give optional facts up to 2,048 serialized code points in repeated newest-modification, newest-command, newest-read order, then newest fitting excerpts rendered chronologically.' with the exact replacement sentence from Target Shape ('…Admit excerpts by signal priority — deterministic content scores with newest-first ties — while rendering stays chronological.')."
  - "Preflight: confirm AGENTS.md sha256 is still a9d39d979bd1d9cb6ca3cde2a76986d264642c6e1ffd77f0914a021f84420800; if not, stop (SOURCE_DRIFT) and re-read the current line 29 before any edit."
must_preserve:
  - "AGENTS.md line 19's 'newest fitting records' input-envelope phrase stays byte-identical (that bound IS newest-fitting in code)."
  - "All other AGENTS.md bytes, including the ambient session-arc format-paragraph hunk, stay unchanged."
  - "No slash-command tokens appear in the new sentence (docs-contract.test.ts scans AGENTS.md)."
must_not:
  - Rewrite any other AGENTS.md line or paragraph.
  - Touch any code, test, package, or other doc file.
success:
  - id: T1-S1
    acceptance: [AC1]
    criterion: "grep: 'newest fitting excerpts' absent from AGENTS.md; 'Admit excerpts by signal priority' present; 'newest fitting records' still present"
    gate_ids: [T1-S1]
stop_if:
  - "AGENTS.md preflight digest mismatch (concurrent worker edited the contract file) → SOURCE_DRIFT."
```

### T2 — Rewrite the algorithm.md Selection priority section to exact implemented semantics

```yaml
id: T2
title: Rewrite the algorithm.md Selection priority section to exact implemented semantics
objective: docs/algorithm.md 'Selection priority' states the exact implemented admission semantics and rubric mechanics with no overstated claims
depends_on: []
owners:
  - "docs/algorithm.md 'Selection priority' section — the only location this task touches"
  - "Semantic source of truth: lib/compiler/signal.ts (excerptScore, signalScore, errorSignal) and lib/compiler/budget-formatter.ts:235,292-293 (eviction tier, admission walk, chronological rendering)"
may_touch:
  - docs/algorithm.md
required_changes:
  - "Replace the section body between '## Selection priority' and '## Serialized budgets' with the exact Target Shape text: keep the signal-priority opening sentence; retitle table rows for diff/fence exclusivity ('Code fence (when no diff content)'), table-row minimum ('at least two table lines'), and exact error-keyword mechanics; replace the closing paragraph with the implemented admission walk (single score-ordered list, newest-first ties, user/branch/native at exactly the substantive threshold, tool/bash error-evidence-only, assistant/tool-call/custom full rubric, chronological rendering, threshold-as-eviction-guard)."
  - "Preflight: confirm docs/algorithm.md sha256 is still 5fff46dba5f8da72cc0535d8f651c50060eee194eae98c77b9586143e6404c47; if not, stop (SOURCE_DRIFT) and re-read the current section before any edit."
must_preserve:
  - "The '## Selection priority' and '## Serialized budgets' headings and everything from '## Serialized budgets' onward stay byte-identical (the eviction paragraph's 'oldest non-substantive excerpt' now has its definition in the new section text)."
  - "Rubric constant values stay exactly as implemented (they already match code; this task changes wording only)."
  - "All example blocks in docs/algorithm.md and every other doc stay byte-identical."
must_not:
  - Change any selection code, test, or pinned constant.
  - Add policy claims not implemented in code (e.g. substantive-rows-first admission, newest-fitting admission).
  - Introduce slash-command tokens.
success:
  - id: T2-S1
    acceptance: [AC2, AC3]
    criterion: "grep: 'Substantive rows claim the remaining operating space first' absent; 'score-ordered admission list', 'exactly the substantive threshold', 'Code fence (when no diff content)', 'at least two table lines', 'tool-call, and custom rows', and 'threshold guards eviction' present in docs/algorithm.md"
    gate_ids: [T2-S1]
stop_if:
  - "docs/algorithm.md preflight digest mismatch → SOURCE_DRIFT."
```

T1 and T2 are independent (different files, no semantic ordering); any execution order is valid. Each completed task alone leaves the repository green and coherent: docs are not build inputs, and each surface individually becomes correct.

## Verification Contract

### Task Gates

- T1-S1: `! grep -q "newest fitting excerpts" AGENTS.md && grep -q "Admit excerpts by signal priority" AGENTS.md && grep -q "newest fitting records" AGENTS.md` — kind: task, working_directory: ., pass: exit 0. covers {tasks: [T1], success: [T1-S1], acceptance: [AC1]}. run_when: {kind: task_candidate, task: T1}.
- T2-S1: `! grep -q "Substantive rows claim the remaining operating space first" docs/algorithm.md && grep -q "score-ordered admission list" docs/algorithm.md && grep -q "exactly the substantive threshold" docs/algorithm.md && grep -q "Code fence (when no diff content)" docs/algorithm.md && grep -q "at least two table lines" docs/algorithm.md && grep -q "tool-call, and custom rows" docs/algorithm.md && grep -q "threshold guards eviction" docs/algorithm.md` — kind: task, working_directory: ., pass: exit 0. covers {tasks: [T2], success: [T2-S1], acceptance: [AC2, AC3]}. run_when: {kind: task_candidate, task: T2}.

### Integration Gates

- IG1: `grep -q "signal-priority, not newest-first" docs/algorithm.md && grep -q "Admit excerpts by signal priority" AGENTS.md && ! grep -q "newest fitting excerpts" AGENTS.md && ! grep -q "Substantive rows claim" docs/algorithm.md` — kind: integration, working_directory: ., pass: exit 0 (both surfaces state the same policy; neither contradiction remains). covers {tasks: [T1, T2], success: [T1-S1, T2-S1], acceptance: [AC1, AC2]}. run_when: {kind: boundary, after_completed_tasks: [T1, T2], before_starting_tasks: []}.

### Terminal Gates

- TG1: `sha256sum index.ts lib/compaction-source.ts lib/local-compact.ts lib/sdk.ts lib/unicode.ts lib/sha256.ts lib/compiler/types.ts lib/compiler/normalizer.ts lib/compiler/tool-tracker.ts lib/compiler/budget-formatter.ts lib/compiler/helpers.ts lib/compiler/signal.ts lib/compiler/errors.ts index.test.ts docs-contract.test.ts lib/compaction-source.test.ts lib/local-compact.test.ts lib/sha256.test.ts lib/unicode.test.ts lib/compiler/budget-formatter.test.ts lib/compiler/helpers.test.ts lib/compiler/normalizer.test.ts lib/compiler/signal.test.ts lib/compiler/tool-tracker.test.ts package.json | sha256sum | grep -qx "f1abdba0b85f7fe6cb7e47b1367cf72e17fb07dd0cc6e74829623f8ebe0ffd09  -"` — kind: terminal, working_directory: ., pass: exit 0 (documentation-only proof: the frozen code/test/package surface is byte-identical to the compilation baseline). covers {tasks: [T1, T2], success: [T1-S1, T2-S1], acceptance: [AC4]}. run_when: {kind: contract_candidate}.
- TG2: `bun test && bun x tsc --noEmit && bun run distill:architecture && git diff --check && npm pack --dry-run --json && bun run distill:e2e` — kind: terminal, working_directory: ., pass: final exit 0 (the repository's approved full gate ladder, run once after all edits). covers {tasks: [T1, T2], success: [T1-S1, T2-S1], acceptance: [AC4]}. run_when: {kind: contract_candidate}.

## Execution Block Conditions

- SOURCE_DRIFT — a task preflight digest mismatch on AGENTS.md or docs/algorithm.md, or a TG1 aggregate mismatch caused by code-surface changes not owned by this PRD (e.g. the concurrent in-project worker resurfacing).
- SPEC_CONTRADICTION — the Target Shape replacement text is found to contradict another frozen contract clause (none known at compilation).
- MISSING_DECISION — not expected: all decisions are closed above; any newly discovered consequential selection-policy choice (e.g. a demand to retune the rubric) is out of contract and returns to the contract owner.
- OUT_OF_SCOPE_DEPENDENCY — correctness appears to require editing any file outside the two allowed paths.
- AMBIENT_WORK_CONFLICT — overlapping edits to AGENTS.md or docs/algorithm.md by the concurrent worker cannot be safely preserved.
- EXTERNAL_AUTHORITY_REQUIRED — not expected for a docs-only change.
- GATE_FAILED_UNRESOLVED — a required gate still fails with no in-scope repair.
- FINALIZATION_UNRESOLVED — not applicable (local_commit not_granted; no commit intent recorded).

## Exit Criteria

- AC1–AC3 verified by T1-S1, T2-S1, and IG1.
- AC4 verified by TG1 (frozen code-surface digest) and TG2 (full gate ladder green).
- Workflow State shows both tasks complete, terminal gates recorded, no blocked entries.

## Workflow State

```yaml
implementation_approval: granted
execution_protocol: 3
state_revision: 4
execution_status: complete
current_task: null
tasks:
  T1: complete
  T2: complete
completed: [T1, T2]
blocked: []
verification_receipts:
  - task: null
    kind: contract_start
    check: "immutable prefix digest, utf8-crlf-lf-v1, docs/specs/selection-policy-doc-alignment.md"
    result: passed
    evidence: "6d23836e3c157e56ea5781f4fa9b66e17e9a93c2d47a4a3ed858a14b6f7f679a recomputed at start; source preflight exact: HEAD ad2e3a6ef6865b4f3ac246064712ccf64d7896ea, AGENTS.md a9d39d979bd1d9cb6ca3cde2a76986d264642c6e1ffd77f0914a021f84420800, docs/algorithm.md 5fff46dba5f8da72cc0535d8f651c50060eee194eae98c77b9586143e6404c47, code-surface aggregate f1abdba0b85f7fe6cb7e47b1367cf72e17fb07dd0cc6e74829623f8ebe0ffd09"
  - task: T1
    kind: gate
    check: "! grep -q \"newest fitting excerpts\" AGENTS.md && grep -q \"Admit excerpts by signal priority\" AGENTS.md && grep -q \"newest fitting records\" AGENTS.md"
    result: passed
    evidence: "T1-S1 exit 0; semantic diff review: one task-owned hunk (line 29 sentence swap), ambient hunks byte-preserved, no slash-command tokens"
  - task: T2
    kind: gate
    check: "! grep -q \"Substantive rows claim the remaining operating space first\" docs/algorithm.md && grep -q \"score-ordered admission list\" docs/algorithm.md && grep -q \"exactly the substantive threshold\" docs/algorithm.md && grep -q \"Code fence (when no diff content)\" docs/algorithm.md && grep -q \"at least two table lines\" docs/algorithm.md && grep -q \"tool-call, and custom rows\" docs/algorithm.md && grep -q \"threshold guards eviction\" docs/algorithm.md"
    result: passed
    evidence: "T2-S1 exit 0; docs/algorithm.md post-edit sha256 7de1ecf824f54ab68ba5219091ab65ac42ea591b1655f38470d7793beec161eb; single exact-block replace confined to section body; headings, Serialized-budgets tail, eviction paragraph byte-preserved vs pre-edit"
  - task: null
    kind: integration_gate
    check: "grep -q \"signal-priority, not newest-first\" docs/algorithm.md && grep -q \"Admit excerpts by signal priority\" AGENTS.md && ! grep -q \"newest fitting excerpts\" AGENTS.md && ! grep -q \"Substantive rows claim\" docs/algorithm.md"
    result: passed
    evidence: "IG1 exit 0 after T1+T2: both surfaces state one policy, neither contradiction remains"
  - task: null
    kind: terminal_gate
    check: "sha256sum <24-file code-surface list> | sha256sum | grep -qx f1abdba0…"
    result: passed
    evidence: "TG1 exit 0 — code/test/package surface byte-identical to compilation baseline; before/after manifests stable 39c514766dcb943f33542f64242541fe480aedbce0442bbcd5012dec12340e49"
  - task: null
    kind: terminal_gate
    check: "bun test && bun x tsc --noEmit && bun run distill:architecture && git diff --check && npm pack --dry-run --json && bun run distill:e2e"
    result: passed
    evidence: "TG2 final exit 0 — 100/100 unit (incl. docs-contract.test.ts over edited docs), tsc clean, architecture 16 modules/31 deps, diff-check clean, pack pi-dc-distill@0.1.8, e2e 9/9; before/after manifests stable 39c514766dcb943f33542f64242541fe480aedbce0442bbcd5012dec12340e49"
  - task: null
    kind: final_review
    check: "contract-owned diff review + Exit Criteria retrace + closure fence"
    result: passed
    evidence: "desired state exists on both surfaces; policy owners unchanged (compression AGENTS.md / detail algorithm.md / behavior signal.ts+budget-formatter.ts); old conflicting claims absent; no speculative additions; all AC1-AC4 have passing gate evidence; git status = ambient arc baseline + docs/specs/ only; final manifest equals fenced identity 39c514766dcb943f33542f64242541fe480aedbce0442bbcd5012dec12340e49; no commit (local_commit not_granted)"
finalization: null
repair_attempts:
  task_max: 4
  run_max: 12
  consumed_per_task:
    T1: 0
    T2: 0
  consumed_run: 0
objective:
  scope:
    kind: standalone_prd
    id: prd-selection-policy-doc-alignment
    path: docs/specs/selection-policy-doc-alignment.md
    immutable_digest: "6d23836e3c157e56ea5781f4fa9b66e17e9a93c2d47a4a3ed858a14b6f7f679a"
  status: complete
  operation:
    kind: reconcile
    contract: prd-selection-policy-doc-alignment
    task: null
    checkpoint: go-prd-selection-policy-doc-alignment-terminal
  retry_history: []
  waiting: null
```
