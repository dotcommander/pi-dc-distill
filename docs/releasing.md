# Releasing 0.2.0 to npm and Homebrew

Release preparation makes local artifacts reviewable. Commit, tag, push, npm publication, and tap publication require explicit release authorization; preparing this release does not perform them. Keep dependency versions and the Pi SDK development pins unchanged. Install project-local dependencies only with `bun install --frozen-lockfile`.

Pi loads `index.ts` as TypeScript source through `pi.extensions`. The package exports only the root extension. The `files` allowlist includes the entrypoint, its surviving runtime modules, README, and license. It excludes internal tests, e2e programs, docs archives, scripts, binaries, `.work`, receipts, raw sessions, credentials, and node_modules. There is no replay CLI or supported direct-file compiler API.

After all edits and semantic review repairs, one verifier runs the full suite once and the remaining gates, then records their results:

```bash
bun test
bun x tsc --noEmit
bun run distill:architecture
git diff --check
npm pack --dry-run --json
bun run distill:e2e
```

After repairs rerun affected gates only. Inspect every package dry-run entry against the allowlist, including `package.json`, which npm includes automatically. The Homebrew formula and release documentation must stay outside the npm artifact. Unit fixtures and package inspection do not establish installed-host behavior or registry publication.

## Prepare the exact artifact

The release owner packs once into the excluded release-artifact directory. Run these commands from the repository root only when creating or intentionally replacing the prepared artifact:

```bash
mkdir -p .work/releases/0.2.0
npm pack --json --pack-destination .work/releases/0.2.0
shasum -a 256 .work/releases/0.2.0/pi-dc-distill-0.2.0.tgz
```

Record the tarball path, SHA-256, and npm pack integrity. The verifier inspects that tarball's file list and version. Set the SHA-256 in `packaging/homebrew/pi-dc-distill.rb` from the prepared bytes. The formula uses the future registry URL `https://registry.npmjs.org/pi-dc-distill/-/pi-dc-distill-0.2.0.tgz`; it is not installable before npm publication. Review the final formula and validate its Ruby syntax. Preserve the prepared tarball: subsequent source changes require a newly reviewed artifact and hash. Never silently overwrite an existing different tarball.

## Publish after authorization

1. Confirm npm authentication and that version `0.2.0` is unpublished. Publish the exact prepared tarball, without repacking the checkout:

   ```bash
   npm publish .work/releases/0.2.0/pi-dc-distill-0.2.0.tgz --access public --registry=https://registry.npmjs.org/
   npm view pi-dc-distill@0.2.0 version dist.tarball dist.integrity --json --registry=https://registry.npmjs.org/
   ```

   Compare registry integrity with the recorded npm pack integrity. Publishing from source would run the checkout's `prepublishOnly` script and recreate the artifact; this workflow publishes the already checked tarball.

2. Download the registry tarball into the release directory and confirm its SHA-256 matches the prepared tarball and formula. Do not update the tap if either hash or registry integrity differs.

3. Copy `packaging/homebrew/pi-dc-distill.rb` into `Formula/pi-dc-distill.rb` in the separately authorized `dotcommander/tap` checkout. Run the tap's applicable formula checks, install/test the published formula, and commit/push the tap update only within that authority. No tap writes occur during preparation.

4. Verify each install route independently with an installed Pi, loading one extension copy at a time:

   ```bash
   pi install npm:pi-dc-distill@0.2.0
   # Alternatively, after the tap update:
   brew install dotcommander/tap/pi-dc-distill
   pi install "$(brew --prefix)/opt/pi-dc-distill/libexec"
   ```

   Start a fresh Pi session and exercise `/compact`; verify Pi's native compaction card. The formula's file/metadata test proves source installation only. Existing incompatible sessions remain with the old extension; old and new extensions must not load together. See [runtime acceptance](../tests/e2e/README.md).
