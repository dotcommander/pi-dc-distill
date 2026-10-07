/** Runtime architecture. Tests and offline diagnostics have their own effects. */
module.exports = {
  forbidden: [
    {
      name: 'no-unresolved-production-imports', severity: 'error',
      comment: 'Unresolved runtime edges cannot silently escape the architecture graph.',
      from: { path: '^(index\\.[jt]s|lib/)', pathNot: '(\\.test\\.[jt]s$)' },
      to: { couldNotResolve: true },
    },
    {
      name: 'no-runtime-cycles', severity: 'error',
      comment: 'Production modules must have an acyclic runtime dependency graph.',
      from: { path: '^(index\\.[jt]s|lib/)', pathNot: '(\\.test\\.[jt]s$)' },
      to: { circular: true, dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'compiler-no-effects', severity: 'error',
      comment: 'The deterministic compiler cannot import filesystem, process, network, host runtime or storage effects.',
      from: { path: '^lib/(compiler/|local-compact\\.[jt]s$)', pathNot: '\\.test\\.[jt]s$' },
      to: {
        path: '^(node:)?(fs|process|child_process|cluster|worker_threads|http|https|http2|net|tls|dgram|dns)(/|$)|^lib/(sdk)\\.[jt]s$|^@earendil-works/',
        reachable: true,
      },
    },
    {
      name: 'production-no-development-dependencies', severity: 'error',
      comment: 'Runtime code may use declared host peers, but never development-only packages.',
      from: { path: '^(index\\.[jt]s|lib/)', pathNot: '(\\.test\\.[jt]s$)' },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['npm-peer', 'type-only'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.test\\.[jt]s$' },
    tsPreCompilationDeps: false,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { extensions: ['.ts', '.js', '.json'], conditionNames: ['import', 'default'] },
  },
};
