# The dc-shrink Algorithm

How `compileSessionJsonl()` (`lib/local-compact.ts`) turns a canonical
compaction input into a bounded, structured resume summary without an LLM.
The intelligence is a hand-tuned scoring rubric plus repetition-collapse
rules plus priority eviction under a budget. Every weight and threshold is
a visible constant in source; nothing is trained or sampled. Line
references point into `lib/local-compact.ts` unless noted.

## Pipeline Order

1. **Normalize** — parse every record into typed blocks, strip ANSI/control
   characters, capture session meta and the last agent-authored
   `<handoff>` block (`normalizeSessionJsonl`, line 443). Any malformed
   record fails closed (`CompactionInputError`).
2. **De-noise** — drop whole noise classes before scoring
   (`filterNoise`, line 482): thinking blocks, low-value tools
   (TodoWrite, WebSearch, …), harness noise strings, and wrapper XML
   (`<system-reminder>`, `<ide_opened-file>`,
   `<context-window-usage>`). Tool results compress to head-5 lines;
   errors keep head-4 plus tail-2 and a parsed exit code
   (`compressResultText`, line 512).
3. **Score** — every assistant turn is scored on content signals
   (`signalScore`, line 1025; table below). `score >= 3` is substantive.
4. **Collapse repetition** — loops and sawtooth noise (below).
5. **Synthesize runs** — runs of non-substantive turns become one line
   (`synthesizeRun`, line 1198).
6. **Index** — build the resume index and ranked recall queries
   (`buildResumeIndex`, line 1137).
7. **Tasks** — generate at most four imperative resume tasks
   (`buildResumeTasks`, line 1425).
8. **Budget** — evict whole records under the operating target
   (`enforceOperatingBudget`, line 2022).
9. **Emit** — assemble the wire summary with digest and recall note
   (`compileSessionJsonl`, line 2089).

## Turn Scoring Rubric

`extractSignals` (line 984) tests content features; `signalScore`
(line 1025) weighs them:

| Signal | Points |
| --- | ---: |
| Contains a diff (`-`/`+` lines or `@@`) | +5 |
| Code fence | +4 |
| Table (2+ pipe rows) | +4 |
| Error diagnostics (panic, traceback, root cause, …) | +4 |
| Architecture vocabulary (invariant, tradeoff, "chose … instead of", …) | +3 |
| Heading or numbered list | +2 |
| Long form (5+ non-empty lines or 800+ chars) | +2 |
| File path | +1 |
| Filler opener ("Let me…", "Now I'll…") | −2 |
| Short status (< 120 chars, no code/diff/table/path) | −2 |
| Pure acknowledgment ("great", "tests pass", < 200 chars) | −5 |

Substantive threshold: score >= 3. A turn with a diff survives; a bare
acknowledgment never does.

## Repetition Collapse

- **Edit loops** (`collapseEditLoops`, line 1237): 3+ assistant turns on
  the same (tool, target) with 2+ failures become one
  `[loop: <tool> <target> × N attempts, M failed — last: …]` marker
  (`EDIT_LOOP_MIN_ATTEMPTS = 3`, `EDIT_LOOP_MIN_FAILURES = 2`, lines
  1231–1232). The most recent successful attempt is promoted back before
  collapse so the surviving diff is kept.
- **Dense repetition** (`collapseDenseRepetition`, line 1313): any
  10-turn window with 6+ non-substantive turns (`REP_WINDOW = 10`,
  `REP_THRESHOLD = 6`, lines 1306–1307) collapses those turns into one
  `[N repeated procedural turns]` marker — this catches sawtooth
  patterns (substantive, noise, noise, substantive, …) that never form a
  contiguous run.
- **Run synthesis** (`compactAssistantTurns`, line 1368): runs of 3+
  procedural turns become a single line with top-K tool and file counts
  plus first/last turn quotes; runs after a user correction keep the
  correction context (`synthesizeRun`, line 1198).

Turn trims are signal-aware (`turnTrimLimit`, line 1051): turns with a
diff or table keep 2,000 chars, headings or long-form keep 1,000, all
others 500. Clipping cuts at a word or line boundary, never mid-token.

## Recall Salience Ranking

`recallSeedSalience` (line 1091) ranks recall seeds for the resume
index:

| Feature | Points |
| --- | ---: |
| Identifier shape (camelCase, snake_case, SCREAMING) | +3 |
| Contains a digit | +2 |
| Path separator (`.`, `/`, `\`) | +2 |
| Length >= 8 | +2 |
| Length <= 3 | −3 |
| First word is a stopword (line 1079) | −4 |

Ties break by recency (`buildResumeIndex`, line 1137). The top 5 seeds
become `recall_compaction` queries.

## Resume Tasks

`buildResumeTasks` (line 1425) emits at most four imperative lines, in
priority order: re-read active files, run the verification gate (a
FAIL/INCOMPLETE/BLOCKED receipt outranks the newest passing receipt),
one recall query, and `git status --short`.

## Verification Receipts

`renderVerificationReceipt` renders each result as
`STATUS [tool cwd=…]: command — evidence`. Oversized cwd or command
values are replaced by 16-hex sha256 prefixes. Fresh receipts and unresolved
FAIL/INCOMPLETE receipts retain exact commands. A successful or skipped receipt
made stale by later potentially modifying work uses a compact command digest;
it remains useful history but is not presented as an executable current gate.
Evidence selection prefers explicit test totals over wrapper banners.

## Budget and Eviction Order

Two-stage:

1. **Operating target** — `TARGET_RESUME_SUMMARY_CODE_POINTS = 13_024`
   (line 15); eviction runs while the summary exceeds target − 1,024.
   Whole records drop in fixed priority order: recent tool
   results, source anchors, literal anchors, recent tool calls, active
   tasks, stale verification receipts, conversation turns, read files, modified files,
   working-tree receipts, verification receipts. The resume index and
   resume tasks rebuild after every drop. Every eviction class writes an
   omission count into `<summary-omissions>`. Conversation eviction pins
   the latest human request, latest assistant turn, and latest substantive
   assistant turn. Among the rest, age outranks evidence shape so an old
   path, diff, or completion report cannot force protected-content overflow.
   These frontier turns are also pinned through repetition collapsing. A
   terminal `Next choice: None ... no response needed` completion suppresses
   stale file, verification, and working-tree resume tasks. Continuation hints
   come only from the latest non-acknowledgement assistant state. Resume file
   lists retain whole paths and mark omissions rather than slicing a path.
   User-origin provenance is retained separately from injected custom context,
   so policy/context messages cannot displace or masquerade as the latest human
   request. Structured `goal-ui` updates render as a compact `<goal-state>`
   block; a cleared goal removes the prior state. Omission notices remain
   display-only metadata and are never emitted as executable recall queries.
   Repeated absolute file paths may be rendered relative to an explicit
   `<path-root>` display root. The session CWD is preferred when known;
   legacy inputs may use the highest-saving absolute-path cluster instead.
   Paths outside that root remain absolute, and exact commands are never
   rewritten. Resume tasks and the resume index share one active-file
   selection so their frontier cannot drift.
2. **Hard cap** — `MAX_STRUCTURED_SUMMARY_CODE_POINTS = 65_300`
   (line 14); the cap pass drops read/modified files
   (larger list first) until fit, then fails closed rather than truncate.

List caps: read and modified files keep the newest 50 each
(lines 1711–1712) with omitted counts; recent tool calls keep the newest
20 (line 1693). File markers are provenance-labeled observations, not
Git receipts (`formatFileMarkers`, line 1797).

## Determinism

Same canonical input bytes produce a byte-identical summary, and the
same scoring, ranking, and eviction decisions. `inputDigest` hashes the
canonical input; `summaryDigest` hashes the exact wire summary including
its metric line and recall note. A summary shorter than
`MIN_USEFUL_LENGTH = 50` chars (`lib/strategy.ts:5`) fails closed.

## Tuning Status

All weights and thresholds above are hand-tuned engineering judgment,
not empirically fit parameters. The repository ships no eval harness
measuring resumption fidelity against alternative weights; treat tuning
changes as judgment calls to be reviewed, not measurements.
