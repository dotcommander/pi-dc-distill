# Architecture

One deterministic compiler serves every Pi compaction request. Pi owns triggering, cut selection, entry append, and context rebuilding. No request reason bypasses interception. There are no extension-owned LLM calls, triggers, aborts, timers, continuation sends, storage writes, recall, dumps, migration, tools, commands, or custom cards.

## Production graph

The production allowlist is `index.ts`, `lib/{compaction-source,local-compact,sdk,unicode,sha256}.ts`, and `lib/compiler/{types,normalizer,tool-tracker,budget-formatter,helpers,errors}.ts`.

`compaction-source` validates the active projection and builds typed normalized records from `event.preparation` and active `event.branchEntries`. `normalizer` preserves structural and Unicode checks. `tool-tracker` extracts full-identity observations with exact pairing before display shortening. `budget-formatter` builds and evicts complete JSON rows. `local-compact` provides the single current codec and compiler. SDK and digest helpers support the host boundary. No live session-file reads or diagnostic file compiler remain.

The architecture check traverses the surviving entrypoint and preserves compiler purity. Root-only package exports and the explicit publication allowlist keep retired modules and internal APIs out of the published surface. SDK pins and dependency versions remain unchanged.

## Host lifecycle

`session_before_compact` intercepts manual, threshold, overflow, absent, and unfamiliar request reasons. One primary session owns the runtime. Child sessions cancel interception; lifecycle generation distinguishes replacement sessions. Source, compiler, cancellation, and capacity failures cancel rather than fall through to Pi's default LLM compactor.

The outer host result remains `{ summary, firstKeptEntryId, tokensBefore, details }`. Details contain only `compactor: "dc-distill"`, `attemptId`, `summaryDigest`, `tokensAfter`, `tokensAfterSource: "pi-rebuilt-message-estimate"`, `capacityStatus`, and optional `contextWindow`. Capacity status is unknown or within-window. No version, checkpoint, autonomous flag, ledger, or duplicate fact metadata remains.

One pending receipt authorizes a synchronous best-effort post-commit UI notification. Independently validate the newest active compaction against the full receipt: owner, attempt, generation, cut, branch anchor, and exact summary/details. Pi 1.0.4 may select a historical identical-summary entry for its callback; callback summary equality alone does not authorize success. Reconcile against the independently validated active entry. Sibling custom entries appended after that compaction are tolerated; stale, duplicate, superseding, abandoned, and foreign commits cannot authorize notification. Consume the receipt before notification and invalidate it on relevant lifecycle, model, and tree changes. No durable success artifacts are written.

Pi 1.0.4 routes informational notifications through chat, which its later `compaction_end` rebuild can clear. The native compaction card is the persistent success display. Literal notification visibility is not guaranteed; no timer, private presentation patch, or new UI feature is added.

## Boundaries and cutover

There is one unversioned fixed-key JSON format. Only current-shape, exact-digest owned predecessor state is admitted; active legacy handoffs and incompatible owned summaries cancel. There are no compatibility ladders or migrations. Native and foreign summaries remain attributed text; superseded history outside the effective projection does not block. Predecessor records flatten with prior origin and are never reparsed as fresh tools.

Use fresh sessions for this extension. Existing incompatible sessions use the old extension. Preserve historical session files, receipts, stored data, and `.work`. Protected task/evidence preservation is deliberately retired; observations are incomplete and establish no readiness, verification, or authorization.

## Acceptance

Unit tests cover source boundaries, strict current carry, exact pairing, full identities, omission accounting, Unicode and serialized bounds, capacity retry, and commit isolation. The independently invoked scripted-provider e2e suite establishes installed-Pi behavior without requiring a paid provider for the deterministic compiler; static or fixture success alone does not. Run the gates listed in [README](../README.md) after planned edits and semantic review. Historical benchmark and lifecycle receipts do not establish the current contract.
