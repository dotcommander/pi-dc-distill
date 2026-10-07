# pi-dc-distill

Deterministic local context compaction for [Pi](https://github.com/earendil-works/pi): one extension that replaces Pi's LLM compactor with a compiler, so every compaction request is answered with zero model calls. If anything inside the extension fails, the compaction cancels instead of falling back to an LLM summarizer — that failure boundary is the first thing to know. The first run is two commands away, below.

## Install and first compaction

Prerequisite: Pi with Node.js 22.19.0 or newer (the package's `engines` floor). Pi packages execute extension code, so review the source before installing. Then:

```bash
pi install npm:pi-dc-distill
```

Pi loads the TypeScript source directly (`"pi": { "extensions": ["./index.ts"] }`); there is nothing to build. Start a fresh session with this extension. Existing incompatible sessions must use the old extension — there is no migration or historical format decoder. Stored data and existing session files are preserved; this extension writes no state of its own.

With some conversation in the session, run Pi's native command:

```text
/compact keep the parser discussion and command outcomes
```

Expected observable result: Pi replaces the summarized prefix with its native compaction card containing a `dc-distill-summary` text block. For a discarded window holding a plain user message, an assistant note about a failed build, two identical `read` calls of `lib/parser.ts` with successful results, one successful `bun test` execution, and a newest user request, the current compiler emits exactly:

```text
<dc-distill-summary>
notice: Selected conversation excerpts and observations; incomplete.
columns: records=kind|origin|cut|text ; files=section id|origin|cut|create|path ; commands=cmd id|origin|cut|runner|status|cwd|command|result
focus: keep the parser discussion and command outcomes
latest-request: current full "Fix the failing parser tests in lib/parser.ts"
records:
user | current | full | continue with the plan
assistant | current | full | the build failed with error: exit status 1
tool-call | current | full | read {"path":"lib/parser.ts"}
tool-result | current | full | export function parse() {}
tool-call | current | full | read {"path":"lib/parser.ts"}
tool-result | current | full | export function parse() {}
bash | current | full | bun test\n113 pass
files:
read EjC6jKHybk-5dxtBRcSGEk | current | full | no | lib/parser.ts
commands:
cmd xy3YsSXQ0D945QQBsxKqQo | current | full | bash | success | =/repo | bun test | 113 pass
omitted: input=0 excerpts=0 reads=0 modified=0 commands=0
</dc-distill-summary>
```

(Exact output of the current compiler pipeline, executed locally on that representative input.)

How to read it: the `columns:` line is a fixed legend for every summary. Rows are escaped single lines — the `\n` in the bash row is two literal characters, never a line break. Flags are words, not booleans (`full`/`cut`, `yes`/`no`), the request text is quoted, command rows carry a `cmd` prefix with cwd as `none` or `=`-prefixed, and row identities are 22-character base64url SHA-256 prefixes. `origin: "current"` means observed in this compaction's discarded input — not current filesystem truth.

Mechanism: the `session_before_compact` hook compiles Pi's discarded messages deterministically and returns the summary with token estimates Pi computes from its own rebuilt-context functions; Pi then appends the compaction entry and rebuilds the context. Pi's native compaction card is the sole success display; the extension emits no success notification.

Next safe variation: `/compact` again later in the same session. The previous summary is carried flat — its rows return marked `origin: prior`, its facts merge with newer observations, and summaries never nest. Carrying is opportunistic and never blocks: a prior summary whose recorded digest matches and decodes in the current shape carries full structured state; all other predecessors — including damaged summaries, old JSON formats, foreign or native summaries — degrade to bounded attributed text. Fallback text does not preserve a dedicated latest-request field or structured observations. Selection rules, pairing, identities, and budgets are specified in [algorithm](docs/algorithm.md).

The `omitted:` counters count candidates lost before or during selection, not failures: a summary with no visible error is not proof that every command passed, and command status can be `unknown` when no outcome was recorded. File writes flagged create-capable (`yes`) do not prove a file was created. The summary remembers what was said — it does not establish readiness, verification, or authorization.

## Configuration and state

There is no extension configuration. Pi owns compaction triggering, cut selection, and rebuilt context; the extension registers no commands or tools and reads no settings. The compiler's fixed bounds are policy, not knobs: a 20 MiB whole-record input envelope, an 8,192-code-point operating target, and a 65,536-code-point hard serialized limit. Live input comes only from `event.preparation` and the active branch entries — the extension never reads the session file.

## Verification and development

Development uses Bun (1.4.0) with project-local dependencies; the Pi SDK development pins stay at 0.99.2 and host peer ranges stay `*`:

```bash
bun install --frozen-lockfile
```

After implementation and semantic review, the verifier runs the gate list once:

```bash
bun test
bun x tsc --noEmit
bun run distill:architecture
git diff --check
npm pack --dry-run --json
bun run distill:e2e
```

Repairs rerun affected gates only. The e2e suite drives an installed Pi through a local scripted provider — no paid provider is needed to verify the deterministic compiler — and fixtures alone do not prove installed-host behavior; see [runtime acceptance](tests/e2e/README.md). Publication is a separately authorized operation; the package ships only the extension entry, its runtime modules, README, and license.

## Limits and non-goals

- No LLM calls anywhere in the extension. Source, compiler, cancellation, and capacity failures cancel the compaction; Pi's default LLM compactor never takes over.
- One primary session owns the runtime; child sessions cancel interception.
- Pi’s native compaction card is the sole success display. There are no extension notifications, timers, retries, continuation sends, storage writes, dumps, recall, checkpoints, pins, task graphs, or custom cards.
- No replay CLI and no supported import API beyond the extension entry itself.
- Existing incompatible sessions keep the old extension; never load both together.

More: [documentation index](docs/index.md), [usage](docs/usage.md), [troubleshooting](docs/troubleshooting.md).
