# Troubleshooting

Your job is to determine why a dc-distill compaction cancelled, or why a summary looks unexpected. A source, compiler, cancellation, or capacity failure cancels compaction; the extension never lets an interception failure fall through to Pi's default LLM compactor, and it never retries, aborts a run, or sends continuation messages.

There is no extension diagnostic log, recall store, raw dump, replay program, or migration command. Inspect Pi's error and the native compaction card.

## Compaction cancels

- Symptom: Pi reports a failed compaction; no compaction card appears.
- Cause: source validation failed. Projection disagreement, duplicate entry identities, mismatched predecessor or discarded messages, malformed structure or Unicode, invalid split-turn boundaries, more than 50,000 discarded messages, malformed tool-bearing messages, or mandatory metadata alone exceeding the 20 MiB envelope are all fatal. Records the envelope would omit are validated too, so reducing input cannot hide a malformed record or ambiguous call identity.
- Solution: start a fresh session with only the current extension. Existing incompatible sessions must use the old extension.
- Prevention: keep sessions on the current extension; never load old and new together. Malformed Unicode, cycles, and accessor properties anywhere in the discarded input are rejected during source validation, whether or not the record would be admitted.

An unsupported message role or content shape without tool identity is not fatal: it degrades to an attributed-text row that observation clips once, so the summary keeps marking it `cut`, and compaction continues. A malformed message carrying a tool call or tool result is fatal — see the failure above — because recovering it as text could erase duplicate-call ambiguity.

## Prior summary lost its structure

- Symptom: the previous dc-distill summary appears only as bounded attributed `native-summary` text, without structured observations or a dedicated latest-request field.
- Cause: predecessor admission is opportunistic. Only a matching digest and successful current-format decoding produce full structured carry. Damaged summaries, digest mismatches, old JSON formats, and foreign summaries degrade to attributed text. That fallback never creates fresh execution facts.
- Solution: nothing to repair — degradation is designed behavior and never blocks compaction.
- Prevention: keep sessions on the current extension so carried summaries stay in the current shape.

Superseded history outside the effective input projection never blocks compaction.

## Summary is smaller than expected

- Symptom: rows you remember are missing; counters on the `omitted:` line are nonzero.
- Cause: budgets and priority. Selection admits user-role excerpts newest-first before scored assistant/tool excerpts; facts are capped (50 reads, 50 modifications, 10 commands); eviction removes whole optional rows in tiers under capacity pressure. Omission counters describe lost candidates, so a summary with no visible failure is not proof that all commands passed.
- Solution: read the `omitted:` line to see what was lost; supply `/compact` instructions so the bounded focus names what matters.
- Prevention: compact before the discarded window grows very large; status can also be `unknown` when no outcome was recorded.

File writes marked create-capable (`yes`) do not prove creation. Readiness, verification, and authorization must be established outside the summary.

## Success display

Pi's native compaction card is the sole success display. The extension emits no success notification and registers no post-commit notification observer.

## Compaction cancels on capacity

- Symptom: smaller sessions compact fine, but this one cancels even after optional rows were dropped.
- Cause: after evicting every optional row, mandatory framing, focus, and latest request still exceed the known model context window (checked with Pi's own rebuilt-context estimate over the exact summary plus retained tail). Capacity acceptance uses the full model context window, without reserving response space. Unknown capacity is explicitly reported and is not proof that the context fits.
- Solution: use a model with a larger context window, or reduce the retained tail before compacting. Nothing in the extension can shorten mandatory content.
- Prevention: compact earlier, before the retained tail grows toward the window.

## Development failures

Use the gates in [README](../README.md) and the isolated installed-Pi scenarios in [runtime acceptance](../tests/e2e/README.md). Scripted-provider QA needs no paid provider for the deterministic compiler. Historical benchmark and e2e receipts are excluded from current acceptance.
