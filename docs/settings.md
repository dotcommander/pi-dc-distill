# dc-shrink Policy and Data

`dc-shrink` has no extension configuration. It reads Pi's effective global and
project compaction settings at primary-session start:

```text
~/.pi/agent/settings.json
<project>/.pi/settings.json
```

The project file overrides individual keys from the global file, matching Pi's
compaction settings merge. Legacy `extensionConfig["dc-shrink"]` values such as
`autoThresholdTokens` are not read; remove them rather than relying on a dead
parallel policy.

## Trigger Policy

| Pi setting | Default | dc-shrink behavior |
| --- | ---: | --- |
| `compaction.enabled` | `true` | When `false`, dc-shrink's autonomous monitor stands down. Manual `/compact` remains available. |
| `compaction.reserveTokens` | `16384` | Pi trigger is `contextWindow - reserveTokens`; dc-shrink stays at least 20,000 tokens before it. |

`compaction.keepRecentTokens` controls Pi's retained tail at cut selection, not its trigger, so it does not change dc-shrink's 20,000-token lead.

dc-shrink prefers a fixed 120,000-token auto boundary and caps it lower when
needed to preserve that 20,000-token lead. With the active 272,000-token model
and `reserveTokens: 50000`, Pi's native trigger remains 222,000 while dc-shrink
auto-compacts at 120,000. With a 128,000-token model and the same reserve, the
safe dc-shrink boundary is 58,000 (`128000 - 50000 - 20000`).

Emergency compaction is the reported Pi context-window limit. It bypasses
cooldown and Pi-sync guards. Very small windows use fixed internal floors to
keep auto, warn, and emergency ordered. If an older Pi cannot report a context
window, dc-shrink falls back to 100,000 / 140,000 / 160,000 tokens.

The monitor retains a fixed 120-second cooldown and post-compaction growth
guard. These are loop-safety mechanics, not user settings. `auto-check blocked`
lines in `~/.pi/data/dc-shrink/diag.log` record the resolved geometry and its
Pi inputs.

## Diagnostic Dumps

Raw dumps are disabled by default. Set `DC_SHRINK_DUMPS=1` in the Pi process
environment to enable them. dc-shrink retains 20 complete pairs; retention is
fixed. Dumps can contain discarded conversation context, so enable them only
when that local storage is appropriate.

Existing `extensionConfig["dc-shrink"]` blocks and
`~/.pi/data/dc-shrink/settings.json` are no longer read. They are preserved;
dc-shrink never deletes user settings files.

## Durable Storage

`ShrinkStore` owns logs, dumps, migration, and recall.

| File or directory | Purpose |
| --- | --- |
| `~/.pi/data/dc-shrink/compact-log.jsonl` | Locked, rotation-safe failure and committed-success log. |
| `~/.pi/data/dc-shrink/compact-dumps/` | Optional canonical-input/returned-summary pairs. |
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

- Missing active data files are copied into the current directory; obsolete legacy `settings.json` stays in place.
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

## Compaction Log and Dumps

Committed success entries distinguish rebuilt-message after tokens from Pi's
optional post-hook full-context tokens and record their source. They also carry
the pre-compact API snapshot, counts, strategy, digest information, and bounded
summary metadata. Failure entries may be written before host commit; success
entries may not.

When `DC_SHRINK_DUMPS=1`, each committed compaction writes:

```text
compact-dumps/<millisecond-time>-<pid>-<attempt>-before.jsonl
compact-dumps/<millisecond-time>-<pid>-<attempt>-after.txt
```

The before file contains the compiler's canonical input bytes verbatim. The
after file contains the exact metric-prefixed wire summary returned to Pi.
Temporary files are renamed under a lock so partial pairs are not exposed and
same-millisecond attempts cannot collide.
