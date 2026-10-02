# Isolated real-Pi RPC acceptance

Run from the repository after all implementation edits and dependency setup.
Each scenario uses its own HOME, agent directory, session directory, and project.
The scripted provider runs locally, traces every request, and makes no API calls.
The autonomous scenario retains the production 120-second startup cooldown.

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
directory, and checks one dc-distill commit without autonomous continuation or
provider summarization. This is scripted real-host evidence; it does not test
paid-provider acceptance, visual card rendering, or exactly-once recovery across
the uncertain persistence interval.
