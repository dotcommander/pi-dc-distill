# dc-shrink Architecture

Load the extension with its framework dependency:

```bash
pi --no-session --no-extensions \
  -e extensions/dc-framework/index.ts \
  -e extensions/dc-app/index.ts \
  -p 'Confirm dc-shrink loads.'
```

`dc-shrink` is deterministic-only. `runStrategies()` has one local TypeScript
Mechanical strategy. `Tier.Warn` is a cooperative policy signal, not a second
summary strategy.

## Ownership

Pi owns `/compact`, cut selection, the compaction entry append, and rebuilt
context. dc-shrink owns deterministic compilation and commits its durable state
only after Pi confirms the matching append.

```text
session_start
  -> primary session claims ShrinkRuntime
  -> initialize store and retry migration
  -> read Pi compaction settings and project recall

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
  -> commit log, optional dumps, and project recall exactly once
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
4. the latest eligible shrink handoff on `event.branchEntries`

The source normalizes user, assistant, tool-result, bash-execution, custom,
branch-summary, and compaction-summary messages. Retained tail and abandoned
fork content never enter production compiler input. A previous-summary-only
preparation is valid.

Canonical bytes are serialized once and reused for `inputDigest` and the
optional before-dump. If input exceeds 20 MiB, dc-shrink keeps metadata,
previous summary, and newest complete discarded records. It never slices JSON.
Session-file compiler helpers exist only for diagnostics and tests.

## Compaction Contract

```ts
Events.compact({
  summary: wireSummary,
  firstKeptEntryId: preparation.firstKeptEntryId,
  tokensBefore: preparation.tokensBefore,
  details: {
    compactor: "dc-shrink",
    version: 7,
    tier: 1,
    attemptId,
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
from the same bounded marker contents. The compiler also targets a 13,024-code-
point operating summary: it removes complete optional records before file
observations, working-tree receipts, verification, risks, or explicit handoff
state. The 65,536-code-point limit remains the fail-closed wire ceiling.

File evidence is result-confirmed and provenance-labeled. Successful reads are
observations, successful writes are tool reports, and neither substitutes for a
scoped Git receipt. Failed or unmatched writes produce bounded inspect-before-
retry risks. Verification freshness uses exact runner + command + known working
directory identity; later successful writes or non-read-only shell commands
conservatively stale earlier passes.

A strict whole-message `shrink-handoff-v1` JSON fence can provide objective,
done, next, blocker, decision, and verification-needed fields without changing
the stored custom-entry schema. Invalid envelopes remain bounded legacy text.

## Session Isolation

One setup-owned `ShrinkRuntime` contains the captured Pi API, owner session ID,
monitor, latch, warnings, pending transaction, project/session identity, and
last failure/focus state. Stateful hooks guard ownership before reading usage or
mutating state. Non-primary hooks are no-ops, except `session_before_compact`,
which cancels to prevent LLM fallback. Owner shutdown clears identity so a new,
resumed, or forked primary session can claim cleanly.

## Trigger Bands

Pi owns the trigger policy. At primary-session start, dc-shrink reads Pi's
effective `compaction.enabled` and `reserveTokens` from the global and project
settings merge.

- below auto: no action
- Pi trigger = `contextWindow - reserveTokens`
- auto = `Pi trigger - 20,000`: Mechanical compaction
- warn = `Pi trigger`: cooperative Warn
- emergency = `contextWindow`: unconditional Mechanical compaction

`compaction.enabled: false` makes the autonomous monitor a no-op; manual
`/compact` still enters the deterministic `session_before_compact` hook. Fixed
small-window floors preserve ordered bands. If Pi cannot report a context
window, legacy 100K/140K/160K fallbacks apply. Emergency bypasses cooldown and
sync; warmup and post-compaction growth protections otherwise remain.

## Continuation and Focus Echo

Only a committed autonomous attempt may queue the hidden
`dc-shrink-continuation` message, and only while the session is idle. Manual
compaction never queues continuation. Notify sites require `ctx.hasUI`.

Focus echo consumes Pi's native `{ role: "compactionSummary", summary }`
message, bounds the echo, and suppresses duplicates.

## Compatibility

The repository's locked Pi SDK test surface is 0.82.1. Installed PATH runtimes
are reviewed separately; Pi 0.84.4's compaction-card lifecycle is explicitly
allowlisted. Compatibility checks must prove one extension-owned append, active
discarded/focused content only, version-7 metrics, and zero provider requests.
