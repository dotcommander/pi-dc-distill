# Releasing to npm

Publication requires separate explicit authorization. The reduction task does not publish a package, change dependency versions, migrate sessions, or delete stored data.

Pi loads `index.ts` as TypeScript source through `pi.extensions`. The package exports only the root extension. The `files` allowlist includes the entrypoint, its surviving runtime modules, README, and license. It excludes internal tests, e2e programs, docs archives, scripts, binaries, `.work`, receipts, raw sessions, credentials, and node_modules. There is no replay CLI or supported direct-file compiler API.

Before an authorized release, complete implementation and semantic review, then reuse the verifier's current receipts:

```bash
bun test
bun x tsc --noEmit
bun run distill:architecture
git diff --check
npm pack --dry-run --json
bun run distill:e2e
```

Run the full suite once with the user's approval; after repairs rerun affected gates only. Inspect every package dry-run entry against the allowlist. Unit fixtures and package inspection do not establish installed-host behavior or registry publication.

Keep the existing Pi SDK pins and dependency versions. Install project-local dependencies only with `bun install --frozen-lockfile`. Do not use another checkout's node_modules.

A separately authorized publication uses `npm publish --access public --registry=https://registry.npmjs.org/` with an unpublished package version and appropriate account authentication. The current prepublish script reruns the test and typecheck gates; those publication-time executions require their own release scope. Verify the exact registry version and integrity after publication, then exercise `/compact` in a fresh Pi session. Existing incompatible sessions remain with the old extension, and old and new extensions must not load together.
