# Isolated real-Pi acceptance

`bun run distill:e2e` runs the surviving manual lifecycle and native interception
programs against an already installed Pi CLI. Every scenario creates its own
project, HOME, agent directory and session directory beneath the operating
system temporary directory. The RPC child receives only basic process settings
and the explicit sandbox settings; provider credentials are not inherited.
The local scripted provider traces every invocation and never makes an API call.
Printed artifact directories, RPC transcripts, provider traces, session journals
and `result.json` receipts remain available for inspection. No user profile,
stored data or existing session is modified.

Select a particular installed package and expected host version:

```sh
DISTILL_PI_PACKAGE="$PWD/node_modules/@earendil-works/pi-coding-agent" DISTILL_PI_EXPECT_VERSION=0.99.2 bun run distill:e2e
```

The harness loads the checkout's `index.ts` by default. Set the harness-only
`DISTILL_EXTENSION_PATH` to test an extracted package's actual entrypoint:

```sh
DISTILL_EXTENSION_PATH=/absolute/scratch/package/index.ts DISTILL_PI_PACKAGE="$PWD/node_modules/@earendil-works/pi-coding-agent" DISTILL_PI_EXPECT_VERSION=0.99.2 bun run distill:e2e
```

Create a real scratch tarball with `npm pack --pack-destination <scratch>`, inspect
its file list, and extract it before this invocation. The extracted package may
use a scratch `node_modules` symlink to this checkout's already installed local
peers; do not install new dependencies or substitute checkout source files.
The provider and fault extensions continue to come from the harness checkout.
`DISTILL_EXTENSION_PATH` changes only the test launcher, not production behavior.

For another installation, supply its package root and actual manifest version.
`DISTILL_PI_NODE` selects Node. Without a package root,
`DISTILL_PI_EXECUTABLE` selects the CLI (default `pi`), without a manifest-version
assertion. Selection reads the installed manifest and invokes the declared CLI;
it does not install, replace, activate or publish anything. Each transcript
records the selected host identity.

The manual scenario checks native custom instructions as focus, one exact host
append, repeated compaction with flat predecessor carry, current/prior attribution,
no provider summarization, and no extension commands, continuation or storage.
The interception scenarios check native threshold, overflow and overflow-error
retry requests. Preparation faults preceding dc-distill exercise its cancellation
boundary: no default summarizer request, no append, no durable extension artifact,
and a subsequent usable native prompt. The getter faults use Pi's actual shared extension-runner context to throw on
model, model context-window, session-manager and preparation reads. Each getter
restores its original descriptor before throwing, so the follow-up prompt checks
host recovery without leaving a poisoned context or model. The provider summary
spy reads normalized SDK system messages and traces every request.

The lifecycle suite exercises cancelled and failed switch/fork boundaries,
successful replacement, and legitimate new/fork sessions whose journal headers
contain `parentSession`. Each scenario requires exactly one deterministic append,
zero provider summary requests, and successful subsequent prompting. Synthetic
foreign starts, closed old runtimes and reload ownership are covered at the
runtime unit boundary; RPC acceptance does not synthesize host provenance or
claim those synthetic events occurred in the installed runner.

An owned extension instance rejects foreign sessions. Known child launchers
must disable extensions. `parentSession` is not child provenance: legitimate
user forks also carry it. Independently launched children that explicitly load
the extension remain unsupported without host provenance.

A deliberately small model window checks
that an oversized retained tail cancels when mandatory rebuilt context cannot fit.

The acceptance oracle has no production imports. It independently checks the
fixed text format and notice, bounded Unicode observations, file/command bounds,
omission counters, exact wire digest and minimal unversioned details. Its negative
fixtures run in `bun test`; they reject numbered fields, checkpoint state,
corrupt authenticated shapes and impossible known capacity.

These are scripted installed-host receipts. Fixture checks alone do not prove
installed-host behavior. They do not establish paid-provider behavior or rendered
native compaction-card behavior. Runtime results must be reported for the
actual host selected. Historical autonomous, continuation, checkpoint, timing,
TUI and demo programs are retired and are not acceptance evidence.

The simplified extension requires fresh sessions. Existing incompatible sessions
should use the old extension to finish those sessions. Predecessor admission itself is opportunistic: only verified
current-format summaries carry structured state; every other summary becomes
bounded attributed text, and active legacy handoffs contribute no messages.
These programs neither migrate nor delete historical data.

## Identical-summary journal regression

The lifecycle suite seeds a real compaction, keeps it as an abandoned journal
sibling, and reopens the original conversation branch with an inert custom leaf.
Repeating the same native compaction instructions produces byte-identical summary
bytes with a distinct new journal entry. The independent journal/summary oracle
identifies the newly appended active entry by its journal ID and parent ancestry,
checks its details and summary digest, and requires exactly one new current-contract
active commit. Historical callback identity or summary equality is not an oracle
for the active commit.

The extension has no post-commit observer, notification receipt, or notification
invocation. Pi's native compaction card is the sole success display. RPC journals
establish host append and active-branch behavior; they do not establish rendered
card visibility. The former notification observer and native TUI launcher are
retired. No installed package or existing session is altered by these scenarios.
