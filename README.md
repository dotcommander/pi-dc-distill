# pi-dc-distill

Deterministic local context compaction for [Pi](https://github.com/earendil-works/pi), with no LLM calls.

Pi owns compaction triggering, cut selection, entry append, and context rebuilding. dc-distill intercepts every Pi compaction request, including manual, threshold, overflow, and unfamiliar request reasons. It returns selected conversation excerpts, file observations, and recorded command outcomes as bounded JSON. These observations are incomplete: they do not establish task readiness, verification, or authorization, and they do not describe current filesystem truth.

## Install and cut over

```bash
pi install npm:pi-dc-distill
```

Pi loads the TypeScript extension directly. Node.js 22.19.0 or newer is required; Bun is used for development only. Do not load the old and new extensions together.

**Start a fresh session with this extension.** Existing incompatible sessions must use the old extension. Owned summaries with an incompatible shape or digest and active legacy handoffs cancel compaction; there is no historical decoder or migration. Stored data and existing session files are preserved.

Use Pi's native command:

```text
/compact preserve the parser discussion and command outcomes
```

Pi's native compaction card contains the JSON summary. Compaction instructions become the summary's bounded focus. The extension registers no commands or tools and has no extension configuration.

## Summary contract

There is one unversioned format, `dc-distill-summary`. Its fixed keys are `format`, `notice`, `focus`, `latestRequest`, `records`, `files`, `commands`, and `omitted`. The notice is always `Selected conversation excerpts and observations; incomplete.`

Current observations come only from Pi's discarded input; carried predecessor observations are marked `prior`. `latestRequest` is the newest admitted native user text, or the predecessor request when none is admitted. It is attributed context, and its duplicate excerpt is excluded. Predecessor records are flattened; summaries never recursively nest.

The compiler targets 8,192 serialized Unicode code points, with a 65,536-code-point hard limit. It shortens individual display fields safely and drops whole optional rows. Input is bounded to 20 MiB using complete records. Pi's rebuilt-context estimate checks the exact summary with the retained tail; if mandatory content cannot fit known capacity, compaction cancels. Unknown capacity is explicitly reported.

File facts require an unambiguous paired successful tool result. Command status is the recorded outcome, including `unknown` for missing outcome information. Create-capable writes are observations, not proof that a file was newly created. See [algorithm](docs/algorithm.md) for identities, pairing, bounds, and omission accounting.

## Runtime boundary

Live input comes only from `event.preparation` and active `event.branchEntries`; the extension never reads the session file. Source, compiler, and capacity failures cancel interception so Pi's default LLM compactor cannot take over. Child sessions cancel interception.

Only an independently validated newest active primary-session commit matching the full pending receipt permits a synchronous best-effort UI notification. Pi's native compaction card is the persistent success display; the notification is not guaranteed to remain visible. There are no extension-owned triggers, aborts, timers, continuation sends, storage writes, dumps, recall, focus injection, tool-output previews, checkpoints, pins, task graphs, signatures, custom cards, replay CLI, or migration machinery. Protected task and evidence preservation has been retired.

## Development

Install the checkout's existing pinned dependencies with `bun install --frozen-lockfile`; do not share another project's node_modules. The Pi development SDK remains pinned to 0.99.2. Host peer ranges remain `*`.

After implementation and semantic review, the verifier runs:

```bash
bun test
bun x tsc --noEmit
bun run distill:architecture
git diff --check
npm pack --dry-run --json
bun run distill:e2e
```

The full suite runs once under the user's approval; repairs require affected gates only. The isolated scripted-provider e2e suite uses the available installed Pi and is separate from unit-test discovery. No paid provider is needed to verify the deterministic compiler. Fixtures and source inspection do not prove installed-host behavior. See [runtime acceptance](tests/e2e/README.md), [architecture](docs/architecture.md), and [documentation index](docs/README.md).

Package publication exposes only the root extension and its required runtime modules, plus README and license. There is no replay binary or supported internal import API. Publication is a separate authorized operation.
