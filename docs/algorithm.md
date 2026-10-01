# pi-dc-distill Algorithm

[README](../README.md) · [Architecture](architecture.md) · [Usage](usage.md)

The Mechanical compiler in [local-compact.ts](../lib/local-compact.ts) turns
canonical compaction input into a bounded resume summary. It uses hand-tuned
scoring, repetition collapse, and priority eviction. Nothing is trained or
sampled, and no provider request is made.

## What happens to a long session?

Think of the result as a smaller resume packet plus the recent conversation
that Pi keeps. This compiler recognizes explicit structure and text patterns;
it does not infer all the meaning of a conversation.

1. **Pi chooses the cut.** On `/compact` or a native automatic attempt, Pi
   prepares discarded messages and keeps a recent tail according to its policy,
   including `keepRecentTokens`. The extension does not select a second cut or
   re-summarize that retained tail.
2. **dc-distill compiles the discarded portion.**
   [compaction-source.ts](../lib/compaction-source.ts) supplies the previous
   summary, discarded messages, discarded split-turn prefix and latest eligible
   active-branch handoff. Oversized input keeps metadata, previous summary and
   newest complete records within 20 MiB. Live compilation never reads the
   append-only session file or includes abandoned branches.
3. **The compiler builds resume text.** It extracts recognizable intent,
   explicit handoff state, paired tool/file observations and verification,
   collapses repetition, and drops whole optional records to fit its budget.
   Capturing a path or test command is not independent file inspection or
   execution of that command.
4. **Pi uses that result instead of its LLM summary.** The
   `session_before_compact` hook returns custom compaction. In verified Pi
   0.99.2, the host uses this result in one branch and calls its default LLM
   summarizer only in the alternative branch. Pi appends its native compaction
   entry and rebuilds context from resume text plus retained tail. Its native
   card does not indicate another summary call.

For example, a parser transcript can yield an objective, file observations,
historical test receipt and next action while dropping repetitive source output.
This does not guarantee every important nuance survives. The
[synthetic comparison](../README.md#try-a-repeatable-comparison) tests specific
retained fields, not general semantic equivalence.

## Triggering is separate from interception

The early monitor decides **when to request** compaction after `agent_settled`.
The before-compact hook decides **what replaces** the default summary when Pi
prepares an attempt: manual, native threshold or native overflow. Early
triggering is not required for native-summary replacement.

Normally the early boundary is `min(120000, window - reserveTokens - 20000)`;
Pi's native threshold is usage above `window - reserveTokens`. Small-window
floors and warmup/cooldown/growth guards apply. Pi can check or overflow before
the extension's idle check, so this lead does not guarantee preemption.
Retained-tail `keepRecentTokens` and the 20,000-token lead are separate values.

The existing early-trigger reader snapshots conventional global/project
settings at startup; it ignores Pi's relocated global agent directory and
per-model overrides. See [settings](settings.md) before assuming identical host
boundaries. The optional-feature reader does honor `PI_CODING_AGENT_DIR`.

Real Pi RPC tests observed one dc-distill compaction and zero summary-provider
calls for manual, native threshold and successful-response overflow paths.
Interrupted-error and length-stop retry paths remain untested. This assumes the
extension is loaded and returns a result or cancellation; other extensions and
Pi's separate branch-summary feature are outside that claim.

## Core compaction and optional features

Core compilation works with both optional features off, their defaults.
`toolOutput.enabled` separately enables persistent full-output artifacts and
previews. `recall.enabled` enables summary storage/search, additional focus echo
and live recall suggestions. Neither is required to replace native LLM
summarization. Existing data is preserved; whole-source legacy migration waits
until both opt-ins are on. See the exact
[feature settings](settings.md#optional-feature-settings).

Tool-output previews and internal compiler compression are separate stages.
Disabling previews leaves live tool results untouched; later compaction still
compresses discarded tool text inside the compiler.

## Pipeline

1. **Normalize.** Parse typed records, strip ANSI/control characters, retain session metadata and eligible explicit state. Malformed diagnostic records fail closed.
2. **De-noise.** Remove thinking, low-value tool chatter, harness noise, and known wrapper XML. Compress tool results to selected leading/final lines, paths and parsed exit codes; explicit error lines receive additional preservation when the result is flagged `isError`.
3. **Collect evidence.** Pair tool calls with results; extract file observations, verification, working-tree receipts, literal anchors, and task state.
4. **Score and collapse.** Rank assistant turns by content, collapse failed edit loops and procedural repetition, and synthesize low-signal runs.
5. **Build the resume frontier.** Retain recent user intent, continuation hints and bounded next tasks; live recall suggestions/queries require the opt-in. Explicit v1/v2 handoffs remain task state, separate from verification.
6. **Apply the budget.** Remove whole records in a fixed order, rebuild the index and tasks, and record omissions.
7. **Emit.** Render structured sections and balanced markers. The live integration adds reduction metrics and digests before returning the result to Pi.

The live input comes from Pi's discarded preparation and active branch, as
specified in [architecture](architecture.md#authoritative-source). Session-file
helpers are diagnostic interfaces, not a second live input source.

## Turn scoring

`extractSignals`, `signalScore`, and `isSubstantive` define the rubric:

| Signal | Points |
| --- | ---: |
| Diff lines or hunk markers | +5 |
| Code fence | +4 |
| Table | +4 |
| Error diagnostics | +4 |
| Architecture vocabulary | +3 |
| Heading or numbered list | +2 |
| At least five non-empty lines or 800 characters | +2 |
| File path | +1 |
| Filler opener | −2 |
| Short status with no code, diff, table, or path | −2 |
| Pure acknowledgment | −5 |

A score of at least 3 is substantive. Signal-aware turn limits keep up to 2,000
string units for diffs/tables, 1,000 for headings/long form, and 500 otherwise.
Recency scales eligible turns: the newest five keep the full limit, turns 6–20
keep half, and older turns keep one quarter. Evidence-bearing failures, diffs,
file paths, completion reports, and explicit state/artifact signals are exempt
from that recency reduction; they can still be removed by budget eviction.

## Repetition and recall

`collapseEditLoops` folds three or more attempts on the same tool/target with
at least two failures into a loop marker. It preserves the most recent successful
attempt. `collapseDenseRepetition` folds low-signal turns when at least six occur
in a ten-turn window. `compactAssistantTurns` synthesizes procedural runs of
three or more turns while retaining correction context.

`recallSeedSalience` favors identifiers, digits, path separators, and longer
terms, and penalizes very short terms and stopword prefixes. Recency breaks ties;
the top five seeds become recall queries when live recall is enabled (diagnostic APIs retain their compatibility defaults). `buildResumeTasks` produces at most
four next actions, including active-file inspection, unresolved verification,
recall, and working-tree inspection when appropriate. A latest terminal
completion suppresses stale resume work.

## Evidence semantics

Read/modified file markers require successful, unambiguously paired tool results.
They are observations and reports, not current filesystem or Git proof. Failed
writes remain bounded risks. Exact runner, command bytes, and known working
directory identify verification receipts. The compiler attempts to stale older
passes after potentially modifying work; the known classification limitation
below means this is not a universal freshness guarantee.

Fresh or unresolved receipts retain exact commands. Stale passing/skipped
receipts may use command digests to save space. Repeated paths can be displayed
relative to an explicit `path-root`; commands are never rewritten. User-origin
intent remains distinct from injected custom context. Structured `goal-ui`
updates can provide a goal-state block; clearing a goal removes the prior state.

## Known fidelity risks

Two source-audit probes reproduce current verification defects. These are
**not fixed**:

- **Middle failure evidence can disappear.** Tool text is compressed before
  verification extraction. With `isError: false`, a short `3 pass` / `FAIL hidden
  middle failure` / `Ran 4 tests across 1 file.` result yields FAIL. Adding long
  neutral progress lines around the middle failure lets compression omit it,
  and the receipt becomes PASS. Successful tool execution does not prove all
  checks in its output passed.
- **Compound shell commands can hide later mutation.** The read-only classifier
  matches prefixes. After a passing test, a successful recorded
  `cat src/parser.ts; printf changed > src/parser.ts` leaves its PASS fresh,
  while `printf changed > src/parser.ts` alone marks it stale. A leading read
  command does not make the entire shell expression read-only.

These probes compiled synthetic transcript strings; no embedded commands were
executed. Treat markers as historical compiler output, especially for long
results or compound shell work. Consult original evidence and rerun relevant
checks when current correctness matters.

Other losses are inherent: heuristics can miss subjective intent; images become
MIME placeholders; budgets evict evidence; previous summaries carry accumulated
omissions. Handoffs and focus hints help identify priorities without guaranteeing
full fidelity.

## Budget and bounds

`TARGET_RESUME_SUMMARY_CODE_POINTS` is **8,192**. The budget loop leaves 1,024
code points of headroom and drops complete records in this order:

1. Recent tool results, source anchors, literal anchors, and recent tool calls.
2. Stale verification receipts.
3. Conversation turns, read files, and modified files.
4. Older working-tree and verification receipts, retaining at least one of each.

When multiple conversation turns remain but all are protected, excess active
tasks can also be removed after the other evidence lists are exhausted.

The resume index and next tasks rebuild after each drop, and
`summary-omissions` records removal counts. Conversation eviction protects the
latest human request, latest assistant turn, and latest substantive assistant
turn. Explicit state and risks receive priority; if protected content cannot
fit within the safety ceiling, compilation fails rather than slicing structure.

The structured compiler cap is 65,300 code points; the live wire ceiling,
including its metric prefix, is 65,536. The hard-cap pass drops read/modified
paths, larger list first, then fails closed if necessary. File lists retain at
most 50 newest paths each and recent tool calls at most 20. Omitted paths are
counted, not sliced into misleading partial paths.

## Determinism and evaluation

Identical canonical input, focus and compiler feature options produce identical
compiler decisions and summary text. The live wire metrics also depend on Pi's prepared branch and
token estimates. `inputDigest` hashes canonical input, and `summaryDigest`
hashes the exact returned wire summary. The strategy rejects summaries shorter
than 50 string units as unusable.

Weights are engineering judgment, not fitted measurements of resumption
quality. The repository includes regression/fidelity tests and a
[historical replay CLI](usage.md#replay-a-past-session); replay comparison alone
does not establish semantic equivalence or optimal weights.

## What the sizes and metrics mean

- **Bytes:** the README comparison measures UTF-8 serialized JSONL before and
  summary text after. Its 75.4% reduction is specific to that fixture.
- **Unicode code points:** the 8,192 target and 65,536 wire ceiling bound text
  structure, not model tokens. Some turn/preview limits use JavaScript string
  units instead.
- **Estimated tokens:** live `tokensAfter` estimates Pi's prospective rebuilt
  message context, including retained messages; `summaryTokens` estimates the
  summary alone. Neither measures the full provider prompt's system/tool
  envelope. Post-commit context usage is sampled separately when available.
- **Reported API usage:** provider usage is separate from compiler estimates.
  Currently the metric line can display API before-tokens while computing
  reduction from estimate-before tokens; its percentage may disagree with the
  displayed pair. This known metric mismatch is not fixed here.

No reduction establishes semantic equivalence, measured monetary savings or
guaranteed context capacity for the next request.
