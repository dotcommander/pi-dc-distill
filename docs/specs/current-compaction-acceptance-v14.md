---
command: prd
version: 3
id: prd-current-compaction-acceptance-v14
supersedes: prd-current-compaction-acceptance
mode: chained
status: complete
created_at: 2026-10-05T23:40:00Z
source_baseline:
  revision: 2a078feb56b3007a776ccf37d8ce714053357b91
  worktree: dirty
  wwgd_report: 6ccc76815f38326d1f8e51ad3af518a19ee19073931823f2b861d938905e865c
  relevant_dirty_paths: [index.ts, lib/compiler/checkpoint.ts, AGENTS.md]
  identity_record: .work/workflow.yaml audit_execution.baseline.preservation_files
source_findings:
  - source_digest: 6ccc76815f38326d1f8e51ad3af518a19ee19073931823f2b861d938905e865c
    id: W001
scope:
  allowed: [tests/e2e/lifecycle.e2e.ts, tests/e2e/busy-compaction.e2e.ts, tests/e2e/demo.ts, tests/e2e/README.md, tests/e2e/harness/current-compaction.ts, tests/e2e/current-compaction.test.ts]
  conditional: []
  forbidden: [index.ts, lib/**, AGENTS.md, package.json, bun.lock]
handoff:
  objective_kind: workset
  workflow_path: .work/workflow.yaml
  audit_run_id: wwgd-20261005-583608e9
terminal_verification: [TG1, TG2, TG3, TG4, TG5]
---
# Current compaction acceptance — native source contract

## Purpose
Make the existing isolated real-Pi acceptance and demo verify the implemented details-v14/schema-v2 contract without changing production.

## Compilation Basis
### User Intent
Full autonomous /wwgd continues its published finite workset through internal /prd and /go. Parent executes under the user's exhausted-native-capacity override; no provider retry or substitution.
### WWGD Findings
Confirmed 6ccc76815f38326d1f8e51ad3af518a19ee19073931823f2b861d938905e865c:W001: lifecycle.e2e.ts:110-112 and demo.ts:81-85 demand v13/v1; busy-compaction.e2e.ts:90 demands v13. index.ts:63,473-485 emits v14/checkpoint-v2 and checkpointSections. The opt-in commands reject a legitimate current commit. Outcome: explicit current versions, exact wire/checkpoint digests and 17-section derived-ledger validation; retain lifecycle and isolation assertions. There is exactly one selected finding, no effective sibling contract or dependency; compatibility is vacuous beyond these preserved outcomes.
### ADRs and Accepted Decisions
ADR 0002's owned host/support surface remains unchanged. No architecture or schema decision is introduced. G001-G003 registry/framework/parser generalizations remain rejected; D001-D004 are not removal authority.
### Source Baseline
The predecessor acceptance-owned implementation is adopted, not replayed. Its TG1 passes 10 scenarios and T1-S1 passes 17 fixtures. TG2 revealed an independently verified contradiction: demo demanded counted repetition and absence of adjacent native-user repetitions, but normalizeUser (normalizer.ts:90-96) preserves original native source bytes for pin identity. Those two obsolete presentation predicates are superseded, not the v14/v2 identity, native request clause, no-summary/no-continuation/single-commit/cooldown assertions. This preserves the exact W001 desired outcome. Only demo.ts and explanatory README remain to change; all other owned edits remain as implemented. Actual task-owned file identities are fenced in carried receipts.
Starting HEAD, index, dirty paths and exact tracked/untracked bytes are captured in the selected workflow's existing baseline. Acceptance files are clean; new helper/test paths do not exist. Reconcile any unexplained overlapping movement before mutation. Baseline preservation is task containment, not permission to overwrite ambient edits.

## Product Contract
### Problem
Historical acceptance assertions contradict the current production writer; unit discovery excludes opt-in lifecycle/demo commands.
### Desired State
Manual, autonomous, busy and journal-restart paths accept only v14/schema-v2 current commits and validate exact digests/derived telemetry. Demo reports the same contract truthfully.
### In Scope
Acceptance-only shared assertion, regression fixtures, three consumers and e2e README.
### Non-Goals
Production behavior, historical readers, user instruction edits, new dependencies, paid providers, global cache changes, exactly-once crash-interval claims, visual UI, full unit-suite certification.
### Constraints
Keep explicit expected versions (do not import writer's details version). Validate checkpoint structurally using the existing canonical checkpoint functions; compare checkpointSections exactly with the derived ledger and require 17 keys. Exact wire bytes determine summaryDigest. Reject missing/corrupt versions, checkpoint identity, summary identity and ledger. Existing manual no-continuation, no provider summarization, single append, cancelled preparation, cooldown and restart supersession assertions remain. Demo native-user conversation must retain the exact DEMO-ANCHOR clause and raw repeated-source excerpt rather than demand counted compression or deny native-source repetitions; count transformation is not the current native-user contract. Capture artifacts with isolated parent PI_CODING_AGENT_DIR as well as harness child HOME/agent/session/project. No installs, network/provider calls, commits or external effects.
### Acceptance Criteria
- AC1: All current-compaction consumer paths demand v14/schema-v2 and exact authenticated checkpoint/wire/17-section telemetry.
- AC2: Focused regression fixtures reject historical/malformed versions, wrong digests and missing/corrupt/extra ledger entries, and accept a valid current record.
- AC3: Existing real-Pi manual/autonomous/busy/restart/interception scenarios and demo pass with the project-local reviewed 0.99.2 host and isolated parent cache; production and ambient files remain untouched.

## Closed Decisions
These implementation decisions are closed for this contract.
One repository-local acceptance assertion shared by RPC tests and demo avoids drift across consumers. Node assertions allow test and runnable-demo use. A focused Bun test supplies negative fixtures. Keep the production 120-second autonomous cooldown; do not bypass it. Demonstrate only the selected host, not every installed runtime. Documentation states exact current contract and remaining evidence limits.

## Technical Contract
### Ownership
Production owns compilation and serialization; tests/e2e owns independent explicit expected versions and assertion wiring. Existing harness owns sandbox lifecycle/cache finalization; no new runtime owner.
### Interfaces and Reuse
Repository-local assertCurrentCompaction(summary: unknown, details: unknown): void throws on invalid current shape, canonical digest or ledger mismatch; no persistence or effects. Consumers pass actual returned/committed records. Regression fixtures use canonical empty checkpoint for valid input, then independently corrupt one identity at a time.
### State and Lifetime
No new durable production state. Scratch-only test ledgers are preserved by existing harness finalization. Saved v14 journal fixture is validated before autonomous seeding; only the autonomous flag is changed to model restart intent.
### Repeat Safety
All checks are local and isolated. No user journal/cache is modified. Missing gate outcomes require reconciliation, not blind replay.
### Runtime and Compatibility
Bun committed runtime, project-local Pi 0.99.2 SDK/CLI. No default compactor, schema, version semantics or historical compatibility changes.
### Migration and Deletion
No source migration/deletion. Replace historical test expectations; retain TASK-13 as an unrelated focus anchor.

## Target Shape
Existing lifecycle/busy/demo -> acceptance-owned assertion -> canonical checkpoint validator/digest/section ledger + independent exact version/wire hash checks. New focused negative fixtures exercise this boundary; production remains byte-preserved.

## Scope and Authority
Predecessor reason: SPEC_CONTRADICTION: inherited counted-background-repetition/no-adjacent-noise demo predicates contradict W001 legitimate current v14 acceptance and native user source preservation (normalizer.ts:90-96); TG2 reproduction /tmp/current-compaction-TG2.log. TG1 10/0 passed. Successor replaces only obsolete demo projection predicates with exact native request clause and raw-source excerpt checks; no production/schema/lifecycle change.
local_commit:
```yaml
permission: not_granted
permitted_phases: []
required_phases: []
authority_basis: []
```
M1: trace actual host result and committed journal, preserve each state owner's role. M2: one small cohesive acceptance assertion, no framework. M3: preserve production, historical reader and existing lifecycle semantics. M4: exact scoped gates and failures, never infer unrun host/full-suite acceptance. M5: preserve ambient/index bytes and reconcile uncertain effects. Complete maintainer module is loaded at writing entry. Full suite is not part of this bounded acceptance change and remains unrun; no approval is inferred for it.

## Execution Plan
### T1 — Align and authenticate the acceptance boundary
```yaml
id: T1
title: Align and authenticate acceptance
objective: All acceptance consumers validate current authenticated v14/schema-v2 compaction and retain lifecycle invariants.
depends_on: []
owners: [tests/e2e/lifecycle.e2e.ts, tests/e2e/busy-compaction.e2e.ts, tests/e2e/demo.ts, lib/compiler/checkpoint.ts]
may_touch: [tests/e2e/lifecycle.e2e.ts, tests/e2e/busy-compaction.e2e.ts, tests/e2e/demo.ts, tests/e2e/README.md, tests/e2e/harness/current-compaction.ts, tests/e2e/current-compaction.test.ts]
required_changes:
  - Add one acceptance assertion for explicit v14/v2, structural checkpoint validation, canonical checkpointDigest, exact summaryDigest and exact derived 17-section ledger.
  - Wire manual and autonomous results and committed ledger records, busy result/commit and demo; validate restart source before sandbox intent seeding.
  - Adopt existing valid/adversarial fixtures and verified host wiring; replace only obsolete demo counted-repetition/no-adjacent-noise predicates with exact request clause, original repetition excerpt and real omitted-source marker checks. Align demo text and README with native source semantics.
must_preserve: [production bytes, ambient bytes and index, existing lifecycle assertions, 120-second cooldown, sandbox isolation, historical readers]
must_not: [weaken to arbitrary versions, import writer version constant, add dependencies, invoke paid provider, change user cache, commit, edit production]
success:
  - id: T1-S1
    acceptance: [AC1, AC2]
    criterion: Focused valid/adversarial fixtures pass and consumer wiring matches the frozen delta.
    gate_ids: [T1-S1]
stop_if: [unexplained overlapping edits, current emitted contract differs materially from source baseline, required gate needs production mutation or external authority]
```

## Verification Contract
### Task Gates
```yaml
- id: T1-S1
  kind: task
  check: {command: 'bun test ./tests/e2e/current-compaction.test.ts', working_directory: .}
  pass: exit 0; valid fixture accepted and all negative fixtures rejected; consolidated task diff inspection verifies consumer wiring and preserved lifecycle assertions
  covers: {tasks: [T1], success: [T1-S1], acceptance: [AC1, AC2]}
  run_when: {kind: task_candidate, task: T1}
```
### Integration Gates
None; one cohesive writing task, all edits precede checks.
### Terminal Gates
```yaml
- id: TG1
  kind: terminal
  check: {command: 'sandbox=$(mktemp -d /tmp/dc-distill-v14-e2e.XXXXXX); PI_CODING_AGENT_DIR="$sandbox/agent" DISTILL_PI_PACKAGE="$PWD/node_modules/@earendil-works/pi-coding-agent" DISTILL_PI_EXPECT_VERSION=0.99.2 bun run distill:e2e', working_directory: .}
  pass: exit 0; all scripted real-Pi lifecycle/interception/busy scenarios pass without live provider calls or user-cache changes
  covers: {tasks: [T1], success: [T1-S1], acceptance: [AC1, AC3]}
  run_when: {kind: contract_candidate}
- id: TG2
  kind: terminal
  check: {command: 'sandbox=$(mktemp -d /tmp/dc-distill-v14-demo.XXXXXX); PI_CODING_AGENT_DIR="$sandbox/agent" DISTILL_PI_PACKAGE="$PWD/node_modules/@earendil-works/pi-coding-agent" DISTILL_PI_EXPECT_VERSION=0.99.2 bun run distill:demo', working_directory: .}
  pass: exit 0 and v14/schema-v2 validated PASS output with retained artifacts
  covers: {tasks: [T1], success: [T1-S1], acceptance: [AC1, AC3]}
  run_when: {kind: contract_candidate}
- id: TG3
  kind: terminal
  check: {command: 'bun x tsc --noEmit', working_directory: .}
  pass: exit 0
  covers: {tasks: [T1], success: [T1-S1], acceptance: [AC1, AC2]}
  run_when: {kind: contract_candidate}
- id: TG4
  kind: terminal
  check: {command: 'bun run distill:architecture', working_directory: .}
  pass: exit 0 and architecture checks pass
  covers: {tasks: [T1], success: [T1-S1], acceptance: [AC3]}
  run_when: {kind: contract_candidate}
- id: TG5
  kind: terminal
  check: {command: 'git diff --check', working_directory: .}
  pass: exit 0; fresh manifest verifies task containment, source stability and HEAD/index preservation; final semantic diff review passes
  covers: {tasks: [T1], success: [T1-S1], acceptance: [AC1, AC2, AC3]}
  run_when: {kind: contract_candidate}
```
Each gate captures fresh before/after input manifest identities including new acceptance files, tracked/untracked source, package/config inputs; no PASS on changed inputs. Final PRD/workset completion and response repeat the source fence. Required gates run once after all edits; only affected failed/stale gates rerun.

## Execution Block Conditions
SOURCE_DRIFT, SPEC_CONTRADICTION, MISSING_DECISION, OUT_OF_SCOPE_DEPENDENCY, AMBIENT_WORK_CONFLICT, EXTERNAL_AUTHORITY_REQUIRED, GATE_FAILED_UNRESOLVED, FINALIZATION_UNRESOLVED retain the canonical PRD-contract meanings. Diagnose local gate failures inside the acceptance envelope; preserve production and all failure receipts. Block only if no authorized causal repair remains.

## Exit Criteria
T1 complete with task gate and all five terminal gates passed on stable source; semantic diff review and ambient/index preservation passed; exact immutable prefix unchanged; W001 outcome supported by current real-host receipts. No commit required. No full unit-suite, performance, paid-provider, visual UI or other-host certification claim.

## Workflow State
```yaml
implementation_approval: granted
execution_protocol: 3
state_revision: 12
execution_status: complete
current_task: null
tasks:
  T1: complete
completed:
  - T1
blocked: []
verification_receipts:
  - kind: contract_start
    immutable_digest_scheme: utf8-crlf-lf-v1
    contract_digest: 5ca4752235ecf4aab1ed380d9723e19319ae181d8eba7a5ae8361c1dcaefb878
    authority: full /wwgd bound internal execution; exhausted-capacity parent
      override; no commit
    continuation_basis: one finite finding; no authoritative queued successor
  - kind: checkpoint
    checkpoint_id: current-compaction-T1-edit
    operation_id: current-compaction-T1-edit
    operation_kind: task
    phase: dispatching
    task: T1
    contract_digest: 5ca4752235ecf4aab1ed380d9723e19319ae181d8eba7a5ae8361c1dcaefb878
    intended: acceptance-only shared assertion, fixtures, consumer wiring, README
    observed_baseline:
      digest: 807d11e1146ee5e88a47ed0d8a46d80ae13e7b37c41066976e76057cc2044fa4
      entries:
        .dependency-cruiser.cjs: f90d4b8c206440cc7006c105126ddb091a8ae57bc1a8225b49b54e63b0356edf
        .gitignore: 8f21e3b9b123ffa75121a0ae451782c432407acc21cc784d8fc095cd3e8c3cf7
        AGENTS.md: af56ae1e888439e976f2eac7ecf8c447ff2f73f99bba3b8900dcdf1add2b4286
        CLAUDE.md: symlink:AGENTS.md
        LICENSE: e2e52298290bec0f61398b5684006a59f0d8e2a7374e7f4cd134d5c36b660a47
        README.md: 4dae887df73702ccaf751e5683a42c298a59ecb1dee9251f5c4072ca4bb62e2f
        bin/dc-distill-session.ts: 15d9306ff37153205e88eda1baab634e341e2a25e6c9da5ca409f6762192524f
        bun.lock: 997ed36d6a2500f0e8ab160da30dd689f3c12e885e42933fe03e8aa7746e61eb
        debug/checkpoint-gate.ts: 6ac8afb9d7315db48851f95a64237676fe45cff3afe6b3fc62798f32d0076f6f
        debug/live-repro.ts: df3cd57568e1b68ccf2b21bd8d4acbf0802779d916e56b8de1a59a01ae69c3ad
        docs-contract.test.ts: e176e2eed18179cc551e295bae31f58c8730aa1e26321fce22c5b266f03fbaae
        docs/adr/0001-vendored-framework-boundary.md: 1388e4baba3d47fc433924c9807239fe50c596b57f318675c42b667b38c7329a
        docs/adr/0002-remove-vendored-framework.md: 2fbfc6def5635e9bfc1c5d2359ad779954c6f39dbebbd2bdf9417c93bd06d634
        docs/algorithm.md: 996beaaa59f3813f03b075ae2168120f2b47a133a695da75a457f93bc94c6d02
        docs/architecture.md: acf03df39fbb9e7a230a14cfba7ac3853c56a68bf3a45851ddb9c0ac2f1eb0ee
        docs/assets/distill-before-after.svg: 80ab3aa5b4f4bf2032daed7f08ecf25ffea586c5b733fa87163367964b8c0b50
        docs/compiler-benchmark.md: 0c9735e4a0f38cfe1f04ba955e103af19de7bc7fffc8506f03cf08f5e42380e4
        docs/releasing.md: a46134cd81e46690b0d0a5003c82c28d676fcd038fc25c5545a1cb0e2f832f3f
        docs/settings.md: fb6ff8195aea5e7198c58978b2ddd576bad291344283fbc3ef0ab0eb0f25e45a
        docs/troubleshooting.md: 118e91a571558a0d6aed99c7dfcafd592f31022faad6e5ad6b076c5a9c688b73
        docs/usage.md: a61aa7631a95fd2724ddba95933fbb9a5e951d7cf268957f5907a8ad459ffb3a
        index.phase1.test.ts: 113dcc79a51a216e0f23372a352992f55cf163b0e594982b5621d40285fa305e
        index.phase5.test.ts: 2bb02a7aab442d06941042d5088902dc29d24ca00bfde8f94a5868b9fc686020
        index.test.ts: b8697744329f12560b0205679a046046552d32477f498bf65767560a915ccbaf
        index.ts: 033710154492de4ed5d452aa4d07fa65c192cc3dde683dcb238c643952870bee
        index.v12.test.ts: 4b3bbd27accf76f6969a3e85401b6dd6884e234def14bc083437c91eabc59701
        lib/bm25.test.ts: 0fdcb41087f8fd5c62624088aae64b14f1cde65da45e1898cc85ca2038650b4c
        lib/bm25.ts: 00ec5ea25040b9fe88e0cd5538d5aa75aa1a6d5ea1b9fac3ecd491e905e08537
        lib/cache-runs.test.ts: 065effd0b1c7be678077d0137d498b87a38c2328a630473b86966ea8463e2be0
        lib/cache-runs.ts: e384ac5736b8f3803dc226f3483e9c01a7b725fb2839073b8cf66c6f0f21f421
        lib/checkpoint-update.test.ts: fe2480ef76ac8cfa716e5552f5c83e82155134d54e522c9ac692a986d6102285
        lib/checkpoint-update.ts: dbb4115a98e445149c4900922128248aa08177683525117a5581b7af8f892e22
        lib/compaction-card-dedupe.test.ts: 2af0cfcfa9c33744bd821fb435fbbcdeb9f3e5f3119f08d6ab7ad239d8638899
        lib/compaction-card-dedupe.ts: b15f9286e1715e9e47ce6ab04a5cef57260f541115c970507b36b950a7529e58
        lib/compaction-card.test.ts: 10efd22edb9e70155be542385f4f8e9b28a2085b6a30e87da22ef6491b37d060
        lib/compaction-card.ts: 3eba217ca318cce075ebe6d1f0776efa3c523f43a553406fe4e01af63f2a95db
        lib/compaction-source.test.ts: 7d043e9afa9ca2636996f9fff478e480e4254bfbe1742d21d0e7a5331541592f
        lib/compaction-source.ts: df5fac5b9a5853759ffc042c3c9d463dcef91ad746034cd6c52773b620267243
        lib/compile-session-file.ts: 37795fbc5054717b2aae8eff343079c68c12f6c8eb62189dc95c25fcef7a90b6
        lib/compiler/anchors.ts: da9d1e8fba8cbc84054f7b73f5bf85be7fe12692bc5f4624538cbdef370f953e
        lib/compiler/budget-formatter.test.ts: e2c2af5a4a041dc2b6c87c29b19f249db32a90e1476437d5407788399aaafa44
        lib/compiler/budget-formatter.ts: 23b876eee5619de92a327b6e9a8f7b3d46146021b0fccf91a1d6bbacd7002925
        lib/compiler/checkpoint-ladder.test.ts: f709202745e1807d7f14b3aea474c64d8008ef419b5586cc7b774eb2f54f95e9
        lib/compiler/checkpoint.test.ts: ff93c53ee31ea55563b7abccdb3108c70d510a7e3e1b6ca053256c82cef87974
        lib/compiler/checkpoint.ts: 65b409e1799e68e70a3440120d58e618fa4665f7a4b97970b30902a5c87951ed
        lib/compiler/conversation-reducer.phase4.test.ts: b9540ec821862376668d91c68faf166a01f68e2134f690275444f192beb0c25c
        lib/compiler/conversation-reducer.test.ts: 1ea56c0d5ffdac53c7ed5d1cc9c75050970e7cb4157af4618708ac6e63c5b7fb
        lib/compiler/conversation-reducer.ts: 57a3b7a08bf851137f6ea40e150f2f20be86f94d31469aaee1a2730efd5d0c1e
        lib/compiler/display-projection.test.ts: 310d7ff71b3603b5b6f736826ce9243136f918708362f2b7f67d6811e687cf9a
        lib/compiler/display-projection.ts: 27aedd88003afeb7d3b855ab88ec8f3783aae6efcbd4c926f70b1a44bbf23d65
        lib/compiler/errors.ts: bdb940fd1bb4b9b9e1958fddf23a774371794eaf6712123ca32e9a83957a18b7
        lib/compiler/evidence-lifetime.test.ts: 02349b64b03975289c8225f8a7e43769554e9303243b640dc46006f0c091050a
        lib/compiler/handoff-projection.test.ts: 0c1974fed453762934e057ce80ff7ee0cde2e62a1cb5ac231cf46bfba20fdf83
        lib/compiler/helpers.ts: 614594b7678e483bffd86ac664dc7a097bbbfdac4c28eb5f2d60c998fe09aaad
        lib/compiler/lexical-budget.ts: 7661f2775b25a75986b1fc539bed0efa544067573828a904ec681d8108e4f87b
        lib/compiler/normalizer.test.ts: 691742bcbcb087ddf5e83fd11ca85dfd884db94c58046ab463ee9aa1edf00491
        lib/compiler/normalizer.ts: 9dee1d55a09adbc6a36380701324cb92412988b9b50418211a755e9d43694f85
        lib/compiler/observed-readiness.test.ts: 371717edf02d8cbe08429c7ddc2f00a37d036610722c9e3971c4833a2b4bfb62
        lib/compiler/observed-readiness.ts: a61fe1797add41cbb1d0206fad44d414010b56d446787210acc0d44ec9bcc8f8
        lib/compiler/optional-selector.test.ts: 60e1de16a0af3c530b45fd626ef802058e04c664bbd8d831dafbe9ea3398210f
        lib/compiler/optional-selector.ts: 3028a31bb5e4f628eb762900374fad5d07267c70108f845b612dfea40bdd7061
        lib/compiler/path-roots.ts: 8b1771d0dac7e04f23e2076a681caa9f986e22ce6a8c91d36072fa7356c1ffa7
        lib/compiler/protected-overflow-regression.test.ts: a68ab7a94a586c576561f2a847b1b26dec78eb35f5c6f8b6a4231224ff16f672
        lib/compiler/request-candidate.test.ts: 756fb4d777d3aa1bc1a364352e8864a18d9db86514e2df784e631b173b0c935d
        lib/compiler/request-candidate.ts: 3b84f9386e7fc9beb299d7f46b6bbd74a91086b9cbac81ad056e6bc245067b1f
        lib/compiler/resume-index.test.ts: 27dd32d78a1e2ea88ee1278884c6e021407847587b44d16a368abf8c2a73599d
        lib/compiler/resume-index.ts: 0bb0fe3b835054b391858f13d5a4690f33ea505cc9e41ceb4d405a8ed9b81ed7
        lib/compiler/resume-plan.phase4.test.ts: 794b0955940d9831dc022059c0ec10c4e687353b967c5246559c922e851d76f7
        lib/compiler/section-scanner.test.ts: 54c9bde4ac6d8fd50363b1071c51f2714e7e6bbb9187abc2e13b63fcc97ee3d0
        lib/compiler/section-scanner.ts: 3f548fd9c41b115fd2620b2aa4ba571a0401a1fba4a88d49d26d1de2e82d9632
        lib/compiler/shell-analysis.test.ts: d76439d9ab2b1d4ae97392ea31659d999b60fc15993d4b262701ec6f7f3f8986
        lib/compiler/shell-analysis.ts: a44b9996d16b88122f2e287ec5ffafc2fbb211df308abe58d3551eda1e03696b
        lib/compiler/structural-v12.test.ts: a90f578c3bf6514c7c4f2ad5d3fd1cd08f1e2f2e91c7af6ad2b305d8124ba056
        lib/compiler/tool-effects-v12.test.ts: 398b4c9e476ede216ffd78d5ff4cd6bacce6c349f87c49bc181f81b5d8f14ddf
        lib/compiler/tool-effects.ts: 08462f0d2b52fa1d8a5a22115797759fd9d6f250ce9c0675061f3ed8ce3da526
        lib/compiler/tool-tracker.ts: 0f119a507a50361631f035e619db1e9dc77404b4a4d4fd636aa3885beef3ff17
        lib/compiler/types.ts: e039000df576be98758b4870f4d65644cdeca20a84a6e0f558d26e93c69910c4
        lib/compiler/verification-display.test.ts: 6e265a6f14bf320f322e5fa7db649c192f9702a1f20cafba811d8953b2e2cbea
        lib/compiler/verification-display.ts: c698e75804e37b1f5ce0f62602a139de10260cf3485d7436105bb037c6c46fc3
        lib/compiler/verification-observation.test.ts: 3110b011fb28a269ec045fb0ae63bb4e291f5fc090c7c20b00afcd65c3cb5276
        lib/compiler/verification-observation.ts: 0a50e89b868dc4522de0dbe57b695639a29c0dd7e257166f03d9364b12c1f536
        lib/continuation-recovery.test.ts: f87d36a7a646662da521da318260e73ba9ad1f853f1a207c1f1543727f1207ba
        lib/continuation-recovery.ts: 66645435aeb9fd3d53b209f6c96f39bd77c2c3103ba8f98d2b6966c6a2daa9aa
        lib/continuation.test.ts: 003c96689f72271a960ed65ce82a669fa830a92cca5f2c1a8813b789c7dffff0
        lib/continuation.ts: aeede077ece2b51e6698b3abcee9b04bbbb1d4ae8e41119e4bfdc3108b2d018b
        lib/data-migration.test.ts: 8674f7c68408e5e17416ce0f154ca10a8ea9f923a0d0a9ed6c145a70860bf478
        lib/data-migration.ts: f10e00e99a4ca076b3d82f97e2e9ecf6db4decc67ed8321179239407a789b51a
        lib/diag-support.test.ts: 8d1f675a3bf67a05cd11f313f2d19e594b0eb8caee75ccb725292428bbead9f8
        lib/diag-support.ts: 8bcc298e70155870262b32c124725b93890a1a75f57846ab5dc2f8b823851b81
        lib/entries-support.test.ts: 8220f20b7b83995db64a0961f2415319c7393613e3859903beb5203750c38f2c
        lib/entries-support.ts: a3f88f00943f790b5e3820c6b6e300cb7342561e1dbdab8d2a2feea57e867668
        lib/events-support.test.ts: 435dfd11eaf4a24104155c05d608fb7bf4652afc6886b63df42ff783e75e58bc
        lib/events-support.ts: 38d9a5228b96e4ce1a0fdda0ed437bb6bc8a5ff9ebece5f30544d2711b5502ac
        lib/extract-tags.ts: 9a31d5165d48710bd108118cc8d9c6f5a3351c1ba7b7533d1aaa455407c871a4
        lib/focus-echo.test.ts: 828d33fda65680a92af4d39e78886021eadc50e75b50345c858a5a829889ea07
        lib/focus-echo.ts: 2b2caa30257e4914a4b8c104d33b9f137cc5e6aa30719d8234be58c54404d551
        lib/fs-support.test.ts: 798d5b2d6ff1d667e1817d7e15f46a1386521e825e8735dea85552d43569c7e7
        lib/fs-support.ts: 781773b23e0dcca774b32b9d72a7384366aa32e72cb284aad70cdc0f4a9f638d
        lib/handoff.test.ts: 126b67aad40e34474560e3e11716b912f0a73a33dcd3babb6c55c959e56ee701
        lib/handoff.ts: 2a31c02abaad242fb1a8b37fb9a735902a9061dd77ba137177bf65b8f4e83aeb
        lib/json-object-keys.ts: 29506e7775909619e67bf2fd6a3174a0805140671fdd3caf8ee4545d3e6bd3ab
        lib/legacy-compat.test.ts: d65e8055b25a5d97f0b7c86ce96c7ffa3d71d52df5f36e8ed4ea12b040bad3ba
        lib/legacy.ts: 880a2c0b83050dfbb8bf31eee8d9cd628763017b7f8fa8502cf5faba55f681b1
        lib/local-compact.test.ts: d85835d8e8ed9898fb6d0001a670ec848f386d6fd9cbb21a2404724aa2e9ba8b
        lib/local-compact.ts: f30644758346df1b4551bb1de172fc65bf851e87be3c0b9ef018ade3cee05a3a
        lib/metric.test.ts: e8cfe49b5b87d67ff79e7a98691dbd88bc8334f62e41425ce3fddd078418d7ea
        lib/metric.ts: 4c2682b5858bf6f41e92bb9bf80463146813e16eb7f39fd700ed9088f030837b
        lib/monitor.test.ts: 1eeb119cbacb00b37afd7a883c016f9e8934342435a231a6b8911cb58087ccc8
        lib/monitor.ts: 5d832f113026968a03afc4f0e39560d19dd36c351f446b13293af7ad15583eb9
        lib/notify-support.test.ts: 753e639c9e7af3da17fe04016257d2ea976edb9f88638c6fd20fb02ec2184aba
        lib/notify-support.ts: eef58b4cd5e39dc246df5ccecc8a1e3ccca323751ca48fccd87f49947872e88d
        lib/offline/checkpoint-corpus.ts: 0a72f85ef6ae2bc816cfd73c4e4cf16da1773a308909e61cd127b8325483290b
        lib/offline/checkpoint-evaluator.test.ts: f69e4f8e24fccd35e9b2c19df43a012a2ae5764397ec83c2d4c0d3848d331846
        lib/offline/checkpoint-evaluator.ts: eac6b3aa8c45efbfd98717e93d20be5e684f9d539b82c28c3ee4681af9bb77df
        lib/offline/performance-gate.test.ts: 348a8b6d25b835e25ad1263f20da903cbfaeddc31539c107db05314420bccb46
        lib/offline/performance-gate.ts: fda5c8a2c1aaa6f1c167205bde70c8a0e8a3ddc78dd16deeec7c96e2955b1af4
        lib/offline/quality-corpus.ts: db57c6a8e3249ca3b22a9aaf4bdff41868b6c7a9bb52948d08575841c229dc96
        lib/offline/quality-evaluator.test.ts: b5229efda06630399d805b33dd9823d98bdfd3405146b6a7eaaeeba6f83e0ad6
        lib/offline/quality-evaluator.ts: 4b904d6a0cdb9ad4690d8377277fd292ffa42fbd850fa01e0477a3ac1f3ea4ac
        lib/offline/supplemental-corpus.ts: 67a6d152264a1175dc6dd56f74010058fd9b99b7111b4e6402dd93a8075748e2
        lib/offline/supplemental-evaluator.test.ts: a981d8f5a5f6a457aa7b0775b4b50662c16b5ad7e88f7447f1bd454edb9b7ecd
        lib/offline/supplemental-evaluator.ts: 39cdc53497afbb46a71a22ec7717c57bb05043c07960826d15ee5956cb3e3b5b
        lib/offline/survival-corpus.ts: ce740dd3eb31584b6efe97f538579ced28d4e68875347c75b429a645a82faa89
        lib/offline/survival-evaluator.test.ts: c47c76095dfe7c77c86b4c839d5fb3ee3adb06e0d36c7ae29683721af9a7dd72
        lib/offline/survival-evaluator.ts: a727b00c61468b695efe1cb4a1bced8dcd0be60b2f01052d284fcb19cdb0e233
        lib/output-compactor.test.ts: 819c399fce5cdc1639f0500bf15fe007774b7fba5dbc2d15d1880e7ca5bd13cb
        lib/output-compactor.ts: 9ebd68c1c7e82a98357d1a416935a5750cbf2980553644513102bf45dac1e524
        lib/paths.test.ts: 4786b00420e80ef17304f57e8e44a3ead0918edd37d050334267a2a7869ff9e2
        lib/paths.ts: a14afd19b1e330f64bebad580267c651464809377b00abcb555bcf0c489e1c5b
        lib/phase1-controller.test.ts: 6994035ad74027a19fd428aec4f1e60531e480cb13e7fdab32f972b2e50e2ae4
        lib/phase1-controller.ts: dbda83ed14bd87b327882a5aa425e5015c74d28042316c0792e15b9038dd77dd
        lib/phase1-lifecycle.property.test.ts: 9f1e47135522544f0b80e73805af2c629ad0af6d374f69c5ea8f22ae09cb9129
        lib/recall-entry.ts: f95094d09264906e083d76073b64d276af10caf4a69cbe7057bba0377b58f680
        lib/recall-projection.test.ts: fcd199d1ac107167871560ac6aad3a737a1be843ad1481c0bfb7b40f7aa1fff4
        lib/recall-projection.ts: 34d0523d3a3aab93f69705c7589d97d49f34ea6c5f9e1ada9045fdb4cea3a658
        lib/recall.test.ts: e90896852ccf2c1ca4d1d853238d3095fcad2f04f5f40352a9d7ad936f86d7a3
        lib/recall.ts: b87ca426ef87f0945f517218182d5473cfd65444e3e4eacacdaf685ef431491f
        lib/resumption-fidelity.test.ts: 955e8b60828aac8a91c8804a607608135e700e1a518a04af2c62fcdb0eec2846
        lib/runtime-probe.ts: 5a384c1d5f730ff6c62714b10ecda71090aaee19b7c8f1bba144d74a030b1f77
        lib/sdk.ts: 81ef935bdfe4a6daa8cda7cf585a7c7f0295a644fbb709fc38cef03906768937
        lib/session-evaluator.test.ts: cdcb0cb4b9b3c15899433ed4836984a84558f3a9bd78e4e940b193f6fdbb81cc
        lib/session-evaluator.ts: a4e0d0ab76bf3672f149e64b936e9c593a51165a1581616178d7cfc4897d0722
        lib/settings.test.ts: 871e2332afca88f92ecf31a9fc84bfdbe9e099aced6d9c97ec0702eb1fd7f309
        lib/settings.ts: 0017d98b0668145b586eb20ac42d96ecc089210e73711bac0002892fa98a7a7f
        lib/sha256.test.ts: 9131960dae17083192659dd10196b4fb83a998b70d4bed88d3073acab41fe85b
        lib/sha256.ts: 523f5efaa3ac2982f8f833240cb002351b52721420c48309a34f05f5b07dd125
        lib/store.test.ts: 856fbd303337d059314b858aaf5004a39198b92d49f35efe17d0a2612c53d3e1
        lib/store.ts: 3a8d1f9db3e38a66e33fdc365a03d5aa0e38761d45815595c16c45176bd97b37
        lib/strategy.test.ts: e549e307fb40eea44731981eafd5ed08d39dbce392f938d7f38ce44845bd662d
        lib/strategy.ts: 65a116cd0ae9d72c61afaed2b49947f4e6d8351f522446dc6f17f974b53e2b36
        lib/tool-result.test.ts: 85e238dadf1beea81baccc3361fffb96ca6a1ac6a101213c6f98e42f36dc3f76
        lib/tool-result.ts: 6cecb489009b8f7406b18ced9a0a6f2a19757c9a0efc020e197ee53c115bfd11
        lib/trigger.test.ts: a7b74a128989c66951d1e567fda7a19d6e32af1bf56a8e0722e5430cd894b658
        lib/trigger.ts: 5fa705fc16a31dcd2fedc703a7fb8ef1ad5069b60618aa4a1018d9f4ec31c206
        lib/tui-block.test.ts: ee25d80023627b5c63fadd15aa8978135e09006b0962f74fa2dacb6b410a1de1
        lib/tui-block.ts: 2c7200875c91b2cadf05d6ca88b7d7748f1f249c42b68937852f674ed50cea7c
        lib/types.ts: aade627b2f2683de80a138cc81ae59a71d25e4151e953b0fdf8040a3aa08809f
        lib/unicode.test.ts: 9f4b8ad3dea9b38f3e373575cf29e07898564e55be88627eb9b571deda013521
        lib/unicode.ts: 2a1a14f6c87a12f5acc1ef0ed8b10f3e30912f6344d46d1928f2a3a1434ca123
        lib/wire-format.ts: b149adac61adfc596173474e33d432cd93263e81a90608c70af755f44df2f9fa
        package.json: c59b7f5e269b4cb79288f9a880a2408dde2082b5b2b76e162a6e8f2b2b47a681
        scripts/benchmark-compiler.ts: 9e2bc7e815c273621e7312b3e54b8ddff0897180c444dbd08b016a87c7075f1a
        scripts/check-architecture.ts: abfedfb9a1fe62f32dac370a9579f14f4010e4dc78ba93c2cb33ba5d85697480
        scripts/evaluate-selector.ts: 59f6eeada8b20f3d7893f87f15d32ec4b87e07c1585e7c9af94b332f532b8c37
        tests/compare-session.ts: eecb3847c156685dc634be07033a55b41b44f385f1e8723ae8d59d8ea1562792
        tests/e2e/README.md: b9b58b3d7eea0555e5b4b13a1daf7b9575c66bc2745349c4144106fd2d731f39
        tests/e2e/busy-compaction.e2e.ts: df742676f8b66743773a8eca41de6de06d6ca6dd0308f95ca41d7022ad21f937
        tests/e2e/current-compaction.test.ts: 9efd50ccfa00f3645e076a4614ae5ea480320eb92c4c74e36ae1caf516cd95a9
        tests/e2e/demo.ts: 111c36985b6a9997560fff462856e44224d9a8bd1609c8f95afc380a44b3510d
        tests/e2e/harness/compaction-barrier.ts: c303a0bcde5d55b521570a5e06c0beaf86a1f47f81ac457ec77f7a4bb97db58e
        tests/e2e/harness/current-compaction.ts: 30009cbf2bd0bf92579480ba06acba76db7415839d38dea61aa50861f137b8bf
        tests/e2e/harness/env.ts: 80d510793aee4cc973e8dd59110a5b5871deea0a53fd26b93962325e94b06b99
        tests/e2e/harness/fake-provider.ts: 660fcff8b643a9bc3e749bb912acacd0384bdae41389ab7e2d2b5f405c8aa7f1
        tests/e2e/harness/preparation-fault.ts: 1d2e977db7ca4f80cedcc6452414e700113a5d870ee9f480c7c7c33dd9fbb15d
        tests/e2e/harness/rpc-client.ts: 42525b4925d12d0cebdeb92b5cab758369975f0e7e6a70eb10b4028bb07c3b31
        tests/e2e/interception.e2e.ts: b2cefbc64ab9d5b5213dbd9398eb09612945729565038e1a4ee3ebf6168e3a90
        tests/e2e/lifecycle.e2e.ts: 6468c3c34a2f5355d6a95c57350157ef8d34a0357121ed54ba9a8e82296a4fd7
        tests/fixtures/parser-session.jsonl: 50575fa33d879ec0e2ce4b1455545dd2836f12d37f54f4a6e731794b387c40e7
        tests/harness/fake-pi.ts: 471929329a9da287771609a65655e393b95eed3f9b8c07a8799dc12d48d1caf6
        tests/harness/preparation-fixture.ts: ec8bf72df94a9f82c24d719df8f10ccea9db3eb814a6654f1fa3514979ffedae
        tests/verify-improvement.test.ts: a9a5f39929a9c12274c448bfb574fbbc92e9c28df4ae3736876be3608019e433
        tsconfig.json: 08529066dec16388122122f2582069e400770a8587711b912794e10896615b0f
      at: 2026-10-05T23:42:33.100Z
    attempted: next scoped edits
    verified: publication/preflight identities; no product edits yet
    next_action: edit then run task and terminal gates
  - kind: checkpoint
    checkpoint_id: current-compaction-T1-S1
    operation_id: current-compaction-T1-S1
    operation_kind: gate
    gate: T1-S1
    phase: reconciled
    task: T1
    contract_digest: 5ca4752235ecf4aab1ed380d9723e19319ae181d8eba7a5ae8361c1dcaefb878
    before:
      digest: e8abdfc549201351a2bafd8b458df6c3779135718f32d4dc912f1a8165c4d44e
      entries:
        .dependency-cruiser.cjs: f90d4b8c206440cc7006c105126ddb091a8ae57bc1a8225b49b54e63b0356edf
        .gitignore: 8f21e3b9b123ffa75121a0ae451782c432407acc21cc784d8fc095cd3e8c3cf7
        AGENTS.md: af56ae1e888439e976f2eac7ecf8c447ff2f73f99bba3b8900dcdf1add2b4286
        CLAUDE.md: symlink:AGENTS.md
        LICENSE: e2e52298290bec0f61398b5684006a59f0d8e2a7374e7f4cd134d5c36b660a47
        README.md: 4dae887df73702ccaf751e5683a42c298a59ecb1dee9251f5c4072ca4bb62e2f
        bin/dc-distill-session.ts: 15d9306ff37153205e88eda1baab634e341e2a25e6c9da5ca409f6762192524f
        bun.lock: 997ed36d6a2500f0e8ab160da30dd689f3c12e885e42933fe03e8aa7746e61eb
        debug/checkpoint-gate.ts: 6ac8afb9d7315db48851f95a64237676fe45cff3afe6b3fc62798f32d0076f6f
        debug/live-repro.ts: df3cd57568e1b68ccf2b21bd8d4acbf0802779d916e56b8de1a59a01ae69c3ad
        docs-contract.test.ts: e176e2eed18179cc551e295bae31f58c8730aa1e26321fce22c5b266f03fbaae
        docs/adr/0001-vendored-framework-boundary.md: 1388e4baba3d47fc433924c9807239fe50c596b57f318675c42b667b38c7329a
        docs/adr/0002-remove-vendored-framework.md: 2fbfc6def5635e9bfc1c5d2359ad779954c6f39dbebbd2bdf9417c93bd06d634
        docs/algorithm.md: 996beaaa59f3813f03b075ae2168120f2b47a133a695da75a457f93bc94c6d02
        docs/architecture.md: acf03df39fbb9e7a230a14cfba7ac3853c56a68bf3a45851ddb9c0ac2f1eb0ee
        docs/assets/distill-before-after.svg: 80ab3aa5b4f4bf2032daed7f08ecf25ffea586c5b733fa87163367964b8c0b50
        docs/compiler-benchmark.md: 0c9735e4a0f38cfe1f04ba955e103af19de7bc7fffc8506f03cf08f5e42380e4
        docs/releasing.md: a46134cd81e46690b0d0a5003c82c28d676fcd038fc25c5545a1cb0e2f832f3f
        docs/settings.md: fb6ff8195aea5e7198c58978b2ddd576bad291344283fbc3ef0ab0eb0f25e45a
        docs/troubleshooting.md: 118e91a571558a0d6aed99c7dfcafd592f31022faad6e5ad6b076c5a9c688b73
        docs/usage.md: a61aa7631a95fd2724ddba95933fbb9a5e951d7cf268957f5907a8ad459ffb3a
        index.phase1.test.ts: 113dcc79a51a216e0f23372a352992f55cf163b0e594982b5621d40285fa305e
        index.phase5.test.ts: 2bb02a7aab442d06941042d5088902dc29d24ca00bfde8f94a5868b9fc686020
        index.test.ts: b8697744329f12560b0205679a046046552d32477f498bf65767560a915ccbaf
        index.ts: 033710154492de4ed5d452aa4d07fa65c192cc3dde683dcb238c643952870bee
        index.v12.test.ts: 4b3bbd27accf76f6969a3e85401b6dd6884e234def14bc083437c91eabc59701
        lib/bm25.test.ts: 0fdcb41087f8fd5c62624088aae64b14f1cde65da45e1898cc85ca2038650b4c
        lib/bm25.ts: 00ec5ea25040b9fe88e0cd5538d5aa75aa1a6d5ea1b9fac3ecd491e905e08537
        lib/cache-runs.test.ts: 065effd0b1c7be678077d0137d498b87a38c2328a630473b86966ea8463e2be0
        lib/cache-runs.ts: e384ac5736b8f3803dc226f3483e9c01a7b725fb2839073b8cf66c6f0f21f421
        lib/checkpoint-update.test.ts: fe2480ef76ac8cfa716e5552f5c83e82155134d54e522c9ac692a986d6102285
        lib/checkpoint-update.ts: dbb4115a98e445149c4900922128248aa08177683525117a5581b7af8f892e22
        lib/compaction-card-dedupe.test.ts: 2af0cfcfa9c33744bd821fb435fbbcdeb9f3e5f3119f08d6ab7ad239d8638899
        lib/compaction-card-dedupe.ts: b15f9286e1715e9e47ce6ab04a5cef57260f541115c970507b36b950a7529e58
        lib/compaction-card.test.ts: 10efd22edb9e70155be542385f4f8e9b28a2085b6a30e87da22ef6491b37d060
        lib/compaction-card.ts: 3eba217ca318cce075ebe6d1f0776efa3c523f43a553406fe4e01af63f2a95db
        lib/compaction-source.test.ts: 7d043e9afa9ca2636996f9fff478e480e4254bfbe1742d21d0e7a5331541592f
        lib/compaction-source.ts: df5fac5b9a5853759ffc042c3c9d463dcef91ad746034cd6c52773b620267243
        lib/compile-session-file.ts: 37795fbc5054717b2aae8eff343079c68c12f6c8eb62189dc95c25fcef7a90b6
        lib/compiler/anchors.ts: da9d1e8fba8cbc84054f7b73f5bf85be7fe12692bc5f4624538cbdef370f953e
        lib/compiler/budget-formatter.test.ts: e2c2af5a4a041dc2b6c87c29b19f249db32a90e1476437d5407788399aaafa44
        lib/compiler/budget-formatter.ts: 23b876eee5619de92a327b6e9a8f7b3d46146021b0fccf91a1d6bbacd7002925
        lib/compiler/checkpoint-ladder.test.ts: f709202745e1807d7f14b3aea474c64d8008ef419b5586cc7b774eb2f54f95e9
        lib/compiler/checkpoint.test.ts: ff93c53ee31ea55563b7abccdb3108c70d510a7e3e1b6ca053256c82cef87974
        lib/compiler/checkpoint.ts: 65b409e1799e68e70a3440120d58e618fa4665f7a4b97970b30902a5c87951ed
        lib/compiler/conversation-reducer.phase4.test.ts: b9540ec821862376668d91c68faf166a01f68e2134f690275444f192beb0c25c
        lib/compiler/conversation-reducer.test.ts: 1ea56c0d5ffdac53c7ed5d1cc9c75050970e7cb4157af4618708ac6e63c5b7fb
        lib/compiler/conversation-reducer.ts: 57a3b7a08bf851137f6ea40e150f2f20be86f94d31469aaee1a2730efd5d0c1e
        lib/compiler/display-projection.test.ts: 310d7ff71b3603b5b6f736826ce9243136f918708362f2b7f67d6811e687cf9a
        lib/compiler/display-projection.ts: 27aedd88003afeb7d3b855ab88ec8f3783aae6efcbd4c926f70b1a44bbf23d65
        lib/compiler/errors.ts: bdb940fd1bb4b9b9e1958fddf23a774371794eaf6712123ca32e9a83957a18b7
        lib/compiler/evidence-lifetime.test.ts: 02349b64b03975289c8225f8a7e43769554e9303243b640dc46006f0c091050a
        lib/compiler/handoff-projection.test.ts: 0c1974fed453762934e057ce80ff7ee0cde2e62a1cb5ac231cf46bfba20fdf83
        lib/compiler/helpers.ts: 614594b7678e483bffd86ac664dc7a097bbbfdac4c28eb5f2d60c998fe09aaad
        lib/compiler/lexical-budget.ts: 7661f2775b25a75986b1fc539bed0efa544067573828a904ec681d8108e4f87b
        lib/compiler/normalizer.test.ts: 691742bcbcb087ddf5e83fd11ca85dfd884db94c58046ab463ee9aa1edf00491
        lib/compiler/normalizer.ts: 9dee1d55a09adbc6a36380701324cb92412988b9b50418211a755e9d43694f85
        lib/compiler/observed-readiness.test.ts: 371717edf02d8cbe08429c7ddc2f00a37d036610722c9e3971c4833a2b4bfb62
        lib/compiler/observed-readiness.ts: a61fe1797add41cbb1d0206fad44d414010b56d446787210acc0d44ec9bcc8f8
        lib/compiler/optional-selector.test.ts: 60e1de16a0af3c530b45fd626ef802058e04c664bbd8d831dafbe9ea3398210f
        lib/compiler/optional-selector.ts: 3028a31bb5e4f628eb762900374fad5d07267c70108f845b612dfea40bdd7061
        lib/compiler/path-roots.ts: 8b1771d0dac7e04f23e2076a681caa9f986e22ce6a8c91d36072fa7356c1ffa7
        lib/compiler/protected-overflow-regression.test.ts: a68ab7a94a586c576561f2a847b1b26dec78eb35f5c6f8b6a4231224ff16f672
        lib/compiler/request-candidate.test.ts: 756fb4d777d3aa1bc1a364352e8864a18d9db86514e2df784e631b173b0c935d
        lib/compiler/request-candidate.ts: 3b84f9386e7fc9beb299d7f46b6bbd74a91086b9cbac81ad056e6bc245067b1f
        lib/compiler/resume-index.test.ts: 27dd32d78a1e2ea88ee1278884c6e021407847587b44d16a368abf8c2a73599d
        lib/compiler/resume-index.ts: 0bb0fe3b835054b391858f13d5a4690f33ea505cc9e41ceb4d405a8ed9b81ed7
        lib/compiler/resume-plan.phase4.test.ts: 794b0955940d9831dc022059c0ec10c4e687353b967c5246559c922e851d76f7
        lib/compiler/section-scanner.test.ts: 54c9bde4ac6d8fd50363b1071c51f2714e7e6bbb9187abc2e13b63fcc97ee3d0
        lib/compiler/section-scanner.ts: 3f548fd9c41b115fd2620b2aa4ba571a0401a1fba4a88d49d26d1de2e82d9632
        lib/compiler/shell-analysis.test.ts: d76439d9ab2b1d4ae97392ea31659d999b60fc15993d4b262701ec6f7f3f8986
        lib/compiler/shell-analysis.ts: a44b9996d16b88122f2e287ec5ffafc2fbb211df308abe58d3551eda1e03696b
        lib/compiler/structural-v12.test.ts: a90f578c3bf6514c7c4f2ad5d3fd1cd08f1e2f2e91c7af6ad2b305d8124ba056
        lib/compiler/tool-effects-v12.test.ts: 398b4c9e476ede216ffd78d5ff4cd6bacce6c349f87c49bc181f81b5d8f14ddf
        lib/compiler/tool-effects.ts: 08462f0d2b52fa1d8a5a22115797759fd9d6f250ce9c0675061f3ed8ce3da526
        lib/compiler/tool-tracker.ts: 0f119a507a50361631f035e619db1e9dc77404b4a4d4fd636aa3885beef3ff17
        lib/compiler/types.ts: e039000df576be98758b4870f4d65644cdeca20a84a6e0f558d26e93c69910c4
        lib/compiler/verification-display.test.ts: 6e265a6f14bf320f322e5fa7db649c192f9702a1f20cafba811d8953b2e2cbea
        lib/compiler/verification-display.ts: c698e75804e37b1f5ce0f62602a139de10260cf3485d7436105bb037c6c46fc3
        lib/compiler/verification-observation.test.ts: 3110b011fb28a269ec045fb0ae63bb4e291f5fc090c7c20b00afcd65c3cb5276
        lib/compiler/verification-observation.ts: 0a50e89b868dc4522de0dbe57b695639a29c0dd7e257166f03d9364b12c1f536
        lib/continuation-recovery.test.ts: f87d36a7a646662da521da318260e73ba9ad1f853f1a207c1f1543727f1207ba
        lib/continuation-recovery.ts: 66645435aeb9fd3d53b209f6c96f39bd77c2c3103ba8f98d2b6966c6a2daa9aa
        lib/continuation.test.ts: 003c96689f72271a960ed65ce82a669fa830a92cca5f2c1a8813b789c7dffff0
        lib/continuation.ts: aeede077ece2b51e6698b3abcee9b04bbbb1d4ae8e41119e4bfdc3108b2d018b
        lib/data-migration.test.ts: 8674f7c68408e5e17416ce0f154ca10a8ea9f923a0d0a9ed6c145a70860bf478
        lib/data-migration.ts: f10e00e99a4ca076b3d82f97e2e9ecf6db4decc67ed8321179239407a789b51a
        lib/diag-support.test.ts: 8d1f675a3bf67a05cd11f313f2d19e594b0eb8caee75ccb725292428bbead9f8
        lib/diag-support.ts: 8bcc298e70155870262b32c124725b93890a1a75f57846ab5dc2f8b823851b81
        lib/entries-support.test.ts: 8220f20b7b83995db64a0961f2415319c7393613e3859903beb5203750c38f2c
        lib/entries-support.ts: a3f88f00943f790b5e3820c6b6e300cb7342561e1dbdab8d2a2feea57e867668
        lib/events-support.test.ts: 435dfd11eaf4a24104155c05d608fb7bf4652afc6886b63df42ff783e75e58bc
        lib/events-support.ts: 38d9a5228b96e4ce1a0fdda0ed437bb6bc8a5ff9ebece5f30544d2711b5502ac
        lib/extract-tags.ts: 9a31d5165d48710bd108118cc8d9c6f5a3351c1ba7b7533d1aaa455407c871a4
        lib/focus-echo.test.ts: 828d33fda65680a92af4d39e78886021eadc50e75b50345c858a5a829889ea07
        lib/focus-echo.ts: 2b2caa30257e4914a4b8c104d33b9f137cc5e6aa30719d8234be58c54404d551
        lib/fs-support.test.ts: 798d5b2d6ff1d667e1817d7e15f46a1386521e825e8735dea85552d43569c7e7
        lib/fs-support.ts: 781773b23e0dcca774b32b9d72a7384366aa32e72cb284aad70cdc0f4a9f638d
        lib/handoff.test.ts: 126b67aad40e34474560e3e11716b912f0a73a33dcd3babb6c55c959e56ee701
        lib/handoff.ts: 2a31c02abaad242fb1a8b37fb9a735902a9061dd77ba137177bf65b8f4e83aeb
        lib/json-object-keys.ts: 29506e7775909619e67bf2fd6a3174a0805140671fdd3caf8ee4545d3e6bd3ab
        lib/legacy-compat.test.ts: d65e8055b25a5d97f0b7c86ce96c7ffa3d71d52df5f36e8ed4ea12b040bad3ba
        lib/legacy.ts: 880a2c0b83050dfbb8bf31eee8d9cd628763017b7f8fa8502cf5faba55f681b1
        lib/local-compact.test.ts: d85835d8e8ed9898fb6d0001a670ec848f386d6fd9cbb21a2404724aa2e9ba8b
        lib/local-compact.ts: f30644758346df1b4551bb1de172fc65bf851e87be3c0b9ef018ade3cee05a3a
        lib/metric.test.ts: e8cfe49b5b87d67ff79e7a98691dbd88bc8334f62e41425ce3fddd078418d7ea
        lib/metric.ts: 4c2682b5858bf6f41e92bb9bf80463146813e16eb7f39fd700ed9088f030837b
        lib/monitor.test.ts: 1eeb119cbacb00b37afd7a883c016f9e8934342435a231a6b8911cb58087ccc8
        lib/monitor.ts: 5d832f113026968a03afc4f0e39560d19dd36c351f446b13293af7ad15583eb9
        lib/notify-support.test.ts: 753e639c9e7af3da17fe04016257d2ea976edb9f88638c6fd20fb02ec2184aba
        lib/notify-support.ts: eef58b4cd5e39dc246df5ccecc8a1e3ccca323751ca48fccd87f49947872e88d
        lib/offline/checkpoint-corpus.ts: 0a72f85ef6ae2bc816cfd73c4e4cf16da1773a308909e61cd127b8325483290b
        lib/offline/checkpoint-evaluator.test.ts: f69e4f8e24fccd35e9b2c19df43a012a2ae5764397ec83c2d4c0d3848d331846
        lib/offline/checkpoint-evaluator.ts: eac6b3aa8c45efbfd98717e93d20be5e684f9d539b82c28c3ee4681af9bb77df
        lib/offline/performance-gate.test.ts: 348a8b6d25b835e25ad1263f20da903cbfaeddc31539c107db05314420bccb46
        lib/offline/performance-gate.ts: fda5c8a2c1aaa6f1c167205bde70c8a0e8a3ddc78dd16deeec7c96e2955b1af4
        lib/offline/quality-corpus.ts: db57c6a8e3249ca3b22a9aaf4bdff41868b6c7a9bb52948d08575841c229dc96
        lib/offline/quality-evaluator.test.ts: b5229efda06630399d805b33dd9823d98bdfd3405146b6a7eaaeeba6f83e0ad6
        lib/offline/quality-evaluator.ts: 4b904d6a0cdb9ad4690d8377277fd292ffa42fbd850fa01e0477a3ac1f3ea4ac
        lib/offline/supplemental-corpus.ts: 67a6d152264a1175dc6dd56f74010058fd9b99b7111b4e6402dd93a8075748e2
        lib/offline/supplemental-evaluator.test.ts: a981d8f5a5f6a457aa7b0775b4b50662c16b5ad7e88f7447f1bd454edb9b7ecd
        lib/offline/supplemental-evaluator.ts: 39cdc53497afbb46a71a22ec7717c57bb05043c07960826d15ee5956cb3e3b5b
        lib/offline/survival-corpus.ts: ce740dd3eb31584b6efe97f538579ced28d4e68875347c75b429a645a82faa89
        lib/offline/survival-evaluator.test.ts: c47c76095dfe7c77c86b4c839d5fb3ee3adb06e0d36c7ae29683721af9a7dd72
        lib/offline/survival-evaluator.ts: a727b00c61468b695efe1cb4a1bced8dcd0be60b2f01052d284fcb19cdb0e233
        lib/output-compactor.test.ts: 819c399fce5cdc1639f0500bf15fe007774b7fba5dbc2d15d1880e7ca5bd13cb
        lib/output-compactor.ts: 9ebd68c1c7e82a98357d1a416935a5750cbf2980553644513102bf45dac1e524
        lib/paths.test.ts: 4786b00420e80ef17304f57e8e44a3ead0918edd37d050334267a2a7869ff9e2
        lib/paths.ts: a14afd19b1e330f64bebad580267c651464809377b00abcb555bcf0c489e1c5b
        lib/phase1-controller.test.ts: 6994035ad74027a19fd428aec4f1e60531e480cb13e7fdab32f972b2e50e2ae4
        lib/phase1-controller.ts: dbda83ed14bd87b327882a5aa425e5015c74d28042316c0792e15b9038dd77dd
        lib/phase1-lifecycle.property.test.ts: 9f1e47135522544f0b80e73805af2c629ad0af6d374f69c5ea8f22ae09cb9129
        lib/recall-entry.ts: f95094d09264906e083d76073b64d276af10caf4a69cbe7057bba0377b58f680
        lib/recall-projection.test.ts: fcd199d1ac107167871560ac6aad3a737a1be843ad1481c0bfb7b40f7aa1fff4
        lib/recall-projection.ts: 34d0523d3a3aab93f69705c7589d97d49f34ea6c5f9e1ada9045fdb4cea3a658
        lib/recall.test.ts: e90896852ccf2c1ca4d1d853238d3095fcad2f04f5f40352a9d7ad936f86d7a3
        lib/recall.ts: b87ca426ef87f0945f517218182d5473cfd65444e3e4eacacdaf685ef431491f
        lib/resumption-fidelity.test.ts: 955e8b60828aac8a91c8804a607608135e700e1a518a04af2c62fcdb0eec2846
        lib/runtime-probe.ts: 5a384c1d5f730ff6c62714b10ecda71090aaee19b7c8f1bba144d74a030b1f77
        lib/sdk.ts: 81ef935bdfe4a6daa8cda7cf585a7c7f0295a644fbb709fc38cef03906768937
        lib/session-evaluator.test.ts: cdcb0cb4b9b3c15899433ed4836984a84558f3a9bd78e4e940b193f6fdbb81cc
        lib/session-evaluator.ts: a4e0d0ab76bf3672f149e64b936e9c593a51165a1581616178d7cfc4897d0722
        lib/settings.test.ts: 871e2332afca88f92ecf31a9fc84bfdbe9e099aced6d9c97ec0702eb1fd7f309
        lib/settings.ts: 0017d98b0668145b586eb20ac42d96ecc089210e73711bac0002892fa98a7a7f
        lib/sha256.test.ts: 9131960dae17083192659dd10196b4fb83a998b70d4bed88d3073acab41fe85b
        lib/sha256.ts: 523f5efaa3ac2982f8f833240cb002351b52721420c48309a34f05f5b07dd125
        lib/store.test.ts: 856fbd303337d059314b858aaf5004a39198b92d49f35efe17d0a2612c53d3e1
        lib/store.ts: 3a8d1f9db3e38a66e33fdc365a03d5aa0e38761d45815595c16c45176bd97b37
        lib/strategy.test.ts: e549e307fb40eea44731981eafd5ed08d39dbce392f938d7f38ce44845bd662d
        lib/strategy.ts: 65a116cd0ae9d72c61afaed2b49947f4e6d8351f522446dc6f17f974b53e2b36
        lib/tool-result.test.ts: 85e238dadf1beea81baccc3361fffb96ca6a1ac6a101213c6f98e42f36dc3f76
        lib/tool-result.ts: 6cecb489009b8f7406b18ced9a0a6f2a19757c9a0efc020e197ee53c115bfd11
        lib/trigger.test.ts: a7b74a128989c66951d1e567fda7a19d6e32af1bf56a8e0722e5430cd894b658
        lib/trigger.ts: 5fa705fc16a31dcd2fedc703a7fb8ef1ad5069b60618aa4a1018d9f4ec31c206
        lib/tui-block.test.ts: ee25d80023627b5c63fadd15aa8978135e09006b0962f74fa2dacb6b410a1de1
        lib/tui-block.ts: 2c7200875c91b2cadf05d6ca88b7d7748f1f249c42b68937852f674ed50cea7c
        lib/types.ts: aade627b2f2683de80a138cc81ae59a71d25e4151e953b0fdf8040a3aa08809f
        lib/unicode.test.ts: 9f4b8ad3dea9b38f3e373575cf29e07898564e55be88627eb9b571deda013521
        lib/unicode.ts: 2a1a14f6c87a12f5acc1ef0ed8b10f3e30912f6344d46d1928f2a3a1434ca123
        lib/wire-format.ts: b149adac61adfc596173474e33d432cd93263e81a90608c70af755f44df2f9fa
        package.json: c59b7f5e269b4cb79288f9a880a2408dde2082b5b2b76e162a6e8f2b2b47a681
        scripts/benchmark-compiler.ts: 9e2bc7e815c273621e7312b3e54b8ddff0897180c444dbd08b016a87c7075f1a
        scripts/check-architecture.ts: abfedfb9a1fe62f32dac370a9579f14f4010e4dc78ba93c2cb33ba5d85697480
        scripts/evaluate-selector.ts: 59f6eeada8b20f3d7893f87f15d32ec4b87e07c1585e7c9af94b332f532b8c37
        tests/compare-session.ts: eecb3847c156685dc634be07033a55b41b44f385f1e8723ae8d59d8ea1562792
        tests/e2e/current-compaction.test.ts: 9efd50ccfa00f3645e076a4614ae5ea480320eb92c4c74e36ae1caf516cd95a9
        tests/e2e/harness/compaction-barrier.ts: c303a0bcde5d55b521570a5e06c0beaf86a1f47f81ac457ec77f7a4bb97db58e
        tests/e2e/harness/current-compaction.ts: 30009cbf2bd0bf92579480ba06acba76db7415839d38dea61aa50861f137b8bf
        tests/e2e/harness/env.ts: 80d510793aee4cc973e8dd59110a5b5871deea0a53fd26b93962325e94b06b99
        tests/e2e/harness/fake-provider.ts: 660fcff8b643a9bc3e749bb912acacd0384bdae41389ab7e2d2b5f405c8aa7f1
        tests/e2e/harness/preparation-fault.ts: 1d2e977db7ca4f80cedcc6452414e700113a5d870ee9f480c7c7c33dd9fbb15d
        tests/e2e/harness/rpc-client.ts: 42525b4925d12d0cebdeb92b5cab758369975f0e7e6a70eb10b4028bb07c3b31
        tests/e2e/interception.e2e.ts: b2cefbc64ab9d5b5213dbd9398eb09612945729565038e1a4ee3ebf6168e3a90
        tests/fixtures/parser-session.jsonl: 50575fa33d879ec0e2ce4b1455545dd2836f12d37f54f4a6e731794b387c40e7
        tests/harness/fake-pi.ts: 471929329a9da287771609a65655e393b95eed3f9b8c07a8799dc12d48d1caf6
        tests/harness/preparation-fixture.ts: ec8bf72df94a9f82c24d719df8f10ccea9db3eb814a6654f1fa3514979ffedae
        tests/verify-improvement.test.ts: a9a5f39929a9c12274c448bfb574fbbc92e9c28df4ae3736876be3608019e433
        tsconfig.json: 08529066dec16388122122f2582069e400770a8587711b912794e10896615b0f
      at: 2026-10-05T23:38:00.464Z
    intended: run frozen gate T1-S1
    next_action: continue next frozen gate or diagnose failure
    after:
      digest: e8abdfc549201351a2bafd8b458df6c3779135718f32d4dc912f1a8165c4d44e
      entries:
        .dependency-cruiser.cjs: f90d4b8c206440cc7006c105126ddb091a8ae57bc1a8225b49b54e63b0356edf
        .gitignore: 8f21e3b9b123ffa75121a0ae451782c432407acc21cc784d8fc095cd3e8c3cf7
        AGENTS.md: af56ae1e888439e976f2eac7ecf8c447ff2f73f99bba3b8900dcdf1add2b4286
        CLAUDE.md: symlink:AGENTS.md
        LICENSE: e2e52298290bec0f61398b5684006a59f0d8e2a7374e7f4cd134d5c36b660a47
        README.md: 4dae887df73702ccaf751e5683a42c298a59ecb1dee9251f5c4072ca4bb62e2f
        bin/dc-distill-session.ts: 15d9306ff37153205e88eda1baab634e341e2a25e6c9da5ca409f6762192524f
        bun.lock: 997ed36d6a2500f0e8ab160da30dd689f3c12e885e42933fe03e8aa7746e61eb
        debug/checkpoint-gate.ts: 6ac8afb9d7315db48851f95a64237676fe45cff3afe6b3fc62798f32d0076f6f
        debug/live-repro.ts: df3cd57568e1b68ccf2b21bd8d4acbf0802779d916e56b8de1a59a01ae69c3ad
        docs-contract.test.ts: e176e2eed18179cc551e295bae31f58c8730aa1e26321fce22c5b266f03fbaae
        docs/adr/0001-vendored-framework-boundary.md: 1388e4baba3d47fc433924c9807239fe50c596b57f318675c42b667b38c7329a
        docs/adr/0002-remove-vendored-framework.md: 2fbfc6def5635e9bfc1c5d2359ad779954c6f39dbebbd2bdf9417c93bd06d634
        docs/algorithm.md: 996beaaa59f3813f03b075ae2168120f2b47a133a695da75a457f93bc94c6d02
        docs/architecture.md: acf03df39fbb9e7a230a14cfba7ac3853c56a68bf3a45851ddb9c0ac2f1eb0ee
        docs/assets/distill-before-after.svg: 80ab3aa5b4f4bf2032daed7f08ecf25ffea586c5b733fa87163367964b8c0b50
        docs/compiler-benchmark.md: 0c9735e4a0f38cfe1f04ba955e103af19de7bc7fffc8506f03cf08f5e42380e4
        docs/releasing.md: a46134cd81e46690b0d0a5003c82c28d676fcd038fc25c5545a1cb0e2f832f3f
        docs/settings.md: fb6ff8195aea5e7198c58978b2ddd576bad291344283fbc3ef0ab0eb0f25e45a
        docs/troubleshooting.md: 118e91a571558a0d6aed99c7dfcafd592f31022faad6e5ad6b076c5a9c688b73
        docs/usage.md: a61aa7631a95fd2724ddba95933fbb9a5e951d7cf268957f5907a8ad459ffb3a
        index.phase1.test.ts: 113dcc79a51a216e0f23372a352992f55cf163b0e594982b5621d40285fa305e
        index.phase5.test.ts: 2bb02a7aab442d06941042d5088902dc29d24ca00bfde8f94a5868b9fc686020
        index.test.ts: b8697744329f12560b0205679a046046552d32477f498bf65767560a915ccbaf
        index.ts: 033710154492de4ed5d452aa4d07fa65c192cc3dde683dcb238c643952870bee
        index.v12.test.ts: 4b3bbd27accf76f6969a3e85401b6dd6884e234def14bc083437c91eabc59701
        lib/bm25.test.ts: 0fdcb41087f8fd5c62624088aae64b14f1cde65da45e1898cc85ca2038650b4c
        lib/bm25.ts: 00ec5ea25040b9fe88e0cd5538d5aa75aa1a6d5ea1b9fac3ecd491e905e08537
        lib/cache-runs.test.ts: 065effd0b1c7be678077d0137d498b87a38c2328a630473b86966ea8463e2be0
        lib/cache-runs.ts: e384ac5736b8f3803dc226f3483e9c01a7b725fb2839073b8cf66c6f0f21f421
        lib/checkpoint-update.test.ts: fe2480ef76ac8cfa716e5552f5c83e82155134d54e522c9ac692a986d6102285
        lib/checkpoint-update.ts: dbb4115a98e445149c4900922128248aa08177683525117a5581b7af8f892e22
        lib/compaction-card-dedupe.test.ts: 2af0cfcfa9c33744bd821fb435fbbcdeb9f3e5f3119f08d6ab7ad239d8638899
        lib/compaction-card-dedupe.ts: b15f9286e1715e9e47ce6ab04a5cef57260f541115c970507b36b950a7529e58
        lib/compaction-card.test.ts: 10efd22edb9e70155be542385f4f8e9b28a2085b6a30e87da22ef6491b37d060
        lib/compaction-card.ts: 3eba217ca318cce075ebe6d1f0776efa3c523f43a553406fe4e01af63f2a95db
        lib/compaction-source.test.ts: 7d043e9afa9ca2636996f9fff478e480e4254bfbe1742d21d0e7a5331541592f
        lib/compaction-source.ts: df5fac5b9a5853759ffc042c3c9d463dcef91ad746034cd6c52773b620267243
        lib/compile-session-file.ts: 37795fbc5054717b2aae8eff343079c68c12f6c8eb62189dc95c25fcef7a90b6
        lib/compiler/anchors.ts: da9d1e8fba8cbc84054f7b73f5bf85be7fe12692bc5f4624538cbdef370f953e
        lib/compiler/budget-formatter.test.ts: e2c2af5a4a041dc2b6c87c29b19f249db32a90e1476437d5407788399aaafa44
        lib/compiler/budget-formatter.ts: 23b876eee5619de92a327b6e9a8f7b3d46146021b0fccf91a1d6bbacd7002925
        lib/compiler/checkpoint-ladder.test.ts: f709202745e1807d7f14b3aea474c64d8008ef419b5586cc7b774eb2f54f95e9
        lib/compiler/checkpoint.test.ts: ff93c53ee31ea55563b7abccdb3108c70d510a7e3e1b6ca053256c82cef87974
        lib/compiler/checkpoint.ts: 65b409e1799e68e70a3440120d58e618fa4665f7a4b97970b30902a5c87951ed
        lib/compiler/conversation-reducer.phase4.test.ts: b9540ec821862376668d91c68faf166a01f68e2134f690275444f192beb0c25c
        lib/compiler/conversation-reducer.test.ts: 1ea56c0d5ffdac53c7ed5d1cc9c75050970e7cb4157af4618708ac6e63c5b7fb
        lib/compiler/conversation-reducer.ts: 57a3b7a08bf851137f6ea40e150f2f20be86f94d31469aaee1a2730efd5d0c1e
        lib/compiler/display-projection.test.ts: 310d7ff71b3603b5b6f736826ce9243136f918708362f2b7f67d6811e687cf9a
        lib/compiler/display-projection.ts: 27aedd88003afeb7d3b855ab88ec8f3783aae6efcbd4c926f70b1a44bbf23d65
        lib/compiler/errors.ts: bdb940fd1bb4b9b9e1958fddf23a774371794eaf6712123ca32e9a83957a18b7
        lib/compiler/evidence-lifetime.test.ts: 02349b64b03975289c8225f8a7e43769554e9303243b640dc46006f0c091050a
        lib/compiler/handoff-projection.test.ts: 0c1974fed453762934e057ce80ff7ee0cde2e62a1cb5ac231cf46bfba20fdf83
        lib/compiler/helpers.ts: 614594b7678e483bffd86ac664dc7a097bbbfdac4c28eb5f2d60c998fe09aaad
        lib/compiler/lexical-budget.ts: 7661f2775b25a75986b1fc539bed0efa544067573828a904ec681d8108e4f87b
        lib/compiler/normalizer.test.ts: 691742bcbcb087ddf5e83fd11ca85dfd884db94c58046ab463ee9aa1edf00491
        lib/compiler/normalizer.ts: 9dee1d55a09adbc6a36380701324cb92412988b9b50418211a755e9d43694f85
        lib/compiler/observed-readiness.test.ts: 371717edf02d8cbe08429c7ddc2f00a37d036610722c9e3971c4833a2b4bfb62
        lib/compiler/observed-readiness.ts: a61fe1797add41cbb1d0206fad44d414010b56d446787210acc0d44ec9bcc8f8
        lib/compiler/optional-selector.test.ts: 60e1de16a0af3c530b45fd626ef802058e04c664bbd8d831dafbe9ea3398210f
        lib/compiler/optional-selector.ts: 3028a31bb5e4f628eb762900374fad5d07267c70108f845b612dfea40bdd7061
        lib/compiler/path-roots.ts: 8b1771d0dac7e04f23e2076a681caa9f986e22ce6a8c91d36072fa7356c1ffa7
        lib/compiler/protected-overflow-regression.test.ts: a68ab7a94a586c576561f2a847b1b26dec78eb35f5c6f8b6a4231224ff16f672
        lib/compiler/request-candidate.test.ts: 756fb4d777d3aa1bc1a364352e8864a18d9db86514e2df784e631b173b0c935d
        lib/compiler/request-candidate.ts: 3b84f9386e7fc9beb299d7f46b6bbd74a91086b9cbac81ad056e6bc245067b1f
        lib/compiler/resume-index.test.ts: 27dd32d78a1e2ea88ee1278884c6e021407847587b44d16a368abf8c2a73599d
        lib/compiler/resume-index.ts: 0bb0fe3b835054b391858f13d5a4690f33ea505cc9e41ceb4d405a8ed9b81ed7
        lib/compiler/resume-plan.phase4.test.ts: 794b0955940d9831dc022059c0ec10c4e687353b967c5246559c922e851d76f7
        lib/compiler/section-scanner.test.ts: 54c9bde4ac6d8fd50363b1071c51f2714e7e6bbb9187abc2e13b63fcc97ee3d0
        lib/compiler/section-scanner.ts: 3f548fd9c41b115fd2620b2aa4ba571a0401a1fba4a88d49d26d1de2e82d9632
        lib/compiler/shell-analysis.test.ts: d76439d9ab2b1d4ae97392ea31659d999b60fc15993d4b262701ec6f7f3f8986
        lib/compiler/shell-analysis.ts: a44b9996d16b88122f2e287ec5ffafc2fbb211df308abe58d3551eda1e03696b
        lib/compiler/structural-v12.test.ts: a90f578c3bf6514c7c4f2ad5d3fd1cd08f1e2f2e91c7af6ad2b305d8124ba056
        lib/compiler/tool-effects-v12.test.ts: 398b4c9e476ede216ffd78d5ff4cd6bacce6c349f87c49bc181f81b5d8f14ddf
        lib/compiler/tool-effects.ts: 08462f0d2b52fa1d8a5a22115797759fd9d6f250ce9c0675061f3ed8ce3da526
        lib/compiler/tool-tracker.ts: 0f119a507a50361631f035e619db1e9dc77404b4a4d4fd636aa3885beef3ff17
        lib/compiler/types.ts: e039000df576be98758b4870f4d65644cdeca20a84a6e0f558d26e93c69910c4
        lib/compiler/verification-display.test.ts: 6e265a6f14bf320f322e5fa7db649c192f9702a1f20cafba811d8953b2e2cbea
        lib/compiler/verification-display.ts: c698e75804e37b1f5ce0f62602a139de10260cf3485d7436105bb037c6c46fc3
        lib/compiler/verification-observation.test.ts: 3110b011fb28a269ec045fb0ae63bb4e291f5fc090c7c20b00afcd65c3cb5276
        lib/compiler/verification-observation.ts: 0a50e89b868dc4522de0dbe57b695639a29c0dd7e257166f03d9364b12c1f536
        lib/continuation-recovery.test.ts: f87d36a7a646662da521da318260e73ba9ad1f853f1a207c1f1543727f1207ba
        lib/continuation-recovery.ts: 66645435aeb9fd3d53b209f6c96f39bd77c2c3103ba8f98d2b6966c6a2daa9aa
        lib/continuation.test.ts: 003c96689f72271a960ed65ce82a669fa830a92cca5f2c1a8813b789c7dffff0
        lib/continuation.ts: aeede077ece2b51e6698b3abcee9b04bbbb1d4ae8e41119e4bfdc3108b2d018b
        lib/data-migration.test.ts: 8674f7c68408e5e17416ce0f154ca10a8ea9f923a0d0a9ed6c145a70860bf478
        lib/data-migration.ts: f10e00e99a4ca076b3d82f97e2e9ecf6db4decc67ed8321179239407a789b51a
        lib/diag-support.test.ts: 8d1f675a3bf67a05cd11f313f2d19e594b0eb8caee75ccb725292428bbead9f8
        lib/diag-support.ts: 8bcc298e70155870262b32c124725b93890a1a75f57846ab5dc2f8b823851b81
        lib/entries-support.test.ts: 8220f20b7b83995db64a0961f2415319c7393613e3859903beb5203750c38f2c
        lib/entries-support.ts: a3f88f00943f790b5e3820c6b6e300cb7342561e1dbdab8d2a2feea57e867668
        lib/events-support.test.ts: 435dfd11eaf4a24104155c05d608fb7bf4652afc6886b63df42ff783e75e58bc
        lib/events-support.ts: 38d9a5228b96e4ce1a0fdda0ed437bb6bc8a5ff9ebece5f30544d2711b5502ac
        lib/extract-tags.ts: 9a31d5165d48710bd108118cc8d9c6f5a3351c1ba7b7533d1aaa455407c871a4
        lib/focus-echo.test.ts: 828d33fda65680a92af4d39e78886021eadc50e75b50345c858a5a829889ea07
        lib/focus-echo.ts: 2b2caa30257e4914a4b8c104d33b9f137cc5e6aa30719d8234be58c54404d551
        lib/fs-support.test.ts: 798d5b2d6ff1d667e1817d7e15f46a1386521e825e8735dea85552d43569c7e7
        lib/fs-support.ts: 781773b23e0dcca774b32b9d72a7384366aa32e72cb284aad70cdc0f4a9f638d
        lib/handoff.test.ts: 126b67aad40e34474560e3e11716b912f0a73a33dcd3babb6c55c959e56ee701
        lib/handoff.ts: 2a31c02abaad242fb1a8b37fb9a735902a9061dd77ba137177bf65b8f4e83aeb
        lib/json-object-keys.ts: 29506e7775909619e67bf2fd6a3174a0805140671fdd3caf8ee4545d3e6bd3ab
        lib/legacy-compat.test.ts: d65e8055b25a5d97f0b7c86ce96c7ffa3d71d52df5f36e8ed4ea12b040bad3ba
        lib/legacy.ts: 880a2c0b83050dfbb8bf31eee8d9cd628763017b7f8fa8502cf5faba55f681b1
        lib/local-compact.test.ts: d85835d8e8ed9898fb6d0001a670ec848f386d6fd9cbb21a2404724aa2e9ba8b
        lib/local-compact.ts: f30644758346df1b4551bb1de172fc65bf851e87be3c0b9ef018ade3cee05a3a
        lib/metric.test.ts: e8cfe49b5b87d67ff79e7a98691dbd88bc8334f62e41425ce3fddd078418d7ea
        lib/metric.ts: 4c2682b5858bf6f41e92bb9bf80463146813e16eb7f39fd700ed9088f030837b
        lib/monitor.test.ts: 1eeb119cbacb00b37afd7a883c016f9e8934342435a231a6b8911cb58087ccc8
        lib/monitor.ts: 5d832f113026968a03afc4f0e39560d19dd36c351f446b13293af7ad15583eb9
        lib/notify-support.test.ts: 753e639c9e7af3da17fe04016257d2ea976edb9f88638c6fd20fb02ec2184aba
        lib/notify-support.ts: eef58b4cd5e39dc246df5ccecc8a1e3ccca323751ca48fccd87f49947872e88d
        lib/offline/checkpoint-corpus.ts: 0a72f85ef6ae2bc816cfd73c4e4cf16da1773a308909e61cd127b8325483290b
        lib/offline/checkpoint-evaluator.test.ts: f69e4f8e24fccd35e9b2c19df43a012a2ae5764397ec83c2d4c0d3848d331846
        lib/offline/checkpoint-evaluator.ts: eac6b3aa8c45efbfd98717e93d20be5e684f9d539b82c28c3ee4681af9bb77df
        lib/offline/performance-gate.test.ts: 348a8b6d25b835e25ad1263f20da903cbfaeddc31539c107db05314420bccb46
        lib/offline/performance-gate.ts: fda5c8a2c1aaa6f1c167205bde70c8a0e8a3ddc78dd16deeec7c96e2955b1af4
        lib/offline/quality-corpus.ts: db57c6a8e3249ca3b22a9aaf4bdff41868b6c7a9bb52948d08575841c229dc96
        lib/offline/quality-evaluator.test.ts: b5229efda06630399d805b33dd9823d98bdfd3405146b6a7eaaeeba6f83e0ad6
        lib/offline/quality-evaluator.ts: 4b904d6a0cdb9ad4690d8377277fd292ffa42fbd850fa01e0477a3ac1f3ea4ac
        lib/offline/supplemental-corpus.ts: 67a6d152264a1175dc6dd56f74010058fd9b99b7111b4e6402dd93a8075748e2
        lib/offline/supplemental-evaluator.test.ts: a981d8f5a5f6a457aa7b0775b4b50662c16b5ad7e88f7447f1bd454edb9b7ecd
        lib/offline/supplemental-evaluator.ts: 39cdc53497afbb46a71a22ec7717c57bb05043c07960826d15ee5956cb3e3b5b
        lib/offline/survival-corpus.ts: ce740dd3eb31584b6efe97f538579ced28d4e68875347c75b429a645a82faa89
        lib/offline/survival-evaluator.test.ts: c47c76095dfe7c77c86b4c839d5fb3ee3adb06e0d36c7ae29683721af9a7dd72
        lib/offline/survival-evaluator.ts: a727b00c61468b695efe1cb4a1bced8dcd0be60b2f01052d284fcb19cdb0e233
        lib/output-compactor.test.ts: 819c399fce5cdc1639f0500bf15fe007774b7fba5dbc2d15d1880e7ca5bd13cb
        lib/output-compactor.ts: 9ebd68c1c7e82a98357d1a416935a5750cbf2980553644513102bf45dac1e524
        lib/paths.test.ts: 4786b00420e80ef17304f57e8e44a3ead0918edd37d050334267a2a7869ff9e2
        lib/paths.ts: a14afd19b1e330f64bebad580267c651464809377b00abcb555bcf0c489e1c5b
        lib/phase1-controller.test.ts: 6994035ad74027a19fd428aec4f1e60531e480cb13e7fdab32f972b2e50e2ae4
        lib/phase1-controller.ts: dbda83ed14bd87b327882a5aa425e5015c74d28042316c0792e15b9038dd77dd
        lib/phase1-lifecycle.property.test.ts: 9f1e47135522544f0b80e73805af2c629ad0af6d374f69c5ea8f22ae09cb9129
        lib/recall-entry.ts: f95094d09264906e083d76073b64d276af10caf4a69cbe7057bba0377b58f680
        lib/recall-projection.test.ts: fcd199d1ac107167871560ac6aad3a737a1be843ad1481c0bfb7b40f7aa1fff4
        lib/recall-projection.ts: 34d0523d3a3aab93f69705c7589d97d49f34ea6c5f9e1ada9045fdb4cea3a658
        lib/recall.test.ts: e90896852ccf2c1ca4d1d853238d3095fcad2f04f5f40352a9d7ad936f86d7a3
        lib/recall.ts: b87ca426ef87f0945f517218182d5473cfd65444e3e4eacacdaf685ef431491f
        lib/resumption-fidelity.test.ts: 955e8b60828aac8a91c8804a607608135e700e1a518a04af2c62fcdb0eec2846
        lib/runtime-probe.ts: 5a384c1d5f730ff6c62714b10ecda71090aaee19b7c8f1bba144d74a030b1f77
        lib/sdk.ts: 81ef935bdfe4a6daa8cda7cf585a7c7f0295a644fbb709fc38cef03906768937
        lib/session-evaluator.test.ts: cdcb0cb4b9b3c15899433ed4836984a84558f3a9bd78e4e940b193f6fdbb81cc
        lib/session-evaluator.ts: a4e0d0ab76bf3672f149e64b936e9c593a51165a1581616178d7cfc4897d0722
        lib/settings.test.ts: 871e2332afca88f92ecf31a9fc84bfdbe9e099aced6d9c97ec0702eb1fd7f309
        lib/settings.ts: 0017d98b0668145b586eb20ac42d96ecc089210e73711bac0002892fa98a7a7f
        lib/sha256.test.ts: 9131960dae17083192659dd10196b4fb83a998b70d4bed88d3073acab41fe85b
        lib/sha256.ts: 523f5efaa3ac2982f8f833240cb002351b52721420c48309a34f05f5b07dd125
        lib/store.test.ts: 856fbd303337d059314b858aaf5004a39198b92d49f35efe17d0a2612c53d3e1
        lib/store.ts: 3a8d1f9db3e38a66e33fdc365a03d5aa0e38761d45815595c16c45176bd97b37
        lib/strategy.test.ts: e549e307fb40eea44731981eafd5ed08d39dbce392f938d7f38ce44845bd662d
        lib/strategy.ts: 65a116cd0ae9d72c61afaed2b49947f4e6d8351f522446dc6f17f974b53e2b36
        lib/tool-result.test.ts: 85e238dadf1beea81baccc3361fffb96ca6a1ac6a101213c6f98e42f36dc3f76
        lib/tool-result.ts: 6cecb489009b8f7406b18ced9a0a6f2a19757c9a0efc020e197ee53c115bfd11
        lib/trigger.test.ts: a7b74a128989c66951d1e567fda7a19d6e32af1bf56a8e0722e5430cd894b658
        lib/trigger.ts: 5fa705fc16a31dcd2fedc703a7fb8ef1ad5069b60618aa4a1018d9f4ec31c206
        lib/tui-block.test.ts: ee25d80023627b5c63fadd15aa8978135e09006b0962f74fa2dacb6b410a1de1
        lib/tui-block.ts: 2c7200875c91b2cadf05d6ca88b7d7748f1f249c42b68937852f674ed50cea7c
        lib/types.ts: aade627b2f2683de80a138cc81ae59a71d25e4151e953b0fdf8040a3aa08809f
        lib/unicode.test.ts: 9f4b8ad3dea9b38f3e373575cf29e07898564e55be88627eb9b571deda013521
        lib/unicode.ts: 2a1a14f6c87a12f5acc1ef0ed8b10f3e30912f6344d46d1928f2a3a1434ca123
        lib/wire-format.ts: b149adac61adfc596173474e33d432cd93263e81a90608c70af755f44df2f9fa
        package.json: c59b7f5e269b4cb79288f9a880a2408dde2082b5b2b76e162a6e8f2b2b47a681
        scripts/benchmark-compiler.ts: 9e2bc7e815c273621e7312b3e54b8ddff0897180c444dbd08b016a87c7075f1a
        scripts/check-architecture.ts: abfedfb9a1fe62f32dac370a9579f14f4010e4dc78ba93c2cb33ba5d85697480
        scripts/evaluate-selector.ts: 59f6eeada8b20f3d7893f87f15d32ec4b87e07c1585e7c9af94b332f532b8c37
        tests/compare-session.ts: eecb3847c156685dc634be07033a55b41b44f385f1e8723ae8d59d8ea1562792
        tests/e2e/current-compaction.test.ts: 9efd50ccfa00f3645e076a4614ae5ea480320eb92c4c74e36ae1caf516cd95a9
        tests/e2e/harness/compaction-barrier.ts: c303a0bcde5d55b521570a5e06c0beaf86a1f47f81ac457ec77f7a4bb97db58e
        tests/e2e/harness/current-compaction.ts: 30009cbf2bd0bf92579480ba06acba76db7415839d38dea61aa50861f137b8bf
        tests/e2e/harness/env.ts: 80d510793aee4cc973e8dd59110a5b5871deea0a53fd26b93962325e94b06b99
        tests/e2e/harness/fake-provider.ts: 660fcff8b643a9bc3e749bb912acacd0384bdae41389ab7e2d2b5f405c8aa7f1
        tests/e2e/harness/preparation-fault.ts: 1d2e977db7ca4f80cedcc6452414e700113a5d870ee9f480c7c7c33dd9fbb15d
        tests/e2e/harness/rpc-client.ts: 42525b4925d12d0cebdeb92b5cab758369975f0e7e6a70eb10b4028bb07c3b31
        tests/e2e/interception.e2e.ts: b2cefbc64ab9d5b5213dbd9398eb09612945729565038e1a4ee3ebf6168e3a90
        tests/fixtures/parser-session.jsonl: 50575fa33d879ec0e2ce4b1455545dd2836f12d37f54f4a6e731794b387c40e7
        tests/harness/fake-pi.ts: 471929329a9da287771609a65655e393b95eed3f9b8c07a8799dc12d48d1caf6
        tests/harness/preparation-fixture.ts: ec8bf72df94a9f82c24d719df8f10ccea9db3eb814a6654f1fa3514979ffedae
        tests/verify-improvement.test.ts: a9a5f39929a9c12274c448bfb574fbbc92e9c28df4ae3736876be3608019e433
        tsconfig.json: 08529066dec16388122122f2582069e400770a8587711b912794e10896615b0f
      at: 2026-10-05T23:38:00.624Z
    result: passed
    evidence:
      gate: T1-S1
      command: bun test ./tests/e2e/current-compaction.test.ts
      working_directory: /Users/vampire/code/ts/pi-dc-distill
      exit: 0
      signal: null
      started: 2026-10-05T23:38:00.522Z
      ended: 2026-10-05T23:38:00.552Z
      log: /tmp/current-compaction-T1-S1.log
      output: >
        bun test v1.4.0 (34cbb9a40)


        tests/e2e/current-compaction.test.ts:

        (pass) current real-Pi compaction acceptance > accepts authenticated
        v14/schema-v2 with exactly derived telemetry [0.96ms]

        (pass) current real-Pi compaction acceptance > rejects historical
        details version [0.45ms]

        (pass) current real-Pi compaction acceptance > rejects missing details
        version [0.06ms]

        (pass) current real-Pi compaction acceptance > rejects foreign compactor
        [0.14ms]

        (pass) current real-Pi compaction acceptance > rejects historical
        checkpoint schema [0.11ms]

        (pass) current real-Pi compaction acceptance > rejects malformed
        checkpoint [0.05ms]

        (pass) current real-Pi compaction acceptance > rejects wrong checkpoint
        digest [0.11ms]

        (pass) current real-Pi compaction acceptance > rejects missing
        checkpoint digest [0.11ms]

        (pass) current real-Pi compaction acceptance > rejects wrong summary
        digest [0.09ms]

        (pass) current real-Pi compaction acceptance > rejects missing summary
        digest [0.07ms]

        (pass) current real-Pi compaction acceptance > rejects missing section
        ledger [0.62ms]

        (pass) current real-Pi compaction acceptance > rejects wrong section
        cost [0.23ms]

        (pass) current real-Pi compaction acceptance > rejects missing section
        key [0.17ms]

        (pass) current real-Pi compaction acceptance > rejects extra section key
        [0.13ms]

        (pass) current real-Pi compaction acceptance > rejects wrong ladder
        telemetry [0.13ms]

        (pass) current real-Pi compaction acceptance > rejects wrong ledger
        version [0.10ms]

        (pass) current real-Pi compaction acceptance > hashes exact Unicode wire
        bytes including trailing newline [0.15ms]

         17 pass
         0 fail
         19 expect() calls
        Ran 17 tests across 1 file. [16.00ms]
      adoption: same exact gate command and unchanged entire input projection;
        demo/README are not inputs to RPC suite or assertion unit fixtures
    adopted_from:
      path: docs/specs/current-compaction-acceptance.md
      contract_digest: d8be38f244cafdfa9ded1fb6232ba8834550291d5beea92dc75e63a3315e685f
      operation_id: current-compaction-T1-S1
    adoption_observation:
      digest: e8abdfc549201351a2bafd8b458df6c3779135718f32d4dc912f1a8165c4d44e
      entries:
        .dependency-cruiser.cjs: f90d4b8c206440cc7006c105126ddb091a8ae57bc1a8225b49b54e63b0356edf
        .gitignore: 8f21e3b9b123ffa75121a0ae451782c432407acc21cc784d8fc095cd3e8c3cf7
        AGENTS.md: af56ae1e888439e976f2eac7ecf8c447ff2f73f99bba3b8900dcdf1add2b4286
        CLAUDE.md: symlink:AGENTS.md
        LICENSE: e2e52298290bec0f61398b5684006a59f0d8e2a7374e7f4cd134d5c36b660a47
        README.md: 4dae887df73702ccaf751e5683a42c298a59ecb1dee9251f5c4072ca4bb62e2f
        bin/dc-distill-session.ts: 15d9306ff37153205e88eda1baab634e341e2a25e6c9da5ca409f6762192524f
        bun.lock: 997ed36d6a2500f0e8ab160da30dd689f3c12e885e42933fe03e8aa7746e61eb
        debug/checkpoint-gate.ts: 6ac8afb9d7315db48851f95a64237676fe45cff3afe6b3fc62798f32d0076f6f
        debug/live-repro.ts: df3cd57568e1b68ccf2b21bd8d4acbf0802779d916e56b8de1a59a01ae69c3ad
        docs-contract.test.ts: e176e2eed18179cc551e295bae31f58c8730aa1e26321fce22c5b266f03fbaae
        docs/adr/0001-vendored-framework-boundary.md: 1388e4baba3d47fc433924c9807239fe50c596b57f318675c42b667b38c7329a
        docs/adr/0002-remove-vendored-framework.md: 2fbfc6def5635e9bfc1c5d2359ad779954c6f39dbebbd2bdf9417c93bd06d634
        docs/algorithm.md: 996beaaa59f3813f03b075ae2168120f2b47a133a695da75a457f93bc94c6d02
        docs/architecture.md: acf03df39fbb9e7a230a14cfba7ac3853c56a68bf3a45851ddb9c0ac2f1eb0ee
        docs/assets/distill-before-after.svg: 80ab3aa5b4f4bf2032daed7f08ecf25ffea586c5b733fa87163367964b8c0b50
        docs/compiler-benchmark.md: 0c9735e4a0f38cfe1f04ba955e103af19de7bc7fffc8506f03cf08f5e42380e4
        docs/releasing.md: a46134cd81e46690b0d0a5003c82c28d676fcd038fc25c5545a1cb0e2f832f3f
        docs/settings.md: fb6ff8195aea5e7198c58978b2ddd576bad291344283fbc3ef0ab0eb0f25e45a
        docs/troubleshooting.md: 118e91a571558a0d6aed99c7dfcafd592f31022faad6e5ad6b076c5a9c688b73
        docs/usage.md: a61aa7631a95fd2724ddba95933fbb9a5e951d7cf268957f5907a8ad459ffb3a
        index.phase1.test.ts: 113dcc79a51a216e0f23372a352992f55cf163b0e594982b5621d40285fa305e
        index.phase5.test.ts: 2bb02a7aab442d06941042d5088902dc29d24ca00bfde8f94a5868b9fc686020
        index.test.ts: b8697744329f12560b0205679a046046552d32477f498bf65767560a915ccbaf
        index.ts: 033710154492de4ed5d452aa4d07fa65c192cc3dde683dcb238c643952870bee
        index.v12.test.ts: 4b3bbd27accf76f6969a3e85401b6dd6884e234def14bc083437c91eabc59701
        lib/bm25.test.ts: 0fdcb41087f8fd5c62624088aae64b14f1cde65da45e1898cc85ca2038650b4c
        lib/bm25.ts: 00ec5ea25040b9fe88e0cd5538d5aa75aa1a6d5ea1b9fac3ecd491e905e08537
        lib/cache-runs.test.ts: 065effd0b1c7be678077d0137d498b87a38c2328a630473b86966ea8463e2be0
        lib/cache-runs.ts: e384ac5736b8f3803dc226f3483e9c01a7b725fb2839073b8cf66c6f0f21f421
        lib/checkpoint-update.test.ts: fe2480ef76ac8cfa716e5552f5c83e82155134d54e522c9ac692a986d6102285
        lib/checkpoint-update.ts: dbb4115a98e445149c4900922128248aa08177683525117a5581b7af8f892e22
        lib/compaction-card-dedupe.test.ts: 2af0cfcfa9c33744bd821fb435fbbcdeb9f3e5f3119f08d6ab7ad239d8638899
        lib/compaction-card-dedupe.ts: b15f9286e1715e9e47ce6ab04a5cef57260f541115c970507b36b950a7529e58
        lib/compaction-card.test.ts: 10efd22edb9e70155be542385f4f8e9b28a2085b6a30e87da22ef6491b37d060
        lib/compaction-card.ts: 3eba217ca318cce075ebe6d1f0776efa3c523f43a553406fe4e01af63f2a95db
        lib/compaction-source.test.ts: 7d043e9afa9ca2636996f9fff478e480e4254bfbe1742d21d0e7a5331541592f
        lib/compaction-source.ts: df5fac5b9a5853759ffc042c3c9d463dcef91ad746034cd6c52773b620267243
        lib/compile-session-file.ts: 37795fbc5054717b2aae8eff343079c68c12f6c8eb62189dc95c25fcef7a90b6
        lib/compiler/anchors.ts: da9d1e8fba8cbc84054f7b73f5bf85be7fe12692bc5f4624538cbdef370f953e
        lib/compiler/budget-formatter.test.ts: e2c2af5a4a041dc2b6c87c29b19f249db32a90e1476437d5407788399aaafa44
        lib/compiler/budget-formatter.ts: 23b876eee5619de92a327b6e9a8f7b3d46146021b0fccf91a1d6bbacd7002925
        lib/compiler/checkpoint-ladder.test.ts: f709202745e1807d7f14b3aea474c64d8008ef419b5586cc7b774eb2f54f95e9
        lib/compiler/checkpoint.test.ts: ff93c53ee31ea55563b7abccdb3108c70d510a7e3e1b6ca053256c82cef87974
        lib/compiler/checkpoint.ts: 65b409e1799e68e70a3440120d58e618fa4665f7a4b97970b30902a5c87951ed
        lib/compiler/conversation-reducer.phase4.test.ts: b9540ec821862376668d91c68faf166a01f68e2134f690275444f192beb0c25c
        lib/compiler/conversation-reducer.test.ts: 1ea56c0d5ffdac53c7ed5d1cc9c75050970e7cb4157af4618708ac6e63c5b7fb
        lib/compiler/conversation-reducer.ts: 57a3b7a08bf851137f6ea40e150f2f20be86f94d31469aaee1a2730efd5d0c1e
        lib/compiler/display-projection.test.ts: 310d7ff71b3603b5b6f736826ce9243136f918708362f2b7f67d6811e687cf9a
        lib/compiler/display-projection.ts: 27aedd88003afeb7d3b855ab88ec8f3783aae6efcbd4c926f70b1a44bbf23d65
        lib/compiler/errors.ts: bdb940fd1bb4b9b9e1958fddf23a774371794eaf6712123ca32e9a83957a18b7
        lib/compiler/evidence-lifetime.test.ts: 02349b64b03975289c8225f8a7e43769554e9303243b640dc46006f0c091050a
        lib/compiler/handoff-projection.test.ts: 0c1974fed453762934e057ce80ff7ee0cde2e62a1cb5ac231cf46bfba20fdf83
        lib/compiler/helpers.ts: 614594b7678e483bffd86ac664dc7a097bbbfdac4c28eb5f2d60c998fe09aaad
        lib/compiler/lexical-budget.ts: 7661f2775b25a75986b1fc539bed0efa544067573828a904ec681d8108e4f87b
        lib/compiler/normalizer.test.ts: 691742bcbcb087ddf5e83fd11ca85dfd884db94c58046ab463ee9aa1edf00491
        lib/compiler/normalizer.ts: 9dee1d55a09adbc6a36380701324cb92412988b9b50418211a755e9d43694f85
        lib/compiler/observed-readiness.test.ts: 371717edf02d8cbe08429c7ddc2f00a37d036610722c9e3971c4833a2b4bfb62
        lib/compiler/observed-readiness.ts: a61fe1797add41cbb1d0206fad44d414010b56d446787210acc0d44ec9bcc8f8
        lib/compiler/optional-selector.test.ts: 60e1de16a0af3c530b45fd626ef802058e04c664bbd8d831dafbe9ea3398210f
        lib/compiler/optional-selector.ts: 3028a31bb5e4f628eb762900374fad5d07267c70108f845b612dfea40bdd7061
        lib/compiler/path-roots.ts: 8b1771d0dac7e04f23e2076a681caa9f986e22ce6a8c91d36072fa7356c1ffa7
        lib/compiler/protected-overflow-regression.test.ts: a68ab7a94a586c576561f2a847b1b26dec78eb35f5c6f8b6a4231224ff16f672
        lib/compiler/request-candidate.test.ts: 756fb4d777d3aa1bc1a364352e8864a18d9db86514e2df784e631b173b0c935d
        lib/compiler/request-candidate.ts: 3b84f9386e7fc9beb299d7f46b6bbd74a91086b9cbac81ad056e6bc245067b1f
        lib/compiler/resume-index.test.ts: 27dd32d78a1e2ea88ee1278884c6e021407847587b44d16a368abf8c2a73599d
        lib/compiler/resume-index.ts: 0bb0fe3b835054b391858f13d5a4690f33ea505cc9e41ceb4d405a8ed9b81ed7
        lib/compiler/resume-plan.phase4.test.ts: 794b0955940d9831dc022059c0ec10c4e687353b967c5246559c922e851d76f7
        lib/compiler/section-scanner.test.ts: 54c9bde4ac6d8fd50363b1071c51f2714e7e6bbb9187abc2e13b63fcc97ee3d0
        lib/compiler/section-scanner.ts: 3f548fd9c41b115fd2620b2aa4ba571a0401a1fba4a88d49d26d1de2e82d9632
        lib/compiler/shell-analysis.test.ts: d76439d9ab2b1d4ae97392ea31659d999b60fc15993d4b262701ec6f7f3f8986
        lib/compiler/shell-analysis.ts: a44b9996d16b88122f2e287ec5ffafc2fbb211df308abe58d3551eda1e03696b
        lib/compiler/structural-v12.test.ts: a90f578c3bf6514c7c4f2ad5d3fd1cd08f1e2f2e91c7af6ad2b305d8124ba056
        lib/compiler/tool-effects-v12.test.ts: 398b4c9e476ede216ffd78d5ff4cd6bacce6c349f87c49bc181f81b5d8f14ddf
        lib/compiler/tool-effects.ts: 08462f0d2b52fa1d8a5a22115797759fd9d6f250ce9c0675061f3ed8ce3da526
        lib/compiler/tool-tracker.ts: 0f119a507a50361631f035e619db1e9dc77404b4a4d4fd636aa3885beef3ff17
        lib/compiler/types.ts: e039000df576be98758b4870f4d65644cdeca20a84a6e0f558d26e93c69910c4
        lib/compiler/verification-display.test.ts: 6e265a6f14bf320f322e5fa7db649c192f9702a1f20cafba811d8953b2e2cbea
        lib/compiler/verification-display.ts: c698e75804e37b1f5ce0f62602a139de10260cf3485d7436105bb037c6c46fc3
        lib/compiler/verification-observation.test.ts: 3110b011fb28a269ec045fb0ae63bb4e291f5fc090c7c20b00afcd65c3cb5276
        lib/compiler/verification-observation.ts: 0a50e89b868dc4522de0dbe57b695639a29c0dd7e257166f03d9364b12c1f536
        lib/continuation-recovery.test.ts: f87d36a7a646662da521da318260e73ba9ad1f853f1a207c1f1543727f1207ba
        lib/continuation-recovery.ts: 66645435aeb9fd3d53b209f6c96f39bd77c2c3103ba8f98d2b6966c6a2daa9aa
        lib/continuation.test.ts: 003c96689f72271a960ed65ce82a669fa830a92cca5f2c1a8813b789c7dffff0
        lib/continuation.ts: aeede077ece2b51e6698b3abcee9b04bbbb1d4ae8e41119e4bfdc3108b2d018b
        lib/data-migration.test.ts: 8674f7c68408e5e17416ce0f154ca10a8ea9f923a0d0a9ed6c145a70860bf478
        lib/data-migration.ts: f10e00e99a4ca076b3d82f97e2e9ecf6db4decc67ed8321179239407a789b51a
        lib/diag-support.test.ts: 8d1f675a3bf67a05cd11f313f2d19e594b0eb8caee75ccb725292428bbead9f8
        lib/diag-support.ts: 8bcc298e70155870262b32c124725b93890a1a75f57846ab5dc2f8b823851b81
        lib/entries-support.test.ts: 8220f20b7b83995db64a0961f2415319c7393613e3859903beb5203750c38f2c
        lib/entries-support.ts: a3f88f00943f790b5e3820c6b6e300cb7342561e1dbdab8d2a2feea57e867668
        lib/events-support.test.ts: 435dfd11eaf4a24104155c05d608fb7bf4652afc6886b63df42ff783e75e58bc
        lib/events-support.ts: 38d9a5228b96e4ce1a0fdda0ed437bb6bc8a5ff9ebece5f30544d2711b5502ac
        lib/extract-tags.ts: 9a31d5165d48710bd108118cc8d9c6f5a3351c1ba7b7533d1aaa455407c871a4
        lib/focus-echo.test.ts: 828d33fda65680a92af4d39e78886021eadc50e75b50345c858a5a829889ea07
        lib/focus-echo.ts: 2b2caa30257e4914a4b8c104d33b9f137cc5e6aa30719d8234be58c54404d551
        lib/fs-support.test.ts: 798d5b2d6ff1d667e1817d7e15f46a1386521e825e8735dea85552d43569c7e7
        lib/fs-support.ts: 781773b23e0dcca774b32b9d72a7384366aa32e72cb284aad70cdc0f4a9f638d
        lib/handoff.test.ts: 126b67aad40e34474560e3e11716b912f0a73a33dcd3babb6c55c959e56ee701
        lib/handoff.ts: 2a31c02abaad242fb1a8b37fb9a735902a9061dd77ba137177bf65b8f4e83aeb
        lib/json-object-keys.ts: 29506e7775909619e67bf2fd6a3174a0805140671fdd3caf8ee4545d3e6bd3ab
        lib/legacy-compat.test.ts: d65e8055b25a5d97f0b7c86ce96c7ffa3d71d52df5f36e8ed4ea12b040bad3ba
        lib/legacy.ts: 880a2c0b83050dfbb8bf31eee8d9cd628763017b7f8fa8502cf5faba55f681b1
        lib/local-compact.test.ts: d85835d8e8ed9898fb6d0001a670ec848f386d6fd9cbb21a2404724aa2e9ba8b
        lib/local-compact.ts: f30644758346df1b4551bb1de172fc65bf851e87be3c0b9ef018ade3cee05a3a
        lib/metric.test.ts: e8cfe49b5b87d67ff79e7a98691dbd88bc8334f62e41425ce3fddd078418d7ea
        lib/metric.ts: 4c2682b5858bf6f41e92bb9bf80463146813e16eb7f39fd700ed9088f030837b
        lib/monitor.test.ts: 1eeb119cbacb00b37afd7a883c016f9e8934342435a231a6b8911cb58087ccc8
        lib/monitor.ts: 5d832f113026968a03afc4f0e39560d19dd36c351f446b13293af7ad15583eb9
        lib/notify-support.test.ts: 753e639c9e7af3da17fe04016257d2ea976edb9f88638c6fd20fb02ec2184aba
        lib/notify-support.ts: eef58b4cd5e39dc246df5ccecc8a1e3ccca323751ca48fccd87f49947872e88d
        lib/offline/checkpoint-corpus.ts: 0a72f85ef6ae2bc816cfd73c4e4cf16da1773a308909e61cd127b8325483290b
        lib/offline/checkpoint-evaluator.test.ts: f69e4f8e24fccd35e9b2c19df43a012a2ae5764397ec83c2d4c0d3848d331846
        lib/offline/checkpoint-evaluator.ts: eac6b3aa8c45efbfd98717e93d20be5e684f9d539b82c28c3ee4681af9bb77df
        lib/offline/performance-gate.test.ts: 348a8b6d25b835e25ad1263f20da903cbfaeddc31539c107db05314420bccb46
        lib/offline/performance-gate.ts: fda5c8a2c1aaa6f1c167205bde70c8a0e8a3ddc78dd16deeec7c96e2955b1af4
        lib/offline/quality-corpus.ts: db57c6a8e3249ca3b22a9aaf4bdff41868b6c7a9bb52948d08575841c229dc96
        lib/offline/quality-evaluator.test.ts: b5229efda06630399d805b33dd9823d98bdfd3405146b6a7eaaeeba6f83e0ad6
        lib/offline/quality-evaluator.ts: 4b904d6a0cdb9ad4690d8377277fd292ffa42fbd850fa01e0477a3ac1f3ea4ac
        lib/offline/supplemental-corpus.ts: 67a6d152264a1175dc6dd56f74010058fd9b99b7111b4e6402dd93a8075748e2
        lib/offline/supplemental-evaluator.test.ts: a981d8f5a5f6a457aa7b0775b4b50662c16b5ad7e88f7447f1bd454edb9b7ecd
        lib/offline/supplemental-evaluator.ts: 39cdc53497afbb46a71a22ec7717c57bb05043c07960826d15ee5956cb3e3b5b
        lib/offline/survival-corpus.ts: ce740dd3eb31584b6efe97f538579ced28d4e68875347c75b429a645a82faa89
        lib/offline/survival-evaluator.test.ts: c47c76095dfe7c77c86b4c839d5fb3ee3adb06e0d36c7ae29683721af9a7dd72
        lib/offline/survival-evaluator.ts: a727b00c61468b695efe1cb4a1bced8dcd0be60b2f01052d284fcb19cdb0e233
        lib/output-compactor.test.ts: 819c399fce5cdc1639f0500bf15fe007774b7fba5dbc2d15d1880e7ca5bd13cb
        lib/output-compactor.ts: 9ebd68c1c7e82a98357d1a416935a5750cbf2980553644513102bf45dac1e524
        lib/paths.test.ts: 4786b00420e80ef17304f57e8e44a3ead0918edd37d050334267a2a7869ff9e2
        lib/paths.ts: a14afd19b1e330f64bebad580267c651464809377b00abcb555bcf0c489e1c5b
        lib/phase1-controller.test.ts: 6994035ad74027a19fd428aec4f1e60531e480cb13e7fdab32f972b2e50e2ae4
        lib/phase1-controller.ts: dbda83ed14bd87b327882a5aa425e5015c74d28042316c0792e15b9038dd77dd
        lib/phase1-lifecycle.property.test.ts: 9f1e47135522544f0b80e73805af2c629ad0af6d374f69c5ea8f22ae09cb9129
        lib/recall-entry.ts: f95094d09264906e083d76073b64d276af10caf4a69cbe7057bba0377b58f680
        lib/recall-projection.test.ts: fcd199d1ac107167871560ac6aad3a737a1be843ad1481c0bfb7b40f7aa1fff4
        lib/recall-projection.ts: 34d0523d3a3aab93f69705c7589d97d49f34ea6c5f9e1ada9045fdb4cea3a658
        lib/recall.test.ts: e90896852ccf2c1ca4d1d853238d3095fcad2f04f5f40352a9d7ad936f86d7a3
        lib/recall.ts: b87ca426ef87f0945f517218182d5473cfd65444e3e4eacacdaf685ef431491f
        lib/resumption-fidelity.test.ts: 955e8b60828aac8a91c8804a607608135e700e1a518a04af2c62fcdb0eec2846
        lib/runtime-probe.ts: 5a384c1d5f730ff6c62714b10ecda71090aaee19b7c8f1bba144d74a030b1f77
        lib/sdk.ts: 81ef935bdfe4a6daa8cda7cf585a7c7f0295a644fbb709fc38cef03906768937
        lib/session-evaluator.test.ts: cdcb0cb4b9b3c15899433ed4836984a84558f3a9bd78e4e940b193f6fdbb81cc
        lib/session-evaluator.ts: a4e0d0ab76bf3672f149e64b936e9c593a51165a1581616178d7cfc4897d0722
        lib/settings.test.ts: 871e2332afca88f92ecf31a9fc84bfdbe9e099aced6d9c97ec0702eb1fd7f309
        lib/settings.ts: 0017d98b0668145b586eb20ac42d96ecc089210e73711bac0002892fa98a7a7f
        lib/sha256.test.ts: 9131960dae17083192659dd10196b4fb83a998b70d4bed88d3073acab41fe85b
        lib/sha256.ts: 523f5efaa3ac2982f8f833240cb002351b52721420c48309a34f05f5b07dd125
        lib/store.test.ts: 856fbd303337d059314b858aaf5004a39198b92d49f35efe17d0a2612c53d3e1
        lib/store.ts: 3a8d1f9db3e38a66e33fdc365a03d5aa0e38761d45815595c16c45176bd97b37
        lib/strategy.test.ts: e549e307fb40eea44731981eafd5ed08d39dbce392f938d7f38ce44845bd662d
        lib/strategy.ts: 65a116cd0ae9d72c61afaed2b49947f4e6d8351f522446dc6f17f974b53e2b36
        lib/tool-result.test.ts: 85e238dadf1beea81baccc3361fffb96ca6a1ac6a101213c6f98e42f36dc3f76
        lib/tool-result.ts: 6cecb489009b8f7406b18ced9a0a6f2a19757c9a0efc020e197ee53c115bfd11
        lib/trigger.test.ts: a7b74a128989c66951d1e567fda7a19d6e32af1bf56a8e0722e5430cd894b658
        lib/trigger.ts: 5fa705fc16a31dcd2fedc703a7fb8ef1ad5069b60618aa4a1018d9f4ec31c206
        lib/tui-block.test.ts: ee25d80023627b5c63fadd15aa8978135e09006b0962f74fa2dacb6b410a1de1
        lib/tui-block.ts: 2c7200875c91b2cadf05d6ca88b7d7748f1f249c42b68937852f674ed50cea7c
        lib/types.ts: aade627b2f2683de80a138cc81ae59a71d25e4151e953b0fdf8040a3aa08809f
        lib/unicode.test.ts: 9f4b8ad3dea9b38f3e373575cf29e07898564e55be88627eb9b571deda013521
        lib/unicode.ts: 2a1a14f6c87a12f5acc1ef0ed8b10f3e30912f6344d46d1928f2a3a1434ca123
        lib/wire-format.ts: b149adac61adfc596173474e33d432cd93263e81a90608c70af755f44df2f9fa
        package.json: c59b7f5e269b4cb79288f9a880a2408dde2082b5b2b76e162a6e8f2b2b47a681
        scripts/benchmark-compiler.ts: 9e2bc7e815c273621e7312b3e54b8ddff0897180c444dbd08b016a87c7075f1a
        scripts/check-architecture.ts: abfedfb9a1fe62f32dac370a9579f14f4010e4dc78ba93c2cb33ba5d85697480
        scripts/evaluate-selector.ts: 59f6eeada8b20f3d7893f87f15d32ec4b87e07c1585e7c9af94b332f532b8c37
        tests/compare-session.ts: eecb3847c156685dc634be07033a55b41b44f385f1e8723ae8d59d8ea1562792
        tests/e2e/current-compaction.test.ts: 9efd50ccfa00f3645e076a4614ae5ea480320eb92c4c74e36ae1caf516cd95a9
        tests/e2e/harness/compaction-barrier.ts: c303a0bcde5d55b521570a5e06c0beaf86a1f47f81ac457ec77f7a4bb97db58e
        tests/e2e/harness/current-compaction.ts: 30009cbf2bd0bf92579480ba06acba76db7415839d38dea61aa50861f137b8bf
        tests/e2e/harness/env.ts: 80d510793aee4cc973e8dd59110a5b5871deea0a53fd26b93962325e94b06b99
        tests/e2e/harness/fake-provider.ts: 660fcff8b643a9bc3e749bb912acacd0384bdae41389ab7e2d2b5f405c8aa7f1
        tests/e2e/harness/preparation-fault.ts: 1d2e977db7ca4f80cedcc6452414e700113a5d870ee9f480c7c7c33dd9fbb15d
        tests/e2e/harness/rpc-client.ts: 42525b4925d12d0cebdeb92b5cab758369975f0e7e6a70eb10b4028bb07c3b31
        tests/e2e/interception.e2e.ts: b2cefbc64ab9d5b5213dbd9398eb09612945729565038e1a4ee3ebf6168e3a90
        tests/fixtures/parser-session.jsonl: 50575fa33d879ec0e2ce4b1455545dd2836f12d37f54f4a6e731794b387c40e7
        tests/harness/fake-pi.ts: 471929329a9da287771609a65655e393b95eed3f9b8c07a8799dc12d48d1caf6
        tests/harness/preparation-fixture.ts: ec8bf72df94a9f82c24d719df8f10ccea9db3eb814a6654f1fa3514979ffedae
        tests/verify-improvement.test.ts: a9a5f39929a9c12274c448bfb574fbbc92e9c28df4ae3736876be3608019e433
        tsconfig.json: 08529066dec16388122122f2582069e400770a8587711b912794e10896615b0f
      at: 2026-10-05T23:42:33.212Z
  - kind: checkpoint
    checkpoint_id: current-compaction-TG1
    operation_id: current-compaction-TG1
    operation_kind: gate
    gate: TG1
    phase: reconciled
    task: T1
    contract_digest: 5ca4752235ecf4aab1ed380d9723e19319ae181d8eba7a5ae8361c1dcaefb878
    before:
      digest: 59944bc3a0eeaed5c656cc2c93401cddac02a6b830a74db949fc48045c74332c
      entries:
        .dependency-cruiser.cjs: f90d4b8c206440cc7006c105126ddb091a8ae57bc1a8225b49b54e63b0356edf
        .gitignore: 8f21e3b9b123ffa75121a0ae451782c432407acc21cc784d8fc095cd3e8c3cf7
        AGENTS.md: af56ae1e888439e976f2eac7ecf8c447ff2f73f99bba3b8900dcdf1add2b4286
        CLAUDE.md: symlink:AGENTS.md
        LICENSE: e2e52298290bec0f61398b5684006a59f0d8e2a7374e7f4cd134d5c36b660a47
        README.md: 4dae887df73702ccaf751e5683a42c298a59ecb1dee9251f5c4072ca4bb62e2f
        bin/dc-distill-session.ts: 15d9306ff37153205e88eda1baab634e341e2a25e6c9da5ca409f6762192524f
        bun.lock: 997ed36d6a2500f0e8ab160da30dd689f3c12e885e42933fe03e8aa7746e61eb
        debug/checkpoint-gate.ts: 6ac8afb9d7315db48851f95a64237676fe45cff3afe6b3fc62798f32d0076f6f
        debug/live-repro.ts: df3cd57568e1b68ccf2b21bd8d4acbf0802779d916e56b8de1a59a01ae69c3ad
        docs-contract.test.ts: e176e2eed18179cc551e295bae31f58c8730aa1e26321fce22c5b266f03fbaae
        docs/adr/0001-vendored-framework-boundary.md: 1388e4baba3d47fc433924c9807239fe50c596b57f318675c42b667b38c7329a
        docs/adr/0002-remove-vendored-framework.md: 2fbfc6def5635e9bfc1c5d2359ad779954c6f39dbebbd2bdf9417c93bd06d634
        docs/algorithm.md: 996beaaa59f3813f03b075ae2168120f2b47a133a695da75a457f93bc94c6d02
        docs/architecture.md: acf03df39fbb9e7a230a14cfba7ac3853c56a68bf3a45851ddb9c0ac2f1eb0ee
        docs/assets/distill-before-after.svg: 80ab3aa5b4f4bf2032daed7f08ecf25ffea586c5b733fa87163367964b8c0b50
        docs/compiler-benchmark.md: 0c9735e4a0f38cfe1f04ba955e103af19de7bc7fffc8506f03cf08f5e42380e4
        docs/releasing.md: a46134cd81e46690b0d0a5003c82c28d676fcd038fc25c5545a1cb0e2f832f3f
        docs/settings.md: fb6ff8195aea5e7198c58978b2ddd576bad291344283fbc3ef0ab0eb0f25e45a
        docs/troubleshooting.md: 118e91a571558a0d6aed99c7dfcafd592f31022faad6e5ad6b076c5a9c688b73
        docs/usage.md: a61aa7631a95fd2724ddba95933fbb9a5e951d7cf268957f5907a8ad459ffb3a
        index.phase1.test.ts: 113dcc79a51a216e0f23372a352992f55cf163b0e594982b5621d40285fa305e
        index.phase5.test.ts: 2bb02a7aab442d06941042d5088902dc29d24ca00bfde8f94a5868b9fc686020
        index.test.ts: b8697744329f12560b0205679a046046552d32477f498bf65767560a915ccbaf
        index.ts: 033710154492de4ed5d452aa4d07fa65c192cc3dde683dcb238c643952870bee
        index.v12.test.ts: 4b3bbd27accf76f6969a3e85401b6dd6884e234def14bc083437c91eabc59701
        lib/bm25.test.ts: 0fdcb41087f8fd5c62624088aae64b14f1cde65da45e1898cc85ca2038650b4c
        lib/bm25.ts: 00ec5ea25040b9fe88e0cd5538d5aa75aa1a6d5ea1b9fac3ecd491e905e08537
        lib/cache-runs.test.ts: 065effd0b1c7be678077d0137d498b87a38c2328a630473b86966ea8463e2be0
        lib/cache-runs.ts: e384ac5736b8f3803dc226f3483e9c01a7b725fb2839073b8cf66c6f0f21f421
        lib/checkpoint-update.test.ts: fe2480ef76ac8cfa716e5552f5c83e82155134d54e522c9ac692a986d6102285
        lib/checkpoint-update.ts: dbb4115a98e445149c4900922128248aa08177683525117a5581b7af8f892e22
        lib/compaction-card-dedupe.test.ts: 2af0cfcfa9c33744bd821fb435fbbcdeb9f3e5f3119f08d6ab7ad239d8638899
        lib/compaction-card-dedupe.ts: b15f9286e1715e9e47ce6ab04a5cef57260f541115c970507b36b950a7529e58
        lib/compaction-card.test.ts: 10efd22edb9e70155be542385f4f8e9b28a2085b6a30e87da22ef6491b37d060
        lib/compaction-card.ts: 3eba217ca318cce075ebe6d1f0776efa3c523f43a553406fe4e01af63f2a95db
        lib/compaction-source.test.ts: 7d043e9afa9ca2636996f9fff478e480e4254bfbe1742d21d0e7a5331541592f
        lib/compaction-source.ts: df5fac5b9a5853759ffc042c3c9d463dcef91ad746034cd6c52773b620267243
        lib/compile-session-file.ts: 37795fbc5054717b2aae8eff343079c68c12f6c8eb62189dc95c25fcef7a90b6
        lib/compiler/anchors.ts: da9d1e8fba8cbc84054f7b73f5bf85be7fe12692bc5f4624538cbdef370f953e
        lib/compiler/budget-formatter.test.ts: e2c2af5a4a041dc2b6c87c29b19f249db32a90e1476437d5407788399aaafa44
        lib/compiler/budget-formatter.ts: 23b876eee5619de92a327b6e9a8f7b3d46146021b0fccf91a1d6bbacd7002925
        lib/compiler/checkpoint-ladder.test.ts: f709202745e1807d7f14b3aea474c64d8008ef419b5586cc7b774eb2f54f95e9
        lib/compiler/checkpoint.test.ts: ff93c53ee31ea55563b7abccdb3108c70d510a7e3e1b6ca053256c82cef87974
        lib/compiler/checkpoint.ts: 65b409e1799e68e70a3440120d58e618fa4665f7a4b97970b30902a5c87951ed
        lib/compiler/conversation-reducer.phase4.test.ts: b9540ec821862376668d91c68faf166a01f68e2134f690275444f192beb0c25c
        lib/compiler/conversation-reducer.test.ts: 1ea56c0d5ffdac53c7ed5d1cc9c75050970e7cb4157af4618708ac6e63c5b7fb
        lib/compiler/conversation-reducer.ts: 57a3b7a08bf851137f6ea40e150f2f20be86f94d31469aaee1a2730efd5d0c1e
        lib/compiler/display-projection.test.ts: 310d7ff71b3603b5b6f736826ce9243136f918708362f2b7f67d6811e687cf9a
        lib/compiler/display-projection.ts: 27aedd88003afeb7d3b855ab88ec8f3783aae6efcbd4c926f70b1a44bbf23d65
        lib/compiler/errors.ts: bdb940fd1bb4b9b9e1958fddf23a774371794eaf6712123ca32e9a83957a18b7
        lib/compiler/evidence-lifetime.test.ts: 02349b64b03975289c8225f8a7e43769554e9303243b640dc46006f0c091050a
        lib/compiler/handoff-projection.test.ts: 0c1974fed453762934e057ce80ff7ee0cde2e62a1cb5ac231cf46bfba20fdf83
        lib/compiler/helpers.ts: 614594b7678e483bffd86ac664dc7a097bbbfdac4c28eb5f2d60c998fe09aaad
        lib/compiler/lexical-budget.ts: 7661f2775b25a75986b1fc539bed0efa544067573828a904ec681d8108e4f87b
        lib/compiler/normalizer.test.ts: 691742bcbcb087ddf5e83fd11ca85dfd884db94c58046ab463ee9aa1edf00491
        lib/compiler/normalizer.ts: 9dee1d55a09adbc6a36380701324cb92412988b9b50418211a755e9d43694f85
        lib/compiler/observed-readiness.test.ts: 371717edf02d8cbe08429c7ddc2f00a37d036610722c9e3971c4833a2b4bfb62
        lib/compiler/observed-readiness.ts: a61fe1797add41cbb1d0206fad44d414010b56d446787210acc0d44ec9bcc8f8
        lib/compiler/optional-selector.test.ts: 60e1de16a0af3c530b45fd626ef802058e04c664bbd8d831dafbe9ea3398210f
        lib/compiler/optional-selector.ts: 3028a31bb5e4f628eb762900374fad5d07267c70108f845b612dfea40bdd7061
        lib/compiler/path-roots.ts: 8b1771d0dac7e04f23e2076a681caa9f986e22ce6a8c91d36072fa7356c1ffa7
        lib/compiler/protected-overflow-regression.test.ts: a68ab7a94a586c576561f2a847b1b26dec78eb35f5c6f8b6a4231224ff16f672
        lib/compiler/request-candidate.test.ts: 756fb4d777d3aa1bc1a364352e8864a18d9db86514e2df784e631b173b0c935d
        lib/compiler/request-candidate.ts: 3b84f9386e7fc9beb299d7f46b6bbd74a91086b9cbac81ad056e6bc245067b1f
        lib/compiler/resume-index.test.ts: 27dd32d78a1e2ea88ee1278884c6e021407847587b44d16a368abf8c2a73599d
        lib/compiler/resume-index.ts: 0bb0fe3b835054b391858f13d5a4690f33ea505cc9e41ceb4d405a8ed9b81ed7
        lib/compiler/resume-plan.phase4.test.ts: 794b0955940d9831dc022059c0ec10c4e687353b967c5246559c922e851d76f7
        lib/compiler/section-scanner.test.ts: 54c9bde4ac6d8fd50363b1071c51f2714e7e6bbb9187abc2e13b63fcc97ee3d0
        lib/compiler/section-scanner.ts: 3f548fd9c41b115fd2620b2aa4ba571a0401a1fba4a88d49d26d1de2e82d9632
        lib/compiler/shell-analysis.test.ts: d76439d9ab2b1d4ae97392ea31659d999b60fc15993d4b262701ec6f7f3f8986
        lib/compiler/shell-analysis.ts: a44b9996d16b88122f2e287ec5ffafc2fbb211df308abe58d3551eda1e03696b
        lib/compiler/structural-v12.test.ts: a90f578c3bf6514c7c4f2ad5d3fd1cd08f1e2f2e91c7af6ad2b305d8124ba056
        lib/compiler/tool-effects-v12.test.ts: 398b4c9e476ede216ffd78d5ff4cd6bacce6c349f87c49bc181f81b5d8f14ddf
        lib/compiler/tool-effects.ts: 08462f0d2b52fa1d8a5a22115797759fd9d6f250ce9c0675061f3ed8ce3da526
        lib/compiler/tool-tracker.ts: 0f119a507a50361631f035e619db1e9dc77404b4a4d4fd636aa3885beef3ff17
        lib/compiler/types.ts: e039000df576be98758b4870f4d65644cdeca20a84a6e0f558d26e93c69910c4
        lib/compiler/verification-display.test.ts: 6e265a6f14bf320f322e5fa7db649c192f9702a1f20cafba811d8953b2e2cbea
        lib/compiler/verification-display.ts: c698e75804e37b1f5ce0f62602a139de10260cf3485d7436105bb037c6c46fc3
        lib/compiler/verification-observation.test.ts: 3110b011fb28a269ec045fb0ae63bb4e291f5fc090c7c20b00afcd65c3cb5276
        lib/compiler/verification-observation.ts: 0a50e89b868dc4522de0dbe57b695639a29c0dd7e257166f03d9364b12c1f536
        lib/continuation-recovery.test.ts: f87d36a7a646662da521da318260e73ba9ad1f853f1a207c1f1543727f1207ba
        lib/continuation-recovery.ts: 66645435aeb9fd3d53b209f6c96f39bd77c2c3103ba8f98d2b6966c6a2daa9aa
        lib/continuation.test.ts: 003c96689f72271a960ed65ce82a669fa830a92cca5f2c1a8813b789c7dffff0
        lib/continuation.ts: aeede077ece2b51e6698b3abcee9b04bbbb1d4ae8e41119e4bfdc3108b2d018b
        lib/data-migration.test.ts: 8674f7c68408e5e17416ce0f154ca10a8ea9f923a0d0a9ed6c145a70860bf478
        lib/data-migration.ts: f10e00e99a4ca076b3d82f97e2e9ecf6db4decc67ed8321179239407a789b51a
        lib/diag-support.test.ts: 8d1f675a3bf67a05cd11f313f2d19e594b0eb8caee75ccb725292428bbead9f8
        lib/diag-support.ts: 8bcc298e70155870262b32c124725b93890a1a75f57846ab5dc2f8b823851b81
        lib/entries-support.test.ts: 8220f20b7b83995db64a0961f2415319c7393613e3859903beb5203750c38f2c
        lib/entries-support.ts: a3f88f00943f790b5e3820c6b6e300cb7342561e1dbdab8d2a2feea57e867668
        lib/events-support.test.ts: 435dfd11eaf4a24104155c05d608fb7bf4652afc6886b63df42ff783e75e58bc
        lib/events-support.ts: 38d9a5228b96e4ce1a0fdda0ed437bb6bc8a5ff9ebece5f30544d2711b5502ac
        lib/extract-tags.ts: 9a31d5165d48710bd108118cc8d9c6f5a3351c1ba7b7533d1aaa455407c871a4
        lib/focus-echo.test.ts: 828d33fda65680a92af4d39e78886021eadc50e75b50345c858a5a829889ea07
        lib/focus-echo.ts: 2b2caa30257e4914a4b8c104d33b9f137cc5e6aa30719d8234be58c54404d551
        lib/fs-support.test.ts: 798d5b2d6ff1d667e1817d7e15f46a1386521e825e8735dea85552d43569c7e7
        lib/fs-support.ts: 781773b23e0dcca774b32b9d72a7384366aa32e72cb284aad70cdc0f4a9f638d
        lib/handoff.test.ts: 126b67aad40e34474560e3e11716b912f0a73a33dcd3babb6c55c959e56ee701
        lib/handoff.ts: 2a31c02abaad242fb1a8b37fb9a735902a9061dd77ba137177bf65b8f4e83aeb
        lib/json-object-keys.ts: 29506e7775909619e67bf2fd6a3174a0805140671fdd3caf8ee4545d3e6bd3ab
        lib/legacy-compat.test.ts: d65e8055b25a5d97f0b7c86ce96c7ffa3d71d52df5f36e8ed4ea12b040bad3ba
        lib/legacy.ts: 880a2c0b83050dfbb8bf31eee8d9cd628763017b7f8fa8502cf5faba55f681b1
        lib/local-compact.test.ts: d85835d8e8ed9898fb6d0001a670ec848f386d6fd9cbb21a2404724aa2e9ba8b
        lib/local-compact.ts: f30644758346df1b4551bb1de172fc65bf851e87be3c0b9ef018ade3cee05a3a
        lib/metric.test.ts: e8cfe49b5b87d67ff79e7a98691dbd88bc8334f62e41425ce3fddd078418d7ea
        lib/metric.ts: 4c2682b5858bf6f41e92bb9bf80463146813e16eb7f39fd700ed9088f030837b
        lib/monitor.test.ts: 1eeb119cbacb00b37afd7a883c016f9e8934342435a231a6b8911cb58087ccc8
        lib/monitor.ts: 5d832f113026968a03afc4f0e39560d19dd36c351f446b13293af7ad15583eb9
        lib/notify-support.test.ts: 753e639c9e7af3da17fe04016257d2ea976edb9f88638c6fd20fb02ec2184aba
        lib/notify-support.ts: eef58b4cd5e39dc246df5ccecc8a1e3ccca323751ca48fccd87f49947872e88d
        lib/offline/checkpoint-corpus.ts: 0a72f85ef6ae2bc816cfd73c4e4cf16da1773a308909e61cd127b8325483290b
        lib/offline/checkpoint-evaluator.test.ts: f69e4f8e24fccd35e9b2c19df43a012a2ae5764397ec83c2d4c0d3848d331846
        lib/offline/checkpoint-evaluator.ts: eac6b3aa8c45efbfd98717e93d20be5e684f9d539b82c28c3ee4681af9bb77df
        lib/offline/performance-gate.test.ts: 348a8b6d25b835e25ad1263f20da903cbfaeddc31539c107db05314420bccb46
        lib/offline/performance-gate.ts: fda5c8a2c1aaa6f1c167205bde70c8a0e8a3ddc78dd16deeec7c96e2955b1af4
        lib/offline/quality-corpus.ts: db57c6a8e3249ca3b22a9aaf4bdff41868b6c7a9bb52948d08575841c229dc96
        lib/offline/quality-evaluator.test.ts: b5229efda06630399d805b33dd9823d98bdfd3405146b6a7eaaeeba6f83e0ad6
        lib/offline/quality-evaluator.ts: 4b904d6a0cdb9ad4690d8377277fd292ffa42fbd850fa01e0477a3ac1f3ea4ac
        lib/offline/supplemental-corpus.ts: 67a6d152264a1175dc6dd56f74010058fd9b99b7111b4e6402dd93a8075748e2
        lib/offline/supplemental-evaluator.test.ts: a981d8f5a5f6a457aa7b0775b4b50662c16b5ad7e88f7447f1bd454edb9b7ecd
        lib/offline/supplemental-evaluator.ts: 39cdc53497afbb46a71a22ec7717c57bb05043c07960826d15ee5956cb3e3b5b
        lib/offline/survival-corpus.ts: ce740dd3eb31584b6efe97f538579ced28d4e68875347c75b429a645a82faa89
        lib/offline/survival-evaluator.test.ts: c47c76095dfe7c77c86b4c839d5fb3ee3adb06e0d36c7ae29683721af9a7dd72
        lib/offline/survival-evaluator.ts: a727b00c61468b695efe1cb4a1bced8dcd0be60b2f01052d284fcb19cdb0e233
        lib/output-compactor.test.ts: 819c399fce5cdc1639f0500bf15fe007774b7fba5dbc2d15d1880e7ca5bd13cb
        lib/output-compactor.ts: 9ebd68c1c7e82a98357d1a416935a5750cbf2980553644513102bf45dac1e524
        lib/paths.test.ts: 4786b00420e80ef17304f57e8e44a3ead0918edd37d050334267a2a7869ff9e2
        lib/paths.ts: a14afd19b1e330f64bebad580267c651464809377b00abcb555bcf0c489e1c5b
        lib/phase1-controller.test.ts: 6994035ad74027a19fd428aec4f1e60531e480cb13e7fdab32f972b2e50e2ae4
        lib/phase1-controller.ts: dbda83ed14bd87b327882a5aa425e5015c74d28042316c0792e15b9038dd77dd
        lib/phase1-lifecycle.property.test.ts: 9f1e47135522544f0b80e73805af2c629ad0af6d374f69c5ea8f22ae09cb9129
        lib/recall-entry.ts: f95094d09264906e083d76073b64d276af10caf4a69cbe7057bba0377b58f680
        lib/recall-projection.test.ts: fcd199d1ac107167871560ac6aad3a737a1be843ad1481c0bfb7b40f7aa1fff4
        lib/recall-projection.ts: 34d0523d3a3aab93f69705c7589d97d49f34ea6c5f9e1ada9045fdb4cea3a658
        lib/recall.test.ts: e90896852ccf2c1ca4d1d853238d3095fcad2f04f5f40352a9d7ad936f86d7a3
        lib/recall.ts: b87ca426ef87f0945f517218182d5473cfd65444e3e4eacacdaf685ef431491f
        lib/resumption-fidelity.test.ts: 955e8b60828aac8a91c8804a607608135e700e1a518a04af2c62fcdb0eec2846
        lib/runtime-probe.ts: 5a384c1d5f730ff6c62714b10ecda71090aaee19b7c8f1bba144d74a030b1f77
        lib/sdk.ts: 81ef935bdfe4a6daa8cda7cf585a7c7f0295a644fbb709fc38cef03906768937
        lib/session-evaluator.test.ts: cdcb0cb4b9b3c15899433ed4836984a84558f3a9bd78e4e940b193f6fdbb81cc
        lib/session-evaluator.ts: a4e0d0ab76bf3672f149e64b936e9c593a51165a1581616178d7cfc4897d0722
        lib/settings.test.ts: 871e2332afca88f92ecf31a9fc84bfdbe9e099aced6d9c97ec0702eb1fd7f309
        lib/settings.ts: 0017d98b0668145b586eb20ac42d96ecc089210e73711bac0002892fa98a7a7f
        lib/sha256.test.ts: 9131960dae17083192659dd10196b4fb83a998b70d4bed88d3073acab41fe85b
        lib/sha256.ts: 523f5efaa3ac2982f8f833240cb002351b52721420c48309a34f05f5b07dd125
        lib/store.test.ts: 856fbd303337d059314b858aaf5004a39198b92d49f35efe17d0a2612c53d3e1
        lib/store.ts: 3a8d1f9db3e38a66e33fdc365a03d5aa0e38761d45815595c16c45176bd97b37
        lib/strategy.test.ts: e549e307fb40eea44731981eafd5ed08d39dbce392f938d7f38ce44845bd662d
        lib/strategy.ts: 65a116cd0ae9d72c61afaed2b49947f4e6d8351f522446dc6f17f974b53e2b36
        lib/tool-result.test.ts: 85e238dadf1beea81baccc3361fffb96ca6a1ac6a101213c6f98e42f36dc3f76
        lib/tool-result.ts: 6cecb489009b8f7406b18ced9a0a6f2a19757c9a0efc020e197ee53c115bfd11
        lib/trigger.test.ts: a7b74a128989c66951d1e567fda7a19d6e32af1bf56a8e0722e5430cd894b658
        lib/trigger.ts: 5fa705fc16a31dcd2fedc703a7fb8ef1ad5069b60618aa4a1018d9f4ec31c206
        lib/tui-block.test.ts: ee25d80023627b5c63fadd15aa8978135e09006b0962f74fa2dacb6b410a1de1
        lib/tui-block.ts: 2c7200875c91b2cadf05d6ca88b7d7748f1f249c42b68937852f674ed50cea7c
        lib/types.ts: aade627b2f2683de80a138cc81ae59a71d25e4151e953b0fdf8040a3aa08809f
        lib/unicode.test.ts: 9f4b8ad3dea9b38f3e373575cf29e07898564e55be88627eb9b571deda013521
        lib/unicode.ts: 2a1a14f6c87a12f5acc1ef0ed8b10f3e30912f6344d46d1928f2a3a1434ca123
        lib/wire-format.ts: b149adac61adfc596173474e33d432cd93263e81a90608c70af755f44df2f9fa
        package.json: c59b7f5e269b4cb79288f9a880a2408dde2082b5b2b76e162a6e8f2b2b47a681
        scripts/benchmark-compiler.ts: 9e2bc7e815c273621e7312b3e54b8ddff0897180c444dbd08b016a87c7075f1a
        scripts/check-architecture.ts: abfedfb9a1fe62f32dac370a9579f14f4010e4dc78ba93c2cb33ba5d85697480
        scripts/evaluate-selector.ts: 59f6eeada8b20f3d7893f87f15d32ec4b87e07c1585e7c9af94b332f532b8c37
        tests/compare-session.ts: eecb3847c156685dc634be07033a55b41b44f385f1e8723ae8d59d8ea1562792
        tests/e2e/busy-compaction.e2e.ts: df742676f8b66743773a8eca41de6de06d6ca6dd0308f95ca41d7022ad21f937
        tests/e2e/harness/compaction-barrier.ts: c303a0bcde5d55b521570a5e06c0beaf86a1f47f81ac457ec77f7a4bb97db58e
        tests/e2e/harness/current-compaction.ts: 30009cbf2bd0bf92579480ba06acba76db7415839d38dea61aa50861f137b8bf
        tests/e2e/harness/env.ts: 80d510793aee4cc973e8dd59110a5b5871deea0a53fd26b93962325e94b06b99
        tests/e2e/harness/fake-provider.ts: 660fcff8b643a9bc3e749bb912acacd0384bdae41389ab7e2d2b5f405c8aa7f1
        tests/e2e/harness/preparation-fault.ts: 1d2e977db7ca4f80cedcc6452414e700113a5d870ee9f480c7c7c33dd9fbb15d
        tests/e2e/harness/rpc-client.ts: 42525b4925d12d0cebdeb92b5cab758369975f0e7e6a70eb10b4028bb07c3b31
        tests/e2e/interception.e2e.ts: b2cefbc64ab9d5b5213dbd9398eb09612945729565038e1a4ee3ebf6168e3a90
        tests/e2e/lifecycle.e2e.ts: 6468c3c34a2f5355d6a95c57350157ef8d34a0357121ed54ba9a8e82296a4fd7
        tests/fixtures/parser-session.jsonl: 50575fa33d879ec0e2ce4b1455545dd2836f12d37f54f4a6e731794b387c40e7
        tests/harness/fake-pi.ts: 471929329a9da287771609a65655e393b95eed3f9b8c07a8799dc12d48d1caf6
        tests/harness/preparation-fixture.ts: ec8bf72df94a9f82c24d719df8f10ccea9db3eb814a6654f1fa3514979ffedae
        tests/verify-improvement.test.ts: a9a5f39929a9c12274c448bfb574fbbc92e9c28df4ae3736876be3608019e433
        tsconfig.json: 08529066dec16388122122f2582069e400770a8587711b912794e10896615b0f
      at: 2026-10-05T23:38:00.758Z
    intended: run frozen gate TG1
    next_action: continue next frozen gate or diagnose failure
    after:
      digest: 59944bc3a0eeaed5c656cc2c93401cddac02a6b830a74db949fc48045c74332c
      entries:
        .dependency-cruiser.cjs: f90d4b8c206440cc7006c105126ddb091a8ae57bc1a8225b49b54e63b0356edf
        .gitignore: 8f21e3b9b123ffa75121a0ae451782c432407acc21cc784d8fc095cd3e8c3cf7
        AGENTS.md: af56ae1e888439e976f2eac7ecf8c447ff2f73f99bba3b8900dcdf1add2b4286
        CLAUDE.md: symlink:AGENTS.md
        LICENSE: e2e52298290bec0f61398b5684006a59f0d8e2a7374e7f4cd134d5c36b660a47
        README.md: 4dae887df73702ccaf751e5683a42c298a59ecb1dee9251f5c4072ca4bb62e2f
        bin/dc-distill-session.ts: 15d9306ff37153205e88eda1baab634e341e2a25e6c9da5ca409f6762192524f
        bun.lock: 997ed36d6a2500f0e8ab160da30dd689f3c12e885e42933fe03e8aa7746e61eb
        debug/checkpoint-gate.ts: 6ac8afb9d7315db48851f95a64237676fe45cff3afe6b3fc62798f32d0076f6f
        debug/live-repro.ts: df3cd57568e1b68ccf2b21bd8d4acbf0802779d916e56b8de1a59a01ae69c3ad
        docs-contract.test.ts: e176e2eed18179cc551e295bae31f58c8730aa1e26321fce22c5b266f03fbaae
        docs/adr/0001-vendored-framework-boundary.md: 1388e4baba3d47fc433924c9807239fe50c596b57f318675c42b667b38c7329a
        docs/adr/0002-remove-vendored-framework.md: 2fbfc6def5635e9bfc1c5d2359ad779954c6f39dbebbd2bdf9417c93bd06d634
        docs/algorithm.md: 996beaaa59f3813f03b075ae2168120f2b47a133a695da75a457f93bc94c6d02
        docs/architecture.md: acf03df39fbb9e7a230a14cfba7ac3853c56a68bf3a45851ddb9c0ac2f1eb0ee
        docs/assets/distill-before-after.svg: 80ab3aa5b4f4bf2032daed7f08ecf25ffea586c5b733fa87163367964b8c0b50
        docs/compiler-benchmark.md: 0c9735e4a0f38cfe1f04ba955e103af19de7bc7fffc8506f03cf08f5e42380e4
        docs/releasing.md: a46134cd81e46690b0d0a5003c82c28d676fcd038fc25c5545a1cb0e2f832f3f
        docs/settings.md: fb6ff8195aea5e7198c58978b2ddd576bad291344283fbc3ef0ab0eb0f25e45a
        docs/troubleshooting.md: 118e91a571558a0d6aed99c7dfcafd592f31022faad6e5ad6b076c5a9c688b73
        docs/usage.md: a61aa7631a95fd2724ddba95933fbb9a5e951d7cf268957f5907a8ad459ffb3a
        index.phase1.test.ts: 113dcc79a51a216e0f23372a352992f55cf163b0e594982b5621d40285fa305e
        index.phase5.test.ts: 2bb02a7aab442d06941042d5088902dc29d24ca00bfde8f94a5868b9fc686020
        index.test.ts: b8697744329f12560b0205679a046046552d32477f498bf65767560a915ccbaf
        index.ts: 033710154492de4ed5d452aa4d07fa65c192cc3dde683dcb238c643952870bee
        index.v12.test.ts: 4b3bbd27accf76f6969a3e85401b6dd6884e234def14bc083437c91eabc59701
        lib/bm25.test.ts: 0fdcb41087f8fd5c62624088aae64b14f1cde65da45e1898cc85ca2038650b4c
        lib/bm25.ts: 00ec5ea25040b9fe88e0cd5538d5aa75aa1a6d5ea1b9fac3ecd491e905e08537
        lib/cache-runs.test.ts: 065effd0b1c7be678077d0137d498b87a38c2328a630473b86966ea8463e2be0
        lib/cache-runs.ts: e384ac5736b8f3803dc226f3483e9c01a7b725fb2839073b8cf66c6f0f21f421
        lib/checkpoint-update.test.ts: fe2480ef76ac8cfa716e5552f5c83e82155134d54e522c9ac692a986d6102285
        lib/checkpoint-update.ts: dbb4115a98e445149c4900922128248aa08177683525117a5581b7af8f892e22
        lib/compaction-card-dedupe.test.ts: 2af0cfcfa9c33744bd821fb435fbbcdeb9f3e5f3119f08d6ab7ad239d8638899
        lib/compaction-card-dedupe.ts: b15f9286e1715e9e47ce6ab04a5cef57260f541115c970507b36b950a7529e58
        lib/compaction-card.test.ts: 10efd22edb9e70155be542385f4f8e9b28a2085b6a30e87da22ef6491b37d060
        lib/compaction-card.ts: 3eba217ca318cce075ebe6d1f0776efa3c523f43a553406fe4e01af63f2a95db
        lib/compaction-source.test.ts: 7d043e9afa9ca2636996f9fff478e480e4254bfbe1742d21d0e7a5331541592f
        lib/compaction-source.ts: df5fac5b9a5853759ffc042c3c9d463dcef91ad746034cd6c52773b620267243
        lib/compile-session-file.ts: 37795fbc5054717b2aae8eff343079c68c12f6c8eb62189dc95c25fcef7a90b6
        lib/compiler/anchors.ts: da9d1e8fba8cbc84054f7b73f5bf85be7fe12692bc5f4624538cbdef370f953e
        lib/compiler/budget-formatter.test.ts: e2c2af5a4a041dc2b6c87c29b19f249db32a90e1476437d5407788399aaafa44
        lib/compiler/budget-formatter.ts: 23b876eee5619de92a327b6e9a8f7b3d46146021b0fccf91a1d6bbacd7002925
        lib/compiler/checkpoint-ladder.test.ts: f709202745e1807d7f14b3aea474c64d8008ef419b5586cc7b774eb2f54f95e9
        lib/compiler/checkpoint.test.ts: ff93c53ee31ea55563b7abccdb3108c70d510a7e3e1b6ca053256c82cef87974
        lib/compiler/checkpoint.ts: 65b409e1799e68e70a3440120d58e618fa4665f7a4b97970b30902a5c87951ed
        lib/compiler/conversation-reducer.phase4.test.ts: b9540ec821862376668d91c68faf166a01f68e2134f690275444f192beb0c25c
        lib/compiler/conversation-reducer.test.ts: 1ea56c0d5ffdac53c7ed5d1cc9c75050970e7cb4157af4618708ac6e63c5b7fb
        lib/compiler/conversation-reducer.ts: 57a3b7a08bf851137f6ea40e150f2f20be86f94d31469aaee1a2730efd5d0c1e
        lib/compiler/display-projection.test.ts: 310d7ff71b3603b5b6f736826ce9243136f918708362f2b7f67d6811e687cf9a
        lib/compiler/display-projection.ts: 27aedd88003afeb7d3b855ab88ec8f3783aae6efcbd4c926f70b1a44bbf23d65
        lib/compiler/errors.ts: bdb940fd1bb4b9b9e1958fddf23a774371794eaf6712123ca32e9a83957a18b7
        lib/compiler/evidence-lifetime.test.ts: 02349b64b03975289c8225f8a7e43769554e9303243b640dc46006f0c091050a
        lib/compiler/handoff-projection.test.ts: 0c1974fed453762934e057ce80ff7ee0cde2e62a1cb5ac231cf46bfba20fdf83
        lib/compiler/helpers.ts: 614594b7678e483bffd86ac664dc7a097bbbfdac4c28eb5f2d60c998fe09aaad
        lib/compiler/lexical-budget.ts: 7661f2775b25a75986b1fc539bed0efa544067573828a904ec681d8108e4f87b
        lib/compiler/normalizer.test.ts: 691742bcbcb087ddf5e83fd11ca85dfd884db94c58046ab463ee9aa1edf00491
        lib/compiler/normalizer.ts: 9dee1d55a09adbc6a36380701324cb92412988b9b50418211a755e9d43694f85
        lib/compiler/observed-readiness.test.ts: 371717edf02d8cbe08429c7ddc2f00a37d036610722c9e3971c4833a2b4bfb62
        lib/compiler/observed-readiness.ts: a61fe1797add41cbb1d0206fad44d414010b56d446787210acc0d44ec9bcc8f8
        lib/compiler/optional-selector.test.ts: 60e1de16a0af3c530b45fd626ef802058e04c664bbd8d831dafbe9ea3398210f
        lib/compiler/optional-selector.ts: 3028a31bb5e4f628eb762900374fad5d07267c70108f845b612dfea40bdd7061
        lib/compiler/path-roots.ts: 8b1771d0dac7e04f23e2076a681caa9f986e22ce6a8c91d36072fa7356c1ffa7
        lib/compiler/protected-overflow-regression.test.ts: a68ab7a94a586c576561f2a847b1b26dec78eb35f5c6f8b6a4231224ff16f672
        lib/compiler/request-candidate.test.ts: 756fb4d777d3aa1bc1a364352e8864a18d9db86514e2df784e631b173b0c935d
        lib/compiler/request-candidate.ts: 3b84f9386e7fc9beb299d7f46b6bbd74a91086b9cbac81ad056e6bc245067b1f
        lib/compiler/resume-index.test.ts: 27dd32d78a1e2ea88ee1278884c6e021407847587b44d16a368abf8c2a73599d
        lib/compiler/resume-index.ts: 0bb0fe3b835054b391858f13d5a4690f33ea505cc9e41ceb4d405a8ed9b81ed7
        lib/compiler/resume-plan.phase4.test.ts: 794b0955940d9831dc022059c0ec10c4e687353b967c5246559c922e851d76f7
        lib/compiler/section-scanner.test.ts: 54c9bde4ac6d8fd50363b1071c51f2714e7e6bbb9187abc2e13b63fcc97ee3d0
        lib/compiler/section-scanner.ts: 3f548fd9c41b115fd2620b2aa4ba571a0401a1fba4a88d49d26d1de2e82d9632
        lib/compiler/shell-analysis.test.ts: d76439d9ab2b1d4ae97392ea31659d999b60fc15993d4b262701ec6f7f3f8986
        lib/compiler/shell-analysis.ts: a44b9996d16b88122f2e287ec5ffafc2fbb211df308abe58d3551eda1e03696b
        lib/compiler/structural-v12.test.ts: a90f578c3bf6514c7c4f2ad5d3fd1cd08f1e2f2e91c7af6ad2b305d8124ba056
        lib/compiler/tool-effects-v12.test.ts: 398b4c9e476ede216ffd78d5ff4cd6bacce6c349f87c49bc181f81b5d8f14ddf
        lib/compiler/tool-effects.ts: 08462f0d2b52fa1d8a5a22115797759fd9d6f250ce9c0675061f3ed8ce3da526
        lib/compiler/tool-tracker.ts: 0f119a507a50361631f035e619db1e9dc77404b4a4d4fd636aa3885beef3ff17
        lib/compiler/types.ts: e039000df576be98758b4870f4d65644cdeca20a84a6e0f558d26e93c69910c4
        lib/compiler/verification-display.test.ts: 6e265a6f14bf320f322e5fa7db649c192f9702a1f20cafba811d8953b2e2cbea
        lib/compiler/verification-display.ts: c698e75804e37b1f5ce0f62602a139de10260cf3485d7436105bb037c6c46fc3
        lib/compiler/verification-observation.test.ts: 3110b011fb28a269ec045fb0ae63bb4e291f5fc090c7c20b00afcd65c3cb5276
        lib/compiler/verification-observation.ts: 0a50e89b868dc4522de0dbe57b695639a29c0dd7e257166f03d9364b12c1f536
        lib/continuation-recovery.test.ts: f87d36a7a646662da521da318260e73ba9ad1f853f1a207c1f1543727f1207ba
        lib/continuation-recovery.ts: 66645435aeb9fd3d53b209f6c96f39bd77c2c3103ba8f98d2b6966c6a2daa9aa
        lib/continuation.test.ts: 003c96689f72271a960ed65ce82a669fa830a92cca5f2c1a8813b789c7dffff0
        lib/continuation.ts: aeede077ece2b51e6698b3abcee9b04bbbb1d4ae8e41119e4bfdc3108b2d018b
        lib/data-migration.test.ts: 8674f7c68408e5e17416ce0f154ca10a8ea9f923a0d0a9ed6c145a70860bf478
        lib/data-migration.ts: f10e00e99a4ca076b3d82f97e2e9ecf6db4decc67ed8321179239407a789b51a
        lib/diag-support.test.ts: 8d1f675a3bf67a05cd11f313f2d19e594b0eb8caee75ccb725292428bbead9f8
        lib/diag-support.ts: 8bcc298e70155870262b32c124725b93890a1a75f57846ab5dc2f8b823851b81
        lib/entries-support.test.ts: 8220f20b7b83995db64a0961f2415319c7393613e3859903beb5203750c38f2c
        lib/entries-support.ts: a3f88f00943f790b5e3820c6b6e300cb7342561e1dbdab8d2a2feea57e867668
        lib/events-support.test.ts: 435dfd11eaf4a24104155c05d608fb7bf4652afc6886b63df42ff783e75e58bc
        lib/events-support.ts: 38d9a5228b96e4ce1a0fdda0ed437bb6bc8a5ff9ebece5f30544d2711b5502ac
        lib/extract-tags.ts: 9a31d5165d48710bd108118cc8d9c6f5a3351c1ba7b7533d1aaa455407c871a4
        lib/focus-echo.test.ts: 828d33fda65680a92af4d39e78886021eadc50e75b50345c858a5a829889ea07
        lib/focus-echo.ts: 2b2caa30257e4914a4b8c104d33b9f137cc5e6aa30719d8234be58c54404d551
        lib/fs-support.test.ts: 798d5b2d6ff1d667e1817d7e15f46a1386521e825e8735dea85552d43569c7e7
        lib/fs-support.ts: 781773b23e0dcca774b32b9d72a7384366aa32e72cb284aad70cdc0f4a9f638d
        lib/handoff.test.ts: 126b67aad40e34474560e3e11716b912f0a73a33dcd3babb6c55c959e56ee701
        lib/handoff.ts: 2a31c02abaad242fb1a8b37fb9a735902a9061dd77ba137177bf65b8f4e83aeb
        lib/json-object-keys.ts: 29506e7775909619e67bf2fd6a3174a0805140671fdd3caf8ee4545d3e6bd3ab
        lib/legacy-compat.test.ts: d65e8055b25a5d97f0b7c86ce96c7ffa3d71d52df5f36e8ed4ea12b040bad3ba
        lib/legacy.ts: 880a2c0b83050dfbb8bf31eee8d9cd628763017b7f8fa8502cf5faba55f681b1
        lib/local-compact.test.ts: d85835d8e8ed9898fb6d0001a670ec848f386d6fd9cbb21a2404724aa2e9ba8b
        lib/local-compact.ts: f30644758346df1b4551bb1de172fc65bf851e87be3c0b9ef018ade3cee05a3a
        lib/metric.test.ts: e8cfe49b5b87d67ff79e7a98691dbd88bc8334f62e41425ce3fddd078418d7ea
        lib/metric.ts: 4c2682b5858bf6f41e92bb9bf80463146813e16eb7f39fd700ed9088f030837b
        lib/monitor.test.ts: 1eeb119cbacb00b37afd7a883c016f9e8934342435a231a6b8911cb58087ccc8
        lib/monitor.ts: 5d832f113026968a03afc4f0e39560d19dd36c351f446b13293af7ad15583eb9
        lib/notify-support.test.ts: 753e639c9e7af3da17fe04016257d2ea976edb9f88638c6fd20fb02ec2184aba
        lib/notify-support.ts: eef58b4cd5e39dc246df5ccecc8a1e3ccca323751ca48fccd87f49947872e88d
        lib/offline/checkpoint-corpus.ts: 0a72f85ef6ae2bc816cfd73c4e4cf16da1773a308909e61cd127b8325483290b
        lib/offline/checkpoint-evaluator.test.ts: f69e4f8e24fccd35e9b2c19df43a012a2ae5764397ec83c2d4c0d3848d331846
        lib/offline/checkpoint-evaluator.ts: eac6b3aa8c45efbfd98717e93d20be5e684f9d539b82c28c3ee4681af9bb77df
        lib/offline/performance-gate.test.ts: 348a8b6d25b835e25ad1263f20da903cbfaeddc31539c107db05314420bccb46
        lib/offline/performance-gate.ts: fda5c8a2c1aaa6f1c167205bde70c8a0e8a3ddc78dd16deeec7c96e2955b1af4
        lib/offline/quality-corpus.ts: db57c6a8e3249ca3b22a9aaf4bdff41868b6c7a9bb52948d08575841c229dc96
        lib/offline/quality-evaluator.test.ts: b5229efda06630399d805b33dd9823d98bdfd3405146b6a7eaaeeba6f83e0ad6
        lib/offline/quality-evaluator.ts: 4b904d6a0cdb9ad4690d8377277fd292ffa42fbd850fa01e0477a3ac1f3ea4ac
        lib/offline/supplemental-corpus.ts: 67a6d152264a1175dc6dd56f74010058fd9b99b7111b4e6402dd93a8075748e2
        lib/offline/supplemental-evaluator.test.ts: a981d8f5a5f6a457aa7b0775b4b50662c16b5ad7e88f7447f1bd454edb9b7ecd
        lib/offline/supplemental-evaluator.ts: 39cdc53497afbb46a71a22ec7717c57bb05043c07960826d15ee5956cb3e3b5b
        lib/offline/survival-corpus.ts: ce740dd3eb31584b6efe97f538579ced28d4e68875347c75b429a645a82faa89
        lib/offline/survival-evaluator.test.ts: c47c76095dfe7c77c86b4c839d5fb3ee3adb06e0d36c7ae29683721af9a7dd72
        lib/offline/survival-evaluator.ts: a727b00c61468b695efe1cb4a1bced8dcd0be60b2f01052d284fcb19cdb0e233
        lib/output-compactor.test.ts: 819c399fce5cdc1639f0500bf15fe007774b7fba5dbc2d15d1880e7ca5bd13cb
        lib/output-compactor.ts: 9ebd68c1c7e82a98357d1a416935a5750cbf2980553644513102bf45dac1e524
        lib/paths.test.ts: 4786b00420e80ef17304f57e8e44a3ead0918edd37d050334267a2a7869ff9e2
        lib/paths.ts: a14afd19b1e330f64bebad580267c651464809377b00abcb555bcf0c489e1c5b
        lib/phase1-controller.test.ts: 6994035ad74027a19fd428aec4f1e60531e480cb13e7fdab32f972b2e50e2ae4
        lib/phase1-controller.ts: dbda83ed14bd87b327882a5aa425e5015c74d28042316c0792e15b9038dd77dd
        lib/phase1-lifecycle.property.test.ts: 9f1e47135522544f0b80e73805af2c629ad0af6d374f69c5ea8f22ae09cb9129
        lib/recall-entry.ts: f95094d09264906e083d76073b64d276af10caf4a69cbe7057bba0377b58f680
        lib/recall-projection.test.ts: fcd199d1ac107167871560ac6aad3a737a1be843ad1481c0bfb7b40f7aa1fff4
        lib/recall-projection.ts: 34d0523d3a3aab93f69705c7589d97d49f34ea6c5f9e1ada9045fdb4cea3a658
        lib/recall.test.ts: e90896852ccf2c1ca4d1d853238d3095fcad2f04f5f40352a9d7ad936f86d7a3
        lib/recall.ts: b87ca426ef87f0945f517218182d5473cfd65444e3e4eacacdaf685ef431491f
        lib/resumption-fidelity.test.ts: 955e8b60828aac8a91c8804a607608135e700e1a518a04af2c62fcdb0eec2846
        lib/runtime-probe.ts: 5a384c1d5f730ff6c62714b10ecda71090aaee19b7c8f1bba144d74a030b1f77
        lib/sdk.ts: 81ef935bdfe4a6daa8cda7cf585a7c7f0295a644fbb709fc38cef03906768937
        lib/session-evaluator.test.ts: cdcb0cb4b9b3c15899433ed4836984a84558f3a9bd78e4e940b193f6fdbb81cc
        lib/session-evaluator.ts: a4e0d0ab76bf3672f149e64b936e9c593a51165a1581616178d7cfc4897d0722
        lib/settings.test.ts: 871e2332afca88f92ecf31a9fc84bfdbe9e099aced6d9c97ec0702eb1fd7f309
        lib/settings.ts: 0017d98b0668145b586eb20ac42d96ecc089210e73711bac0002892fa98a7a7f
        lib/sha256.test.ts: 9131960dae17083192659dd10196b4fb83a998b70d4bed88d3073acab41fe85b
        lib/sha256.ts: 523f5efaa3ac2982f8f833240cb002351b52721420c48309a34f05f5b07dd125
        lib/store.test.ts: 856fbd303337d059314b858aaf5004a39198b92d49f35efe17d0a2612c53d3e1
        lib/store.ts: 3a8d1f9db3e38a66e33fdc365a03d5aa0e38761d45815595c16c45176bd97b37
        lib/strategy.test.ts: e549e307fb40eea44731981eafd5ed08d39dbce392f938d7f38ce44845bd662d
        lib/strategy.ts: 65a116cd0ae9d72c61afaed2b49947f4e6d8351f522446dc6f17f974b53e2b36
        lib/tool-result.test.ts: 85e238dadf1beea81baccc3361fffb96ca6a1ac6a101213c6f98e42f36dc3f76
        lib/tool-result.ts: 6cecb489009b8f7406b18ced9a0a6f2a19757c9a0efc020e197ee53c115bfd11
        lib/trigger.test.ts: a7b74a128989c66951d1e567fda7a19d6e32af1bf56a8e0722e5430cd894b658
        lib/trigger.ts: 5fa705fc16a31dcd2fedc703a7fb8ef1ad5069b60618aa4a1018d9f4ec31c206
        lib/tui-block.test.ts: ee25d80023627b5c63fadd15aa8978135e09006b0962f74fa2dacb6b410a1de1
        lib/tui-block.ts: 2c7200875c91b2cadf05d6ca88b7d7748f1f249c42b68937852f674ed50cea7c
        lib/types.ts: aade627b2f2683de80a138cc81ae59a71d25e4151e953b0fdf8040a3aa08809f
        lib/unicode.test.ts: 9f4b8ad3dea9b38f3e373575cf29e07898564e55be88627eb9b571deda013521
        lib/unicode.ts: 2a1a14f6c87a12f5acc1ef0ed8b10f3e30912f6344d46d1928f2a3a1434ca123
        lib/wire-format.ts: b149adac61adfc596173474e33d432cd93263e81a90608c70af755f44df2f9fa
        package.json: c59b7f5e269b4cb79288f9a880a2408dde2082b5b2b76e162a6e8f2b2b47a681
        scripts/benchmark-compiler.ts: 9e2bc7e815c273621e7312b3e54b8ddff0897180c444dbd08b016a87c7075f1a
        scripts/check-architecture.ts: abfedfb9a1fe62f32dac370a9579f14f4010e4dc78ba93c2cb33ba5d85697480
        scripts/evaluate-selector.ts: 59f6eeada8b20f3d7893f87f15d32ec4b87e07c1585e7c9af94b332f532b8c37
        tests/compare-session.ts: eecb3847c156685dc634be07033a55b41b44f385f1e8723ae8d59d8ea1562792
        tests/e2e/busy-compaction.e2e.ts: df742676f8b66743773a8eca41de6de06d6ca6dd0308f95ca41d7022ad21f937
        tests/e2e/harness/compaction-barrier.ts: c303a0bcde5d55b521570a5e06c0beaf86a1f47f81ac457ec77f7a4bb97db58e
        tests/e2e/harness/current-compaction.ts: 30009cbf2bd0bf92579480ba06acba76db7415839d38dea61aa50861f137b8bf
        tests/e2e/harness/env.ts: 80d510793aee4cc973e8dd59110a5b5871deea0a53fd26b93962325e94b06b99
        tests/e2e/harness/fake-provider.ts: 660fcff8b643a9bc3e749bb912acacd0384bdae41389ab7e2d2b5f405c8aa7f1
        tests/e2e/harness/preparation-fault.ts: 1d2e977db7ca4f80cedcc6452414e700113a5d870ee9f480c7c7c33dd9fbb15d
        tests/e2e/harness/rpc-client.ts: 42525b4925d12d0cebdeb92b5cab758369975f0e7e6a70eb10b4028bb07c3b31
        tests/e2e/interception.e2e.ts: b2cefbc64ab9d5b5213dbd9398eb09612945729565038e1a4ee3ebf6168e3a90
        tests/e2e/lifecycle.e2e.ts: 6468c3c34a2f5355d6a95c57350157ef8d34a0357121ed54ba9a8e82296a4fd7
        tests/fixtures/parser-session.jsonl: 50575fa33d879ec0e2ce4b1455545dd2836f12d37f54f4a6e731794b387c40e7
        tests/harness/fake-pi.ts: 471929329a9da287771609a65655e393b95eed3f9b8c07a8799dc12d48d1caf6
        tests/harness/preparation-fixture.ts: ec8bf72df94a9f82c24d719df8f10ccea9db3eb814a6654f1fa3514979ffedae
        tests/verify-improvement.test.ts: a9a5f39929a9c12274c448bfb574fbbc92e9c28df4ae3736876be3608019e433
        tsconfig.json: 08529066dec16388122122f2582069e400770a8587711b912794e10896615b0f
      at: 2026-10-05T23:40:15.001Z
    result: passed
    evidence:
      gate: TG1
      command: sandbox=$(mktemp -d /tmp/dc-distill-v14-e2e.XXXXXX);
        PI_CODING_AGENT_DIR="$sandbox/agent"
        DISTILL_PI_PACKAGE="$PWD/node_modules/@earendil-works/pi-coding-agent"
        DISTILL_PI_EXPECT_VERSION=0.99.2 bun run distill:e2e
      working_directory: /Users/vampire/code/ts/pi-dc-distill
      exit: 0
      signal: null
      started: 2026-10-05T23:38:00.821Z
      ended: 2026-10-05T23:40:14.922Z
      log: /tmp/current-compaction-TG1.log
      output: >
        bun test v1.4.0 (34cbb9a40)

        Artifacts (manual):
        /tmp/dc-distill-v14-e2e.e4sbaL/agent/cache/dc-distill/e2e/run-pU7Ljz

        Artifacts (autonomous):
        /tmp/dc-distill-v14-e2e.e4sbaL/agent/cache/dc-distill/e2e/run-USmfdT

        Artifacts (restart):
        /tmp/dc-distill-v14-e2e.e4sbaL/agent/cache/dc-distill/e2e/run-oaImQH

        Artifacts (interception-threshold):
        /tmp/dc-distill-v14-e2e.e4sbaL/agent/cache/dc-distill/e2e/run-ZgcQoa

        Artifacts (interception-overflow):
        /tmp/dc-distill-v14-e2e.e4sbaL/agent/cache/dc-distill/e2e/run-vlKohJ

        Artifacts (interception-overflow-error-retry):
        /tmp/dc-distill-v14-e2e.e4sbaL/agent/cache/dc-distill/e2e/run-71376f

        Artifacts (preparation-previous-summary):
        /tmp/dc-distill-v14-e2e.e4sbaL/agent/cache/dc-distill/e2e/run-ECTL7W

        Artifacts (preparation-discarded-partition):
        /tmp/dc-distill-v14-e2e.e4sbaL/agent/cache/dc-distill/e2e/run-JeOiJ9

        Artifacts (preparation-unicode):
        /tmp/dc-distill-v14-e2e.e4sbaL/agent/cache/dc-distill/e2e/run-t6c1R7

        Artifacts (busy-compaction):
        /tmp/dc-distill-v14-e2e.e4sbaL/agent/cache/dc-distill/e2e/run-uznGYW

        $ bun test ./tests/e2e/lifecycle.e2e.ts ./tests/e2e/interception.e2e.ts
        ./tests/e2e/busy-compaction.e2e.ts


        tests/e2e/lifecycle.e2e.ts:

        (pass) dc-distill real-Pi lifecycle > A: manual /compact is
        deterministic, local, and continuation-free [1118.34ms]

        (pass) dc-distill real-Pi lifecycle > B: autonomous threshold compaction
        commits and delivers continuation once [122806.45ms]

        (pass) dc-distill real-Pi lifecycle > C: crash-truncated ledgers recover
        continuation delivery and nudge on restart [7380.75ms]


        tests/e2e/interception.e2e.ts:

        (pass) native threshold uses only dc-distill, without an LLM summary
        request [427.34ms]

        (pass) native overflow uses only dc-distill, without an LLM summary
        request [405.90ms]

        (pass) native overflow error retry uses only dc-distill, without an LLM
        summary request [375.04ms]

        (pass) preparation fault previous-summary cancels without default
        summarization or success artifacts [308.09ms]

        (pass) preparation fault discarded-partition cancels without default
        summarization or success artifacts [307.79ms]

        (pass) preparation fault unicode cancels without default summarization
        or success artifacts [301.81ms]


        tests/e2e/busy-compaction.e2e.ts:

        (pass) busy manual compaction aborts the turn, prepares without
        artifacts, and commits exactly once [395.25ms]

         10 pass
         0 fail
         222 expect() calls
        Ran 10 tests across 3 files. [134.08s]
      adoption: same exact gate command and unchanged entire input projection;
        demo/README are not inputs to RPC suite or assertion unit fixtures
    adopted_from:
      path: docs/specs/current-compaction-acceptance.md
      contract_digest: d8be38f244cafdfa9ded1fb6232ba8834550291d5beea92dc75e63a3315e685f
      operation_id: current-compaction-TG1
    adoption_observation:
      digest: 59944bc3a0eeaed5c656cc2c93401cddac02a6b830a74db949fc48045c74332c
      entries:
        .dependency-cruiser.cjs: f90d4b8c206440cc7006c105126ddb091a8ae57bc1a8225b49b54e63b0356edf
        .gitignore: 8f21e3b9b123ffa75121a0ae451782c432407acc21cc784d8fc095cd3e8c3cf7
        AGENTS.md: af56ae1e888439e976f2eac7ecf8c447ff2f73f99bba3b8900dcdf1add2b4286
        CLAUDE.md: symlink:AGENTS.md
        LICENSE: e2e52298290bec0f61398b5684006a59f0d8e2a7374e7f4cd134d5c36b660a47
        README.md: 4dae887df73702ccaf751e5683a42c298a59ecb1dee9251f5c4072ca4bb62e2f
        bin/dc-distill-session.ts: 15d9306ff37153205e88eda1baab634e341e2a25e6c9da5ca409f6762192524f
        bun.lock: 997ed36d6a2500f0e8ab160da30dd689f3c12e885e42933fe03e8aa7746e61eb
        debug/checkpoint-gate.ts: 6ac8afb9d7315db48851f95a64237676fe45cff3afe6b3fc62798f32d0076f6f
        debug/live-repro.ts: df3cd57568e1b68ccf2b21bd8d4acbf0802779d916e56b8de1a59a01ae69c3ad
        docs-contract.test.ts: e176e2eed18179cc551e295bae31f58c8730aa1e26321fce22c5b266f03fbaae
        docs/adr/0001-vendored-framework-boundary.md: 1388e4baba3d47fc433924c9807239fe50c596b57f318675c42b667b38c7329a
        docs/adr/0002-remove-vendored-framework.md: 2fbfc6def5635e9bfc1c5d2359ad779954c6f39dbebbd2bdf9417c93bd06d634
        docs/algorithm.md: 996beaaa59f3813f03b075ae2168120f2b47a133a695da75a457f93bc94c6d02
        docs/architecture.md: acf03df39fbb9e7a230a14cfba7ac3853c56a68bf3a45851ddb9c0ac2f1eb0ee
        docs/assets/distill-before-after.svg: 80ab3aa5b4f4bf2032daed7f08ecf25ffea586c5b733fa87163367964b8c0b50
        docs/compiler-benchmark.md: 0c9735e4a0f38cfe1f04ba955e103af19de7bc7fffc8506f03cf08f5e42380e4
        docs/releasing.md: a46134cd81e46690b0d0a5003c82c28d676fcd038fc25c5545a1cb0e2f832f3f
        docs/settings.md: fb6ff8195aea5e7198c58978b2ddd576bad291344283fbc3ef0ab0eb0f25e45a
        docs/troubleshooting.md: 118e91a571558a0d6aed99c7dfcafd592f31022faad6e5ad6b076c5a9c688b73
        docs/usage.md: a61aa7631a95fd2724ddba95933fbb9a5e951d7cf268957f5907a8ad459ffb3a
        index.phase1.test.ts: 113dcc79a51a216e0f23372a352992f55cf163b0e594982b5621d40285fa305e
        index.phase5.test.ts: 2bb02a7aab442d06941042d5088902dc29d24ca00bfde8f94a5868b9fc686020
        index.test.ts: b8697744329f12560b0205679a046046552d32477f498bf65767560a915ccbaf
        index.ts: 033710154492de4ed5d452aa4d07fa65c192cc3dde683dcb238c643952870bee
        index.v12.test.ts: 4b3bbd27accf76f6969a3e85401b6dd6884e234def14bc083437c91eabc59701
        lib/bm25.test.ts: 0fdcb41087f8fd5c62624088aae64b14f1cde65da45e1898cc85ca2038650b4c
        lib/bm25.ts: 00ec5ea25040b9fe88e0cd5538d5aa75aa1a6d5ea1b9fac3ecd491e905e08537
        lib/cache-runs.test.ts: 065effd0b1c7be678077d0137d498b87a38c2328a630473b86966ea8463e2be0
        lib/cache-runs.ts: e384ac5736b8f3803dc226f3483e9c01a7b725fb2839073b8cf66c6f0f21f421
        lib/checkpoint-update.test.ts: fe2480ef76ac8cfa716e5552f5c83e82155134d54e522c9ac692a986d6102285
        lib/checkpoint-update.ts: dbb4115a98e445149c4900922128248aa08177683525117a5581b7af8f892e22
        lib/compaction-card-dedupe.test.ts: 2af0cfcfa9c33744bd821fb435fbbcdeb9f3e5f3119f08d6ab7ad239d8638899
        lib/compaction-card-dedupe.ts: b15f9286e1715e9e47ce6ab04a5cef57260f541115c970507b36b950a7529e58
        lib/compaction-card.test.ts: 10efd22edb9e70155be542385f4f8e9b28a2085b6a30e87da22ef6491b37d060
        lib/compaction-card.ts: 3eba217ca318cce075ebe6d1f0776efa3c523f43a553406fe4e01af63f2a95db
        lib/compaction-source.test.ts: 7d043e9afa9ca2636996f9fff478e480e4254bfbe1742d21d0e7a5331541592f
        lib/compaction-source.ts: df5fac5b9a5853759ffc042c3c9d463dcef91ad746034cd6c52773b620267243
        lib/compile-session-file.ts: 37795fbc5054717b2aae8eff343079c68c12f6c8eb62189dc95c25fcef7a90b6
        lib/compiler/anchors.ts: da9d1e8fba8cbc84054f7b73f5bf85be7fe12692bc5f4624538cbdef370f953e
        lib/compiler/budget-formatter.test.ts: e2c2af5a4a041dc2b6c87c29b19f249db32a90e1476437d5407788399aaafa44
        lib/compiler/budget-formatter.ts: 23b876eee5619de92a327b6e9a8f7b3d46146021b0fccf91a1d6bbacd7002925
        lib/compiler/checkpoint-ladder.test.ts: f709202745e1807d7f14b3aea474c64d8008ef419b5586cc7b774eb2f54f95e9
        lib/compiler/checkpoint.test.ts: ff93c53ee31ea55563b7abccdb3108c70d510a7e3e1b6ca053256c82cef87974
        lib/compiler/checkpoint.ts: 65b409e1799e68e70a3440120d58e618fa4665f7a4b97970b30902a5c87951ed
        lib/compiler/conversation-reducer.phase4.test.ts: b9540ec821862376668d91c68faf166a01f68e2134f690275444f192beb0c25c
        lib/compiler/conversation-reducer.test.ts: 1ea56c0d5ffdac53c7ed5d1cc9c75050970e7cb4157af4618708ac6e63c5b7fb
        lib/compiler/conversation-reducer.ts: 57a3b7a08bf851137f6ea40e150f2f20be86f94d31469aaee1a2730efd5d0c1e
        lib/compiler/display-projection.test.ts: 310d7ff71b3603b5b6f736826ce9243136f918708362f2b7f67d6811e687cf9a
        lib/compiler/display-projection.ts: 27aedd88003afeb7d3b855ab88ec8f3783aae6efcbd4c926f70b1a44bbf23d65
        lib/compiler/errors.ts: bdb940fd1bb4b9b9e1958fddf23a774371794eaf6712123ca32e9a83957a18b7
        lib/compiler/evidence-lifetime.test.ts: 02349b64b03975289c8225f8a7e43769554e9303243b640dc46006f0c091050a
        lib/compiler/handoff-projection.test.ts: 0c1974fed453762934e057ce80ff7ee0cde2e62a1cb5ac231cf46bfba20fdf83
        lib/compiler/helpers.ts: 614594b7678e483bffd86ac664dc7a097bbbfdac4c28eb5f2d60c998fe09aaad
        lib/compiler/lexical-budget.ts: 7661f2775b25a75986b1fc539bed0efa544067573828a904ec681d8108e4f87b
        lib/compiler/normalizer.test.ts: 691742bcbcb087ddf5e83fd11ca85dfd884db94c58046ab463ee9aa1edf00491
        lib/compiler/normalizer.ts: 9dee1d55a09adbc6a36380701324cb92412988b9b50418211a755e9d43694f85
        lib/compiler/observed-readiness.test.ts: 371717edf02d8cbe08429c7ddc2f00a37d036610722c9e3971c4833a2b4bfb62
        lib/compiler/observed-readiness.ts: a61fe1797add41cbb1d0206fad44d414010b56d446787210acc0d44ec9bcc8f8
        lib/compiler/optional-selector.test.ts: 60e1de16a0af3c530b45fd626ef802058e04c664bbd8d831dafbe9ea3398210f
        lib/compiler/optional-selector.ts: 3028a31bb5e4f628eb762900374fad5d07267c70108f845b612dfea40bdd7061
        lib/compiler/path-roots.ts: 8b1771d0dac7e04f23e2076a681caa9f986e22ce6a8c91d36072fa7356c1ffa7
        lib/compiler/protected-overflow-regression.test.ts: a68ab7a94a586c576561f2a847b1b26dec78eb35f5c6f8b6a4231224ff16f672
        lib/compiler/request-candidate.test.ts: 756fb4d777d3aa1bc1a364352e8864a18d9db86514e2df784e631b173b0c935d
        lib/compiler/request-candidate.ts: 3b84f9386e7fc9beb299d7f46b6bbd74a91086b9cbac81ad056e6bc245067b1f
        lib/compiler/resume-index.test.ts: 27dd32d78a1e2ea88ee1278884c6e021407847587b44d16a368abf8c2a73599d
        lib/compiler/resume-index.ts: 0bb0fe3b835054b391858f13d5a4690f33ea505cc9e41ceb4d405a8ed9b81ed7
        lib/compiler/resume-plan.phase4.test.ts: 794b0955940d9831dc022059c0ec10c4e687353b967c5246559c922e851d76f7
        lib/compiler/section-scanner.test.ts: 54c9bde4ac6d8fd50363b1071c51f2714e7e6bbb9187abc2e13b63fcc97ee3d0
        lib/compiler/section-scanner.ts: 3f548fd9c41b115fd2620b2aa4ba571a0401a1fba4a88d49d26d1de2e82d9632
        lib/compiler/shell-analysis.test.ts: d76439d9ab2b1d4ae97392ea31659d999b60fc15993d4b262701ec6f7f3f8986
        lib/compiler/shell-analysis.ts: a44b9996d16b88122f2e287ec5ffafc2fbb211df308abe58d3551eda1e03696b
        lib/compiler/structural-v12.test.ts: a90f578c3bf6514c7c4f2ad5d3fd1cd08f1e2f2e91c7af6ad2b305d8124ba056
        lib/compiler/tool-effects-v12.test.ts: 398b4c9e476ede216ffd78d5ff4cd6bacce6c349f87c49bc181f81b5d8f14ddf
        lib/compiler/tool-effects.ts: 08462f0d2b52fa1d8a5a22115797759fd9d6f250ce9c0675061f3ed8ce3da526
        lib/compiler/tool-tracker.ts: 0f119a507a50361631f035e619db1e9dc77404b4a4d4fd636aa3885beef3ff17
        lib/compiler/types.ts: e039000df576be98758b4870f4d65644cdeca20a84a6e0f558d26e93c69910c4
        lib/compiler/verification-display.test.ts: 6e265a6f14bf320f322e5fa7db649c192f9702a1f20cafba811d8953b2e2cbea
        lib/compiler/verification-display.ts: c698e75804e37b1f5ce0f62602a139de10260cf3485d7436105bb037c6c46fc3
        lib/compiler/verification-observation.test.ts: 3110b011fb28a269ec045fb0ae63bb4e291f5fc090c7c20b00afcd65c3cb5276
        lib/compiler/verification-observation.ts: 0a50e89b868dc4522de0dbe57b695639a29c0dd7e257166f03d9364b12c1f536
        lib/continuation-recovery.test.ts: f87d36a7a646662da521da318260e73ba9ad1f853f1a207c1f1543727f1207ba
        lib/continuation-recovery.ts: 66645435aeb9fd3d53b209f6c96f39bd77c2c3103ba8f98d2b6966c6a2daa9aa
        lib/continuation.test.ts: 003c96689f72271a960ed65ce82a669fa830a92cca5f2c1a8813b789c7dffff0
        lib/continuation.ts: aeede077ece2b51e6698b3abcee9b04bbbb1d4ae8e41119e4bfdc3108b2d018b
        lib/data-migration.test.ts: 8674f7c68408e5e17416ce0f154ca10a8ea9f923a0d0a9ed6c145a70860bf478
        lib/data-migration.ts: f10e00e99a4ca076b3d82f97e2e9ecf6db4decc67ed8321179239407a789b51a
        lib/diag-support.test.ts: 8d1f675a3bf67a05cd11f313f2d19e594b0eb8caee75ccb725292428bbead9f8
        lib/diag-support.ts: 8bcc298e70155870262b32c124725b93890a1a75f57846ab5dc2f8b823851b81
        lib/entries-support.test.ts: 8220f20b7b83995db64a0961f2415319c7393613e3859903beb5203750c38f2c
        lib/entries-support.ts: a3f88f00943f790b5e3820c6b6e300cb7342561e1dbdab8d2a2feea57e867668
        lib/events-support.test.ts: 435dfd11eaf4a24104155c05d608fb7bf4652afc6886b63df42ff783e75e58bc
        lib/events-support.ts: 38d9a5228b96e4ce1a0fdda0ed437bb6bc8a5ff9ebece5f30544d2711b5502ac
        lib/extract-tags.ts: 9a31d5165d48710bd108118cc8d9c6f5a3351c1ba7b7533d1aaa455407c871a4
        lib/focus-echo.test.ts: 828d33fda65680a92af4d39e78886021eadc50e75b50345c858a5a829889ea07
        lib/focus-echo.ts: 2b2caa30257e4914a4b8c104d33b9f137cc5e6aa30719d8234be58c54404d551
        lib/fs-support.test.ts: 798d5b2d6ff1d667e1817d7e15f46a1386521e825e8735dea85552d43569c7e7
        lib/fs-support.ts: 781773b23e0dcca774b32b9d72a7384366aa32e72cb284aad70cdc0f4a9f638d
        lib/handoff.test.ts: 126b67aad40e34474560e3e11716b912f0a73a33dcd3babb6c55c959e56ee701
        lib/handoff.ts: 2a31c02abaad242fb1a8b37fb9a735902a9061dd77ba137177bf65b8f4e83aeb
        lib/json-object-keys.ts: 29506e7775909619e67bf2fd6a3174a0805140671fdd3caf8ee4545d3e6bd3ab
        lib/legacy-compat.test.ts: d65e8055b25a5d97f0b7c86ce96c7ffa3d71d52df5f36e8ed4ea12b040bad3ba
        lib/legacy.ts: 880a2c0b83050dfbb8bf31eee8d9cd628763017b7f8fa8502cf5faba55f681b1
        lib/local-compact.test.ts: d85835d8e8ed9898fb6d0001a670ec848f386d6fd9cbb21a2404724aa2e9ba8b
        lib/local-compact.ts: f30644758346df1b4551bb1de172fc65bf851e87be3c0b9ef018ade3cee05a3a
        lib/metric.test.ts: e8cfe49b5b87d67ff79e7a98691dbd88bc8334f62e41425ce3fddd078418d7ea
        lib/metric.ts: 4c2682b5858bf6f41e92bb9bf80463146813e16eb7f39fd700ed9088f030837b
        lib/monitor.test.ts: 1eeb119cbacb00b37afd7a883c016f9e8934342435a231a6b8911cb58087ccc8
        lib/monitor.ts: 5d832f113026968a03afc4f0e39560d19dd36c351f446b13293af7ad15583eb9
        lib/notify-support.test.ts: 753e639c9e7af3da17fe04016257d2ea976edb9f88638c6fd20fb02ec2184aba
        lib/notify-support.ts: eef58b4cd5e39dc246df5ccecc8a1e3ccca323751ca48fccd87f49947872e88d
        lib/offline/checkpoint-corpus.ts: 0a72f85ef6ae2bc816cfd73c4e4cf16da1773a308909e61cd127b8325483290b
        lib/offline/checkpoint-evaluator.test.ts: f69e4f8e24fccd35e9b2c19df43a012a2ae5764397ec83c2d4c0d3848d331846
        lib/offline/checkpoint-evaluator.ts: eac6b3aa8c45efbfd98717e93d20be5e684f9d539b82c28c3ee4681af9bb77df
        lib/offline/performance-gate.test.ts: 348a8b6d25b835e25ad1263f20da903cbfaeddc31539c107db05314420bccb46
        lib/offline/performance-gate.ts: fda5c8a2c1aaa6f1c167205bde70c8a0e8a3ddc78dd16deeec7c96e2955b1af4
        lib/offline/quality-corpus.ts: db57c6a8e3249ca3b22a9aaf4bdff41868b6c7a9bb52948d08575841c229dc96
        lib/offline/quality-evaluator.test.ts: b5229efda06630399d805b33dd9823d98bdfd3405146b6a7eaaeeba6f83e0ad6
        lib/offline/quality-evaluator.ts: 4b904d6a0cdb9ad4690d8377277fd292ffa42fbd850fa01e0477a3ac1f3ea4ac
        lib/offline/supplemental-corpus.ts: 67a6d152264a1175dc6dd56f74010058fd9b99b7111b4e6402dd93a8075748e2
        lib/offline/supplemental-evaluator.test.ts: a981d8f5a5f6a457aa7b0775b4b50662c16b5ad7e88f7447f1bd454edb9b7ecd
        lib/offline/supplemental-evaluator.ts: 39cdc53497afbb46a71a22ec7717c57bb05043c07960826d15ee5956cb3e3b5b
        lib/offline/survival-corpus.ts: ce740dd3eb31584b6efe97f538579ced28d4e68875347c75b429a645a82faa89
        lib/offline/survival-evaluator.test.ts: c47c76095dfe7c77c86b4c839d5fb3ee3adb06e0d36c7ae29683721af9a7dd72
        lib/offline/survival-evaluator.ts: a727b00c61468b695efe1cb4a1bced8dcd0be60b2f01052d284fcb19cdb0e233
        lib/output-compactor.test.ts: 819c399fce5cdc1639f0500bf15fe007774b7fba5dbc2d15d1880e7ca5bd13cb
        lib/output-compactor.ts: 9ebd68c1c7e82a98357d1a416935a5750cbf2980553644513102bf45dac1e524
        lib/paths.test.ts: 4786b00420e80ef17304f57e8e44a3ead0918edd37d050334267a2a7869ff9e2
        lib/paths.ts: a14afd19b1e330f64bebad580267c651464809377b00abcb555bcf0c489e1c5b
        lib/phase1-controller.test.ts: 6994035ad74027a19fd428aec4f1e60531e480cb13e7fdab32f972b2e50e2ae4
        lib/phase1-controller.ts: dbda83ed14bd87b327882a5aa425e5015c74d28042316c0792e15b9038dd77dd
        lib/phase1-lifecycle.property.test.ts: 9f1e47135522544f0b80e73805af2c629ad0af6d374f69c5ea8f22ae09cb9129
        lib/recall-entry.ts: f95094d09264906e083d76073b64d276af10caf4a69cbe7057bba0377b58f680
        lib/recall-projection.test.ts: fcd199d1ac107167871560ac6aad3a737a1be843ad1481c0bfb7b40f7aa1fff4
        lib/recall-projection.ts: 34d0523d3a3aab93f69705c7589d97d49f34ea6c5f9e1ada9045fdb4cea3a658
        lib/recall.test.ts: e90896852ccf2c1ca4d1d853238d3095fcad2f04f5f40352a9d7ad936f86d7a3
        lib/recall.ts: b87ca426ef87f0945f517218182d5473cfd65444e3e4eacacdaf685ef431491f
        lib/resumption-fidelity.test.ts: 955e8b60828aac8a91c8804a607608135e700e1a518a04af2c62fcdb0eec2846
        lib/runtime-probe.ts: 5a384c1d5f730ff6c62714b10ecda71090aaee19b7c8f1bba144d74a030b1f77
        lib/sdk.ts: 81ef935bdfe4a6daa8cda7cf585a7c7f0295a644fbb709fc38cef03906768937
        lib/session-evaluator.test.ts: cdcb0cb4b9b3c15899433ed4836984a84558f3a9bd78e4e940b193f6fdbb81cc
        lib/session-evaluator.ts: a4e0d0ab76bf3672f149e64b936e9c593a51165a1581616178d7cfc4897d0722
        lib/settings.test.ts: 871e2332afca88f92ecf31a9fc84bfdbe9e099aced6d9c97ec0702eb1fd7f309
        lib/settings.ts: 0017d98b0668145b586eb20ac42d96ecc089210e73711bac0002892fa98a7a7f
        lib/sha256.test.ts: 9131960dae17083192659dd10196b4fb83a998b70d4bed88d3073acab41fe85b
        lib/sha256.ts: 523f5efaa3ac2982f8f833240cb002351b52721420c48309a34f05f5b07dd125
        lib/store.test.ts: 856fbd303337d059314b858aaf5004a39198b92d49f35efe17d0a2612c53d3e1
        lib/store.ts: 3a8d1f9db3e38a66e33fdc365a03d5aa0e38761d45815595c16c45176bd97b37
        lib/strategy.test.ts: e549e307fb40eea44731981eafd5ed08d39dbce392f938d7f38ce44845bd662d
        lib/strategy.ts: 65a116cd0ae9d72c61afaed2b49947f4e6d8351f522446dc6f17f974b53e2b36
        lib/tool-result.test.ts: 85e238dadf1beea81baccc3361fffb96ca6a1ac6a101213c6f98e42f36dc3f76
        lib/tool-result.ts: 6cecb489009b8f7406b18ced9a0a6f2a19757c9a0efc020e197ee53c115bfd11
        lib/trigger.test.ts: a7b74a128989c66951d1e567fda7a19d6e32af1bf56a8e0722e5430cd894b658
        lib/trigger.ts: 5fa705fc16a31dcd2fedc703a7fb8ef1ad5069b60618aa4a1018d9f4ec31c206
        lib/tui-block.test.ts: ee25d80023627b5c63fadd15aa8978135e09006b0962f74fa2dacb6b410a1de1
        lib/tui-block.ts: 2c7200875c91b2cadf05d6ca88b7d7748f1f249c42b68937852f674ed50cea7c
        lib/types.ts: aade627b2f2683de80a138cc81ae59a71d25e4151e953b0fdf8040a3aa08809f
        lib/unicode.test.ts: 9f4b8ad3dea9b38f3e373575cf29e07898564e55be88627eb9b571deda013521
        lib/unicode.ts: 2a1a14f6c87a12f5acc1ef0ed8b10f3e30912f6344d46d1928f2a3a1434ca123
        lib/wire-format.ts: b149adac61adfc596173474e33d432cd93263e81a90608c70af755f44df2f9fa
        package.json: c59b7f5e269b4cb79288f9a880a2408dde2082b5b2b76e162a6e8f2b2b47a681
        scripts/benchmark-compiler.ts: 9e2bc7e815c273621e7312b3e54b8ddff0897180c444dbd08b016a87c7075f1a
        scripts/check-architecture.ts: abfedfb9a1fe62f32dac370a9579f14f4010e4dc78ba93c2cb33ba5d85697480
        scripts/evaluate-selector.ts: 59f6eeada8b20f3d7893f87f15d32ec4b87e07c1585e7c9af94b332f532b8c37
        tests/compare-session.ts: eecb3847c156685dc634be07033a55b41b44f385f1e8723ae8d59d8ea1562792
        tests/e2e/busy-compaction.e2e.ts: df742676f8b66743773a8eca41de6de06d6ca6dd0308f95ca41d7022ad21f937
        tests/e2e/harness/compaction-barrier.ts: c303a0bcde5d55b521570a5e06c0beaf86a1f47f81ac457ec77f7a4bb97db58e
        tests/e2e/harness/current-compaction.ts: 30009cbf2bd0bf92579480ba06acba76db7415839d38dea61aa50861f137b8bf
        tests/e2e/harness/env.ts: 80d510793aee4cc973e8dd59110a5b5871deea0a53fd26b93962325e94b06b99
        tests/e2e/harness/fake-provider.ts: 660fcff8b643a9bc3e749bb912acacd0384bdae41389ab7e2d2b5f405c8aa7f1
        tests/e2e/harness/preparation-fault.ts: 1d2e977db7ca4f80cedcc6452414e700113a5d870ee9f480c7c7c33dd9fbb15d
        tests/e2e/harness/rpc-client.ts: 42525b4925d12d0cebdeb92b5cab758369975f0e7e6a70eb10b4028bb07c3b31
        tests/e2e/interception.e2e.ts: b2cefbc64ab9d5b5213dbd9398eb09612945729565038e1a4ee3ebf6168e3a90
        tests/e2e/lifecycle.e2e.ts: 6468c3c34a2f5355d6a95c57350157ef8d34a0357121ed54ba9a8e82296a4fd7
        tests/fixtures/parser-session.jsonl: 50575fa33d879ec0e2ce4b1455545dd2836f12d37f54f4a6e731794b387c40e7
        tests/harness/fake-pi.ts: 471929329a9da287771609a65655e393b95eed3f9b8c07a8799dc12d48d1caf6
        tests/harness/preparation-fixture.ts: ec8bf72df94a9f82c24d719df8f10ccea9db3eb814a6654f1fa3514979ffedae
        tests/verify-improvement.test.ts: a9a5f39929a9c12274c448bfb574fbbc92e9c28df4ae3736876be3608019e433
        tsconfig.json: 08529066dec16388122122f2582069e400770a8587711b912794e10896615b0f
      at: 2026-10-05T23:42:33.221Z
  - kind: checkpoint
    checkpoint_id: current-compaction-T1-cooldown-fixture
    operation_id: current-compaction-T1-cooldown-fixture
    operation_kind: repair
    phase: dispatching
    task: T1
    gate: TG1
    contract_digest: 5ca4752235ecf4aab1ed380d9723e19319ae181d8eba7a5ae8361c1dcaefb878
    before:
      digest: 807d11e1146ee5e88a47ed0d8a46d80ae13e7b37c41066976e76057cc2044fa4
      entries:
        .dependency-cruiser.cjs: f90d4b8c206440cc7006c105126ddb091a8ae57bc1a8225b49b54e63b0356edf
        .gitignore: 8f21e3b9b123ffa75121a0ae451782c432407acc21cc784d8fc095cd3e8c3cf7
        AGENTS.md: af56ae1e888439e976f2eac7ecf8c447ff2f73f99bba3b8900dcdf1add2b4286
        CLAUDE.md: symlink:AGENTS.md
        LICENSE: e2e52298290bec0f61398b5684006a59f0d8e2a7374e7f4cd134d5c36b660a47
        README.md: 4dae887df73702ccaf751e5683a42c298a59ecb1dee9251f5c4072ca4bb62e2f
        bin/dc-distill-session.ts: 15d9306ff37153205e88eda1baab634e341e2a25e6c9da5ca409f6762192524f
        bun.lock: 997ed36d6a2500f0e8ab160da30dd689f3c12e885e42933fe03e8aa7746e61eb
        debug/checkpoint-gate.ts: 6ac8afb9d7315db48851f95a64237676fe45cff3afe6b3fc62798f32d0076f6f
        debug/live-repro.ts: df3cd57568e1b68ccf2b21bd8d4acbf0802779d916e56b8de1a59a01ae69c3ad
        docs-contract.test.ts: e176e2eed18179cc551e295bae31f58c8730aa1e26321fce22c5b266f03fbaae
        docs/adr/0001-vendored-framework-boundary.md: 1388e4baba3d47fc433924c9807239fe50c596b57f318675c42b667b38c7329a
        docs/adr/0002-remove-vendored-framework.md: 2fbfc6def5635e9bfc1c5d2359ad779954c6f39dbebbd2bdf9417c93bd06d634
        docs/algorithm.md: 996beaaa59f3813f03b075ae2168120f2b47a133a695da75a457f93bc94c6d02
        docs/architecture.md: acf03df39fbb9e7a230a14cfba7ac3853c56a68bf3a45851ddb9c0ac2f1eb0ee
        docs/assets/distill-before-after.svg: 80ab3aa5b4f4bf2032daed7f08ecf25ffea586c5b733fa87163367964b8c0b50
        docs/compiler-benchmark.md: 0c9735e4a0f38cfe1f04ba955e103af19de7bc7fffc8506f03cf08f5e42380e4
        docs/releasing.md: a46134cd81e46690b0d0a5003c82c28d676fcd038fc25c5545a1cb0e2f832f3f
        docs/settings.md: fb6ff8195aea5e7198c58978b2ddd576bad291344283fbc3ef0ab0eb0f25e45a
        docs/troubleshooting.md: 118e91a571558a0d6aed99c7dfcafd592f31022faad6e5ad6b076c5a9c688b73
        docs/usage.md: a61aa7631a95fd2724ddba95933fbb9a5e951d7cf268957f5907a8ad459ffb3a
        index.phase1.test.ts: 113dcc79a51a216e0f23372a352992f55cf163b0e594982b5621d40285fa305e
        index.phase5.test.ts: 2bb02a7aab442d06941042d5088902dc29d24ca00bfde8f94a5868b9fc686020
        index.test.ts: b8697744329f12560b0205679a046046552d32477f498bf65767560a915ccbaf
        index.ts: 033710154492de4ed5d452aa4d07fa65c192cc3dde683dcb238c643952870bee
        index.v12.test.ts: 4b3bbd27accf76f6969a3e85401b6dd6884e234def14bc083437c91eabc59701
        lib/bm25.test.ts: 0fdcb41087f8fd5c62624088aae64b14f1cde65da45e1898cc85ca2038650b4c
        lib/bm25.ts: 00ec5ea25040b9fe88e0cd5538d5aa75aa1a6d5ea1b9fac3ecd491e905e08537
        lib/cache-runs.test.ts: 065effd0b1c7be678077d0137d498b87a38c2328a630473b86966ea8463e2be0
        lib/cache-runs.ts: e384ac5736b8f3803dc226f3483e9c01a7b725fb2839073b8cf66c6f0f21f421
        lib/checkpoint-update.test.ts: fe2480ef76ac8cfa716e5552f5c83e82155134d54e522c9ac692a986d6102285
        lib/checkpoint-update.ts: dbb4115a98e445149c4900922128248aa08177683525117a5581b7af8f892e22
        lib/compaction-card-dedupe.test.ts: 2af0cfcfa9c33744bd821fb435fbbcdeb9f3e5f3119f08d6ab7ad239d8638899
        lib/compaction-card-dedupe.ts: b15f9286e1715e9e47ce6ab04a5cef57260f541115c970507b36b950a7529e58
        lib/compaction-card.test.ts: 10efd22edb9e70155be542385f4f8e9b28a2085b6a30e87da22ef6491b37d060
        lib/compaction-card.ts: 3eba217ca318cce075ebe6d1f0776efa3c523f43a553406fe4e01af63f2a95db
        lib/compaction-source.test.ts: 7d043e9afa9ca2636996f9fff478e480e4254bfbe1742d21d0e7a5331541592f
        lib/compaction-source.ts: df5fac5b9a5853759ffc042c3c9d463dcef91ad746034cd6c52773b620267243
        lib/compile-session-file.ts: 37795fbc5054717b2aae8eff343079c68c12f6c8eb62189dc95c25fcef7a90b6
        lib/compiler/anchors.ts: da9d1e8fba8cbc84054f7b73f5bf85be7fe12692bc5f4624538cbdef370f953e
        lib/compiler/budget-formatter.test.ts: e2c2af5a4a041dc2b6c87c29b19f249db32a90e1476437d5407788399aaafa44
        lib/compiler/budget-formatter.ts: 23b876eee5619de92a327b6e9a8f7b3d46146021b0fccf91a1d6bbacd7002925
        lib/compiler/checkpoint-ladder.test.ts: f709202745e1807d7f14b3aea474c64d8008ef419b5586cc7b774eb2f54f95e9
        lib/compiler/checkpoint.test.ts: ff93c53ee31ea55563b7abccdb3108c70d510a7e3e1b6ca053256c82cef87974
        lib/compiler/checkpoint.ts: 65b409e1799e68e70a3440120d58e618fa4665f7a4b97970b30902a5c87951ed
        lib/compiler/conversation-reducer.phase4.test.ts: b9540ec821862376668d91c68faf166a01f68e2134f690275444f192beb0c25c
        lib/compiler/conversation-reducer.test.ts: 1ea56c0d5ffdac53c7ed5d1cc9c75050970e7cb4157af4618708ac6e63c5b7fb
        lib/compiler/conversation-reducer.ts: 57a3b7a08bf851137f6ea40e150f2f20be86f94d31469aaee1a2730efd5d0c1e
        lib/compiler/display-projection.test.ts: 310d7ff71b3603b5b6f736826ce9243136f918708362f2b7f67d6811e687cf9a
        lib/compiler/display-projection.ts: 27aedd88003afeb7d3b855ab88ec8f3783aae6efcbd4c926f70b1a44bbf23d65
        lib/compiler/errors.ts: bdb940fd1bb4b9b9e1958fddf23a774371794eaf6712123ca32e9a83957a18b7
        lib/compiler/evidence-lifetime.test.ts: 02349b64b03975289c8225f8a7e43769554e9303243b640dc46006f0c091050a
        lib/compiler/handoff-projection.test.ts: 0c1974fed453762934e057ce80ff7ee0cde2e62a1cb5ac231cf46bfba20fdf83
        lib/compiler/helpers.ts: 614594b7678e483bffd86ac664dc7a097bbbfdac4c28eb5f2d60c998fe09aaad
        lib/compiler/lexical-budget.ts: 7661f2775b25a75986b1fc539bed0efa544067573828a904ec681d8108e4f87b
        lib/compiler/normalizer.test.ts: 691742bcbcb087ddf5e83fd11ca85dfd884db94c58046ab463ee9aa1edf00491
        lib/compiler/normalizer.ts: 9dee1d55a09adbc6a36380701324cb92412988b9b50418211a755e9d43694f85
        lib/compiler/observed-readiness.test.ts: 371717edf02d8cbe08429c7ddc2f00a37d036610722c9e3971c4833a2b4bfb62
        lib/compiler/observed-readiness.ts: a61fe1797add41cbb1d0206fad44d414010b56d446787210acc0d44ec9bcc8f8
        lib/compiler/optional-selector.test.ts: 60e1de16a0af3c530b45fd626ef802058e04c664bbd8d831dafbe9ea3398210f
        lib/compiler/optional-selector.ts: 3028a31bb5e4f628eb762900374fad5d07267c70108f845b612dfea40bdd7061
        lib/compiler/path-roots.ts: 8b1771d0dac7e04f23e2076a681caa9f986e22ce6a8c91d36072fa7356c1ffa7
        lib/compiler/protected-overflow-regression.test.ts: a68ab7a94a586c576561f2a847b1b26dec78eb35f5c6f8b6a4231224ff16f672
        lib/compiler/request-candidate.test.ts: 756fb4d777d3aa1bc1a364352e8864a18d9db86514e2df784e631b173b0c935d
        lib/compiler/request-candidate.ts: 3b84f9386e7fc9beb299d7f46b6bbd74a91086b9cbac81ad056e6bc245067b1f
        lib/compiler/resume-index.test.ts: 27dd32d78a1e2ea88ee1278884c6e021407847587b44d16a368abf8c2a73599d
        lib/compiler/resume-index.ts: 0bb0fe3b835054b391858f13d5a4690f33ea505cc9e41ceb4d405a8ed9b81ed7
        lib/compiler/resume-plan.phase4.test.ts: 794b0955940d9831dc022059c0ec10c4e687353b967c5246559c922e851d76f7
        lib/compiler/section-scanner.test.ts: 54c9bde4ac6d8fd50363b1071c51f2714e7e6bbb9187abc2e13b63fcc97ee3d0
        lib/compiler/section-scanner.ts: 3f548fd9c41b115fd2620b2aa4ba571a0401a1fba4a88d49d26d1de2e82d9632
        lib/compiler/shell-analysis.test.ts: d76439d9ab2b1d4ae97392ea31659d999b60fc15993d4b262701ec6f7f3f8986
        lib/compiler/shell-analysis.ts: a44b9996d16b88122f2e287ec5ffafc2fbb211df308abe58d3551eda1e03696b
        lib/compiler/structural-v12.test.ts: a90f578c3bf6514c7c4f2ad5d3fd1cd08f1e2f2e91c7af6ad2b305d8124ba056
        lib/compiler/tool-effects-v12.test.ts: 398b4c9e476ede216ffd78d5ff4cd6bacce6c349f87c49bc181f81b5d8f14ddf
        lib/compiler/tool-effects.ts: 08462f0d2b52fa1d8a5a22115797759fd9d6f250ce9c0675061f3ed8ce3da526
        lib/compiler/tool-tracker.ts: 0f119a507a50361631f035e619db1e9dc77404b4a4d4fd636aa3885beef3ff17
        lib/compiler/types.ts: e039000df576be98758b4870f4d65644cdeca20a84a6e0f558d26e93c69910c4
        lib/compiler/verification-display.test.ts: 6e265a6f14bf320f322e5fa7db649c192f9702a1f20cafba811d8953b2e2cbea
        lib/compiler/verification-display.ts: c698e75804e37b1f5ce0f62602a139de10260cf3485d7436105bb037c6c46fc3
        lib/compiler/verification-observation.test.ts: 3110b011fb28a269ec045fb0ae63bb4e291f5fc090c7c20b00afcd65c3cb5276
        lib/compiler/verification-observation.ts: 0a50e89b868dc4522de0dbe57b695639a29c0dd7e257166f03d9364b12c1f536
        lib/continuation-recovery.test.ts: f87d36a7a646662da521da318260e73ba9ad1f853f1a207c1f1543727f1207ba
        lib/continuation-recovery.ts: 66645435aeb9fd3d53b209f6c96f39bd77c2c3103ba8f98d2b6966c6a2daa9aa
        lib/continuation.test.ts: 003c96689f72271a960ed65ce82a669fa830a92cca5f2c1a8813b789c7dffff0
        lib/continuation.ts: aeede077ece2b51e6698b3abcee9b04bbbb1d4ae8e41119e4bfdc3108b2d018b
        lib/data-migration.test.ts: 8674f7c68408e5e17416ce0f154ca10a8ea9f923a0d0a9ed6c145a70860bf478
        lib/data-migration.ts: f10e00e99a4ca076b3d82f97e2e9ecf6db4decc67ed8321179239407a789b51a
        lib/diag-support.test.ts: 8d1f675a3bf67a05cd11f313f2d19e594b0eb8caee75ccb725292428bbead9f8
        lib/diag-support.ts: 8bcc298e70155870262b32c124725b93890a1a75f57846ab5dc2f8b823851b81
        lib/entries-support.test.ts: 8220f20b7b83995db64a0961f2415319c7393613e3859903beb5203750c38f2c
        lib/entries-support.ts: a3f88f00943f790b5e3820c6b6e300cb7342561e1dbdab8d2a2feea57e867668
        lib/events-support.test.ts: 435dfd11eaf4a24104155c05d608fb7bf4652afc6886b63df42ff783e75e58bc
        lib/events-support.ts: 38d9a5228b96e4ce1a0fdda0ed437bb6bc8a5ff9ebece5f30544d2711b5502ac
        lib/extract-tags.ts: 9a31d5165d48710bd108118cc8d9c6f5a3351c1ba7b7533d1aaa455407c871a4
        lib/focus-echo.test.ts: 828d33fda65680a92af4d39e78886021eadc50e75b50345c858a5a829889ea07
        lib/focus-echo.ts: 2b2caa30257e4914a4b8c104d33b9f137cc5e6aa30719d8234be58c54404d551
        lib/fs-support.test.ts: 798d5b2d6ff1d667e1817d7e15f46a1386521e825e8735dea85552d43569c7e7
        lib/fs-support.ts: 781773b23e0dcca774b32b9d72a7384366aa32e72cb284aad70cdc0f4a9f638d
        lib/handoff.test.ts: 126b67aad40e34474560e3e11716b912f0a73a33dcd3babb6c55c959e56ee701
        lib/handoff.ts: 2a31c02abaad242fb1a8b37fb9a735902a9061dd77ba137177bf65b8f4e83aeb
        lib/json-object-keys.ts: 29506e7775909619e67bf2fd6a3174a0805140671fdd3caf8ee4545d3e6bd3ab
        lib/legacy-compat.test.ts: d65e8055b25a5d97f0b7c86ce96c7ffa3d71d52df5f36e8ed4ea12b040bad3ba
        lib/legacy.ts: 880a2c0b83050dfbb8bf31eee8d9cd628763017b7f8fa8502cf5faba55f681b1
        lib/local-compact.test.ts: d85835d8e8ed9898fb6d0001a670ec848f386d6fd9cbb21a2404724aa2e9ba8b
        lib/local-compact.ts: f30644758346df1b4551bb1de172fc65bf851e87be3c0b9ef018ade3cee05a3a
        lib/metric.test.ts: e8cfe49b5b87d67ff79e7a98691dbd88bc8334f62e41425ce3fddd078418d7ea
        lib/metric.ts: 4c2682b5858bf6f41e92bb9bf80463146813e16eb7f39fd700ed9088f030837b
        lib/monitor.test.ts: 1eeb119cbacb00b37afd7a883c016f9e8934342435a231a6b8911cb58087ccc8
        lib/monitor.ts: 5d832f113026968a03afc4f0e39560d19dd36c351f446b13293af7ad15583eb9
        lib/notify-support.test.ts: 753e639c9e7af3da17fe04016257d2ea976edb9f88638c6fd20fb02ec2184aba
        lib/notify-support.ts: eef58b4cd5e39dc246df5ccecc8a1e3ccca323751ca48fccd87f49947872e88d
        lib/offline/checkpoint-corpus.ts: 0a72f85ef6ae2bc816cfd73c4e4cf16da1773a308909e61cd127b8325483290b
        lib/offline/checkpoint-evaluator.test.ts: f69e4f8e24fccd35e9b2c19df43a012a2ae5764397ec83c2d4c0d3848d331846
        lib/offline/checkpoint-evaluator.ts: eac6b3aa8c45efbfd98717e93d20be5e684f9d539b82c28c3ee4681af9bb77df
        lib/offline/performance-gate.test.ts: 348a8b6d25b835e25ad1263f20da903cbfaeddc31539c107db05314420bccb46
        lib/offline/performance-gate.ts: fda5c8a2c1aaa6f1c167205bde70c8a0e8a3ddc78dd16deeec7c96e2955b1af4
        lib/offline/quality-corpus.ts: db57c6a8e3249ca3b22a9aaf4bdff41868b6c7a9bb52948d08575841c229dc96
        lib/offline/quality-evaluator.test.ts: b5229efda06630399d805b33dd9823d98bdfd3405146b6a7eaaeeba6f83e0ad6
        lib/offline/quality-evaluator.ts: 4b904d6a0cdb9ad4690d8377277fd292ffa42fbd850fa01e0477a3ac1f3ea4ac
        lib/offline/supplemental-corpus.ts: 67a6d152264a1175dc6dd56f74010058fd9b99b7111b4e6402dd93a8075748e2
        lib/offline/supplemental-evaluator.test.ts: a981d8f5a5f6a457aa7b0775b4b50662c16b5ad7e88f7447f1bd454edb9b7ecd
        lib/offline/supplemental-evaluator.ts: 39cdc53497afbb46a71a22ec7717c57bb05043c07960826d15ee5956cb3e3b5b
        lib/offline/survival-corpus.ts: ce740dd3eb31584b6efe97f538579ced28d4e68875347c75b429a645a82faa89
        lib/offline/survival-evaluator.test.ts: c47c76095dfe7c77c86b4c839d5fb3ee3adb06e0d36c7ae29683721af9a7dd72
        lib/offline/survival-evaluator.ts: a727b00c61468b695efe1cb4a1bced8dcd0be60b2f01052d284fcb19cdb0e233
        lib/output-compactor.test.ts: 819c399fce5cdc1639f0500bf15fe007774b7fba5dbc2d15d1880e7ca5bd13cb
        lib/output-compactor.ts: 9ebd68c1c7e82a98357d1a416935a5750cbf2980553644513102bf45dac1e524
        lib/paths.test.ts: 4786b00420e80ef17304f57e8e44a3ead0918edd37d050334267a2a7869ff9e2
        lib/paths.ts: a14afd19b1e330f64bebad580267c651464809377b00abcb555bcf0c489e1c5b
        lib/phase1-controller.test.ts: 6994035ad74027a19fd428aec4f1e60531e480cb13e7fdab32f972b2e50e2ae4
        lib/phase1-controller.ts: dbda83ed14bd87b327882a5aa425e5015c74d28042316c0792e15b9038dd77dd
        lib/phase1-lifecycle.property.test.ts: 9f1e47135522544f0b80e73805af2c629ad0af6d374f69c5ea8f22ae09cb9129
        lib/recall-entry.ts: f95094d09264906e083d76073b64d276af10caf4a69cbe7057bba0377b58f680
        lib/recall-projection.test.ts: fcd199d1ac107167871560ac6aad3a737a1be843ad1481c0bfb7b40f7aa1fff4
        lib/recall-projection.ts: 34d0523d3a3aab93f69705c7589d97d49f34ea6c5f9e1ada9045fdb4cea3a658
        lib/recall.test.ts: e90896852ccf2c1ca4d1d853238d3095fcad2f04f5f40352a9d7ad936f86d7a3
        lib/recall.ts: b87ca426ef87f0945f517218182d5473cfd65444e3e4eacacdaf685ef431491f
        lib/resumption-fidelity.test.ts: 955e8b60828aac8a91c8804a607608135e700e1a518a04af2c62fcdb0eec2846
        lib/runtime-probe.ts: 5a384c1d5f730ff6c62714b10ecda71090aaee19b7c8f1bba144d74a030b1f77
        lib/sdk.ts: 81ef935bdfe4a6daa8cda7cf585a7c7f0295a644fbb709fc38cef03906768937
        lib/session-evaluator.test.ts: cdcb0cb4b9b3c15899433ed4836984a84558f3a9bd78e4e940b193f6fdbb81cc
        lib/session-evaluator.ts: a4e0d0ab76bf3672f149e64b936e9c593a51165a1581616178d7cfc4897d0722
        lib/settings.test.ts: 871e2332afca88f92ecf31a9fc84bfdbe9e099aced6d9c97ec0702eb1fd7f309
        lib/settings.ts: 0017d98b0668145b586eb20ac42d96ecc089210e73711bac0002892fa98a7a7f
        lib/sha256.test.ts: 9131960dae17083192659dd10196b4fb83a998b70d4bed88d3073acab41fe85b
        lib/sha256.ts: 523f5efaa3ac2982f8f833240cb002351b52721420c48309a34f05f5b07dd125
        lib/store.test.ts: 856fbd303337d059314b858aaf5004a39198b92d49f35efe17d0a2612c53d3e1
        lib/store.ts: 3a8d1f9db3e38a66e33fdc365a03d5aa0e38761d45815595c16c45176bd97b37
        lib/strategy.test.ts: e549e307fb40eea44731981eafd5ed08d39dbce392f938d7f38ce44845bd662d
        lib/strategy.ts: 65a116cd0ae9d72c61afaed2b49947f4e6d8351f522446dc6f17f974b53e2b36
        lib/tool-result.test.ts: 85e238dadf1beea81baccc3361fffb96ca6a1ac6a101213c6f98e42f36dc3f76
        lib/tool-result.ts: 6cecb489009b8f7406b18ced9a0a6f2a19757c9a0efc020e197ee53c115bfd11
        lib/trigger.test.ts: a7b74a128989c66951d1e567fda7a19d6e32af1bf56a8e0722e5430cd894b658
        lib/trigger.ts: 5fa705fc16a31dcd2fedc703a7fb8ef1ad5069b60618aa4a1018d9f4ec31c206
        lib/tui-block.test.ts: ee25d80023627b5c63fadd15aa8978135e09006b0962f74fa2dacb6b410a1de1
        lib/tui-block.ts: 2c7200875c91b2cadf05d6ca88b7d7748f1f249c42b68937852f674ed50cea7c
        lib/types.ts: aade627b2f2683de80a138cc81ae59a71d25e4151e953b0fdf8040a3aa08809f
        lib/unicode.test.ts: 9f4b8ad3dea9b38f3e373575cf29e07898564e55be88627eb9b571deda013521
        lib/unicode.ts: 2a1a14f6c87a12f5acc1ef0ed8b10f3e30912f6344d46d1928f2a3a1434ca123
        lib/wire-format.ts: b149adac61adfc596173474e33d432cd93263e81a90608c70af755f44df2f9fa
        package.json: c59b7f5e269b4cb79288f9a880a2408dde2082b5b2b76e162a6e8f2b2b47a681
        scripts/benchmark-compiler.ts: 9e2bc7e815c273621e7312b3e54b8ddff0897180c444dbd08b016a87c7075f1a
        scripts/check-architecture.ts: abfedfb9a1fe62f32dac370a9579f14f4010e4dc78ba93c2cb33ba5d85697480
        scripts/evaluate-selector.ts: 59f6eeada8b20f3d7893f87f15d32ec4b87e07c1585e7c9af94b332f532b8c37
        tests/compare-session.ts: eecb3847c156685dc634be07033a55b41b44f385f1e8723ae8d59d8ea1562792
        tests/e2e/README.md: b9b58b3d7eea0555e5b4b13a1daf7b9575c66bc2745349c4144106fd2d731f39
        tests/e2e/busy-compaction.e2e.ts: df742676f8b66743773a8eca41de6de06d6ca6dd0308f95ca41d7022ad21f937
        tests/e2e/current-compaction.test.ts: 9efd50ccfa00f3645e076a4614ae5ea480320eb92c4c74e36ae1caf516cd95a9
        tests/e2e/demo.ts: 111c36985b6a9997560fff462856e44224d9a8bd1609c8f95afc380a44b3510d
        tests/e2e/harness/compaction-barrier.ts: c303a0bcde5d55b521570a5e06c0beaf86a1f47f81ac457ec77f7a4bb97db58e
        tests/e2e/harness/current-compaction.ts: 30009cbf2bd0bf92579480ba06acba76db7415839d38dea61aa50861f137b8bf
        tests/e2e/harness/env.ts: 80d510793aee4cc973e8dd59110a5b5871deea0a53fd26b93962325e94b06b99
        tests/e2e/harness/fake-provider.ts: 660fcff8b643a9bc3e749bb912acacd0384bdae41389ab7e2d2b5f405c8aa7f1
        tests/e2e/harness/preparation-fault.ts: 1d2e977db7ca4f80cedcc6452414e700113a5d870ee9f480c7c7c33dd9fbb15d
        tests/e2e/harness/rpc-client.ts: 42525b4925d12d0cebdeb92b5cab758369975f0e7e6a70eb10b4028bb07c3b31
        tests/e2e/interception.e2e.ts: b2cefbc64ab9d5b5213dbd9398eb09612945729565038e1a4ee3ebf6168e3a90
        tests/e2e/lifecycle.e2e.ts: 6468c3c34a2f5355d6a95c57350157ef8d34a0357121ed54ba9a8e82296a4fd7
        tests/fixtures/parser-session.jsonl: 50575fa33d879ec0e2ce4b1455545dd2836f12d37f54f4a6e731794b387c40e7
        tests/harness/fake-pi.ts: 471929329a9da287771609a65655e393b95eed3f9b8c07a8799dc12d48d1caf6
        tests/harness/preparation-fixture.ts: ec8bf72df94a9f82c24d719df8f10ccea9db3eb814a6654f1fa3514979ffedae
        tests/verify-improvement.test.ts: a9a5f39929a9c12274c448bfb574fbbc92e9c28df4ae3736876be3608019e433
        tsconfig.json: 08529066dec16388122122f2582069e400770a8587711b912794e10896615b0f
      at: 2026-10-05T23:42:40.492Z
    intended: obsolete-demo-native-user-repetition-projection
    evidence: /tmp/current-compaction-TG1.log; source startupCooldownExempt and
      prior-compaction restore policy
    next_action: repair fixture and rerun affected host gate
  - kind: checkpoint
    checkpoint_id: current-compaction-TG2
    operation_id: current-compaction-TG2
    operation_kind: gate
    gate: TG2
    phase: reconciled
    task: T1
    contract_digest: 5ca4752235ecf4aab1ed380d9723e19319ae181d8eba7a5ae8361c1dcaefb878
    before:
      digest: df406a8f72d7e1c8cc1e3cb948747ce98dcb0839c47303ee11663adbc4530010
      entries:
        .dependency-cruiser.cjs: f90d4b8c206440cc7006c105126ddb091a8ae57bc1a8225b49b54e63b0356edf
        .gitignore: 8f21e3b9b123ffa75121a0ae451782c432407acc21cc784d8fc095cd3e8c3cf7
        AGENTS.md: af56ae1e888439e976f2eac7ecf8c447ff2f73f99bba3b8900dcdf1add2b4286
        CLAUDE.md: symlink:AGENTS.md
        LICENSE: e2e52298290bec0f61398b5684006a59f0d8e2a7374e7f4cd134d5c36b660a47
        README.md: 4dae887df73702ccaf751e5683a42c298a59ecb1dee9251f5c4072ca4bb62e2f
        bin/dc-distill-session.ts: 15d9306ff37153205e88eda1baab634e341e2a25e6c9da5ca409f6762192524f
        bun.lock: 997ed36d6a2500f0e8ab160da30dd689f3c12e885e42933fe03e8aa7746e61eb
        debug/checkpoint-gate.ts: 6ac8afb9d7315db48851f95a64237676fe45cff3afe6b3fc62798f32d0076f6f
        debug/live-repro.ts: df3cd57568e1b68ccf2b21bd8d4acbf0802779d916e56b8de1a59a01ae69c3ad
        docs-contract.test.ts: e176e2eed18179cc551e295bae31f58c8730aa1e26321fce22c5b266f03fbaae
        docs/adr/0001-vendored-framework-boundary.md: 1388e4baba3d47fc433924c9807239fe50c596b57f318675c42b667b38c7329a
        docs/adr/0002-remove-vendored-framework.md: 2fbfc6def5635e9bfc1c5d2359ad779954c6f39dbebbd2bdf9417c93bd06d634
        docs/algorithm.md: 996beaaa59f3813f03b075ae2168120f2b47a133a695da75a457f93bc94c6d02
        docs/architecture.md: acf03df39fbb9e7a230a14cfba7ac3853c56a68bf3a45851ddb9c0ac2f1eb0ee
        docs/assets/distill-before-after.svg: 80ab3aa5b4f4bf2032daed7f08ecf25ffea586c5b733fa87163367964b8c0b50
        docs/compiler-benchmark.md: 0c9735e4a0f38cfe1f04ba955e103af19de7bc7fffc8506f03cf08f5e42380e4
        docs/releasing.md: a46134cd81e46690b0d0a5003c82c28d676fcd038fc25c5545a1cb0e2f832f3f
        docs/settings.md: fb6ff8195aea5e7198c58978b2ddd576bad291344283fbc3ef0ab0eb0f25e45a
        docs/troubleshooting.md: 118e91a571558a0d6aed99c7dfcafd592f31022faad6e5ad6b076c5a9c688b73
        docs/usage.md: a61aa7631a95fd2724ddba95933fbb9a5e951d7cf268957f5907a8ad459ffb3a
        index.phase1.test.ts: 113dcc79a51a216e0f23372a352992f55cf163b0e594982b5621d40285fa305e
        index.phase5.test.ts: 2bb02a7aab442d06941042d5088902dc29d24ca00bfde8f94a5868b9fc686020
        index.test.ts: b8697744329f12560b0205679a046046552d32477f498bf65767560a915ccbaf
        index.ts: 033710154492de4ed5d452aa4d07fa65c192cc3dde683dcb238c643952870bee
        index.v12.test.ts: 4b3bbd27accf76f6969a3e85401b6dd6884e234def14bc083437c91eabc59701
        lib/bm25.test.ts: 0fdcb41087f8fd5c62624088aae64b14f1cde65da45e1898cc85ca2038650b4c
        lib/bm25.ts: 00ec5ea25040b9fe88e0cd5538d5aa75aa1a6d5ea1b9fac3ecd491e905e08537
        lib/cache-runs.test.ts: 065effd0b1c7be678077d0137d498b87a38c2328a630473b86966ea8463e2be0
        lib/cache-runs.ts: e384ac5736b8f3803dc226f3483e9c01a7b725fb2839073b8cf66c6f0f21f421
        lib/checkpoint-update.test.ts: fe2480ef76ac8cfa716e5552f5c83e82155134d54e522c9ac692a986d6102285
        lib/checkpoint-update.ts: dbb4115a98e445149c4900922128248aa08177683525117a5581b7af8f892e22
        lib/compaction-card-dedupe.test.ts: 2af0cfcfa9c33744bd821fb435fbbcdeb9f3e5f3119f08d6ab7ad239d8638899
        lib/compaction-card-dedupe.ts: b15f9286e1715e9e47ce6ab04a5cef57260f541115c970507b36b950a7529e58
        lib/compaction-card.test.ts: 10efd22edb9e70155be542385f4f8e9b28a2085b6a30e87da22ef6491b37d060
        lib/compaction-card.ts: 3eba217ca318cce075ebe6d1f0776efa3c523f43a553406fe4e01af63f2a95db
        lib/compaction-source.test.ts: 7d043e9afa9ca2636996f9fff478e480e4254bfbe1742d21d0e7a5331541592f
        lib/compaction-source.ts: df5fac5b9a5853759ffc042c3c9d463dcef91ad746034cd6c52773b620267243
        lib/compile-session-file.ts: 37795fbc5054717b2aae8eff343079c68c12f6c8eb62189dc95c25fcef7a90b6
        lib/compiler/anchors.ts: da9d1e8fba8cbc84054f7b73f5bf85be7fe12692bc5f4624538cbdef370f953e
        lib/compiler/budget-formatter.test.ts: e2c2af5a4a041dc2b6c87c29b19f249db32a90e1476437d5407788399aaafa44
        lib/compiler/budget-formatter.ts: 23b876eee5619de92a327b6e9a8f7b3d46146021b0fccf91a1d6bbacd7002925
        lib/compiler/checkpoint-ladder.test.ts: f709202745e1807d7f14b3aea474c64d8008ef419b5586cc7b774eb2f54f95e9
        lib/compiler/checkpoint.test.ts: ff93c53ee31ea55563b7abccdb3108c70d510a7e3e1b6ca053256c82cef87974
        lib/compiler/checkpoint.ts: 65b409e1799e68e70a3440120d58e618fa4665f7a4b97970b30902a5c87951ed
        lib/compiler/conversation-reducer.phase4.test.ts: b9540ec821862376668d91c68faf166a01f68e2134f690275444f192beb0c25c
        lib/compiler/conversation-reducer.test.ts: 1ea56c0d5ffdac53c7ed5d1cc9c75050970e7cb4157af4618708ac6e63c5b7fb
        lib/compiler/conversation-reducer.ts: 57a3b7a08bf851137f6ea40e150f2f20be86f94d31469aaee1a2730efd5d0c1e
        lib/compiler/display-projection.test.ts: 310d7ff71b3603b5b6f736826ce9243136f918708362f2b7f67d6811e687cf9a
        lib/compiler/display-projection.ts: 27aedd88003afeb7d3b855ab88ec8f3783aae6efcbd4c926f70b1a44bbf23d65
        lib/compiler/errors.ts: bdb940fd1bb4b9b9e1958fddf23a774371794eaf6712123ca32e9a83957a18b7
        lib/compiler/evidence-lifetime.test.ts: 02349b64b03975289c8225f8a7e43769554e9303243b640dc46006f0c091050a
        lib/compiler/handoff-projection.test.ts: 0c1974fed453762934e057ce80ff7ee0cde2e62a1cb5ac231cf46bfba20fdf83
        lib/compiler/helpers.ts: 614594b7678e483bffd86ac664dc7a097bbbfdac4c28eb5f2d60c998fe09aaad
        lib/compiler/lexical-budget.ts: 7661f2775b25a75986b1fc539bed0efa544067573828a904ec681d8108e4f87b
        lib/compiler/normalizer.test.ts: 691742bcbcb087ddf5e83fd11ca85dfd884db94c58046ab463ee9aa1edf00491
        lib/compiler/normalizer.ts: 9dee1d55a09adbc6a36380701324cb92412988b9b50418211a755e9d43694f85
        lib/compiler/observed-readiness.test.ts: 371717edf02d8cbe08429c7ddc2f00a37d036610722c9e3971c4833a2b4bfb62
        lib/compiler/observed-readiness.ts: a61fe1797add41cbb1d0206fad44d414010b56d446787210acc0d44ec9bcc8f8
        lib/compiler/optional-selector.test.ts: 60e1de16a0af3c530b45fd626ef802058e04c664bbd8d831dafbe9ea3398210f
        lib/compiler/optional-selector.ts: 3028a31bb5e4f628eb762900374fad5d07267c70108f845b612dfea40bdd7061
        lib/compiler/path-roots.ts: 8b1771d0dac7e04f23e2076a681caa9f986e22ce6a8c91d36072fa7356c1ffa7
        lib/compiler/protected-overflow-regression.test.ts: a68ab7a94a586c576561f2a847b1b26dec78eb35f5c6f8b6a4231224ff16f672
        lib/compiler/request-candidate.test.ts: 756fb4d777d3aa1bc1a364352e8864a18d9db86514e2df784e631b173b0c935d
        lib/compiler/request-candidate.ts: 3b84f9386e7fc9beb299d7f46b6bbd74a91086b9cbac81ad056e6bc245067b1f
        lib/compiler/resume-index.test.ts: 27dd32d78a1e2ea88ee1278884c6e021407847587b44d16a368abf8c2a73599d
        lib/compiler/resume-index.ts: 0bb0fe3b835054b391858f13d5a4690f33ea505cc9e41ceb4d405a8ed9b81ed7
        lib/compiler/resume-plan.phase4.test.ts: 794b0955940d9831dc022059c0ec10c4e687353b967c5246559c922e851d76f7
        lib/compiler/section-scanner.test.ts: 54c9bde4ac6d8fd50363b1071c51f2714e7e6bbb9187abc2e13b63fcc97ee3d0
        lib/compiler/section-scanner.ts: 3f548fd9c41b115fd2620b2aa4ba571a0401a1fba4a88d49d26d1de2e82d9632
        lib/compiler/shell-analysis.test.ts: d76439d9ab2b1d4ae97392ea31659d999b60fc15993d4b262701ec6f7f3f8986
        lib/compiler/shell-analysis.ts: a44b9996d16b88122f2e287ec5ffafc2fbb211df308abe58d3551eda1e03696b
        lib/compiler/structural-v12.test.ts: a90f578c3bf6514c7c4f2ad5d3fd1cd08f1e2f2e91c7af6ad2b305d8124ba056
        lib/compiler/tool-effects-v12.test.ts: 398b4c9e476ede216ffd78d5ff4cd6bacce6c349f87c49bc181f81b5d8f14ddf
        lib/compiler/tool-effects.ts: 08462f0d2b52fa1d8a5a22115797759fd9d6f250ce9c0675061f3ed8ce3da526
        lib/compiler/tool-tracker.ts: 0f119a507a50361631f035e619db1e9dc77404b4a4d4fd636aa3885beef3ff17
        lib/compiler/types.ts: e039000df576be98758b4870f4d65644cdeca20a84a6e0f558d26e93c69910c4
        lib/compiler/verification-display.test.ts: 6e265a6f14bf320f322e5fa7db649c192f9702a1f20cafba811d8953b2e2cbea
        lib/compiler/verification-display.ts: c698e75804e37b1f5ce0f62602a139de10260cf3485d7436105bb037c6c46fc3
        lib/compiler/verification-observation.test.ts: 3110b011fb28a269ec045fb0ae63bb4e291f5fc090c7c20b00afcd65c3cb5276
        lib/compiler/verification-observation.ts: 0a50e89b868dc4522de0dbe57b695639a29c0dd7e257166f03d9364b12c1f536
        lib/continuation-recovery.test.ts: f87d36a7a646662da521da318260e73ba9ad1f853f1a207c1f1543727f1207ba
        lib/continuation-recovery.ts: 66645435aeb9fd3d53b209f6c96f39bd77c2c3103ba8f98d2b6966c6a2daa9aa
        lib/continuation.test.ts: 003c96689f72271a960ed65ce82a669fa830a92cca5f2c1a8813b789c7dffff0
        lib/continuation.ts: aeede077ece2b51e6698b3abcee9b04bbbb1d4ae8e41119e4bfdc3108b2d018b
        lib/data-migration.test.ts: 8674f7c68408e5e17416ce0f154ca10a8ea9f923a0d0a9ed6c145a70860bf478
        lib/data-migration.ts: f10e00e99a4ca076b3d82f97e2e9ecf6db4decc67ed8321179239407a789b51a
        lib/diag-support.test.ts: 8d1f675a3bf67a05cd11f313f2d19e594b0eb8caee75ccb725292428bbead9f8
        lib/diag-support.ts: 8bcc298e70155870262b32c124725b93890a1a75f57846ab5dc2f8b823851b81
        lib/entries-support.test.ts: 8220f20b7b83995db64a0961f2415319c7393613e3859903beb5203750c38f2c
        lib/entries-support.ts: a3f88f00943f790b5e3820c6b6e300cb7342561e1dbdab8d2a2feea57e867668
        lib/events-support.test.ts: 435dfd11eaf4a24104155c05d608fb7bf4652afc6886b63df42ff783e75e58bc
        lib/events-support.ts: 38d9a5228b96e4ce1a0fdda0ed437bb6bc8a5ff9ebece5f30544d2711b5502ac
        lib/extract-tags.ts: 9a31d5165d48710bd108118cc8d9c6f5a3351c1ba7b7533d1aaa455407c871a4
        lib/focus-echo.test.ts: 828d33fda65680a92af4d39e78886021eadc50e75b50345c858a5a829889ea07
        lib/focus-echo.ts: 2b2caa30257e4914a4b8c104d33b9f137cc5e6aa30719d8234be58c54404d551
        lib/fs-support.test.ts: 798d5b2d6ff1d667e1817d7e15f46a1386521e825e8735dea85552d43569c7e7
        lib/fs-support.ts: 781773b23e0dcca774b32b9d72a7384366aa32e72cb284aad70cdc0f4a9f638d
        lib/handoff.test.ts: 126b67aad40e34474560e3e11716b912f0a73a33dcd3babb6c55c959e56ee701
        lib/handoff.ts: 2a31c02abaad242fb1a8b37fb9a735902a9061dd77ba137177bf65b8f4e83aeb
        lib/json-object-keys.ts: 29506e7775909619e67bf2fd6a3174a0805140671fdd3caf8ee4545d3e6bd3ab
        lib/legacy-compat.test.ts: d65e8055b25a5d97f0b7c86ce96c7ffa3d71d52df5f36e8ed4ea12b040bad3ba
        lib/legacy.ts: 880a2c0b83050dfbb8bf31eee8d9cd628763017b7f8fa8502cf5faba55f681b1
        lib/local-compact.test.ts: d85835d8e8ed9898fb6d0001a670ec848f386d6fd9cbb21a2404724aa2e9ba8b
        lib/local-compact.ts: f30644758346df1b4551bb1de172fc65bf851e87be3c0b9ef018ade3cee05a3a
        lib/metric.test.ts: e8cfe49b5b87d67ff79e7a98691dbd88bc8334f62e41425ce3fddd078418d7ea
        lib/metric.ts: 4c2682b5858bf6f41e92bb9bf80463146813e16eb7f39fd700ed9088f030837b
        lib/monitor.test.ts: 1eeb119cbacb00b37afd7a883c016f9e8934342435a231a6b8911cb58087ccc8
        lib/monitor.ts: 5d832f113026968a03afc4f0e39560d19dd36c351f446b13293af7ad15583eb9
        lib/notify-support.test.ts: 753e639c9e7af3da17fe04016257d2ea976edb9f88638c6fd20fb02ec2184aba
        lib/notify-support.ts: eef58b4cd5e39dc246df5ccecc8a1e3ccca323751ca48fccd87f49947872e88d
        lib/offline/checkpoint-corpus.ts: 0a72f85ef6ae2bc816cfd73c4e4cf16da1773a308909e61cd127b8325483290b
        lib/offline/checkpoint-evaluator.test.ts: f69e4f8e24fccd35e9b2c19df43a012a2ae5764397ec83c2d4c0d3848d331846
        lib/offline/checkpoint-evaluator.ts: eac6b3aa8c45efbfd98717e93d20be5e684f9d539b82c28c3ee4681af9bb77df
        lib/offline/performance-gate.test.ts: 348a8b6d25b835e25ad1263f20da903cbfaeddc31539c107db05314420bccb46
        lib/offline/performance-gate.ts: fda5c8a2c1aaa6f1c167205bde70c8a0e8a3ddc78dd16deeec7c96e2955b1af4
        lib/offline/quality-corpus.ts: db57c6a8e3249ca3b22a9aaf4bdff41868b6c7a9bb52948d08575841c229dc96
        lib/offline/quality-evaluator.test.ts: b5229efda06630399d805b33dd9823d98bdfd3405146b6a7eaaeeba6f83e0ad6
        lib/offline/quality-evaluator.ts: 4b904d6a0cdb9ad4690d8377277fd292ffa42fbd850fa01e0477a3ac1f3ea4ac
        lib/offline/supplemental-corpus.ts: 67a6d152264a1175dc6dd56f74010058fd9b99b7111b4e6402dd93a8075748e2
        lib/offline/supplemental-evaluator.test.ts: a981d8f5a5f6a457aa7b0775b4b50662c16b5ad7e88f7447f1bd454edb9b7ecd
        lib/offline/supplemental-evaluator.ts: 39cdc53497afbb46a71a22ec7717c57bb05043c07960826d15ee5956cb3e3b5b
        lib/offline/survival-corpus.ts: ce740dd3eb31584b6efe97f538579ced28d4e68875347c75b429a645a82faa89
        lib/offline/survival-evaluator.test.ts: c47c76095dfe7c77c86b4c839d5fb3ee3adb06e0d36c7ae29683721af9a7dd72
        lib/offline/survival-evaluator.ts: a727b00c61468b695efe1cb4a1bced8dcd0be60b2f01052d284fcb19cdb0e233
        lib/output-compactor.test.ts: 819c399fce5cdc1639f0500bf15fe007774b7fba5dbc2d15d1880e7ca5bd13cb
        lib/output-compactor.ts: 9ebd68c1c7e82a98357d1a416935a5750cbf2980553644513102bf45dac1e524
        lib/paths.test.ts: 4786b00420e80ef17304f57e8e44a3ead0918edd37d050334267a2a7869ff9e2
        lib/paths.ts: a14afd19b1e330f64bebad580267c651464809377b00abcb555bcf0c489e1c5b
        lib/phase1-controller.test.ts: 6994035ad74027a19fd428aec4f1e60531e480cb13e7fdab32f972b2e50e2ae4
        lib/phase1-controller.ts: dbda83ed14bd87b327882a5aa425e5015c74d28042316c0792e15b9038dd77dd
        lib/phase1-lifecycle.property.test.ts: 9f1e47135522544f0b80e73805af2c629ad0af6d374f69c5ea8f22ae09cb9129
        lib/recall-entry.ts: f95094d09264906e083d76073b64d276af10caf4a69cbe7057bba0377b58f680
        lib/recall-projection.test.ts: fcd199d1ac107167871560ac6aad3a737a1be843ad1481c0bfb7b40f7aa1fff4
        lib/recall-projection.ts: 34d0523d3a3aab93f69705c7589d97d49f34ea6c5f9e1ada9045fdb4cea3a658
        lib/recall.test.ts: e90896852ccf2c1ca4d1d853238d3095fcad2f04f5f40352a9d7ad936f86d7a3
        lib/recall.ts: b87ca426ef87f0945f517218182d5473cfd65444e3e4eacacdaf685ef431491f
        lib/resumption-fidelity.test.ts: 955e8b60828aac8a91c8804a607608135e700e1a518a04af2c62fcdb0eec2846
        lib/runtime-probe.ts: 5a384c1d5f730ff6c62714b10ecda71090aaee19b7c8f1bba144d74a030b1f77
        lib/sdk.ts: 81ef935bdfe4a6daa8cda7cf585a7c7f0295a644fbb709fc38cef03906768937
        lib/session-evaluator.test.ts: cdcb0cb4b9b3c15899433ed4836984a84558f3a9bd78e4e940b193f6fdbb81cc
        lib/session-evaluator.ts: a4e0d0ab76bf3672f149e64b936e9c593a51165a1581616178d7cfc4897d0722
        lib/settings.test.ts: 871e2332afca88f92ecf31a9fc84bfdbe9e099aced6d9c97ec0702eb1fd7f309
        lib/settings.ts: 0017d98b0668145b586eb20ac42d96ecc089210e73711bac0002892fa98a7a7f
        lib/sha256.test.ts: 9131960dae17083192659dd10196b4fb83a998b70d4bed88d3073acab41fe85b
        lib/sha256.ts: 523f5efaa3ac2982f8f833240cb002351b52721420c48309a34f05f5b07dd125
        lib/store.test.ts: 856fbd303337d059314b858aaf5004a39198b92d49f35efe17d0a2612c53d3e1
        lib/store.ts: 3a8d1f9db3e38a66e33fdc365a03d5aa0e38761d45815595c16c45176bd97b37
        lib/strategy.test.ts: e549e307fb40eea44731981eafd5ed08d39dbce392f938d7f38ce44845bd662d
        lib/strategy.ts: 65a116cd0ae9d72c61afaed2b49947f4e6d8351f522446dc6f17f974b53e2b36
        lib/tool-result.test.ts: 85e238dadf1beea81baccc3361fffb96ca6a1ac6a101213c6f98e42f36dc3f76
        lib/tool-result.ts: 6cecb489009b8f7406b18ced9a0a6f2a19757c9a0efc020e197ee53c115bfd11
        lib/trigger.test.ts: a7b74a128989c66951d1e567fda7a19d6e32af1bf56a8e0722e5430cd894b658
        lib/trigger.ts: 5fa705fc16a31dcd2fedc703a7fb8ef1ad5069b60618aa4a1018d9f4ec31c206
        lib/tui-block.test.ts: ee25d80023627b5c63fadd15aa8978135e09006b0962f74fa2dacb6b410a1de1
        lib/tui-block.ts: 2c7200875c91b2cadf05d6ca88b7d7748f1f249c42b68937852f674ed50cea7c
        lib/types.ts: aade627b2f2683de80a138cc81ae59a71d25e4151e953b0fdf8040a3aa08809f
        lib/unicode.test.ts: 9f4b8ad3dea9b38f3e373575cf29e07898564e55be88627eb9b571deda013521
        lib/unicode.ts: 2a1a14f6c87a12f5acc1ef0ed8b10f3e30912f6344d46d1928f2a3a1434ca123
        lib/wire-format.ts: b149adac61adfc596173474e33d432cd93263e81a90608c70af755f44df2f9fa
        package.json: c59b7f5e269b4cb79288f9a880a2408dde2082b5b2b76e162a6e8f2b2b47a681
        scripts/benchmark-compiler.ts: 9e2bc7e815c273621e7312b3e54b8ddff0897180c444dbd08b016a87c7075f1a
        scripts/check-architecture.ts: abfedfb9a1fe62f32dac370a9579f14f4010e4dc78ba93c2cb33ba5d85697480
        scripts/evaluate-selector.ts: 59f6eeada8b20f3d7893f87f15d32ec4b87e07c1585e7c9af94b332f532b8c37
        tests/compare-session.ts: eecb3847c156685dc634be07033a55b41b44f385f1e8723ae8d59d8ea1562792
        tests/e2e/README.md: 92ab2889d74d1f9f3cd6e2270c42c55198141bad6efa4aca061553fa32822a8b
        tests/e2e/busy-compaction.e2e.ts: df742676f8b66743773a8eca41de6de06d6ca6dd0308f95ca41d7022ad21f937
        tests/e2e/current-compaction.test.ts: 9efd50ccfa00f3645e076a4614ae5ea480320eb92c4c74e36ae1caf516cd95a9
        tests/e2e/demo.ts: 866b6d6a0ec2fd77d7bfe478dd49234a1855a05dfde83b3672f18bf46ea6fd78
        tests/e2e/harness/compaction-barrier.ts: c303a0bcde5d55b521570a5e06c0beaf86a1f47f81ac457ec77f7a4bb97db58e
        tests/e2e/harness/current-compaction.ts: 30009cbf2bd0bf92579480ba06acba76db7415839d38dea61aa50861f137b8bf
        tests/e2e/harness/env.ts: 80d510793aee4cc973e8dd59110a5b5871deea0a53fd26b93962325e94b06b99
        tests/e2e/harness/fake-provider.ts: 660fcff8b643a9bc3e749bb912acacd0384bdae41389ab7e2d2b5f405c8aa7f1
        tests/e2e/harness/preparation-fault.ts: 1d2e977db7ca4f80cedcc6452414e700113a5d870ee9f480c7c7c33dd9fbb15d
        tests/e2e/harness/rpc-client.ts: 42525b4925d12d0cebdeb92b5cab758369975f0e7e6a70eb10b4028bb07c3b31
        tests/e2e/interception.e2e.ts: b2cefbc64ab9d5b5213dbd9398eb09612945729565038e1a4ee3ebf6168e3a90
        tests/e2e/lifecycle.e2e.ts: 6468c3c34a2f5355d6a95c57350157ef8d34a0357121ed54ba9a8e82296a4fd7
        tests/fixtures/parser-session.jsonl: 50575fa33d879ec0e2ce4b1455545dd2836f12d37f54f4a6e731794b387c40e7
        tests/harness/fake-pi.ts: 471929329a9da287771609a65655e393b95eed3f9b8c07a8799dc12d48d1caf6
        tests/harness/preparation-fixture.ts: ec8bf72df94a9f82c24d719df8f10ccea9db3eb814a6654f1fa3514979ffedae
        tests/verify-improvement.test.ts: a9a5f39929a9c12274c448bfb574fbbc92e9c28df4ae3736876be3608019e433
        tsconfig.json: 08529066dec16388122122f2582069e400770a8587711b912794e10896615b0f
      at: 2026-10-05T23:43:07.391Z
    intended: run frozen gate TG2
    next_action: continue next frozen gate or diagnose failure
    after:
      digest: df406a8f72d7e1c8cc1e3cb948747ce98dcb0839c47303ee11663adbc4530010
      entries:
        .dependency-cruiser.cjs: f90d4b8c206440cc7006c105126ddb091a8ae57bc1a8225b49b54e63b0356edf
        .gitignore: 8f21e3b9b123ffa75121a0ae451782c432407acc21cc784d8fc095cd3e8c3cf7
        AGENTS.md: af56ae1e888439e976f2eac7ecf8c447ff2f73f99bba3b8900dcdf1add2b4286
        CLAUDE.md: symlink:AGENTS.md
        LICENSE: e2e52298290bec0f61398b5684006a59f0d8e2a7374e7f4cd134d5c36b660a47
        README.md: 4dae887df73702ccaf751e5683a42c298a59ecb1dee9251f5c4072ca4bb62e2f
        bin/dc-distill-session.ts: 15d9306ff37153205e88eda1baab634e341e2a25e6c9da5ca409f6762192524f
        bun.lock: 997ed36d6a2500f0e8ab160da30dd689f3c12e885e42933fe03e8aa7746e61eb
        debug/checkpoint-gate.ts: 6ac8afb9d7315db48851f95a64237676fe45cff3afe6b3fc62798f32d0076f6f
        debug/live-repro.ts: df3cd57568e1b68ccf2b21bd8d4acbf0802779d916e56b8de1a59a01ae69c3ad
        docs-contract.test.ts: e176e2eed18179cc551e295bae31f58c8730aa1e26321fce22c5b266f03fbaae
        docs/adr/0001-vendored-framework-boundary.md: 1388e4baba3d47fc433924c9807239fe50c596b57f318675c42b667b38c7329a
        docs/adr/0002-remove-vendored-framework.md: 2fbfc6def5635e9bfc1c5d2359ad779954c6f39dbebbd2bdf9417c93bd06d634
        docs/algorithm.md: 996beaaa59f3813f03b075ae2168120f2b47a133a695da75a457f93bc94c6d02
        docs/architecture.md: acf03df39fbb9e7a230a14cfba7ac3853c56a68bf3a45851ddb9c0ac2f1eb0ee
        docs/assets/distill-before-after.svg: 80ab3aa5b4f4bf2032daed7f08ecf25ffea586c5b733fa87163367964b8c0b50
        docs/compiler-benchmark.md: 0c9735e4a0f38cfe1f04ba955e103af19de7bc7fffc8506f03cf08f5e42380e4
        docs/releasing.md: a46134cd81e46690b0d0a5003c82c28d676fcd038fc25c5545a1cb0e2f832f3f
        docs/settings.md: fb6ff8195aea5e7198c58978b2ddd576bad291344283fbc3ef0ab0eb0f25e45a
        docs/troubleshooting.md: 118e91a571558a0d6aed99c7dfcafd592f31022faad6e5ad6b076c5a9c688b73
        docs/usage.md: a61aa7631a95fd2724ddba95933fbb9a5e951d7cf268957f5907a8ad459ffb3a
        index.phase1.test.ts: 113dcc79a51a216e0f23372a352992f55cf163b0e594982b5621d40285fa305e
        index.phase5.test.ts: 2bb02a7aab442d06941042d5088902dc29d24ca00bfde8f94a5868b9fc686020
        index.test.ts: b8697744329f12560b0205679a046046552d32477f498bf65767560a915ccbaf
        index.ts: 033710154492de4ed5d452aa4d07fa65c192cc3dde683dcb238c643952870bee
        index.v12.test.ts: 4b3bbd27accf76f6969a3e85401b6dd6884e234def14bc083437c91eabc59701
        lib/bm25.test.ts: 0fdcb41087f8fd5c62624088aae64b14f1cde65da45e1898cc85ca2038650b4c
        lib/bm25.ts: 00ec5ea25040b9fe88e0cd5538d5aa75aa1a6d5ea1b9fac3ecd491e905e08537
        lib/cache-runs.test.ts: 065effd0b1c7be678077d0137d498b87a38c2328a630473b86966ea8463e2be0
        lib/cache-runs.ts: e384ac5736b8f3803dc226f3483e9c01a7b725fb2839073b8cf66c6f0f21f421
        lib/checkpoint-update.test.ts: fe2480ef76ac8cfa716e5552f5c83e82155134d54e522c9ac692a986d6102285
        lib/checkpoint-update.ts: dbb4115a98e445149c4900922128248aa08177683525117a5581b7af8f892e22
        lib/compaction-card-dedupe.test.ts: 2af0cfcfa9c33744bd821fb435fbbcdeb9f3e5f3119f08d6ab7ad239d8638899
        lib/compaction-card-dedupe.ts: b15f9286e1715e9e47ce6ab04a5cef57260f541115c970507b36b950a7529e58
        lib/compaction-card.test.ts: 10efd22edb9e70155be542385f4f8e9b28a2085b6a30e87da22ef6491b37d060
        lib/compaction-card.ts: 3eba217ca318cce075ebe6d1f0776efa3c523f43a553406fe4e01af63f2a95db
        lib/compaction-source.test.ts: 7d043e9afa9ca2636996f9fff478e480e4254bfbe1742d21d0e7a5331541592f
        lib/compaction-source.ts: df5fac5b9a5853759ffc042c3c9d463dcef91ad746034cd6c52773b620267243
        lib/compile-session-file.ts: 37795fbc5054717b2aae8eff343079c68c12f6c8eb62189dc95c25fcef7a90b6
        lib/compiler/anchors.ts: da9d1e8fba8cbc84054f7b73f5bf85be7fe12692bc5f4624538cbdef370f953e
        lib/compiler/budget-formatter.test.ts: e2c2af5a4a041dc2b6c87c29b19f249db32a90e1476437d5407788399aaafa44
        lib/compiler/budget-formatter.ts: 23b876eee5619de92a327b6e9a8f7b3d46146021b0fccf91a1d6bbacd7002925
        lib/compiler/checkpoint-ladder.test.ts: f709202745e1807d7f14b3aea474c64d8008ef419b5586cc7b774eb2f54f95e9
        lib/compiler/checkpoint.test.ts: ff93c53ee31ea55563b7abccdb3108c70d510a7e3e1b6ca053256c82cef87974
        lib/compiler/checkpoint.ts: 65b409e1799e68e70a3440120d58e618fa4665f7a4b97970b30902a5c87951ed
        lib/compiler/conversation-reducer.phase4.test.ts: b9540ec821862376668d91c68faf166a01f68e2134f690275444f192beb0c25c
        lib/compiler/conversation-reducer.test.ts: 1ea56c0d5ffdac53c7ed5d1cc9c75050970e7cb4157af4618708ac6e63c5b7fb
        lib/compiler/conversation-reducer.ts: 57a3b7a08bf851137f6ea40e150f2f20be86f94d31469aaee1a2730efd5d0c1e
        lib/compiler/display-projection.test.ts: 310d7ff71b3603b5b6f736826ce9243136f918708362f2b7f67d6811e687cf9a
        lib/compiler/display-projection.ts: 27aedd88003afeb7d3b855ab88ec8f3783aae6efcbd4c926f70b1a44bbf23d65
        lib/compiler/errors.ts: bdb940fd1bb4b9b9e1958fddf23a774371794eaf6712123ca32e9a83957a18b7
        lib/compiler/evidence-lifetime.test.ts: 02349b64b03975289c8225f8a7e43769554e9303243b640dc46006f0c091050a
        lib/compiler/handoff-projection.test.ts: 0c1974fed453762934e057ce80ff7ee0cde2e62a1cb5ac231cf46bfba20fdf83
        lib/compiler/helpers.ts: 614594b7678e483bffd86ac664dc7a097bbbfdac4c28eb5f2d60c998fe09aaad
        lib/compiler/lexical-budget.ts: 7661f2775b25a75986b1fc539bed0efa544067573828a904ec681d8108e4f87b
        lib/compiler/normalizer.test.ts: 691742bcbcb087ddf5e83fd11ca85dfd884db94c58046ab463ee9aa1edf00491
        lib/compiler/normalizer.ts: 9dee1d55a09adbc6a36380701324cb92412988b9b50418211a755e9d43694f85
        lib/compiler/observed-readiness.test.ts: 371717edf02d8cbe08429c7ddc2f00a37d036610722c9e3971c4833a2b4bfb62
        lib/compiler/observed-readiness.ts: a61fe1797add41cbb1d0206fad44d414010b56d446787210acc0d44ec9bcc8f8
        lib/compiler/optional-selector.test.ts: 60e1de16a0af3c530b45fd626ef802058e04c664bbd8d831dafbe9ea3398210f
        lib/compiler/optional-selector.ts: 3028a31bb5e4f628eb762900374fad5d07267c70108f845b612dfea40bdd7061
        lib/compiler/path-roots.ts: 8b1771d0dac7e04f23e2076a681caa9f986e22ce6a8c91d36072fa7356c1ffa7
        lib/compiler/protected-overflow-regression.test.ts: a68ab7a94a586c576561f2a847b1b26dec78eb35f5c6f8b6a4231224ff16f672
        lib/compiler/request-candidate.test.ts: 756fb4d777d3aa1bc1a364352e8864a18d9db86514e2df784e631b173b0c935d
        lib/compiler/request-candidate.ts: 3b84f9386e7fc9beb299d7f46b6bbd74a91086b9cbac81ad056e6bc245067b1f
        lib/compiler/resume-index.test.ts: 27dd32d78a1e2ea88ee1278884c6e021407847587b44d16a368abf8c2a73599d
        lib/compiler/resume-index.ts: 0bb0fe3b835054b391858f13d5a4690f33ea505cc9e41ceb4d405a8ed9b81ed7
        lib/compiler/resume-plan.phase4.test.ts: 794b0955940d9831dc022059c0ec10c4e687353b967c5246559c922e851d76f7
        lib/compiler/section-scanner.test.ts: 54c9bde4ac6d8fd50363b1071c51f2714e7e6bbb9187abc2e13b63fcc97ee3d0
        lib/compiler/section-scanner.ts: 3f548fd9c41b115fd2620b2aa4ba571a0401a1fba4a88d49d26d1de2e82d9632
        lib/compiler/shell-analysis.test.ts: d76439d9ab2b1d4ae97392ea31659d999b60fc15993d4b262701ec6f7f3f8986
        lib/compiler/shell-analysis.ts: a44b9996d16b88122f2e287ec5ffafc2fbb211df308abe58d3551eda1e03696b
        lib/compiler/structural-v12.test.ts: a90f578c3bf6514c7c4f2ad5d3fd1cd08f1e2f2e91c7af6ad2b305d8124ba056
        lib/compiler/tool-effects-v12.test.ts: 398b4c9e476ede216ffd78d5ff4cd6bacce6c349f87c49bc181f81b5d8f14ddf
        lib/compiler/tool-effects.ts: 08462f0d2b52fa1d8a5a22115797759fd9d6f250ce9c0675061f3ed8ce3da526
        lib/compiler/tool-tracker.ts: 0f119a507a50361631f035e619db1e9dc77404b4a4d4fd636aa3885beef3ff17
        lib/compiler/types.ts: e039000df576be98758b4870f4d65644cdeca20a84a6e0f558d26e93c69910c4
        lib/compiler/verification-display.test.ts: 6e265a6f14bf320f322e5fa7db649c192f9702a1f20cafba811d8953b2e2cbea
        lib/compiler/verification-display.ts: c698e75804e37b1f5ce0f62602a139de10260cf3485d7436105bb037c6c46fc3
        lib/compiler/verification-observation.test.ts: 3110b011fb28a269ec045fb0ae63bb4e291f5fc090c7c20b00afcd65c3cb5276
        lib/compiler/verification-observation.ts: 0a50e89b868dc4522de0dbe57b695639a29c0dd7e257166f03d9364b12c1f536
        lib/continuation-recovery.test.ts: f87d36a7a646662da521da318260e73ba9ad1f853f1a207c1f1543727f1207ba
        lib/continuation-recovery.ts: 66645435aeb9fd3d53b209f6c96f39bd77c2c3103ba8f98d2b6966c6a2daa9aa
        lib/continuation.test.ts: 003c96689f72271a960ed65ce82a669fa830a92cca5f2c1a8813b789c7dffff0
        lib/continuation.ts: aeede077ece2b51e6698b3abcee9b04bbbb1d4ae8e41119e4bfdc3108b2d018b
        lib/data-migration.test.ts: 8674f7c68408e5e17416ce0f154ca10a8ea9f923a0d0a9ed6c145a70860bf478
        lib/data-migration.ts: f10e00e99a4ca076b3d82f97e2e9ecf6db4decc67ed8321179239407a789b51a
        lib/diag-support.test.ts: 8d1f675a3bf67a05cd11f313f2d19e594b0eb8caee75ccb725292428bbead9f8
        lib/diag-support.ts: 8bcc298e70155870262b32c124725b93890a1a75f57846ab5dc2f8b823851b81
        lib/entries-support.test.ts: 8220f20b7b83995db64a0961f2415319c7393613e3859903beb5203750c38f2c
        lib/entries-support.ts: a3f88f00943f790b5e3820c6b6e300cb7342561e1dbdab8d2a2feea57e867668
        lib/events-support.test.ts: 435dfd11eaf4a24104155c05d608fb7bf4652afc6886b63df42ff783e75e58bc
        lib/events-support.ts: 38d9a5228b96e4ce1a0fdda0ed437bb6bc8a5ff9ebece5f30544d2711b5502ac
        lib/extract-tags.ts: 9a31d5165d48710bd108118cc8d9c6f5a3351c1ba7b7533d1aaa455407c871a4
        lib/focus-echo.test.ts: 828d33fda65680a92af4d39e78886021eadc50e75b50345c858a5a829889ea07
        lib/focus-echo.ts: 2b2caa30257e4914a4b8c104d33b9f137cc5e6aa30719d8234be58c54404d551
        lib/fs-support.test.ts: 798d5b2d6ff1d667e1817d7e15f46a1386521e825e8735dea85552d43569c7e7
        lib/fs-support.ts: 781773b23e0dcca774b32b9d72a7384366aa32e72cb284aad70cdc0f4a9f638d
        lib/handoff.test.ts: 126b67aad40e34474560e3e11716b912f0a73a33dcd3babb6c55c959e56ee701
        lib/handoff.ts: 2a31c02abaad242fb1a8b37fb9a735902a9061dd77ba137177bf65b8f4e83aeb
        lib/json-object-keys.ts: 29506e7775909619e67bf2fd6a3174a0805140671fdd3caf8ee4545d3e6bd3ab
        lib/legacy-compat.test.ts: d65e8055b25a5d97f0b7c86ce96c7ffa3d71d52df5f36e8ed4ea12b040bad3ba
        lib/legacy.ts: 880a2c0b83050dfbb8bf31eee8d9cd628763017b7f8fa8502cf5faba55f681b1
        lib/local-compact.test.ts: d85835d8e8ed9898fb6d0001a670ec848f386d6fd9cbb21a2404724aa2e9ba8b
        lib/local-compact.ts: f30644758346df1b4551bb1de172fc65bf851e87be3c0b9ef018ade3cee05a3a
        lib/metric.test.ts: e8cfe49b5b87d67ff79e7a98691dbd88bc8334f62e41425ce3fddd078418d7ea
        lib/metric.ts: 4c2682b5858bf6f41e92bb9bf80463146813e16eb7f39fd700ed9088f030837b
        lib/monitor.test.ts: 1eeb119cbacb00b37afd7a883c016f9e8934342435a231a6b8911cb58087ccc8
        lib/monitor.ts: 5d832f113026968a03afc4f0e39560d19dd36c351f446b13293af7ad15583eb9
        lib/notify-support.test.ts: 753e639c9e7af3da17fe04016257d2ea976edb9f88638c6fd20fb02ec2184aba
        lib/notify-support.ts: eef58b4cd5e39dc246df5ccecc8a1e3ccca323751ca48fccd87f49947872e88d
        lib/offline/checkpoint-corpus.ts: 0a72f85ef6ae2bc816cfd73c4e4cf16da1773a308909e61cd127b8325483290b
        lib/offline/checkpoint-evaluator.test.ts: f69e4f8e24fccd35e9b2c19df43a012a2ae5764397ec83c2d4c0d3848d331846
        lib/offline/checkpoint-evaluator.ts: eac6b3aa8c45efbfd98717e93d20be5e684f9d539b82c28c3ee4681af9bb77df
        lib/offline/performance-gate.test.ts: 348a8b6d25b835e25ad1263f20da903cbfaeddc31539c107db05314420bccb46
        lib/offline/performance-gate.ts: fda5c8a2c1aaa6f1c167205bde70c8a0e8a3ddc78dd16deeec7c96e2955b1af4
        lib/offline/quality-corpus.ts: db57c6a8e3249ca3b22a9aaf4bdff41868b6c7a9bb52948d08575841c229dc96
        lib/offline/quality-evaluator.test.ts: b5229efda06630399d805b33dd9823d98bdfd3405146b6a7eaaeeba6f83e0ad6
        lib/offline/quality-evaluator.ts: 4b904d6a0cdb9ad4690d8377277fd292ffa42fbd850fa01e0477a3ac1f3ea4ac
        lib/offline/supplemental-corpus.ts: 67a6d152264a1175dc6dd56f74010058fd9b99b7111b4e6402dd93a8075748e2
        lib/offline/supplemental-evaluator.test.ts: a981d8f5a5f6a457aa7b0775b4b50662c16b5ad7e88f7447f1bd454edb9b7ecd
        lib/offline/supplemental-evaluator.ts: 39cdc53497afbb46a71a22ec7717c57bb05043c07960826d15ee5956cb3e3b5b
        lib/offline/survival-corpus.ts: ce740dd3eb31584b6efe97f538579ced28d4e68875347c75b429a645a82faa89
        lib/offline/survival-evaluator.test.ts: c47c76095dfe7c77c86b4c839d5fb3ee3adb06e0d36c7ae29683721af9a7dd72
        lib/offline/survival-evaluator.ts: a727b00c61468b695efe1cb4a1bced8dcd0be60b2f01052d284fcb19cdb0e233
        lib/output-compactor.test.ts: 819c399fce5cdc1639f0500bf15fe007774b7fba5dbc2d15d1880e7ca5bd13cb
        lib/output-compactor.ts: 9ebd68c1c7e82a98357d1a416935a5750cbf2980553644513102bf45dac1e524
        lib/paths.test.ts: 4786b00420e80ef17304f57e8e44a3ead0918edd37d050334267a2a7869ff9e2
        lib/paths.ts: a14afd19b1e330f64bebad580267c651464809377b00abcb555bcf0c489e1c5b
        lib/phase1-controller.test.ts: 6994035ad74027a19fd428aec4f1e60531e480cb13e7fdab32f972b2e50e2ae4
        lib/phase1-controller.ts: dbda83ed14bd87b327882a5aa425e5015c74d28042316c0792e15b9038dd77dd
        lib/phase1-lifecycle.property.test.ts: 9f1e47135522544f0b80e73805af2c629ad0af6d374f69c5ea8f22ae09cb9129
        lib/recall-entry.ts: f95094d09264906e083d76073b64d276af10caf4a69cbe7057bba0377b58f680
        lib/recall-projection.test.ts: fcd199d1ac107167871560ac6aad3a737a1be843ad1481c0bfb7b40f7aa1fff4
        lib/recall-projection.ts: 34d0523d3a3aab93f69705c7589d97d49f34ea6c5f9e1ada9045fdb4cea3a658
        lib/recall.test.ts: e90896852ccf2c1ca4d1d853238d3095fcad2f04f5f40352a9d7ad936f86d7a3
        lib/recall.ts: b87ca426ef87f0945f517218182d5473cfd65444e3e4eacacdaf685ef431491f
        lib/resumption-fidelity.test.ts: 955e8b60828aac8a91c8804a607608135e700e1a518a04af2c62fcdb0eec2846
        lib/runtime-probe.ts: 5a384c1d5f730ff6c62714b10ecda71090aaee19b7c8f1bba144d74a030b1f77
        lib/sdk.ts: 81ef935bdfe4a6daa8cda7cf585a7c7f0295a644fbb709fc38cef03906768937
        lib/session-evaluator.test.ts: cdcb0cb4b9b3c15899433ed4836984a84558f3a9bd78e4e940b193f6fdbb81cc
        lib/session-evaluator.ts: a4e0d0ab76bf3672f149e64b936e9c593a51165a1581616178d7cfc4897d0722
        lib/settings.test.ts: 871e2332afca88f92ecf31a9fc84bfdbe9e099aced6d9c97ec0702eb1fd7f309
        lib/settings.ts: 0017d98b0668145b586eb20ac42d96ecc089210e73711bac0002892fa98a7a7f
        lib/sha256.test.ts: 9131960dae17083192659dd10196b4fb83a998b70d4bed88d3073acab41fe85b
        lib/sha256.ts: 523f5efaa3ac2982f8f833240cb002351b52721420c48309a34f05f5b07dd125
        lib/store.test.ts: 856fbd303337d059314b858aaf5004a39198b92d49f35efe17d0a2612c53d3e1
        lib/store.ts: 3a8d1f9db3e38a66e33fdc365a03d5aa0e38761d45815595c16c45176bd97b37
        lib/strategy.test.ts: e549e307fb40eea44731981eafd5ed08d39dbce392f938d7f38ce44845bd662d
        lib/strategy.ts: 65a116cd0ae9d72c61afaed2b49947f4e6d8351f522446dc6f17f974b53e2b36
        lib/tool-result.test.ts: 85e238dadf1beea81baccc3361fffb96ca6a1ac6a101213c6f98e42f36dc3f76
        lib/tool-result.ts: 6cecb489009b8f7406b18ced9a0a6f2a19757c9a0efc020e197ee53c115bfd11
        lib/trigger.test.ts: a7b74a128989c66951d1e567fda7a19d6e32af1bf56a8e0722e5430cd894b658
        lib/trigger.ts: 5fa705fc16a31dcd2fedc703a7fb8ef1ad5069b60618aa4a1018d9f4ec31c206
        lib/tui-block.test.ts: ee25d80023627b5c63fadd15aa8978135e09006b0962f74fa2dacb6b410a1de1
        lib/tui-block.ts: 2c7200875c91b2cadf05d6ca88b7d7748f1f249c42b68937852f674ed50cea7c
        lib/types.ts: aade627b2f2683de80a138cc81ae59a71d25e4151e953b0fdf8040a3aa08809f
        lib/unicode.test.ts: 9f4b8ad3dea9b38f3e373575cf29e07898564e55be88627eb9b571deda013521
        lib/unicode.ts: 2a1a14f6c87a12f5acc1ef0ed8b10f3e30912f6344d46d1928f2a3a1434ca123
        lib/wire-format.ts: b149adac61adfc596173474e33d432cd93263e81a90608c70af755f44df2f9fa
        package.json: c59b7f5e269b4cb79288f9a880a2408dde2082b5b2b76e162a6e8f2b2b47a681
        scripts/benchmark-compiler.ts: 9e2bc7e815c273621e7312b3e54b8ddff0897180c444dbd08b016a87c7075f1a
        scripts/check-architecture.ts: abfedfb9a1fe62f32dac370a9579f14f4010e4dc78ba93c2cb33ba5d85697480
        scripts/evaluate-selector.ts: 59f6eeada8b20f3d7893f87f15d32ec4b87e07c1585e7c9af94b332f532b8c37
        tests/compare-session.ts: eecb3847c156685dc634be07033a55b41b44f385f1e8723ae8d59d8ea1562792
        tests/e2e/README.md: 92ab2889d74d1f9f3cd6e2270c42c55198141bad6efa4aca061553fa32822a8b
        tests/e2e/busy-compaction.e2e.ts: df742676f8b66743773a8eca41de6de06d6ca6dd0308f95ca41d7022ad21f937
        tests/e2e/current-compaction.test.ts: 9efd50ccfa00f3645e076a4614ae5ea480320eb92c4c74e36ae1caf516cd95a9
        tests/e2e/demo.ts: 866b6d6a0ec2fd77d7bfe478dd49234a1855a05dfde83b3672f18bf46ea6fd78
        tests/e2e/harness/compaction-barrier.ts: c303a0bcde5d55b521570a5e06c0beaf86a1f47f81ac457ec77f7a4bb97db58e
        tests/e2e/harness/current-compaction.ts: 30009cbf2bd0bf92579480ba06acba76db7415839d38dea61aa50861f137b8bf
        tests/e2e/harness/env.ts: 80d510793aee4cc973e8dd59110a5b5871deea0a53fd26b93962325e94b06b99
        tests/e2e/harness/fake-provider.ts: 660fcff8b643a9bc3e749bb912acacd0384bdae41389ab7e2d2b5f405c8aa7f1
        tests/e2e/harness/preparation-fault.ts: 1d2e977db7ca4f80cedcc6452414e700113a5d870ee9f480c7c7c33dd9fbb15d
        tests/e2e/harness/rpc-client.ts: 42525b4925d12d0cebdeb92b5cab758369975f0e7e6a70eb10b4028bb07c3b31
        tests/e2e/interception.e2e.ts: b2cefbc64ab9d5b5213dbd9398eb09612945729565038e1a4ee3ebf6168e3a90
        tests/e2e/lifecycle.e2e.ts: 6468c3c34a2f5355d6a95c57350157ef8d34a0357121ed54ba9a8e82296a4fd7
        tests/fixtures/parser-session.jsonl: 50575fa33d879ec0e2ce4b1455545dd2836f12d37f54f4a6e731794b387c40e7
        tests/harness/fake-pi.ts: 471929329a9da287771609a65655e393b95eed3f9b8c07a8799dc12d48d1caf6
        tests/harness/preparation-fixture.ts: ec8bf72df94a9f82c24d719df8f10ccea9db3eb814a6654f1fa3514979ffedae
        tests/verify-improvement.test.ts: a9a5f39929a9c12274c448bfb574fbbc92e9c28df4ae3736876be3608019e433
        tsconfig.json: 08529066dec16388122122f2582069e400770a8587711b912794e10896615b0f
      at: 2026-10-05T23:43:08.171Z
    result: passed
    evidence:
      gate: TG2
      command: sandbox=$(mktemp -d /tmp/dc-distill-v14-demo.XXXXXX);
        PI_CODING_AGENT_DIR="$sandbox/agent"
        DISTILL_PI_PACKAGE="$PWD/node_modules/@earendil-works/pi-coding-agent"
        DISTILL_PI_EXPECT_VERSION=0.99.2 bun run distill:demo
      working_directory: /Users/vampire/code/ts/pi-dc-distill
      exit: 0
      signal: null
      started: 2026-10-05T23:43:07.446Z
      ended: 2026-10-05T23:43:08.102Z
      log: /tmp/current-compaction-TG2.log
      output: >
        Artifacts (demo):
        /tmp/dc-distill-v14-demo.gIe8ir/agent/cache/dc-distill/demo/run-Nj7pCh

        dc-distill scripted lifecycle demo: PASS

        Artifacts:
        /tmp/dc-distill-v14-demo.gIe8ir/agent/cache/dc-distill/demo/run-Nj7pCh
          before-compaction.jsonl
          after-compaction.jsonl
          rpc.log
          provider-trace.jsonl
        Provider requests: 4; summarizer requests: 0

        Compaction: one v14 ledger entry; validated schema-v2 checkpoint, exact
        digests and 17-section ledger; metric-free manual lifecycle; original
        native-user excerpt, explicit source omission and exact request clause.

        $ bun run tests/e2e/demo.ts
  - kind: checkpoint
    checkpoint_id: current-compaction-TG3
    operation_id: current-compaction-TG3
    operation_kind: gate
    gate: TG3
    phase: reconciled
    task: T1
    contract_digest: 5ca4752235ecf4aab1ed380d9723e19319ae181d8eba7a5ae8361c1dcaefb878
    before:
      digest: df406a8f72d7e1c8cc1e3cb948747ce98dcb0839c47303ee11663adbc4530010
      entries:
        .dependency-cruiser.cjs: f90d4b8c206440cc7006c105126ddb091a8ae57bc1a8225b49b54e63b0356edf
        .gitignore: 8f21e3b9b123ffa75121a0ae451782c432407acc21cc784d8fc095cd3e8c3cf7
        AGENTS.md: af56ae1e888439e976f2eac7ecf8c447ff2f73f99bba3b8900dcdf1add2b4286
        CLAUDE.md: symlink:AGENTS.md
        LICENSE: e2e52298290bec0f61398b5684006a59f0d8e2a7374e7f4cd134d5c36b660a47
        README.md: 4dae887df73702ccaf751e5683a42c298a59ecb1dee9251f5c4072ca4bb62e2f
        bin/dc-distill-session.ts: 15d9306ff37153205e88eda1baab634e341e2a25e6c9da5ca409f6762192524f
        bun.lock: 997ed36d6a2500f0e8ab160da30dd689f3c12e885e42933fe03e8aa7746e61eb
        debug/checkpoint-gate.ts: 6ac8afb9d7315db48851f95a64237676fe45cff3afe6b3fc62798f32d0076f6f
        debug/live-repro.ts: df3cd57568e1b68ccf2b21bd8d4acbf0802779d916e56b8de1a59a01ae69c3ad
        docs-contract.test.ts: e176e2eed18179cc551e295bae31f58c8730aa1e26321fce22c5b266f03fbaae
        docs/adr/0001-vendored-framework-boundary.md: 1388e4baba3d47fc433924c9807239fe50c596b57f318675c42b667b38c7329a
        docs/adr/0002-remove-vendored-framework.md: 2fbfc6def5635e9bfc1c5d2359ad779954c6f39dbebbd2bdf9417c93bd06d634
        docs/algorithm.md: 996beaaa59f3813f03b075ae2168120f2b47a133a695da75a457f93bc94c6d02
        docs/architecture.md: acf03df39fbb9e7a230a14cfba7ac3853c56a68bf3a45851ddb9c0ac2f1eb0ee
        docs/assets/distill-before-after.svg: 80ab3aa5b4f4bf2032daed7f08ecf25ffea586c5b733fa87163367964b8c0b50
        docs/compiler-benchmark.md: 0c9735e4a0f38cfe1f04ba955e103af19de7bc7fffc8506f03cf08f5e42380e4
        docs/releasing.md: a46134cd81e46690b0d0a5003c82c28d676fcd038fc25c5545a1cb0e2f832f3f
        docs/settings.md: fb6ff8195aea5e7198c58978b2ddd576bad291344283fbc3ef0ab0eb0f25e45a
        docs/troubleshooting.md: 118e91a571558a0d6aed99c7dfcafd592f31022faad6e5ad6b076c5a9c688b73
        docs/usage.md: a61aa7631a95fd2724ddba95933fbb9a5e951d7cf268957f5907a8ad459ffb3a
        index.phase1.test.ts: 113dcc79a51a216e0f23372a352992f55cf163b0e594982b5621d40285fa305e
        index.phase5.test.ts: 2bb02a7aab442d06941042d5088902dc29d24ca00bfde8f94a5868b9fc686020
        index.test.ts: b8697744329f12560b0205679a046046552d32477f498bf65767560a915ccbaf
        index.ts: 033710154492de4ed5d452aa4d07fa65c192cc3dde683dcb238c643952870bee
        index.v12.test.ts: 4b3bbd27accf76f6969a3e85401b6dd6884e234def14bc083437c91eabc59701
        lib/bm25.test.ts: 0fdcb41087f8fd5c62624088aae64b14f1cde65da45e1898cc85ca2038650b4c
        lib/bm25.ts: 00ec5ea25040b9fe88e0cd5538d5aa75aa1a6d5ea1b9fac3ecd491e905e08537
        lib/cache-runs.test.ts: 065effd0b1c7be678077d0137d498b87a38c2328a630473b86966ea8463e2be0
        lib/cache-runs.ts: e384ac5736b8f3803dc226f3483e9c01a7b725fb2839073b8cf66c6f0f21f421
        lib/checkpoint-update.test.ts: fe2480ef76ac8cfa716e5552f5c83e82155134d54e522c9ac692a986d6102285
        lib/checkpoint-update.ts: dbb4115a98e445149c4900922128248aa08177683525117a5581b7af8f892e22
        lib/compaction-card-dedupe.test.ts: 2af0cfcfa9c33744bd821fb435fbbcdeb9f3e5f3119f08d6ab7ad239d8638899
        lib/compaction-card-dedupe.ts: b15f9286e1715e9e47ce6ab04a5cef57260f541115c970507b36b950a7529e58
        lib/compaction-card.test.ts: 10efd22edb9e70155be542385f4f8e9b28a2085b6a30e87da22ef6491b37d060
        lib/compaction-card.ts: 3eba217ca318cce075ebe6d1f0776efa3c523f43a553406fe4e01af63f2a95db
        lib/compaction-source.test.ts: 7d043e9afa9ca2636996f9fff478e480e4254bfbe1742d21d0e7a5331541592f
        lib/compaction-source.ts: df5fac5b9a5853759ffc042c3c9d463dcef91ad746034cd6c52773b620267243
        lib/compile-session-file.ts: 37795fbc5054717b2aae8eff343079c68c12f6c8eb62189dc95c25fcef7a90b6
        lib/compiler/anchors.ts: da9d1e8fba8cbc84054f7b73f5bf85be7fe12692bc5f4624538cbdef370f953e
        lib/compiler/budget-formatter.test.ts: e2c2af5a4a041dc2b6c87c29b19f249db32a90e1476437d5407788399aaafa44
        lib/compiler/budget-formatter.ts: 23b876eee5619de92a327b6e9a8f7b3d46146021b0fccf91a1d6bbacd7002925
        lib/compiler/checkpoint-ladder.test.ts: f709202745e1807d7f14b3aea474c64d8008ef419b5586cc7b774eb2f54f95e9
        lib/compiler/checkpoint.test.ts: ff93c53ee31ea55563b7abccdb3108c70d510a7e3e1b6ca053256c82cef87974
        lib/compiler/checkpoint.ts: 65b409e1799e68e70a3440120d58e618fa4665f7a4b97970b30902a5c87951ed
        lib/compiler/conversation-reducer.phase4.test.ts: b9540ec821862376668d91c68faf166a01f68e2134f690275444f192beb0c25c
        lib/compiler/conversation-reducer.test.ts: 1ea56c0d5ffdac53c7ed5d1cc9c75050970e7cb4157af4618708ac6e63c5b7fb
        lib/compiler/conversation-reducer.ts: 57a3b7a08bf851137f6ea40e150f2f20be86f94d31469aaee1a2730efd5d0c1e
        lib/compiler/display-projection.test.ts: 310d7ff71b3603b5b6f736826ce9243136f918708362f2b7f67d6811e687cf9a
        lib/compiler/display-projection.ts: 27aedd88003afeb7d3b855ab88ec8f3783aae6efcbd4c926f70b1a44bbf23d65
        lib/compiler/errors.ts: bdb940fd1bb4b9b9e1958fddf23a774371794eaf6712123ca32e9a83957a18b7
        lib/compiler/evidence-lifetime.test.ts: 02349b64b03975289c8225f8a7e43769554e9303243b640dc46006f0c091050a
        lib/compiler/handoff-projection.test.ts: 0c1974fed453762934e057ce80ff7ee0cde2e62a1cb5ac231cf46bfba20fdf83
        lib/compiler/helpers.ts: 614594b7678e483bffd86ac664dc7a097bbbfdac4c28eb5f2d60c998fe09aaad
        lib/compiler/lexical-budget.ts: 7661f2775b25a75986b1fc539bed0efa544067573828a904ec681d8108e4f87b
        lib/compiler/normalizer.test.ts: 691742bcbcb087ddf5e83fd11ca85dfd884db94c58046ab463ee9aa1edf00491
        lib/compiler/normalizer.ts: 9dee1d55a09adbc6a36380701324cb92412988b9b50418211a755e9d43694f85
        lib/compiler/observed-readiness.test.ts: 371717edf02d8cbe08429c7ddc2f00a37d036610722c9e3971c4833a2b4bfb62
        lib/compiler/observed-readiness.ts: a61fe1797add41cbb1d0206fad44d414010b56d446787210acc0d44ec9bcc8f8
        lib/compiler/optional-selector.test.ts: 60e1de16a0af3c530b45fd626ef802058e04c664bbd8d831dafbe9ea3398210f
        lib/compiler/optional-selector.ts: 3028a31bb5e4f628eb762900374fad5d07267c70108f845b612dfea40bdd7061
        lib/compiler/path-roots.ts: 8b1771d0dac7e04f23e2076a681caa9f986e22ce6a8c91d36072fa7356c1ffa7
        lib/compiler/protected-overflow-regression.test.ts: a68ab7a94a586c576561f2a847b1b26dec78eb35f5c6f8b6a4231224ff16f672
        lib/compiler/request-candidate.test.ts: 756fb4d777d3aa1bc1a364352e8864a18d9db86514e2df784e631b173b0c935d
        lib/compiler/request-candidate.ts: 3b84f9386e7fc9beb299d7f46b6bbd74a91086b9cbac81ad056e6bc245067b1f
        lib/compiler/resume-index.test.ts: 27dd32d78a1e2ea88ee1278884c6e021407847587b44d16a368abf8c2a73599d
        lib/compiler/resume-index.ts: 0bb0fe3b835054b391858f13d5a4690f33ea505cc9e41ceb4d405a8ed9b81ed7
        lib/compiler/resume-plan.phase4.test.ts: 794b0955940d9831dc022059c0ec10c4e687353b967c5246559c922e851d76f7
        lib/compiler/section-scanner.test.ts: 54c9bde4ac6d8fd50363b1071c51f2714e7e6bbb9187abc2e13b63fcc97ee3d0
        lib/compiler/section-scanner.ts: 3f548fd9c41b115fd2620b2aa4ba571a0401a1fba4a88d49d26d1de2e82d9632
        lib/compiler/shell-analysis.test.ts: d76439d9ab2b1d4ae97392ea31659d999b60fc15993d4b262701ec6f7f3f8986
        lib/compiler/shell-analysis.ts: a44b9996d16b88122f2e287ec5ffafc2fbb211df308abe58d3551eda1e03696b
        lib/compiler/structural-v12.test.ts: a90f578c3bf6514c7c4f2ad5d3fd1cd08f1e2f2e91c7af6ad2b305d8124ba056
        lib/compiler/tool-effects-v12.test.ts: 398b4c9e476ede216ffd78d5ff4cd6bacce6c349f87c49bc181f81b5d8f14ddf
        lib/compiler/tool-effects.ts: 08462f0d2b52fa1d8a5a22115797759fd9d6f250ce9c0675061f3ed8ce3da526
        lib/compiler/tool-tracker.ts: 0f119a507a50361631f035e619db1e9dc77404b4a4d4fd636aa3885beef3ff17
        lib/compiler/types.ts: e039000df576be98758b4870f4d65644cdeca20a84a6e0f558d26e93c69910c4
        lib/compiler/verification-display.test.ts: 6e265a6f14bf320f322e5fa7db649c192f9702a1f20cafba811d8953b2e2cbea
        lib/compiler/verification-display.ts: c698e75804e37b1f5ce0f62602a139de10260cf3485d7436105bb037c6c46fc3
        lib/compiler/verification-observation.test.ts: 3110b011fb28a269ec045fb0ae63bb4e291f5fc090c7c20b00afcd65c3cb5276
        lib/compiler/verification-observation.ts: 0a50e89b868dc4522de0dbe57b695639a29c0dd7e257166f03d9364b12c1f536
        lib/continuation-recovery.test.ts: f87d36a7a646662da521da318260e73ba9ad1f853f1a207c1f1543727f1207ba
        lib/continuation-recovery.ts: 66645435aeb9fd3d53b209f6c96f39bd77c2c3103ba8f98d2b6966c6a2daa9aa
        lib/continuation.test.ts: 003c96689f72271a960ed65ce82a669fa830a92cca5f2c1a8813b789c7dffff0
        lib/continuation.ts: aeede077ece2b51e6698b3abcee9b04bbbb1d4ae8e41119e4bfdc3108b2d018b
        lib/data-migration.test.ts: 8674f7c68408e5e17416ce0f154ca10a8ea9f923a0d0a9ed6c145a70860bf478
        lib/data-migration.ts: f10e00e99a4ca076b3d82f97e2e9ecf6db4decc67ed8321179239407a789b51a
        lib/diag-support.test.ts: 8d1f675a3bf67a05cd11f313f2d19e594b0eb8caee75ccb725292428bbead9f8
        lib/diag-support.ts: 8bcc298e70155870262b32c124725b93890a1a75f57846ab5dc2f8b823851b81
        lib/entries-support.test.ts: 8220f20b7b83995db64a0961f2415319c7393613e3859903beb5203750c38f2c
        lib/entries-support.ts: a3f88f00943f790b5e3820c6b6e300cb7342561e1dbdab8d2a2feea57e867668
        lib/events-support.test.ts: 435dfd11eaf4a24104155c05d608fb7bf4652afc6886b63df42ff783e75e58bc
        lib/events-support.ts: 38d9a5228b96e4ce1a0fdda0ed437bb6bc8a5ff9ebece5f30544d2711b5502ac
        lib/extract-tags.ts: 9a31d5165d48710bd108118cc8d9c6f5a3351c1ba7b7533d1aaa455407c871a4
        lib/focus-echo.test.ts: 828d33fda65680a92af4d39e78886021eadc50e75b50345c858a5a829889ea07
        lib/focus-echo.ts: 2b2caa30257e4914a4b8c104d33b9f137cc5e6aa30719d8234be58c54404d551
        lib/fs-support.test.ts: 798d5b2d6ff1d667e1817d7e15f46a1386521e825e8735dea85552d43569c7e7
        lib/fs-support.ts: 781773b23e0dcca774b32b9d72a7384366aa32e72cb284aad70cdc0f4a9f638d
        lib/handoff.test.ts: 126b67aad40e34474560e3e11716b912f0a73a33dcd3babb6c55c959e56ee701
        lib/handoff.ts: 2a31c02abaad242fb1a8b37fb9a735902a9061dd77ba137177bf65b8f4e83aeb
        lib/json-object-keys.ts: 29506e7775909619e67bf2fd6a3174a0805140671fdd3caf8ee4545d3e6bd3ab
        lib/legacy-compat.test.ts: d65e8055b25a5d97f0b7c86ce96c7ffa3d71d52df5f36e8ed4ea12b040bad3ba
        lib/legacy.ts: 880a2c0b83050dfbb8bf31eee8d9cd628763017b7f8fa8502cf5faba55f681b1
        lib/local-compact.test.ts: d85835d8e8ed9898fb6d0001a670ec848f386d6fd9cbb21a2404724aa2e9ba8b
        lib/local-compact.ts: f30644758346df1b4551bb1de172fc65bf851e87be3c0b9ef018ade3cee05a3a
        lib/metric.test.ts: e8cfe49b5b87d67ff79e7a98691dbd88bc8334f62e41425ce3fddd078418d7ea
        lib/metric.ts: 4c2682b5858bf6f41e92bb9bf80463146813e16eb7f39fd700ed9088f030837b
        lib/monitor.test.ts: 1eeb119cbacb00b37afd7a883c016f9e8934342435a231a6b8911cb58087ccc8
        lib/monitor.ts: 5d832f113026968a03afc4f0e39560d19dd36c351f446b13293af7ad15583eb9
        lib/notify-support.test.ts: 753e639c9e7af3da17fe04016257d2ea976edb9f88638c6fd20fb02ec2184aba
        lib/notify-support.ts: eef58b4cd5e39dc246df5ccecc8a1e3ccca323751ca48fccd87f49947872e88d
        lib/offline/checkpoint-corpus.ts: 0a72f85ef6ae2bc816cfd73c4e4cf16da1773a308909e61cd127b8325483290b
        lib/offline/checkpoint-evaluator.test.ts: f69e4f8e24fccd35e9b2c19df43a012a2ae5764397ec83c2d4c0d3848d331846
        lib/offline/checkpoint-evaluator.ts: eac6b3aa8c45efbfd98717e93d20be5e684f9d539b82c28c3ee4681af9bb77df
        lib/offline/performance-gate.test.ts: 348a8b6d25b835e25ad1263f20da903cbfaeddc31539c107db05314420bccb46
        lib/offline/performance-gate.ts: fda5c8a2c1aaa6f1c167205bde70c8a0e8a3ddc78dd16deeec7c96e2955b1af4
        lib/offline/quality-corpus.ts: db57c6a8e3249ca3b22a9aaf4bdff41868b6c7a9bb52948d08575841c229dc96
        lib/offline/quality-evaluator.test.ts: b5229efda06630399d805b33dd9823d98bdfd3405146b6a7eaaeeba6f83e0ad6
        lib/offline/quality-evaluator.ts: 4b904d6a0cdb9ad4690d8377277fd292ffa42fbd850fa01e0477a3ac1f3ea4ac
        lib/offline/supplemental-corpus.ts: 67a6d152264a1175dc6dd56f74010058fd9b99b7111b4e6402dd93a8075748e2
        lib/offline/supplemental-evaluator.test.ts: a981d8f5a5f6a457aa7b0775b4b50662c16b5ad7e88f7447f1bd454edb9b7ecd
        lib/offline/supplemental-evaluator.ts: 39cdc53497afbb46a71a22ec7717c57bb05043c07960826d15ee5956cb3e3b5b
        lib/offline/survival-corpus.ts: ce740dd3eb31584b6efe97f538579ced28d4e68875347c75b429a645a82faa89
        lib/offline/survival-evaluator.test.ts: c47c76095dfe7c77c86b4c839d5fb3ee3adb06e0d36c7ae29683721af9a7dd72
        lib/offline/survival-evaluator.ts: a727b00c61468b695efe1cb4a1bced8dcd0be60b2f01052d284fcb19cdb0e233
        lib/output-compactor.test.ts: 819c399fce5cdc1639f0500bf15fe007774b7fba5dbc2d15d1880e7ca5bd13cb
        lib/output-compactor.ts: 9ebd68c1c7e82a98357d1a416935a5750cbf2980553644513102bf45dac1e524
        lib/paths.test.ts: 4786b00420e80ef17304f57e8e44a3ead0918edd37d050334267a2a7869ff9e2
        lib/paths.ts: a14afd19b1e330f64bebad580267c651464809377b00abcb555bcf0c489e1c5b
        lib/phase1-controller.test.ts: 6994035ad74027a19fd428aec4f1e60531e480cb13e7fdab32f972b2e50e2ae4
        lib/phase1-controller.ts: dbda83ed14bd87b327882a5aa425e5015c74d28042316c0792e15b9038dd77dd
        lib/phase1-lifecycle.property.test.ts: 9f1e47135522544f0b80e73805af2c629ad0af6d374f69c5ea8f22ae09cb9129
        lib/recall-entry.ts: f95094d09264906e083d76073b64d276af10caf4a69cbe7057bba0377b58f680
        lib/recall-projection.test.ts: fcd199d1ac107167871560ac6aad3a737a1be843ad1481c0bfb7b40f7aa1fff4
        lib/recall-projection.ts: 34d0523d3a3aab93f69705c7589d97d49f34ea6c5f9e1ada9045fdb4cea3a658
        lib/recall.test.ts: e90896852ccf2c1ca4d1d853238d3095fcad2f04f5f40352a9d7ad936f86d7a3
        lib/recall.ts: b87ca426ef87f0945f517218182d5473cfd65444e3e4eacacdaf685ef431491f
        lib/resumption-fidelity.test.ts: 955e8b60828aac8a91c8804a607608135e700e1a518a04af2c62fcdb0eec2846
        lib/runtime-probe.ts: 5a384c1d5f730ff6c62714b10ecda71090aaee19b7c8f1bba144d74a030b1f77
        lib/sdk.ts: 81ef935bdfe4a6daa8cda7cf585a7c7f0295a644fbb709fc38cef03906768937
        lib/session-evaluator.test.ts: cdcb0cb4b9b3c15899433ed4836984a84558f3a9bd78e4e940b193f6fdbb81cc
        lib/session-evaluator.ts: a4e0d0ab76bf3672f149e64b936e9c593a51165a1581616178d7cfc4897d0722
        lib/settings.test.ts: 871e2332afca88f92ecf31a9fc84bfdbe9e099aced6d9c97ec0702eb1fd7f309
        lib/settings.ts: 0017d98b0668145b586eb20ac42d96ecc089210e73711bac0002892fa98a7a7f
        lib/sha256.test.ts: 9131960dae17083192659dd10196b4fb83a998b70d4bed88d3073acab41fe85b
        lib/sha256.ts: 523f5efaa3ac2982f8f833240cb002351b52721420c48309a34f05f5b07dd125
        lib/store.test.ts: 856fbd303337d059314b858aaf5004a39198b92d49f35efe17d0a2612c53d3e1
        lib/store.ts: 3a8d1f9db3e38a66e33fdc365a03d5aa0e38761d45815595c16c45176bd97b37
        lib/strategy.test.ts: e549e307fb40eea44731981eafd5ed08d39dbce392f938d7f38ce44845bd662d
        lib/strategy.ts: 65a116cd0ae9d72c61afaed2b49947f4e6d8351f522446dc6f17f974b53e2b36
        lib/tool-result.test.ts: 85e238dadf1beea81baccc3361fffb96ca6a1ac6a101213c6f98e42f36dc3f76
        lib/tool-result.ts: 6cecb489009b8f7406b18ced9a0a6f2a19757c9a0efc020e197ee53c115bfd11
        lib/trigger.test.ts: a7b74a128989c66951d1e567fda7a19d6e32af1bf56a8e0722e5430cd894b658
        lib/trigger.ts: 5fa705fc16a31dcd2fedc703a7fb8ef1ad5069b60618aa4a1018d9f4ec31c206
        lib/tui-block.test.ts: ee25d80023627b5c63fadd15aa8978135e09006b0962f74fa2dacb6b410a1de1
        lib/tui-block.ts: 2c7200875c91b2cadf05d6ca88b7d7748f1f249c42b68937852f674ed50cea7c
        lib/types.ts: aade627b2f2683de80a138cc81ae59a71d25e4151e953b0fdf8040a3aa08809f
        lib/unicode.test.ts: 9f4b8ad3dea9b38f3e373575cf29e07898564e55be88627eb9b571deda013521
        lib/unicode.ts: 2a1a14f6c87a12f5acc1ef0ed8b10f3e30912f6344d46d1928f2a3a1434ca123
        lib/wire-format.ts: b149adac61adfc596173474e33d432cd93263e81a90608c70af755f44df2f9fa
        package.json: c59b7f5e269b4cb79288f9a880a2408dde2082b5b2b76e162a6e8f2b2b47a681
        scripts/benchmark-compiler.ts: 9e2bc7e815c273621e7312b3e54b8ddff0897180c444dbd08b016a87c7075f1a
        scripts/check-architecture.ts: abfedfb9a1fe62f32dac370a9579f14f4010e4dc78ba93c2cb33ba5d85697480
        scripts/evaluate-selector.ts: 59f6eeada8b20f3d7893f87f15d32ec4b87e07c1585e7c9af94b332f532b8c37
        tests/compare-session.ts: eecb3847c156685dc634be07033a55b41b44f385f1e8723ae8d59d8ea1562792
        tests/e2e/README.md: 92ab2889d74d1f9f3cd6e2270c42c55198141bad6efa4aca061553fa32822a8b
        tests/e2e/busy-compaction.e2e.ts: df742676f8b66743773a8eca41de6de06d6ca6dd0308f95ca41d7022ad21f937
        tests/e2e/current-compaction.test.ts: 9efd50ccfa00f3645e076a4614ae5ea480320eb92c4c74e36ae1caf516cd95a9
        tests/e2e/demo.ts: 866b6d6a0ec2fd77d7bfe478dd49234a1855a05dfde83b3672f18bf46ea6fd78
        tests/e2e/harness/compaction-barrier.ts: c303a0bcde5d55b521570a5e06c0beaf86a1f47f81ac457ec77f7a4bb97db58e
        tests/e2e/harness/current-compaction.ts: 30009cbf2bd0bf92579480ba06acba76db7415839d38dea61aa50861f137b8bf
        tests/e2e/harness/env.ts: 80d510793aee4cc973e8dd59110a5b5871deea0a53fd26b93962325e94b06b99
        tests/e2e/harness/fake-provider.ts: 660fcff8b643a9bc3e749bb912acacd0384bdae41389ab7e2d2b5f405c8aa7f1
        tests/e2e/harness/preparation-fault.ts: 1d2e977db7ca4f80cedcc6452414e700113a5d870ee9f480c7c7c33dd9fbb15d
        tests/e2e/harness/rpc-client.ts: 42525b4925d12d0cebdeb92b5cab758369975f0e7e6a70eb10b4028bb07c3b31
        tests/e2e/interception.e2e.ts: b2cefbc64ab9d5b5213dbd9398eb09612945729565038e1a4ee3ebf6168e3a90
        tests/e2e/lifecycle.e2e.ts: 6468c3c34a2f5355d6a95c57350157ef8d34a0357121ed54ba9a8e82296a4fd7
        tests/fixtures/parser-session.jsonl: 50575fa33d879ec0e2ce4b1455545dd2836f12d37f54f4a6e731794b387c40e7
        tests/harness/fake-pi.ts: 471929329a9da287771609a65655e393b95eed3f9b8c07a8799dc12d48d1caf6
        tests/harness/preparation-fixture.ts: ec8bf72df94a9f82c24d719df8f10ccea9db3eb814a6654f1fa3514979ffedae
        tests/verify-improvement.test.ts: a9a5f39929a9c12274c448bfb574fbbc92e9c28df4ae3736876be3608019e433
        tsconfig.json: 08529066dec16388122122f2582069e400770a8587711b912794e10896615b0f
      at: 2026-10-05T23:43:08.292Z
    intended: run frozen gate TG3
    next_action: continue next frozen gate or diagnose failure
    after:
      digest: df406a8f72d7e1c8cc1e3cb948747ce98dcb0839c47303ee11663adbc4530010
      entries:
        .dependency-cruiser.cjs: f90d4b8c206440cc7006c105126ddb091a8ae57bc1a8225b49b54e63b0356edf
        .gitignore: 8f21e3b9b123ffa75121a0ae451782c432407acc21cc784d8fc095cd3e8c3cf7
        AGENTS.md: af56ae1e888439e976f2eac7ecf8c447ff2f73f99bba3b8900dcdf1add2b4286
        CLAUDE.md: symlink:AGENTS.md
        LICENSE: e2e52298290bec0f61398b5684006a59f0d8e2a7374e7f4cd134d5c36b660a47
        README.md: 4dae887df73702ccaf751e5683a42c298a59ecb1dee9251f5c4072ca4bb62e2f
        bin/dc-distill-session.ts: 15d9306ff37153205e88eda1baab634e341e2a25e6c9da5ca409f6762192524f
        bun.lock: 997ed36d6a2500f0e8ab160da30dd689f3c12e885e42933fe03e8aa7746e61eb
        debug/checkpoint-gate.ts: 6ac8afb9d7315db48851f95a64237676fe45cff3afe6b3fc62798f32d0076f6f
        debug/live-repro.ts: df3cd57568e1b68ccf2b21bd8d4acbf0802779d916e56b8de1a59a01ae69c3ad
        docs-contract.test.ts: e176e2eed18179cc551e295bae31f58c8730aa1e26321fce22c5b266f03fbaae
        docs/adr/0001-vendored-framework-boundary.md: 1388e4baba3d47fc433924c9807239fe50c596b57f318675c42b667b38c7329a
        docs/adr/0002-remove-vendored-framework.md: 2fbfc6def5635e9bfc1c5d2359ad779954c6f39dbebbd2bdf9417c93bd06d634
        docs/algorithm.md: 996beaaa59f3813f03b075ae2168120f2b47a133a695da75a457f93bc94c6d02
        docs/architecture.md: acf03df39fbb9e7a230a14cfba7ac3853c56a68bf3a45851ddb9c0ac2f1eb0ee
        docs/assets/distill-before-after.svg: 80ab3aa5b4f4bf2032daed7f08ecf25ffea586c5b733fa87163367964b8c0b50
        docs/compiler-benchmark.md: 0c9735e4a0f38cfe1f04ba955e103af19de7bc7fffc8506f03cf08f5e42380e4
        docs/releasing.md: a46134cd81e46690b0d0a5003c82c28d676fcd038fc25c5545a1cb0e2f832f3f
        docs/settings.md: fb6ff8195aea5e7198c58978b2ddd576bad291344283fbc3ef0ab0eb0f25e45a
        docs/troubleshooting.md: 118e91a571558a0d6aed99c7dfcafd592f31022faad6e5ad6b076c5a9c688b73
        docs/usage.md: a61aa7631a95fd2724ddba95933fbb9a5e951d7cf268957f5907a8ad459ffb3a
        index.phase1.test.ts: 113dcc79a51a216e0f23372a352992f55cf163b0e594982b5621d40285fa305e
        index.phase5.test.ts: 2bb02a7aab442d06941042d5088902dc29d24ca00bfde8f94a5868b9fc686020
        index.test.ts: b8697744329f12560b0205679a046046552d32477f498bf65767560a915ccbaf
        index.ts: 033710154492de4ed5d452aa4d07fa65c192cc3dde683dcb238c643952870bee
        index.v12.test.ts: 4b3bbd27accf76f6969a3e85401b6dd6884e234def14bc083437c91eabc59701
        lib/bm25.test.ts: 0fdcb41087f8fd5c62624088aae64b14f1cde65da45e1898cc85ca2038650b4c
        lib/bm25.ts: 00ec5ea25040b9fe88e0cd5538d5aa75aa1a6d5ea1b9fac3ecd491e905e08537
        lib/cache-runs.test.ts: 065effd0b1c7be678077d0137d498b87a38c2328a630473b86966ea8463e2be0
        lib/cache-runs.ts: e384ac5736b8f3803dc226f3483e9c01a7b725fb2839073b8cf66c6f0f21f421
        lib/checkpoint-update.test.ts: fe2480ef76ac8cfa716e5552f5c83e82155134d54e522c9ac692a986d6102285
        lib/checkpoint-update.ts: dbb4115a98e445149c4900922128248aa08177683525117a5581b7af8f892e22
        lib/compaction-card-dedupe.test.ts: 2af0cfcfa9c33744bd821fb435fbbcdeb9f3e5f3119f08d6ab7ad239d8638899
        lib/compaction-card-dedupe.ts: b15f9286e1715e9e47ce6ab04a5cef57260f541115c970507b36b950a7529e58
        lib/compaction-card.test.ts: 10efd22edb9e70155be542385f4f8e9b28a2085b6a30e87da22ef6491b37d060
        lib/compaction-card.ts: 3eba217ca318cce075ebe6d1f0776efa3c523f43a553406fe4e01af63f2a95db
        lib/compaction-source.test.ts: 7d043e9afa9ca2636996f9fff478e480e4254bfbe1742d21d0e7a5331541592f
        lib/compaction-source.ts: df5fac5b9a5853759ffc042c3c9d463dcef91ad746034cd6c52773b620267243
        lib/compile-session-file.ts: 37795fbc5054717b2aae8eff343079c68c12f6c8eb62189dc95c25fcef7a90b6
        lib/compiler/anchors.ts: da9d1e8fba8cbc84054f7b73f5bf85be7fe12692bc5f4624538cbdef370f953e
        lib/compiler/budget-formatter.test.ts: e2c2af5a4a041dc2b6c87c29b19f249db32a90e1476437d5407788399aaafa44
        lib/compiler/budget-formatter.ts: 23b876eee5619de92a327b6e9a8f7b3d46146021b0fccf91a1d6bbacd7002925
        lib/compiler/checkpoint-ladder.test.ts: f709202745e1807d7f14b3aea474c64d8008ef419b5586cc7b774eb2f54f95e9
        lib/compiler/checkpoint.test.ts: ff93c53ee31ea55563b7abccdb3108c70d510a7e3e1b6ca053256c82cef87974
        lib/compiler/checkpoint.ts: 65b409e1799e68e70a3440120d58e618fa4665f7a4b97970b30902a5c87951ed
        lib/compiler/conversation-reducer.phase4.test.ts: b9540ec821862376668d91c68faf166a01f68e2134f690275444f192beb0c25c
        lib/compiler/conversation-reducer.test.ts: 1ea56c0d5ffdac53c7ed5d1cc9c75050970e7cb4157af4618708ac6e63c5b7fb
        lib/compiler/conversation-reducer.ts: 57a3b7a08bf851137f6ea40e150f2f20be86f94d31469aaee1a2730efd5d0c1e
        lib/compiler/display-projection.test.ts: 310d7ff71b3603b5b6f736826ce9243136f918708362f2b7f67d6811e687cf9a
        lib/compiler/display-projection.ts: 27aedd88003afeb7d3b855ab88ec8f3783aae6efcbd4c926f70b1a44bbf23d65
        lib/compiler/errors.ts: bdb940fd1bb4b9b9e1958fddf23a774371794eaf6712123ca32e9a83957a18b7
        lib/compiler/evidence-lifetime.test.ts: 02349b64b03975289c8225f8a7e43769554e9303243b640dc46006f0c091050a
        lib/compiler/handoff-projection.test.ts: 0c1974fed453762934e057ce80ff7ee0cde2e62a1cb5ac231cf46bfba20fdf83
        lib/compiler/helpers.ts: 614594b7678e483bffd86ac664dc7a097bbbfdac4c28eb5f2d60c998fe09aaad
        lib/compiler/lexical-budget.ts: 7661f2775b25a75986b1fc539bed0efa544067573828a904ec681d8108e4f87b
        lib/compiler/normalizer.test.ts: 691742bcbcb087ddf5e83fd11ca85dfd884db94c58046ab463ee9aa1edf00491
        lib/compiler/normalizer.ts: 9dee1d55a09adbc6a36380701324cb92412988b9b50418211a755e9d43694f85
        lib/compiler/observed-readiness.test.ts: 371717edf02d8cbe08429c7ddc2f00a37d036610722c9e3971c4833a2b4bfb62
        lib/compiler/observed-readiness.ts: a61fe1797add41cbb1d0206fad44d414010b56d446787210acc0d44ec9bcc8f8
        lib/compiler/optional-selector.test.ts: 60e1de16a0af3c530b45fd626ef802058e04c664bbd8d831dafbe9ea3398210f
        lib/compiler/optional-selector.ts: 3028a31bb5e4f628eb762900374fad5d07267c70108f845b612dfea40bdd7061
        lib/compiler/path-roots.ts: 8b1771d0dac7e04f23e2076a681caa9f986e22ce6a8c91d36072fa7356c1ffa7
        lib/compiler/protected-overflow-regression.test.ts: a68ab7a94a586c576561f2a847b1b26dec78eb35f5c6f8b6a4231224ff16f672
        lib/compiler/request-candidate.test.ts: 756fb4d777d3aa1bc1a364352e8864a18d9db86514e2df784e631b173b0c935d
        lib/compiler/request-candidate.ts: 3b84f9386e7fc9beb299d7f46b6bbd74a91086b9cbac81ad056e6bc245067b1f
        lib/compiler/resume-index.test.ts: 27dd32d78a1e2ea88ee1278884c6e021407847587b44d16a368abf8c2a73599d
        lib/compiler/resume-index.ts: 0bb0fe3b835054b391858f13d5a4690f33ea505cc9e41ceb4d405a8ed9b81ed7
        lib/compiler/resume-plan.phase4.test.ts: 794b0955940d9831dc022059c0ec10c4e687353b967c5246559c922e851d76f7
        lib/compiler/section-scanner.test.ts: 54c9bde4ac6d8fd50363b1071c51f2714e7e6bbb9187abc2e13b63fcc97ee3d0
        lib/compiler/section-scanner.ts: 3f548fd9c41b115fd2620b2aa4ba571a0401a1fba4a88d49d26d1de2e82d9632
        lib/compiler/shell-analysis.test.ts: d76439d9ab2b1d4ae97392ea31659d999b60fc15993d4b262701ec6f7f3f8986
        lib/compiler/shell-analysis.ts: a44b9996d16b88122f2e287ec5ffafc2fbb211df308abe58d3551eda1e03696b
        lib/compiler/structural-v12.test.ts: a90f578c3bf6514c7c4f2ad5d3fd1cd08f1e2f2e91c7af6ad2b305d8124ba056
        lib/compiler/tool-effects-v12.test.ts: 398b4c9e476ede216ffd78d5ff4cd6bacce6c349f87c49bc181f81b5d8f14ddf
        lib/compiler/tool-effects.ts: 08462f0d2b52fa1d8a5a22115797759fd9d6f250ce9c0675061f3ed8ce3da526
        lib/compiler/tool-tracker.ts: 0f119a507a50361631f035e619db1e9dc77404b4a4d4fd636aa3885beef3ff17
        lib/compiler/types.ts: e039000df576be98758b4870f4d65644cdeca20a84a6e0f558d26e93c69910c4
        lib/compiler/verification-display.test.ts: 6e265a6f14bf320f322e5fa7db649c192f9702a1f20cafba811d8953b2e2cbea
        lib/compiler/verification-display.ts: c698e75804e37b1f5ce0f62602a139de10260cf3485d7436105bb037c6c46fc3
        lib/compiler/verification-observation.test.ts: 3110b011fb28a269ec045fb0ae63bb4e291f5fc090c7c20b00afcd65c3cb5276
        lib/compiler/verification-observation.ts: 0a50e89b868dc4522de0dbe57b695639a29c0dd7e257166f03d9364b12c1f536
        lib/continuation-recovery.test.ts: f87d36a7a646662da521da318260e73ba9ad1f853f1a207c1f1543727f1207ba
        lib/continuation-recovery.ts: 66645435aeb9fd3d53b209f6c96f39bd77c2c3103ba8f98d2b6966c6a2daa9aa
        lib/continuation.test.ts: 003c96689f72271a960ed65ce82a669fa830a92cca5f2c1a8813b789c7dffff0
        lib/continuation.ts: aeede077ece2b51e6698b3abcee9b04bbbb1d4ae8e41119e4bfdc3108b2d018b
        lib/data-migration.test.ts: 8674f7c68408e5e17416ce0f154ca10a8ea9f923a0d0a9ed6c145a70860bf478
        lib/data-migration.ts: f10e00e99a4ca076b3d82f97e2e9ecf6db4decc67ed8321179239407a789b51a
        lib/diag-support.test.ts: 8d1f675a3bf67a05cd11f313f2d19e594b0eb8caee75ccb725292428bbead9f8
        lib/diag-support.ts: 8bcc298e70155870262b32c124725b93890a1a75f57846ab5dc2f8b823851b81
        lib/entries-support.test.ts: 8220f20b7b83995db64a0961f2415319c7393613e3859903beb5203750c38f2c
        lib/entries-support.ts: a3f88f00943f790b5e3820c6b6e300cb7342561e1dbdab8d2a2feea57e867668
        lib/events-support.test.ts: 435dfd11eaf4a24104155c05d608fb7bf4652afc6886b63df42ff783e75e58bc
        lib/events-support.ts: 38d9a5228b96e4ce1a0fdda0ed437bb6bc8a5ff9ebece5f30544d2711b5502ac
        lib/extract-tags.ts: 9a31d5165d48710bd108118cc8d9c6f5a3351c1ba7b7533d1aaa455407c871a4
        lib/focus-echo.test.ts: 828d33fda65680a92af4d39e78886021eadc50e75b50345c858a5a829889ea07
        lib/focus-echo.ts: 2b2caa30257e4914a4b8c104d33b9f137cc5e6aa30719d8234be58c54404d551
        lib/fs-support.test.ts: 798d5b2d6ff1d667e1817d7e15f46a1386521e825e8735dea85552d43569c7e7
        lib/fs-support.ts: 781773b23e0dcca774b32b9d72a7384366aa32e72cb284aad70cdc0f4a9f638d
        lib/handoff.test.ts: 126b67aad40e34474560e3e11716b912f0a73a33dcd3babb6c55c959e56ee701
        lib/handoff.ts: 2a31c02abaad242fb1a8b37fb9a735902a9061dd77ba137177bf65b8f4e83aeb
        lib/json-object-keys.ts: 29506e7775909619e67bf2fd6a3174a0805140671fdd3caf8ee4545d3e6bd3ab
        lib/legacy-compat.test.ts: d65e8055b25a5d97f0b7c86ce96c7ffa3d71d52df5f36e8ed4ea12b040bad3ba
        lib/legacy.ts: 880a2c0b83050dfbb8bf31eee8d9cd628763017b7f8fa8502cf5faba55f681b1
        lib/local-compact.test.ts: d85835d8e8ed9898fb6d0001a670ec848f386d6fd9cbb21a2404724aa2e9ba8b
        lib/local-compact.ts: f30644758346df1b4551bb1de172fc65bf851e87be3c0b9ef018ade3cee05a3a
        lib/metric.test.ts: e8cfe49b5b87d67ff79e7a98691dbd88bc8334f62e41425ce3fddd078418d7ea
        lib/metric.ts: 4c2682b5858bf6f41e92bb9bf80463146813e16eb7f39fd700ed9088f030837b
        lib/monitor.test.ts: 1eeb119cbacb00b37afd7a883c016f9e8934342435a231a6b8911cb58087ccc8
        lib/monitor.ts: 5d832f113026968a03afc4f0e39560d19dd36c351f446b13293af7ad15583eb9
        lib/notify-support.test.ts: 753e639c9e7af3da17fe04016257d2ea976edb9f88638c6fd20fb02ec2184aba
        lib/notify-support.ts: eef58b4cd5e39dc246df5ccecc8a1e3ccca323751ca48fccd87f49947872e88d
        lib/offline/checkpoint-corpus.ts: 0a72f85ef6ae2bc816cfd73c4e4cf16da1773a308909e61cd127b8325483290b
        lib/offline/checkpoint-evaluator.test.ts: f69e4f8e24fccd35e9b2c19df43a012a2ae5764397ec83c2d4c0d3848d331846
        lib/offline/checkpoint-evaluator.ts: eac6b3aa8c45efbfd98717e93d20be5e684f9d539b82c28c3ee4681af9bb77df
        lib/offline/performance-gate.test.ts: 348a8b6d25b835e25ad1263f20da903cbfaeddc31539c107db05314420bccb46
        lib/offline/performance-gate.ts: fda5c8a2c1aaa6f1c167205bde70c8a0e8a3ddc78dd16deeec7c96e2955b1af4
        lib/offline/quality-corpus.ts: db57c6a8e3249ca3b22a9aaf4bdff41868b6c7a9bb52948d08575841c229dc96
        lib/offline/quality-evaluator.test.ts: b5229efda06630399d805b33dd9823d98bdfd3405146b6a7eaaeeba6f83e0ad6
        lib/offline/quality-evaluator.ts: 4b904d6a0cdb9ad4690d8377277fd292ffa42fbd850fa01e0477a3ac1f3ea4ac
        lib/offline/supplemental-corpus.ts: 67a6d152264a1175dc6dd56f74010058fd9b99b7111b4e6402dd93a8075748e2
        lib/offline/supplemental-evaluator.test.ts: a981d8f5a5f6a457aa7b0775b4b50662c16b5ad7e88f7447f1bd454edb9b7ecd
        lib/offline/supplemental-evaluator.ts: 39cdc53497afbb46a71a22ec7717c57bb05043c07960826d15ee5956cb3e3b5b
        lib/offline/survival-corpus.ts: ce740dd3eb31584b6efe97f538579ced28d4e68875347c75b429a645a82faa89
        lib/offline/survival-evaluator.test.ts: c47c76095dfe7c77c86b4c839d5fb3ee3adb06e0d36c7ae29683721af9a7dd72
        lib/offline/survival-evaluator.ts: a727b00c61468b695efe1cb4a1bced8dcd0be60b2f01052d284fcb19cdb0e233
        lib/output-compactor.test.ts: 819c399fce5cdc1639f0500bf15fe007774b7fba5dbc2d15d1880e7ca5bd13cb
        lib/output-compactor.ts: 9ebd68c1c7e82a98357d1a416935a5750cbf2980553644513102bf45dac1e524
        lib/paths.test.ts: 4786b00420e80ef17304f57e8e44a3ead0918edd37d050334267a2a7869ff9e2
        lib/paths.ts: a14afd19b1e330f64bebad580267c651464809377b00abcb555bcf0c489e1c5b
        lib/phase1-controller.test.ts: 6994035ad74027a19fd428aec4f1e60531e480cb13e7fdab32f972b2e50e2ae4
        lib/phase1-controller.ts: dbda83ed14bd87b327882a5aa425e5015c74d28042316c0792e15b9038dd77dd
        lib/phase1-lifecycle.property.test.ts: 9f1e47135522544f0b80e73805af2c629ad0af6d374f69c5ea8f22ae09cb9129
        lib/recall-entry.ts: f95094d09264906e083d76073b64d276af10caf4a69cbe7057bba0377b58f680
        lib/recall-projection.test.ts: fcd199d1ac107167871560ac6aad3a737a1be843ad1481c0bfb7b40f7aa1fff4
        lib/recall-projection.ts: 34d0523d3a3aab93f69705c7589d97d49f34ea6c5f9e1ada9045fdb4cea3a658
        lib/recall.test.ts: e90896852ccf2c1ca4d1d853238d3095fcad2f04f5f40352a9d7ad936f86d7a3
        lib/recall.ts: b87ca426ef87f0945f517218182d5473cfd65444e3e4eacacdaf685ef431491f
        lib/resumption-fidelity.test.ts: 955e8b60828aac8a91c8804a607608135e700e1a518a04af2c62fcdb0eec2846
        lib/runtime-probe.ts: 5a384c1d5f730ff6c62714b10ecda71090aaee19b7c8f1bba144d74a030b1f77
        lib/sdk.ts: 81ef935bdfe4a6daa8cda7cf585a7c7f0295a644fbb709fc38cef03906768937
        lib/session-evaluator.test.ts: cdcb0cb4b9b3c15899433ed4836984a84558f3a9bd78e4e940b193f6fdbb81cc
        lib/session-evaluator.ts: a4e0d0ab76bf3672f149e64b936e9c593a51165a1581616178d7cfc4897d0722
        lib/settings.test.ts: 871e2332afca88f92ecf31a9fc84bfdbe9e099aced6d9c97ec0702eb1fd7f309
        lib/settings.ts: 0017d98b0668145b586eb20ac42d96ecc089210e73711bac0002892fa98a7a7f
        lib/sha256.test.ts: 9131960dae17083192659dd10196b4fb83a998b70d4bed88d3073acab41fe85b
        lib/sha256.ts: 523f5efaa3ac2982f8f833240cb002351b52721420c48309a34f05f5b07dd125
        lib/store.test.ts: 856fbd303337d059314b858aaf5004a39198b92d49f35efe17d0a2612c53d3e1
        lib/store.ts: 3a8d1f9db3e38a66e33fdc365a03d5aa0e38761d45815595c16c45176bd97b37
        lib/strategy.test.ts: e549e307fb40eea44731981eafd5ed08d39dbce392f938d7f38ce44845bd662d
        lib/strategy.ts: 65a116cd0ae9d72c61afaed2b49947f4e6d8351f522446dc6f17f974b53e2b36
        lib/tool-result.test.ts: 85e238dadf1beea81baccc3361fffb96ca6a1ac6a101213c6f98e42f36dc3f76
        lib/tool-result.ts: 6cecb489009b8f7406b18ced9a0a6f2a19757c9a0efc020e197ee53c115bfd11
        lib/trigger.test.ts: a7b74a128989c66951d1e567fda7a19d6e32af1bf56a8e0722e5430cd894b658
        lib/trigger.ts: 5fa705fc16a31dcd2fedc703a7fb8ef1ad5069b60618aa4a1018d9f4ec31c206
        lib/tui-block.test.ts: ee25d80023627b5c63fadd15aa8978135e09006b0962f74fa2dacb6b410a1de1
        lib/tui-block.ts: 2c7200875c91b2cadf05d6ca88b7d7748f1f249c42b68937852f674ed50cea7c
        lib/types.ts: aade627b2f2683de80a138cc81ae59a71d25e4151e953b0fdf8040a3aa08809f
        lib/unicode.test.ts: 9f4b8ad3dea9b38f3e373575cf29e07898564e55be88627eb9b571deda013521
        lib/unicode.ts: 2a1a14f6c87a12f5acc1ef0ed8b10f3e30912f6344d46d1928f2a3a1434ca123
        lib/wire-format.ts: b149adac61adfc596173474e33d432cd93263e81a90608c70af755f44df2f9fa
        package.json: c59b7f5e269b4cb79288f9a880a2408dde2082b5b2b76e162a6e8f2b2b47a681
        scripts/benchmark-compiler.ts: 9e2bc7e815c273621e7312b3e54b8ddff0897180c444dbd08b016a87c7075f1a
        scripts/check-architecture.ts: abfedfb9a1fe62f32dac370a9579f14f4010e4dc78ba93c2cb33ba5d85697480
        scripts/evaluate-selector.ts: 59f6eeada8b20f3d7893f87f15d32ec4b87e07c1585e7c9af94b332f532b8c37
        tests/compare-session.ts: eecb3847c156685dc634be07033a55b41b44f385f1e8723ae8d59d8ea1562792
        tests/e2e/README.md: 92ab2889d74d1f9f3cd6e2270c42c55198141bad6efa4aca061553fa32822a8b
        tests/e2e/busy-compaction.e2e.ts: df742676f8b66743773a8eca41de6de06d6ca6dd0308f95ca41d7022ad21f937
        tests/e2e/current-compaction.test.ts: 9efd50ccfa00f3645e076a4614ae5ea480320eb92c4c74e36ae1caf516cd95a9
        tests/e2e/demo.ts: 866b6d6a0ec2fd77d7bfe478dd49234a1855a05dfde83b3672f18bf46ea6fd78
        tests/e2e/harness/compaction-barrier.ts: c303a0bcde5d55b521570a5e06c0beaf86a1f47f81ac457ec77f7a4bb97db58e
        tests/e2e/harness/current-compaction.ts: 30009cbf2bd0bf92579480ba06acba76db7415839d38dea61aa50861f137b8bf
        tests/e2e/harness/env.ts: 80d510793aee4cc973e8dd59110a5b5871deea0a53fd26b93962325e94b06b99
        tests/e2e/harness/fake-provider.ts: 660fcff8b643a9bc3e749bb912acacd0384bdae41389ab7e2d2b5f405c8aa7f1
        tests/e2e/harness/preparation-fault.ts: 1d2e977db7ca4f80cedcc6452414e700113a5d870ee9f480c7c7c33dd9fbb15d
        tests/e2e/harness/rpc-client.ts: 42525b4925d12d0cebdeb92b5cab758369975f0e7e6a70eb10b4028bb07c3b31
        tests/e2e/interception.e2e.ts: b2cefbc64ab9d5b5213dbd9398eb09612945729565038e1a4ee3ebf6168e3a90
        tests/e2e/lifecycle.e2e.ts: 6468c3c34a2f5355d6a95c57350157ef8d34a0357121ed54ba9a8e82296a4fd7
        tests/fixtures/parser-session.jsonl: 50575fa33d879ec0e2ce4b1455545dd2836f12d37f54f4a6e731794b387c40e7
        tests/harness/fake-pi.ts: 471929329a9da287771609a65655e393b95eed3f9b8c07a8799dc12d48d1caf6
        tests/harness/preparation-fixture.ts: ec8bf72df94a9f82c24d719df8f10ccea9db3eb814a6654f1fa3514979ffedae
        tests/verify-improvement.test.ts: a9a5f39929a9c12274c448bfb574fbbc92e9c28df4ae3736876be3608019e433
        tsconfig.json: 08529066dec16388122122f2582069e400770a8587711b912794e10896615b0f
      at: 2026-10-05T23:43:09.121Z
    result: passed
    evidence:
      gate: TG3
      command: bun x tsc --noEmit
      working_directory: /Users/vampire/code/ts/pi-dc-distill
      exit: 0
      signal: null
      started: 2026-10-05T23:43:08.349Z
      ended: 2026-10-05T23:43:09.049Z
      log: /tmp/current-compaction-TG3.log
      output: ""
  - kind: checkpoint
    checkpoint_id: current-compaction-TG4
    operation_id: current-compaction-TG4
    operation_kind: gate
    gate: TG4
    phase: reconciled
    task: T1
    contract_digest: 5ca4752235ecf4aab1ed380d9723e19319ae181d8eba7a5ae8361c1dcaefb878
    before:
      digest: df406a8f72d7e1c8cc1e3cb948747ce98dcb0839c47303ee11663adbc4530010
      entries:
        .dependency-cruiser.cjs: f90d4b8c206440cc7006c105126ddb091a8ae57bc1a8225b49b54e63b0356edf
        .gitignore: 8f21e3b9b123ffa75121a0ae451782c432407acc21cc784d8fc095cd3e8c3cf7
        AGENTS.md: af56ae1e888439e976f2eac7ecf8c447ff2f73f99bba3b8900dcdf1add2b4286
        CLAUDE.md: symlink:AGENTS.md
        LICENSE: e2e52298290bec0f61398b5684006a59f0d8e2a7374e7f4cd134d5c36b660a47
        README.md: 4dae887df73702ccaf751e5683a42c298a59ecb1dee9251f5c4072ca4bb62e2f
        bin/dc-distill-session.ts: 15d9306ff37153205e88eda1baab634e341e2a25e6c9da5ca409f6762192524f
        bun.lock: 997ed36d6a2500f0e8ab160da30dd689f3c12e885e42933fe03e8aa7746e61eb
        debug/checkpoint-gate.ts: 6ac8afb9d7315db48851f95a64237676fe45cff3afe6b3fc62798f32d0076f6f
        debug/live-repro.ts: df3cd57568e1b68ccf2b21bd8d4acbf0802779d916e56b8de1a59a01ae69c3ad
        docs-contract.test.ts: e176e2eed18179cc551e295bae31f58c8730aa1e26321fce22c5b266f03fbaae
        docs/adr/0001-vendored-framework-boundary.md: 1388e4baba3d47fc433924c9807239fe50c596b57f318675c42b667b38c7329a
        docs/adr/0002-remove-vendored-framework.md: 2fbfc6def5635e9bfc1c5d2359ad779954c6f39dbebbd2bdf9417c93bd06d634
        docs/algorithm.md: 996beaaa59f3813f03b075ae2168120f2b47a133a695da75a457f93bc94c6d02
        docs/architecture.md: acf03df39fbb9e7a230a14cfba7ac3853c56a68bf3a45851ddb9c0ac2f1eb0ee
        docs/assets/distill-before-after.svg: 80ab3aa5b4f4bf2032daed7f08ecf25ffea586c5b733fa87163367964b8c0b50
        docs/compiler-benchmark.md: 0c9735e4a0f38cfe1f04ba955e103af19de7bc7fffc8506f03cf08f5e42380e4
        docs/releasing.md: a46134cd81e46690b0d0a5003c82c28d676fcd038fc25c5545a1cb0e2f832f3f
        docs/settings.md: fb6ff8195aea5e7198c58978b2ddd576bad291344283fbc3ef0ab0eb0f25e45a
        docs/troubleshooting.md: 118e91a571558a0d6aed99c7dfcafd592f31022faad6e5ad6b076c5a9c688b73
        docs/usage.md: a61aa7631a95fd2724ddba95933fbb9a5e951d7cf268957f5907a8ad459ffb3a
        index.phase1.test.ts: 113dcc79a51a216e0f23372a352992f55cf163b0e594982b5621d40285fa305e
        index.phase5.test.ts: 2bb02a7aab442d06941042d5088902dc29d24ca00bfde8f94a5868b9fc686020
        index.test.ts: b8697744329f12560b0205679a046046552d32477f498bf65767560a915ccbaf
        index.ts: 033710154492de4ed5d452aa4d07fa65c192cc3dde683dcb238c643952870bee
        index.v12.test.ts: 4b3bbd27accf76f6969a3e85401b6dd6884e234def14bc083437c91eabc59701
        lib/bm25.test.ts: 0fdcb41087f8fd5c62624088aae64b14f1cde65da45e1898cc85ca2038650b4c
        lib/bm25.ts: 00ec5ea25040b9fe88e0cd5538d5aa75aa1a6d5ea1b9fac3ecd491e905e08537
        lib/cache-runs.test.ts: 065effd0b1c7be678077d0137d498b87a38c2328a630473b86966ea8463e2be0
        lib/cache-runs.ts: e384ac5736b8f3803dc226f3483e9c01a7b725fb2839073b8cf66c6f0f21f421
        lib/checkpoint-update.test.ts: fe2480ef76ac8cfa716e5552f5c83e82155134d54e522c9ac692a986d6102285
        lib/checkpoint-update.ts: dbb4115a98e445149c4900922128248aa08177683525117a5581b7af8f892e22
        lib/compaction-card-dedupe.test.ts: 2af0cfcfa9c33744bd821fb435fbbcdeb9f3e5f3119f08d6ab7ad239d8638899
        lib/compaction-card-dedupe.ts: b15f9286e1715e9e47ce6ab04a5cef57260f541115c970507b36b950a7529e58
        lib/compaction-card.test.ts: 10efd22edb9e70155be542385f4f8e9b28a2085b6a30e87da22ef6491b37d060
        lib/compaction-card.ts: 3eba217ca318cce075ebe6d1f0776efa3c523f43a553406fe4e01af63f2a95db
        lib/compaction-source.test.ts: 7d043e9afa9ca2636996f9fff478e480e4254bfbe1742d21d0e7a5331541592f
        lib/compaction-source.ts: df5fac5b9a5853759ffc042c3c9d463dcef91ad746034cd6c52773b620267243
        lib/compile-session-file.ts: 37795fbc5054717b2aae8eff343079c68c12f6c8eb62189dc95c25fcef7a90b6
        lib/compiler/anchors.ts: da9d1e8fba8cbc84054f7b73f5bf85be7fe12692bc5f4624538cbdef370f953e
        lib/compiler/budget-formatter.test.ts: e2c2af5a4a041dc2b6c87c29b19f249db32a90e1476437d5407788399aaafa44
        lib/compiler/budget-formatter.ts: 23b876eee5619de92a327b6e9a8f7b3d46146021b0fccf91a1d6bbacd7002925
        lib/compiler/checkpoint-ladder.test.ts: f709202745e1807d7f14b3aea474c64d8008ef419b5586cc7b774eb2f54f95e9
        lib/compiler/checkpoint.test.ts: ff93c53ee31ea55563b7abccdb3108c70d510a7e3e1b6ca053256c82cef87974
        lib/compiler/checkpoint.ts: 65b409e1799e68e70a3440120d58e618fa4665f7a4b97970b30902a5c87951ed
        lib/compiler/conversation-reducer.phase4.test.ts: b9540ec821862376668d91c68faf166a01f68e2134f690275444f192beb0c25c
        lib/compiler/conversation-reducer.test.ts: 1ea56c0d5ffdac53c7ed5d1cc9c75050970e7cb4157af4618708ac6e63c5b7fb
        lib/compiler/conversation-reducer.ts: 57a3b7a08bf851137f6ea40e150f2f20be86f94d31469aaee1a2730efd5d0c1e
        lib/compiler/display-projection.test.ts: 310d7ff71b3603b5b6f736826ce9243136f918708362f2b7f67d6811e687cf9a
        lib/compiler/display-projection.ts: 27aedd88003afeb7d3b855ab88ec8f3783aae6efcbd4c926f70b1a44bbf23d65
        lib/compiler/errors.ts: bdb940fd1bb4b9b9e1958fddf23a774371794eaf6712123ca32e9a83957a18b7
        lib/compiler/evidence-lifetime.test.ts: 02349b64b03975289c8225f8a7e43769554e9303243b640dc46006f0c091050a
        lib/compiler/handoff-projection.test.ts: 0c1974fed453762934e057ce80ff7ee0cde2e62a1cb5ac231cf46bfba20fdf83
        lib/compiler/helpers.ts: 614594b7678e483bffd86ac664dc7a097bbbfdac4c28eb5f2d60c998fe09aaad
        lib/compiler/lexical-budget.ts: 7661f2775b25a75986b1fc539bed0efa544067573828a904ec681d8108e4f87b
        lib/compiler/normalizer.test.ts: 691742bcbcb087ddf5e83fd11ca85dfd884db94c58046ab463ee9aa1edf00491
        lib/compiler/normalizer.ts: 9dee1d55a09adbc6a36380701324cb92412988b9b50418211a755e9d43694f85
        lib/compiler/observed-readiness.test.ts: 371717edf02d8cbe08429c7ddc2f00a37d036610722c9e3971c4833a2b4bfb62
        lib/compiler/observed-readiness.ts: a61fe1797add41cbb1d0206fad44d414010b56d446787210acc0d44ec9bcc8f8
        lib/compiler/optional-selector.test.ts: 60e1de16a0af3c530b45fd626ef802058e04c664bbd8d831dafbe9ea3398210f
        lib/compiler/optional-selector.ts: 3028a31bb5e4f628eb762900374fad5d07267c70108f845b612dfea40bdd7061
        lib/compiler/path-roots.ts: 8b1771d0dac7e04f23e2076a681caa9f986e22ce6a8c91d36072fa7356c1ffa7
        lib/compiler/protected-overflow-regression.test.ts: a68ab7a94a586c576561f2a847b1b26dec78eb35f5c6f8b6a4231224ff16f672
        lib/compiler/request-candidate.test.ts: 756fb4d777d3aa1bc1a364352e8864a18d9db86514e2df784e631b173b0c935d
        lib/compiler/request-candidate.ts: 3b84f9386e7fc9beb299d7f46b6bbd74a91086b9cbac81ad056e6bc245067b1f
        lib/compiler/resume-index.test.ts: 27dd32d78a1e2ea88ee1278884c6e021407847587b44d16a368abf8c2a73599d
        lib/compiler/resume-index.ts: 0bb0fe3b835054b391858f13d5a4690f33ea505cc9e41ceb4d405a8ed9b81ed7
        lib/compiler/resume-plan.phase4.test.ts: 794b0955940d9831dc022059c0ec10c4e687353b967c5246559c922e851d76f7
        lib/compiler/section-scanner.test.ts: 54c9bde4ac6d8fd50363b1071c51f2714e7e6bbb9187abc2e13b63fcc97ee3d0
        lib/compiler/section-scanner.ts: 3f548fd9c41b115fd2620b2aa4ba571a0401a1fba4a88d49d26d1de2e82d9632
        lib/compiler/shell-analysis.test.ts: d76439d9ab2b1d4ae97392ea31659d999b60fc15993d4b262701ec6f7f3f8986
        lib/compiler/shell-analysis.ts: a44b9996d16b88122f2e287ec5ffafc2fbb211df308abe58d3551eda1e03696b
        lib/compiler/structural-v12.test.ts: a90f578c3bf6514c7c4f2ad5d3fd1cd08f1e2f2e91c7af6ad2b305d8124ba056
        lib/compiler/tool-effects-v12.test.ts: 398b4c9e476ede216ffd78d5ff4cd6bacce6c349f87c49bc181f81b5d8f14ddf
        lib/compiler/tool-effects.ts: 08462f0d2b52fa1d8a5a22115797759fd9d6f250ce9c0675061f3ed8ce3da526
        lib/compiler/tool-tracker.ts: 0f119a507a50361631f035e619db1e9dc77404b4a4d4fd636aa3885beef3ff17
        lib/compiler/types.ts: e039000df576be98758b4870f4d65644cdeca20a84a6e0f558d26e93c69910c4
        lib/compiler/verification-display.test.ts: 6e265a6f14bf320f322e5fa7db649c192f9702a1f20cafba811d8953b2e2cbea
        lib/compiler/verification-display.ts: c698e75804e37b1f5ce0f62602a139de10260cf3485d7436105bb037c6c46fc3
        lib/compiler/verification-observation.test.ts: 3110b011fb28a269ec045fb0ae63bb4e291f5fc090c7c20b00afcd65c3cb5276
        lib/compiler/verification-observation.ts: 0a50e89b868dc4522de0dbe57b695639a29c0dd7e257166f03d9364b12c1f536
        lib/continuation-recovery.test.ts: f87d36a7a646662da521da318260e73ba9ad1f853f1a207c1f1543727f1207ba
        lib/continuation-recovery.ts: 66645435aeb9fd3d53b209f6c96f39bd77c2c3103ba8f98d2b6966c6a2daa9aa
        lib/continuation.test.ts: 003c96689f72271a960ed65ce82a669fa830a92cca5f2c1a8813b789c7dffff0
        lib/continuation.ts: aeede077ece2b51e6698b3abcee9b04bbbb1d4ae8e41119e4bfdc3108b2d018b
        lib/data-migration.test.ts: 8674f7c68408e5e17416ce0f154ca10a8ea9f923a0d0a9ed6c145a70860bf478
        lib/data-migration.ts: f10e00e99a4ca076b3d82f97e2e9ecf6db4decc67ed8321179239407a789b51a
        lib/diag-support.test.ts: 8d1f675a3bf67a05cd11f313f2d19e594b0eb8caee75ccb725292428bbead9f8
        lib/diag-support.ts: 8bcc298e70155870262b32c124725b93890a1a75f57846ab5dc2f8b823851b81
        lib/entries-support.test.ts: 8220f20b7b83995db64a0961f2415319c7393613e3859903beb5203750c38f2c
        lib/entries-support.ts: a3f88f00943f790b5e3820c6b6e300cb7342561e1dbdab8d2a2feea57e867668
        lib/events-support.test.ts: 435dfd11eaf4a24104155c05d608fb7bf4652afc6886b63df42ff783e75e58bc
        lib/events-support.ts: 38d9a5228b96e4ce1a0fdda0ed437bb6bc8a5ff9ebece5f30544d2711b5502ac
        lib/extract-tags.ts: 9a31d5165d48710bd108118cc8d9c6f5a3351c1ba7b7533d1aaa455407c871a4
        lib/focus-echo.test.ts: 828d33fda65680a92af4d39e78886021eadc50e75b50345c858a5a829889ea07
        lib/focus-echo.ts: 2b2caa30257e4914a4b8c104d33b9f137cc5e6aa30719d8234be58c54404d551
        lib/fs-support.test.ts: 798d5b2d6ff1d667e1817d7e15f46a1386521e825e8735dea85552d43569c7e7
        lib/fs-support.ts: 781773b23e0dcca774b32b9d72a7384366aa32e72cb284aad70cdc0f4a9f638d
        lib/handoff.test.ts: 126b67aad40e34474560e3e11716b912f0a73a33dcd3babb6c55c959e56ee701
        lib/handoff.ts: 2a31c02abaad242fb1a8b37fb9a735902a9061dd77ba137177bf65b8f4e83aeb
        lib/json-object-keys.ts: 29506e7775909619e67bf2fd6a3174a0805140671fdd3caf8ee4545d3e6bd3ab
        lib/legacy-compat.test.ts: d65e8055b25a5d97f0b7c86ce96c7ffa3d71d52df5f36e8ed4ea12b040bad3ba
        lib/legacy.ts: 880a2c0b83050dfbb8bf31eee8d9cd628763017b7f8fa8502cf5faba55f681b1
        lib/local-compact.test.ts: d85835d8e8ed9898fb6d0001a670ec848f386d6fd9cbb21a2404724aa2e9ba8b
        lib/local-compact.ts: f30644758346df1b4551bb1de172fc65bf851e87be3c0b9ef018ade3cee05a3a
        lib/metric.test.ts: e8cfe49b5b87d67ff79e7a98691dbd88bc8334f62e41425ce3fddd078418d7ea
        lib/metric.ts: 4c2682b5858bf6f41e92bb9bf80463146813e16eb7f39fd700ed9088f030837b
        lib/monitor.test.ts: 1eeb119cbacb00b37afd7a883c016f9e8934342435a231a6b8911cb58087ccc8
        lib/monitor.ts: 5d832f113026968a03afc4f0e39560d19dd36c351f446b13293af7ad15583eb9
        lib/notify-support.test.ts: 753e639c9e7af3da17fe04016257d2ea976edb9f88638c6fd20fb02ec2184aba
        lib/notify-support.ts: eef58b4cd5e39dc246df5ccecc8a1e3ccca323751ca48fccd87f49947872e88d
        lib/offline/checkpoint-corpus.ts: 0a72f85ef6ae2bc816cfd73c4e4cf16da1773a308909e61cd127b8325483290b
        lib/offline/checkpoint-evaluator.test.ts: f69e4f8e24fccd35e9b2c19df43a012a2ae5764397ec83c2d4c0d3848d331846
        lib/offline/checkpoint-evaluator.ts: eac6b3aa8c45efbfd98717e93d20be5e684f9d539b82c28c3ee4681af9bb77df
        lib/offline/performance-gate.test.ts: 348a8b6d25b835e25ad1263f20da903cbfaeddc31539c107db05314420bccb46
        lib/offline/performance-gate.ts: fda5c8a2c1aaa6f1c167205bde70c8a0e8a3ddc78dd16deeec7c96e2955b1af4
        lib/offline/quality-corpus.ts: db57c6a8e3249ca3b22a9aaf4bdff41868b6c7a9bb52948d08575841c229dc96
        lib/offline/quality-evaluator.test.ts: b5229efda06630399d805b33dd9823d98bdfd3405146b6a7eaaeeba6f83e0ad6
        lib/offline/quality-evaluator.ts: 4b904d6a0cdb9ad4690d8377277fd292ffa42fbd850fa01e0477a3ac1f3ea4ac
        lib/offline/supplemental-corpus.ts: 67a6d152264a1175dc6dd56f74010058fd9b99b7111b4e6402dd93a8075748e2
        lib/offline/supplemental-evaluator.test.ts: a981d8f5a5f6a457aa7b0775b4b50662c16b5ad7e88f7447f1bd454edb9b7ecd
        lib/offline/supplemental-evaluator.ts: 39cdc53497afbb46a71a22ec7717c57bb05043c07960826d15ee5956cb3e3b5b
        lib/offline/survival-corpus.ts: ce740dd3eb31584b6efe97f538579ced28d4e68875347c75b429a645a82faa89
        lib/offline/survival-evaluator.test.ts: c47c76095dfe7c77c86b4c839d5fb3ee3adb06e0d36c7ae29683721af9a7dd72
        lib/offline/survival-evaluator.ts: a727b00c61468b695efe1cb4a1bced8dcd0be60b2f01052d284fcb19cdb0e233
        lib/output-compactor.test.ts: 819c399fce5cdc1639f0500bf15fe007774b7fba5dbc2d15d1880e7ca5bd13cb
        lib/output-compactor.ts: 9ebd68c1c7e82a98357d1a416935a5750cbf2980553644513102bf45dac1e524
        lib/paths.test.ts: 4786b00420e80ef17304f57e8e44a3ead0918edd37d050334267a2a7869ff9e2
        lib/paths.ts: a14afd19b1e330f64bebad580267c651464809377b00abcb555bcf0c489e1c5b
        lib/phase1-controller.test.ts: 6994035ad74027a19fd428aec4f1e60531e480cb13e7fdab32f972b2e50e2ae4
        lib/phase1-controller.ts: dbda83ed14bd87b327882a5aa425e5015c74d28042316c0792e15b9038dd77dd
        lib/phase1-lifecycle.property.test.ts: 9f1e47135522544f0b80e73805af2c629ad0af6d374f69c5ea8f22ae09cb9129
        lib/recall-entry.ts: f95094d09264906e083d76073b64d276af10caf4a69cbe7057bba0377b58f680
        lib/recall-projection.test.ts: fcd199d1ac107167871560ac6aad3a737a1be843ad1481c0bfb7b40f7aa1fff4
        lib/recall-projection.ts: 34d0523d3a3aab93f69705c7589d97d49f34ea6c5f9e1ada9045fdb4cea3a658
        lib/recall.test.ts: e90896852ccf2c1ca4d1d853238d3095fcad2f04f5f40352a9d7ad936f86d7a3
        lib/recall.ts: b87ca426ef87f0945f517218182d5473cfd65444e3e4eacacdaf685ef431491f
        lib/resumption-fidelity.test.ts: 955e8b60828aac8a91c8804a607608135e700e1a518a04af2c62fcdb0eec2846
        lib/runtime-probe.ts: 5a384c1d5f730ff6c62714b10ecda71090aaee19b7c8f1bba144d74a030b1f77
        lib/sdk.ts: 81ef935bdfe4a6daa8cda7cf585a7c7f0295a644fbb709fc38cef03906768937
        lib/session-evaluator.test.ts: cdcb0cb4b9b3c15899433ed4836984a84558f3a9bd78e4e940b193f6fdbb81cc
        lib/session-evaluator.ts: a4e0d0ab76bf3672f149e64b936e9c593a51165a1581616178d7cfc4897d0722
        lib/settings.test.ts: 871e2332afca88f92ecf31a9fc84bfdbe9e099aced6d9c97ec0702eb1fd7f309
        lib/settings.ts: 0017d98b0668145b586eb20ac42d96ecc089210e73711bac0002892fa98a7a7f
        lib/sha256.test.ts: 9131960dae17083192659dd10196b4fb83a998b70d4bed88d3073acab41fe85b
        lib/sha256.ts: 523f5efaa3ac2982f8f833240cb002351b52721420c48309a34f05f5b07dd125
        lib/store.test.ts: 856fbd303337d059314b858aaf5004a39198b92d49f35efe17d0a2612c53d3e1
        lib/store.ts: 3a8d1f9db3e38a66e33fdc365a03d5aa0e38761d45815595c16c45176bd97b37
        lib/strategy.test.ts: e549e307fb40eea44731981eafd5ed08d39dbce392f938d7f38ce44845bd662d
        lib/strategy.ts: 65a116cd0ae9d72c61afaed2b49947f4e6d8351f522446dc6f17f974b53e2b36
        lib/tool-result.test.ts: 85e238dadf1beea81baccc3361fffb96ca6a1ac6a101213c6f98e42f36dc3f76
        lib/tool-result.ts: 6cecb489009b8f7406b18ced9a0a6f2a19757c9a0efc020e197ee53c115bfd11
        lib/trigger.test.ts: a7b74a128989c66951d1e567fda7a19d6e32af1bf56a8e0722e5430cd894b658
        lib/trigger.ts: 5fa705fc16a31dcd2fedc703a7fb8ef1ad5069b60618aa4a1018d9f4ec31c206
        lib/tui-block.test.ts: ee25d80023627b5c63fadd15aa8978135e09006b0962f74fa2dacb6b410a1de1
        lib/tui-block.ts: 2c7200875c91b2cadf05d6ca88b7d7748f1f249c42b68937852f674ed50cea7c
        lib/types.ts: aade627b2f2683de80a138cc81ae59a71d25e4151e953b0fdf8040a3aa08809f
        lib/unicode.test.ts: 9f4b8ad3dea9b38f3e373575cf29e07898564e55be88627eb9b571deda013521
        lib/unicode.ts: 2a1a14f6c87a12f5acc1ef0ed8b10f3e30912f6344d46d1928f2a3a1434ca123
        lib/wire-format.ts: b149adac61adfc596173474e33d432cd93263e81a90608c70af755f44df2f9fa
        package.json: c59b7f5e269b4cb79288f9a880a2408dde2082b5b2b76e162a6e8f2b2b47a681
        scripts/benchmark-compiler.ts: 9e2bc7e815c273621e7312b3e54b8ddff0897180c444dbd08b016a87c7075f1a
        scripts/check-architecture.ts: abfedfb9a1fe62f32dac370a9579f14f4010e4dc78ba93c2cb33ba5d85697480
        scripts/evaluate-selector.ts: 59f6eeada8b20f3d7893f87f15d32ec4b87e07c1585e7c9af94b332f532b8c37
        tests/compare-session.ts: eecb3847c156685dc634be07033a55b41b44f385f1e8723ae8d59d8ea1562792
        tests/e2e/README.md: 92ab2889d74d1f9f3cd6e2270c42c55198141bad6efa4aca061553fa32822a8b
        tests/e2e/busy-compaction.e2e.ts: df742676f8b66743773a8eca41de6de06d6ca6dd0308f95ca41d7022ad21f937
        tests/e2e/current-compaction.test.ts: 9efd50ccfa00f3645e076a4614ae5ea480320eb92c4c74e36ae1caf516cd95a9
        tests/e2e/demo.ts: 866b6d6a0ec2fd77d7bfe478dd49234a1855a05dfde83b3672f18bf46ea6fd78
        tests/e2e/harness/compaction-barrier.ts: c303a0bcde5d55b521570a5e06c0beaf86a1f47f81ac457ec77f7a4bb97db58e
        tests/e2e/harness/current-compaction.ts: 30009cbf2bd0bf92579480ba06acba76db7415839d38dea61aa50861f137b8bf
        tests/e2e/harness/env.ts: 80d510793aee4cc973e8dd59110a5b5871deea0a53fd26b93962325e94b06b99
        tests/e2e/harness/fake-provider.ts: 660fcff8b643a9bc3e749bb912acacd0384bdae41389ab7e2d2b5f405c8aa7f1
        tests/e2e/harness/preparation-fault.ts: 1d2e977db7ca4f80cedcc6452414e700113a5d870ee9f480c7c7c33dd9fbb15d
        tests/e2e/harness/rpc-client.ts: 42525b4925d12d0cebdeb92b5cab758369975f0e7e6a70eb10b4028bb07c3b31
        tests/e2e/interception.e2e.ts: b2cefbc64ab9d5b5213dbd9398eb09612945729565038e1a4ee3ebf6168e3a90
        tests/e2e/lifecycle.e2e.ts: 6468c3c34a2f5355d6a95c57350157ef8d34a0357121ed54ba9a8e82296a4fd7
        tests/fixtures/parser-session.jsonl: 50575fa33d879ec0e2ce4b1455545dd2836f12d37f54f4a6e731794b387c40e7
        tests/harness/fake-pi.ts: 471929329a9da287771609a65655e393b95eed3f9b8c07a8799dc12d48d1caf6
        tests/harness/preparation-fixture.ts: ec8bf72df94a9f82c24d719df8f10ccea9db3eb814a6654f1fa3514979ffedae
        tests/verify-improvement.test.ts: a9a5f39929a9c12274c448bfb574fbbc92e9c28df4ae3736876be3608019e433
        tsconfig.json: 08529066dec16388122122f2582069e400770a8587711b912794e10896615b0f
      at: 2026-10-05T23:43:09.257Z
    intended: run frozen gate TG4
    next_action: continue next frozen gate or diagnose failure
    after:
      digest: df406a8f72d7e1c8cc1e3cb948747ce98dcb0839c47303ee11663adbc4530010
      entries:
        .dependency-cruiser.cjs: f90d4b8c206440cc7006c105126ddb091a8ae57bc1a8225b49b54e63b0356edf
        .gitignore: 8f21e3b9b123ffa75121a0ae451782c432407acc21cc784d8fc095cd3e8c3cf7
        AGENTS.md: af56ae1e888439e976f2eac7ecf8c447ff2f73f99bba3b8900dcdf1add2b4286
        CLAUDE.md: symlink:AGENTS.md
        LICENSE: e2e52298290bec0f61398b5684006a59f0d8e2a7374e7f4cd134d5c36b660a47
        README.md: 4dae887df73702ccaf751e5683a42c298a59ecb1dee9251f5c4072ca4bb62e2f
        bin/dc-distill-session.ts: 15d9306ff37153205e88eda1baab634e341e2a25e6c9da5ca409f6762192524f
        bun.lock: 997ed36d6a2500f0e8ab160da30dd689f3c12e885e42933fe03e8aa7746e61eb
        debug/checkpoint-gate.ts: 6ac8afb9d7315db48851f95a64237676fe45cff3afe6b3fc62798f32d0076f6f
        debug/live-repro.ts: df3cd57568e1b68ccf2b21bd8d4acbf0802779d916e56b8de1a59a01ae69c3ad
        docs-contract.test.ts: e176e2eed18179cc551e295bae31f58c8730aa1e26321fce22c5b266f03fbaae
        docs/adr/0001-vendored-framework-boundary.md: 1388e4baba3d47fc433924c9807239fe50c596b57f318675c42b667b38c7329a
        docs/adr/0002-remove-vendored-framework.md: 2fbfc6def5635e9bfc1c5d2359ad779954c6f39dbebbd2bdf9417c93bd06d634
        docs/algorithm.md: 996beaaa59f3813f03b075ae2168120f2b47a133a695da75a457f93bc94c6d02
        docs/architecture.md: acf03df39fbb9e7a230a14cfba7ac3853c56a68bf3a45851ddb9c0ac2f1eb0ee
        docs/assets/distill-before-after.svg: 80ab3aa5b4f4bf2032daed7f08ecf25ffea586c5b733fa87163367964b8c0b50
        docs/compiler-benchmark.md: 0c9735e4a0f38cfe1f04ba955e103af19de7bc7fffc8506f03cf08f5e42380e4
        docs/releasing.md: a46134cd81e46690b0d0a5003c82c28d676fcd038fc25c5545a1cb0e2f832f3f
        docs/settings.md: fb6ff8195aea5e7198c58978b2ddd576bad291344283fbc3ef0ab0eb0f25e45a
        docs/troubleshooting.md: 118e91a571558a0d6aed99c7dfcafd592f31022faad6e5ad6b076c5a9c688b73
        docs/usage.md: a61aa7631a95fd2724ddba95933fbb9a5e951d7cf268957f5907a8ad459ffb3a
        index.phase1.test.ts: 113dcc79a51a216e0f23372a352992f55cf163b0e594982b5621d40285fa305e
        index.phase5.test.ts: 2bb02a7aab442d06941042d5088902dc29d24ca00bfde8f94a5868b9fc686020
        index.test.ts: b8697744329f12560b0205679a046046552d32477f498bf65767560a915ccbaf
        index.ts: 033710154492de4ed5d452aa4d07fa65c192cc3dde683dcb238c643952870bee
        index.v12.test.ts: 4b3bbd27accf76f6969a3e85401b6dd6884e234def14bc083437c91eabc59701
        lib/bm25.test.ts: 0fdcb41087f8fd5c62624088aae64b14f1cde65da45e1898cc85ca2038650b4c
        lib/bm25.ts: 00ec5ea25040b9fe88e0cd5538d5aa75aa1a6d5ea1b9fac3ecd491e905e08537
        lib/cache-runs.test.ts: 065effd0b1c7be678077d0137d498b87a38c2328a630473b86966ea8463e2be0
        lib/cache-runs.ts: e384ac5736b8f3803dc226f3483e9c01a7b725fb2839073b8cf66c6f0f21f421
        lib/checkpoint-update.test.ts: fe2480ef76ac8cfa716e5552f5c83e82155134d54e522c9ac692a986d6102285
        lib/checkpoint-update.ts: dbb4115a98e445149c4900922128248aa08177683525117a5581b7af8f892e22
        lib/compaction-card-dedupe.test.ts: 2af0cfcfa9c33744bd821fb435fbbcdeb9f3e5f3119f08d6ab7ad239d8638899
        lib/compaction-card-dedupe.ts: b15f9286e1715e9e47ce6ab04a5cef57260f541115c970507b36b950a7529e58
        lib/compaction-card.test.ts: 10efd22edb9e70155be542385f4f8e9b28a2085b6a30e87da22ef6491b37d060
        lib/compaction-card.ts: 3eba217ca318cce075ebe6d1f0776efa3c523f43a553406fe4e01af63f2a95db
        lib/compaction-source.test.ts: 7d043e9afa9ca2636996f9fff478e480e4254bfbe1742d21d0e7a5331541592f
        lib/compaction-source.ts: df5fac5b9a5853759ffc042c3c9d463dcef91ad746034cd6c52773b620267243
        lib/compile-session-file.ts: 37795fbc5054717b2aae8eff343079c68c12f6c8eb62189dc95c25fcef7a90b6
        lib/compiler/anchors.ts: da9d1e8fba8cbc84054f7b73f5bf85be7fe12692bc5f4624538cbdef370f953e
        lib/compiler/budget-formatter.test.ts: e2c2af5a4a041dc2b6c87c29b19f249db32a90e1476437d5407788399aaafa44
        lib/compiler/budget-formatter.ts: 23b876eee5619de92a327b6e9a8f7b3d46146021b0fccf91a1d6bbacd7002925
        lib/compiler/checkpoint-ladder.test.ts: f709202745e1807d7f14b3aea474c64d8008ef419b5586cc7b774eb2f54f95e9
        lib/compiler/checkpoint.test.ts: ff93c53ee31ea55563b7abccdb3108c70d510a7e3e1b6ca053256c82cef87974
        lib/compiler/checkpoint.ts: 65b409e1799e68e70a3440120d58e618fa4665f7a4b97970b30902a5c87951ed
        lib/compiler/conversation-reducer.phase4.test.ts: b9540ec821862376668d91c68faf166a01f68e2134f690275444f192beb0c25c
        lib/compiler/conversation-reducer.test.ts: 1ea56c0d5ffdac53c7ed5d1cc9c75050970e7cb4157af4618708ac6e63c5b7fb
        lib/compiler/conversation-reducer.ts: 57a3b7a08bf851137f6ea40e150f2f20be86f94d31469aaee1a2730efd5d0c1e
        lib/compiler/display-projection.test.ts: 310d7ff71b3603b5b6f736826ce9243136f918708362f2b7f67d6811e687cf9a
        lib/compiler/display-projection.ts: 27aedd88003afeb7d3b855ab88ec8f3783aae6efcbd4c926f70b1a44bbf23d65
        lib/compiler/errors.ts: bdb940fd1bb4b9b9e1958fddf23a774371794eaf6712123ca32e9a83957a18b7
        lib/compiler/evidence-lifetime.test.ts: 02349b64b03975289c8225f8a7e43769554e9303243b640dc46006f0c091050a
        lib/compiler/handoff-projection.test.ts: 0c1974fed453762934e057ce80ff7ee0cde2e62a1cb5ac231cf46bfba20fdf83
        lib/compiler/helpers.ts: 614594b7678e483bffd86ac664dc7a097bbbfdac4c28eb5f2d60c998fe09aaad
        lib/compiler/lexical-budget.ts: 7661f2775b25a75986b1fc539bed0efa544067573828a904ec681d8108e4f87b
        lib/compiler/normalizer.test.ts: 691742bcbcb087ddf5e83fd11ca85dfd884db94c58046ab463ee9aa1edf00491
        lib/compiler/normalizer.ts: 9dee1d55a09adbc6a36380701324cb92412988b9b50418211a755e9d43694f85
        lib/compiler/observed-readiness.test.ts: 371717edf02d8cbe08429c7ddc2f00a37d036610722c9e3971c4833a2b4bfb62
        lib/compiler/observed-readiness.ts: a61fe1797add41cbb1d0206fad44d414010b56d446787210acc0d44ec9bcc8f8
        lib/compiler/optional-selector.test.ts: 60e1de16a0af3c530b45fd626ef802058e04c664bbd8d831dafbe9ea3398210f
        lib/compiler/optional-selector.ts: 3028a31bb5e4f628eb762900374fad5d07267c70108f845b612dfea40bdd7061
        lib/compiler/path-roots.ts: 8b1771d0dac7e04f23e2076a681caa9f986e22ce6a8c91d36072fa7356c1ffa7
        lib/compiler/protected-overflow-regression.test.ts: a68ab7a94a586c576561f2a847b1b26dec78eb35f5c6f8b6a4231224ff16f672
        lib/compiler/request-candidate.test.ts: 756fb4d777d3aa1bc1a364352e8864a18d9db86514e2df784e631b173b0c935d
        lib/compiler/request-candidate.ts: 3b84f9386e7fc9beb299d7f46b6bbd74a91086b9cbac81ad056e6bc245067b1f
        lib/compiler/resume-index.test.ts: 27dd32d78a1e2ea88ee1278884c6e021407847587b44d16a368abf8c2a73599d
        lib/compiler/resume-index.ts: 0bb0fe3b835054b391858f13d5a4690f33ea505cc9e41ceb4d405a8ed9b81ed7
        lib/compiler/resume-plan.phase4.test.ts: 794b0955940d9831dc022059c0ec10c4e687353b967c5246559c922e851d76f7
        lib/compiler/section-scanner.test.ts: 54c9bde4ac6d8fd50363b1071c51f2714e7e6bbb9187abc2e13b63fcc97ee3d0
        lib/compiler/section-scanner.ts: 3f548fd9c41b115fd2620b2aa4ba571a0401a1fba4a88d49d26d1de2e82d9632
        lib/compiler/shell-analysis.test.ts: d76439d9ab2b1d4ae97392ea31659d999b60fc15993d4b262701ec6f7f3f8986
        lib/compiler/shell-analysis.ts: a44b9996d16b88122f2e287ec5ffafc2fbb211df308abe58d3551eda1e03696b
        lib/compiler/structural-v12.test.ts: a90f578c3bf6514c7c4f2ad5d3fd1cd08f1e2f2e91c7af6ad2b305d8124ba056
        lib/compiler/tool-effects-v12.test.ts: 398b4c9e476ede216ffd78d5ff4cd6bacce6c349f87c49bc181f81b5d8f14ddf
        lib/compiler/tool-effects.ts: 08462f0d2b52fa1d8a5a22115797759fd9d6f250ce9c0675061f3ed8ce3da526
        lib/compiler/tool-tracker.ts: 0f119a507a50361631f035e619db1e9dc77404b4a4d4fd636aa3885beef3ff17
        lib/compiler/types.ts: e039000df576be98758b4870f4d65644cdeca20a84a6e0f558d26e93c69910c4
        lib/compiler/verification-display.test.ts: 6e265a6f14bf320f322e5fa7db649c192f9702a1f20cafba811d8953b2e2cbea
        lib/compiler/verification-display.ts: c698e75804e37b1f5ce0f62602a139de10260cf3485d7436105bb037c6c46fc3
        lib/compiler/verification-observation.test.ts: 3110b011fb28a269ec045fb0ae63bb4e291f5fc090c7c20b00afcd65c3cb5276
        lib/compiler/verification-observation.ts: 0a50e89b868dc4522de0dbe57b695639a29c0dd7e257166f03d9364b12c1f536
        lib/continuation-recovery.test.ts: f87d36a7a646662da521da318260e73ba9ad1f853f1a207c1f1543727f1207ba
        lib/continuation-recovery.ts: 66645435aeb9fd3d53b209f6c96f39bd77c2c3103ba8f98d2b6966c6a2daa9aa
        lib/continuation.test.ts: 003c96689f72271a960ed65ce82a669fa830a92cca5f2c1a8813b789c7dffff0
        lib/continuation.ts: aeede077ece2b51e6698b3abcee9b04bbbb1d4ae8e41119e4bfdc3108b2d018b
        lib/data-migration.test.ts: 8674f7c68408e5e17416ce0f154ca10a8ea9f923a0d0a9ed6c145a70860bf478
        lib/data-migration.ts: f10e00e99a4ca076b3d82f97e2e9ecf6db4decc67ed8321179239407a789b51a
        lib/diag-support.test.ts: 8d1f675a3bf67a05cd11f313f2d19e594b0eb8caee75ccb725292428bbead9f8
        lib/diag-support.ts: 8bcc298e70155870262b32c124725b93890a1a75f57846ab5dc2f8b823851b81
        lib/entries-support.test.ts: 8220f20b7b83995db64a0961f2415319c7393613e3859903beb5203750c38f2c
        lib/entries-support.ts: a3f88f00943f790b5e3820c6b6e300cb7342561e1dbdab8d2a2feea57e867668
        lib/events-support.test.ts: 435dfd11eaf4a24104155c05d608fb7bf4652afc6886b63df42ff783e75e58bc
        lib/events-support.ts: 38d9a5228b96e4ce1a0fdda0ed437bb6bc8a5ff9ebece5f30544d2711b5502ac
        lib/extract-tags.ts: 9a31d5165d48710bd108118cc8d9c6f5a3351c1ba7b7533d1aaa455407c871a4
        lib/focus-echo.test.ts: 828d33fda65680a92af4d39e78886021eadc50e75b50345c858a5a829889ea07
        lib/focus-echo.ts: 2b2caa30257e4914a4b8c104d33b9f137cc5e6aa30719d8234be58c54404d551
        lib/fs-support.test.ts: 798d5b2d6ff1d667e1817d7e15f46a1386521e825e8735dea85552d43569c7e7
        lib/fs-support.ts: 781773b23e0dcca774b32b9d72a7384366aa32e72cb284aad70cdc0f4a9f638d
        lib/handoff.test.ts: 126b67aad40e34474560e3e11716b912f0a73a33dcd3babb6c55c959e56ee701
        lib/handoff.ts: 2a31c02abaad242fb1a8b37fb9a735902a9061dd77ba137177bf65b8f4e83aeb
        lib/json-object-keys.ts: 29506e7775909619e67bf2fd6a3174a0805140671fdd3caf8ee4545d3e6bd3ab
        lib/legacy-compat.test.ts: d65e8055b25a5d97f0b7c86ce96c7ffa3d71d52df5f36e8ed4ea12b040bad3ba
        lib/legacy.ts: 880a2c0b83050dfbb8bf31eee8d9cd628763017b7f8fa8502cf5faba55f681b1
        lib/local-compact.test.ts: d85835d8e8ed9898fb6d0001a670ec848f386d6fd9cbb21a2404724aa2e9ba8b
        lib/local-compact.ts: f30644758346df1b4551bb1de172fc65bf851e87be3c0b9ef018ade3cee05a3a
        lib/metric.test.ts: e8cfe49b5b87d67ff79e7a98691dbd88bc8334f62e41425ce3fddd078418d7ea
        lib/metric.ts: 4c2682b5858bf6f41e92bb9bf80463146813e16eb7f39fd700ed9088f030837b
        lib/monitor.test.ts: 1eeb119cbacb00b37afd7a883c016f9e8934342435a231a6b8911cb58087ccc8
        lib/monitor.ts: 5d832f113026968a03afc4f0e39560d19dd36c351f446b13293af7ad15583eb9
        lib/notify-support.test.ts: 753e639c9e7af3da17fe04016257d2ea976edb9f88638c6fd20fb02ec2184aba
        lib/notify-support.ts: eef58b4cd5e39dc246df5ccecc8a1e3ccca323751ca48fccd87f49947872e88d
        lib/offline/checkpoint-corpus.ts: 0a72f85ef6ae2bc816cfd73c4e4cf16da1773a308909e61cd127b8325483290b
        lib/offline/checkpoint-evaluator.test.ts: f69e4f8e24fccd35e9b2c19df43a012a2ae5764397ec83c2d4c0d3848d331846
        lib/offline/checkpoint-evaluator.ts: eac6b3aa8c45efbfd98717e93d20be5e684f9d539b82c28c3ee4681af9bb77df
        lib/offline/performance-gate.test.ts: 348a8b6d25b835e25ad1263f20da903cbfaeddc31539c107db05314420bccb46
        lib/offline/performance-gate.ts: fda5c8a2c1aaa6f1c167205bde70c8a0e8a3ddc78dd16deeec7c96e2955b1af4
        lib/offline/quality-corpus.ts: db57c6a8e3249ca3b22a9aaf4bdff41868b6c7a9bb52948d08575841c229dc96
        lib/offline/quality-evaluator.test.ts: b5229efda06630399d805b33dd9823d98bdfd3405146b6a7eaaeeba6f83e0ad6
        lib/offline/quality-evaluator.ts: 4b904d6a0cdb9ad4690d8377277fd292ffa42fbd850fa01e0477a3ac1f3ea4ac
        lib/offline/supplemental-corpus.ts: 67a6d152264a1175dc6dd56f74010058fd9b99b7111b4e6402dd93a8075748e2
        lib/offline/supplemental-evaluator.test.ts: a981d8f5a5f6a457aa7b0775b4b50662c16b5ad7e88f7447f1bd454edb9b7ecd
        lib/offline/supplemental-evaluator.ts: 39cdc53497afbb46a71a22ec7717c57bb05043c07960826d15ee5956cb3e3b5b
        lib/offline/survival-corpus.ts: ce740dd3eb31584b6efe97f538579ced28d4e68875347c75b429a645a82faa89
        lib/offline/survival-evaluator.test.ts: c47c76095dfe7c77c86b4c839d5fb3ee3adb06e0d36c7ae29683721af9a7dd72
        lib/offline/survival-evaluator.ts: a727b00c61468b695efe1cb4a1bced8dcd0be60b2f01052d284fcb19cdb0e233
        lib/output-compactor.test.ts: 819c399fce5cdc1639f0500bf15fe007774b7fba5dbc2d15d1880e7ca5bd13cb
        lib/output-compactor.ts: 9ebd68c1c7e82a98357d1a416935a5750cbf2980553644513102bf45dac1e524
        lib/paths.test.ts: 4786b00420e80ef17304f57e8e44a3ead0918edd37d050334267a2a7869ff9e2
        lib/paths.ts: a14afd19b1e330f64bebad580267c651464809377b00abcb555bcf0c489e1c5b
        lib/phase1-controller.test.ts: 6994035ad74027a19fd428aec4f1e60531e480cb13e7fdab32f972b2e50e2ae4
        lib/phase1-controller.ts: dbda83ed14bd87b327882a5aa425e5015c74d28042316c0792e15b9038dd77dd
        lib/phase1-lifecycle.property.test.ts: 9f1e47135522544f0b80e73805af2c629ad0af6d374f69c5ea8f22ae09cb9129
        lib/recall-entry.ts: f95094d09264906e083d76073b64d276af10caf4a69cbe7057bba0377b58f680
        lib/recall-projection.test.ts: fcd199d1ac107167871560ac6aad3a737a1be843ad1481c0bfb7b40f7aa1fff4
        lib/recall-projection.ts: 34d0523d3a3aab93f69705c7589d97d49f34ea6c5f9e1ada9045fdb4cea3a658
        lib/recall.test.ts: e90896852ccf2c1ca4d1d853238d3095fcad2f04f5f40352a9d7ad936f86d7a3
        lib/recall.ts: b87ca426ef87f0945f517218182d5473cfd65444e3e4eacacdaf685ef431491f
        lib/resumption-fidelity.test.ts: 955e8b60828aac8a91c8804a607608135e700e1a518a04af2c62fcdb0eec2846
        lib/runtime-probe.ts: 5a384c1d5f730ff6c62714b10ecda71090aaee19b7c8f1bba144d74a030b1f77
        lib/sdk.ts: 81ef935bdfe4a6daa8cda7cf585a7c7f0295a644fbb709fc38cef03906768937
        lib/session-evaluator.test.ts: cdcb0cb4b9b3c15899433ed4836984a84558f3a9bd78e4e940b193f6fdbb81cc
        lib/session-evaluator.ts: a4e0d0ab76bf3672f149e64b936e9c593a51165a1581616178d7cfc4897d0722
        lib/settings.test.ts: 871e2332afca88f92ecf31a9fc84bfdbe9e099aced6d9c97ec0702eb1fd7f309
        lib/settings.ts: 0017d98b0668145b586eb20ac42d96ecc089210e73711bac0002892fa98a7a7f
        lib/sha256.test.ts: 9131960dae17083192659dd10196b4fb83a998b70d4bed88d3073acab41fe85b
        lib/sha256.ts: 523f5efaa3ac2982f8f833240cb002351b52721420c48309a34f05f5b07dd125
        lib/store.test.ts: 856fbd303337d059314b858aaf5004a39198b92d49f35efe17d0a2612c53d3e1
        lib/store.ts: 3a8d1f9db3e38a66e33fdc365a03d5aa0e38761d45815595c16c45176bd97b37
        lib/strategy.test.ts: e549e307fb40eea44731981eafd5ed08d39dbce392f938d7f38ce44845bd662d
        lib/strategy.ts: 65a116cd0ae9d72c61afaed2b49947f4e6d8351f522446dc6f17f974b53e2b36
        lib/tool-result.test.ts: 85e238dadf1beea81baccc3361fffb96ca6a1ac6a101213c6f98e42f36dc3f76
        lib/tool-result.ts: 6cecb489009b8f7406b18ced9a0a6f2a19757c9a0efc020e197ee53c115bfd11
        lib/trigger.test.ts: a7b74a128989c66951d1e567fda7a19d6e32af1bf56a8e0722e5430cd894b658
        lib/trigger.ts: 5fa705fc16a31dcd2fedc703a7fb8ef1ad5069b60618aa4a1018d9f4ec31c206
        lib/tui-block.test.ts: ee25d80023627b5c63fadd15aa8978135e09006b0962f74fa2dacb6b410a1de1
        lib/tui-block.ts: 2c7200875c91b2cadf05d6ca88b7d7748f1f249c42b68937852f674ed50cea7c
        lib/types.ts: aade627b2f2683de80a138cc81ae59a71d25e4151e953b0fdf8040a3aa08809f
        lib/unicode.test.ts: 9f4b8ad3dea9b38f3e373575cf29e07898564e55be88627eb9b571deda013521
        lib/unicode.ts: 2a1a14f6c87a12f5acc1ef0ed8b10f3e30912f6344d46d1928f2a3a1434ca123
        lib/wire-format.ts: b149adac61adfc596173474e33d432cd93263e81a90608c70af755f44df2f9fa
        package.json: c59b7f5e269b4cb79288f9a880a2408dde2082b5b2b76e162a6e8f2b2b47a681
        scripts/benchmark-compiler.ts: 9e2bc7e815c273621e7312b3e54b8ddff0897180c444dbd08b016a87c7075f1a
        scripts/check-architecture.ts: abfedfb9a1fe62f32dac370a9579f14f4010e4dc78ba93c2cb33ba5d85697480
        scripts/evaluate-selector.ts: 59f6eeada8b20f3d7893f87f15d32ec4b87e07c1585e7c9af94b332f532b8c37
        tests/compare-session.ts: eecb3847c156685dc634be07033a55b41b44f385f1e8723ae8d59d8ea1562792
        tests/e2e/README.md: 92ab2889d74d1f9f3cd6e2270c42c55198141bad6efa4aca061553fa32822a8b
        tests/e2e/busy-compaction.e2e.ts: df742676f8b66743773a8eca41de6de06d6ca6dd0308f95ca41d7022ad21f937
        tests/e2e/current-compaction.test.ts: 9efd50ccfa00f3645e076a4614ae5ea480320eb92c4c74e36ae1caf516cd95a9
        tests/e2e/demo.ts: 866b6d6a0ec2fd77d7bfe478dd49234a1855a05dfde83b3672f18bf46ea6fd78
        tests/e2e/harness/compaction-barrier.ts: c303a0bcde5d55b521570a5e06c0beaf86a1f47f81ac457ec77f7a4bb97db58e
        tests/e2e/harness/current-compaction.ts: 30009cbf2bd0bf92579480ba06acba76db7415839d38dea61aa50861f137b8bf
        tests/e2e/harness/env.ts: 80d510793aee4cc973e8dd59110a5b5871deea0a53fd26b93962325e94b06b99
        tests/e2e/harness/fake-provider.ts: 660fcff8b643a9bc3e749bb912acacd0384bdae41389ab7e2d2b5f405c8aa7f1
        tests/e2e/harness/preparation-fault.ts: 1d2e977db7ca4f80cedcc6452414e700113a5d870ee9f480c7c7c33dd9fbb15d
        tests/e2e/harness/rpc-client.ts: 42525b4925d12d0cebdeb92b5cab758369975f0e7e6a70eb10b4028bb07c3b31
        tests/e2e/interception.e2e.ts: b2cefbc64ab9d5b5213dbd9398eb09612945729565038e1a4ee3ebf6168e3a90
        tests/e2e/lifecycle.e2e.ts: 6468c3c34a2f5355d6a95c57350157ef8d34a0357121ed54ba9a8e82296a4fd7
        tests/fixtures/parser-session.jsonl: 50575fa33d879ec0e2ce4b1455545dd2836f12d37f54f4a6e731794b387c40e7
        tests/harness/fake-pi.ts: 471929329a9da287771609a65655e393b95eed3f9b8c07a8799dc12d48d1caf6
        tests/harness/preparation-fixture.ts: ec8bf72df94a9f82c24d719df8f10ccea9db3eb814a6654f1fa3514979ffedae
        tests/verify-improvement.test.ts: a9a5f39929a9c12274c448bfb574fbbc92e9c28df4ae3736876be3608019e433
        tsconfig.json: 08529066dec16388122122f2582069e400770a8587711b912794e10896615b0f
      at: 2026-10-05T23:43:09.661Z
    result: passed
    evidence:
      gate: TG4
      command: bun run distill:architecture
      working_directory: /Users/vampire/code/ts/pi-dc-distill
      exit: 0
      signal: null
      started: 2026-10-05T23:43:09.319Z
      ended: 2026-10-05T23:43:09.582Z
      log: /tmp/current-compaction-TG4.log
      output: |
        
        ✔ no dependency violations found (86 modules, 245 dependencies cruised)


        $ bun scripts/check-architecture.ts
  - kind: checkpoint
    checkpoint_id: current-compaction-TG5
    operation_id: current-compaction-TG5
    operation_kind: gate
    gate: TG5
    phase: reconciled
    task: T1
    contract_digest: 5ca4752235ecf4aab1ed380d9723e19319ae181d8eba7a5ae8361c1dcaefb878
    before:
      digest: df406a8f72d7e1c8cc1e3cb948747ce98dcb0839c47303ee11663adbc4530010
      entries:
        .dependency-cruiser.cjs: f90d4b8c206440cc7006c105126ddb091a8ae57bc1a8225b49b54e63b0356edf
        .gitignore: 8f21e3b9b123ffa75121a0ae451782c432407acc21cc784d8fc095cd3e8c3cf7
        AGENTS.md: af56ae1e888439e976f2eac7ecf8c447ff2f73f99bba3b8900dcdf1add2b4286
        CLAUDE.md: symlink:AGENTS.md
        LICENSE: e2e52298290bec0f61398b5684006a59f0d8e2a7374e7f4cd134d5c36b660a47
        README.md: 4dae887df73702ccaf751e5683a42c298a59ecb1dee9251f5c4072ca4bb62e2f
        bin/dc-distill-session.ts: 15d9306ff37153205e88eda1baab634e341e2a25e6c9da5ca409f6762192524f
        bun.lock: 997ed36d6a2500f0e8ab160da30dd689f3c12e885e42933fe03e8aa7746e61eb
        debug/checkpoint-gate.ts: 6ac8afb9d7315db48851f95a64237676fe45cff3afe6b3fc62798f32d0076f6f
        debug/live-repro.ts: df3cd57568e1b68ccf2b21bd8d4acbf0802779d916e56b8de1a59a01ae69c3ad
        docs-contract.test.ts: e176e2eed18179cc551e295bae31f58c8730aa1e26321fce22c5b266f03fbaae
        docs/adr/0001-vendored-framework-boundary.md: 1388e4baba3d47fc433924c9807239fe50c596b57f318675c42b667b38c7329a
        docs/adr/0002-remove-vendored-framework.md: 2fbfc6def5635e9bfc1c5d2359ad779954c6f39dbebbd2bdf9417c93bd06d634
        docs/algorithm.md: 996beaaa59f3813f03b075ae2168120f2b47a133a695da75a457f93bc94c6d02
        docs/architecture.md: acf03df39fbb9e7a230a14cfba7ac3853c56a68bf3a45851ddb9c0ac2f1eb0ee
        docs/assets/distill-before-after.svg: 80ab3aa5b4f4bf2032daed7f08ecf25ffea586c5b733fa87163367964b8c0b50
        docs/compiler-benchmark.md: 0c9735e4a0f38cfe1f04ba955e103af19de7bc7fffc8506f03cf08f5e42380e4
        docs/releasing.md: a46134cd81e46690b0d0a5003c82c28d676fcd038fc25c5545a1cb0e2f832f3f
        docs/settings.md: fb6ff8195aea5e7198c58978b2ddd576bad291344283fbc3ef0ab0eb0f25e45a
        docs/troubleshooting.md: 118e91a571558a0d6aed99c7dfcafd592f31022faad6e5ad6b076c5a9c688b73
        docs/usage.md: a61aa7631a95fd2724ddba95933fbb9a5e951d7cf268957f5907a8ad459ffb3a
        index.phase1.test.ts: 113dcc79a51a216e0f23372a352992f55cf163b0e594982b5621d40285fa305e
        index.phase5.test.ts: 2bb02a7aab442d06941042d5088902dc29d24ca00bfde8f94a5868b9fc686020
        index.test.ts: b8697744329f12560b0205679a046046552d32477f498bf65767560a915ccbaf
        index.ts: 033710154492de4ed5d452aa4d07fa65c192cc3dde683dcb238c643952870bee
        index.v12.test.ts: 4b3bbd27accf76f6969a3e85401b6dd6884e234def14bc083437c91eabc59701
        lib/bm25.test.ts: 0fdcb41087f8fd5c62624088aae64b14f1cde65da45e1898cc85ca2038650b4c
        lib/bm25.ts: 00ec5ea25040b9fe88e0cd5538d5aa75aa1a6d5ea1b9fac3ecd491e905e08537
        lib/cache-runs.test.ts: 065effd0b1c7be678077d0137d498b87a38c2328a630473b86966ea8463e2be0
        lib/cache-runs.ts: e384ac5736b8f3803dc226f3483e9c01a7b725fb2839073b8cf66c6f0f21f421
        lib/checkpoint-update.test.ts: fe2480ef76ac8cfa716e5552f5c83e82155134d54e522c9ac692a986d6102285
        lib/checkpoint-update.ts: dbb4115a98e445149c4900922128248aa08177683525117a5581b7af8f892e22
        lib/compaction-card-dedupe.test.ts: 2af0cfcfa9c33744bd821fb435fbbcdeb9f3e5f3119f08d6ab7ad239d8638899
        lib/compaction-card-dedupe.ts: b15f9286e1715e9e47ce6ab04a5cef57260f541115c970507b36b950a7529e58
        lib/compaction-card.test.ts: 10efd22edb9e70155be542385f4f8e9b28a2085b6a30e87da22ef6491b37d060
        lib/compaction-card.ts: 3eba217ca318cce075ebe6d1f0776efa3c523f43a553406fe4e01af63f2a95db
        lib/compaction-source.test.ts: 7d043e9afa9ca2636996f9fff478e480e4254bfbe1742d21d0e7a5331541592f
        lib/compaction-source.ts: df5fac5b9a5853759ffc042c3c9d463dcef91ad746034cd6c52773b620267243
        lib/compile-session-file.ts: 37795fbc5054717b2aae8eff343079c68c12f6c8eb62189dc95c25fcef7a90b6
        lib/compiler/anchors.ts: da9d1e8fba8cbc84054f7b73f5bf85be7fe12692bc5f4624538cbdef370f953e
        lib/compiler/budget-formatter.test.ts: e2c2af5a4a041dc2b6c87c29b19f249db32a90e1476437d5407788399aaafa44
        lib/compiler/budget-formatter.ts: 23b876eee5619de92a327b6e9a8f7b3d46146021b0fccf91a1d6bbacd7002925
        lib/compiler/checkpoint-ladder.test.ts: f709202745e1807d7f14b3aea474c64d8008ef419b5586cc7b774eb2f54f95e9
        lib/compiler/checkpoint.test.ts: ff93c53ee31ea55563b7abccdb3108c70d510a7e3e1b6ca053256c82cef87974
        lib/compiler/checkpoint.ts: 65b409e1799e68e70a3440120d58e618fa4665f7a4b97970b30902a5c87951ed
        lib/compiler/conversation-reducer.phase4.test.ts: b9540ec821862376668d91c68faf166a01f68e2134f690275444f192beb0c25c
        lib/compiler/conversation-reducer.test.ts: 1ea56c0d5ffdac53c7ed5d1cc9c75050970e7cb4157af4618708ac6e63c5b7fb
        lib/compiler/conversation-reducer.ts: 57a3b7a08bf851137f6ea40e150f2f20be86f94d31469aaee1a2730efd5d0c1e
        lib/compiler/display-projection.test.ts: 310d7ff71b3603b5b6f736826ce9243136f918708362f2b7f67d6811e687cf9a
        lib/compiler/display-projection.ts: 27aedd88003afeb7d3b855ab88ec8f3783aae6efcbd4c926f70b1a44bbf23d65
        lib/compiler/errors.ts: bdb940fd1bb4b9b9e1958fddf23a774371794eaf6712123ca32e9a83957a18b7
        lib/compiler/evidence-lifetime.test.ts: 02349b64b03975289c8225f8a7e43769554e9303243b640dc46006f0c091050a
        lib/compiler/handoff-projection.test.ts: 0c1974fed453762934e057ce80ff7ee0cde2e62a1cb5ac231cf46bfba20fdf83
        lib/compiler/helpers.ts: 614594b7678e483bffd86ac664dc7a097bbbfdac4c28eb5f2d60c998fe09aaad
        lib/compiler/lexical-budget.ts: 7661f2775b25a75986b1fc539bed0efa544067573828a904ec681d8108e4f87b
        lib/compiler/normalizer.test.ts: 691742bcbcb087ddf5e83fd11ca85dfd884db94c58046ab463ee9aa1edf00491
        lib/compiler/normalizer.ts: 9dee1d55a09adbc6a36380701324cb92412988b9b50418211a755e9d43694f85
        lib/compiler/observed-readiness.test.ts: 371717edf02d8cbe08429c7ddc2f00a37d036610722c9e3971c4833a2b4bfb62
        lib/compiler/observed-readiness.ts: a61fe1797add41cbb1d0206fad44d414010b56d446787210acc0d44ec9bcc8f8
        lib/compiler/optional-selector.test.ts: 60e1de16a0af3c530b45fd626ef802058e04c664bbd8d831dafbe9ea3398210f
        lib/compiler/optional-selector.ts: 3028a31bb5e4f628eb762900374fad5d07267c70108f845b612dfea40bdd7061
        lib/compiler/path-roots.ts: 8b1771d0dac7e04f23e2076a681caa9f986e22ce6a8c91d36072fa7356c1ffa7
        lib/compiler/protected-overflow-regression.test.ts: a68ab7a94a586c576561f2a847b1b26dec78eb35f5c6f8b6a4231224ff16f672
        lib/compiler/request-candidate.test.ts: 756fb4d777d3aa1bc1a364352e8864a18d9db86514e2df784e631b173b0c935d
        lib/compiler/request-candidate.ts: 3b84f9386e7fc9beb299d7f46b6bbd74a91086b9cbac81ad056e6bc245067b1f
        lib/compiler/resume-index.test.ts: 27dd32d78a1e2ea88ee1278884c6e021407847587b44d16a368abf8c2a73599d
        lib/compiler/resume-index.ts: 0bb0fe3b835054b391858f13d5a4690f33ea505cc9e41ceb4d405a8ed9b81ed7
        lib/compiler/resume-plan.phase4.test.ts: 794b0955940d9831dc022059c0ec10c4e687353b967c5246559c922e851d76f7
        lib/compiler/section-scanner.test.ts: 54c9bde4ac6d8fd50363b1071c51f2714e7e6bbb9187abc2e13b63fcc97ee3d0
        lib/compiler/section-scanner.ts: 3f548fd9c41b115fd2620b2aa4ba571a0401a1fba4a88d49d26d1de2e82d9632
        lib/compiler/shell-analysis.test.ts: d76439d9ab2b1d4ae97392ea31659d999b60fc15993d4b262701ec6f7f3f8986
        lib/compiler/shell-analysis.ts: a44b9996d16b88122f2e287ec5ffafc2fbb211df308abe58d3551eda1e03696b
        lib/compiler/structural-v12.test.ts: a90f578c3bf6514c7c4f2ad5d3fd1cd08f1e2f2e91c7af6ad2b305d8124ba056
        lib/compiler/tool-effects-v12.test.ts: 398b4c9e476ede216ffd78d5ff4cd6bacce6c349f87c49bc181f81b5d8f14ddf
        lib/compiler/tool-effects.ts: 08462f0d2b52fa1d8a5a22115797759fd9d6f250ce9c0675061f3ed8ce3da526
        lib/compiler/tool-tracker.ts: 0f119a507a50361631f035e619db1e9dc77404b4a4d4fd636aa3885beef3ff17
        lib/compiler/types.ts: e039000df576be98758b4870f4d65644cdeca20a84a6e0f558d26e93c69910c4
        lib/compiler/verification-display.test.ts: 6e265a6f14bf320f322e5fa7db649c192f9702a1f20cafba811d8953b2e2cbea
        lib/compiler/verification-display.ts: c698e75804e37b1f5ce0f62602a139de10260cf3485d7436105bb037c6c46fc3
        lib/compiler/verification-observation.test.ts: 3110b011fb28a269ec045fb0ae63bb4e291f5fc090c7c20b00afcd65c3cb5276
        lib/compiler/verification-observation.ts: 0a50e89b868dc4522de0dbe57b695639a29c0dd7e257166f03d9364b12c1f536
        lib/continuation-recovery.test.ts: f87d36a7a646662da521da318260e73ba9ad1f853f1a207c1f1543727f1207ba
        lib/continuation-recovery.ts: 66645435aeb9fd3d53b209f6c96f39bd77c2c3103ba8f98d2b6966c6a2daa9aa
        lib/continuation.test.ts: 003c96689f72271a960ed65ce82a669fa830a92cca5f2c1a8813b789c7dffff0
        lib/continuation.ts: aeede077ece2b51e6698b3abcee9b04bbbb1d4ae8e41119e4bfdc3108b2d018b
        lib/data-migration.test.ts: 8674f7c68408e5e17416ce0f154ca10a8ea9f923a0d0a9ed6c145a70860bf478
        lib/data-migration.ts: f10e00e99a4ca076b3d82f97e2e9ecf6db4decc67ed8321179239407a789b51a
        lib/diag-support.test.ts: 8d1f675a3bf67a05cd11f313f2d19e594b0eb8caee75ccb725292428bbead9f8
        lib/diag-support.ts: 8bcc298e70155870262b32c124725b93890a1a75f57846ab5dc2f8b823851b81
        lib/entries-support.test.ts: 8220f20b7b83995db64a0961f2415319c7393613e3859903beb5203750c38f2c
        lib/entries-support.ts: a3f88f00943f790b5e3820c6b6e300cb7342561e1dbdab8d2a2feea57e867668
        lib/events-support.test.ts: 435dfd11eaf4a24104155c05d608fb7bf4652afc6886b63df42ff783e75e58bc
        lib/events-support.ts: 38d9a5228b96e4ce1a0fdda0ed437bb6bc8a5ff9ebece5f30544d2711b5502ac
        lib/extract-tags.ts: 9a31d5165d48710bd108118cc8d9c6f5a3351c1ba7b7533d1aaa455407c871a4
        lib/focus-echo.test.ts: 828d33fda65680a92af4d39e78886021eadc50e75b50345c858a5a829889ea07
        lib/focus-echo.ts: 2b2caa30257e4914a4b8c104d33b9f137cc5e6aa30719d8234be58c54404d551
        lib/fs-support.test.ts: 798d5b2d6ff1d667e1817d7e15f46a1386521e825e8735dea85552d43569c7e7
        lib/fs-support.ts: 781773b23e0dcca774b32b9d72a7384366aa32e72cb284aad70cdc0f4a9f638d
        lib/handoff.test.ts: 126b67aad40e34474560e3e11716b912f0a73a33dcd3babb6c55c959e56ee701
        lib/handoff.ts: 2a31c02abaad242fb1a8b37fb9a735902a9061dd77ba137177bf65b8f4e83aeb
        lib/json-object-keys.ts: 29506e7775909619e67bf2fd6a3174a0805140671fdd3caf8ee4545d3e6bd3ab
        lib/legacy-compat.test.ts: d65e8055b25a5d97f0b7c86ce96c7ffa3d71d52df5f36e8ed4ea12b040bad3ba
        lib/legacy.ts: 880a2c0b83050dfbb8bf31eee8d9cd628763017b7f8fa8502cf5faba55f681b1
        lib/local-compact.test.ts: d85835d8e8ed9898fb6d0001a670ec848f386d6fd9cbb21a2404724aa2e9ba8b
        lib/local-compact.ts: f30644758346df1b4551bb1de172fc65bf851e87be3c0b9ef018ade3cee05a3a
        lib/metric.test.ts: e8cfe49b5b87d67ff79e7a98691dbd88bc8334f62e41425ce3fddd078418d7ea
        lib/metric.ts: 4c2682b5858bf6f41e92bb9bf80463146813e16eb7f39fd700ed9088f030837b
        lib/monitor.test.ts: 1eeb119cbacb00b37afd7a883c016f9e8934342435a231a6b8911cb58087ccc8
        lib/monitor.ts: 5d832f113026968a03afc4f0e39560d19dd36c351f446b13293af7ad15583eb9
        lib/notify-support.test.ts: 753e639c9e7af3da17fe04016257d2ea976edb9f88638c6fd20fb02ec2184aba
        lib/notify-support.ts: eef58b4cd5e39dc246df5ccecc8a1e3ccca323751ca48fccd87f49947872e88d
        lib/offline/checkpoint-corpus.ts: 0a72f85ef6ae2bc816cfd73c4e4cf16da1773a308909e61cd127b8325483290b
        lib/offline/checkpoint-evaluator.test.ts: f69e4f8e24fccd35e9b2c19df43a012a2ae5764397ec83c2d4c0d3848d331846
        lib/offline/checkpoint-evaluator.ts: eac6b3aa8c45efbfd98717e93d20be5e684f9d539b82c28c3ee4681af9bb77df
        lib/offline/performance-gate.test.ts: 348a8b6d25b835e25ad1263f20da903cbfaeddc31539c107db05314420bccb46
        lib/offline/performance-gate.ts: fda5c8a2c1aaa6f1c167205bde70c8a0e8a3ddc78dd16deeec7c96e2955b1af4
        lib/offline/quality-corpus.ts: db57c6a8e3249ca3b22a9aaf4bdff41868b6c7a9bb52948d08575841c229dc96
        lib/offline/quality-evaluator.test.ts: b5229efda06630399d805b33dd9823d98bdfd3405146b6a7eaaeeba6f83e0ad6
        lib/offline/quality-evaluator.ts: 4b904d6a0cdb9ad4690d8377277fd292ffa42fbd850fa01e0477a3ac1f3ea4ac
        lib/offline/supplemental-corpus.ts: 67a6d152264a1175dc6dd56f74010058fd9b99b7111b4e6402dd93a8075748e2
        lib/offline/supplemental-evaluator.test.ts: a981d8f5a5f6a457aa7b0775b4b50662c16b5ad7e88f7447f1bd454edb9b7ecd
        lib/offline/supplemental-evaluator.ts: 39cdc53497afbb46a71a22ec7717c57bb05043c07960826d15ee5956cb3e3b5b
        lib/offline/survival-corpus.ts: ce740dd3eb31584b6efe97f538579ced28d4e68875347c75b429a645a82faa89
        lib/offline/survival-evaluator.test.ts: c47c76095dfe7c77c86b4c839d5fb3ee3adb06e0d36c7ae29683721af9a7dd72
        lib/offline/survival-evaluator.ts: a727b00c61468b695efe1cb4a1bced8dcd0be60b2f01052d284fcb19cdb0e233
        lib/output-compactor.test.ts: 819c399fce5cdc1639f0500bf15fe007774b7fba5dbc2d15d1880e7ca5bd13cb
        lib/output-compactor.ts: 9ebd68c1c7e82a98357d1a416935a5750cbf2980553644513102bf45dac1e524
        lib/paths.test.ts: 4786b00420e80ef17304f57e8e44a3ead0918edd37d050334267a2a7869ff9e2
        lib/paths.ts: a14afd19b1e330f64bebad580267c651464809377b00abcb555bcf0c489e1c5b
        lib/phase1-controller.test.ts: 6994035ad74027a19fd428aec4f1e60531e480cb13e7fdab32f972b2e50e2ae4
        lib/phase1-controller.ts: dbda83ed14bd87b327882a5aa425e5015c74d28042316c0792e15b9038dd77dd
        lib/phase1-lifecycle.property.test.ts: 9f1e47135522544f0b80e73805af2c629ad0af6d374f69c5ea8f22ae09cb9129
        lib/recall-entry.ts: f95094d09264906e083d76073b64d276af10caf4a69cbe7057bba0377b58f680
        lib/recall-projection.test.ts: fcd199d1ac107167871560ac6aad3a737a1be843ad1481c0bfb7b40f7aa1fff4
        lib/recall-projection.ts: 34d0523d3a3aab93f69705c7589d97d49f34ea6c5f9e1ada9045fdb4cea3a658
        lib/recall.test.ts: e90896852ccf2c1ca4d1d853238d3095fcad2f04f5f40352a9d7ad936f86d7a3
        lib/recall.ts: b87ca426ef87f0945f517218182d5473cfd65444e3e4eacacdaf685ef431491f
        lib/resumption-fidelity.test.ts: 955e8b60828aac8a91c8804a607608135e700e1a518a04af2c62fcdb0eec2846
        lib/runtime-probe.ts: 5a384c1d5f730ff6c62714b10ecda71090aaee19b7c8f1bba144d74a030b1f77
        lib/sdk.ts: 81ef935bdfe4a6daa8cda7cf585a7c7f0295a644fbb709fc38cef03906768937
        lib/session-evaluator.test.ts: cdcb0cb4b9b3c15899433ed4836984a84558f3a9bd78e4e940b193f6fdbb81cc
        lib/session-evaluator.ts: a4e0d0ab76bf3672f149e64b936e9c593a51165a1581616178d7cfc4897d0722
        lib/settings.test.ts: 871e2332afca88f92ecf31a9fc84bfdbe9e099aced6d9c97ec0702eb1fd7f309
        lib/settings.ts: 0017d98b0668145b586eb20ac42d96ecc089210e73711bac0002892fa98a7a7f
        lib/sha256.test.ts: 9131960dae17083192659dd10196b4fb83a998b70d4bed88d3073acab41fe85b
        lib/sha256.ts: 523f5efaa3ac2982f8f833240cb002351b52721420c48309a34f05f5b07dd125
        lib/store.test.ts: 856fbd303337d059314b858aaf5004a39198b92d49f35efe17d0a2612c53d3e1
        lib/store.ts: 3a8d1f9db3e38a66e33fdc365a03d5aa0e38761d45815595c16c45176bd97b37
        lib/strategy.test.ts: e549e307fb40eea44731981eafd5ed08d39dbce392f938d7f38ce44845bd662d
        lib/strategy.ts: 65a116cd0ae9d72c61afaed2b49947f4e6d8351f522446dc6f17f974b53e2b36
        lib/tool-result.test.ts: 85e238dadf1beea81baccc3361fffb96ca6a1ac6a101213c6f98e42f36dc3f76
        lib/tool-result.ts: 6cecb489009b8f7406b18ced9a0a6f2a19757c9a0efc020e197ee53c115bfd11
        lib/trigger.test.ts: a7b74a128989c66951d1e567fda7a19d6e32af1bf56a8e0722e5430cd894b658
        lib/trigger.ts: 5fa705fc16a31dcd2fedc703a7fb8ef1ad5069b60618aa4a1018d9f4ec31c206
        lib/tui-block.test.ts: ee25d80023627b5c63fadd15aa8978135e09006b0962f74fa2dacb6b410a1de1
        lib/tui-block.ts: 2c7200875c91b2cadf05d6ca88b7d7748f1f249c42b68937852f674ed50cea7c
        lib/types.ts: aade627b2f2683de80a138cc81ae59a71d25e4151e953b0fdf8040a3aa08809f
        lib/unicode.test.ts: 9f4b8ad3dea9b38f3e373575cf29e07898564e55be88627eb9b571deda013521
        lib/unicode.ts: 2a1a14f6c87a12f5acc1ef0ed8b10f3e30912f6344d46d1928f2a3a1434ca123
        lib/wire-format.ts: b149adac61adfc596173474e33d432cd93263e81a90608c70af755f44df2f9fa
        package.json: c59b7f5e269b4cb79288f9a880a2408dde2082b5b2b76e162a6e8f2b2b47a681
        scripts/benchmark-compiler.ts: 9e2bc7e815c273621e7312b3e54b8ddff0897180c444dbd08b016a87c7075f1a
        scripts/check-architecture.ts: abfedfb9a1fe62f32dac370a9579f14f4010e4dc78ba93c2cb33ba5d85697480
        scripts/evaluate-selector.ts: 59f6eeada8b20f3d7893f87f15d32ec4b87e07c1585e7c9af94b332f532b8c37
        tests/compare-session.ts: eecb3847c156685dc634be07033a55b41b44f385f1e8723ae8d59d8ea1562792
        tests/e2e/README.md: 92ab2889d74d1f9f3cd6e2270c42c55198141bad6efa4aca061553fa32822a8b
        tests/e2e/busy-compaction.e2e.ts: df742676f8b66743773a8eca41de6de06d6ca6dd0308f95ca41d7022ad21f937
        tests/e2e/current-compaction.test.ts: 9efd50ccfa00f3645e076a4614ae5ea480320eb92c4c74e36ae1caf516cd95a9
        tests/e2e/demo.ts: 866b6d6a0ec2fd77d7bfe478dd49234a1855a05dfde83b3672f18bf46ea6fd78
        tests/e2e/harness/compaction-barrier.ts: c303a0bcde5d55b521570a5e06c0beaf86a1f47f81ac457ec77f7a4bb97db58e
        tests/e2e/harness/current-compaction.ts: 30009cbf2bd0bf92579480ba06acba76db7415839d38dea61aa50861f137b8bf
        tests/e2e/harness/env.ts: 80d510793aee4cc973e8dd59110a5b5871deea0a53fd26b93962325e94b06b99
        tests/e2e/harness/fake-provider.ts: 660fcff8b643a9bc3e749bb912acacd0384bdae41389ab7e2d2b5f405c8aa7f1
        tests/e2e/harness/preparation-fault.ts: 1d2e977db7ca4f80cedcc6452414e700113a5d870ee9f480c7c7c33dd9fbb15d
        tests/e2e/harness/rpc-client.ts: 42525b4925d12d0cebdeb92b5cab758369975f0e7e6a70eb10b4028bb07c3b31
        tests/e2e/interception.e2e.ts: b2cefbc64ab9d5b5213dbd9398eb09612945729565038e1a4ee3ebf6168e3a90
        tests/e2e/lifecycle.e2e.ts: 6468c3c34a2f5355d6a95c57350157ef8d34a0357121ed54ba9a8e82296a4fd7
        tests/fixtures/parser-session.jsonl: 50575fa33d879ec0e2ce4b1455545dd2836f12d37f54f4a6e731794b387c40e7
        tests/harness/fake-pi.ts: 471929329a9da287771609a65655e393b95eed3f9b8c07a8799dc12d48d1caf6
        tests/harness/preparation-fixture.ts: ec8bf72df94a9f82c24d719df8f10ccea9db3eb814a6654f1fa3514979ffedae
        tests/verify-improvement.test.ts: a9a5f39929a9c12274c448bfb574fbbc92e9c28df4ae3736876be3608019e433
        tsconfig.json: 08529066dec16388122122f2582069e400770a8587711b912794e10896615b0f
      at: 2026-10-05T23:43:09.804Z
    intended: run frozen gate TG5
    next_action: continue next frozen gate or diagnose failure
    after:
      digest: df406a8f72d7e1c8cc1e3cb948747ce98dcb0839c47303ee11663adbc4530010
      entries:
        .dependency-cruiser.cjs: f90d4b8c206440cc7006c105126ddb091a8ae57bc1a8225b49b54e63b0356edf
        .gitignore: 8f21e3b9b123ffa75121a0ae451782c432407acc21cc784d8fc095cd3e8c3cf7
        AGENTS.md: af56ae1e888439e976f2eac7ecf8c447ff2f73f99bba3b8900dcdf1add2b4286
        CLAUDE.md: symlink:AGENTS.md
        LICENSE: e2e52298290bec0f61398b5684006a59f0d8e2a7374e7f4cd134d5c36b660a47
        README.md: 4dae887df73702ccaf751e5683a42c298a59ecb1dee9251f5c4072ca4bb62e2f
        bin/dc-distill-session.ts: 15d9306ff37153205e88eda1baab634e341e2a25e6c9da5ca409f6762192524f
        bun.lock: 997ed36d6a2500f0e8ab160da30dd689f3c12e885e42933fe03e8aa7746e61eb
        debug/checkpoint-gate.ts: 6ac8afb9d7315db48851f95a64237676fe45cff3afe6b3fc62798f32d0076f6f
        debug/live-repro.ts: df3cd57568e1b68ccf2b21bd8d4acbf0802779d916e56b8de1a59a01ae69c3ad
        docs-contract.test.ts: e176e2eed18179cc551e295bae31f58c8730aa1e26321fce22c5b266f03fbaae
        docs/adr/0001-vendored-framework-boundary.md: 1388e4baba3d47fc433924c9807239fe50c596b57f318675c42b667b38c7329a
        docs/adr/0002-remove-vendored-framework.md: 2fbfc6def5635e9bfc1c5d2359ad779954c6f39dbebbd2bdf9417c93bd06d634
        docs/algorithm.md: 996beaaa59f3813f03b075ae2168120f2b47a133a695da75a457f93bc94c6d02
        docs/architecture.md: acf03df39fbb9e7a230a14cfba7ac3853c56a68bf3a45851ddb9c0ac2f1eb0ee
        docs/assets/distill-before-after.svg: 80ab3aa5b4f4bf2032daed7f08ecf25ffea586c5b733fa87163367964b8c0b50
        docs/compiler-benchmark.md: 0c9735e4a0f38cfe1f04ba955e103af19de7bc7fffc8506f03cf08f5e42380e4
        docs/releasing.md: a46134cd81e46690b0d0a5003c82c28d676fcd038fc25c5545a1cb0e2f832f3f
        docs/settings.md: fb6ff8195aea5e7198c58978b2ddd576bad291344283fbc3ef0ab0eb0f25e45a
        docs/troubleshooting.md: 118e91a571558a0d6aed99c7dfcafd592f31022faad6e5ad6b076c5a9c688b73
        docs/usage.md: a61aa7631a95fd2724ddba95933fbb9a5e951d7cf268957f5907a8ad459ffb3a
        index.phase1.test.ts: 113dcc79a51a216e0f23372a352992f55cf163b0e594982b5621d40285fa305e
        index.phase5.test.ts: 2bb02a7aab442d06941042d5088902dc29d24ca00bfde8f94a5868b9fc686020
        index.test.ts: b8697744329f12560b0205679a046046552d32477f498bf65767560a915ccbaf
        index.ts: 033710154492de4ed5d452aa4d07fa65c192cc3dde683dcb238c643952870bee
        index.v12.test.ts: 4b3bbd27accf76f6969a3e85401b6dd6884e234def14bc083437c91eabc59701
        lib/bm25.test.ts: 0fdcb41087f8fd5c62624088aae64b14f1cde65da45e1898cc85ca2038650b4c
        lib/bm25.ts: 00ec5ea25040b9fe88e0cd5538d5aa75aa1a6d5ea1b9fac3ecd491e905e08537
        lib/cache-runs.test.ts: 065effd0b1c7be678077d0137d498b87a38c2328a630473b86966ea8463e2be0
        lib/cache-runs.ts: e384ac5736b8f3803dc226f3483e9c01a7b725fb2839073b8cf66c6f0f21f421
        lib/checkpoint-update.test.ts: fe2480ef76ac8cfa716e5552f5c83e82155134d54e522c9ac692a986d6102285
        lib/checkpoint-update.ts: dbb4115a98e445149c4900922128248aa08177683525117a5581b7af8f892e22
        lib/compaction-card-dedupe.test.ts: 2af0cfcfa9c33744bd821fb435fbbcdeb9f3e5f3119f08d6ab7ad239d8638899
        lib/compaction-card-dedupe.ts: b15f9286e1715e9e47ce6ab04a5cef57260f541115c970507b36b950a7529e58
        lib/compaction-card.test.ts: 10efd22edb9e70155be542385f4f8e9b28a2085b6a30e87da22ef6491b37d060
        lib/compaction-card.ts: 3eba217ca318cce075ebe6d1f0776efa3c523f43a553406fe4e01af63f2a95db
        lib/compaction-source.test.ts: 7d043e9afa9ca2636996f9fff478e480e4254bfbe1742d21d0e7a5331541592f
        lib/compaction-source.ts: df5fac5b9a5853759ffc042c3c9d463dcef91ad746034cd6c52773b620267243
        lib/compile-session-file.ts: 37795fbc5054717b2aae8eff343079c68c12f6c8eb62189dc95c25fcef7a90b6
        lib/compiler/anchors.ts: da9d1e8fba8cbc84054f7b73f5bf85be7fe12692bc5f4624538cbdef370f953e
        lib/compiler/budget-formatter.test.ts: e2c2af5a4a041dc2b6c87c29b19f249db32a90e1476437d5407788399aaafa44
        lib/compiler/budget-formatter.ts: 23b876eee5619de92a327b6e9a8f7b3d46146021b0fccf91a1d6bbacd7002925
        lib/compiler/checkpoint-ladder.test.ts: f709202745e1807d7f14b3aea474c64d8008ef419b5586cc7b774eb2f54f95e9
        lib/compiler/checkpoint.test.ts: ff93c53ee31ea55563b7abccdb3108c70d510a7e3e1b6ca053256c82cef87974
        lib/compiler/checkpoint.ts: 65b409e1799e68e70a3440120d58e618fa4665f7a4b97970b30902a5c87951ed
        lib/compiler/conversation-reducer.phase4.test.ts: b9540ec821862376668d91c68faf166a01f68e2134f690275444f192beb0c25c
        lib/compiler/conversation-reducer.test.ts: 1ea56c0d5ffdac53c7ed5d1cc9c75050970e7cb4157af4618708ac6e63c5b7fb
        lib/compiler/conversation-reducer.ts: 57a3b7a08bf851137f6ea40e150f2f20be86f94d31469aaee1a2730efd5d0c1e
        lib/compiler/display-projection.test.ts: 310d7ff71b3603b5b6f736826ce9243136f918708362f2b7f67d6811e687cf9a
        lib/compiler/display-projection.ts: 27aedd88003afeb7d3b855ab88ec8f3783aae6efcbd4c926f70b1a44bbf23d65
        lib/compiler/errors.ts: bdb940fd1bb4b9b9e1958fddf23a774371794eaf6712123ca32e9a83957a18b7
        lib/compiler/evidence-lifetime.test.ts: 02349b64b03975289c8225f8a7e43769554e9303243b640dc46006f0c091050a
        lib/compiler/handoff-projection.test.ts: 0c1974fed453762934e057ce80ff7ee0cde2e62a1cb5ac231cf46bfba20fdf83
        lib/compiler/helpers.ts: 614594b7678e483bffd86ac664dc7a097bbbfdac4c28eb5f2d60c998fe09aaad
        lib/compiler/lexical-budget.ts: 7661f2775b25a75986b1fc539bed0efa544067573828a904ec681d8108e4f87b
        lib/compiler/normalizer.test.ts: 691742bcbcb087ddf5e83fd11ca85dfd884db94c58046ab463ee9aa1edf00491
        lib/compiler/normalizer.ts: 9dee1d55a09adbc6a36380701324cb92412988b9b50418211a755e9d43694f85
        lib/compiler/observed-readiness.test.ts: 371717edf02d8cbe08429c7ddc2f00a37d036610722c9e3971c4833a2b4bfb62
        lib/compiler/observed-readiness.ts: a61fe1797add41cbb1d0206fad44d414010b56d446787210acc0d44ec9bcc8f8
        lib/compiler/optional-selector.test.ts: 60e1de16a0af3c530b45fd626ef802058e04c664bbd8d831dafbe9ea3398210f
        lib/compiler/optional-selector.ts: 3028a31bb5e4f628eb762900374fad5d07267c70108f845b612dfea40bdd7061
        lib/compiler/path-roots.ts: 8b1771d0dac7e04f23e2076a681caa9f986e22ce6a8c91d36072fa7356c1ffa7
        lib/compiler/protected-overflow-regression.test.ts: a68ab7a94a586c576561f2a847b1b26dec78eb35f5c6f8b6a4231224ff16f672
        lib/compiler/request-candidate.test.ts: 756fb4d777d3aa1bc1a364352e8864a18d9db86514e2df784e631b173b0c935d
        lib/compiler/request-candidate.ts: 3b84f9386e7fc9beb299d7f46b6bbd74a91086b9cbac81ad056e6bc245067b1f
        lib/compiler/resume-index.test.ts: 27dd32d78a1e2ea88ee1278884c6e021407847587b44d16a368abf8c2a73599d
        lib/compiler/resume-index.ts: 0bb0fe3b835054b391858f13d5a4690f33ea505cc9e41ceb4d405a8ed9b81ed7
        lib/compiler/resume-plan.phase4.test.ts: 794b0955940d9831dc022059c0ec10c4e687353b967c5246559c922e851d76f7
        lib/compiler/section-scanner.test.ts: 54c9bde4ac6d8fd50363b1071c51f2714e7e6bbb9187abc2e13b63fcc97ee3d0
        lib/compiler/section-scanner.ts: 3f548fd9c41b115fd2620b2aa4ba571a0401a1fba4a88d49d26d1de2e82d9632
        lib/compiler/shell-analysis.test.ts: d76439d9ab2b1d4ae97392ea31659d999b60fc15993d4b262701ec6f7f3f8986
        lib/compiler/shell-analysis.ts: a44b9996d16b88122f2e287ec5ffafc2fbb211df308abe58d3551eda1e03696b
        lib/compiler/structural-v12.test.ts: a90f578c3bf6514c7c4f2ad5d3fd1cd08f1e2f2e91c7af6ad2b305d8124ba056
        lib/compiler/tool-effects-v12.test.ts: 398b4c9e476ede216ffd78d5ff4cd6bacce6c349f87c49bc181f81b5d8f14ddf
        lib/compiler/tool-effects.ts: 08462f0d2b52fa1d8a5a22115797759fd9d6f250ce9c0675061f3ed8ce3da526
        lib/compiler/tool-tracker.ts: 0f119a507a50361631f035e619db1e9dc77404b4a4d4fd636aa3885beef3ff17
        lib/compiler/types.ts: e039000df576be98758b4870f4d65644cdeca20a84a6e0f558d26e93c69910c4
        lib/compiler/verification-display.test.ts: 6e265a6f14bf320f322e5fa7db649c192f9702a1f20cafba811d8953b2e2cbea
        lib/compiler/verification-display.ts: c698e75804e37b1f5ce0f62602a139de10260cf3485d7436105bb037c6c46fc3
        lib/compiler/verification-observation.test.ts: 3110b011fb28a269ec045fb0ae63bb4e291f5fc090c7c20b00afcd65c3cb5276
        lib/compiler/verification-observation.ts: 0a50e89b868dc4522de0dbe57b695639a29c0dd7e257166f03d9364b12c1f536
        lib/continuation-recovery.test.ts: f87d36a7a646662da521da318260e73ba9ad1f853f1a207c1f1543727f1207ba
        lib/continuation-recovery.ts: 66645435aeb9fd3d53b209f6c96f39bd77c2c3103ba8f98d2b6966c6a2daa9aa
        lib/continuation.test.ts: 003c96689f72271a960ed65ce82a669fa830a92cca5f2c1a8813b789c7dffff0
        lib/continuation.ts: aeede077ece2b51e6698b3abcee9b04bbbb1d4ae8e41119e4bfdc3108b2d018b
        lib/data-migration.test.ts: 8674f7c68408e5e17416ce0f154ca10a8ea9f923a0d0a9ed6c145a70860bf478
        lib/data-migration.ts: f10e00e99a4ca076b3d82f97e2e9ecf6db4decc67ed8321179239407a789b51a
        lib/diag-support.test.ts: 8d1f675a3bf67a05cd11f313f2d19e594b0eb8caee75ccb725292428bbead9f8
        lib/diag-support.ts: 8bcc298e70155870262b32c124725b93890a1a75f57846ab5dc2f8b823851b81
        lib/entries-support.test.ts: 8220f20b7b83995db64a0961f2415319c7393613e3859903beb5203750c38f2c
        lib/entries-support.ts: a3f88f00943f790b5e3820c6b6e300cb7342561e1dbdab8d2a2feea57e867668
        lib/events-support.test.ts: 435dfd11eaf4a24104155c05d608fb7bf4652afc6886b63df42ff783e75e58bc
        lib/events-support.ts: 38d9a5228b96e4ce1a0fdda0ed437bb6bc8a5ff9ebece5f30544d2711b5502ac
        lib/extract-tags.ts: 9a31d5165d48710bd108118cc8d9c6f5a3351c1ba7b7533d1aaa455407c871a4
        lib/focus-echo.test.ts: 828d33fda65680a92af4d39e78886021eadc50e75b50345c858a5a829889ea07
        lib/focus-echo.ts: 2b2caa30257e4914a4b8c104d33b9f137cc5e6aa30719d8234be58c54404d551
        lib/fs-support.test.ts: 798d5b2d6ff1d667e1817d7e15f46a1386521e825e8735dea85552d43569c7e7
        lib/fs-support.ts: 781773b23e0dcca774b32b9d72a7384366aa32e72cb284aad70cdc0f4a9f638d
        lib/handoff.test.ts: 126b67aad40e34474560e3e11716b912f0a73a33dcd3babb6c55c959e56ee701
        lib/handoff.ts: 2a31c02abaad242fb1a8b37fb9a735902a9061dd77ba137177bf65b8f4e83aeb
        lib/json-object-keys.ts: 29506e7775909619e67bf2fd6a3174a0805140671fdd3caf8ee4545d3e6bd3ab
        lib/legacy-compat.test.ts: d65e8055b25a5d97f0b7c86ce96c7ffa3d71d52df5f36e8ed4ea12b040bad3ba
        lib/legacy.ts: 880a2c0b83050dfbb8bf31eee8d9cd628763017b7f8fa8502cf5faba55f681b1
        lib/local-compact.test.ts: d85835d8e8ed9898fb6d0001a670ec848f386d6fd9cbb21a2404724aa2e9ba8b
        lib/local-compact.ts: f30644758346df1b4551bb1de172fc65bf851e87be3c0b9ef018ade3cee05a3a
        lib/metric.test.ts: e8cfe49b5b87d67ff79e7a98691dbd88bc8334f62e41425ce3fddd078418d7ea
        lib/metric.ts: 4c2682b5858bf6f41e92bb9bf80463146813e16eb7f39fd700ed9088f030837b
        lib/monitor.test.ts: 1eeb119cbacb00b37afd7a883c016f9e8934342435a231a6b8911cb58087ccc8
        lib/monitor.ts: 5d832f113026968a03afc4f0e39560d19dd36c351f446b13293af7ad15583eb9
        lib/notify-support.test.ts: 753e639c9e7af3da17fe04016257d2ea976edb9f88638c6fd20fb02ec2184aba
        lib/notify-support.ts: eef58b4cd5e39dc246df5ccecc8a1e3ccca323751ca48fccd87f49947872e88d
        lib/offline/checkpoint-corpus.ts: 0a72f85ef6ae2bc816cfd73c4e4cf16da1773a308909e61cd127b8325483290b
        lib/offline/checkpoint-evaluator.test.ts: f69e4f8e24fccd35e9b2c19df43a012a2ae5764397ec83c2d4c0d3848d331846
        lib/offline/checkpoint-evaluator.ts: eac6b3aa8c45efbfd98717e93d20be5e684f9d539b82c28c3ee4681af9bb77df
        lib/offline/performance-gate.test.ts: 348a8b6d25b835e25ad1263f20da903cbfaeddc31539c107db05314420bccb46
        lib/offline/performance-gate.ts: fda5c8a2c1aaa6f1c167205bde70c8a0e8a3ddc78dd16deeec7c96e2955b1af4
        lib/offline/quality-corpus.ts: db57c6a8e3249ca3b22a9aaf4bdff41868b6c7a9bb52948d08575841c229dc96
        lib/offline/quality-evaluator.test.ts: b5229efda06630399d805b33dd9823d98bdfd3405146b6a7eaaeeba6f83e0ad6
        lib/offline/quality-evaluator.ts: 4b904d6a0cdb9ad4690d8377277fd292ffa42fbd850fa01e0477a3ac1f3ea4ac
        lib/offline/supplemental-corpus.ts: 67a6d152264a1175dc6dd56f74010058fd9b99b7111b4e6402dd93a8075748e2
        lib/offline/supplemental-evaluator.test.ts: a981d8f5a5f6a457aa7b0775b4b50662c16b5ad7e88f7447f1bd454edb9b7ecd
        lib/offline/supplemental-evaluator.ts: 39cdc53497afbb46a71a22ec7717c57bb05043c07960826d15ee5956cb3e3b5b
        lib/offline/survival-corpus.ts: ce740dd3eb31584b6efe97f538579ced28d4e68875347c75b429a645a82faa89
        lib/offline/survival-evaluator.test.ts: c47c76095dfe7c77c86b4c839d5fb3ee3adb06e0d36c7ae29683721af9a7dd72
        lib/offline/survival-evaluator.ts: a727b00c61468b695efe1cb4a1bced8dcd0be60b2f01052d284fcb19cdb0e233
        lib/output-compactor.test.ts: 819c399fce5cdc1639f0500bf15fe007774b7fba5dbc2d15d1880e7ca5bd13cb
        lib/output-compactor.ts: 9ebd68c1c7e82a98357d1a416935a5750cbf2980553644513102bf45dac1e524
        lib/paths.test.ts: 4786b00420e80ef17304f57e8e44a3ead0918edd37d050334267a2a7869ff9e2
        lib/paths.ts: a14afd19b1e330f64bebad580267c651464809377b00abcb555bcf0c489e1c5b
        lib/phase1-controller.test.ts: 6994035ad74027a19fd428aec4f1e60531e480cb13e7fdab32f972b2e50e2ae4
        lib/phase1-controller.ts: dbda83ed14bd87b327882a5aa425e5015c74d28042316c0792e15b9038dd77dd
        lib/phase1-lifecycle.property.test.ts: 9f1e47135522544f0b80e73805af2c629ad0af6d374f69c5ea8f22ae09cb9129
        lib/recall-entry.ts: f95094d09264906e083d76073b64d276af10caf4a69cbe7057bba0377b58f680
        lib/recall-projection.test.ts: fcd199d1ac107167871560ac6aad3a737a1be843ad1481c0bfb7b40f7aa1fff4
        lib/recall-projection.ts: 34d0523d3a3aab93f69705c7589d97d49f34ea6c5f9e1ada9045fdb4cea3a658
        lib/recall.test.ts: e90896852ccf2c1ca4d1d853238d3095fcad2f04f5f40352a9d7ad936f86d7a3
        lib/recall.ts: b87ca426ef87f0945f517218182d5473cfd65444e3e4eacacdaf685ef431491f
        lib/resumption-fidelity.test.ts: 955e8b60828aac8a91c8804a607608135e700e1a518a04af2c62fcdb0eec2846
        lib/runtime-probe.ts: 5a384c1d5f730ff6c62714b10ecda71090aaee19b7c8f1bba144d74a030b1f77
        lib/sdk.ts: 81ef935bdfe4a6daa8cda7cf585a7c7f0295a644fbb709fc38cef03906768937
        lib/session-evaluator.test.ts: cdcb0cb4b9b3c15899433ed4836984a84558f3a9bd78e4e940b193f6fdbb81cc
        lib/session-evaluator.ts: a4e0d0ab76bf3672f149e64b936e9c593a51165a1581616178d7cfc4897d0722
        lib/settings.test.ts: 871e2332afca88f92ecf31a9fc84bfdbe9e099aced6d9c97ec0702eb1fd7f309
        lib/settings.ts: 0017d98b0668145b586eb20ac42d96ecc089210e73711bac0002892fa98a7a7f
        lib/sha256.test.ts: 9131960dae17083192659dd10196b4fb83a998b70d4bed88d3073acab41fe85b
        lib/sha256.ts: 523f5efaa3ac2982f8f833240cb002351b52721420c48309a34f05f5b07dd125
        lib/store.test.ts: 856fbd303337d059314b858aaf5004a39198b92d49f35efe17d0a2612c53d3e1
        lib/store.ts: 3a8d1f9db3e38a66e33fdc365a03d5aa0e38761d45815595c16c45176bd97b37
        lib/strategy.test.ts: e549e307fb40eea44731981eafd5ed08d39dbce392f938d7f38ce44845bd662d
        lib/strategy.ts: 65a116cd0ae9d72c61afaed2b49947f4e6d8351f522446dc6f17f974b53e2b36
        lib/tool-result.test.ts: 85e238dadf1beea81baccc3361fffb96ca6a1ac6a101213c6f98e42f36dc3f76
        lib/tool-result.ts: 6cecb489009b8f7406b18ced9a0a6f2a19757c9a0efc020e197ee53c115bfd11
        lib/trigger.test.ts: a7b74a128989c66951d1e567fda7a19d6e32af1bf56a8e0722e5430cd894b658
        lib/trigger.ts: 5fa705fc16a31dcd2fedc703a7fb8ef1ad5069b60618aa4a1018d9f4ec31c206
        lib/tui-block.test.ts: ee25d80023627b5c63fadd15aa8978135e09006b0962f74fa2dacb6b410a1de1
        lib/tui-block.ts: 2c7200875c91b2cadf05d6ca88b7d7748f1f249c42b68937852f674ed50cea7c
        lib/types.ts: aade627b2f2683de80a138cc81ae59a71d25e4151e953b0fdf8040a3aa08809f
        lib/unicode.test.ts: 9f4b8ad3dea9b38f3e373575cf29e07898564e55be88627eb9b571deda013521
        lib/unicode.ts: 2a1a14f6c87a12f5acc1ef0ed8b10f3e30912f6344d46d1928f2a3a1434ca123
        lib/wire-format.ts: b149adac61adfc596173474e33d432cd93263e81a90608c70af755f44df2f9fa
        package.json: c59b7f5e269b4cb79288f9a880a2408dde2082b5b2b76e162a6e8f2b2b47a681
        scripts/benchmark-compiler.ts: 9e2bc7e815c273621e7312b3e54b8ddff0897180c444dbd08b016a87c7075f1a
        scripts/check-architecture.ts: abfedfb9a1fe62f32dac370a9579f14f4010e4dc78ba93c2cb33ba5d85697480
        scripts/evaluate-selector.ts: 59f6eeada8b20f3d7893f87f15d32ec4b87e07c1585e7c9af94b332f532b8c37
        tests/compare-session.ts: eecb3847c156685dc634be07033a55b41b44f385f1e8723ae8d59d8ea1562792
        tests/e2e/README.md: 92ab2889d74d1f9f3cd6e2270c42c55198141bad6efa4aca061553fa32822a8b
        tests/e2e/busy-compaction.e2e.ts: df742676f8b66743773a8eca41de6de06d6ca6dd0308f95ca41d7022ad21f937
        tests/e2e/current-compaction.test.ts: 9efd50ccfa00f3645e076a4614ae5ea480320eb92c4c74e36ae1caf516cd95a9
        tests/e2e/demo.ts: 866b6d6a0ec2fd77d7bfe478dd49234a1855a05dfde83b3672f18bf46ea6fd78
        tests/e2e/harness/compaction-barrier.ts: c303a0bcde5d55b521570a5e06c0beaf86a1f47f81ac457ec77f7a4bb97db58e
        tests/e2e/harness/current-compaction.ts: 30009cbf2bd0bf92579480ba06acba76db7415839d38dea61aa50861f137b8bf
        tests/e2e/harness/env.ts: 80d510793aee4cc973e8dd59110a5b5871deea0a53fd26b93962325e94b06b99
        tests/e2e/harness/fake-provider.ts: 660fcff8b643a9bc3e749bb912acacd0384bdae41389ab7e2d2b5f405c8aa7f1
        tests/e2e/harness/preparation-fault.ts: 1d2e977db7ca4f80cedcc6452414e700113a5d870ee9f480c7c7c33dd9fbb15d
        tests/e2e/harness/rpc-client.ts: 42525b4925d12d0cebdeb92b5cab758369975f0e7e6a70eb10b4028bb07c3b31
        tests/e2e/interception.e2e.ts: b2cefbc64ab9d5b5213dbd9398eb09612945729565038e1a4ee3ebf6168e3a90
        tests/e2e/lifecycle.e2e.ts: 6468c3c34a2f5355d6a95c57350157ef8d34a0357121ed54ba9a8e82296a4fd7
        tests/fixtures/parser-session.jsonl: 50575fa33d879ec0e2ce4b1455545dd2836f12d37f54f4a6e731794b387c40e7
        tests/harness/fake-pi.ts: 471929329a9da287771609a65655e393b95eed3f9b8c07a8799dc12d48d1caf6
        tests/harness/preparation-fixture.ts: ec8bf72df94a9f82c24d719df8f10ccea9db3eb814a6654f1fa3514979ffedae
        tests/verify-improvement.test.ts: a9a5f39929a9c12274c448bfb574fbbc92e9c28df4ae3736876be3608019e433
        tsconfig.json: 08529066dec16388122122f2582069e400770a8587711b912794e10896615b0f
      at: 2026-10-05T23:43:09.987Z
    result: passed
    evidence:
      gate: TG5
      command: git diff --check
      working_directory: /Users/vampire/code/ts/pi-dc-distill
      exit: 0
      signal: null
      started: 2026-10-05T23:43:09.870Z
      ended: 2026-10-05T23:43:09.911Z
      log: /tmp/current-compaction-TG5.log
      output: ""
  - kind: checkpoint
    checkpoint_id: native-demo-repair-accounting-correction
    phase: reconciled
    evidence: mechanical repair checkpoint labelled TG1; actual recorded failing
      demo gate was TG2; consumed task/run attempts remain unchanged
    prior_failing_gate: TG1
    correct_failing_gate: TG2
  - kind: final_review
    result: passed
    evidence: acceptance-owned diff reviewed; lifecycle assertions retained;
      production/ambient/index preserved; no successor
    source:
      digest: df406a8f72d7e1c8cc1e3cb948747ce98dcb0839c47303ee11663adbc4530010
      entries:
        .dependency-cruiser.cjs: f90d4b8c206440cc7006c105126ddb091a8ae57bc1a8225b49b54e63b0356edf
        .gitignore: 8f21e3b9b123ffa75121a0ae451782c432407acc21cc784d8fc095cd3e8c3cf7
        AGENTS.md: af56ae1e888439e976f2eac7ecf8c447ff2f73f99bba3b8900dcdf1add2b4286
        CLAUDE.md: symlink:AGENTS.md
        LICENSE: e2e52298290bec0f61398b5684006a59f0d8e2a7374e7f4cd134d5c36b660a47
        README.md: 4dae887df73702ccaf751e5683a42c298a59ecb1dee9251f5c4072ca4bb62e2f
        bin/dc-distill-session.ts: 15d9306ff37153205e88eda1baab634e341e2a25e6c9da5ca409f6762192524f
        bun.lock: 997ed36d6a2500f0e8ab160da30dd689f3c12e885e42933fe03e8aa7746e61eb
        debug/checkpoint-gate.ts: 6ac8afb9d7315db48851f95a64237676fe45cff3afe6b3fc62798f32d0076f6f
        debug/live-repro.ts: df3cd57568e1b68ccf2b21bd8d4acbf0802779d916e56b8de1a59a01ae69c3ad
        docs-contract.test.ts: e176e2eed18179cc551e295bae31f58c8730aa1e26321fce22c5b266f03fbaae
        docs/adr/0001-vendored-framework-boundary.md: 1388e4baba3d47fc433924c9807239fe50c596b57f318675c42b667b38c7329a
        docs/adr/0002-remove-vendored-framework.md: 2fbfc6def5635e9bfc1c5d2359ad779954c6f39dbebbd2bdf9417c93bd06d634
        docs/algorithm.md: 996beaaa59f3813f03b075ae2168120f2b47a133a695da75a457f93bc94c6d02
        docs/architecture.md: acf03df39fbb9e7a230a14cfba7ac3853c56a68bf3a45851ddb9c0ac2f1eb0ee
        docs/assets/distill-before-after.svg: 80ab3aa5b4f4bf2032daed7f08ecf25ffea586c5b733fa87163367964b8c0b50
        docs/compiler-benchmark.md: 0c9735e4a0f38cfe1f04ba955e103af19de7bc7fffc8506f03cf08f5e42380e4
        docs/releasing.md: a46134cd81e46690b0d0a5003c82c28d676fcd038fc25c5545a1cb0e2f832f3f
        docs/settings.md: fb6ff8195aea5e7198c58978b2ddd576bad291344283fbc3ef0ab0eb0f25e45a
        docs/troubleshooting.md: 118e91a571558a0d6aed99c7dfcafd592f31022faad6e5ad6b076c5a9c688b73
        docs/usage.md: a61aa7631a95fd2724ddba95933fbb9a5e951d7cf268957f5907a8ad459ffb3a
        index.phase1.test.ts: 113dcc79a51a216e0f23372a352992f55cf163b0e594982b5621d40285fa305e
        index.phase5.test.ts: 2bb02a7aab442d06941042d5088902dc29d24ca00bfde8f94a5868b9fc686020
        index.test.ts: b8697744329f12560b0205679a046046552d32477f498bf65767560a915ccbaf
        index.ts: 033710154492de4ed5d452aa4d07fa65c192cc3dde683dcb238c643952870bee
        index.v12.test.ts: 4b3bbd27accf76f6969a3e85401b6dd6884e234def14bc083437c91eabc59701
        lib/bm25.test.ts: 0fdcb41087f8fd5c62624088aae64b14f1cde65da45e1898cc85ca2038650b4c
        lib/bm25.ts: 00ec5ea25040b9fe88e0cd5538d5aa75aa1a6d5ea1b9fac3ecd491e905e08537
        lib/cache-runs.test.ts: 065effd0b1c7be678077d0137d498b87a38c2328a630473b86966ea8463e2be0
        lib/cache-runs.ts: e384ac5736b8f3803dc226f3483e9c01a7b725fb2839073b8cf66c6f0f21f421
        lib/checkpoint-update.test.ts: fe2480ef76ac8cfa716e5552f5c83e82155134d54e522c9ac692a986d6102285
        lib/checkpoint-update.ts: dbb4115a98e445149c4900922128248aa08177683525117a5581b7af8f892e22
        lib/compaction-card-dedupe.test.ts: 2af0cfcfa9c33744bd821fb435fbbcdeb9f3e5f3119f08d6ab7ad239d8638899
        lib/compaction-card-dedupe.ts: b15f9286e1715e9e47ce6ab04a5cef57260f541115c970507b36b950a7529e58
        lib/compaction-card.test.ts: 10efd22edb9e70155be542385f4f8e9b28a2085b6a30e87da22ef6491b37d060
        lib/compaction-card.ts: 3eba217ca318cce075ebe6d1f0776efa3c523f43a553406fe4e01af63f2a95db
        lib/compaction-source.test.ts: 7d043e9afa9ca2636996f9fff478e480e4254bfbe1742d21d0e7a5331541592f
        lib/compaction-source.ts: df5fac5b9a5853759ffc042c3c9d463dcef91ad746034cd6c52773b620267243
        lib/compile-session-file.ts: 37795fbc5054717b2aae8eff343079c68c12f6c8eb62189dc95c25fcef7a90b6
        lib/compiler/anchors.ts: da9d1e8fba8cbc84054f7b73f5bf85be7fe12692bc5f4624538cbdef370f953e
        lib/compiler/budget-formatter.test.ts: e2c2af5a4a041dc2b6c87c29b19f249db32a90e1476437d5407788399aaafa44
        lib/compiler/budget-formatter.ts: 23b876eee5619de92a327b6e9a8f7b3d46146021b0fccf91a1d6bbacd7002925
        lib/compiler/checkpoint-ladder.test.ts: f709202745e1807d7f14b3aea474c64d8008ef419b5586cc7b774eb2f54f95e9
        lib/compiler/checkpoint.test.ts: ff93c53ee31ea55563b7abccdb3108c70d510a7e3e1b6ca053256c82cef87974
        lib/compiler/checkpoint.ts: 65b409e1799e68e70a3440120d58e618fa4665f7a4b97970b30902a5c87951ed
        lib/compiler/conversation-reducer.phase4.test.ts: b9540ec821862376668d91c68faf166a01f68e2134f690275444f192beb0c25c
        lib/compiler/conversation-reducer.test.ts: 1ea56c0d5ffdac53c7ed5d1cc9c75050970e7cb4157af4618708ac6e63c5b7fb
        lib/compiler/conversation-reducer.ts: 57a3b7a08bf851137f6ea40e150f2f20be86f94d31469aaee1a2730efd5d0c1e
        lib/compiler/display-projection.test.ts: 310d7ff71b3603b5b6f736826ce9243136f918708362f2b7f67d6811e687cf9a
        lib/compiler/display-projection.ts: 27aedd88003afeb7d3b855ab88ec8f3783aae6efcbd4c926f70b1a44bbf23d65
        lib/compiler/errors.ts: bdb940fd1bb4b9b9e1958fddf23a774371794eaf6712123ca32e9a83957a18b7
        lib/compiler/evidence-lifetime.test.ts: 02349b64b03975289c8225f8a7e43769554e9303243b640dc46006f0c091050a
        lib/compiler/handoff-projection.test.ts: 0c1974fed453762934e057ce80ff7ee0cde2e62a1cb5ac231cf46bfba20fdf83
        lib/compiler/helpers.ts: 614594b7678e483bffd86ac664dc7a097bbbfdac4c28eb5f2d60c998fe09aaad
        lib/compiler/lexical-budget.ts: 7661f2775b25a75986b1fc539bed0efa544067573828a904ec681d8108e4f87b
        lib/compiler/normalizer.test.ts: 691742bcbcb087ddf5e83fd11ca85dfd884db94c58046ab463ee9aa1edf00491
        lib/compiler/normalizer.ts: 9dee1d55a09adbc6a36380701324cb92412988b9b50418211a755e9d43694f85
        lib/compiler/observed-readiness.test.ts: 371717edf02d8cbe08429c7ddc2f00a37d036610722c9e3971c4833a2b4bfb62
        lib/compiler/observed-readiness.ts: a61fe1797add41cbb1d0206fad44d414010b56d446787210acc0d44ec9bcc8f8
        lib/compiler/optional-selector.test.ts: 60e1de16a0af3c530b45fd626ef802058e04c664bbd8d831dafbe9ea3398210f
        lib/compiler/optional-selector.ts: 3028a31bb5e4f628eb762900374fad5d07267c70108f845b612dfea40bdd7061
        lib/compiler/path-roots.ts: 8b1771d0dac7e04f23e2076a681caa9f986e22ce6a8c91d36072fa7356c1ffa7
        lib/compiler/protected-overflow-regression.test.ts: a68ab7a94a586c576561f2a847b1b26dec78eb35f5c6f8b6a4231224ff16f672
        lib/compiler/request-candidate.test.ts: 756fb4d777d3aa1bc1a364352e8864a18d9db86514e2df784e631b173b0c935d
        lib/compiler/request-candidate.ts: 3b84f9386e7fc9beb299d7f46b6bbd74a91086b9cbac81ad056e6bc245067b1f
        lib/compiler/resume-index.test.ts: 27dd32d78a1e2ea88ee1278884c6e021407847587b44d16a368abf8c2a73599d
        lib/compiler/resume-index.ts: 0bb0fe3b835054b391858f13d5a4690f33ea505cc9e41ceb4d405a8ed9b81ed7
        lib/compiler/resume-plan.phase4.test.ts: 794b0955940d9831dc022059c0ec10c4e687353b967c5246559c922e851d76f7
        lib/compiler/section-scanner.test.ts: 54c9bde4ac6d8fd50363b1071c51f2714e7e6bbb9187abc2e13b63fcc97ee3d0
        lib/compiler/section-scanner.ts: 3f548fd9c41b115fd2620b2aa4ba571a0401a1fba4a88d49d26d1de2e82d9632
        lib/compiler/shell-analysis.test.ts: d76439d9ab2b1d4ae97392ea31659d999b60fc15993d4b262701ec6f7f3f8986
        lib/compiler/shell-analysis.ts: a44b9996d16b88122f2e287ec5ffafc2fbb211df308abe58d3551eda1e03696b
        lib/compiler/structural-v12.test.ts: a90f578c3bf6514c7c4f2ad5d3fd1cd08f1e2f2e91c7af6ad2b305d8124ba056
        lib/compiler/tool-effects-v12.test.ts: 398b4c9e476ede216ffd78d5ff4cd6bacce6c349f87c49bc181f81b5d8f14ddf
        lib/compiler/tool-effects.ts: 08462f0d2b52fa1d8a5a22115797759fd9d6f250ce9c0675061f3ed8ce3da526
        lib/compiler/tool-tracker.ts: 0f119a507a50361631f035e619db1e9dc77404b4a4d4fd636aa3885beef3ff17
        lib/compiler/types.ts: e039000df576be98758b4870f4d65644cdeca20a84a6e0f558d26e93c69910c4
        lib/compiler/verification-display.test.ts: 6e265a6f14bf320f322e5fa7db649c192f9702a1f20cafba811d8953b2e2cbea
        lib/compiler/verification-display.ts: c698e75804e37b1f5ce0f62602a139de10260cf3485d7436105bb037c6c46fc3
        lib/compiler/verification-observation.test.ts: 3110b011fb28a269ec045fb0ae63bb4e291f5fc090c7c20b00afcd65c3cb5276
        lib/compiler/verification-observation.ts: 0a50e89b868dc4522de0dbe57b695639a29c0dd7e257166f03d9364b12c1f536
        lib/continuation-recovery.test.ts: f87d36a7a646662da521da318260e73ba9ad1f853f1a207c1f1543727f1207ba
        lib/continuation-recovery.ts: 66645435aeb9fd3d53b209f6c96f39bd77c2c3103ba8f98d2b6966c6a2daa9aa
        lib/continuation.test.ts: 003c96689f72271a960ed65ce82a669fa830a92cca5f2c1a8813b789c7dffff0
        lib/continuation.ts: aeede077ece2b51e6698b3abcee9b04bbbb1d4ae8e41119e4bfdc3108b2d018b
        lib/data-migration.test.ts: 8674f7c68408e5e17416ce0f154ca10a8ea9f923a0d0a9ed6c145a70860bf478
        lib/data-migration.ts: f10e00e99a4ca076b3d82f97e2e9ecf6db4decc67ed8321179239407a789b51a
        lib/diag-support.test.ts: 8d1f675a3bf67a05cd11f313f2d19e594b0eb8caee75ccb725292428bbead9f8
        lib/diag-support.ts: 8bcc298e70155870262b32c124725b93890a1a75f57846ab5dc2f8b823851b81
        lib/entries-support.test.ts: 8220f20b7b83995db64a0961f2415319c7393613e3859903beb5203750c38f2c
        lib/entries-support.ts: a3f88f00943f790b5e3820c6b6e300cb7342561e1dbdab8d2a2feea57e867668
        lib/events-support.test.ts: 435dfd11eaf4a24104155c05d608fb7bf4652afc6886b63df42ff783e75e58bc
        lib/events-support.ts: 38d9a5228b96e4ce1a0fdda0ed437bb6bc8a5ff9ebece5f30544d2711b5502ac
        lib/extract-tags.ts: 9a31d5165d48710bd108118cc8d9c6f5a3351c1ba7b7533d1aaa455407c871a4
        lib/focus-echo.test.ts: 828d33fda65680a92af4d39e78886021eadc50e75b50345c858a5a829889ea07
        lib/focus-echo.ts: 2b2caa30257e4914a4b8c104d33b9f137cc5e6aa30719d8234be58c54404d551
        lib/fs-support.test.ts: 798d5b2d6ff1d667e1817d7e15f46a1386521e825e8735dea85552d43569c7e7
        lib/fs-support.ts: 781773b23e0dcca774b32b9d72a7384366aa32e72cb284aad70cdc0f4a9f638d
        lib/handoff.test.ts: 126b67aad40e34474560e3e11716b912f0a73a33dcd3babb6c55c959e56ee701
        lib/handoff.ts: 2a31c02abaad242fb1a8b37fb9a735902a9061dd77ba137177bf65b8f4e83aeb
        lib/json-object-keys.ts: 29506e7775909619e67bf2fd6a3174a0805140671fdd3caf8ee4545d3e6bd3ab
        lib/legacy-compat.test.ts: d65e8055b25a5d97f0b7c86ce96c7ffa3d71d52df5f36e8ed4ea12b040bad3ba
        lib/legacy.ts: 880a2c0b83050dfbb8bf31eee8d9cd628763017b7f8fa8502cf5faba55f681b1
        lib/local-compact.test.ts: d85835d8e8ed9898fb6d0001a670ec848f386d6fd9cbb21a2404724aa2e9ba8b
        lib/local-compact.ts: f30644758346df1b4551bb1de172fc65bf851e87be3c0b9ef018ade3cee05a3a
        lib/metric.test.ts: e8cfe49b5b87d67ff79e7a98691dbd88bc8334f62e41425ce3fddd078418d7ea
        lib/metric.ts: 4c2682b5858bf6f41e92bb9bf80463146813e16eb7f39fd700ed9088f030837b
        lib/monitor.test.ts: 1eeb119cbacb00b37afd7a883c016f9e8934342435a231a6b8911cb58087ccc8
        lib/monitor.ts: 5d832f113026968a03afc4f0e39560d19dd36c351f446b13293af7ad15583eb9
        lib/notify-support.test.ts: 753e639c9e7af3da17fe04016257d2ea976edb9f88638c6fd20fb02ec2184aba
        lib/notify-support.ts: eef58b4cd5e39dc246df5ccecc8a1e3ccca323751ca48fccd87f49947872e88d
        lib/offline/checkpoint-corpus.ts: 0a72f85ef6ae2bc816cfd73c4e4cf16da1773a308909e61cd127b8325483290b
        lib/offline/checkpoint-evaluator.test.ts: f69e4f8e24fccd35e9b2c19df43a012a2ae5764397ec83c2d4c0d3848d331846
        lib/offline/checkpoint-evaluator.ts: eac6b3aa8c45efbfd98717e93d20be5e684f9d539b82c28c3ee4681af9bb77df
        lib/offline/performance-gate.test.ts: 348a8b6d25b835e25ad1263f20da903cbfaeddc31539c107db05314420bccb46
        lib/offline/performance-gate.ts: fda5c8a2c1aaa6f1c167205bde70c8a0e8a3ddc78dd16deeec7c96e2955b1af4
        lib/offline/quality-corpus.ts: db57c6a8e3249ca3b22a9aaf4bdff41868b6c7a9bb52948d08575841c229dc96
        lib/offline/quality-evaluator.test.ts: b5229efda06630399d805b33dd9823d98bdfd3405146b6a7eaaeeba6f83e0ad6
        lib/offline/quality-evaluator.ts: 4b904d6a0cdb9ad4690d8377277fd292ffa42fbd850fa01e0477a3ac1f3ea4ac
        lib/offline/supplemental-corpus.ts: 67a6d152264a1175dc6dd56f74010058fd9b99b7111b4e6402dd93a8075748e2
        lib/offline/supplemental-evaluator.test.ts: a981d8f5a5f6a457aa7b0775b4b50662c16b5ad7e88f7447f1bd454edb9b7ecd
        lib/offline/supplemental-evaluator.ts: 39cdc53497afbb46a71a22ec7717c57bb05043c07960826d15ee5956cb3e3b5b
        lib/offline/survival-corpus.ts: ce740dd3eb31584b6efe97f538579ced28d4e68875347c75b429a645a82faa89
        lib/offline/survival-evaluator.test.ts: c47c76095dfe7c77c86b4c839d5fb3ee3adb06e0d36c7ae29683721af9a7dd72
        lib/offline/survival-evaluator.ts: a727b00c61468b695efe1cb4a1bced8dcd0be60b2f01052d284fcb19cdb0e233
        lib/output-compactor.test.ts: 819c399fce5cdc1639f0500bf15fe007774b7fba5dbc2d15d1880e7ca5bd13cb
        lib/output-compactor.ts: 9ebd68c1c7e82a98357d1a416935a5750cbf2980553644513102bf45dac1e524
        lib/paths.test.ts: 4786b00420e80ef17304f57e8e44a3ead0918edd37d050334267a2a7869ff9e2
        lib/paths.ts: a14afd19b1e330f64bebad580267c651464809377b00abcb555bcf0c489e1c5b
        lib/phase1-controller.test.ts: 6994035ad74027a19fd428aec4f1e60531e480cb13e7fdab32f972b2e50e2ae4
        lib/phase1-controller.ts: dbda83ed14bd87b327882a5aa425e5015c74d28042316c0792e15b9038dd77dd
        lib/phase1-lifecycle.property.test.ts: 9f1e47135522544f0b80e73805af2c629ad0af6d374f69c5ea8f22ae09cb9129
        lib/recall-entry.ts: f95094d09264906e083d76073b64d276af10caf4a69cbe7057bba0377b58f680
        lib/recall-projection.test.ts: fcd199d1ac107167871560ac6aad3a737a1be843ad1481c0bfb7b40f7aa1fff4
        lib/recall-projection.ts: 34d0523d3a3aab93f69705c7589d97d49f34ea6c5f9e1ada9045fdb4cea3a658
        lib/recall.test.ts: e90896852ccf2c1ca4d1d853238d3095fcad2f04f5f40352a9d7ad936f86d7a3
        lib/recall.ts: b87ca426ef87f0945f517218182d5473cfd65444e3e4eacacdaf685ef431491f
        lib/resumption-fidelity.test.ts: 955e8b60828aac8a91c8804a607608135e700e1a518a04af2c62fcdb0eec2846
        lib/runtime-probe.ts: 5a384c1d5f730ff6c62714b10ecda71090aaee19b7c8f1bba144d74a030b1f77
        lib/sdk.ts: 81ef935bdfe4a6daa8cda7cf585a7c7f0295a644fbb709fc38cef03906768937
        lib/session-evaluator.test.ts: cdcb0cb4b9b3c15899433ed4836984a84558f3a9bd78e4e940b193f6fdbb81cc
        lib/session-evaluator.ts: a4e0d0ab76bf3672f149e64b936e9c593a51165a1581616178d7cfc4897d0722
        lib/settings.test.ts: 871e2332afca88f92ecf31a9fc84bfdbe9e099aced6d9c97ec0702eb1fd7f309
        lib/settings.ts: 0017d98b0668145b586eb20ac42d96ecc089210e73711bac0002892fa98a7a7f
        lib/sha256.test.ts: 9131960dae17083192659dd10196b4fb83a998b70d4bed88d3073acab41fe85b
        lib/sha256.ts: 523f5efaa3ac2982f8f833240cb002351b52721420c48309a34f05f5b07dd125
        lib/store.test.ts: 856fbd303337d059314b858aaf5004a39198b92d49f35efe17d0a2612c53d3e1
        lib/store.ts: 3a8d1f9db3e38a66e33fdc365a03d5aa0e38761d45815595c16c45176bd97b37
        lib/strategy.test.ts: e549e307fb40eea44731981eafd5ed08d39dbce392f938d7f38ce44845bd662d
        lib/strategy.ts: 65a116cd0ae9d72c61afaed2b49947f4e6d8351f522446dc6f17f974b53e2b36
        lib/tool-result.test.ts: 85e238dadf1beea81baccc3361fffb96ca6a1ac6a101213c6f98e42f36dc3f76
        lib/tool-result.ts: 6cecb489009b8f7406b18ced9a0a6f2a19757c9a0efc020e197ee53c115bfd11
        lib/trigger.test.ts: a7b74a128989c66951d1e567fda7a19d6e32af1bf56a8e0722e5430cd894b658
        lib/trigger.ts: 5fa705fc16a31dcd2fedc703a7fb8ef1ad5069b60618aa4a1018d9f4ec31c206
        lib/tui-block.test.ts: ee25d80023627b5c63fadd15aa8978135e09006b0962f74fa2dacb6b410a1de1
        lib/tui-block.ts: 2c7200875c91b2cadf05d6ca88b7d7748f1f249c42b68937852f674ed50cea7c
        lib/types.ts: aade627b2f2683de80a138cc81ae59a71d25e4151e953b0fdf8040a3aa08809f
        lib/unicode.test.ts: 9f4b8ad3dea9b38f3e373575cf29e07898564e55be88627eb9b571deda013521
        lib/unicode.ts: 2a1a14f6c87a12f5acc1ef0ed8b10f3e30912f6344d46d1928f2a3a1434ca123
        lib/wire-format.ts: b149adac61adfc596173474e33d432cd93263e81a90608c70af755f44df2f9fa
        package.json: c59b7f5e269b4cb79288f9a880a2408dde2082b5b2b76e162a6e8f2b2b47a681
        scripts/benchmark-compiler.ts: 9e2bc7e815c273621e7312b3e54b8ddff0897180c444dbd08b016a87c7075f1a
        scripts/check-architecture.ts: abfedfb9a1fe62f32dac370a9579f14f4010e4dc78ba93c2cb33ba5d85697480
        scripts/evaluate-selector.ts: 59f6eeada8b20f3d7893f87f15d32ec4b87e07c1585e7c9af94b332f532b8c37
        tests/compare-session.ts: eecb3847c156685dc634be07033a55b41b44f385f1e8723ae8d59d8ea1562792
        tests/e2e/README.md: 92ab2889d74d1f9f3cd6e2270c42c55198141bad6efa4aca061553fa32822a8b
        tests/e2e/busy-compaction.e2e.ts: df742676f8b66743773a8eca41de6de06d6ca6dd0308f95ca41d7022ad21f937
        tests/e2e/current-compaction.test.ts: 9efd50ccfa00f3645e076a4614ae5ea480320eb92c4c74e36ae1caf516cd95a9
        tests/e2e/demo.ts: 866b6d6a0ec2fd77d7bfe478dd49234a1855a05dfde83b3672f18bf46ea6fd78
        tests/e2e/harness/compaction-barrier.ts: c303a0bcde5d55b521570a5e06c0beaf86a1f47f81ac457ec77f7a4bb97db58e
        tests/e2e/harness/current-compaction.ts: 30009cbf2bd0bf92579480ba06acba76db7415839d38dea61aa50861f137b8bf
        tests/e2e/harness/env.ts: 80d510793aee4cc973e8dd59110a5b5871deea0a53fd26b93962325e94b06b99
        tests/e2e/harness/fake-provider.ts: 660fcff8b643a9bc3e749bb912acacd0384bdae41389ab7e2d2b5f405c8aa7f1
        tests/e2e/harness/preparation-fault.ts: 1d2e977db7ca4f80cedcc6452414e700113a5d870ee9f480c7c7c33dd9fbb15d
        tests/e2e/harness/rpc-client.ts: 42525b4925d12d0cebdeb92b5cab758369975f0e7e6a70eb10b4028bb07c3b31
        tests/e2e/interception.e2e.ts: b2cefbc64ab9d5b5213dbd9398eb09612945729565038e1a4ee3ebf6168e3a90
        tests/e2e/lifecycle.e2e.ts: 6468c3c34a2f5355d6a95c57350157ef8d34a0357121ed54ba9a8e82296a4fd7
        tests/fixtures/parser-session.jsonl: 50575fa33d879ec0e2ce4b1455545dd2836f12d37f54f4a6e731794b387c40e7
        tests/harness/fake-pi.ts: 471929329a9da287771609a65655e393b95eed3f9b8c07a8799dc12d48d1caf6
        tests/harness/preparation-fixture.ts: ec8bf72df94a9f82c24d719df8f10ccea9db3eb814a6654f1fa3514979ffedae
        tests/verify-improvement.test.ts: a9a5f39929a9c12274c448bfb574fbbc92e9c28df4ae3736876be3608019e433
        tsconfig.json: 08529066dec16388122122f2582069e400770a8587711b912794e10896615b0f
      at: 2026-10-05T23:44:55.616Z
finalization: null
repair_attempts:
  task_max: 4
  run_max: 12
  consumed_per_task:
    T1: 3
  consumed_run: 3
  consumed_per_failure:
    - task: T1
      failing_gate: TG1
      failure_signature: autonomous-fixture-assumes-synthetic-cooldown-on-no-compaction-branch
      consumed: 1
    - task: T1
      failing_gate: TG1
      failure_signature: autonomous-recall-must-distinguish-preserved-seed-from-new-attempt
      consumed: 1
    - task: T1
      failing_gate: TG2
      failure_signature: obsolete-demo-native-user-repetition-projection
      consumed: 1
objective: null
```
