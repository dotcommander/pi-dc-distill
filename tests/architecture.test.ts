import { expect, test } from 'bun:test';
import { realpathSync, rmSync } from 'node:fs';
import { checkArchitecture } from '../scripts/architecture.ts';
import { architectureFixtures } from '../scripts/architecture-fixtures.ts';
import { materializeFixture } from '../scripts/architecture-fixture-harness.ts';
import { resolveImport } from '../scripts/architecture-resolve.ts';
for (const fixture of architectureFixtures) test(`architecture: ${fixture.name}`, async () => {
  const { root, manifest } = materializeFixture(fixture);
  try { const result = await checkArchitecture(root, manifest); expect(result.errors.length === 0).toBe(fixture.pass); }
  finally { rmSync(root, { recursive: true }); }
}, 30_000);

for (const [specifier, pass] of [['sqlite', false], ['node:sqlite', true], ['test', false], ['node:test', true], ['node:not-a-builtin', false]] as const) {
  test(`architecture: builtin identity ${specifier}`, async () => {
    const { root, manifest } = materializeFixture({ name: specifier, sources: { 'index.ts': `import ${JSON.stringify(specifier)};` }, pass });
    try {
      const result = await checkArchitecture(root, manifest);
      expect(result.errors.length === 0).toBe(pass);
      if (pass) expect(resolveImport(root, 'index.ts', specifier, manifest)).toBe(specifier);
      else expect(() => resolveImport(root, 'index.ts', specifier, manifest)).toThrow(specifier.startsWith('node:') ? 'unknown builtin' : 'undeclared package');
    } finally { rmSync(root, { recursive: true }); }
  });
}

test('architecture: a bare prefix-only builtin name still resolves as a declared package', async () => {
  const { root: fixtureRoot, manifest } = materializeFixture({ name: 'sqlite package', sources: { 'index.ts': 'import "sqlite";' },
    deps: { sqlite: '1' }, packages: { sqlite: { exports: './index.js' } }, pass: true });
  const root = realpathSync(fixtureRoot);
  try {
    expect(resolveImport(root, 'index.ts', 'sqlite', manifest)).toBe('sqlite');
    expect((await checkArchitecture(root, manifest)).errors).toEqual([]);
  } finally { rmSync(root, { recursive: true }); }
});
