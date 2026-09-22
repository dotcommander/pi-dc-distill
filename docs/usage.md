# dc-shrink Usage

Compact now with a focus hint:

```text
/compact preserve the active task, edited files, failing test, and next command
```

`dc-shrink` compiles Pi's discarded active-branch context locally. It does not
call a model and cancels instead of falling back to Pi's default compactor.

## Commands

| Command | Purpose |
| --- | --- |
| `/compact` | Run Pi's built-in manual compaction with dc-shrink's deterministic result. |
| `/compact <focus>` | Preserve a bounded focus hint at the top of the summary. |

Pi owns and dispatches `/compact`; dc-shrink does not shadow it and registers
no slash command of its own. `/compact status` simply compacts with `status`
as focus text; there is no separate status command. Manual compaction never
queues an autonomous continuation.

## What Gets Compacted

dc-shrink consumes only Pi's authoritative preparation:

- a previous summary, when present
- discarded messages
- a discarded split-turn prefix
- the latest eligible handoff on the active branch

Retained tail and abandoned fork messages are not compiler input. Previous-
summary-only preparation is valid. Empty, unusable, malformed diagnostic input
or cancellation fails closed without a success log, dump, recall entry, or
notification.

## Autonomous Compaction

At Pi's `agent_settled` boundary — after the response and its tool calls have
settled — dc-shrink derives boundaries from Pi's effective `compaction` settings
and can compact before the next run:

- Pi trigger: `contextWindow - reserveTokens`
- auto: `min(120,000, Pi trigger - 20,000)` → Mechanical compaction
- warn: `Pi trigger` → cooperative Warn
- emergency: `contextWindow` → Mechanical compaction regardless of cooldown or Pi sync

If Pi has `compaction.enabled: false`, the autonomous monitor stands down;
manual `/compact` remains available. Fixed small-window floors and legacy
100K/140K/160K fallbacks cover degenerate or unavailable context windows.
Warmup, latch, cooldown, post-compaction growth, and Pi-sync guards protect
normal autonomous attempts. If usage is above auto while a guard blocks the
attempt, `~/.pi/data/dc-shrink/diag.log` records a reason-deduplicated
`auto-check blocked` line with the effective thresholds and current usage.

After Pi appends a matching autonomous compaction, dc-shrink may queue a hidden
`dc-shrink-continuation` turn if the session is idle. It does not render as user
input. A manual compaction leaves the next move to you. Delivery is durable:
if a restart, reload, or tree switch loses the in-flight delivery, dc-shrink
reads the journalled attempt from the session ledger on startup and delivers
the unanswered autonomous continuation exactly once.

## Recall

Search the current project's ten newest committed summaries:

```text
recall_compaction(query="Conversation", limit=3)
recall_compaction(query="modified-files", limit=3)
recall_compaction(query="settings.json", limit=3)
```

Search across projects explicitly:

```text
recall_compaction(query="source-anchors", limit=5, scope="all")
```

`scope` is `"project"` by default. `"all"` merges project stores newest-first
and may include ownerless historical entries labelled `legacy-unscoped`. Those
legacy entries never appear in default project search. The result limit applies
after the all-project merge.

Supported named sections are `Session`, `User Focus`, and `Conversation`.
Supported marker names include `resume-state`, `current-intent`, `resume-risks`,
`file-evidence`, `read-files`, `modified-files`, `recent-tool-calls`,
`recent-tool-results`, `verification`, `working-tree`, `source-anchors`,
`active-tasks`, `resume-tasks`, `resume-index`, and `summary-omissions`. Other
queries perform keyword search across supported parts.

`resume-state` may come from the unchanged v1 envelope or from a strict
`shrink-handoff-v2` graph. V2 validates all IDs, blockers, dependency references,
and cycles before trusting any field, then derives ready tasks from pending nodes
whose dependencies are done. Handoff task state does not count as verification.

Oversized tool-output replacements include the artifact path, exact UTF-8 byte
count, content SHA-256, and preview strategy. Strategy precedence is diagnostic,
diff, whole-document JSON, test, search, then generic fallback. Recency affects
only otherwise eligible conversation turns; explicit state and evidence-bearing
failure, diff, latest verification, file, literal, and artifact records are exempt.

## Resume Evidence Semantics

Read and modified file lists contain only successful, unambiguously paired tool
results. They mean “tool-observed read” and “tool-reported write”; they do not
prove current existence, exact contents, or Git state. Failed writes remain as
bounded `resume-risks` because partial effects can be unknown. Git receipts stay
separate and retain their captured working directory.

Verification receipts are keyed by the exact runner, command bytes, and known
working directory. The latest completed result replaces only the same identity;
similar commands remain separate. A later successful file write or non-read-only
shell command marks older receipts as having unestablished freshness.

The compiler targets a 13,024-code-point operating summary by removing complete
optional records first and reporting those removals. Explicit resume state,
risks, verification, and next actions have priority. The 65,536-code-point wire
limit remains the fail-closed safety ceiling.

## Summary Shape and Bounds

The exact returned summary begins with a metric line and is at most 65,536
Unicode code points. Focus is limited to 2,048 code points. Read and modified
file blocks each keep 50 paths, individual marker items keep 512 code points,
and verification/working-tree/source-anchor/task blocks keep ten items. Every
truncated list includes an omitted-count row, and XML markers remain balanced.

Details version 8 includes:

- `autonomous`, whether the attempt was queued by the autonomous monitor
- `tokensAfter`, Pi's rebuilt message-context estimate
- `summaryTokens`, the returned-summary estimate
- `tokensAfterSource: "pi-rebuilt-message-estimate"`
- bounded file and literal arrays
- `inputDigest` over exact canonical compiler input
- `summaryDigest` over the exact metric-prefixed returned summary
- `digestScope: "compaction-input" | "bounded-compaction-input"`

## Focus Echo

After compaction, dc-shrink reads Pi's native
`{ role: "compactionSummary", summary }` message and may inject a short,
bounded, de-duplicated focus echo into the next context.
