# dc-shrink Troubleshooting

Check current state first:

```text
/compact-status
```

Status reports token estimates, Pi sync, Pi-derived threshold inputs and
boundaries, compactor/dump state, pending state, warmup, paths, and the last
failure/focus echo.

## Common Issues

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Manual `/compact` appears to do nothing | Pi found no eligible discarded context, another attempt owns the latch, or deterministic compilation cancelled. | Run `/compact-status` and inspect the failure log. |
| `/compact status` compacted the session | Pi treats `status` as focus text. | Use `/compact-status`. |
| Autonomous compaction does not fire at auto | Pi disabled auto-compaction, warmup, cooldown, missing Pi sync, repeat-growth guard, or an in-flight attempt. | Check `/compact-status`, then inspect the latest `auto-check blocked` line in `diag.log`; it records the exact guard and effective geometry. |
| A cooperative warning appears | The context reached Pi's `contextWindow - reserveTokens` line. | Finish the atomic unit; compaction becomes unconditional at the context limit. |
| Compaction fires at emergency despite cooldown | Emergency bypasses cooldown and sync by design. | Investigate why earlier Mechanical compaction did not reduce context. |
| Summary lacks retained-tail content | Retained content is deliberately excluded from the discarded-input summary and remains in rebuilt context. | Inspect rebuilt context rather than expecting duplication in the summary. |
| Summary lacks abandoned-fork content | Only the active branch is authoritative. | Return to the relevant branch before compacting if that content is needed. |
| Summary misses subjective context | Deterministic taxonomy did not extract it. | Use `/compact <focus>` before manual compaction or recall by a supported section/marker/keyword. |
| No success log, dump, or recall after a card was prepared | Pi did not append a matching extension-owned compaction. | Retry; pre-append pending state is intentionally ephemeral. |
| No continuation after manual `/compact` | Manual attempts do not nudge. | Continue manually. |
| No continuation after autonomous compaction | The committed attempt was not autonomous or the session was not idle. | Continue from visible context or use recall. |
| No diagnostic dumps | Dumps default off. | Start Pi with `DC_SHRINK_DUMPS=1`; dc-shrink retains 20 pairs. |
| Default recall misses an older summary | It belongs to another project or ownerless version-5 history. | Retry with `scope="all"`. |
| Migration retries every startup | A migration operation or completion-marker write is failing. | Inspect diagnostics and permissions; fix the cause. No marker is written on failure. |

## Logs

```bash
tail -n 20 ~/.pi/data/dc-shrink/compact-log.jsonl
```

Failure entries contain `kind: "failure"` and reasons. Committed success entries
distinguish rebuilt-message after tokens from optional post-hook full-context
tokens and record the token source. A prepared but uncommitted attempt produces
no success entry. Autonomous checks blocked above the auto boundary are written
to `~/.pi/data/dc-shrink/diag.log` once per changing reason. Terminal
`session_compact_failed` events are also recorded there and release stale
pending/latch state.

## Dumps

```bash
ls -1 ~/.pi/data/dc-shrink/compact-dumps
```

Each collision-safe pair includes millisecond time, PID, and attempt suffix:

```text
20260518-120000.123-12345-attempt-before.jsonl
20260518-120000.123-12345-attempt-after.txt
```

The before file is the exact canonical discarded-input byte stream whose hash
is `inputDigest`. The after file is the exact returned metric-prefixed summary
whose hash is `summaryDigest`. Partial temporary pairs are not exposed.

## Recall

```text
recall_compaction(query="Conversation", limit=3)
recall_compaction(query="critical", limit=3, scope="all")
```

Default search is project-scoped. Named queries must match a supported section
or marker; arbitrary text performs keyword search across those parts.

## Compatibility and Verification

The repository's locked Pi SDK test surface is 0.82.1. Installed PATH runtimes
are reviewed separately; Pi 0.84.4's compaction-card lifecycle is explicitly
allowlisted.

```bash
bun test
bun x tsc --noEmit
git diff --check
```
