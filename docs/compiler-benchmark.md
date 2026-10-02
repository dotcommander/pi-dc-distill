# Local deterministic compiler benchmark

Run this opt-in workload locally with Bun. It uses synthetic data, never launches
Pi, and never contacts a provider. No benchmark runs during `bun test`.

```sh
bun scripts/benchmark-compiler.ts .work/compiler-benchmark before
# Apply the scoped compiler optimization.
bun scripts/benchmark-compiler.ts .work/compiler-benchmark after
bun scripts/benchmark-compiler.ts --compare .work/compiler-benchmark/before.json .work/compiler-benchmark/after.json
```

The first run seals each source as an exclusive-create JSON file. Later runs reuse
those exact bytes. Receipts also use exclusive creation, so choose a fresh label
for each run; do not overwrite earlier evidence. The workloads cover ordinary
compilation, many records exceeding 20 MiB, an individual oversized record, and
budget pressure with verification invalidated by later successful edits.

Each receipt records Bun version/platform/architecture, input SHA-256 and byte
size, canonical bytes' SHA-256/size/scope/count, and the **complete compiler
result**, including exact summary bytes and both digests. One unmeasured warmup
precedes three samples per workload. Samples include wall time, process CPU user
and system microseconds, memory before/after, and process resource usage. Timing
covers canonicalization and compilation together; input parsing and result
comparison are outside timing. Max RSS is the process cumulative high-water mark,
not an isolated workload allocation measurement. Other memory measurements are
snapshots, not allocation totals. Short samples are sensitive to noise.

The comparison command checks runtime identity, workload names, sealed input
hashes/sizes, canonical metadata, and every compiler-result field. It intentionally
ignores sample timings and resource measurements when testing exact parity.
Retain raw receipts under ignored `.work/`, rather than committing large inputs
or machine-specific results. These synthetic results do not establish installed
Pi runtime performance.

## Phase 1 measurement, 2026-10-01

Matched Bun 1.4.0 runs on Darwin arm64 used the sealed inputs in
`.work/compiler-benchmark/`. Baseline `before-v2.json` preceded production edits;
`after.json` followed envelope, code-point, and line-count changes. Complete
results and canonical hashes matched on all four workloads.

| Workload | Input bytes | Before median ms | After median ms | Before median CPU µs | After median CPU µs |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ordinary | 4,883 | 0.906 | 0.681 | 2,897 | 2,480 |
| Many records | 26,194,063 | 1,285.790 | 483.676 | 1,353,122 | 497,311 |
| Oversized record | 22,020,411 | 7.660 | 3.432 | 8,461 | 4,053 |
| Budget pressure | 59,098 | 1.177 | 0.944 | 1,565 | 1,393 |

The many-record wall-time ranges were 1,263.5–1,324.6 ms before and
469.9–487.1 ms after: a clear improvement on this local synthetic workload.
The submillisecond-to-few-millisecond cases remain inconclusive for general
performance claims. Raw receipts retain memory data, but cumulative process
high-water marks and sequential workloads do not support per-workload allocation
claims. Budget eviction remains one record at a time with resume refresh after
every removal; the 7,168-point target and 65,300-point compiler cap are unchanged.
