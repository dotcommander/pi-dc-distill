# Isolated real-Pi RPC acceptance

Run from the repository after all implementation edits and dependency setup.
Each scenario uses its own HOME, agent directory, session directory, and project.
The scripted provider runs locally, traces every request, and makes no API calls.
The autonomous scenario seeds a genuine manual compaction and restarts to verify
the production 120-second cooldown restored from its journal timestamp. A
trustworthy branch without any prior compaction can skip the synthetic startup
cooldown after warmup; this fixture does not assume that every startup waits.
Current successful compactions require details v14 and a structurally validated
schema-v2 checkpoint, its canonical digest, the exact wire-summary digest, and
an exact derived 17-section `checkpointSections` ledger. The shared acceptance
assertion has focused negative fixtures for historical versions, malformed state,
wrong digests, and missing/corrupt/extra telemetry (`bun test ./tests/e2e/current-compaction.test.ts`).

Select each already installed reviewed host explicitly. Package selection reads
the manifest, checks the exact version, and invokes its declared CLI with Node;
it does not install, replace, or change the global Pi runtime.

```sh
DISTILL_PI_PACKAGE="$PWD/node_modules/@earendil-works/pi-coding-agent" DISTILL_PI_EXPECT_VERSION=0.99.2 bun run distill:e2e
DISTILL_PI_PACKAGE="/Users/vampire/.bun/install/global/node_modules/@earendil-works/pi-coding-agent" DISTILL_PI_EXPECT_VERSION=1.0.0 bun run distill:e2e
```

For another installation, provide its package root and the reviewed exact version.
`DISTILL_PI_NODE` selects the Node executable. `DISTILL_PI_EXECUTABLE` selects a
standalone CLI when no package root is supplied; it provides no version assertion.
The selected host identity is written to each RPC transcript.
For verification without touching the user cache, also isolate the parent profile
before invoking the harness (child HOME/agent/session/project isolation is automatic):

```sh
sandbox=$(mktemp -d /tmp/dc-distill-acceptance.XXXXXX)
PI_CODING_AGENT_DIR="$sandbox/agent" DISTILL_PI_PACKAGE="$PWD/node_modules/@earendil-works/pi-coding-agent" DISTILL_PI_EXPECT_VERSION=0.99.2 bun run distill:e2e
```

Use the same parent-profile isolation for `bun run distill:demo`.

## Focused turn-boundary timing gate

Run the opt-in `tests/e2e/turn-boundary.e2e.ts` fixture separately from
`distill:e2e`, with the parent profile isolated as well as the harness's
child HOME, agent, session and project directories:

```sh
sandbox=$(mktemp -d /tmp/dc-distill-turn-boundary.XXXXXX)
PI_CODING_AGENT_DIR="$sandbox/agent" DISTILL_PI_PACKAGE="$PWD/node_modules/@earendil-works/pi-coding-agent" DISTILL_PI_EXPECT_VERSION=0.99.2 bun test ./tests/e2e/turn-boundary.e2e.ts
PI_CODING_AGENT_DIR="$sandbox/agent" DISTILL_PI_PACKAGE="/Users/vampire/.bun/install/global/node_modules/@earendil-works/pi-coding-agent" DISTILL_PI_EXPECT_VERSION=1.0.4 bun test ./tests/e2e/turn-boundary.e2e.ts
```

The fixture emits four successful sibling read batches at 130,000, 135,000,
140,000 and 145,000 tokens, then a successful final response at exactly 150,000.
All eight results and that final response must precede the compaction submission.
`tool_call` and completed `turn_end` callbacks sample only; `agent_settled` is the
sole autonomous admission boundary for every band. The trace must contain no
extension abort, already-aborted provider stream or synthetic error/aborted
assistant. A successful scenario requires exactly one authenticated autonomous
v14/schema-v2 commit and one matching durable continuation after the seeded
manual commit. No pre-commit success artifacts, orphan tool pairs, duplicate
continuation or summarizer requests are allowed. Explicit RPC cancellation and
genuine user supersession still produce no stale commit or continuation.
Continuing tool loops can delay compaction until natural settlement.

A persistent invalid-predecessor preparation fault first establishes an
extension-owned compiler failure below the native trigger through the real host.
The source rejects the changed predecessor as `inconsistent_projection` before
Unicode validation; this runtime scenario does not claim Unicode-code coverage.
Later ordinary user prompts at genuine urgent
usage must settle without another extension abort or automatic submission, without
a success log, compaction or continuation. Manual compaction remains available;
a failed manual attempt and failed native threshold preparations keep the pause.
One validated manual v14/schema-v2 commit restores automatic admission after the
ordinary cooldown. At urgent-first usage the host can start native threshold
preparation before `agent_settled`; that unowned initiating failure cannot establish
the extension's pause. The fixture therefore establishes failure ownership first
and then tests urgent admission suppression.
The trace distinguishes extension abort/submission from native RPC requests and
records fresh usage samples and leaf identities. All providers are local scripted
fixtures; these scenarios neither install nor activate an extension.

Unknown samples must not establish a baseline. Production 120-second cooldown,
4,000-token repeat growth, owner/settings/latch and branch/model fences remain
intact; sample-only callbacks must not consume warmup. Scripted
runtime receipts on both hosts are required: historical suite receipts are not
blanket evidence for this path. These commands are documented, not run; no passing
check is claimed. The checkout fix does not update installed npm 0.1.6, activate
it, or authorize a release. Selecting an installed Pi host here only reads and
runs that host in the sandbox.

## Separate interactive native-card gate

Launch the reusable scripted TUI entry point from a PTY after all edits. It seeds
three low-usage replies and one real manual compaction through RPC, then reopens
that session interactively on the exact selected host. The test clock advances
121 seconds; three printed low-usage prompts let the restarted runtime warm up
before `RUN_BOUNDARY_BATCHES`. The provider remains entirely local.

```sh
sandbox=$(mktemp -d /tmp/dc-distill-settlement-tui.XXXXXX)
PI_CODING_AGENT_DIR="$sandbox/agent" DISTILL_PI_PACKAGE="$PWD/node_modules/@earendil-works/pi-coding-agent" DISTILL_PI_EXPECT_VERSION=0.99.2 bun run tests/e2e/turn-boundary-tui.ts
PI_CODING_AGENT_DIR="$sandbox/agent" DISTILL_PI_PACKAGE="/Users/vampire/.bun/install/global/node_modules/@earendil-works/pi-coding-agent" DISTILL_PI_EXPECT_VERSION=1.0.4 bun run tests/e2e/turn-boundary-tui.ts
```

A verifier can submit the printed prompts through the PTY, waiting for each reply.
Capture the native successful compaction card and terminal text/screens: routine
autonomous compaction must show no red abort row. Inspect the preserved provider
trace, boundary trace and session journal to confirm all four batches, eight
successful results and the 150,000-token final response precede exactly one new
authenticated autonomous commit and its continuation, with zero extension aborts
and zero synthetic error/aborted assistant records. The seeded manual card is
separate. RPC receipts do not prove rendered TUI behavior; launcher exit status
does not prove acceptance. `interactive-instructions.json` records host, paths
and exact prompts. Ctrl+C stops the interactive child; artifacts remain. Relaunch
the command to create a fresh isolated scenario. No release, installation or
activation is performed.

Preparation faults are injected by a sandbox-only extension preceding dc-distill.
They alter previous-summary agreement, discarded-partition agreement, or decoded
Unicode. The host must report failed compaction, append no compaction or success
log, issue no default summarizer request, and accept a subsequent user prompt.

Restart fixtures distinguish durable intent, delivery, and resulting assistant
work. They model crashes before delivery and after delivery but before an answer.
Later genuine user entries and manual or foreign compactions suppress the old
intent in either position. These journal fixtures cannot establish crash-atomic
delivery across the uncertain interval between host acceptance and durable
acknowledgement; they verify the documented journal-driven restart guarantee.

## Manual lifecycle demonstration

Use the same explicit host selection for the manual demo:

```sh
DISTILL_PI_PACKAGE="$PWD/node_modules/@earendil-works/pi-coding-agent" DISTILL_PI_EXPECT_VERSION=0.99.2 bun run distill:demo
DISTILL_PI_PACKAGE="/Users/vampire/.bun/install/global/node_modules/@earendil-works/pi-coding-agent" DISTILL_PI_EXPECT_VERSION=1.0.0 bun run distill:demo
```

The demo drives native RPC manual compaction, retains the before/after session
ledgers, RPC transcript, and scripted-provider trace in its printed artifact
directory, and checks one v14/schema-v2 dc-distill commit with exact digests and section
telemetry, without autonomous continuation or provider summarization. Native user
text keeps its exact request clause and original repetition excerpt with an
explicit source-omission marker; counted-repetition rewriting is not required
for native user sources. This is scripted real-host evidence; it does not test
paid-provider acceptance, visual card rendering, or exactly-once recovery across
the uncertain persistence interval.
