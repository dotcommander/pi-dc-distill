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
| `/compact-status` | Show monitor, cooldown, threshold sources, dump state, pending state, and last failure without compacting. |

Pi owns and dispatches `/compact`; dc-shrink does not shadow it. `/compact
status` compacts with `status` as focus text, so use `/compact-status` for
diagnostics. Manual compaction never queues an autonomous continuation.

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

At `turn_end`, dc-shrink computes each boundary as the smaller of the configured
absolute tokens and configured percentage of the active context window.

- below auto: no action
- auto through warn-minus-one: Mechanical compaction
- warn through emergency-minus-one: cooperative Warn
- emergency and above: Mechanical compaction regardless of cooldown or Pi sync

Defaults are 100K/75%, 140K/85%, and 160K/92%. Warmup, latch, cooldown,
post-compaction growth, and Pi-sync guards protect normal autonomous attempts.

After Pi appends a matching autonomous compaction, dc-shrink may queue a hidden
`dc-shrink-continuation` turn if the session is idle. It does not render as user
input. A manual compaction leaves the next move to you.

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
Supported marker names include `read-files`, `modified-files`,
`recent-tool-calls`, `recent-tool-results`, `verification`, `working-tree`,
`source-anchors`, `active-tasks`, `resume-tasks`, and `resume-index`. Other
queries perform keyword search across supported parts.

## Summary Shape and Bounds

The exact returned summary begins with a metric line and is at most 65,536
Unicode code points. Focus is limited to 2,048 code points. Read and modified
file blocks each keep 50 paths, individual marker items keep 512 code points,
and verification/working-tree/source-anchor/task blocks keep ten items. Every
truncated list includes an omitted-count row, and XML markers remain balanced.

Details version 6 includes:

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
bounded, de-duplicated focus echo into the next context. `/compact-status` shows
the last injected echo.
