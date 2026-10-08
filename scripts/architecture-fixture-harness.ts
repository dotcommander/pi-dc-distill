import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ArchitectureFixture } from './architecture-fixtures.ts';
import type { Manifest } from './architecture.ts';
export function materializeFixture(fixture: ArchitectureFixture): { root: string; manifest: Manifest } {
  const root = mkdtempSync(join(tmpdir(), 'distill-architecture-fixture-'));
  const manifest: Manifest = { files: Object.keys(fixture.sources), dependencies: fixture.deps ?? {}, devDependencies: fixture.dev ?? {}, peerDependencies: fixture.peers ?? {} };
  for (const [file, source] of Object.entries(fixture.sources)) { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), source); }
  writeFileSync(join(root, 'package.json'), JSON.stringify({ ...manifest, type: 'module' }));
  for (const [name, pkg] of Object.entries(fixture.packages ?? {})) { const dir = join(root, 'node_modules', name); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg)); writeFileSync(join(dir, 'index.js'), 'export const x = 1;'); }
  return { root, manifest };
}
