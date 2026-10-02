# pi-dc-distill Policy and Data

[README](../README.md) · [Usage](usage.md) · [Troubleshooting](troubleshooting.md)

`dc-distill` has no extension-specific trigger configuration. Production reads
`pi.getSettings()`, Pi's effective global/project settings snapshot including host
overrides and the configured agent directory. It does not read settings files itself.

Compaction settings refresh at owner-session start, on model selection, and before
each autonomous check. Token values follow Pi 0.99.2 precedence: the active
`provider/id` model override, then the ordinary setting, then Pi's default
(`reserveTokens: 16384`, `keepRecentTokens: 20000`). Token values must be
non-negative safe integers; zero is valid. Ordinary and matching override values
are validated even when an override wins. Invalid settings or an unavailable
snapshot block autonomous checks with a diagnostic; manual deterministic
interception remains available. `compaction.enabled` defaults to true and must
be boolean when supplied. No settings are written by dc-distill.

Optional feature gates remain owner-start snapshots. Legacy trigger keys such as
`extensionConfig["dc-distill"].autoThresholdTokens` remain ignored.

## Optional feature settings

Both optional features default to `false`. Only explicit boolean values are
accepted; strings such as `"true"` do not enable them. Merge into the global
agent `settings.json` or `<project>/.pi/settings.json` and restart the session:

```json
{
  "extensionConfig": {
    "dc-distill": {
      "toolOutput": {"enabled": true},
      "recall": {"enabled": true}
    }
  }
}
```

| Setting | Default | Enabled behavior |
| --- | --- | --- |
| `extensionConfig["dc-distill"].toolOutput.enabled` | `false` | Owner-session oversized tool text is persisted, indexed, and replaced with a recoverable preview. |
| `extensionConfig["dc-distill"].recall.enabled` | `false` | Matching compaction commits save project recall; `recall_compaction` can read/search it; an extra bounded focus echo may be injected from the active compaction summary. |

The switches are independent and merge per leaf: a project can enable recall
while leaving a global tool-output opt-in unchanged, or explicitly disable
either. Optional feature settings are startup snapshots, not live toggles. Previously default-on behavior
is not treated as an opt-in; existing files are preserved without being deleted.

When tool output is off, its hook returns before reading result content or
writing artifacts. When recall is off, there is no new recall persistence,
no recall store read through the tool, no extra focus echo, and live summaries
omit recall-tool suggestions/queries. The tool remains registered and reports
how to enable recall. Pi's native compaction summary, saved handoffs, core
logs/details, and autonomous continuation/recovery are independent and remain.
The offline evaluator is pure diagnostic compilation: its compatibility output
can include recall hints without reading or writing the runtime recall store.

Legacy migration currently copies whole namespaces and uses whole-source
completion markers. Automatic migration is therefore deferred unless **both**
features are enabled; partial copying must not finalize those markers. Either
feature works independently with new/current data. Opting into only one does
not automatically copy legacy data; opting into both on a later startup retries
the complete migration, including historical logs/dumps. Source data is left
intact. Core logging works without migration.


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
warmup, cooldown, Pi-sync, and growth guards; valid enabled settings, ownership,
and concurrency guards still apply. Very small windows use fixed internal floors to
keep auto, warn, and emergency ordered. If an older Pi cannot report a context
window, dc-distill falls back to 100,000 / 140,000 / 160,000 tokens.

The monitor retains a fixed 120-second cooldown and post-compaction growth
guard. These are loop-safety mechanics, not user settings. `auto-check blocked`
lines in `~/.pi/agent/data/dc-distill/diag.log` record the resolved geometry and its
Pi inputs.

## Diagnostic Dumps

Raw dumps are disabled by default. Set `DC_DISTILL_DUMPS=1` in the Pi process
environment to enable them. dc-distill retains 20 complete pairs; retention is
fixed. Dumps can contain discarded conversation context, so enable them only
when that local storage is appropriate.

Only the two optional feature gates in `extensionConfig["dc-distill"]` are read.
Historical trigger keys and `~/.pi/data/dc-distill/settings.json` remain ignored
and preserved; dc-distill never deletes user settings files.

## Durable Storage

Storage is local. Core logs, opt-in recall summaries, opt-in full tool outputs,
and optional raw dumps can contain conversation or project content. Recall,
tool outputs, and raw dumps have independent opt-ins; disabling one does not
delete previously stored files or disable the others.

`DistillStore` owns logs, dumps, migration, and recall.

| File or directory | Purpose |
| --- | --- |
| `~/.pi/agent/data/dc-distill/diag.log` | Guard, lifecycle, and migration diagnostics. |
| `~/.pi/agent/data/dc-distill/compact-log.jsonl` | Locked, rotation-safe failure and committed-success log. |
| `~/.pi/agent/data/dc-distill/compact-dumps/` | Optional canonical-input/returned-summary pairs. |
| `~/.pi/agent/data/dc-distill/projects/<slug>/recall.json` | Ten newest committed summaries for one project. |
| `~/.pi/agent/data/dc-distill/projects/<slug>/tool-output/` | Full oversized tool text and `index.jsonl` provenance records. |
| `~/.pi/agent/data/dc-distill/recall.json` | Preserved ownerless legacy recall. |
| `~/.pi/agent/data/dc-distill/.migrated-from-legacy-distill` | Successful older-namespace migration marker. |
| `~/.pi/agent/data/dc-distill/.migrated-from-dc-shrink` | Successful prior-brand migration marker. |
| `~/.pi/agent/data/dc-distill/.migrated-from-legacy-location-dc-distill` | Successful migration from the previous data location. |
| `~/.pi/agent/data/dc-distill/.legacy-migration-conflicts/` | Preserved non-mergeable legacy conflicts. |

`<slug>` is the sanitized project-directory basename (up to 24 characters)
plus the first eight hex characters of SHA-256 of its path. Project identity
uses Pi's session working directory; these files are stored under the home
directory, outside the project checkout.

Enabled recall keeps ten newest summaries per project; enabled raw dumps keep 20 pairs.
Tool-output artifacts have no automatic retention limit in the current implementation.

Recall read-modify-write, migration and live log/dump operations share destination
locks. Atomic publication preserves the destination on failure. Lock metadata is
published complete with a nonce and file identity; ambiguous or dead-owner locks
remain untouched until proven-quiescent cleanup. Crashes can leave incomplete
flat dump pairs; unmatched files do not evict complete retained pairs.

New recall records include optional host entry ID, summary digest and attempt ID
for replay identity. Historical records remain readable and unchanged. Records
include project, session ID, before tokens,
rebuilt-message after tokens, optional full-context after tokens, token source,
and the exact returned summary.

## Retryable Migration

This section concerns existing installations with historical compaction data. New users
do not need to perform a migration step.

With both optional features enabled, migration runs during store initialization/
session start, never when the module is imported. Otherwise it is deferred. It copies `~/.pi/data/dc-shrink/` and the older `dc-crunch` namespace
into `~/.pi/agent/data/dc-distill/`, with a separate completion marker for each source.
The default profile also copies the old `~/.pi/data/dc-distill/` location, using
`.migrated-from-legacy-location-dc-distill`. Existing brand markers do not skip
this location migration. Custom `PI_CODING_AGENT_DIR` profiles inspect only
legacy namespaces under their own `data/`; they never automatically import
shared HOME data. Sources and historical absolute artifact references remain
unchanged. New writes move immediately even while optional-feature gates defer
migration. Reverting code does not merge newly written state back into old storage.
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
after file contains the exact metric-free wire summary returned to Pi.
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
there; new guard diagnostics use `~/.pi/agent/data/dc-distill/`. See
[retryable migration](#retryable-migration) for conflicts and storage requirements.
