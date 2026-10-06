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
| Compaction remains reserved after a native non-aborted failure | Pi's failure event has no attempt identity, so dc-distill preserves an ambiguous reservation to avoid releasing another attempt. | Inspect the failure and address its cause. The originating terminal callback or a session lifecycle reset releases the reservation; if no callback arrives, replace the session or restart Pi. |
| `/compact status` compacted the session | Pi treats `status` as focus text. | There is no separate status command; inspect `compact-log.jsonl` and `diag.log` instead. |
| Autonomous compaction does not fire at auto | Pi disabled auto-compaction, invalid settings, warmup, cooldown, unavailable/invalid current Pi usage, repeat-growth guard, an in-flight attempt, or the compiler-failure pause. | Inspect the latest `auto-check blocked` line in `diag.log`; it records the exact guard and effective geometry. |
| `post-compaction-sample` delays another ordinary attempt | The first fresh host count establishes an above-auto baseline, not immediate permission to repeat. Version 0.1.6 checks only at settlement. | The checkout samples at `tool_call` and completed `turn_end` after assistant persistence; autonomous admission runs only at `agent_settled`; unknown counts remain pending, and 120-second cooldown plus 4,000-token growth still apply. Publication does not activate or update the installed package. |
| A cooperative warning appears | The context reached Pi's `contextWindow - reserveTokens` line below the headroom floor. | Finish the atomic unit; Mechanical compaction bypasses ordinary guards at `max(warn, contextWindow - 20,480)`, subject to ownership, enabled valid settings, the latch and compiler-failure pause. A missed auto window is pursued mechanically at the next unblocked warn-band check. |
| Automatic compaction stops after a local compiler failure | An owned autonomous attempt paused Mechanical admission, including urgent bands, to prevent repeated submissions. | Inspect `compiler-paused` and the failure stage/code. Fix the cause and try manual `/compact`; manual recovery clears the pause only after a validated successful newest active-branch commit. New prompts and failed manual attempts do not reset it. |
| Compaction fires at the headroom floor or emergency despite cooldown | These bands bypass warmup, cooldown, sync, and growth guards by design. | Investigate why earlier Mechanical compaction did not reduce context. |
| Summary lacks retained-tail content | Retained content is deliberately excluded from the discarded-input summary and remains in rebuilt context. | Inspect rebuilt context rather than expecting duplication in the summary. |
| Summary lacks abandoned-fork content | Only the active branch is authoritative. | Return to the relevant branch before compacting if that content is needed. |
| Summary misses subjective context | The deterministic extraction rules did not retain it. | Provide a focus hint when compacting, save an explicit handoff beforehand, or recall a retained summary. Lost content is not recreated by recall. |
| No success log, dump, or recall after a card was prepared | Pi did not append a matching extension-owned compaction. | Inspect Pi's failure message and logs before retrying; pre-append pending state is intentionally ephemeral. |
| Success log appears only with certain extensions enabled | A sibling extension appended an entry after the compaction entry, so pre-fix builds (≤ 0.1.5) rejected the commit because the entry was no longer the branch leaf. | Upgrade past 0.1.5; a `compaction commit ignored reason=identity-mismatch` diagnostic in `diag.log` marks the fixed visibility path. |
| No continuation after manual `/compact` | Manual attempts do not nudge. | Continue manually. |
| No continuation after autonomous compaction | The committed attempt was not autonomous or the session was not idle. | Continue from visible context or use recall. |
| No diagnostic dumps | Dumps default off. | Start Pi with `DC_DISTILL_DUMPS=1`; dc-distill retains 20 pairs. |
| Default recall misses an older summary | It is outside the ten newest retained summaries, belongs to another project, or is ownerless legacy history. | Use `scope: "all"` for other projects/legacy entries. Evicted summaries are not recoverable through recall. |
| Migration retries every startup | A migration operation or completion-marker write is failing. | Inspect diagnostics and permissions; fix the cause. No marker is written on failure. |

Autonomous decisions for every band occur only at `agent_settled`, which refreshes
host usage before taking a settled exact-leaf ticket for standard `ctx.compact()`.
Ordinary Auto/Warn requires a current finite positive host count; headroom floor
and Emergency retain the finite local-estimate fallback when host usage is
unavailable or invalid.
`tool_call` and completed `turn_end` callbacks sample only; they never abort a run
for compaction. Continuing tool loops can delay compaction until settlement,
even above the headroom floor or Emergency. Native host compaction and genuine
errors/cancellations remain active. Success artifacts and continuation still
require a matching commit; `agent_before_settle` migration is deferred.

The compiler pause also clears on a new lifecycle generation, actual effective
model/context-window or valid settings change, or trustworthy navigation outside
the failed anchor's lineage. Identical callbacks, new leaves/input digests,
invalid settings, unavailable branch evidence and mismatched commits do not
clear it. Cancellation, generic host errors and storage/reporting failures do
not arm it. The pause is process-local and reports once per episode; restart
uses the existing startup guards. See
[lifecycle details](architecture.md#local-compiler-failure-pause).

## Logs

```bash
tail -n 20 ~/.pi/agent/data/dc-distill/compact-log.jsonl
tail -n 20 ~/.pi/agent/data/dc-distill/diag.log
```

Failure entries contain `kind: "failure"` and reasons. Committed success entries
distinguish rebuilt-message after tokens from optional post-hook full-context
tokens and record the token source. A prepared but uncommitted attempt produces
no success entry. Autonomous checks blocked above the auto boundary are written
to `~/.pi/agent/data/dc-distill/diag.log` once per changing reason. Terminal
`session_compact_failed` events are also recorded there and release stale
pending/latch state.

## Dumps

```bash
ls -1 ~/.pi/agent/data/dc-distill/compact-dumps
```

Each collision-safe pair includes millisecond time, PID, and attempt suffix:

```text
20260518-120000.123-12345-attempt-before.jsonl
20260518-120000.123-12345-attempt-after.txt
```

The before file is the exact canonical discarded-input byte stream whose hash
is `inputDigest`. The after file is the exact returned metric-free summary
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

The SDK dependencies remain Pi 0.99.2; the reviewed installed host is Pi 1.0.0 and 1.0.2.
Peer ranges are `"*"` per Pi's packaging contract for host-provided packages.
Use Node.js 22.19.0 or newer. Run `bun install --frozen-lockfile` in a checkout to install its pinned
dependency graph; avoid a shared `node_modules` symlink when checking SDK changes.
Pi 0.99.2, 1.0.0, and 1.0.2 use the native card without a prototype patch. Capture `pi --version`,
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
the normal unit suite. The separate opt-in `turn-boundary.e2e.ts` gate targets
complete tool batches → final response → settle → prepare → matching v14 commit → durable continuation with
a scripted provider on Pi 0.99.2 and installed 1.0.4. See `tests/e2e/README.md`
for its isolated-parent invocation; historical suite
receipts do not prove this timing fix, and no passing gate is claimed here.
See [development](../README.md#development-and-documentation).
