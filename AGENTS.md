# AGENTS.md — pi-dc-distill

## What This Is

`dc-distill` replaces Pi's default LLM compactor with a deterministic, local
TypeScript compiler. Pi still owns `/compact`, cut selection, entry append, and
context rebuilding. This feature owns the `session_before_compact` result and
never calls an LLM.

## Planning and Orchestration

At every planning and phase boundary, actively look for opportunities to finish
faster by running native agents in parallel. Proactively dispatch genuinely
independent work with disjoint ownership and bounded task packets; reuse suitable
specialists, state dependencies, and assign one integration owner. Serialize
overlapping writes and dependent edits. Preserve agent-only execution and one
verifier after all planned edits; avoid duplicate checks and speculative agent
churn. Parallelism does not expand provider or action authority.

## Hard Invariants

1. Never add an LLM call. If a workflow needs subjective LLM summarization,
   build a separate extension from Pi's custom-compaction example.
2. Production compaction input comes only from Pi's `event.preparation` and
   active `event.branchEntries`. Never read the append-only session file in the
   live hook.
3. Fail closed with `Events.cancelCompact()`. A compiler failure or cancellation
   must never fall through to Pi's default compactor.
4. Success is transactional. Prepare the result in `session_before_compact`,
   but write success logs, dumps, recall, notifications, and monitor state only
   after a matching extension-owned `session_compact` event.
5. The runtime is owned by one primary session. Child/in-process sessions are
   no-ops, and their before-compact hooks cancel explicitly.

## Authoritative Input

`lib/compaction-source.ts` builds a typed `CompactionSource` in this order:

1. previous compaction summary
2. discarded `messagesToSummarize`
3. discarded split-turn `turnPrefixMessages`
4. latest eligible active-branch distill handoff

It directly normalizes user, assistant, tool-result, bash-execution, custom,
branch-summary, and compaction-summary messages. Retained tail entries and
abandoned branches cannot enter the compiler. The canonical normalized bytes
are reused for `inputDigest` and an optional before-dump.

Oversized input keeps metadata, the previous summary, and the newest whole
discarded records inside a 20 MiB envelope. It never slices JSON or message
records. `digestScope` is `compaction-input` or `bounded-compaction-input`.

`compileSessionJsonl()` and `compileSessionFile()` remain diagnostic/test
compatibility utilities only. They reject empty, malformed, truncated, and
entirely filtered input.

## Output Contract

`session_before_compact` returns Pi's canonical shape with dc-distill details
version 13:

```ts
{
  compaction: {
    summary: string,
    firstKeptEntryId: string,
    tokensBefore: number,
    details: {
      compactor: "dc-distill",
      version: 13,
      tier: 1,
      attemptId: string,
      autonomous: boolean,
      tokensAfter: number,
      summaryTokens: number,
      tokensAfterSource: "pi-rebuilt-message-estimate",
      capacityStatus: "unknown" | "within-window",
      contextWindow?: number,
      reductionPct: number,
      apiTokensBefore?: number,
      readFiles: string[],
      modifiedFiles: string[],
      literalAnchors: string[],
      inputDigest: string,
      summaryDigest: string,
      checkpoint: ResumeCheckpointV1,
      checkpointDigest: string,
      digestScope: "compaction-input" | "bounded-compaction-input"
    }
  }
}
```

`tokensAfter` is Pi's rebuilt message-context estimate, calculated with
`buildSessionContext()` and `estimateTokens()`. `summaryTokens` estimates the
returned summary alone. `summaryDigest` hashes the exact returned wire summary,
without a model-facing metric line. These counts are host-consistent heuristics. Version-5 through version-12 session entries remain
readable and are not rewritten.

The final summary is limited to 65,536 Unicode code points and targets an 8,192-
code-point operating state by dropping complete optional records first. User
focus is limited to 2,048 code points; read and modified file lists each keep 50
items; individual marker items keep 512 code points. Truncated lists include
omitted counts. Formatting must preserve complete headings and balanced XML
markers; never apply a final substring to structured output. Malformed decoded
Unicode, including materialized handoff fields, is rejected with a typed input
error; shortening valid Unicode preserves complete code points.

Version 9 adds exact lowercased tool aliases: `view_file` reads;
`write_to_file`, `replace_file_content`, `patch_file`, and `create_file` writes;
`write_to_file` and `create_file` are create-capable. Preserve raw tool names
for pairing. Path precedence is `path`, `file_path`, `filePath`, `file`, followed
by `targetFile`, `TargetFile`, `target_file`, `target_path`, `absolutePath`,
`AbsolutePath`.

Version 10 requires a unique matching call ID and compatible raw tool name,
with only the unique same-name ID-less fallback. Successful paired results alone
enter provenance-labeled file lists. Write risks retain full lexical path identity
and chronology independently of bounded display text; later successful paired
inspection resolves terminal risks across aliases, never a pending mutation.

Verification identity is exact runner, command bytes, and known working directory.
Potential mutations fence evidence at submission and completion, including failed
or pending work. Fresh passes start after preceding mutations finish, overlap no
mutation, and precede no later mutation. Mixed batches cannot establish execution
order. Missing diagnostic `isError` is incomplete; unknown cwd leaves scope and
freshness unestablished. Git observations distinguish status, worktree diff/stat,
whitespace checks, and revision comparisons and carry the same freshness rules.

Strict v1/v2/v3 handoff envelopes remain intact. V3 adds at most 32 observed
preconditions (`file-read-succeeded` and `verification-pass`) and task-level
`requires` lists. Evaluate immutable full-identity observations before display
shortening: fresh unique success is satisfied, fresh matching failure contradicted,
and stale/missing/incomplete/pending/overlapping/uncertain evidence unknown.
Graph readiness stays distinct; `<ready-tasks>` requires every predicate satisfied,
while `<graph-ready-tasks>` shows unknown or contradicted requirements. No task
is executed or stored status changed. Their partial task-state projection
is capped at 3,072 Unicode code points, with rendered field excerpts capped at
512. The budget includes escaping, framing, references, and omission notices;
complete records preserve balanced markers and report omissions and shortening.
Readiness is derived from the intact graph, and retained references never dangle.

Version 11 preserves exact verification identity and global mutation fencing.
Bounded shell analysis inspects supported compounds/pipelines and treats unsupported
syntax as unknown. Scan full supplied output before preview shortening; decisive
excerpts stay within 300 code points. Transcript-derived change-impact hints are
advisory only, with no filesystem enrichment or dependency-based pass preservation.
Version 12 uses the baseline production selector after the coverage candidate
failed its ordinary-workload performance gate. Coverage remains available offline;
production keeps one deterministic strategy.
Move complete handoff projection late, followed by resume risks/tasks, with metrics confined to details and committed notifications. Organization makes no attention or prompt-cache guarantee.
Invalid envelopes stay bounded legacy text.

## Transactional Lifecycle

`session_before_compact` snapshots counters, compiles, calculates prospective
metrics, freezes a `PendingCompaction`, and returns it. It does not emit durable
success artifacts or reset the monitor.

`session_compact` commits only when the owner session, extension identity,
details version 13, owning attempt/lease, settings/model snapshot, first-kept ID, exact summary digest, and validated checkpoint digest match. Commit
then resets the monitor from Pi's post-rebuild full-context usage when available,
writes log/dump/recall, clears failure state, notifies only in a UI, and queues
continuation only for an autonomous attempt. Continuation delivery is durable: the attempt id is journalled in the compaction details and the delivered message, and on `session_start` or tree changes a pure reducer over the active branch recovers an unanswered autonomous continuation subject to process submission fences and journal acknowledgement. Pending state and the latch are
released in `finally`. Historical v8–v12 autonomous continuations remain readable alongside v13.

Session replacement, shutdown, autonomous errors, cancellation, foreign
compaction, mismatches, and duplicate events cannot create success artifacts.
`session_compact_failed` releases pending/latch state only when its attempt identity matches. Anonymous failures preserve ambiguous reservations until an originating terminal callback or lifecycle reset; late events cannot clear another attempt. Preparation cancellation likewise retains its reservation, except that an anonymous aborted terminal event — the only terminal callback a native trigger has — releases an attempt that provably cannot commit: one whose preparation the runtime cancelled, or whose returned result can no longer be appended by the host.

## Trigger Policy

dc-distill has no extension trigger settings. It reads Pi's effective global and
project `compaction` settings through `pi.getSettings()` at primary-session
start, model selection, and before autonomous checks. Model-specific token
overrides follow Pi 0.99.2 precedence and validation; invalid settings block
autonomous checks without disabling manual deterministic interception:

| Band | Pi-derived boundary | Action |
| --- | --- | --- |
| Auto | `min(120,000, (contextWindow - reserveTokens) - 20,000)` | Mechanical compaction through warn-minus-one. |
| Warn | `contextWindow - reserveTokens` | Pi's native trigger line; cooperative warning through the headroom-floor-minus-one. |
| Headroom floor | `max(Warn, contextWindow - 20,480)` | Unconditional Mechanical compaction with emergency-grade guard bypass. |
| Emergency | `contextWindow` | Unconditional Mechanical compaction. |

`compaction.enabled: false` disables dc-distill's autonomous monitor; manual
`/compact` remains available. Fixed small-window floors preserve ordered bands,
and 100K/140K/160K are legacy fallbacks only when Pi cannot report a context
window; small-window floors can reduce the 20K lead. Ordinary checks require a
current finite positive host count and apply cooldown, post-compaction growth,
Pi-sync, and warmup guards. Emergency bypasses those guards; ownership, valid
enabled Pi settings, and the concurrency latch still apply. The 120,000-token target is fixed
policy, not extension configuration; smaller contexts are capped by Pi's safe
geometry. `auto-check blocked` records in `~/.pi/agent/data/dc-distill/diag.log` carry Pi's inputs and the resolved boundaries.

Trigger policy version 2 adds two decisions on top of those bands. The
**headroom floor** is `contextWindow - 16,384 - 4,096` (answer budget plus
pi-ai's request-clamp safety margin), clamped into
[warn, emergency]: at or above it, pi-ai's clamp
(`min(maxTokens, window - input - 4,096)`) leaves less than 16,384 answer
tokens, so steering cannot finish a unit and the monitor compacts mechanically
with the same guard bypass as emergency. A **missed auto window is pursued**: a
blocked at-or-above-auto observation sets a `missedAuto` marker, and the next
unblocked warn-band observation compacts mechanically (`missed-auto-pursuit`)
instead of steering; the marker never bypasses guards and is reset on
compaction. Decided checks log `auto-check decided tier=… reason=… policy=v2`
alongside the existing `auto-check blocked` records.

## Optional Feature Gates

Tool-output persistence/previews and recall are independently off by default.
Read global/project `extensionConfig["dc-distill"].toolOutput.enabled` and
`.recall.enabled` booleans at owner-session start. Disabled output must return
before content/storage; disabled recall must not persist/read stored summaries,
inject extra focus echo, or recommend recall in live summaries. Keep core
compaction, handoffs, session details/logs, and continuation recovery independent.
Preserve existing data. Whole-source migration is deferred unless both gates are
on so partial hydration cannot finalize migration markers.

## Recall, Dumps, and Migration

`DistillStore` owns migration, logs, dumps, and recall. Default recall is stored
under `Path.project("dc-distill", cwd)/recall.json`, keeps ten summaries per
project, and does not expose other projects. `recall_compaction(scope: "all")`
explicitly merges projects and labels ownerless version-5 entries
`legacy-unscoped`.

Raw dumps default off. When enabled, each committed pair contains the exact
canonical input and exact returned wire summary. Names include millisecond
time, PID, and attempt suffix; writes are temporary-file-and-rename operations
under a lock.

Migration runs during store initialization/session start, never module import.
Historical names are centralized in `lib/legacy.ts` for reads/migration only;
new writes use distill. Preserve source data and historical payloads. Do not
load the old and new extension together.
Each source migration marker is written only after that source
succeeds. A failure preserves source/current data, leaves no marker, and retries
on the next startup.

## Focus Echo

Focus echo reads Pi's native `{ role: "compactionSummary", summary }` message.
It is bounded and de-duplicated before context injection. Do not restore the old
synthetic assistant/content assumption.

## Compatibility

The development SDK baseline is Pi 0.99.2; the reviewed installed runtime is
Pi 1.0.0 and 1.0.2. The root package pins the four
`@earendil-works/pi-*` development dependencies to 0.99.2 and records
the graph in `bun.lock`. Install project-local dependencies with
`bun install --frozen-lockfile`; do not use or mutate another project's shared
`node_modules`. Peer ranges are `"*"` for every host-provided package, as
Pi's packaging contract requires; the reviewed-host boundary (0.99.2 patch
releases, exact 1.0.0, and 1.0.2) is carried by the development pins and the review
process, not by the peer ranges.

Reviewed Pi 0.99.0, 0.99.2, 1.0.0, and 1.0.2 use their native compaction card without patching
the InteractiveMode prototype. Older reviewed hosts retain historical shim
fixtures. Add a host version only after inspecting its handler and verifying
the installed rendering path; fixture-only tests do not prove rendering.

## Verification

```bash
bun test
bun x tsc --noEmit
bun run distill:architecture
git diff --check
```

`bun run distill:quality <artifact-directory> <unique-label>` writes the offline
checkpoint and optional-selector quality receipt.
`bun run distill:performance <artifact-directory> <unique-label> <baseline-checkpoint-receipt>`
runs the checkpoint benchmark with 10 warmups and 30 samples in isolated workers.
The ordinary gate requires identical sealed input, runtime/options, and Pi SDK
preload; it compares absolute lifetime RSS, never host-subtracted RSS. See
`docs/compiler-benchmark.md` for baseline preparation and comparison limits.

`bun run distill:e2e` is the opt-in real-Pi RPC contract suite (scripted
provider, sandboxed HOME plus temp Pi dirs); the autonomous scenario observes
the production 120-second startup cooldown. `bun run distill:demo` runs one
offline manual lifecycle and writes inspectable artifacts. Both stay out of
`bun test` discovery.

Keep `runStrategies()` single-strategy and deterministic. Bump
`details.version` when details fields or their semantics change.

Version 12 hardens unknown-tool effects, structural parsing, locale-independent wire counts/order, and exact rebuilt-context capacity acceptance. Unknown capacity is explicit; observed token drift requires a valid post-commit host count. Historical versions 5–11 remain readable, continuation recovery supports 8–13, and integrity validation supports 10–13. Recovery is host-journal dependent and is not crash-atomic across process restarts.

## Checkpoint v13

`details.checkpoint` is a validated schema-v1 snapshot and the sole authority for
declared tasks, user-source pins, constraints, decisions, exact evidence identities,
mutation frontier, risks, failure history, and predecessor identity. Its deterministic
serialization has a separate digest; the wire summary is hashed independently.
Validated declarations and explicitly pinned user text survive repeated compaction.
Other prose remains attributed context; implied obligations or user authorization
are not inferred. Terminal prose or missing items cannot retire unresolved work.
Failure history is bounded by evidence: at each compaction a carried unresolved
failure with no fresh occurrence retires
(`retired: not re-observed in compaction input`), and a failure whose exact
invocation identity — tool name and arguments, or the same verification runner,
command bytes, and working directory — later succeeds resolves
(`resolved: later success with same invocation`). Auto-resolved records render
only as one bounded transparency count and share the ten-resolved retention
bound with omission accounting. This projection-only behavior changes no
details field, so `details.version` stays 13.

`save_distill_handoff` optionally accepts `checkpoint: { version: 1, expectedBase:
{ checkpointDigest, updateEntryId }, operations }`. Pin, resolve, and supersede
operations validate exact sources and the current base atomically. The result
returns canonical source references and the actual saved host entry identity.
Explicit resolution cannot create evidence, finish a pending mutation, or waive
user authorization. A declared-done task may retain unmet evidence requirements.

Protected state is mandatory. Limits include 32 pins of 2,048 code points, 32
update operations in a 16,384-code-point envelope, and a 65,536-code-point checkpoint.
If mandatory input, obligations, checkpoint, or rebuilt context cannot fit, the
compiler cancels with `protected_overflow`; optional whole records are dropped
first. Invalid expected v13 state cancels instead of reconstructing from prose.
Rollback requires a v13-aware reader or must refuse lossy carry-forward.

The `agent_settled` observer requests `ctx.compact()` as a separate operation;
migration to `agent_before_settle` is deferred. Trigger policy version 2 names
the 120,000 cap, 20,000 lead, headroom floor, and missed-auto pursuit.
Positive ordered boundaries are required;
effective windows below three tokens disable automatic admission.

Continuation intent is created by an autonomous host commit; submission is a
separate send, and resulting work is separately observed in the branch journal.
A later genuine user turn or manual/foreign compaction supersedes older intent.
Pi supplies no durable send acknowledgement: acceptance before journal persistence
leaves an uncertain crash interval. Process fences suppress same-process retries;
a restart follows the durable journal and cannot promise exactly-once work.
Pre-commit failure and blocked-check diagnostics are explicit exceptions to the
post-commit artifact rule. Diagnostic formatting/reporting is best effort and total.
