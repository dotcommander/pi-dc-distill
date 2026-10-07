# Documentation index

You are setting up or operating dc-distill, the deterministic context-compaction extension for Pi. The first useful action is running Pi's native `/compact` in a fresh session; the expected result is Pi's compaction card containing a `dc-distill-summary` text block. The standing limit: dc-distill registers no commands, tools, or configuration of its own, and every interception failure cancels compaction instead of falling back to an LLM summarizer.

## Limits and non-goals

- Summaries are lossy, attributed observations. They establish no task readiness, verification, authorization, or current filesystem truth.
- Pi's native compaction card is the sole success display; the extension emits no success notification.
- There is no migration or historical format decoder. Fresh sessions use this extension; existing incompatible sessions keep the old extension.
- The historical archive lives under `.work/docs-archive/` (see [docs README](README.md)); it is excluded from the current product contract and package publication.

## Routes

| Reader task | Document |
| --- | --- |
| Install, run `/compact`, and read the summary card | [usage](usage.md) |
| Diagnose a cancelled compaction | [troubleshooting](troubleshooting.md) |
| Check whether anything can be configured | [settings](settings.md) — there is nothing to configure |
| Understand excerpt selection, fact pairing, identities, and budgets | [algorithm](algorithm.md) |
| Understand modules, host lifecycle, capacity retry, and preparation ownership | [architecture](architecture.md) |
| Verify behavior on an installed Pi host | [runtime acceptance](../tests/e2e/README.md) |
| Publish the npm package | [releasing](releasing.md) |
