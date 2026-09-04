# pi-dc-distill Algorithm

[README](../README.md) · [Architecture](architecture.md) · [Usage](usage.md)

The Mechanical compiler in [local-compact.ts](../lib/local-compact.ts) turns
canonical compaction input into a bounded resume summary. It uses hand-tuned
scoring, repetition collapse, and priority eviction. Nothing is trained or
sampled, and no provider request is made.

## Pipeline

1. **Normalize.** Parse typed records, strip ANSI/control characters, retain session metadata and eligible explicit state. Malformed diagnostic records fail closed.
2. **De-noise.** Remove thinking, low-value tool chatter, harness noise, and known wrapper XML. Compress ordinary tool results to leading lines; errors retain leading and trailing diagnostics with parsed exit codes.
3. **Collect evidence.** Pair tool calls with results; extract file observations, verification, working-tree receipts, literal anchors, and task state.
4. **Score and collapse.** Rank assistant turns by content, collapse failed edit loops and procedural repetition, and synthesize low-signal runs.
5. **Build the resume frontier.** Retain recent user intent, continuation hints, recall queries, and bounded next tasks. Explicit v1/v2 handoffs remain task state, separate from verification.
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
the top five seeds become recall queries. `buildResumeTasks` produces at most
four next actions, including active-file inspection, unresolved verification,
recall, and working-tree inspection when appropriate. A latest terminal
completion suppresses stale resume work.

## Evidence semantics

Read/modified file markers require successful, unambiguously paired tool results.
They are observations and reports, not current filesystem or Git proof. Failed
writes remain bounded risks. Exact runner, command bytes, and known working
directory identify verification receipts; later potentially modifying work
makes prior results historically useful without claiming freshness.

Fresh or unresolved receipts retain exact commands. Stale passing/skipped
receipts may use command digests to save space. Repeated paths can be displayed
relative to an explicit `path-root`; commands are never rewritten. User-origin
intent remains distinct from injected custom context. Structured `goal-ui`
updates can provide a goal-state block; clearing a goal removes the prior state.

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

Identical canonical input and focus produce identical compiler decisions and
summary text. The live wire metrics also depend on Pi's prepared branch and
token estimates. `inputDigest` hashes canonical input, and `summaryDigest`
hashes the exact returned wire summary. The strategy rejects summaries shorter
than 50 string units as unusable.

Weights are engineering judgment, not fitted measurements of resumption
quality. The repository includes regression/fidelity tests and a
[historical replay CLI](usage.md#replay-a-past-session); replay comparison alone
does not establish semantic equivalence or optimal weights.
