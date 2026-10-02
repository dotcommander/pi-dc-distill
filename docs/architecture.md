# pi-dc-distill Architecture

[README](../README.md) · [Usage](usage.md) · [Policy and data](settings.md)

The package entry point is `index.ts`. Load it with `pi -e ./index.ts`
from an installed checkout, or use the
[package quick start](../README.md#install). It depends only on the
`@earendil-works/pi-coding-agent` SDK; the former vendored `lib/framework`
copy is gone (see [ADR 0002](adr/0002-remove-vendored-framework.md)), replaced
by small owned support modules under `lib/` (events, entries, tool results,
notification, paths, fs, diagnostics, host probing).

`dc-distill` is deterministic-only. `runStrategies()` has one local TypeScript
Mechanical strategy. `Tier.Warn` is a cooperative policy signal, not a second
summary strategy.

## Ownership

Pi owns `/compact`, cut selection, the compaction entry append, and rebuilt
context. dc-distill owns deterministic compilation and commits its durable state
only after Pi confirms the matching append.

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
  -> commit log, optional dumps, and opt-in project recall
  -> reset monitor and optionally notify/continue
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

Canonical bytes are serialized once and reused for `inputDigest` and the
optional before-dump. If input exceeds 20 MiB, dc-distill keeps metadata,
previous summary, and newest complete discarded records. It never slices JSON.
Session-file compiler helpers exist only for diagnostics and tests.

## Compaction Contract

```ts
Events.compact({
  summary: wireSummary,
  firstKeptEntryId: preparation.firstKeptEntryId,
  tokensBefore: preparation.tokensBefore,
  details: {
    compactor: "dc-distill",
    version: 9,
    tier: 1,
    attemptId,
    autonomous,
    tokensAfter,
    summaryTokens,
    tokensAfterSource: "pi-rebuilt-message-estimate",
    reductionPct,
    apiTokensBefore,
    readFiles,
    modifiedFiles,
    literalAnchors,
    inputDigest,
    summaryDigest,
    digestScope
  }
})
```

`tokensAfter` is calculated by appending a synthetic proposed compaction to
`event.branchEntries`, calling Pi's `buildSessionContext()`, and summing public
`estimateTokens()` results. `summaryTokens` estimates only the returned summary.
The embedded metric uses at most eight deterministic fixed-point iterations;
if it does not stabilize, it omits the embedded after-count while details retain
the exact rebuilt estimate.

`summaryDigest` hashes the exact wire summary including its metric prefix.
`digestScope` is `compaction-input` or `bounded-compaction-input`.
New transactions emit details version 9 and commit only on an exact version-9
match. Historical version-5 through version-8 entries remain readable unchanged.

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
directory identity; later successful writes or non-read-only shell commands
conservatively stale earlier passes.

Tool classifications use the exact lowercased name while pairing keeps the raw
name. Reads include `view_file`; writes also include `write_to_file`,
`replace_file_content`, `patch_file`, and `create_file`. `write_to_file` and
`create_file` are create-capable. Path arguments retain the precedence
`path`, `file_path`, `filePath`, `file`, then `targetFile`, `TargetFile`,
`target_file`, `target_path`, `absolutePath`, `AbsolutePath`. These aliases
still require a successful, unambiguous paired result and invalidate earlier
verification after a successful write.

A strict whole-message `distill-handoff-v1` JSON fence can provide objective,
done, next, blocker, decision, and verification-needed fields without changing
the stored custom-entry schema. Invalid envelopes remain bounded legacy text.
The backward-compatible `distill-handoff-v2` fence adds validated invariants,
decisions, rejected hypotheses, and an acyclic task graph. Ready pending tasks
are derived only from graph state and rendered in stable topological order.
Both versions are task-state provenance, never verification evidence.

Oversized tool results are classified only after crossing the existing size
threshold. Diagnostic, diff, whole-JSON, test, and search previews precede the
generic head/tail fallback. Newly written artifacts carry an exact UTF-8 byte
count, content SHA-256, and strategy receipt; no historical artifact migration
or deduplication occurs. Recency scales otherwise eligible conversation turns,
while explicit handoff state and evidence-bearing failure, diff, verification,
file, literal, and artifact records remain exempt.

## Session Isolation

One setup-owned `DistillRuntime` contains the captured Pi API, owner session ID,
monitor, latch, warnings, pending transaction, project/session identity, and
last failure/focus state. Stateful hooks guard ownership before reading usage or
mutating state. `agent_settled` owns the autonomous check: it fires after the
response and its tool calls settle, once per run, and consumes the warmup turn
there. The latch prevents duplicate attempts across events.
`session_compact_failed` records the terminal outcome and clears pending/latch
state. Non-primary hooks are no-ops, except `session_before_compact`, which
cancels to prevent LLM fallback. Owner shutdown clears identity so a new,
resumed, or forked primary session can claim cleanly.

## Trigger Bands

Pi supplies the compaction settings and context window; dc-distill derives its
monitor bands from them. At primary-session start, dc-distill reads Pi's
effective `compaction.enabled` and `reserveTokens` from the global and project
settings merge.

- below auto: no action
- Pi trigger = `contextWindow - reserveTokens`
- auto = `min(120,000, Pi trigger - 20,000)`: Mechanical compaction
- warn = `Pi trigger`: cooperative Warn
- emergency = `contextWindow`: unconditional Mechanical compaction

`compaction.enabled: false` makes the autonomous monitor a no-op; manual
`/compact` still enters the deterministic `session_before_compact` hook. Fixed
small-window floors preserve ordered bands. If Pi cannot report a context
window, legacy 100K/140K/160K fallbacks apply. Emergency bypasses cooldown and
sync; warmup and post-compaction growth protections otherwise remain. Above the
auto boundary, blocked checks write one reason-deduplicated diagnostic containing
the hook source, usage, effective thresholds, sync state, cooldown, and repeat
baseline.

## Continuation and Focus Echo

Only a committed autonomous attempt may queue the hidden
`dc-distill-continuation` message, and only while the session is idle. Manual
compaction never queues continuation. Notify sites require `ctx.hasUI`.

Delivery is durable and journal-driven. The attempt id rides in the compaction
details and in the delivered message's details, so on `session_start` or a tree
change a pure reducer over `ctx.sessionManager.getBranch()` derives the state —
`committed`, `delivered`, `answered` — and redelivers or nudges an unanswered
autonomous continuation exactly once; manual and pre-v8 compactions never
recover. Historical v8 and current v9 autonomous attempts retain the same
exactly-once delivery and resume journal behavior.

Focus echo consumes Pi's native `{ role: "compactionSummary", summary }`
message, bounds the echo, and suppresses duplicates.

## Compatibility

The development SDK baseline is Pi 0.99.2; the reviewed installed runtime is
Pi 1.0.0. All four Pi development dependencies remain pinned to 0.99.2, and
`bun.lock` records that graph. Peer ranges admit compatible 0.99.2 patch
releases and exact reviewed 1.0.0, without claiming all 1.x versions.

Pi 0.99.2 and 1.0.0 render the latest compaction once with its native summary component.
The extension leaves its InteractiveMode prototype unchanged. Tests drive the
installed host's compaction handler and render its expanded native component
to verify deterministic metrics. Reviewed 0.99.0 remains in the native-card
allowlist; earlier presentation shims remain as historical compatibility code,
not a claim of support for those SDK versions. Unknown host versions do not
receive a private presentation patch.

The opt-in RPC suite under `tests/e2e` checks one extension-owned append,
active discarded/focused content, version-9 metrics, continuation recovery,
and zero provider summarizer requests.

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
