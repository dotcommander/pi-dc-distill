# pi-dc-distill Usage

[README](../README.md) · [Policy and data](settings.md) · [Troubleshooting](troubleshooting.md)

Install and load the package using the [quick start](../README.md#install).
The extension runs in the primary Pi session. Its agent tools are unavailable
outside that owner session.

## Commands

| Command | Purpose |
| --- | --- |
| `/compact` | Run Pi's manual compaction with dc-distill's deterministic summary. |
| `/compact <focus>` | Include an optional focus hint, bounded to 2,048 Unicode code points. |

For example:

```text
/compact preserve the parser repair, modified files, and remaining verification
```

Pi owns `/compact`; dc-distill registers no slash commands. `/compact status`
uses `status` as focus text. Inspect logs for status instead. Manual compaction
never queues an autonomous continuation.

The compiler receives the previous summary, discarded messages, discarded
split-turn prefix, and latest eligible handoff on the active branch. Retained
tail content remains in Pi's rebuilt context; abandoned branches are excluded.
If compilation fails or is cancelled, dc-distill cancels compaction without an
LLM fallback. Success logs, recall, and optional dumps are written only after
Pi appends the matching compaction.

## Automatic compaction

The monitor checks at `agent_settled`, after a response and its tool calls settle.
It normally attempts compaction at the lower of 120,000 tokens or 20,000 tokens
before Pi's native trigger. A startup warmup, 120-second cooldown, in-flight
latch, post-compaction growth guard, and Pi-sync guard can delay attempts.
At the native trigger it issues a cooperative warning until the headroom floor
(`contextWindow - 20,480`, the answer budget pi-ai's request clamp protects) is
reached; at or above the floor, and at the reported context limit, mechanical
compaction bypasses cooldown and sync guards. A missed auto window blocked by
ordinary guards is pursued mechanically at the next unblocked warn-band check.
After a restart, admission guards are restored once from the active branch
journal: a branch with a prior compaction waits for a fresh host usage baseline
before another ordinary compaction (still requiring 4,000 tokens of growth),
while a trustworthy branch without any compaction can skip the synthetic
startup cooldown after warmup. See
[trigger policy](settings.md#trigger-policy) for exact geometry and small-window
fallbacks. Above the auto boundary, blocked attempts are recorded in `diag.log`.

After a matching autonomous compaction is committed, the extension may queue a
hidden `dc-distill-continuation` turn while idle. Its delivery state is recorded
in the session ledger so startup and tree changes can recover an unanswered
continuation. Manual compaction leaves the next move to you.

## Save a handoff

Ask the agent to call `save_distill_handoff` with a non-empty `handoff` string.
It appends state to the active session for the next eligible compaction; it does
not compact immediately. Ordinary prose is supported.

For structured state, use the following entire fenced block as the `handoff`
argument, with no surrounding text:

````text
```distill-handoff-v1
{
  "objective": "Finish the parser repair.",
  "done": ["Implemented result-aware file evidence."],
  "next": ["Run the focused parser tests."],
  "blocker": [],
  "decision": ["Keep legacy handoffs compatible."],
  "verification-needed": ["bun test lib/local-compact.test.ts"]
}
```
````

All six keys are required; lists contain non-empty strings or are empty.
For dependency-aware state, v2 requires exactly these six top-level keys:

````text
```distill-handoff-v2
{
  "objective": "Finish the parser repair.",
  "invariants": ["Compilation remains deterministic."],
  "decisions": [{"id": "d1", "text": "Keep legacy handoffs", "rationale": "Existing sessions must remain readable."}],
  "rejected-hypotheses": [],
  "tasks": [
    {"id": "repair", "status": "done", "action": "Repair file evidence", "depends-on": [], "blocker": ""},
    {"id": "verify", "status": "pending", "action": "Run focused tests", "depends-on": ["repair"], "blocker": ""}
  ],
  "verification-needed": ["bun test lib/local-compact.test.ts"]
}
```
````

Task status is `done`, `pending`, or `blocked`. IDs and dependency references
must be valid and unique where required; cycles are rejected. A blocked task
requires a non-empty blocker; other statuses require an empty blocker string. Pending tasks whose dependencies are done become
ready tasks. Rejected hypotheses use `id`, `claim`, and `evidence` fields.

For observed readiness, use `distill-handoff-v3` with all v2 fields, a
`preconditions` array and a `requires` array on every task. For example, add
`{"id":"read-parser","kind":"file-read-succeeded","path":"src/parser.ts","cwd":"/project"}`
and `{"id":"tests","kind":"verification-pass","runner":"bash","command":"bun test src/parser.test.ts","cwd":"/project"}`,
then use `"requires":["read-parser","tests"]` on a pending task. Up to 32
predicates are allowed. References must exist, IDs must be unique, cwd must be
absolute and commands match exact supplied bytes and compatible raw runner names.
An empty `requires` list is valid.

These are observed conditions, not instructions to inspect files or run commands.
Fresh unique successful observations satisfy them; fresh matching failures
contradict them; missing, stale or uncertain evidence remains unknown. Only
pending graph-ready tasks whose requirements are all satisfied enter
`<ready-tasks>`; other graph-ready tasks appear separately. A historical file
creation does not satisfy a successful-read predicate. V1/v2 behavior is preserved.

Structured envelopes are limited to 16,384 Unicode code points, lists to 32
items, and individual strings to 2,048 code points. Invalid, unknown-version,
or oversized envelopes remain bounded opaque text. Handoffs describe task state;
they are never proof that verification passed.

## Recall prior summaries

Recall is off by default. First enable `extensionConfig["dc-distill"].recall.enabled`
in [feature settings](settings.md#optional-feature-settings) and start a new
session. Otherwise the registered tool reports disabled without reading any
recall store; no new summaries or extra focus echoes are saved/injected.

When enabled, ask the agent to call `recall_compaction` with JSON arguments such as:

```json
{"query": "modified-files", "limit": 3}
```

The default scope is `project`, and the default limit is 3. Each project keeps
ten newest committed summaries. Cross-project search is explicit:

```json
{"query": "source-anchors", "limit": 5, "scope": "all"}
```

All-project search merges stores newest-first and can include ownerless legacy
entries labelled `legacy-unscoped`. Those entries do not appear in default
project search.

Named sections include `Session`, `User Focus`, and `Conversation`. Searchable
markers include file/tool evidence, `retained-context`, `resume-state`,
`current-intent`, `resume-risks`, `summary-omissions`, `verification`,
`working-tree`, `source-anchors`, `active-tasks`, `resume-tasks`, `resume-index`,
`change-impact`, `ready-tasks`, and `graph-ready-tasks`. Other queries rank
keywords across supported parts with deterministic lexical BM25. Recall searches
retained summaries, not the complete transcript; readiness markers report stored
observations rather than current-state checks.

Summaries with a provider session ID include `ctxgo show session` and
`ctxgo locate session` recovery commands. `ctxgo` is a separate tool: these hints
require it to be installed and the session to be indexed there. dc-distill does
not install it or index transcripts.

## Oversized tool output

This feature is off by default. Enable
`extensionConfig["dc-distill"].toolOutput.enabled` in
[feature settings](settings.md#optional-feature-settings) and start a new session.
When disabled, all results are left untouched and no output artifacts are written.

When enabled in the owner session, the `tool_result` hook leaves small results
unchanged. Text exceeding 12,000
JavaScript string units or 240 lines is saved locally and replaced with a
preview. The replacement includes the artifact path, exact UTF-8 byte count,
SHA-256 digest, and preview strategy. Diagnostic, diff, whole-document JSON,
test, and search previews take precedence over generic head/tail clipping.

Open or read the artifact path to recover the full text. If persistence or
preview construction fails, the original result remains available and the
extension emits at most one UI warning. See [durable storage](settings.md#durable-storage)
for the project artifact location.

## Synthetic comparison

From a checkout, run `bun run distill:compare`. It reuses the replay evaluator
with `tests/fixtures/parser-session.jsonl`, prints the summary and UTF-8 byte
counts, and asserts preservation of the fixture's handoff state, file observations,
and synthetic verification receipt. A second compilation must produce identical
summary text. No Pi runtime, credentials, or network calls are needed.

The command replaces its generated artifacts in
`~/.pi/agent/cache/dc-distill/compare/<unique-run>/`. The fixture is included in source
control for repeatable regression checks, not as private session data. See the
[README comparison](../README.md#try-a-repeatable-comparison).

## Replay a past session

From a checkout with Bun and dependencies installed:

```bash
bun run distill:session -- /path/to/session.jsonl \
  --compaction last \
  --out ~/.pi/agent/cache/dc-distill/evaluations/example
```

The evaluator writes `input.jsonl`, `current.md`, and `report.json`. When a
historical compaction is selected, it also writes `historical.md` and compares
its summary body with the current output.

| Option | Meaning |
| --- | --- |
| `--compaction first`, `last`, or `N` | Replay before that historical compaction; `N` is one-based and `last` is the default. |
| `--whole` | Compile all records, including carried compaction records; use for canonical before dumps. |
| `--historical <file>` | Compare with a saved historical summary or after dump. |
| `--focus <text>` | Supply an optional focus hint. |
| `--out <directory>` | Choose output location; default is `~/.pi/agent/cache/dc-distill/evaluations/<unique-run>`. |
| `--force` | Replace evaluator artifacts already present in the output directory. |
| `--help` | Print CLI help. |

If a session has no compaction entries, the evaluator compiles the whole file.
Existing artifacts are preserved unless `--force` is supplied. To compare a
retained diagnostic pair:

```bash
bun run distill:session -- /path/to/attempt-before.jsonl \
  --whole \
  --historical /path/to/attempt-after.txt \
  --out ~/.pi/agent/cache/dc-distill/evaluations/diagnostic-pair
```

A full session replay cannot reproduce Pi's discarded-message preparation
boundaries exactly. Before dumps contain the exact live compiler input; legacy
bare-message dumps are canonicalized and their detected format appears in the
report. Replay artifacts contain session content and are written locally.

## Interpreting resume evidence

File lists mean successful tool-observed reads or tool-reported writes. They do
not prove current existence, exact contents, or Git state. Failed or unmatched
writes produce inspect-before-retry risks because partial effects can be unknown.
Git receipts retain their captured working directory. Supported aliases include `view_file` for
reads and `write_to_file`, `replace_file_content`, `patch_file`, and `create_file`
for writes; `write_to_file` and `create_file` can create files. Path arguments
use `path`, `file_path`, `filePath`, `file` first, then `targetFile`, `TargetFile`,
`target_file`, `target_path`, `absolutePath`, `AbsolutePath`, in that order.
Aliases still require a successful and unambiguous paired result.

Verification receipts use exact runner, command bytes, and known working
directory identity. Later successful writes or potentially modifying shell
commands mark earlier results as having unestablished freshness.

The operating summary target is 8,192 Unicode code points. Complete optional
records are removed first, and omissions are reported; the hard wire ceiling
is 65,536. See [algorithm](algorithm.md) for scoring and eviction, and
[architecture](architecture.md#compaction-contract) for version-13 details, checkpoint integrity, and token estimates.

### Persistence and generated artifacts

All extension defaults resolve Pi's public `getAgentDir()` lazily. Pi normally
uses `~/.pi/agent`; `PI_CODING_AGENT_DIR` selects another profile and supports
`~` expansion. Durable logs, diagnostics, dumps, project recall, and tool outputs
live beneath `<agent>/data/dc-distill/`. Generated artifacts use unique runs beneath
`<agent>/cache/dc-distill/{evaluations,compare,e2e,demo}/`. Commands print absolute
artifact paths on success and failure. E2E and demo capture the parent cache and
put child runtime state under each run's isolated `agent-home/data/dc-distill/`.

Each category retains the current run plus the newest nine other completed
unprotected runs, including failures. Finalization waits for artifact consumers
and subprocesses. Unfinished hard-crash artifacts, unmanaged or malformed runs,
symlinks, and explicitly protected runs are preserved outside this ten-run limit.
Explicit `--out` paths have no automatic retention; targeting an existing managed
run protects it before writing, and `--force` still controls overwrites. Benchmark
output stays explicit. Existing `.work` contents and ignore rules are preserved.

## Explicit checkpoint updates

`save_distill_handoff` keeps the strict v1–v3 handoff grammars and accepts an optional
`checkpoint` argument with `version: 1`, `expectedBase: { checkpointDigest,
updateEntryId }`, and up to 32 operations. Initial base fields are `null`. Use
`pin` for exact user-source workset, constraint, or request text; `resolve` for a
named task/pin and reason; `supersede` for a same-kind replacement and reason.
Sources select an exact entry/block/span, a unique excerpt in the latest eligible
user message, or a validated pin. The tool returns canonical source references
and the physical saved update entry ID for the next base. Stale, ambiguous, cyclic,
or conflicting updates are rejected atomically. Resolution cannot create evidence
or authorization, and declared completion retains unmet evidence requirements.

The saved input envelope is limited to 16,384 Unicode code points. Up to 32 pins
retain at most 2,048 code points each. Protected state never silently shortens: if
it cannot fit the checkpoint, rendered summary, or prospective context, compaction
cancels with `protected_overflow`.
