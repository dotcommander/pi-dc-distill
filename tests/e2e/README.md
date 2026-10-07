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
and a subsequent usable native prompt. A deliberately small model window checks
that an oversized retained tail cancels when mandatory rebuilt context cannot fit.

The acceptance oracle has no production imports. It independently checks the
fixed JSON shape and notice, bounded Unicode observations, file/command bounds,
omission counters, exact wire digest and minimal unversioned details. Its negative
fixtures run in `bun test`; they reject numbered fields, checkpoint state,
corrupt authenticated shapes and impossible known capacity.

These are scripted installed-host receipts. Fixture checks alone do not prove
installed-host behavior. They do not establish paid-provider behavior or rendered
native UI notification/card behavior. Runtime results must be reported for the
actual host selected. Historical autonomous, continuation, checkpoint, timing,
TUI and demo programs are retired and are not acceptance evidence.

The simplified extension requires fresh sessions. Existing incompatible owned
summaries and active legacy handoffs are refused; use the old extension to finish
those sessions. These programs neither migrate nor delete historical data.

## Historical equal-summary callback regression

The lifecycle suite now seeds a real compaction, keeps it as an abandoned journal
sibling, and reopens the original conversation branch with an inert custom leaf.
Repeating the same native compaction instructions produces byte-identical summary
bytes but a new active attempt. An independent test extension records the host's
callback identity and the newest actual active compaction. Older Pi hosts may
report the abandoned entry; newer hosts may report the new entry directly.
Both must leave exactly one new current-contract active commit.

Pi exposes its RPC UI bridge as `hasUI:true`. The RPC scenario therefore also
requires exactly one observed `ctx.ui.notify` invocation for the new active
commit, with the matching rebuilt token estimate. This establishes invocation
through the bridge; it does not establish rendered notification text. Run the
separate native launcher in an owned PTY for the rendered UI boundary:

```sh
DISTILL_PI_PACKAGE="/path/to/installed/pi-coding-agent" DISTILL_PI_EXPECT_VERSION=1.0.4 bun run tests/e2e/summary-collision-tui.ts
```

After startup submit the printed `/compact` instruction, wait for the native
successful compaction card, then exit with Ctrl+C twice. The launcher asserts
one active new attempt with identical bytes, one extension-owned callback, and
exactly one real `ctx.ui.notify` invocation with `hasUI:true`. It preserves the
callback/notification telemetry, interactive instructions and acceptance receipt
in the printed temporary directory. Terminal screenshots or a PTY transcript are
still needed to establish visible notification rendering. Relaunching creates a
fresh sandbox; no installed package or existing session is altered. If the host
resists shutdown, the launcher bounds its own termination escalation to five
seconds and stops only its child process.
