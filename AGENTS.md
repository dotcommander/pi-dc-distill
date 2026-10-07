# AGENTS.md — pi-dc-distill

## Product and orchestration

`dc-distill` replaces Pi's default LLM compactor with one deterministic local TypeScript compiler. Pi owns `/compact`, triggering, cut selection, append, and context rebuilding. Intercept every request reason identically, including missing and unfamiliar reasons.

At planning and phase boundaries, dispatch genuinely independent native agents with disjoint ownership and bounded packets. Keep one integration owner, serialize overlapping writes, preserve concurrent work, and use one verifier after all planned edits and semantic review repairs. Children do not delegate. Parallelism does not expand authority.

## Hard invariants

1. Never add an LLM call, extension-owned trigger, abort, timer, continuation send, tool, or command.
2. Live input comes only from `event.preparation` and active `event.branchEntries`; never read session files in the hook.
3. Source, compiler, cancellation, and capacity failures cancel compaction; never fall through to Pi's default LLM compactor.
4. Pi's native compaction card is the sole success display. No extension notifications, durable success artifacts, or storage writes remain.
5. Child sessions cancel interception. Preserve primary-session identity, lifecycle generation, and preparation ownership checks.

## Source and current contract

Preserve projection agreement, unique entry identities, predecessor agreement, exact discarded-message matching, split-turn boundaries, retained-tail exclusion, structural/Unicode checks, and the source-message guard. Bound input to 20 MiB using complete records, retaining mandatory metadata/predecessor and newest fitting records. Validate omitted records and retain duplicate-call-ID ambiguity before input budgeting. Pass typed normalized records directly to the compiler.

The single unversioned text format is `dc-distill-summary`, framed by `<dc-distill-summary>` tags with fixed sections `notice`, a `columns` legend, `focus`, `latest-request`, `records`, `files`, `commands`, and `omitted`, rendered as escaped single-line rows with keyword flags (`full`/`cut`, `yes`/`no`), a quoted request text, a `cmd` row prefix with `none` or `=`-prefixed cwd, labeled omission counters, and 22-character base64url identity prefixes. Notice is `Selected conversation excerpts and observations; incomplete.` Current focus comes only from native instructions. Latest request is the newest admitted native user text or predecessor request, attributed context with no duplicate excerpt. Flatten carried records with prior origin; never reinterpret carried text as fresh calls.

Admit owned predecessor state opportunistically and never let admission block compaction: only a matching digest and successful current-format decode produce structured carry. Every other predecessor, including damaged summaries, digest mismatches, and old formats, degrades to bounded attributed text without historical decoding or row salvage. Fallback text carries no dedicated latest-request field or structured observations. Active legacy handoff custom entries contribute no messages. Superseded history outside effective projection does not block. Native and foreign summaries remain attributed text.

Facts require exact unambiguous pairing and full identities before shortening. File facts require `isError === false`; preserve exact aliases, raw tool names, lexical path identity, path precedence, and create-capable distinction. Commands report recorded success/error/unknown without prose or shell-analysis inference. Observations do not establish current filesystem truth, readiness, verification, or authorization. Protected tasks, pins, evidence freshness, signatures, handoffs, checkpoints, and graphs are retired.

## Bounds and lifecycle

Preserve the 8,192-code-point operating target and 65,536-code-point hard serialized limit. Focus, request, and excerpts are limited to 2,048; paths to 512; reads and modifications to 50 each; commands to 10, with runner 128, command/cwd 512, and result 300. Count escaping/framing and preserve complete rows and Unicode code points. Detailed optional-fact admission, user excerpt priority, signal scoring, and eviction policy are authoritative in [docs/algorithm.md](docs/algorithm.md); preserve that policy and chronological rendering.

Carry omission counters once and add newly omitted candidates once. Deduplication/replacement are not omissions; source-bound drops count only as input omissions. Saturate counters at maximum safe integer. Preserve the whole-row eviction policy in [docs/algorithm.md](docs/algorithm.md).

Estimate the exact proposed summary and retained tail with Pi's `buildSessionContext()` and `estimateTokens()`. Retry after whole-row eviction; cancel if mandatory content cannot fit. Unknown capacity remains explicit. Capacity acceptance uses the full model context window without response-reserve enforcement. Details contain only compactor, summaryDigest, tokensAfter, tokensAfterSource, capacityStatus, and optional contextWindow.

Preserve preparation lifecycle hooks, primary ownership, generation, replacement handling, and model/tree/branch checks. Lifecycle changes invalidate in-flight preparation. Do not register post-commit notification hooks, keep pending receipts, or generate notification attempt IDs. The native compaction card is the sole success display.

## Scope and development

Production allowlist: `index.ts`; `lib/{compaction-source,local-compact,sdk,unicode,sha256}.ts`; `lib/compiler/{types,normalizer,tool-tracker,budget-formatter,helpers,signal,errors}.ts`. Package exports only the root extension and publishes its explicit runtime allowlist plus README/license. No replay binary, offline historical evaluator, benchmark program, recall, preview, focus injection, storage, dump, migration, or custom card remains.

Use fresh sessions with the new extension; existing incompatible sessions use the old extension. Do not load both together. Preserve `.work`, receipts, stored data, session files, excluded historical docs, and the `CLAUDE.md` symlink. Active docs are indexed in `docs/index.md`; historical specs/ADRs/benchmarks/assets are excluded from the current contract and package.

Keep existing dependency versions and Pi SDK development pins at 0.99.2; host peer ranges remain `*`. Use project-local `bun install --frozen-lockfile`, never another project's node_modules. No dependency additions, publication, data deletion, or migration is authorized by implementation.

After all edits and semantic review repairs, one verifier runs the approved full suite once and these gates:

```bash
bun test
bun x tsc --noEmit
bun run distill:architecture
git diff --check
npm pack --dry-run --json
bun run distill:e2e
```

After repairs rerun affected gates only. E2e uses isolated scripted-provider scenarios and available installed Pi; it is separate from unit discovery and requires no paid provider for deterministic-compiler QA. Fixture and static evidence do not prove installed-host behavior. Runtime acceptance instructions are owned by `tests/e2e/README.md`.
