# Compiler algorithm

## Authoritative source

Pi owns triggering, cut selection, append, and context rebuilding. The live hook uses only `event.preparation` and active `event.branchEntries`; it never reads a session file. The typed source passes directly to the compiler without JSONL serialization and reparsing or a file fallback.

Source construction checks projection agreement, unique entry identities, predecessor agreement, exact discarded-message matching, split-turn boundaries, retained-tail exclusion, structure, Unicode, and the source-message guard. Abandoned branches and retained messages never become excerpts or fresh facts. The 20 MiB input envelope keeps mandatory metadata and predecessor, then the newest fitting whole records. All omitted records are still validated. Duplicate call IDs are collected before bounding so an omitted duplicate cannot make a pair unique.

An owned predecessor is accepted only when the current shape and exact summary digest validate. Incompatible owned summaries and active legacy handoffs are refused; superseded history outside the effective projection does not block. Native and foreign summaries are attributed text. Accepted predecessor records and facts flatten into the new summary with `origin: "prior"`; their display text is never interpreted as a fresh tool call.

## One current summary

The compact JSON has these fixed keys, in this order:

```text
format, notice, focus, latestRequest, records, files, commands, omitted
```

`format` is `dc-distill-summary`. `notice` is `Selected conversation excerpts and observations; incomplete.` There is no schema version or historical format ladder.

- `focus`: current native compaction instructions, or null.
- `latestRequest`: newest admitted native user text, otherwise the predecessor field, or null. Its duplicate excerpt is excluded. It remains attributed context.
- `records`: chronological selected excerpts with `kind`, `text`, `shortened`, and `origin`. Kinds are user, assistant, tool-call, tool-result, bash, custom, branch-summary, and native-summary.
- `files`: `read` and `modified` arrays. Each fact has `identityDigest`, `path`, `shortened`, `createCapable`, and `origin`.
- `commands`: facts with `identityDigest`, `runner`, `command`, `cwd`, `status`, `result`, `shortened`, and `origin`.
- `omitted`: `inputRecords`, `excerpts`, `readFiles`, `modifiedFiles`, and `commands` counters.

Text observations have `text`, `shortened`, and `origin`. Origin is current or prior; current means observed in this compaction input, not current filesystem truth. These lossy observations establish no readiness, verification, or authorization. Protected tasks, pins, and evidence freshness have been removed.

## Pairing and facts

Extract facts from full text and identities before shortening display fields. Pair results only with a unique matching call ID and matching raw tool name. ID-less calls allow only the unique same-name fallback. Ambiguous pairs produce no facts. Carried display records are never paired anew.

Exact read aliases: `read`, `read_file`, `view`, `view_file`. Exact write aliases: `edit`, `write`, `edit_file`, `write_file`, `multiedit`, `write_to_file`, `replace_file_content`, `patch_file`, `create_file`. Matching aliases are lowercased exactly. Preserve raw names for pairing. Create-capable aliases are `write`, `write_file`, `write_to_file`, and `create_file`. Path precedence is `path`, `file_path`, `filePath`, `file`, then `targetFile`, `TargetFile`, `target_file`, `target_path`, `absolutePath`, `AbsolutePath`.

File facts require a paired result with `isError === false`. Deduplicate with the full lexical path and known launch directory before display shortening; do not normalize path spelling. Latest observation wins. Create-capable writes are not proof of newly created files.

Command runners are `bash`, `shell`, `jinn_run_shell`, and `functions.bash`. Read `command`, then `cmd`, and explicit `cwd`, otherwise known session cwd. Recorded false, true, or missing `isError` means success, error, or unknown. Native bash execution uses integer exit status; cancellation or missing exit status means unknown. Prose and shell syntax never infer a pass.

SHA-256 identities hash compact JSON arrays:

```text
["dc-distill-file", path, cwdOrNull]
["dc-distill-command", runner, command, cwdOrNull]
```

No numbered hash domains remain. Display shortening cannot change identity or pairing.

## Serialized budgets

The operating target is 8,192 Unicode code points; the hard serialized limit is 65,536. Count JSON escaping and framing. Never truncate completed JSON or split Unicode code points.

| Field | Display bound |
| --- | --- |
| Focus, latest request, each excerpt | 2,048 code points |
| File path | 512 code points |
| Read facts and modification facts | 50 rows each |
| Commands | 10 rows |
| Command runner | 128 code points |
| Command and cwd | 512 code points each |
| Command result | 300 code points |

Mandatory framing, focus, and latest request have priority. Optional facts receive up to 2,048 serialized code points, choosing whole rows in repeated newest-modification, newest-command, newest-read order. Fill remaining operating space with newest fitting excerpts and render them chronologically.

Carry predecessor omission counters once and add newly omitted candidates once. Deduplication and replacement are not omissions. Records dropped before extraction count only as input omissions. Counters saturate at the maximum safe integer.

For hard serialized overflow or known rebuilt-context capacity overflow, evict whole rows in this order: oldest excerpt, oldest command, oldest read, oldest modification. Re-encode after each eviction. Capacity retries use Pi's `buildSessionContext()` and `estimateTokens()` on the exact proposed summary plus retained tail. Cancel if mandatory content still cannot fit. Unknown capacity stays explicitly unknown; token counts are host-consistent estimates, not provider billing measurements.
