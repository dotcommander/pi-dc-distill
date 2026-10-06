# Releasing to npm

`pi-dc-distill` is a Pi extension distributed as TypeScript source. Pi loads
`index.ts` through the package's `pi.extensions` declaration, so there is no
compiled build step. The optional `dc-distill-session` CLI uses Bun.

The package is configured for the public npm registry. Publishing makes the
allowlisted source and documentation public. GitHub description and topics are
independent of npm publication.

## Prepare the package

From a checkout, use Node.js 22.19.0 or newer, npm, and Bun 1.4.0. Install only
this project's pinned development dependencies:

```bash
bun install --frozen-lockfile
```

Check the proposed package name and version, authentication, and registry state:

```bash
npm pkg get name version
npm whoami --registry=https://registry.npmjs.org/
npm view pi-dc-distill versions --json --registry=https://registry.npmjs.org/
```

If `whoami` reports `ENEEDAUTH`, run `npm login
--registry=https://registry.npmjs.org/` interactively, then repeat `whoami`.
An `E404` from `view` means the registry did not return that package; it does not
reserve the name or guarantee publishing rights. For an existing package, use an
unpublished version and an account with maintainer access. Confirm that the
specific version shown by `npm pkg get version` has not already been published:

```bash
npm view pi-dc-distill@0.1.7 version --registry=https://registry.npmjs.org/
```

Replace `0.1.7` with the proposed version for subsequent releases. npm does not
allow reuse of a published name/version pair, even after unpublishing.

Run the checks and inspect the package contents:

```bash
bun test
bun run typecheck
bun run distill:architecture
git diff --check
npm pack --dry-run --json
```

The pack listing must include `package.json`, `index.ts`, its `lib/` imports,
`bin/dc-distill-session.ts`, `LICENSE`, `README.md`, and `docs/`. It also includes
the synthetic comparison script and fixtures intentionally. It must exclude
`node_modules`, `.git`, `.work`, `docs/specs`, raw sessions, credentials, and
unit/e2e tests.
Review every listed file before publishing. The `files` allowlist in
`package.json` owns this boundary.

## Publish manually

Once the release contents and registry account are approved, publish from the
checkout:

```bash
npm publish --access public --registry=https://registry.npmjs.org/
```

`prepublishOnly` reruns the test and typecheck gates before publishing. npm may
prompt for two-factor authentication. The command publishes the current version
with the `latest` tag. This guide does not configure automated releases or
trusted publishing. Do not force `--provenance`: npm provenance is not supported
for private source repositories.

Verify the exact released version, then install it in Pi:

```bash
npm view pi-dc-distill@0.1.7 version dist.integrity --registry=https://registry.npmjs.org/
pi install npm:pi-dc-distill@0.1.7
```

For normal installation after publication, use `pi install npm:pi-dc-distill`.
Start a new Pi session and use `/compact` to exercise the installed extension.
Local tests and a pack listing do not prove a published registry install.

References: [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/)
and [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).
