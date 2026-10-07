import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { cruise } from 'dependency-cruiser';

// dependency-cruiser 18.4.0 supports TypeScript <7. Feed its supported JS parser
// real emitted runtime modules instead of its lossy unsupported-TS fallback.
// Explicit type imports disappear through the transpiler, never text filtering.
const root = process.cwd();
const config = createRequire(import.meta.url)('../.dependency-cruiser.cjs');
const staged = await mkdtemp(join(tmpdir(), 'dc-distill-architecture-'));
const transpiler = new Bun.Transpiler({
  loader: 'ts', target: 'bun',
  tsconfig: JSON.stringify({ compilerOptions: { verbatimModuleSyntax: true, importsNotUsedAsValues: 'preserve' } }),
});

async function emit(relative: string): Promise<void> {
  if (relative.endsWith('.test.ts') || relative.endsWith('.d.ts')) return;
  if (relative.endsWith('.ts')) {
    const output = join(staged, relative.slice(0, -3) + '.js');
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, transpiler.transformSync(await readFile(join(root, relative), 'utf8')));
  } else if (relative.endsWith('.js') || relative.endsWith('.json')) {
    const output = join(staged, relative);
    await mkdir(dirname(output), { recursive: true });
    await copyFile(join(root, relative), output);
  }
}

async function emitDirectory(relative: string): Promise<void> {
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) await emitDirectory(path);
    else if (entry.isFile()) await emit(path);
  }
}

try {
  await emit('index.ts');
  await emitDirectory('lib');
  await copyFile(join(root, 'package.json'), join(staged, 'package.json'));
  await symlink(join(root, 'node_modules'), join(staged, 'node_modules'), 'dir');
  process.chdir(staged);
  const { tsConfig: _tsConfig, enhancedResolveOptions: _resolver, ...options } = config.options;
  const result = await cruise(['index.js'], {
    ...options, ruleSet: { forbidden: config.forbidden }, outputType: 'err-long',
  }, {
    extensions: ['.js', '.json'], conditionNames: ['import', 'default'],
    // Keep original specifiers intact; resolve .ts paths to their emitted .js.
    extensionAlias: { '.ts': ['.js'] },
  });
  console.log(result.output);
  process.exitCode = result.exitCode;
} finally {
  process.chdir(root);
  await rm(staged, { recursive: true, force: true });
}
