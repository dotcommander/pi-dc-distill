# ADR 0002: Remove the vendored framework entirely — owned support surface

- **Status:** Accepted framework-removal decision (2026-10-01); historical implementation inventory superseded by the current compiler reduction (2026-10-06)
- **Deciders:** repository owner (user, session 2026-10-01: "a single extension
  should not have a whole framework")
- **Supersedes:** ADR 0001's "trim to reachable surface" endpoint. ADR 0001
  remains the governing record for its executed trim (7 unreachable files);
  this ADR replaces the *endpoint*: reachability was the wrong bar.

The no-vendored-framework decision remains applicable. The support-module inventory, old wire-compatibility gates, and migration preconditions below describe historical implementation only; the current production allowlist in [AGENTS](../../AGENTS.md) supersedes them. This ADR is an excluded historical record, not the current product contract.

## Context

`lib/framework/` is a vendored copy of dc-framework: after the ADR 0001 trim,
47 files / 8,214 lines remain, of which 44 files / 7,795 lines are
product-reachable. Every line is *reachable* — but "reachable" here means
pulled in by one facade chain, not *needed*:

- The product's entire facade consumption is: `defineExtension` (once, zero
  tools, zero commands), `Tool.text/error` (7 call sites), `Notify.user/toLLM/fail`
  (6), `Diag.warn` (1), `Path.*` (~15), plus `x/{events,entries,output(types),
  runtime,fs,testing}`.
- That consumption supports ~4,700 lines of TUI rendering, diagram text,
  command/manifest machinery, loader/status panels, and channel plumbing the
  extension never exercises.
- `pi/coding-agent.ts` — the SDK boundary — is a 23-line pure re-export of
  `@earendil-works/pi-coding-agent`; the SDK is already a direct dependency.

One deterministic compaction extension carrying an 8.2k-line multi-extension
framework is structural dead weight: navigation cost, audit surface, and a
concurrent-edit hazard (an ambient session is mid-flight in
`lib/framework/x/events.ts`).

## Decision

1. **Delete `lib/framework/` entirely.** No vendored framework remains.
2. Replace the consumed capability with an **owned support surface** under
   `lib/`, one module per capability, no generalization. Estimates below were
   the planning budget; the **actuals** (post-split, 2026-10-01) exceeded the
   budget because the ADR under-estimated the TUI block-spec surface
   (record/rail/banner/stack/markdown/divider + width-fitting formatters)
   consumed by `compaction-card.ts`, the Path overload machinery, and the
   fs lock/atomic-write/json-store trio. Actuals, not the budget, are the
   contract now:
   - `lib/sdk.ts` — direct re-export of the Pi SDK symbols in use (12)
   - `lib/events-support.ts` — the used `Events.*` factory + the intercept /
     patch / compact-summary types (187)
   - `lib/entries-support.ts` — used `Entries.*` typed helpers (148)
   - `lib/runtime-probe.ts` — `loadActivePiInteractiveMode` host detection (116)
   - `lib/notify-support.ts` — `Notify.user/toLLM/fromUser/renderer` +
     message envelopes + `registerBlockSpec` (240)
   - `lib/tui-block.ts` — the BlockSpec/component surface for the compaction
     card: spec types, glyph table, width-fitting formatters, `Block.render`
     and `Block.node` (450). Split from notify-support after the migration
     because "two capabilities, one module" violated this section's rule;
     the framework's `Block.registerSpec` became `registerBlockSpec` in
     notify-support, next to the other host-channel wiring.
   - `lib/tool-result.ts` — `text`/`error` result shapers + `Tool` facade (76)
   - `lib/paths.ts` — data/project path access (233; the overload surface
     and slug/ext-name validation are directly unit-tested)
   - `lib/fs-support.ts` — atomic write, file lock, json store semantics (307)
   - `lib/diag-support.ts` — warn/error (93)
   - `tests/harness/fake-pi.ts` — minimal test fake replacing `x/testing` (387)

   Owned-surface total: 2,249 lines (vs the ~550–650 planning budget).
3. **No compatibility layer, no re-export barrel** for the old
   `#distill-framework` import mapping; product files import the owned modules
   directly. Removal is atomic in the PRD's import-migration task.
4. If a second consumer of these helpers ever exists, extract then — with real
   evidence, per the standing rejection of speculative packaging (audit G001).

## Consequences

- Repository source: the deletion removed 8,564 lines across 53 vendored
  framework files. Verified actuals after the migration (2026-10-01):
  `lib/` non-test 8,276 + `index.ts` 971 + `bin/` ≈ 9.3k product lines, plus
  5,603 lines of co-located `lib/*.test.ts` and 1,501 lines under `tests/`
  (e2e, fixtures, harness). `lib/framework/` is gone; the largest single
  file is the product's own `lib/local-compact.ts` (2,790).
- Every support line is owned, reviewed, and directly exercised by this
  extension's tests; no frozen upstream governance applies anywhere.
- Wire compatibility must be proven, not assumed: notify/tool-result/event
  payload shapes and fs lock/atomic-write semantics are gated by
  `bun test`, `tsc`, the extension load probe, and `distill:e2e`
  (PRD `prd-deframework-owned-surface`).
- Execution precondition: the concurrent feature-flag session must land first —
  its uncommitted dirty set covers exactly the files this removal migrates
  (including `index.ts`, `lib/store.ts`, `lib/output-compactor.ts`,
  `package.json`, and `lib/framework/x/events.ts` itself).
- Re-vendoring dc-framework would contradict this ADR; a future reversal
  requires a superseding ADR.
