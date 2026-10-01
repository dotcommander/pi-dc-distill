# AGENTS.md — pi-dc-distill

## What This Is

`dc-distill` replaces Pi's default LLM compactor with a deterministic, local
TypeScript compiler. Pi still owns `/compact`, cut selection, entry append, and
context rebuilding. This feature owns the `session_before_compact` result and
never calls an LLM.

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
version 8:

```ts
{
  compaction: {
    summary: string,
    firstKeptEntryId: string,
    tokensBefore: number,
    details: {
      compactor: "dc-distill",
      version: 8,
      tier: 1,
      attemptId: string,
      autonomous: boolean,
      tokensAfter: number,
      summaryTokens: number,
      tokensAfterSource: "pi-rebuilt-message-estimate",
      reductionPct: number,
      apiTokensBefore?: number,
      readFiles: string[],
      modifiedFiles: string[],
      literalAnchors: string[],
      inputDigest: string,
      summaryDigest: string,
      digestScope: "compaction-input" | "bounded-compaction-input"
    }
  }
}
```

`tokensAfter` is Pi's rebuilt message-context estimate, calculated with
`buildSessionContext()` and `estimateTokens()`. `summaryTokens` estimates the
returned summary alone. `summaryDigest` hashes the exact returned wire summary,
including its metric line. Version-5 through version-7 session entries remain
readable and are not rewritten.

The final summary is limited to 65,536 Unicode code points and targets an 8,192-
code-point operating state by dropping complete optional records first. User
focus is limited to 2,048 code points; read and modified file lists each keep 50
items; individual marker items keep 512 code points. Truncated lists include
omitted counts. Formatting must preserve complete headings and balanced XML
markers; never apply a final substring to structured output.

File lists require an unambiguously paired successful tool result and remain
provenance-labeled observations, not Git receipts. Failed or unmatched writes
produce bounded inspect-before-retry risks. Verification identity is exact runner,
command bytes, and known working directory; later successful writes or non-read-
only shell commands stale older passes. Strict `distill-handoff-v1` envelopes are
optional and invalid envelopes stay bounded legacy text.

## Transactional Lifecycle

`session_before_compact` snapshots counters, compiles, calculates prospective
metrics, freezes a `PendingCompaction`, and returns it. It does not emit durable
success artifacts or reset the monitor.

`session_compact` commits only when the owner session, extension identity,
details version, attempt, first-kept ID, and exact summary digest match. Commit
then resets the monitor from Pi's post-rebuild full-context usage when available,
writes log/dump/recall, clears failure state, notifies only in a UI, and queues
continuation only for an autonomous attempt. Continuation delivery is durable: the attempt id is journalled in the compaction details and the delivered message, and on `session_start` or tree changes a pure reducer over the active branch redelivers an unanswered autonomous continuation exactly once. Pending state and the latch are
released in `finally`.

Session replacement, shutdown, autonomous errors, cancellation, foreign
compaction, mismatches, and duplicate events cannot create success artifacts.
`session_compact_failed` records the terminal outcome and releases pending/latch
state so an aborted host attempt cannot disable later autonomous checks.

## Trigger Policy

dc-distill has no extension trigger settings. It reads Pi's effective global and
project `compaction` settings through `pi.getSettings()` at primary-session
start, model selection, and before autonomous checks. Model-specific token
overrides follow Pi 0.99.2 precedence and validation; invalid settings block
autonomous checks without disabling manual deterministic interception:

| Band | Pi-derived boundary | Action |
| --- | --- | --- |
| Auto | `min(120,000, (contextWindow - reserveTokens) - 20,000)` | Mechanical compaction through warn-minus-one. |
| Warn | `contextWindow - reserveTokens` | Pi's native trigger line; cooperative warning through emergency-minus-one. |
| Emergency | `contextWindow` | Unconditional Mechanical compaction. |

`compaction.enabled: false` disables dc-distill's autonomous monitor; manual
`/compact` remains available. Fixed small-window floors preserve ordered bands,
and 100K/140K/160K are legacy fallbacks only when Pi cannot report a context
window. Cooldown, post-compaction growth, Pi-sync, and warmup guards still
apply. Emergency bypasses cooldown and sync. The 120,000-token target is fixed
policy, not extension configuration; smaller contexts are capped by Pi's safe
geometry. `auto-check blocked` records in `~/.pi/data/dc-distill/diag.log` carry Pi's inputs and the resolved boundaries.

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

The SDK and supported runtime are Pi 0.99.2. The root package pins the four
`@earendil-works/pi-*` development dependencies to that version and records
the graph in `bun.lock`. Install project-local dependencies with
`bun install --frozen-lockfile`; do not use or mutate another project's shared
`node_modules`. Peer ranges require compatible 0.99.2-or-newer patch releases.

Reviewed Pi 0.99.0 and 0.99.2 use their native compaction card without patching
the InteractiveMode prototype. Older reviewed hosts retain historical shim
fixtures. Add a host version only after inspecting its handler and verifying
the installed rendering path; fixture-only tests do not prove rendering.

## Verification

```bash
bun test
bun x tsc --noEmit
git diff --check
```

`bun run distill:e2e` is the opt-in real-Pi RPC contract suite (scripted
provider, sandboxed HOME plus temp Pi dirs); the autonomous scenario observes
the production 120-second startup cooldown. `bun run distill:demo` runs one
offline manual lifecycle and writes inspectable artifacts. Both stay out of
`bun test` discovery.

Keep `runStrategies()` single-strategy and deterministic. Bump
`details.version` when details fields or their semantics change.
