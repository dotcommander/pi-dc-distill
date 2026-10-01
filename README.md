# pi-dc-distill

**Deterministic context compaction. No LLM required.**

![Illustrated synthetic parser session before and after compaction: 11,988 to 2,950 UTF-8 bytes, with objective, decisions, files, synthetic checks, and next action retained.](docs/assets/distill-before-after.svg)

pi-dc-distill builds local resume summaries for [Pi](https://github.com/earendil-works/pi-mono).
It extracts explicit task state, decisions, file observations, and verification
receipts, then removes repetition and low-signal context under a fixed budget.
Pi owns `/compact`, chooses what to discard, and rebuilds the conversation.

The extension also stores full oversized tool output before replacing it with
a preview, and provides project-scoped recall of recent compaction summaries.

## Install

Use Node.js 22.19.0 or newer and Pi 0.99.2, the SDK and runtime verified here:

```bash
pi install git:github.com/dotcommander/pi-dc-distill
```

The Git repository still has its previous name; the package is `pi-dc-distill`.
An npm release, once published, uses `pi install npm:pi-dc-distill`.
Remove or disable the previous extension before loading this one.

Start a new Pi session in your project. Once enough context has accumulated:

```text
/compact preserve the parser repair, modified files, and remaining verification
```

Expand the card to inspect the summary. Manual compaction leaves the next action
to you. Automatic compaction checks after the response and tool calls settle,
at Pi's `agent_settled` boundary, and can queue a continuation after commit.

## Try a repeatable comparison

From a checkout with Bun installed:

```bash
bun install --frozen-lockfile
bun run distill:compare
```

The command replays a [synthetic session](tests/fixtures/parser-session.jsonl)
through the existing evaluator, prints the retained context, and checks that
its objective, decision, modified-file observations, verification status, and
next action survive. It also checks byte-for-byte deterministic output.

Current fixture result:

```text
Before: 11988 UTF-8 bytes of serialized JSONL (13 records)
After:  2950 UTF-8 bytes of summary (75.4% smaller)
```

These are sizes for this fixture, not model-token estimates or a general
compression benchmark. Its recorded test pass is synthetic; the comparison
checks preservation rather than executing the sample parser's tests.
Artifacts are written to `.work/distill-evaluations/synthetic-parser/`.

## Use

| Task | Interface |
| --- | --- |
| Compact now | `/compact` or `/compact <focus>` |
| Save explicit task state | Agent tool `save_distill_handoff`, with a non-empty `handoff` string. |
| Search retained summaries | Agent tool `recall_compaction`, with `query`, optional `limit`, and optional `scope`. |
| Recover full tool output | Read the artifact path in its preview notice. |
| Replay a session from a checkout | `bun run distill:session -- <session.jsonl>` |

The handoff and recall interfaces are agent tools. Pi's `/compact` is the only
slash command involved. See [usage](docs/usage.md) for arguments and examples.

## Policy and limits

Pi's global and project compaction settings control the autonomous monitor.
`compaction.enabled: false` disables it; manual compaction remains available.
There are no extension-specific settings. Logs, recall, and output artifacts
live under `~/.pi/data/dc-distill/`; raw input dumps are off by default.

The compiler is rule-based and lossy. It can miss subjective context and
low-signal details. A handoff or focus hint helps identify what matters. File
observations and test receipts describe captured evidence, not current Git state
or proof that a check is still fresh. Compilation failure cancels compaction
without a provider fallback.

The summary target is 8,192 Unicode code points; the hard wire limit is 65,536.
Retained-tail content stays in Pi's context, and abandoned branches are excluded
from live input. See [policy and data](docs/settings.md) for storage, retention,
triggers, and [migration from the previous name](docs/settings.md#upgrading-from-pi-dc-shrink).

## Development and documentation

Direct dependencies are pinned and resolved in `bun.lock`. Checks run offline
after installation:

```bash
bun test
bun run typecheck
git diff --check
```

`bun run distill:demo` runs one manual lifecycle through installed Pi RPC with a
scripted provider. `bun run distill:e2e` also tests automatic compaction and
restart recovery; its automatic case includes the production 120-second cooldown.
Both use isolated data directories and make no provider/network requests.

- [Usage](docs/usage.md): compaction, handoffs, recall, output previews, replay.
- [Policy and data](docs/settings.md): settings, local storage, migration.
- [Troubleshooting](docs/troubleshooting.md): diagnostics and compatibility.
- [Architecture](docs/architecture.md): ownership, lifecycle, isolation, metrics.
- [Algorithm](docs/algorithm.md): scoring, repetition, evidence, eviction.

[MIT license](LICENSE).
