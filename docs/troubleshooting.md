# pi-dc-distill Troubleshooting

[README](../README.md) · [Usage](usage.md) · [Policy and data](settings.md)

First confirm the package is loaded: `pi list` shows installed packages;
check `pi config` if the extension is disabled. For a checkout, launch with
`pi -e ./index.ts` from its root after installing dependencies. Then inspect
the [logs](#logs). A missing log file can simply mean no attempt has been recorded.

## Common Issues

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Manual `/compact` appears to do nothing | Pi found no eligible discarded context, another attempt owns the latch, or deterministic compilation cancelled. | Inspect Pi's visible message and the latest failure record, if present. Pi can decline a cut before invoking the compiler. |
| `/compact status` compacted the session | Pi treats `status` as focus text. | There is no separate status command; inspect `compact-log.jsonl` and `diag.log` instead. |
| Autonomous compaction does not fire at auto | Pi disabled auto-compaction, warmup, cooldown, missing Pi sync, repeat-growth guard, or an in-flight attempt. | Inspect the latest `auto-check blocked` line in `diag.log`; it records the exact guard and effective geometry. |
| A cooperative warning appears | The context reached Pi's `contextWindow - reserveTokens` line. | Finish the atomic unit; compaction becomes unconditional at the context limit. |
| Compaction fires at emergency despite cooldown | Emergency bypasses cooldown and sync by design. | Investigate why earlier Mechanical compaction did not reduce context. |
| Summary lacks retained-tail content | Retained content is deliberately excluded from the discarded-input summary and remains in rebuilt context. | Inspect rebuilt context rather than expecting duplication in the summary. |
| Summary lacks abandoned-fork content | Only the active branch is authoritative. | Return to the relevant branch before compacting if that content is needed. |
| Summary misses subjective context | The deterministic extraction rules did not retain it. | Provide a focus hint when compacting, save an explicit handoff beforehand, or recall a retained summary. Lost content is not recreated by recall. |
| No success log, dump, or recall after a card was prepared | Pi did not append a matching extension-owned compaction. | Inspect Pi's failure message and logs before retrying; pre-append pending state is intentionally ephemeral. |
| No continuation after manual `/compact` | Manual attempts do not nudge. | Continue manually. |
| No continuation after autonomous compaction | The committed attempt was not autonomous or the session was not idle. | Continue from visible context or use recall. |
| No diagnostic dumps | Dumps default off. | Start Pi with `DC_DISTILL_DUMPS=1`; dc-distill retains 20 pairs. |
| Default recall misses an older summary | It is outside the ten newest retained summaries, belongs to another project, or is ownerless legacy history. | Use `scope: "all"` for other projects/legacy entries. Evicted summaries are not recoverable through recall. |
| Migration retries every startup | A migration operation or completion-marker write is failing. | Inspect diagnostics and permissions; fix the cause. No marker is written on failure. |

## Logs

```bash
tail -n 20 ~/.pi/data/dc-distill/compact-log.jsonl
tail -n 20 ~/.pi/data/dc-distill/diag.log
```

Failure entries contain `kind: "failure"` and reasons. Committed success entries
distinguish rebuilt-message after tokens from optional post-hook full-context
tokens and record the token source. A prepared but uncommitted attempt produces
no success entry. Autonomous checks blocked above the auto boundary are written
to `~/.pi/data/dc-distill/diag.log` once per changing reason. Terminal
`session_compact_failed` events are also recorded there and release stale
pending/latch state.

## Dumps

```bash
ls -1 ~/.pi/data/dc-distill/compact-dumps
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

Ask the agent to call `recall_compaction` with one of these argument objects:

```text
{"query": "Conversation", "limit": 3}
{"query": "critical", "limit": 3, "scope": "all"}
```

Default search is project-scoped. Named queries must match a supported section
or marker; arbitrary text performs keyword search across those parts.

## Compatibility and Verification

The SDK dependencies remain Pi 0.99.2; the reviewed installed host is Pi 1.0.0.
Peer ranges admit exact 1.0.0 and compatible 0.99.2 patch releases. Use Node.js 22.19.0 or
newer. Run `bun install --frozen-lockfile` in a checkout to install its pinned
dependency graph; avoid a shared `node_modules` symlink when checking SDK changes.
Pi 0.99.2 and 1.0.0 use the native card without a prototype patch. Capture `pi --version`,
the symptom, and relevant redacted diagnostics when reporting a compatibility
problem. See [architecture](architecture.md#compatibility).

For documentation or contributor checks from a checkout:

```bash
bun test docs-contract.test.ts
bun run typecheck
git diff --check
```

The full unit suite is `bun test`. The opt-in `bun run distill:e2e` suite needs
an installed Pi runtime and includes a 120-second autonomous startup cooldown.
`bun run distill:demo` runs one offline manual lifecycle. Neither runs as part of
the normal unit suite. See [development](../README.md#development-and-documentation).
