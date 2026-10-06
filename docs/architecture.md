# pi-dc-distill Architecture

[README](../README.md) · [Usage](usage.md) · [Policy and data](settings.md)

The package entry point is `index.ts`. Load it with `pi -e ./index.ts`
from an installed checkout, or use the
[package quick start](../README.md#install). It depends only on the Pi host's `@earendil-works` SDK packages
(`pi-coding-agent`, `pi-ai`, `pi-tui`); the removed vendored framework
copy is gone (see [ADR 0002](adr/0002-remove-vendored-framework.md)), replaced
by small owned support modules under `lib/` (events, entries, tool results,
notification, paths, fs, diagnostics, host probing).

`dc-distill` is deterministic-only. `runStrategies()` has one local TypeScript
Mechanical strategy. `Tier.Warn` is a cooperative policy signal, not a second
summary strategy.

## Ownership

Pi owns `/compact`, cut selection, the compaction entry append, and rebuilt
context. dc-distill owns deterministic compilation and validates the matching
host commit before running independent durable effects.

```text
session_start
  -> primary session claims DistillRuntime
  -> snapshot ordinary Pi compaction settings and optional feature gates
  -> initialize store; defer whole legacy migration unless both gates are on

session_before_compact
  -> build CompactionSource from preparation + active branch
  -> canonicalize whole normalized records within 20 MiB
  -> compile bounded structured summary
  -> rebuild prospective Pi message context for tokensAfter
  -> freeze PendingCompaction
  -> Events.compact(...)

Pi appends compaction entry

session_compact
  -> verify owner, extension/version, attempt, first-kept ID, digest
  -> read post-rebuild full-context usage
  -> reset monitor and reconcile autonomous continuation
  -> independently write log, optional dumps, and recover opt-in project recall
  -> optionally notify; auxiliary failures remain best effort
  -> clear pending state and release latch
```

No success artifact is written in `session_before_compact`. Missing, mismatched,
duplicate, foreign, Pi-owned, cancelled, or abandoned attempts cannot commit.

## Authoritative Source

`lib/compaction-source.ts` constructs input exclusively from:

1. `preparation.previousSummary`
2. `preparation.messagesToSummarize`
3. `preparation.turnPrefixMessages`
4. the latest eligible distill handoff on `event.branchEntries`

The source normalizes user, assistant, tool-result, bash-execution, custom,
branch-summary, and compaction-summary messages. Retained tail and abandoned
fork content never enter production compiler input. A previous-summary-only
preparation is valid.

Incremental, capped serialization produces canonical bytes reused for
compilation, `inputDigest`, and the optional before-dump. The 20 MiB envelope
measures UTF-8 bytes: mandatory metadata and the previous summary are retained
first, then newest fitting whole records are selected greedily and emitted in
source order. Oversized records are skipped, so selection need not be a
contiguous suffix. Records are validated even when rejected; malformed or
circular input and mandatory overflow fail closed. JSON and records are never
sliced.

Compiler-owned serialization uses a capped 20 MiB arena and bounded escaping
scratch. A final canonical string of at most 20 MiB can coexist with that arena
during result creation; the envelope is not a 20 MiB bound on their combined
memory. Host input and allocations inside caller callbacks are outside this
guarantee. Ordinary host records retain their exact native JSON bytes;
cross-record callback side effects are outside the compatibility guarantee.
Session-file compiler helpers exist only for diagnostics and tests.

## Compaction Contract

```ts
Events.compact({
  summary: wireSummary,
  firstKeptEntryId: preparation.firstKeptEntryId,
  tokensBefore: preparation.tokensBefore,
  details: {
    compactor: "dc-distill",
    version: 14,
    tier: 1,
    attemptId,
    autonomous,
    tokensAfter,
    summaryTokens,
    tokensAfterSource: "pi-rebuilt-message-estimate",
    capacityStatus, // unknown or within-window
    contextWindow, // optional finite positive host/model window
    reductionPct,
    apiTokensBefore,
    readFiles,
    modifiedFiles,
    literalAnchors,
    inputDigest,
    summaryDigest,
    checkpoint, // validated schema-v2 ResumeCheckpoint; historical v1 read-only
    checkpointDigest,
    checkpointSections, // 17 fixed section costs and ladder outcomes
    digestScope
  }
})
```

`tokensAfter` is calculated by appending a synthetic proposed compaction to
`event.branchEntries`, calling Pi's `buildSessionContext()`, and summing public
`estimateTokens()` results. `summaryTokens` estimates only the returned summary.
One prospective rebuilt-context estimate is computed for the exact returned
summary. The summary contains no model-facing metric line; token estimates and
reduction telemetry remain in details and committed notifications. These are
host-consistent heuristics, not measured provider prompt counts.

`summaryDigest` hashes the exact returned wire summary. `checkpointDigest`
separately hashes the validated checkpoint’s deterministic serialization.
`digestScope` is `compaction-input` or `bounded-compaction-input`.
New transactions emit details version 14 and commit only when version, checkpoint
digest, and the section ledger derived from the pending checkpoint match the host
entry. Historical version-5 through version-13 entries remain readable unchanged.

## Bounded Structured Output

The formatter preserves complete headings and balanced XML markers. It fails
closed if structured output cannot fit after applying deterministic limits:

| Surface | Limit |
| --- | ---: |
| Final wire summary | 65,536 Unicode code points |
| User focus | 2,048 code points |
| Read files | 50 paths |
| Modified files | 50 paths |
| Marker item | 512 code points |
| Verification, working tree, source anchors, task blocks | 10 items each |

Every truncated list emits an omitted-count row. Details arrays are derived
from the same bounded marker contents. The compiler also targets an 8,192-code-
point operating summary: it removes complete optional records before file
observations, working-tree receipts, verification, risks, or explicit handoff
state. The 65,536-code-point limit remains the fail-closed wire ceiling.

File evidence is result-confirmed and provenance-labeled. Successful reads are
observations, successful writes are tool reports, and neither substitutes for a
scoped Git receipt. Failed or unmatched writes produce bounded inspect-before-
retry risks. Verification freshness uses exact runner + command + known working
directory identity, with a leading literal `cd PATH &&` resolved against the
known tool/session directory. Potential mutations fence evidence at both call
submission and completion, including failed and unresolved attempts. A fresh
pass must start after preceding mutations finish, overlap none, and have no later
mutation. Mixed check/write batches cannot establish execution order from persisted
result order alone. Every shell segment must be a recognized read-only
command to preserve freshness; substitutions, expansions, redirections, grouping,
unsupported syntax and modifying/executing options fail closed. Fresh completed
and pending verification receipts admit only direct recognized checks or check-only
`&&` chains, optionally preceded by one resolvable literal `cd PATH`. Pipelines,
other separators, wrappers and mixed check/mutation commands are excluded. This
is bounded textual analysis; executable behavior and custom script internals are
outside its guarantees.

Verification scans full normalized tool output before preview compression and
keeps bounded evidence from the first decisive failure or skip line. These
internal observations are consumed only after unambiguous tool pairing and
verification-command checks; they do not enter canonical input, digests, or
persisted details.

Host `isError` is authoritative; diagnostic results without a boolean `isError`
are incomplete. Silent native successes remain valid; unknown cwd leaves scope
and freshness unestablished. Git observations identify executable status, worktree
diff/stat, whitespace-only checks, or revision comparisons separately and share
mutation freshness rules. Echoed Git mentions and unsupported compound probes
cannot establish Git receipts, and empty output alone does not establish a clean
working tree.

Supported nonzero exit markers, explicit failure
markers and positive failure/skip counts preserve failure evidence; a passing
test name containing “Failed” or a zero skip count alone does not indicate a
failed check. Error compression reserves final cause lines and bounded explicit
diagnostics before ordinary content, with source-position deduplication and
omission counts.

Tool classifications use the exact lowercased name while pairing keeps the raw
name. Reads include `view_file`; writes also include `write_to_file`,
`replace_file_content`, `patch_file`, and `create_file`. `write_to_file` and
`create_file` are create-capable. Path arguments retain the precedence
`path`, `file_path`, `filePath`, `file`, then `targetFile`, `TargetFile`,
`target_file`, `target_path`, `absolutePath`, `AbsolutePath`. These aliases
still require a successful, unambiguous paired result. Pairing requires a unique
matching call ID with compatible raw name, or the unique same-name ID-less
fallback; FIFO pairing is forbidden. Write risks keep untruncated lexical path
identity and chronology separate from display text. Later successful paired reads
or writes resolve terminal risks across aliases; reads cannot resolve pending
mutations.

A strict whole-message `distill-handoff-v1` JSON fence can provide objective,
done, next, blocker, decision, and verification-needed fields without changing
the stored custom-entry schema. Invalid envelopes remain bounded legacy text.
The backward-compatible `distill-handoff-v2` fence adds validated invariants,
decisions, rejected hypotheses, and an acyclic task graph. Readiness is derived
from the intact graph. The projection retains records in source order within each
priority category.
All three versions are task-state provenance, never verification evidence. The original
envelopes remain intact; their rendered projection is labeled partial task state
and capped at 3,072 Unicode code points, including escaping, framing, references,
and omission notices. Each rendered field excerpt keeps at most 512 code points.
Objective, the first invariant, the first ready or unresolved task, and its blocker
have priority. Complete records report omissions and shortened fields; retained
ready-task references never dangle, and omitted dependencies are counted by
status. Readiness is computed from the intact graph before projection.

`distill-handoff-v3` retains v2 fields and adds up to 32 observed preconditions
plus task-level `requires`. Fresh paired reads and exact verification receipts
can satisfy predicates; fresh matching failures contradict them, and uncertain
or stale observations are unknown. Graph readiness remains separate from
`<ready-tasks>`, which requires every predicate to be satisfied. Unknown or
contradicted graph-ready requirements appear in `<graph-ready-tasks>`. See
[algorithm](algorithm.md#observed-handoff-readiness) for strict validation and
chronology. Source envelopes and stored task status remain unchanged.

Full supplied output is scanned for decisive execution evidence before preview
shortening, with runner-specific terminal failures outranking success and a
300-code-point decisive excerpt. Host-truncated bytes remain unavailable.

Oversized tool results are classified only after crossing the existing size
threshold. Diagnostic, diff, whole-JSON, test, and search previews precede the
generic head/tail fallback. Terminal failures, outcome totals and diagnostic
tails take priority over ordinary matches within the line and character budgets.
Nested events with a defined `parentToolCallId` bypass preview processing before
content inspection or storage, preserving their machine-facing returns.
Top-level previews preserve `structuredContent` separately. Artifact byte counts
and SHA-256 receipts describe text blocks joined with newlines, excluding that
structured data. Newly written artifacts also carry a strategy receipt; no
historical artifact migration or deduplication occurs.

Recency scales otherwise eligible conversation turns,
while explicit handoff state and evidence-bearing failure, diff, verification,
file, literal, and artifact records remain exempt.

## Session Isolation

One setup-owned `Phase1Controller` owns valid session identity, lifetime leases,
context revisions, settings and feature snapshots, the monitor, attempt tickets,
warmup, warning cooldown, diagnostics, and compatibility cleanup. `index.ts`
keeps the frozen prospective result, exact host-commit matcher and independent
post-commit effects. Logs, dumps, recall and notifications do not form an atomic
transaction. Each effect failure is reported separately without blocking
continuation scheduling or attempt release.
Pure `assessCompaction()` returns a decision plus explicit monitor state updates;
compatibility wrappers retain the existing state-update contract.

Stateful hooks guard ownership before reading usage or mutating state.
`tool_call` and completed persisted `turn_end` callbacks only sample the first
fresh post-compaction host count after assistant persistence. They do not consume
warmup, reset cooldown, decide admission, or interrupt tools. `agent_settled` is
the sole autonomous decision boundary for every band, including headroom floor
and Emergency. It refreshes host usage and validates current ownership,
settings, branch/model and concurrency guards before capturing the exact settled
leaf and requesting standard `ctx.compact()`. Ordinary Auto/Warn admission
requires a current finite positive host count. Headroom floor and Emergency
preserve the existing finite local-estimate fallback when host usage is
unavailable or invalid, and bypass ordinary admission guards. The request and
matching host commit remain separate operations. Continuing tool loops can delay
compaction until the agent naturally settles; the extension never aborts a run
for compaction. Native host compaction and genuine errors/cancellations retain
their existing paths. Unknown samples cannot establish a baseline. Ordinary
120-second cooldown and 4,000-token growth remain intact; only a matching
transactional host commit authorizes success effects and continuation.
`agent_before_settle` migration is deferred.
Opaque tickets serialize autonomous requests and manual interception. Cleanup can
release only the captured ticket, and matching commits produce effects once.
Initialization rechecks its lifetime lease after every await; compatibility
handles arriving after shutdown are disposed. Model/tree changes revise context
without restarting initialization or warmup.

### Local compiler failure pause

A still-owned autonomous attempt's non-cancelled local failure arms a separate,
process-local Mechanical admission pause before reporting or reservation release.
The pause records attempt identity, lease/generation, failed branch anchor,
model/settings snapshot and failure stage/code. Source construction, compilation
and returned-result validation, including protected capacity overflow, qualify.
Unsuccessful local strategies carry structured failure codes; an absent code is
normalized to `compiler_failure`, without parsing reason text. Cancellation,
stale snapshots, generic host callback errors, storage/reporting errors and
post-commit artifact errors retain their existing behavior and do not arm it.

The pause gates settled submission across Auto,
missed-auto pursuit, headroom floor and Emergency. Warn steering and manual
`/compact` remain available. Each episode notifies once and reports the structured
`compiler-paused` admission reason; repeated reports of the same local failure are
suppressed. Diagnostics and notifications remain best effort.

Only these events clear the pause:

- A session lifecycle replacement establishes a new generation.
- The effective model/context window or valid effective compaction settings
  actually change.
- Trustworthy branch navigation leaves the failed anchor's lineage.
- A validated newest active-branch compaction commits successfully, including
  manual/native recovery.

Ordinary prompts, changed leaves or input digests, identical callbacks, invalid
settings, unavailable branch evidence, failed manual attempts and mismatched
commits do not clear it. Late or anonymous events cannot arm, reset or release
another attempt; reservation release remains a separate ownership decision.
There is no persistent circuit, retry timer or new command. Restart uses the
existing startup guards; details v14, checkpoint schema v2 and band policy v3
remain unchanged. The pause grants no pre-commit success effects or continuation.

`session_compact_failed` releases an attempt only when its identity matches.
An anonymous aborted event can release a reservation whose preparation was
cancelled or whose returned result can no longer be appended. Other anonymous
failures retain the ambiguous reservation: a late or foreign failure must not
release another attempt. Recovery requires the originating terminal callback or
a lifecycle reset, such as session replacement or shutdown. Correlating a native
non-aborted failure with its owning attempt requires host-supplied identity;
automatic release for that case is deferred until Pi exposes it.
Non-primary hooks are no-ops, except `session_before_compact`, which
cancels to prevent LLM fallback. Missing or invalid identity cannot claim ownership.
Owner shutdown retires the lifetime so a new primary session can claim cleanly.
Store references are captured before awaits; an already-started write may finish,
but a retired lifetime cannot start later success effects or release a new ticket.
Isolation covers this shared runtime; the SDK cannot reliably discriminate
independently loaded child runtimes.

## Trigger Bands

Pi supplies the compaction settings and context window; dc-distill derives its
monitor bands from them. At primary-session start, dc-distill reads Pi's
effective `compaction.enabled` and `reserveTokens` from the global and project
settings merge.

- below auto: no action
- Pi trigger = `contextWindow - reserveTokens`
- auto = `min(120,000, Pi trigger - 20,000)`: Mechanical compaction
- warn = `Pi trigger`: cooperative Warn (empty band when the floor clamps to it)
- headroom floor = `max(warn, contextWindow - 16,384 - 4,096)`: unconditional
  Mechanical compaction with emergency-grade guard bypass, because pi-ai's
  request clamp leaves less than 16,384 answer tokens above it
- emergency = `contextWindow`: unconditional Mechanical compaction

A blocked at-or-above-auto observation sets a `missedAuto` marker; the next
unblocked warn-band observation then compacts mechanically
(`missed-auto-pursuit`) instead of steering. Decided checks log
`auto-check decided tier=… reason=… policy=v3` in diag.log.

Restart admission restores guard history once at startup from the
active-branch journal snapshot: a trustworthy nonempty branch without a
compaction may skip the synthetic 120-second cooldown (warmup and a current
synchronized host count still apply); a prior compaction restores its real
timestamp and waits for a fresh host-count baseline, never the persisted
heuristic `details.tokensAfter`; ordinary admission above auto still requires
4,000 tokens of growth. Untrusted, malformed, future-dated, or missing journal
data preserves conservative guards; model and branch changes require fresh
samples; duplicate commit events cannot reset guards; manual, foreign, and
legacy commits update admission without extension success artifacts.

Sample-only bookkeeping at `tool_call` can consume the first fresh finite-positive
host count after assistant persistence, before a long tool batch finishes. It
never interrupts siblings, warns, compacts, consumes warmup or resets cooldown.
Persisted turn boundaries can also sample; action admission always queries the
host again. Null/unknown counts leave sampling pending; raw assistant usage and
heuristic `details.tokensAfter` cannot establish the baseline. A fresh above-auto
baseline still requires 4,000 tokens of growth and the real 120-second cooldown.

`compaction.enabled: false` makes the autonomous monitor a no-op; manual
`/compact` still enters the deterministic `session_before_compact` hook. Fixed
small-window floors preserve ordered bands and can reduce the 20K lead. Invalid
settings block autonomous checks while manual deterministic interception remains
available. If Pi cannot report a context window, legacy 100K/140K/160K fallbacks
apply. The headroom floor and emergency may use a finite local estimate and
bypass warmup, cooldown, sync, and growth guards; ownership, valid enabled
settings, the attempt latch, and the compiler-failure pause still apply. Ordinary auto/warn decisions require the current finite positive host
count; unavailable, thrown, or invalid samples cannot reuse an earlier sync.
Nonfinite local estimates cannot trigger compaction.

Blocked diagnostics deduplicate by reason, model, effective settings, geometry,
and sample status, excluding changing token counts and countdowns. They include
reserve tokens and threshold sources from Pi's effective snapshot, without
inventing global/project provenance. Monitor and blocked lines carry the owning
session identity (control characters escaped) and process id so interleaved
sessions and processes stay attributable in the shared log.

## Continuation and Focus Echo

Only a committed autonomous attempt may queue the hidden
`dc-distill-continuation` message, and only while the session is idle. Manual
compaction never queues continuation. Notify sites require `ctx.hasUI`.

Deferred delivery rechecks the lifetime lease and context revision, then rereads
the active branch through the recovery reducer before sending. Session start,
tree changes, matching commits and settlement reconcile the journal. Historical
v8/v9/v10/v11/v12/v13 and current v14 attempts support one unanswered resume; manual and pre-v8
compactions do not recover.

The process registry keys possible submissions by owner session, attempt and
initial delivery or resume. It fences before calling Pi's sender, whose return
provides no acknowledgement. Outcomes are `deferred`, `unavailable`, and
`submitted_unknown`; a matching branch message establishes `ledger_observed`.
Possible-submission fences survive extension reload and navigation away from
and back to a branch. Idle state, elapsed time and a missing journal message
cannot authorize a same-process retry. Owner shutdown cancels obsolete callbacks
without erasing fences. After a true process restart the persisted active branch
supports journal-based recovery and duplicate suppression. This does not promise
exactly-once execution or zero lost turns when host submission is uncertain.

Enabled recall independently reconstructs validated committed compactions from
the active branch at owner start, tree changes and matching commits. Recovery
coalesces requests and revalidates owner, lease and tree revision under the recall
publication lock. Host entry IDs, timestamps, attempt IDs and v10/v11/v12/v13/v14 summary digests
make replay idempotent and preserve original recency. Disabled recall performs no
recall projection or storage access. Initialization and recovery failures do not
block deterministic compaction or continuation.

Focus echo consumes Pi's native `{ role: "compactionSummary", summary }`
message, bounds the echo, and suppresses duplicates.

## Compatibility

The development SDK baseline is Pi 0.99.2; the reviewed installed runtime is
Pi 1.0.0 and 1.0.2. All four Pi development dependencies remain pinned to 0.99.2, and
`bun.lock` records that graph. Peer ranges are `"*"` for every host-provided
package, as Pi's packaging contract requires; the reviewed-host boundary
(0.99.2 patch releases, exact 1.0.0, and 1.0.2) is carried by the development pins
and review, not by the peer ranges.

Pi 0.99.0+ and 1.x (including 1.0.0, 1.0.2, 1.0.3, and subsequent releases) render
compaction natively with their built-in summary component. The extension leaves
their InteractiveMode prototype unchanged. Tests drive the installed host's
compaction handler and render its expanded native component to verify deterministic
metrics. Earlier presentation shims remain as historical compatibility code, not a
claim of support for those SDK versions. Unreviewed older host versions (< 0.99)
do not receive a private presentation patch.

The opt-in RPC suite under `tests/e2e` is excluded from this contract's gates.
Its fixtures still assert v13/schema-v1 and need a separately authorized refresh
before they can serve as v14 runtime evidence. Offline owner tests verify v14
prepare/commit, active discarded/focused content, checkpoint integrity,
continuation recovery, and zero provider summarizer requests.

## Shared recall and diagnostics

Recall queries consume explicit entry arrays through `searchRecallEntries`;
`DistillStore` is the sole recall I/O owner. `RecallEntry` and
`StoredRecallEntry` remain aliases of the shared entry type. The intentional
legacy deep-import compatibility change removes `resetStore`, `recordSummary`,
`getSummaries`, `hydrateSummaries`, `loadPersistedSummaries`, `persistSummary`,
and `searchSummaries` from `lib/recall.ts`.

Both diagnostic sinks resolve `Path.data("dc-distill")`. Monitor text stays in
`diag.log` with asynchronous writes serialized within the process; synchronous
Diag NDJSON writes now go to `diag.ndjson` there rather than the historical
`pi-dc-distill` directory. Each sink rotates before any append whose existing
file exceeds 5 MiB, including later writes in the same process. Historical
files and earlier rotated files are preserved without migration or deletion.
Timestamps, best-effort failure handling, and `PI_DEBUG` behavior are preserved.

### Version 12 conservative acceptance

Unknown tools (including PowerShell) fence verification globally at submission
and completion; pending calls remain overlap barriers. Only exact local metadata
tools are exempt. Native grep/find/ls are read-only without file-read provenance.
Ambiguous ID-less results never resolve pending calls or mutation risks.
Text artifact receipts are tool-reported artifacts, not authenticated files.

Prior summary sections are recognized only as complete structural sections outside
Markdown examples. Duplicate, unmatched, or crossing markers become bounded escaped
opaque text. Assistant handoffs require unquoted boundaries; saved handoffs retain
precedence. Terminal state is derived before retiring assistant protocol trailers.
Wire ordering uses code units and integer counts use ASCII comma grouping.

After constructing the exact wire summary, the rebuilt message-context estimate,
including retained messages, must be strictly below a finite positive current host
context window (falling back to the current model window). Unknown capacity is
explicitly recorded and preserves historical acceptance. This is local estimate
acceptance, not provider capacity proof.
Committed logs distinguish observed host counts from estimates: tokenObservation
is observed or unavailable; observedTokenDelta exists only for a valid host count.

Current readers preserve versions 5–13; continuation recovery supports versions
8–14 and wire-integrity recall projection supports versions 10–14. Recovery relies on the
host persisting compaction details and continuation messages on the active branch.
A same-process uncertain submission is fenced in memory; a true process restart
can lose that fence. Delivery and persistence are not one crash-atomic transaction.
Offline fixtures establish neither installed Pi behavior nor exactly-once delivery
across every crash window, provider acceptance, or model attention quality.

## Checkpoint authority and lifecycle ownership

Details v14 persist a validated schema-v2 checkpoint and its deterministic digest;
historical schema-v1 checkpoints remain readable and convert in memory. Its 17-key
`checkpointSections` ledger reports section code-point costs and final ladder
outcomes, but cannot authorize work or change scoring. Under checkpoint pressure,
T3 failure sources drop first, then T2 unreferenced reads, then T1 failure-display
excerpts; T0 identity cores, declared contracts, required evidence, mutation
frontier and predecessor are protected. The 65,536-code-point floor still cancels
with `protected_overflow` if T0 cannot fit. Rendered tasks, readiness and files
derive from the snapshot without mutating status or freshness. Protected
declarations and user-source pins survive repeated compaction; implied
obligations and user authorization are not inferred. Other prose is attributed
context. Invalid v13/v14 state cancels; rollback must retain a v14-aware reader
or refuse lossy carry-forward.

Attempts own a ticket and session generation with branch, model, and effective
settings snapshots. Late callbacks and host events compare that ownership before
commit or cleanup. Cancelled preparation and anonymous failure keep reservations
until an identifiable terminal event or session reset. Pre-commit failures and
blocked-check diagnostics are permitted diagnostic exceptions; success artifacts
remain independent post-commit effects.

The summary renders once, then Pi's prospective context is rebuilt and estimated
once. Counts are host-consistent heuristics, with capacity geometry and unknown
capacity explicit. Metrics stay in details and committed notifications.
Completed `turn_end` and `tool_call` callbacks sample only. Autonomous decisions
and exact-leaf tickets belong exclusively to `agent_settled`; compaction requests
never abort the run. Continuing tool loops can delay compaction. The focused
opt-in runtime gate in `tests/e2e/README.md` requires all tools and the successful
final response before matching v14 commit and continuation. Historical suite
receipts do not establish this behavior.

Continuation intent creation, submission, and observed work are separate states.
Later genuine user input or manual/foreign compaction supersedes older intent.
The crash interval between host acceptance and durable journal acknowledgement
remains uncertain; process fences cannot make restart delivery crash-atomic.
