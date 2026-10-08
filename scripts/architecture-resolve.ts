import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export interface Manifest {
  files: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function contained(root: string, path: string): boolean { const rel = relative(root, path); return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel); }
export function canonicalFile(root: string, path: string): string {
  if (!contained(root, path) || realpathSync(path) !== path || !statSync(path).isFile()) throw new Error('noncanonical or missing target');
  return path;
}
function exportTarget(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!object(value)) throw new Error('unsupported package export');
  for (const [condition, target] of Object.entries(value)) {
    if (condition.startsWith('.')) throw new Error('unsupported package export map');
    if (condition === 'import' || condition === 'default') return exportTarget(target);
  }
  throw new Error('no import/default package export');
}
export function resolveImport(root: string, from: string, specifier: string, manifest: Manifest): string {
  if (isBuiltin(specifier)) return specifier.startsWith('node:') ? specifier : `node:${specifier}`;
  if (specifier.startsWith('node:')) throw new Error('unknown builtin');
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const path = resolve(dirname(resolve(root, from)), specifier);
    if (!specifier.endsWith('.ts') || /[?#\\]/.test(specifier)) throw new Error('unsupported relative specifier');
    canonicalFile(root, path);
    // Require a lexical canonical relative path as well as a canonical physical file.
    const canonical = relative(dirname(resolve(root, from)), path).replaceAll('\\', '/');
    if (specifier !== (canonical.startsWith('.') ? canonical : `./${canonical}`)) throw new Error('noncanonical relative specifier');
    return relative(root, path).replaceAll('\\', '/');
  }
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(specifier)) throw new Error('unsupported bare specifier');
  if (!(specifier in (manifest.dependencies ?? {})) && !(specifier in (manifest.devDependencies ?? {})) && !(specifier in (manifest.peerDependencies ?? {}))) throw new Error('undeclared package');
  const packageRoot = resolve(root, 'node_modules', specifier);
  const pkg: unknown = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
  if (!object(pkg)) throw new Error('invalid package manifest');
  let target: string;
  if ('exports' in pkg) {
    const exports = pkg.exports;
    target = exportTarget(object(exports) && Object.keys(exports).some(key => key.startsWith('.')) ? exports['.'] : exports);
    if (!target.startsWith('./')) throw new Error('unsupported export target');
  } else {
    if (typeof pkg.main !== 'string' || !pkg.main) throw new Error('missing explicit main');
    target = pkg.main;
  }
  const targetPath = resolve(packageRoot, target);
  canonicalFile(packageRoot, targetPath);
  return specifier;
}
