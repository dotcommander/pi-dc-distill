# Architecture

One deterministic compiler serves every Pi compaction request. Pi owns triggering, cut selection, entry append, and context rebuilding. No request reason bypasses interception. There are no extension-owned LLM calls, triggers, aborts, timers, continuation sends, storage writes, recall, dumps, migration, tools, commands, or custom cards.

## Production graph

The production allowlist is `index.ts`, `lib/{compaction-source,local-compact,sdk,unicode,sha256}.ts`, `lib/compiler/{types,normalizer,tool-tracker,budget-formatter,helpers,signal,errors,contract,validation,summary-codec,eviction,tool-certification,message-decoder,cwd}.ts`, and `lib/runtime/{ownership,capacity,diagnostics}.ts`.

`compaction-source` validates the active projection and builds typed normalized records from `event.preparation` and active `event.branchEntries`. `normalizer` consumes certified discriminated records; aggregate projection/preparation checks, role-specific validation, strict codec checks, and the final combined source/focus structural guard remain. `tool-tracker` extracts full-identity observations with exact pairing before display shortening. `signal` exposes the visible content-signal constants that drive selection and eviction. `budget-formatter` builds and evicts complete text rows. `local-compact` provides the single current codec and compiler. SDK and digest helpers support the host boundary. No live session-file reads or diagnostic file compiler remain.

The architecture check traverses the surviving entrypoint and preserves compiler purity. Root-only package exports and the explicit publication allowlist keep retired modules and internal APIs out of the published surface. SDK pins and retained dependency versions remain unchanged. The tested Bun architecture gate replaces dependency-cruiser.

## Host lifecycle

`session_before_compact` intercepts manual, threshold, overflow, absent, and unfamiliar request reasons. One primary session owns the runtime. An instance moves from unbound to owned to closed. Its first valid session start binds ownership; foreign starts cannot adopt it. Before-switch and before-fork events invalidate preparation without transferring ownership. Owner shutdown closes the instance; successful replacement and reload use fresh extension instances. Lifecycle generation distinguishes preparations. Known child launchers disable extensions; an owned instance rejects foreign sessions. `parentSession` is not child provenance because legitimate user forks share that field. Independently launched children explicitly loading the extension are unsupported without host provenance. Source, compiler, cancellation, and capacity failures cancel rather than fall through to Pi's default LLM compactor.

The outer host result remains `{ summary, firstKeptEntryId, tokensBefore, details }`. Details contain only `compactor: "dc-distill"`, `summaryDigest`, `tokensAfter`, `tokensAfterSource: "pi-rebuilt-message-estimate"`, `capacityStatus`, and optional `contextWindow`. Capacity status is unknown or within-window. No version, checkpoint, autonomous flag, ledger, or duplicate fact metadata remains.

Preparation ownership is checked against primary-session identity, lifecycle generation, model, tree, and branch state. Replacement sessions and lifecycle changes invalidate in-flight preparation. The extension registers preparation and ownership lifecycle hooks, with no post-commit observer or notification hooks. Pi's native compaction card is the sole success display; the extension emits no success notification or durable success artifact.

Capacity acceptance uses the full model context window, with no response-reserve enforcement. The exact proposed summary plus retained tail is estimated through Pi's rebuilt-context functions; whole optional rows are evicted before retry, and mandatory overflow cancels. Unknown capacity remains explicit.

## Boundaries and cutover

There is one unversioned fixed-section text format. Owned predecessor state is admitted opportunistically and never blocks: only a matching digest and successful current-format decode produce structured carry; every other predecessor — including damaged summaries, digest mismatches, and old JSON formats — degrades to bounded attributed text without historical decoding, row salvage, a dedicated latest-request field, or structured observations. Active legacy handoff custom entries contribute no messages. There are no compatibility ladders or migrations. Native and foreign summaries remain attributed text; superseded history outside the effective projection does not block. Predecessor records flatten with prior origin and are never reparsed as fresh tools.

Use fresh sessions for this extension. Existing incompatible sessions use the old extension. Preserve historical session files, receipts, stored data, and `.work`. Protected task/evidence preservation is deliberately retired; observations are incomplete and establish no readiness, verification, or authorization.

## Acceptance

Unit tests cover source certification, verified predecessor carry and attributed-text degradation, exact pairing, full identities, user excerpt priority, omission accounting, Unicode and serialized bounds, capacity retry, and preparation lifecycle isolation. [Algorithm](algorithm.md) is authoritative for detailed selection and eviction policy. The independently invoked scripted-provider e2e suite establishes installed-Pi behavior without requiring a paid provider for the deterministic compiler; static or fixture success alone does not. Run the gates listed in [README](../README.md) after planned edits and semantic review. Timing and GC-enabled heap probes must compare matched dirty-baseline and final inputs; serialized size alone does not establish clipped-string storage retention or heap improvement. A large-input timing smoke test does not prove linear scaling. Historical benchmark and lifecycle receipts do not establish the current contract.

## Architecture gate grammar

`bun run distill:architecture` validates production syntax with the pinned TypeScript 7 asynchronous native AST API, awaits disposal of its snapshot and API, transpiles modules in memory with Bun, and scans the emitted runtime imports. Static ES imports and reexports are supported. Type-only imports and import type expressions are erased; runtime dynamic imports, import-equals, import attributes, `import.meta`, and reserved loader identifiers `require`, `createRequire`, and `getBuiltinModule` are rejected. Comments and string contents do not introduce graph edges.

Relative runtime imports must name existing canonical `.ts` files within the checkout and explicit production allowlist. Node builtins are normalized to `node:` identities. Bare imports must name declared root packages with project-local manifests. Resolution uses export strings or `"."` exports, recursively selecting `import` or `default` conditions in manifest order. Arrays, package subpaths, missing targets, escaping paths, and unsupported export shapes fail. An explicit `main` is accepted only when `exports` is absent. Package symlinks and noncanonical target paths are rejected.

The gate rejects unresolved imports, runtime cycles, development-only dependencies except declared peers, and transitive compiler access to effects, SDK, or runtime helpers. Every nonempty runtime module in the publication allowlist must be reachable from the root; fully erased type modules remain explicitly allowed. This bounded grammar does not prove absence of arbitrary reflective effects. The package exports only its root extension, and publication includes the explicit modules, README, and license.

The root TypeScript configuration checks production, tests, and scripts. `tsconfig.runtime.json` checks production with Node types only; `tsconfig.tooling.json` uses Node and Bun types. The target/module remain ES2022 with ES2024 libraries and bundler resolution.
