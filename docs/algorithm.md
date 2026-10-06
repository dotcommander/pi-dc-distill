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
   active-branch handoff. Incremental serialization keeps mandatory metadata
   and the previous summary, then greedily selects newest fitting whole records
   within 20 MiB of UTF-8 bytes. Oversized records are skipped; the selection
   need not be a contiguous suffix. Live compilation never reads the
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

`tool_call` and completed persisted `turn_end` callbacks only sample the first
fresh post-compaction host count after assistant persistence. They do not consume
warmup, reset cooldown, decide admission, or interrupt tools. `agent_settled` is
the sole autonomous decision boundary for every band, including headroom floor
and Emergency. It refreshes host usage and validates current ownership,
settings, branch/model and concurrency guards before capturing the exact settled
leaf and requesting standard `ctx.compact()`. Ordinary Auto/Warn admission
requires a current finite positive host count. Headroom floor and Emergency
preserve the existing finite local-estimate fallback when host usage is
unavailable or invalid, and bypass ordinary admission guards. The request and
matching host commit remain separate operations. Continuing tool loops can delay
compaction until the agent naturally settles; the extension never aborts a run
for compaction. Native host compaction and genuine errors/cancellations retain
their existing paths. Unknown samples cannot establish a baseline. Ordinary
120-second cooldown and 4,000-token growth remain intact; only a matching
transactional host commit authorizes success effects and continuation.
`agent_before_settle` migration is deferred.
The before-compact hook decides **what replaces** the default summary when Pi
prepares an attempt: manual, native threshold or native overflow. Early
triggering is not required for native-summary replacement.

Normally the early boundary is `min(120000, window - reserveTokens - 20000)`;
Pi's native threshold is usage above `window - reserveTokens`. Small-window
floors can reduce the 20K lead. Ordinary warmup/cooldown/growth guards apply;
finite emergency estimates bypass them and Pi-sync, while ownership, valid
enabled settings, the in-flight attempt guard and the compiler-failure pause still apply. Pi can check or overflow before
the extension's boundary check, so this lead does not guarantee preemption.
Retained-tail `keepRecentTokens` and the 20,000-token lead are separate values.

The controller reads Pi's effective merged settings at startup, model selection,
and autonomous checks, preserving host model-override precedence. Invalid settings
block autonomy while manual deterministic interception remains available. Feature
gates remain independent default-off startup snapshots. Ordinary auto/warn
requires a current finite positive Pi usage count; earlier successful sync cannot
authorize an action after an unavailable or invalid sample. Sample-only
`tool_call` bookkeeping captures the first fresh post-compaction host count after
assistant persistence, without interrupting tools or deciding admission. Unknown
counts leave the baseline pending; raw assistant usage and `details.tokensAfter`
are not substitutes. Ordinary admission still requires the 120-second cooldown
and 4,000-token growth from an above-auto baseline. Ownership, settings/latch,
user/branch/model changes and cancellation fence autonomous submissions. Only
a matching host commit authorizes success effects and durable continuation;
`agent_before_settle` migration remains deferred. See
[settings](settings.md) for host geometry and optional features.

A non-cancelled local compiler failure during an owned autonomous attempt pauses
Mechanical admission before further settled submissions,
including urgent bands and missed-auto pursuit. Source construction, compilation
and result validation (including protected overflow) qualify; cancellation and
host, storage or reporting failures do not. Warn steering and manual `/compact`
remain available. Ordinary prompts do not clear the pause. Only a new lifecycle
generation, an actual model/context-window or valid settings change, trustworthy
navigation outside the failed anchor's lineage, or a validated newest
active-branch successful compaction clears it. Failed manual attempts, mismatched
commits, new input, invalid settings and missing branch evidence leave it intact.
The process-local pause notifies once and logs `compiler-paused`; restart follows
existing startup guards. See [lifecycle details](architecture.md#local-compiler-failure-pause).

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
2. **De-noise.** Remove explicitly typed transient messages and recognized standalone filler. Preserve mixed human instructions, quoted examples and ambiguous text; remove recognized wrapper XML while keeping its enclosed human text. Scan the full supplied tool output for decisive execution evidence before shortening previews. Preserve a bounded decisive excerpt alongside ordinary selected lines, paths and exit codes. Host-truncated bytes remain unavailable.
3. **Collect evidence.** Pair tool calls with results; extract file observations, verification, working-tree receipts, literal anchors, and task state.
4. **Score and collapse.** Rank assistant turns by content, collapse failed edit loops and procedural repetition, and synthesize low-signal runs.
5. **Build the resume frontier.** Retain recent user intent, continuation hints and bounded next tasks; live recall suggestions/queries require the opt-in. Explicit v1/v2/v3 handoffs remain task state, separate from verification; v3 requirements consult immutable observations.
6. **Apply the budget.** Remove whole records in a fixed order, rebuild the index and tasks, and record omissions.
7. **Emit.** Render structured sections and balanced markers. The live integration attaches metrics, digests, and the validated checkpoint in details before returning the result to Pi.

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

### Optional prose display cleanup

Accuracy, useful continuity, and readability take priority over compression.
The goal is to preserve obligations, decisions, evidence, and the context needed
to resume the previous session. Smaller wire output and counted repetitions are
size observations, not proof of fidelity or a complete account of that session.

Eligible conversation prose receives a separate display projection before its
preview is clipped. The original semantic turn preview remains the input to
turn scoring, selection, the resume index, and evidence handling. This changes
optional rendered text, not checkpoint declarations, pins, evidence identities,
mutation state, or task authority. Details use version 14 with checkpoint schema
v2; the exact resulting wire summary is hashed and used for host estimates.
The checkpoint pressure ladder is separate from optional prose cleanup: it drops
failure sources (T3), then unreferenced reads (T2), then shortens display excerpts
(T1), without evicting T0 identity cores, declared work, required evidence,
mutation frontier or predecessor. A 17-key `checkpointSections` ledger reports
Unicode code-point section costs and final ladder outcomes. It is observability
only, not a new scoring or authorization input; T0 overflow still cancels.

The scanner considers adjacent exact phrase runs, trying the shortest period
first, up to 16 whitespace-delimited tokens. A run needs at least three
occurrences spanning 128 Unicode code points. Tokens, intervening separators,
casing, and punctuation must match exactly. Rendering keeps one occurrence and
adds `[repeated N times]`. It does not combine paraphrases or separated repeats,
infer subjective importance, or call an LLM.

Display scanning has an independent budget: 65,536 code points per record,
262,144 code points and 32,768 tokens per compilation. A record that exceeds the
scan budget uses its ordinary preview without partial repetition replacement;
compilation-budget exhaustion leaves subsequent records on that fallback too.
These limits do not consume the semantic lexical/evidence budget. Recognized
pins, declarations, commands, code, diffs, tables, structured text, and evidence
are conservatively bypassed. Uncertain syntax keeps the ordinary preview.
Eligible background may still be shortened when it shares a turn with ordinary
prose instructions; this is not a guarantee of preserving every implied obligation.

The preview cap and recency policy are derived once from the original source
and applied unchanged to both its semantic preview and compressed display.
Shortening repeated background does not reclassify the display under a smaller
preview cap. Existing completion-report treatment is retained. Plain-prose
display text over an explicit preview cap is shown as a two-edge excerpt with a
code-point omission notice instead of a head-only clip. Other display clipping
prefers a natural whitespace boundary and an ellipsis, with a
complete-code-point fallback for unbroken text. It cannot guarantee complete sentences or preserve everything
beyond the cap. Other budget eviction still removes complete optional records.

A recent-user-intent display row can disappear only when the same uniquely
identified source occurrence has an exactly equal complete visible conversation
preview. Transient occurrence metadata supports that decision without changing
stored checkpoint schema or semantic intent strings. Evicting the conversation
row restores the intent fallback. Ambiguous, combined, referential, and protected
intent remains separate; matching clipped text alone does not prove identity.

## Evidence semantics

Read/modified file markers require successful, unambiguously paired tool results.
They are observations and reports, not current filesystem or Git proof. Failed
writes remain bounded risks. Exact runner, command bytes, and known working
directory identify verification receipts. Potential mutations fence receipts at submission and completion, including failed,
pending, overlapping and unmatched work. A fresh pass starts after prior mutations
finish, overlaps no mutation and precedes no later mutation. Mixed batches cannot
establish execution order. Missing diagnostic `isError` is incomplete, and unknown
cwd leaves scope and freshness unestablished.

Fresh or unresolved receipts retain exact commands. Stale passing/skipped
receipts may use command digests to save space. Repeated paths can be displayed
relative to an explicit `path-root`; commands are never rewritten. User-origin
intent remains distinct from injected custom context. Structured `goal-ui`
updates can provide a goal-state block; clearing a goal removes the prior state.

## Conservative shell and output analysis

The bounded shell lexer inspects supported compound-command and pipeline
segments, respecting quotes and literal escapes. A read prefix never makes later
commands read-only. Redirections, write utilities, unsafe options and unresolved
execution effects fence verification. It does not infer that conditional segments
were skipped. Substitutions, heredocs, grouping, scripts, functions and `eval`
remain unknown effects; this is not a full POSIX parser.

Verification scans all supplied output before preview shortening. Structured host
errors and recognized runner-specific terminal failures outrank success footers.
A passing test description containing “FAIL” is not itself an execution failure;
expected-negative output is not blanket-suppressed. The decisive excerpt keeps
at most 300 Unicode code points, putting the failure marker first, neighboring
lines where space permits and an omission indicator when shortened. Strict
call/result pairing and exact receipt identity remain necessary. Ambiguous
pairing, missing status/cwd and unavailable host-truncated bytes cannot establish
a fresh pass.

## Transcript-derived change impact

`<change-impact>` provides advisory rerun priorities from supplied transcript
observations. Exact test-command paths intersecting modified paths rank first;
then successful supplied test-file reads with explicit relative imports and
extensions resolving lexically to modified paths. Hints retain exact runner,
command and cwd identity, full lexical paths and source observation IDs.
There are no filesystem reads, extension probes, package resolution or inferred
complete dependency graph. These hints do not preserve passes across mutations
or change freshness, scope, failure or incomplete decisions. Unknown mutations
retain broad uncertainty.

## Observed handoff readiness

Strict `distill-handoff-v3` retains v2 fields, adds up to 32 top-level
`preconditions`, and requires task-level `requires` lists (empty is allowed).
Predicates are `file-read-succeeded` with `id`, `path`, `cwd`, or
`verification-pass` with `id`, `runner`, `command`, `cwd`. IDs and references are
validated; cwd must be known and absolute, commands retain exact bytes, raw
runner identities must be compatible and paths follow existing lexical rules.

Before display shortening, an immutable observation snapshot evaluates each
predicate as `satisfied`, `contradicted` or `unknown`. A fresh uniquely paired
successful read or exact verification pass can satisfy it; a fresh matching
failure can contradict it. Stale, missing, incomplete, pending, overlapping or
uncertain evidence is unknown. Historical creation does not establish a read
or current existence. The intact DAG determines graph readiness. Pending tasks
enter `<ready-tasks>` only when dependencies are done and every requirement is
satisfied; graph-ready tasks with unknown or contradicted requirements appear
in `<graph-ready-tasks>` separately. No task is executed or stored status changed.
V1/v2 semantics remain compatible. The complete bounded projection stays within
3,072 code points, with 512-code-point field excerpts, balanced markers,
omission counts and complete retained references.

## Summary organization

Every summary opens with a fixed one-line scope note: it covers only the
entries Pi discarded at compaction, and newer state lives in the retained
messages that follow it in context. The note is static — no timestamp, so
identical input still compiles byte-identically — and its cost is charged to
the summary budget in both the measure and wire passes. Complete sections then
place stable supplied identity first, then goal/focus,
conversation and prior context; file/tool/working-tree evidence; anchors and
resume index; recovery and omissions; change-impact advice and verification;
the complete handoff projection; resume risks; resume tasks. Version 13 omits
the model-facing metric line; telemetry stays in details and committed notifications. Only exact compatible records are deduplicated; a
generated task is suppressed only for the same explicit structured task ID.
A digest-authenticated `<request-candidate-v1>` marker follows the checkpoint
projection: the latest native user request restated as attributed context
only — never declared work, pins, or authorization — with source identity, a
request of at most 2,048 code points, an optional proposal of at most 512, and
the whole marker, framing and escaping included, within 4,096 code points.
Offline
section-position checks cover this organization. Pi retains messages
after the summary, so risks are not the absolute end of the model prompt. This
ordering establishes neither improved attention nor prompt-cache gains.

Remaining losses include subjective intent that lexical heuristics miss,
images represented as MIME placeholders, budget eviction and omissions
accumulated in previous summaries. Focus and handoffs do not guarantee full
fidelity.

## Budget and bounds

`TARGET_RESUME_SUMMARY_CODE_POINTS` is **8,192**. The budget loop leaves 1,024
code points of headroom and drops complete records in this order:

1. Recent tool results, source anchors, literal anchors, and recent tool calls.
2. Stale verification receipts, meaning passes whose freshness is not established.
3. Conversation turns, read files, and modified files.
4. Older working-tree rows and unprotected verification receipts, retaining
   required, failed, and pending receipts and at least one row.
5. Retained-context excerpts, then the request-candidate proposal and marker.

When multiple conversation turns remain but all are protected, excess active
tasks can also be removed after the other evidence lists are exhausted.

The resume index and next tasks rebuild after each drop, and
`summary-omissions` records removal counts. Conversation eviction protects the
latest human request, latest assistant turn, and latest substantive assistant
turn. Explicit state and risks receive priority; if protected content cannot
fit within the safety ceiling, compilation fails rather than slicing structure.

The structured compiler and the wire summary share one hard cap of
65,536 code points, and no metric prefix is added to the wire text. The hard-cap pass drops read/modified
paths, larger list first, then fails closed if necessary. File lists retain at
most 50 newest paths each and recent tool calls at most 20. Omitted paths are
counted, not sliced into misleading partial paths.

## Optional coverage selector and adoption

Version 12 uses deterministic baseline selection after coverage failed the
ordinary-workload performance gate. `runStrategies()` remains single-strategy;
coverage remains available through the offline evaluator.
Procedural conversation reduction and protected overflow handling are unchanged.

The pure candidate selector uses monotone weighted coverage: frontier technical
features weight 4, evidence categories 2 and distinct transcript path identities
1. Repeated features add no gain. Greedy marginal gain divided by rendered cost
breaks ties by higher gain, lower cost, newer source sequence and stable ID.
These are engineering choices, with no knapsack approximation claim and no
embeddings, training or new dependencies. Structural priority, frontier relevance
and recency prefilter at most 32 candidates per kind, 256 total and 128 features
per candidate. Kinds are conversation, retained context, calls, results, file
observations, working-tree observations, anchors and stale verification.

Complete rendering accounts for escaping, headings and omission notices within
the 8,192-code-point target and existing reserve; whole optional records are
removed and omissions reported. Protected records, balanced markers and the hard
ceiling remain enforced. Adoption requires the sealed 12-source/48-comparison
oracle with mandatory and safety assertions, three identical repeats, no
individual optional-recall regression and at least 5 percentage points aggregate
pressure improvement. Separate semantic performance comparison uses the four
sealed workloads, identical runtime/options, 10 warmups and 30 sequential samples:
p50/p95 must stay within `max(baseline × 1.10, baseline + 1 ms)` and peak RSS within
baseline plus 8 MiB. Missing or failed gates retain the baseline default and the
candidate as an offline experiment. Offline results do not establish installed Pi
behavior or model resumption quality, attention improvements or cache hits.

### Version 11 adoption decision

The final sealed quality run passed all 48 comparisons with three byte-identical
repeats, every mandatory/safety assertion and no individual optional-fact recall
regression. Across the designated pressure subset, recall increased from 12/24
to 20/24 facts, an improvement of 33.33 percentage points.

The final semantic performance run passed all 12 metrics across four sealed
workloads, with 10 warmups and 30 sequential samples per workload on Bun 1.4.0,
darwin arm64. Measurements are specific to that runtime and sealed corpus:

| Workload | Baseline p50 / p95 (ms) | Coverage p50 / p95 (ms) | Baseline / coverage peak RSS (bytes) |
| --- | ---: | ---: | ---: |
| Ordinary | 1.00 / 2.14 | 1.73 / 3.11 | 59,490,304 / 65,978,368 |
| Many-records | 1498.81 / 1509.17 | 1511.41 / 1524.69 | 1,073,414,144 / 1,058,734,080 |
| Oversized | 5.32 / 8.06 | 5.28 / 8.19 | 393,199,616 / 359,759,872 |
| Pressure | 3.57 / 4.94 | 3.21 / 4.64 | 87,408,640 / 86,589,440 |

The ordinary workload's RSS ceiling was 67,878,912 bytes; every workload met
baseline plus 8 MiB and both timing limits. Exact numeric trial-rendering costs
and shared candidate caps reduce allocation while preserving complete rendered
budgets. A separate parity receipt passed all 52 full candidate comparisons
before and after the wire boundary.

That version-11 decision adopted coverage. Version 12 restores baseline production
selection: its coverage ordinary-workload p95 was 3.292 ms against the sealed
3.039958 ms limit (baseline 2.039958 ms). The other three workloads passed.
Coverage remains available offline; workloads, thresholds, and oracles are unchanged.
This local receipt does not establish installed Pi or provider behavior.
The historical version-11 final gate used unchanged source identity
`bda964f611f1892ba7abb024024165d25dd13557fdf535c2aecc27b076ec23f9`.
Earlier failed performance receipts are preserved as historical evidence, not
current acceptance. An earlier report affected by a transient source edit was
invalidated. The scripts retain raw samples and runtime identity.
Reproduce quality and the separate semantic performance comparison with a fresh
artifact directory and unique labels:

```bash
bun scripts/evaluate-selector.ts /absolute/path/to/artifacts quality-v11
bun scripts/benchmark-compiler.ts --semantic /absolute/path/to/artifacts semantic-v11
```

These historical offline gates do not establish installed Pi behavior or model
resumption quality. Their recorded checks describe that version-11 phase only;
current verification uses the commands documented in the README and the
checkpoint gate in [Compiler benchmarks](compiler-benchmark.md).

## Determinism and evaluation

Identical canonical input, focus and compiler feature options produce identical
compiler decisions and summary text. The live wire metrics also depend on Pi's prepared branch and
token estimates. `inputDigest` hashes canonical input, and `summaryDigest`
hashes the exact returned wire summary. The strategy rejects summaries shorter
than 50 string units as unusable.

The offline quality evaluator checks synthetic required and forbidden facts,
evidence handling, optional recall, and deterministic output. Checkpoint oracles
also check declared task status, exact pin text and attribution, decisions, and
verification identities across controlled compaction cycles. Those checks
support fidelity for their covered cases; they do not establish comprehensive
session understanding or preservation of every important contextual detail.
Compression ratios cannot substitute for these checks or for inspecting whether
the summary remains useful for continuing the actual work.

Weights are engineering judgment, not fitted measurements of resumption
quality. The repository includes regression/fidelity tests and a
[historical replay CLI](usage.md#replay-a-past-session); replay comparison alone
does not establish semantic equivalence or optimal weights.

## What the sizes and metrics mean

- **Bytes:** the README comparison measures UTF-8 serialized JSONL before and
  summary text after. Its 67.4% reduction is specific to that fixture.
- **Unicode code points:** the 8,192 target and 65,536 wire ceiling bound text
  structure, not model tokens. Some turn/preview limits use JavaScript string
  units instead.
- **Estimated tokens:** live `tokensAfter` estimates Pi's prospective rebuilt
  message context, including retained messages; `summaryTokens` estimates the
  summary alone. Neither measures the full provider prompt's system/tool
  envelope. Details report `tokensBefore` from Pi's `preparation.tokensBefore`
  context estimate and derive `reductionPct` from that estimate and rebuilt
  `tokensAfter`. The preparation estimate can incorporate API usage plus
  estimated trailing messages. Post-commit context usage is sampled separately
  when available. Version 13 computes one prospective estimate and adds no
  metric line to the summary.
- **Reported API usage:** provider usage remains supplementary telemetry in
  `apiTokensBefore`; it does not add an `API before` annotation to the wire
  summary. Token telemetry remains in details and committed notifications.

No reduction establishes semantic equivalence, measured monetary savings or
guaranteed context capacity for the next request.
