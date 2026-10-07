---
command: prd
version: 3
id: prd-type-catalog-scope-bindability
supersedes: none
mode: standalone
status: complete
created_at: 2026-10-06T19:48:09Z
source_baseline:
  revision: 6610c39626a36b2d6bc33f5e64f475042969dc06
  worktree: dirty
  wwgd_report: none
  relevant_dirty_paths:
    - docs/specs/type-catalog.md (untracked; sha256 f20cb80d1b5fbbd8d296d2a9a0235807874599daed1fd338bc65d314e274d373)
scope:
  allowed:
    - docs/specs/type-catalog.md
  conditional: []
  forbidden:
    - lib/**
    - tests/**
    - scripts/**
    - index.ts
    - index.*.test.ts
    - package.json
    - bun.lock
    - .work/**
    - AGENTS.md
    - docs/*.md
    - docs/specs/** (all records other than docs/specs/type-catalog.md)
handoff:
  objective_kind: standalone_prd
  workflow_path: null
  audit_run_id: null
terminal_verification: [TG1, TG2]
---

# prd-type-catalog-scope-bindability

## Purpose

Make the published, execution-complete `prd-type-catalog` record bindable by `/go` by repairing the rendering of its Workflow State `objective.scope`, without touching its immutable prefix.

## Compilation Basis

### User Intent

Current-session bare `/go` invocations could not bind `docs/specs/type-catalog.md`: both `go_continuation` bind attempts returned "Selected record is missing, malformed, outside this repository, or has incompatible identity". The session's unresolved objective is to finish that record's canonical publication.

### WWGD Findings

None; standalone current-session compilation.

### ADRs and Accepted Decisions

Root cause (confirmed against the installed validator source, `~/.pi/agent/prompts/extensions/wwgd-autocontinue/index.ts`): `prdState` reads Workflow State `objective.scope` through its `value()` helper, which returns `null` for a nested YAML mapping (empty inline text after `scope:`), so `inspectGoTarget("prd", ...)` returns null. The earlier "missing frontmatter envelope" diagnosis was wrong: the envelope exists and the immutable digest `40864741...` (utf8-crlf-lf-v1, over the prefix including the envelope) already matched at both failed binds. The canonical bindable rendering already exists in this repository at `.work/prds/failure-history-retirement-policy.md:475`: a one-line flow mapping. A faithful `prdState` replica confirms the flow-mapping shape passes all checks on this record and leaves the immutable prefix byte-identical.

### Source Baseline

HEAD `6610c39626a36b2d6bc33f5e64f475042969dc06`, worktree dirty; task-relevant dirty path is the untracked target `docs/specs/type-catalog.md` (sha256 `f20cb80d1b5fbbd8d296d2a9a0235807874599daed1fd338bc65d314e274d373`).

Publication correction (recorded honestly): the first publication of this contract used a compact non-canonical section set and task shape; it was corrected to the canonical `lib/prd/contract.md` schema before first `/go` execution and handoff consumption, with semantics unchanged. No execution state existed at correction time.

## Product Contract

### Problem

`prd-type-catalog` is execution-complete (rev 9, T1-T4 complete, TG1-TG4 passed) but renders `objective.scope` as a nested YAML mapping, which the installed `prdState` validator cannot read; `/go` therefore cannot bind or reconcile the record.

### Desired State

The record passes the installed validator's published-PRD projection (bindable), with its immutable prefix byte-identical to digest `40864741e26cfddca736006d678e5b372cbf013bf03f7e80e65659d81e4c2adb` and the state write receipted in its Workflow State.

### In Scope

Exactly one atomic repair of `docs/specs/type-catalog.md`'s mutable Workflow State: (a) nested `objective.scope` replaced by the equivalent one-line flow mapping carrying identical `kind`/`id`/`path`/`immutable_digest` values, (b) `state_revision: 9` to `10`, (c) one appended `state_repair` receipt.

### Non-Goals

- No change to the immutable prefix (frontmatter, contract body) or the digest `40864741...`; the repair lives entirely after the `## Workflow State` heading.
- No repair of other records sharing the nested-scope shape (`.work/prds/protected-checkpoint-section-ledger*.md` observed); adjacent observation only, separate future work.
- No production code, test, or build changes. `docs-contract.test.ts` scans only top-level `docs/*.md` (non-recursive readdir), so this artifact is outside its surface; a full-suite run is not an inferred acceptance gate.

### Constraints

- Write via temporary file and atomic rename; no editor drift.
- Preserve every other Workflow State field byte-identically (tasks, receipts, finalization, objective status/operation/retry_history/waiting).

### Acceptance Criteria

- AC1: the repaired `docs/specs/type-catalog.md` passes a faithful `prdState` replica with all checks true (`bindable`).
- AC2: the recomputed utf8-crlf-lf-v1 immutable-prefix digest still equals `40864741e26cfddca736006d678e5b372cbf013bf03f7e80e65659d81e4c2adb` and the working diff against the pre-edit bytes shows exactly the three intended hunks.
- AC3: the Workflow State shows `state_revision: 10` and the appended `state_repair` receipt with the recorded evidence.

## Closed Decisions

These implementation decisions are closed for this contract.

1. Nested-to-flow-mapping rewrite of `objective.scope` (canonical shape already used by `.work/prds/failure-history-retirement-policy.md:475`); no envelope or digest changes.
2. The faithful `prdState` replica (embedded verbatim in the Verification Contract) is the terminal verifier; the actual `go_continuation` hook is evidence-only because it rejected all calls this session.
3. No full-suite run: affected surface is one docs artifact outside `docs-contract.test.ts`'s top-level `docs/*.md` scan.
4. `local_commit: not_granted`; no commit is requested or permitted.

## Technical Contract

### Ownership

The target's mutable Workflow State is owned by `/go` execution; the validator (`wwgd-autocontinue` `prdState`) is a read-only reference consumer.

### Capability and Package Structure

Not applicable: single-artifact documentation-record repair; no code, packages, or dependencies.

### Interfaces and Reuse

The flow-mapping scope shape must remain readable by the installed `prdState` line-based helpers (`value`/`block`); no YAML-parsing dependency is introduced.

### State and Lifetime

`state_revision` monotonic bump; one receipted state write; no schema or migration change.

### Repeat Safety

The exact three-hunk equality check (TG1) makes the operation idempotent-verifiable; re-running the replace on the fixed file is a no-op mismatch and fails closed.

### Runtime and Compatibility

Historical v5-v14 session entries, receipts, and reader behavior are unaffected (prefix unchanged).

### Generalization

Not applicable: bounded single-record repair.

### Migration and Deletion

Not applicable: no records added or removed.

## Target Shape

Workflow State of `docs/specs/type-catalog.md` after the repair (objective block):

    objective:
      scope: {kind: standalone_prd, id: prd-type-catalog, path: docs/specs/type-catalog.md, immutable_digest: 40864741e26cfddca736006d678e5b372cbf013bf03f7e80e65659d81e4c2adb}
      status: complete
      ...remaining objective fields byte-identical...

Appended receipt (at the end of the `verification_receipts` list):

    - kind: state_repair
      check: objective.scope nested mapping to flow mapping; immutable prefix byte-identical; state_revision bump
      result: passed
      evidence: prefix digest 40864741e26cfddca736006d678e5b372cbf013bf03f7e80e65659d81e4c2adb recomputed and matched (utf8-crlf-lf-v1); prdState replica returns bindable; revision 9 to 10

## Scope and Authority

local_commit:
  permission: not_granted
  permitted_phases: []
  required_phases: []
  authority_basis: []

No maintainer contract applies: the task writes no source, test, or generated files; it repairs another PRD record's mutable Workflow State via atomic file rewrite.

## Execution Plan

### T1 — Repair objective.scope rendering for bindability

```yaml
id: T1
title: Repair objective.scope rendering for bindability
objective: the published prd-type-catalog record passes the installed validator's published-PRD projection with its immutable prefix byte-identical and the state write receipted
depends_on: []
owners: [docs/specs/type-catalog.md Workflow State; wwgd-autocontinue prdState validator as read-only reference consumer]
may_touch: [docs/specs/type-catalog.md]
required_changes:
  - replace the nested objective.scope block with the one-line flow mapping from Target Shape (identical kind/id/path/immutable_digest values)
  - set state_revision from 9 to 10
  - append the state_repair receipt from Target Shape at the end of verification_receipts
must_preserve:
  - immutable prefix bytes; utf8-crlf-lf-v1 digest 40864741e26cfddca736006d678e5b372cbf013bf03f7e80e65659d81e4c2adb
  - every other Workflow State field, receipt, and the closing fence structure
must_not:
  - touch any file other than docs/specs/type-catalog.md
  - alter the recorded immutable_digest value, envelope, or contract body
  - run or modify production code, tests, or build configuration
success:
  - id: T1-S1
    acceptance: [AC1, AC2, AC3]
    criterion: post-edit file equals the expected three-hunk transformation of the pre-edit bytes (pre-image sha256 f20cb80d...) and the prdState replica reports bindable with the prefix digest unchanged
    gate_ids: [T1-S1]
stop_if:
  - the pre-edit bytes of docs/specs/type-catalog.md no longer hash to f20cb80d1b5fbbd8d296d2a9a0235807874599daed1fd338bc65d314e274d373 (SOURCE_DRIFT)
  - the replica reports any validator condition other than the three scope checks failing after the edit (reassess before proceeding)
```

## Verification Contract

### Task Gates

- T1-S1: kind task; check: python3 equality+replica script over the post-edit file (assert pre-image digest, apply the three exact expected transformations to the pre-edit bytes, require byte equality with the written file, then run the prdState replica requiring bindable=True and prefix digest 40864741...); working_directory: .; pass: script prints T1S1 PASS; covers: tasks [T1], success [T1-S1], acceptance [AC1, AC2, AC3]; run_when: {kind: task_candidate, task: T1}

### Integration Gates

None; single-task contract.

### Terminal Gates

- TG1: kind terminal; check: python3 script that (a) recomputes the utf8-crlf-lf-v1 prefix digest and requires 40864741e26cfddca736006d678e5b372cbf013bf03f7e80e65659d81e4c2adb, (b) runs the faithful prdState replica requiring all checks true and terminal status, (c) requires state_revision: 10 and the state_repair receipt present in the Workflow State; working_directory: .; pass: script prints TG1 PASS; covers: acceptance [AC1, AC2, AC3]; run_when: {kind: contract_candidate}
- TG2: kind terminal; check: git diff --check; working_directory: .; pass: exit 0 with no output; covers: whitespace cleanliness of the change; run_when: {kind: contract_candidate}

The faithful prdState replica referenced by T1-S1 and TG1 is the script published in this contract's first publication (validated against the installed extension source at `~/.pi/agent/prompts/extensions/wwgd-autocontinue/index.ts`, functions `prdState`, `value`, `block`, `workflowStateBody`), requiring: command=prd, status=complete, mode valid, id, handoff.objective_kind=standalone_prd, objective present, scope containing kind/id/path strings, objective.status complete, execution_status complete.

## Execution Block Conditions

SOURCE_DRIFT — pre-edit target bytes differ from the recorded baseline sha256. SPEC_CONTRADICTION — the three transformations cannot produce a validator-passing file. MISSING_DECISION — none identified. OUT_OF_SCOPE_DEPENDENCY — repair requires touching files outside allowed scope. AMBIENT_WORK_CONFLICT — overlapping edits to the target appear mid-execution. EXTERNAL_AUTHORITY_REQUIRED — none identified. GATE_FAILED_UNRESOLVED — T1-S1/TG1/TG2 fail after bounded in-scope repair. FINALIZATION_UNRESOLVED — not applicable (local_commit not_granted).

## Exit Criteria

T1 complete with truthful T1-S1 receipt; TG1 and TG2 passed with receipts; Workflow State reflects execution complete and objective complete; no successor queued (no_successor).

## Workflow State

```yaml
implementation_approval: granted
execution_protocol: 3
state_revision: 5
execution_status: complete
current_task: null
tasks:
  T1: complete
completed:
- T1
blocked: []
verification_receipts:
- kind: contract_start
  check: identity + source baseline preflight
  result: passed
  evidence: immutable prefix digest c7dd42d424c1769e8f558824fc7ae7458c0c7b2e2825b92c2b9ac2784695b3c3 (utf8-crlf-lf-v1); HEAD 6610c39626a36b2d6bc33f5e64f475042969dc06 matches baseline; target docs/specs/type-catalog.md sha256 f20cb80d1b5fbbd8d296d2a9a0235807874599daed1fd338bc65d314e274d373 matches; 33 unrelated ambient dirty paths preserved; go_continuation bind accepted (prd docs/specs/type-catalog-scope-bindability.md)
- checkpoint_id: t1-start-1
  operation_id: T1#impl
  operation_kind: task
  phase: prepared
  contract_digest: c7dd42d424c1769e8f558824fc7ae7458c0c7b2e2825b92c2b9ac2784695b3c3
  task: T1
  intent: atomic temp+rename rewrite of docs/specs/type-catalog.md with (a) nested objective.scope to flow mapping, (b) state_revision 9 to 10, (c) appended state_repair receipt
  observed_baseline: docs/specs/type-catalog.md sha256 f20cb80d1b5fbbd8d296d2a9a0235807874599daed1fd338bc65d314e274d373
  next_action: dispatch mutation, then run gate T1-S1
- task: T1
  kind: task_gate
  gate: T1-S1
  check: python3 equality+replica script (expected three-hunk transformation byte-equality + prdState replica)
  result: passed
  evidence: T1S1 PASS; live file byte-equal to expected transformation of pre-image f20cb80d; replica bindable True; prefix digest 40864741e26cfddca736006d678e5b372cbf013bf03f7e80e65659d81e4c2adb; manifests identical before/after gate; post sha256 3d1c9a3a755183029cc91d27f0a0229dcb35b1a4e72e20c97b7a0912d5e3c9e4; semantic review: exactly the three authorized hunks, no other file touched
finalization: null
repair_attempts:
  task_max: 4
  run_max: 12
  consumed_per_task:
    T1: 0
  consumed_run: 0
objective:
  scope: {kind: standalone_prd, id: prd-type-catalog-scope-bindability, path: docs/specs/type-catalog-scope-bindability.md, immutable_digest: c7dd42d424c1769e8f558824fc7ae7458c0c7b2e2825b92c2b9ac2784695b3c3}
  status: complete
  operation: {kind: reconcile, contract: prd-type-catalog-scope-bindability, task: null, checkpoint: go-start-1}
  retry_history: []
  waiting: null
```
