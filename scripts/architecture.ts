import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { API } from 'typescript/unstable/async';
import { isCallExpression, isExportDeclaration, isIdentifier, isImportDeclaration, isImportEqualsDeclaration, isImportSpecifier, isExportSpecifier, isImportTypeNode, isMetaProperty, isTypeNode, SyntaxKind } from 'typescript/unstable/ast';
import type { Node } from 'typescript/unstable/ast';

import { canonicalFile, resolveImport } from './architecture-resolve.ts';
import type { Manifest } from './architecture-resolve.ts';

export type { Manifest } from './architecture-resolve.ts';
export interface ArchitectureResult { files: string[]; edges: Map<string, string[]>; errors: string[] }
const effects = /^(fs|process|child_process|cluster|worker_threads|http|https|http2|net|tls|dgram|dns)(\/|$)/;
const reserved = new Set(['require', 'createRequire', 'getBuiltinModule']);
const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'bun', tsconfig: JSON.stringify({ compilerOptions: { verbatimModuleSyntax: true } }) });
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
