# dc-shrink

Compact the current Pi session with a focus hint:

```text
/compact preserve the bug report, current file edits, and next verification step
```

Check autonomous compaction state:

```text
/compact-status
```

`dc-shrink` replaces Pi's default LLM-backed compactor with a deterministic
local TypeScript compiler. Pi owns `/compact`, cut selection, append, and
context rebuilding. dc-shrink compiles only the discarded active-branch input
Pi provides in `event.preparation`; it never reads the append-only session file
or calls an LLM. The package is standalone and has no dependency on another
Dotcommander or Pi extension.

## What It Registers

| Surface | Purpose |
| --- | --- |
| `/compact [focus]` | Pi-owned manual command. Focus becomes a bounded `## User Focus` section. |
| `/compact-status` | Show monitor state, all effective thresholds and sources, cooldown, dump settings, and last failure. |
| `recall_compaction` | Search recent summaries in the current project by default, or all projects explicitly. |
| `save_shrink_handoff` | Preserve the exact continuation state used by the next compaction. |
| `tool_result` | Store oversized text output and replace it with a deterministic bounded preview. |
| `session_before_compact` | Prepare an extension-owned deterministic result or cancel without LLM fallback. |
| `session_compact` | Commit success artifacts only after Pi appends the matching compaction. |
| `turn_end` | Evaluate the three-band autonomous policy. |

## Trigger Policy

Each effective boundary is the smaller of its absolute setting and its
percentage of the active context window.

| Band | Default absolute | Default percentage | Inclusive behavior |
| --- | ---: | ---: | --- |
| Auto | `100000` | `0.75` | Auto through warn-minus-one: Mechanical compaction. |
| Warn | `140000` | `0.85` | Warn through emergency-minus-one: cooperative warning. |
| Emergency | `160000` | `0.92` | Emergency and above: unconditional Mechanical compaction. |

The warmup, cooldown, Pi-sync, and post-compaction growth guards still apply;
emergency bypasses cooldown and sync. Manual `/compact` bypasses autonomous
threshold checks. Use `/compact-status`, not `/compact status`, for diagnostics.

## Version-6 Output

The returned summary is bounded to 65,536 Unicode code points and preserves
complete headings and balanced marker blocks. Details version 6 includes:

- `tokensAfter`: Pi rebuilt message-context estimate
- `summaryTokens`: returned-summary estimate
- `tokensAfterSource: "pi-rebuilt-message-estimate"`
- `digestScope: "compaction-input" | "bounded-compaction-input"`
- `summaryDigest`: SHA-256 of the exact metric-prefixed summary returned to Pi

Version-5 entries remain readable and are not rewritten.

## Settings

Settings live at `~/.pi/data/dc-shrink/settings.json`.

| Setting | Default |
| --- | ---: |
| `cacheTtlMs` | `120000` |
| `autoThresholdTokens` | `100000` |
| `warnThresholdTokens` | `140000` |
| `emergencyThresholdTokens` | `160000` |
| `autoThresholdPct` | `0.75` |
| `warnThresholdPct` | `0.85` |
| `emergencyThresholdPct` | `0.92` |
| `dumpCompactions` | `false` |
| `dumpRetention` | `20` |

## Durable Data

| Path | Purpose |
| --- | --- |
| `~/.pi/data/dc-shrink/compact-log.jsonl` | Locked success/failure event log. |
| `~/.pi/data/dc-shrink/compact-dumps/` | Opt-in, collision-safe canonical-input/returned-summary pairs. |
| `Path.project("dc-shrink", cwd)/recall.json` | Last ten committed summaries for the current project. |
| `~/.pi/data/dc-shrink/recall.json` | Preserved ownerless legacy recall, visible only with `scope: "all"`. |
| `~/.pi/data/dc-shrink/.migrated-from-legacy-shrink` | Written only after a fully successful migration. |
| `Path.project("dc-shrink", cwd)/tool-output/` | Full text and JSONL provenance for compacted tool output. |

Migration is retryable: failures leave no completion marker and preserve both
legacy and current data.

## Docs

- [Usage](docs/usage.md)
- [Settings and data](docs/settings.md)
- [Architecture](docs/architecture.md)
- [Troubleshooting](docs/troubleshooting.md)

## Verification

```bash
bun test
bun x tsc --noEmit
```

The repository packages Pi 0.79.8. Installed-runtime compatibility is verified
against `/opt/homebrew/bin/pi` 0.80.10 when that binary is available.
