> Historical archive only. This benchmark and its commands are retired and excluded from the current contract and package. Preserve existing receipts; they do not establish current acceptance. See [current docs](README.md).

# Local deterministic compiler benchmark

Run this opt-in workload locally with Bun. It uses synthetic data, never launches
Pi, and never contacts a provider. No benchmark runs during `bun test`.

```sh
bun scripts/benchmark-compiler.ts ~/.pi/agent/cache/dc-distill/benchmark before
# Apply the scoped compiler optimization.
bun scripts/benchmark-compiler.ts ~/.pi/agent/cache/dc-distill/benchmark after
bun scripts/benchmark-compiler.ts --compare ~/.pi/agent/cache/dc-distill/benchmark/before.json ~/.pi/agent/cache/dc-distill/benchmark/after.json
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
Keep benchmark output explicit under the selected agent cache, rather than committing large inputs
or machine-specific results. These synthetic results do not establish installed
Pi runtime performance.

## Historical Phase 1 measurement, 2026-10-01

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

## Current checkpoint performance gate

The current gate permits semantic changes to summaries and checkpoint state;
it is separate from the historical three-sample exact-parity comparison above.
It seals ordinary and near-limit inputs and uses one isolated worker per
workload, 10 warmups, and 30 sequential measured samples. Workers preload the
same installed Pi coding-agent SDK before loading the selected compiler. Receipts
include runtime and SDK identity, input hashes, options, complete output or typed
rejection, p50/p95 latency, CPU samples, host preload, compiler-load overhead, and
absolute lifetime RSS high-water.

Prepare a baseline from a specifically identified source tree, using the current
worker and the same installed SDK. The baseline must represent the comparison
you intend to claim; an older committed tree cannot prove the delta against an
unavailable dirty version-12 tree. Keep its revision/source identity with the
receipt. Use an existing isolated baseline tree; these commands do not create or
change a checkout.

```sh
# First seal the candidate inputs. Without a baseline, this exits nonzero
# with "ordinary baseline receipt not supplied"; it is not acceptance.
bun run distill:performance /absolute/path/to/artifacts seal-v13
# Measure the baseline compiler on the same sealed ordinary input and SDK.
bun scripts/benchmark-compiler.ts --checkpoint-worker /absolute/path/to/artifacts/ordinary.input.json baseline /absolute/path/to/baseline-tree > /absolute/path/to/artifacts/baseline-ordinary.json
# Wrap the worker result in the checkpoint receipt shape expected by the gate.
bun -e 'const p=process.argv[1]; await Bun.write(process.argv[2], JSON.stringify({ordinary:await Bun.file(p).json()}, null, 2));' /absolute/path/to/artifacts/baseline-ordinary.json /absolute/path/to/artifacts/baseline.checkpoint.json
bun run distill:performance /absolute/path/to/artifacts candidate-v13 /absolute/path/to/artifacts/baseline.checkpoint.json
```

Choose fresh paths/labels for baseline wrappers as well as worker receipts;
never overwrite retained evidence. The candidate run reuses the sealed input
bytes. A matched ordinary gate checks exact input hash, runtime, and options
(including preload SDK version), then accepts p50 and p95 no higher than the
larger of baseline × 1.10 or baseline + 1 ms. The RSS limit is baseline absolute
peak plus 8 MiB. Near-limit bounded processing and typed protected-overflow
rejections are evaluated separately and do not establish ordinary latency
acceptance.

RSS acceptance uses absolute lifetime high-water in both processes. There is no
forced-GC correction or subtraction from the acceptance metric. Reported
incremental host-subtracted RSS is advisory: a previous host peak can hide
allocations below that peak. A result near the absolute RSS limit needs its raw
receipt and margin reported; it does not establish a durable performance margin
or installed interactive-host behavior. These synthetic measurements do not
prove ordinary version-12-to-version-13 cost unless that exact baseline was
available and measured under the matching geometry.

Caching adoption uses a separate matched pair after feature changes are complete.
Freeze the feature-complete **uncached** compiler tree before applying caching;
compare it with the cached tree using the current harness. The original frozen
pre-feature baseline remains the ordinary latency/RSS reference for feature cost.
Do not require output parity across intentional feature changes.

The 2026-10-04 candidate resume-render cache was rejected and is not adopted;
production remains uncached. All seven workload parity comparisons and the
ordinary gate passed, but budgetPressureV2 p50 improved only 2.74%, below the
required 10%. Absolute lifetime RSS also exceeded the baseline +8 MiB limits
for manyRecords (1,591,476,224 bytes versus a 1,463,992,320-byte limit) and
oversizedRecord (693,043,200 bytes versus a 581,566,464-byte limit). The retained
gate receipt is `/private/tmp/dc-distill-verify-d3g1_y6z/final/cache-gate.json`;
its paired worker receipts and source manifests identify the compared trees.
The comparison tooling below remains available for future candidates.

```sh
# Seal only: no compiler imports or measurements, preserves existing input bytes.
bun scripts/benchmark-compiler.ts --seal /private/tmp/distill-bench seal
# Optional final argument selects compiler source independently of harness/SDK.
bun scripts/benchmark-compiler.ts --checkpoint /private/tmp/distill-bench uncached /private/tmp/original.checkpoint.json /private/tmp/feature-uncached-tree
bun scripts/benchmark-compiler.ts --checkpoint /private/tmp/distill-bench cached /private/tmp/original.checkpoint.json /path/to/candidate
bun scripts/benchmark-compiler.ts --cache-gate /private/tmp/distill-bench/uncached.checkpoint.json /private/tmp/distill-bench/cached.checkpoint.json
```

For one added workload, reuse the seal and invoke
`--checkpoint-worker <sealed-input-path> baseline <compiler-root>` directly;
this avoids repeating unchanged ordinary measurements. Worker stdout is a JSON
receipt; preserve it with exclusive file creation. Assemble `ordinary` and
`nearLimit` only from matching worker receipts. The caching gate requires 10
warmups and 30 samples per worker, at least 10% budgetPressureV2 p50 improvement,
ordinary p50/p95 within `max(baseline * 1.10, baseline + 1 ms)`, and absolute
lifetime RSS no more than baseline +8 MiB for each workload. It compares complete
canonical identities, result objects (including Unicode summary, readiness,
omission order and checkpoint), and typed protected-overflow rejections. The
pressure workload combines verification invalidated by later edits with historical
optional milestones. unicodeLexical, readinessIdentity and protectedOverflow are
required separate parity workloads; their omission fails the caching gate. Independent checkpoint
quality fixtures also preserve readiness requirements and repeated carry.

Receipts record the absolute compiler source root and diagnostic scratch Pi
profile. Before imports, scripts reserve private temporary agent/session dirs,
so diagnostic writes do not target an active Pi profile. Retain a source manifest
hash and revision alongside every frozen tree: a path alone is not immutable
source identity. Both workers preload the same project-local SDK through the
current harness, even when the compiler comes from another tree; do not compare
workers launched with different harnesses or SDK installations. Source manifests
must include pre-existing dirty files that affect the compiler.

The checkpoint quality corpus separates mandatory declared-state fidelity from
undeclared request context. Its independently authored oracle checks long and
multilingual requests, leading references, late restrictions, explicit corrections,
source identities, forged marker text, and five-generation authenticated carry.
Request context must never become checkpoint tasks, pins, or authorization.
These checks prove bounded synthetic retention and parity; they do not establish
model attention, installed-host behavior, production throughput, or provider
acceptance. Pressure speedup alone does not establish a dominant production cost.

## Retired selector paths and baseline quality

`--semantic`, `--semantic-worker`, and checkpoint-worker selection `coverage`
are retired and produce a nonzero error. The checkpoint worker retains its
positional `baseline` sentinel and schema-4 `selection: "baseline"` metadata.
Ordinary benchmarks, `--checkpoint`, `--checkpoint-worker`, `--seal`, `--gate`,
`--cache-gate`, and `--compare` retain their input, preload, sampling and absolute
lifetime RSS contracts. Removing selector code makes no speed or memory claim.

`bun run distill:quality <artifact-directory> <unique-label>` runs baseline-only
quality: 13 fixtures × two focus settings × two recall settings = 52 comparisons,
with three deterministic repeats per comparison. The nested optional report uses
schema 2, one baseline result per comparison, and
`pressure: { baselineHits, total }`; aggregate schema 4 retains checkpoint, survival,
optional, passed and failure reporting. Checkpoint/survival report schemas, receipt
filenames, seals and exclusive fresh-label writes remain unchanged. No comparative
improvement or adoption threshold is reported. Historical receipts still describe
their original algorithms and are not rewritten.
