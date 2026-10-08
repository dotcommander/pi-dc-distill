import { expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { checkArchitecture } from '../scripts/architecture.ts';
import { architectureFixtures } from '../scripts/architecture-fixtures.ts';
import { materializeFixture } from '../scripts/architecture-fixture-harness.ts';
for (const fixture of architectureFixtures) test(`architecture: ${fixture.name}`, async () => {
  const { root, manifest } = materializeFixture(fixture);
  try { const result = await checkArchitecture(root, manifest); expect(result.errors.length === 0).toBe(fixture.pass); }
  finally { rmSync(root, { recursive: true }); }
}, 30_000);
