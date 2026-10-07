# Architecture

One deterministic compiler serves every Pi compaction request. Pi owns triggering, cut selection, entry append, and context rebuilding. No request reason bypasses interception. There are no extension-owned LLM calls, triggers, aborts, timers, continuation sends, storage writes, recall, dumps, migration, tools, commands, or custom cards.

## Production graph

The production allowlist is `index.ts`, `lib/{compaction-source,local-compact,sdk,unicode,sha256}.ts`, and `lib/compiler/{types,normalizer,tool-tracker,budget-formatter,helpers,signal,errors}.ts`.

`compaction-source` validates the active projection and builds typed normalized records from `event.preparation` and active `event.branchEntries`. `normalizer` consumes certified discriminated records; aggregate projection/preparation checks, role-specific validation, strict codec checks, and the final combined source/focus structural guard remain. `tool-tracker` extracts full-identity observations with exact pairing before display shortening. `signal` exposes the visible content-signal constants that drive selection and eviction. `budget-formatter` builds and evicts complete text rows. `local-compact` provides the single current codec and compiler. SDK and digest helpers support the host boundary. No live session-file reads or diagnostic file compiler remain.

The architecture check traverses the surviving entrypoint and preserves compiler purity. Root-only package exports and the explicit publication allowlist keep retired modules and internal APIs out of the published surface. SDK pins and dependency versions remain unchanged.

## Host lifecycle

`session_before_compact` intercepts manual, threshold, overflow, absent, and unfamiliar request reasons. One primary session owns the runtime. Child sessions cancel interception; lifecycle generation distinguishes replacement sessions. Source, compiler, cancellation, and capacity failures cancel rather than fall through to Pi's default LLM compactor.

The outer host result remains `{ summary, firstKeptEntryId, tokensBefore, details }`. Details contain only `compactor: "dc-distill"`, `summaryDigest`, `tokensAfter`, `tokensAfterSource: "pi-rebuilt-message-estimate"`, `capacityStatus`, and optional `contextWindow`. Capacity status is unknown or within-window. No version, checkpoint, autonomous flag, ledger, or duplicate fact metadata remains.

Preparation ownership is checked against primary-session identity, lifecycle generation, model, tree, and branch state. Replacement sessions and lifecycle changes invalidate in-flight preparation. The extension registers preparation and ownership lifecycle hooks, with no post-commit observer or notification hooks. Pi's native compaction card is the sole success display; the extension emits no success notification or durable success artifact.

Capacity acceptance uses the full model context window, with no response-reserve enforcement. The exact proposed summary plus retained tail is estimated through Pi's rebuilt-context functions; whole optional rows are evicted before retry, and mandatory overflow cancels. Unknown capacity remains explicit.

## Boundaries and cutover

There is one unversioned fixed-section text format. Owned predecessor state is admitted opportunistically and never blocks: only a matching digest and successful current-format decode produce structured carry; every other predecessor — including damaged summaries, digest mismatches, and old JSON formats — degrades to bounded attributed text without historical decoding, row salvage, a dedicated latest-request field, or structured observations. Active legacy handoff custom entries contribute no messages. There are no compatibility ladders or migrations. Native and foreign summaries remain attributed text; superseded history outside the effective projection does not block. Predecessor records flatten with prior origin and are never reparsed as fresh tools.

Use fresh sessions for this extension. Existing incompatible sessions use the old extension. Preserve historical session files, receipts, stored data, and `.work`. Protected task/evidence preservation is deliberately retired; observations are incomplete and establish no readiness, verification, or authorization.

## Acceptance

Unit tests cover source certification, verified predecessor carry and attributed-text degradation, exact pairing, full identities, user excerpt priority, omission accounting, Unicode and serialized bounds, capacity retry, and preparation lifecycle isolation. [Algorithm](algorithm.md) is authoritative for detailed selection and eviction policy. The independently invoked scripted-provider e2e suite establishes installed-Pi behavior without requiring a paid provider for the deterministic compiler; static or fixture success alone does not. Run the gates listed in [README](../README.md) after planned edits and semantic review. Timing and GC-enabled heap probes must compare matched dirty-baseline and final inputs; serialized size alone does not establish clipped-string storage retention or heap improvement. A large-input timing smoke test does not prove linear scaling. Historical benchmark and lifecycle receipts do not establish the current contract.
