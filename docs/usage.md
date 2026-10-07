# Using dc-distill

Your job is to compact context with Pi's native `/compact` command and read the deterministic summary card dc-distill produces for it.

## Before you start

- Install with `pi install npm:pi-dc-distill`. Pi loads the TypeScript extension directly; Node.js 22.19.0 or newer is required, and Bun is used for development only.
- Start a fresh session with only this extension enabled. Existing incompatible sessions keep the old extension; there is no migration or historical reader, and the two extensions must not load together.
- The extension registers no commands or tools and has no configuration. It intercepts every Pi compaction request identically — manual, threshold, overflow, absent, and unfamiliar reasons. Pi alone decides when to compact and which entries remain.
- If anything fails, the compaction cancels. There is no fallback to LLM summarization, no retry, no abort, and no continuation message.

| Command | Owner and purpose |
| --- | --- |
| `/compact [instructions]` | Pi's native compaction command; instructions supply the bounded focus. |

## Compact and read the summary

Prerequisite: a fresh session holding some conversation to compact.

1. Run Pi's native command:

   ```text
   /compact keep the parser discussion and command outcomes
   ```

2. Expected observable result: Pi replaces the summarized prefix with its native compaction card containing a `dc-distill-summary` text block. For a discarded window containing a plain user message, an assistant note about a failed build, two identical `read` calls of `lib/parser.ts` with successful results, one successful `bun test` bash execution, and a newest user request to fix the parser tests, the current compiler emits exactly:

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

3. Mechanism: dc-distill's `session_before_compact` hook compiles the discarded messages deterministically — no model call — and returns the summary plus token estimates built from Pi's own rebuilt-context functions. Pi appends the compaction entry and rebuilds the context. Pi's native compaction card is the sole success display; the extension emits no success notification.

4. Next safe variation: compact again later in the same session. The previous summary is carried flat — its rows reappear with `origin: prior`, its facts merge with newer observations, and summaries never nest recursively. Structured carry requires a matching digest and successful current-format decoding. Every other predecessor becomes bounded attributed text, without a dedicated latest-request field or structured facts.

## Reading a summary

The `columns:` line is a fixed legend emitted with every summary; each section renders escaped single-line rows (`\`, `|`, carriage returns, and newlines are escaped, so the literal `\n` above is two characters, not a line break).

- `focus`: your `/compact` instructions, bounded, or absent.
- `latest-request`: the newest admitted native user text — attributed context, not a task state.
- `records`: selected conversation excerpts in chronological order. Flags render as keywords (`full`/`cut`), never positional booleans; repeated tool attempts keep their own call and result rows, and excerpt rows never synthesize outcome claims — outcomes live only in paired `files` and `commands` facts.
- `files`: observations paired from explicitly successful tool results. `commands` record success, error, or unknown outcomes. Command rows carry a `cmd` prefix; the cwd renders as `none` or an `=`-prefixed path. Row identities are 22-character base64url SHA-256 prefixes.
- `omitted`: labeled counters of candidates lost before or during selection (`input`, `excerpts`, `reads`, `modified`, `commands`).

`origin: "current"` means observed in this compaction's discarded input — not current filesystem truth. Carried observations have `origin: "prior"`.

## What a summary does not prove

- Omission counters describe lost candidates, so a summary with no visible failure is not proof that all commands passed; command status can also be `unknown` when no outcome was recorded.
- File writes marked create-capable (`yes`) do not prove a file was newly created.
- Readiness, verification, and authorization must be established outside this summary. No protected task or evidence preservation remains.

For failures and cancelled compactions, see [troubleshooting](troubleshooting.md). Selection rules, pairing, identities, and budgets are specified in [algorithm](algorithm.md).
