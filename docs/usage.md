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
   columns: records=kind|origin|cut|text ; files=section id|origin|cut|create|path ; commands=cmd id|origin|cut|runner|status|cwd|command|result ; current=selected input, prior=carried context; full/cut=no known text clipping/clipped; create=yes means capable, not created; command id=runner/command/cwd tuple, not execution; cwd: leading = marks recorded text; none means unrecorded; observations are not present truth, readiness, verification or authorization; omissions=count dropped candidates, not text cuts; 9007199254740991 means at least that many; request after=N counts preceding retained records; text uses literal backslash escapes
   focus: full "keep the parser discussion and command outcomes"
   latest-request: current full after=7 "Fix the failing parser tests in lib/parser.ts"
   records:
   user | current | full | continue with the plan
   assistant | current | full | the build failed with error: exit status 1
   tool-call | current | full | read {\"path\":\"lib/parser.ts\"}
   tool-result | current | full | export function parse() {}
   tool-call | current | full | read {\"path\":\"lib/parser.ts\"}
   tool-result | current | full | export function parse() {}
   bash | current | full | bun test\n113 pass
   files:
   read EjC6jKHybk-5dxtBRcSGEk | current | full | no | lib/parser.ts
   commands:
   cmd xy3YsSXQ0D945QQBsxKqQo | current | full | bash | success | =/repo | bun test | 113 pass
   omitted: input=0 excerpts=0 reads=0 modified=0 commands=0
   </dc-distill-summary>
   ```

   (Representative current-format output; exact bytes are covered by compiler fixtures.)

3. Mechanism: dc-distill's `session_before_compact` hook compiles the discarded messages deterministically — no model call — and returns the summary plus token estimates built from Pi's own rebuilt-context functions. Pi appends the compaction entry and rebuilds the context. Pi's native compaction card is the sole success display; the extension emits no success notification.

4. Next safe variation: compact again later in the same session. The previous summary is carried flat — its rows reappear with `origin: prior`, its facts merge with newer observations, and summaries never nest recursively. Structured carry requires a matching digest and successful current-format decoding. Every other predecessor becomes bounded attributed text, without a dedicated latest-request field or structured facts.

## Inspect a saved session outside Pi

From the development checkout with its project-local dependencies installed, run:

```bash
bun run distill:session /path/to/session.jsonl
cat /path/to/session.jsonl | bun run distill:session -
bun run distill:session --latest
```

The runner reads current Pi version-3 JSONL sessions, prepares the cut with the pinned Pi 0.99.2 SDK, and uses the same source validation, compiler and capacity fitting as the extension. It does not launch Pi, call a provider, append a compaction or modify the source/settings. Unsupported historical headers, malformed JSONL, duplicate identities, dangling parents and cycles fail explicitly. If native preparation finds nothing eligible, it fails rather than summarizing the entire transcript.

Stdout is only the exact canonical summary, with no extra newline. Redirect it to a file if desired; the selected path, leaf, retained-tail cut, retention setting, token estimate and capacity status appear on stderr. A saved file has no `/compact` instructions, so focus is absent.

No input, or `--latest`, selects the most recently modified saved JSONL file for the current project; this is **not necessarily the active session**. `--cwd PATH` changes discovery, while the session header's cwd always controls compilation and project settings. Discovery respects `PI_CODING_AGENT_DIR` (default `~/.pi/agent`) and `PI_CODING_AGENT_SESSION_DIR`; `--session-dir PATH` overrides the discovery directory. Explicit file paths can be outside the project. Stdin is read only when the input is `-`.

Use `--leaf ID` to select a branch instead of the last saved entry, and `--keep-recent-tokens N` to override native retained-tail selection. Read-only global `settings.json` and the header cwd's `.pi/settings.json` supply ordinary compaction settings, with project values winning and explicit retention winning over both. Defaults are `keepRecentTokens=20000` and `reserveTokens=16384`. Automatic-trigger enablement does not prevent this explicit preparation; model-specific settings are not inferred from historical messages. Without `--context-window N`, capacity remains explicitly unknown. With a known window, the shared capacity fitter checks the rebuilt summary plus retained tail against the full window; response reserve is not enforced. `--help` lists the options.

This helper is development-only and excluded from the published runtime. The live extension still takes input exclusively from Pi's preparation event and active branch; it never reads session files.

## Reading a summary

The `columns:` line is a fixed legend emitted with every summary; each section renders escaped single-line rows. All text fields escape backslash, quote, pipe, LF, CR and tab. Angle brackets and other Unicode control, format and separator characters use lowercase `\u{hex}` scalar escapes, including emoji joiners. Decoding preserves the exact bounded text; the literal `\n` above is two characters, not a line break.

- `focus`: your native `/compact` instructions, quoted and bounded, with `full` or `cut`, or absent. It is never carried.
- `latest-request`: the newest admitted native user text, quoted with origin, `full`/`cut`, and `after=N` counting preceding retained records. A later request moves the old request into one prior user excerpt at that position; identical requests remain distinct.
- `records`: selected conversation excerpts in chronological order. Long conversational text can contain complete source units separated by `[... excerpt gap ...]`; `cut` marks this incomplete selection. Oversized structural units can be omitted, and a literal prefix is the fallback when no unit fits. Opaque native/branch summaries retain their attributed physical prefix. User context precedes conversational context, which precedes operational call/result/bash rows; newer substantive conversation precedes older code-rich conversation. Flags render as keywords (`full`/`cut`), never positional booleans; repeated tool attempts keep their own call and result rows, and excerpt rows never synthesize outcome claims — outcomes live only in paired `files` and `commands` facts.
- `files`: observations paired from explicitly successful tool results. `commands` record success, error, or unknown outcomes. Command rows carry a `cmd` prefix; the cwd renders as `none` or an `=`-prefixed path. Row identities are 22-character base64url SHA-256 prefixes.
- `omitted`: labeled counters of candidates lost before or during selection (`input`, `excerpts`, `reads`, `modified`, `commands`).

`origin: "current"` means observed in this compaction's discarded input — not current filesystem truth. Carried observations have `origin: "prior"`.

## What a summary does not prove

- Omission counters describe lost candidates, so a summary with no visible failure is not proof that all commands passed; command status can also be `unknown` when no outcome was recorded.
- File writes marked create-capable (`yes`) do not prove a file was newly created.
- Readiness, verification, and authorization must be established outside this summary. No protected task or evidence preservation remains.

For failures and cancelled compactions, see [troubleshooting](troubleshooting.md). Selection rules, pairing, identities, and budgets are specified in [algorithm](algorithm.md).
