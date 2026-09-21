# dc-shrink

`dc-shrink` lets Pi compact a session without asking a model to summarize it. Run Pi’s normal `/compact` command with an optional focus hint; Pi chooses the discarded active-branch context and appends the compaction, while this package deterministically builds the summary. It never reads the append-only session file during that live hook and never falls back to an LLM if compilation cannot produce a safe result.

## Start here

| Need | Use | What happens |
| --- | --- | --- |
| Compact a session now | `/compact <focus>` | Pi invokes the extension-owned deterministic compaction result. |
| Preserve explicit near-limit state | `save_shrink_handoff` | Stores a handoff entry that the next eligible compaction can include. |
| Find committed prior summaries | `recall_compaction` | Searches the current project’s recall first; cross-project search is explicit. |
| Keep oversized tool output recoverable | automatic `tool_result` hook | Saves full text and leaves a bounded preview in the conversation. |
| Replay an old session | `bun run shrink:session -- <session.jsonl>` | Runs historical JSONL through the current compiler and writes inspectable artifacts. |

## Replay a past session

Use the repository CLI to test the current shrink logic against any old Pi
session JSONL file:

```sh
bun run shrink:session -- ~/.pi/agent/sessions/example.jsonl \
  --compaction last \
  --out .work/shrink-evaluations/example
```

The evaluator writes `input.jsonl`, `current.md`, and `report.json`. When it
selects a historical compaction, it also writes `historical.md` and reports
whether the historical summary body exactly matches the current output. Choose
`--compaction first`, `--compaction last` (the default), or a one-based ordinal.
For a file with no compaction entries, it compiles the entire session. Pass
`--whole` for canonical `*-before.jsonl` dumps so a carried previous-summary
record is treated as compiler input rather than a replay boundary. Existing
artifacts are preserved unless `--force` is supplied.

To compare a retained diagnostic pair directly, supply the matching after dump:

```sh
bun run shrink:session -- 20260621-144642-before.jsonl \
  --whole \
  --historical 20260621-144642-after.txt \
  --out .work/shrink-evaluations/20260621-144642
```

The historical file is copied to `historical.md`, and its source path and exact
body comparison are recorded in `report.json`.

This is a raw-session replay tool. For exact live-hook input fidelity, pass a
`*-before.jsonl` diagnostic dump; a full append-only Pi session cannot recreate
Pi's discarded-message preparation boundaries exactly. Legacy dumps containing
bare Pi message objects are canonicalized automatically before compilation;
`report.json` records the detected input format.

## Compact with a focus hint

Use Pi’s built-in command when the session has eligible context to discard:

```text
/compact preserve the active task, edited files, failing test, and next command
```

Pi supplies the discarded active-branch input. dc-shrink compiles it locally, prefixes the returned summary with deterministic metrics, and returns it to Pi for the normal append and context rebuild. The focus text becomes a bounded part of the summary; it is limited to 2,048 Unicode code points.

A manual compaction leaves the next action under your control. Autonomous compaction may queue a hidden continuation only after Pi confirms the matching compaction was appended and the session is idle.

## Pi-derived policy and stored data

dc-shrink has no extension settings. At primary-session start, it reads Pi's effective global and project `compaction.enabled` and `compaction.reserveTokens`. A project `.pi/settings.json` overrides individual global keys.

- Pi trigger: `contextWindow - reserveTokens`
- Auto: `min(120,000, Pi trigger - 20,000)`
- Warn: `Pi trigger` (Pi's native trigger line)
- Emergency: `contextWindow`

When Pi has `compaction.enabled: false`, dc-shrink's autonomous monitor stands down; manual `/compact` remains deterministic and available. The monitor checks at Pi's documented `turn_end` boundary, after tool results are available, and checks again at `agent_settled` as an end-of-run fallback. A fixed 120-second cooldown and small-window floors remain internal loop-safety mechanics. Normal automatic attempts also observe warmup, latch, Pi-sync, and post-compaction-growth guards; emergency bypasses cooldown and Pi-sync. When usage is already above auto but a guard blocks compaction, dc-shrink writes one reason-deduplicated `auto-check blocked` record to `~/.pi/data/dc-shrink/diag.log`.

| Location | Contents |
| --- | --- |
| `~/.pi/data/dc-shrink/compact-log.jsonl` | Committed-success and deterministic-failure records. |
| `~/.pi/data/dc-shrink/compact-dumps/` | Opt-in canonical-input and returned-summary pairs. |
| `Path.project("dc-shrink", cwd)/recall.json` | The ten newest committed summaries for one project. |
| `Path.project("dc-shrink", cwd)/tool-output/` | Full text and provenance for compacted tool output. |

Raw dumps are off by default. Set `DC_SHRINK_DUMPS=1` in Pi's process environment to enable fixed-retention (20 pair) diagnostic dumps. Each pair is written under a lock through temporary files, then renamed; a partial pair is not exposed.

## Capabilities and boundaries

### Deterministic compaction

The live compiler receives only Pi’s preparation and active branch: the previous summary, discarded messages, discarded split-turn prefix, and the latest eligible handoff. Retained-tail and abandoned-fork messages do not become compiler input. If the normalized input exceeds 20 MiB, it retains complete newest records within that envelope instead of slicing JSON or messages.

The returned wire summary is capped at 65,536 Unicode code points. Its version-7 details include the rebuilt-context token estimate, returned-summary estimate, input and summary digests, bounded file/anchor arrays, and whether the input used the normal or bounded envelope. Version-5 and version-6 entries remain readable and are not rewritten.

Failures and cancellations fail closed: no default LLM compactor is used. Success artifacts—log, optional dumps, recall, notification, monitor reset, and autonomous continuation—are delayed until the matching extension-owned `session_compact` event verifies the appended entry.

### Recall and handoffs

`save_shrink_handoff` accepts a non-empty handoff string and appends it to the active session. Legacy text remains supported. For the highest-signal resume state, pass one strict whole-message envelope:

````text
```shrink-handoff-v1
{"objective":"Finish parser repair.","done":["Implemented result-aware file evidence."],"next":["Run focused tests."],"blocker":[],"decision":["Keep legacy handoffs compatible."],"verification-needed":["bun test lib/local-compact.test.ts"]}
```
````

Malformed, unknown-version, or oversized envelopes remain bounded opaque text; fields are never inferred from ordinary prose. Handoff content is task state, not verification evidence.

For dependency-aware recovery, `shrink-handoff-v2` requires exactly `objective`,
`invariants`, `decisions`, `rejected-hypotheses`, `tasks`, and
`verification-needed`. IDs and dependency edges are validated, cycles are
rejected, and pending tasks whose dependencies are done are rendered in stable
topological order. The v1 format remains unchanged and supported.

`recall_compaction` searches the project store by default:

```text
recall_compaction(query="modified-files", limit=3)
```

Each compacted summary also retains the Pi provider session ID and gives the
next model exact `ctxgo show session --provider pi --provider-session '<id>'`
and `ctxgo locate session --provider pi --provider-session '<id>'` commands for
recovering the full indexed transcript or its source JSONL when needed.

To merge project stores and ownerless historical recall, make the wider scope explicit:

```text
recall_compaction(query="source-anchors", limit=5, scope="all")
```

The project store keeps ten newest committed summaries. Ownerless legacy records are labeled `legacy-unscoped` and are excluded from default project search.

### Tool-output compaction

The `tool_result` hook keeps small results unchanged. By default, text exceeding 12,000 characters or 240 lines is saved in the project tool-output directory and replaced with a deterministic preview. Classification precedence is diagnostic, unified diff, whole-document JSON, test output, search output, then generic head/tail fallback. Each new artifact index row, replacement notice, and details object carries the exact UTF-8 byte count, lowercase SHA-256 digest, and selected preview strategy. Existing artifacts and index rows are not rewritten. If persistence or preview construction fails, the hook leaves the original result available and emits at most one UI warning.

Conversation turns use conservative recency limits: the newest five retain the
current semantic limit, records 6–20 retain half, and older records retain one
quarter. Explicit state, failures, diffs, latest verification, file/literal
evidence, and artifact receipts remain protected evidence rather than recency
signals.

## Verify and contribute

This is an ESM TypeScript/Bun package. Run its configured checks from the repository root:

```bash
bun test
bun x tsc --noEmit
```

Focused behavioral coverage includes deterministic results for manual, threshold, and overflow compaction triggers; transaction commit matching; continuation delivery; recall; storage; input bounding; and tool-output previews.

## Limits and non-goals

- dc-shrink does not call an LLM or replace Pi’s cut selection, compaction append, or context rebuild.
- Live compaction does not read the append-only session file; session-file compiler helpers exist only for diagnostics and tests.
- A compiler failure, cancellation, foreign compaction, mismatched append, duplicate event, or child session cannot commit success artifacts.
- Raw dumps can contain canonical discarded context and returned summaries; enable them only when that local storage is appropriate for the project.

See [architecture](docs/architecture.md), [usage](docs/usage.md), [settings and data](docs/settings.md), and [troubleshooting](docs/troubleshooting.md) for supporting detail.
