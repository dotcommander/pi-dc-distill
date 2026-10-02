# ADR 0001: Vendored dc-framework boundary — trim to reachable surface

- **Status:** Superseded by [ADR 0002](0002-remove-vendored-framework.md) (2026-10-01); the vendored copy is deleted
- **Deciders:** repository owner (user authorization, session 2026-10-01)
- **Supersedes:** the origin project's frozen-kernel rule (phase-2 decision D1,
  `.work/phase2-decisions-2026-05-18.md`) **for this repository's vendored copy
  only** — that governance file does not exist in this repository, and this copy
  is not bound by it.

## Context

`lib/framework/` is a vendored copy of the dc-framework kernel: 59 files, ~8,600
lines (about 65% of this repository). Its barrel header freezes the kernel "at
these names" under origin governance that this repository never received. Audit
finding W003 (report digest `ecaefaef…`, run `wwgd-20261001-3135b22d`) routed
the boundary decision to this ADR.

A full transitive import-closure scan of the live tree (2026-10-01) found:

- Consumed directly: barrel facades `defineExtension, Diag, Notify, Tool, Path`;
  subpaths `pi/coding-agent`, `x/{fs, testing, runtime, output, events, entries}`.
- Consumed transitively (must stay): `command.ts` + `guard.ts` (via
  `define-extension`), `status.ts` + `loader.ts` + `command.ts` (via
  `x/testing`), `pi/tui.ts` + the `_tui` render chain (via `tool.ts`'s
  `_tool-render`), `x/tui-components.ts` + `_panel.ts` + `diagram/mermaid-text`
  (via `x/output` → `output-block.ts`), `_json-store`/`_file`/`_file-lock` (via
  `x/fs`).
- Unreachable from any live import path (7 files, 386 lines): `lib/session.ts`,
  `lib/errors.ts`, `lib/_theme-map.ts`, `lib/defaults/themes.json`,
  `pi/index.ts`, `pi/agent-core.ts`, `pi/ai.ts`.

Magnitude note: an earlier direct-reference estimate suggested roughly half the
framework could be removed. The transitive closure corrected this — most of the
vendored weight is live through the facade/helper chains above. The honest
savings are the 386 unreachable lines plus a smaller truthful barrel surface.

## Decision

1. This repository **owns** its vendored copy of dc-framework. The origin
   project's promotion/freeze governance does not bind this copy.
2. **Trim** the copy to its transitively-reachable surface: delete the seven
   unreachable files listed above and remove `session`/`errors` from the barrel
   re-export set. No other framework file is modified.
3. **No shared package and no upstream-sync story.** No live upstream twin
   exists (only archived consumers in the origin repo); extracting a package
   for a hypothetical second consumer was rejected (audit G001).
4. If a maintained upstream package is ever published, adopting it requires a
   new ADR and a successor contract; it must not silently re-widen this copy.

## Consequences

- The barrel no longer exports `session`/`errors` members. A repository-wide
  scan confirmed zero live consumers of those exports; any future consumer
  would be a compile error, which is the desired honesty.
- `pi/index.ts` (the adapter barrel), `agent-core.ts`, and `ai.ts` (3-line
  re-export stubs) are gone; `pi/coding-agent` and `pi/tui` remain the only
  adapter entry points, matching actual use.
- Reviewers can treat every remaining framework file as load-bearing from the
  product's perspective; nothing in `lib/framework/` is dead weight.
- A future re-vendoring must re-run the closure scan; blindly copying the
  origin tree would reintroduce the removed files.
- No behavior, dependency, schema, or public-product-contract change.
  Verification: `bun test`, `bun x tsc --noEmit`, extension entry load probe
  (PRD `prd-framework-boundary-trim`, gates T2-S1, TG1–TG4).
