# dc-shrink Settings and Data

Create or edit `~/.pi/data/dc-shrink/settings.json`:

```json
{
  "cacheTtlMs": 120000,
  "autoThresholdTokens": 100000,
  "warnThresholdTokens": 140000,
  "emergencyThresholdTokens": 160000,
  "autoThresholdPct": 0.75,
  "warnThresholdPct": 0.85,
  "emergencyThresholdPct": 0.92,
  "dumpCompactions": false,
  "dumpRetention": 20
}
```

Settings load at extension startup and again when the primary session starts.

## Settings

| Setting | Default | Normalization |
| --- | ---: | --- |
| `cacheTtlMs` | `120000` | Rounded and clamped to `10000`-`3600000`. |
| `autoThresholdTokens` | `100000` | Rounded and clamped to `10000`-`160000`. |
| `warnThresholdTokens` | `140000` | Clamped to `11000`-`320000` and at least auto + `1000`. |
| `emergencyThresholdTokens` | `160000` | Clamped to `12000`-`500000` and at least warn + `1000`. |
| `autoThresholdPct` | `0.75` | Clamped to `0.50`-`0.95`. |
| `warnThresholdPct` | `0.85` | Clamped to `0.50`-`0.97` and at least auto + `0.01`. |
| `emergencyThresholdPct` | `0.92` | Clamped to `0.60`-`0.98` and at least warn + `0.01`. |
| `dumpCompactions` | `false` | Non-boolean values fall back to the previous/default value. Explicit `true` is preserved. |
| `dumpRetention` | `20` | Rounded and clamped to `0`-`500`. |

Each effective token boundary is the minimum of its absolute value and the
rounded percentage of the active context window. `/compact-status` shows the
effective value and both sources. `cacheTtlMs` affects autonomous compaction
only; manual `/compact` ignores it.

## Durable Storage

`ShrinkStore` owns logs, dumps, migration, and recall.

| File or directory | Purpose |
| --- | --- |
| `~/.pi/data/dc-shrink/settings.json` | User settings. |
| `~/.pi/data/dc-shrink/compact-log.jsonl` | Locked, rotation-safe failure and committed-success log. |
| `~/.pi/data/dc-shrink/compact-dumps/` | Opt-in canonical-input/returned-summary pairs. |
| `Path.project("dc-shrink", cwd)/recall.json` | Ten newest committed summaries for one project. |
| `~/.pi/data/dc-shrink/recall.json` | Preserved ownerless legacy recall. |
| `~/.pi/data/dc-shrink/.migrated-from-legacy-shrink` | Successful migration marker. |
| `~/.pi/data/dc-shrink/.legacy-migration-conflicts/` | Preserved non-mergeable legacy conflicts. |

Recall read-modify-write and log/dump operations use locks and atomic framework
writes. Version-6 recall records include project, session ID, before tokens,
rebuilt-message after tokens, optional full-context after tokens, token source,
and the exact returned summary.

## Retryable Migration

Migration runs during store initialization/session start, never when the module
is imported.

- Missing files are copied into the current directory.
- Global historical recall remains ownerless legacy data; dc-shrink does not
  guess a project owner.
- JSONL data is merged without duplicate lines.
- Other conflicts preserve the current file and copy legacy data under
  `.legacy-migration-conflicts/`.
- The legacy directory is not deleted.
- The completion marker is written only after every operation succeeds.

If any migration or marker write fails, source and current data remain intact,
no completion marker is left, diagnostics record the failure, and startup
retries later. Conversion is idempotent.

## Compaction Log

Committed success entries distinguish rebuilt-message after tokens from Pi's
optional post-hook full-context tokens and record their source. They also carry
the pre-compact API snapshot, counts, strategy, digest information, and bounded
summary metadata. Failure entries may be written before host commit; success
entries may not.

## Dumps

Raw dumps are off by default. When explicitly enabled, a committed compaction
writes:

```text
compact-dumps/<millisecond-time>-<pid>-<attempt>-before.jsonl
compact-dumps/<millisecond-time>-<pid>-<attempt>-after.txt
```

The before file contains the compiler's canonical input bytes verbatim. The
after file contains the exact metric-prefixed wire summary returned to Pi.
Temporary files are renamed under a lock so partial pairs are not exposed and
same-millisecond attempts cannot collide. `dumpRetention` counts complete pairs;
`0` prunes all retained pairs after a new dump attempt.
