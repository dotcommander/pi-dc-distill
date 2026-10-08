import { readFileSync, realpathSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { API } from 'typescript/unstable/async';
import { isCallExpression, isExportDeclaration, isIdentifier, isImportDeclaration, isImportEqualsDeclaration, isImportSpecifier, isExportSpecifier, isImportTypeNode, isMetaProperty, isTypeNode, SyntaxKind } from 'typescript/unstable/ast';
import type { Node } from 'typescript/unstable/ast';

export interface Manifest {
  files: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}
export interface ArchitectureResult { files: string[]; edges: Map<string, string[]>; errors: string[] }
const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
const effects = /^(fs|process|child_process|cluster|worker_threads|http|https|http2|net|tls|dgram|dns)(\/|$)/;
const reserved = new Set(['require', 'createRequire', 'getBuiltinModule']);
const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'bun', tsconfig: JSON.stringify({ compilerOptions: { verbatimModuleSyntax: true } }) });
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function contained(root: string, path: string): boolean { const rel = relative(root, path); return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel); }
function canonicalFile(root: string, path: string): string {
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
  const builtin = specifier.replace(/^node:/, '');
  if (builtins.has(builtin)) return `node:${builtin}`;
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
function inspectSyntax(node: Node): void {
  if (isImportTypeNode(node)) { if (node.attributes) throw new Error('import attributes'); return; }
  if (isImportEqualsDeclaration(node)) throw new Error('import-equals');
  if (isImportDeclaration(node) || isExportDeclaration(node)) {
    if (node.attributes) throw new Error('import attributes');
    if (isImportDeclaration(node) && node.importClause?.phaseModifier === SyntaxKind.TypeKeyword) return;
    if (isExportDeclaration(node) && node.isTypeOnly) return;
  }
  if ((isImportSpecifier(node) || isExportSpecifier(node)) && node.isTypeOnly) return;
  if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword) throw new Error('runtime dynamic import');
  if (isMetaProperty(node) && node.keywordToken === SyntaxKind.ImportKeyword) throw new Error('import.meta');
  if (isTypeNode(node)) return;
  if (isIdentifier(node) && reserved.has(node.text)) throw new Error('reserved loader identifier');
  node.forEachChild(child => { inspectSyntax(child); });
}
export async function checkArchitecture(root: string, manifest: Manifest): Promise<ArchitectureResult> {
  root = realpathSync(root);
  const files = manifest.files.filter(file => file.endsWith('.ts'));
  const edges = new Map<string, string[]>();
  const erasedModules = new Set<string>();
  const errors: string[] = [];
  const allowed = new Set(files);
  if (!allowed.has('index.ts') || allowed.size !== files.length) errors.push('invalid production allowlist');
  const api = new API({ cwd: root });
  let snapshot: Awaited<ReturnType<API['updateSnapshot']>> | undefined;
  try {
    snapshot = await api.updateSnapshot({ openFiles: files.map(file => resolve(root, file)) });
    for (const file of files) {
      try {
        const path = canonicalFile(root, resolve(root, file));
        const project = await snapshot.getDefaultProjectForFile(path);
        const sourceFile = await project?.program.getSourceFile(path);
        if (!sourceFile || !project) throw new Error('AST unavailable');
        if ((await project.program.getSyntacticDiagnostics(path)).length) throw new Error('invalid syntax');
        inspectSyntax(sourceFile);
        const emitted = transpiler.transformSync(readFileSync(path, 'utf8'));
        if (!emitted.trim() || /^export\s*\{\s*\}\s*;?$/.test(emitted.trim())) erasedModules.add(file);
        const imports = transpiler.scanImports(emitted);
        const targets: string[] = [];
        for (const item of imports) {
          if (item.kind !== 'import-statement') throw new Error('unsupported emitted loader');
          const target = resolveImport(root, file, item.path, manifest);
          targets.push(target);
          if (target.endsWith('.ts') && !allowed.has(target)) throw new Error(`runtime target outside allowlist: ${target}`);
          if (!target.endsWith('.ts') && !target.startsWith('node:') && target in (manifest.devDependencies ?? {}) && !(target in (manifest.dependencies ?? {})) && !(target in (manifest.peerDependencies ?? {}))) throw new Error(`development-only dependency: ${target}`);
        }
        edges.set(file, targets);
      } catch (error) { errors.push(`${file}: ${error instanceof Error ? error.message : 'architecture failure'}`); }
    }
  } finally { try { await snapshot?.dispose(); } finally { await api.close(); } }
  const reachable = new Set<string>();
  const active = new Set<string>();
  const visited = new Set<string>();
  function visit(file: string): void {
    if (active.has(file)) { errors.push(`runtime cycle: ${file}`); return; }
    if (visited.has(file)) return;
    visited.add(file); active.add(file);
    for (const target of edges.get(file) ?? []) if (allowed.has(target)) visit(target);
    active.delete(file);
  }
  for (const file of files) visit(file);
  function collect(file: string, into: Set<string>): void { if (into.has(file)) return; into.add(file); for (const target of edges.get(file) ?? []) collect(target, into); }
  collect('index.ts', reachable);
  for (const file of files) {
    if (!reachable.has(file) && !erasedModules.has(file)) errors.push(`production file unreachable from root: ${file}`);
    if (file.startsWith('lib/compiler/') || file === 'lib/local-compact.ts') {
      const deps = new Set<string>(); collect(file, deps);
      for (const target of deps) if (target === 'lib/sdk.ts' || target.startsWith('lib/runtime/') || target.startsWith('@earendil-works/') || effects.test(target.replace(/^node:/, ''))) errors.push(`${file}: compiler effect reachable: ${target}`);
    }
  }
  return { files, edges, errors: [...new Set(errors)] };
}
