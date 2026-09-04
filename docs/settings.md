# pi-dc-distill Policy and Data

[README](../README.md) · [Usage](usage.md) · [Troubleshooting](troubleshooting.md)

`dc-distill` has no extension configuration. It reads Pi's effective global and
project compaction settings at primary-session start:

```text
~/.pi/agent/settings.json
<project>/.pi/settings.json
```

The project file overrides individual keys from the global file, matching Pi's
compaction settings merge. Legacy `extensionConfig["dc-distill"]` values such as
`autoThresholdTokens` are not read; remove them rather than relying on a dead
parallel policy.

To disable automatic compaction, merge this into Pi's global or project settings:

```json
{
  "compaction": {"enabled": false}
}
```

Start a new primary session after changing these settings; dc-distill reads them
at session start. Manual `/compact` remains available.

## Trigger Policy

| Pi setting | Default | dc-distill behavior |
| --- | ---: | --- |
| `compaction.enabled` | `true` | When `false`, dc-distill's autonomous monitor stands down. Manual `/compact` remains available. |
| `compaction.reserveTokens` | `16384` | Pi trigger is `contextWindow - reserveTokens`; the normal auto boundary is capped 20,000 tokens before it; small-window floors are an exception. |

`compaction.keepRecentTokens` controls Pi's retained tail at cut selection, not its trigger, so it does not change dc-distill's 20,000-token lead.

dc-distill prefers a fixed 120,000-token auto boundary and caps it lower when
needed to preserve that 20,000-token lead for normal-sized contexts. For example, with a 272,000-token model and `reserveTokens: 50000`, Pi's native trigger remains 222,000 while dc-distill
auto-compacts at 120,000. With a 128,000-token model and the same reserve, the
safe dc-distill boundary is 58,000 (`128000 - 50000 - 20000`).

Emergency compaction is the reported Pi context-window limit. It bypasses
cooldown and Pi-sync guards. Very small windows use fixed internal floors to
keep auto, warn, and emergency ordered. If an older Pi cannot report a context
window, dc-distill falls back to 100,000 / 140,000 / 160,000 tokens.

The monitor retains a fixed 120-second cooldown and post-compaction growth
guard. These are loop-safety mechanics, not user settings. `auto-check blocked`
lines in `~/.pi/data/dc-distill/diag.log` record the resolved geometry and its
Pi inputs.

## Diagnostic Dumps

Raw dumps are disabled by default. Set `DC_DISTILL_DUMPS=1` in the Pi process
environment to enable them. dc-distill retains 20 complete pairs; retention is
fixed. Dumps can contain discarded conversation context, so enable them only
when that local storage is appropriate.

Existing `extensionConfig["dc-distill"]` blocks and
`~/.pi/data/dc-distill/settings.json` are no longer read. They are preserved;
dc-distill never deletes user settings files.

## Durable Storage

Storage is local. Recall summaries, full tool outputs, logs, and optional raw
dumps can contain conversation or project content. Disabling raw dumps does
not disable recall or tool-output storage.

`DistillStore` owns logs, dumps, migration, and recall.

| File or directory | Purpose |
| --- | --- |
| `~/.pi/data/dc-distill/diag.log` | Guard, lifecycle, and migration diagnostics. |
| `~/.pi/data/dc-distill/compact-log.jsonl` | Locked, rotation-safe failure and committed-success log. |
| `~/.pi/data/dc-distill/compact-dumps/` | Optional canonical-input/returned-summary pairs. |
| `~/.pi/data/dc-distill/projects/<slug>/recall.json` | Ten newest committed summaries for one project. |
| `~/.pi/data/dc-distill/projects/<slug>/tool-output/` | Full oversized tool text and `index.jsonl` provenance records. |
| `~/.pi/data/dc-distill/recall.json` | Preserved ownerless legacy recall. |
| `~/.pi/data/dc-distill/.migrated-from-legacy-distill` | Successful older-namespace migration marker. |
| `~/.pi/data/dc-distill/.migrated-from-dc-shrink` | Successful prior-brand migration marker. |
| `~/.pi/data/dc-distill/.legacy-migration-conflicts/` | Preserved non-mergeable legacy conflicts. |

`<slug>` is the sanitized project-directory basename (up to 24 characters)
plus the first eight hex characters of SHA-256 of its path. Project identity
uses Pi's session working directory; these files are stored under the home
directory, outside the project checkout.

Recall keeps ten newest summaries per project; enabled raw dumps keep 20 pairs.
Tool-output artifacts have no automatic retention limit in the current implementation.

Recall read-modify-write and log/dump operations use locks and atomic framework
writes. Version-6 recall records include project, session ID, before tokens,
rebuilt-message after tokens, optional full-context after tokens, token source,
and the exact returned summary.

## Retryable Migration

This section concerns existing installations with historical compaction data. New users
do not need to perform a migration step.

Migration runs during store initialization/session start, never when the module
is imported. It copies `~/.pi/data/dc-shrink/` and the older `dc-crunch` namespace
into `~/.pi/data/dc-distill/`, with a separate completion marker for each source.
Stop using the old extension before starting the new one; this is a one-time
copy, not ongoing synchronization. It needs space for the copied artifacts.

- Missing active data files are copied into the current directory; obsolete legacy `settings.json` stays in place.
- Global historical recall remains ownerless legacy data; dc-distill does not
  guess a project owner.
- Global and project recall are merged by record identity, keeping ten newest entries.
- JSONL data is merged without duplicate lines.
- Historical summaries, artifact paths, and session entries are not rewritten. Old artifact paths continue to work because source files remain in place.
- Obsolete migration flags and transient lock/temp files are excluded.
- Other conflicts preserve the current file and copy legacy data under
  `.legacy-migration-conflicts/`; prior-brand conflicts are isolated under its source namespace.
- The legacy directory is not deleted.
- The completion marker is written only after every operation succeeds.

If any migration or marker write fails, source and current data remain intact,
no completion marker is written for that source, diagnostics record the failure, and startup
retries later. Conversion is idempotent.

## Compaction Log and Dumps

Committed success entries distinguish rebuilt-message after tokens from Pi's
optional post-hook full-context tokens and record their source. They also carry
the pre-compact API snapshot, counts, strategy, digest information, and bounded
summary metadata. Failure entries may be written before host commit; success
entries may not.

When `DC_DISTILL_DUMPS=1`, each committed compaction writes:

```text
compact-dumps/<millisecond-time>-<pid>-<attempt>-before.jsonl
compact-dumps/<millisecond-time>-<pid>-<attempt>-after.txt
```

The before file contains the compiler's canonical input bytes verbatim. The
after file contains the exact metric-prefixed wire summary returned to Pi.
Temporary files are renamed under a lock so partial pairs are not exposed and
same-millisecond attempts cannot collide.

## Upgrading from pi-dc-shrink

Disable the old extension before loading pi-dc-distill. For npm installs, remove
`npm:pi-dc-shrink`; for Git/local installs, identify the source with `pi list`
and update or replace that entry. Do not load both packages in one session.

| Previous interface | Current interface |
| --- | --- |
| `pi-dc-shrink` | `pi-dc-distill` |
| `dc-shrink-session` | `dc-distill-session` |
| `shrink:session`, `shrink:demo`, `shrink:e2e` | `distill:session`, `distill:demo`, `distill:e2e` |
| `save_shrink_handoff` | `save_distill_handoff` |
| `shrink-handoff-v1/v2` | `distill-handoff-v1/v2` |
| `DC_SHRINK_DUMPS` | `DC_DISTILL_DUMPS` |

Pi's `/compact`, `recall_compaction`, and compaction settings are unchanged.
Historical handoff/session identifiers and output receipts remain readable.
The old dump variable is a fallback; an explicitly set new variable takes
precedence. The diagnostic logging helper accepts `DC_DISTILL_DATA_DIR`, with
`DC_SHRINK_DATA_DIR` as a fallback. This helper override does not relocate all
runtime storage.

Startup copies historical recall, logs, and artifacts into `dc-distill` without
deleting sources. Old guard diagnostics in `~/.pi/data/pi-dc-shrink/` remain
there; new guard diagnostics use `~/.pi/data/pi-dc-distill/`. See
[retryable migration](#retryable-migration) for conflicts and storage requirements.
