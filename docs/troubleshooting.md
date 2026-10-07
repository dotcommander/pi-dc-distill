# Troubleshooting

A source, compiler, cancellation, or capacity failure cancels compaction. The extension never lets an interception failure fall through to Pi's default LLM compactor.

Use a fresh session for the current extension. An incompatible owned predecessor, corrupt summary digest or shape, or active legacy handoff is refused. Existing incompatible sessions must use the old extension. Superseded history outside the effective input projection does not block compaction. Native and foreign predecessor summaries remain attributed text.

Projection disagreement, duplicate entry identities, mismatched predecessor or discarded messages, malformed structure or Unicode, and invalid split-turn boundaries are source errors. The source validates omitted records as well as admitted records; reducing the input cannot hide a malformed record or ambiguous call identity.

If the exact proposed summary plus retained tail exceeds known model capacity, whole optional rows are removed and Pi's rebuilt-context estimate is repeated. Mandatory framing, focus, and latest request cannot be evicted; if they still cannot fit, the attempt cancels. Unknown capacity is explicitly reported and is not proof that the context fits.

No extension diagnostic log, recall store, raw dump, replay program, or migration command remains. Inspect Pi's error and native compaction card. A missing success notification does not prove failure: notifications are synchronous best effort and require an independently validated newest active primary-session commit matching the full pending receipt. Pi 1.0.4 may route an informational notification to chat and then clear it during the `compaction_end` rebuild. The native compaction card is the persistent success display. No notification is authorized by stale summary equality or a duplicate, abandoned, or foreign commit. Pi may supply a historical identical-summary callback entry; the extension reconciles it against the independently validated active receipt rather than treating that callback entry as authority.

For development failures, use the checks in [README](../README.md) and the isolated installed-Pi scenarios in [runtime acceptance](../tests/e2e/README.md). Scripted-provider QA needs no paid provider for the deterministic compiler. Historical benchmark and e2e receipts are excluded from current acceptance.
