# Compiler algorithm

## Authoritative source

Pi owns triggering, cut selection, append, and context rebuilding. The live hook uses only `event.preparation` and active `event.branchEntries`; it never reads a session file. Source construction is the sole production certification boundary. The typed, certified source passes directly to the compiler without JSONL serialization and reparsing or a file fallback.

Source construction checks projection agreement, unique entry identities, predecessor agreement, exact discarded-message matching, split-turn boundaries, retained-tail exclusion, structure, Unicode, and the source-message guard. A separate 50,000-message guard bounds the discarded record count. Abandoned branches and retained messages never become excerpts or fresh facts. The 20 MiB input envelope is a serialized-admission bound, not a raw-processing limit. It keeps mandatory metadata and predecessor, then the newest fitting whole records. All omitted records are still validated. Duplicate call IDs are collected before bounding so an omitted duplicate cannot make a pair unique. An unsupported message role or content shape without tool identity degrades to an attributed-text row instead of cancelling; malformed tool-bearing messages cancel so recovery can never erase duplicate-ID ambiguity, and recovered text is clipped once at observation so its truncation stays visible. Structural and Unicode faults always cancel.

Owned predecessor admission is opportunistic and never blocks compaction. For the effective projection's own previous compaction entry (`compactor: "dc-distill"` without a `version` key):

1. When the recorded digest matches the full SHA-256 of the summary text and the text decodes in the current shape, the summary carries full structured state.
2. Every other predecessor — including a damaged owned summary, a digest mismatch, old JSON formats, foreign summaries, and native summaries — degrades to bounded attributed `native-summary` text. Fallback text carries neither a dedicated latest-request field nor structured observations; it never creates fresh execution facts. There is no row salvage or historical decoder.

Active legacy handoff custom entries project no messages and contribute nothing. Superseded history outside the effective projection does not block. Accepted predecessor records and facts flatten into the new summary with `origin: "prior"`; their display text is never interpreted as a fresh tool call.

## One current summary

The summary is one text document framed by `<dc-distill-summary>` and `</dc-distill-summary>`, with a fixed `columns` legend after the notice and fixed sections in this order:

```text
notice, columns, focus, latest-request, records, files, commands, omitted
```

Each section renders escaped single-line rows; `\`, `|`, carriage returns, and newlines are escaped so a row never breaks. Flags render as self-describing keywords, never positional booleans: `shortened` renders `full` or `cut`, `createCapable` renders `yes` or `no`. Command rows carry a `cmd` prefix; an absent cwd renders `none` while present cwds render `=`-prefixed. The latest request text is double-quoted after its origin and keyword, and the omitted line labels every counter (`input=… excerpts=… reads=… modified=… commands=…`). There is no schema version or historical format ladder. The minimal summary, for one native user message and no instructions, is exactly:

```text
<dc-distill-summary>
notice: Selected conversation excerpts and observations; incomplete.
columns: records=kind|origin|cut|text ; files=section id|origin|cut|create|path ; commands=cmd id|origin|cut|runner|status|cwd|command|result
latest-request: current full "hello"
records:
files:
commands:
omitted: input=0 excerpts=0 reads=0 modified=0 commands=0
</dc-distill-summary>
```

(Exact pipeline output, executed locally.)

- `focus`: current native compaction instructions, or absent.
- `latest-request`: newest admitted native user text, otherwise the verified predecessor field, or absent. Its duplicate excerpt is excluded. It remains attributed context.
- `records`: chronological selected excerpts with `kind`, `text`, `shortened`, and `origin`. Kinds are user, assistant, tool-call, tool-result, bash, custom, branch-summary, and native-summary. Repeated tool attempts keep their own call and result rows; excerpt rows never synthesize outcome claims (outcomes live only in paired facts).
- `files`: `read` and `modified` arrays. Each fact has `identityDigest`, `path`, `shortened`, `createCapable`, and `origin`.
- `commands`: facts with `identityDigest`, `runner`, `command`, `cwd`, `status`, `result`, `shortened`, and `origin`.
- `omitted`: `inputRecords`, `excerpts`, `readFiles`, `modifiedFiles`, and `commands` counters.

Text observations have `text`, `shortened`, and `origin`. Origin is current or prior; current means observed in this compaction input, not current filesystem truth. These lossy observations establish no readiness, verification, or authorization. Protected tasks, pins, and evidence freshness have been removed.

## Pairing and facts

Extract facts from full text and identities before shortening display fields. Source certification assigns explicit identified, certified ID-less, or unpairable states. Omitted or `undefined` IDs take the supported ID-less path; empty strings and other ID types are rejected before budgeting, and valid strings are preserved exactly. Pair results only with a unique matching call ID and matching raw tool name, or a source-certified unique same-name ID-less relationship. Ambiguous pairs produce no facts. Full-input duplicate detection happens before pruning; downstream extraction neither rescans duplicates nor infers uncertified pairings. Carried display records are never paired anew.

Exact read aliases: `read`, `read_file`, `view`, `view_file`. Exact write aliases: `edit`, `write`, `edit_file`, `write_file`, `multiedit`, `write_to_file`, `replace_file_content`, `patch_file`, `create_file`. Matching aliases are lowercased exactly. Preserve raw names for pairing. Create-capable aliases are `write`, `write_file`, `write_to_file`, and `create_file`. Path precedence is `path`, `file_path`, `filePath`, `file`, then `targetFile`, `TargetFile`, `target_file`, `target_path`, `absolutePath`, `AbsolutePath`.

File facts require a paired result with `isError === false`. Deduplicate with the full lexical path and known launch directory before display shortening; do not normalize path spelling. Latest observation wins. Create-capable writes are not proof of newly created files.

Command runners are `bash`, `shell`, `jinn_run_shell`, and `functions.bash`. Read `command`, then `cmd`, and explicit `cwd`, otherwise known session cwd. Recorded false, true, or missing `isError` means success, error, or unknown. Native bash execution uses integer exit status; cancellation or missing exit status means unknown. Prose and shell syntax never infer a pass.

SHA-256 identities hash compact JSON arrays and render as 22-character base64url prefixes:

```text
["dc-distill-file", path, cwdOrNull]
["dc-distill-command", runner, command, cwdOrNull]
```

No numbered hash domains remain. Display shortening cannot change identity or pairing. Fresh facts and carried rows share the same identity encoding so superseding and deduplication compare exactly.

## Selection priority

Admit user-role excerpts first, newest-first, including verified carried user rows and image placeholders. The mandatory latest request remains separate and its duplicate excerpt is excluded. Admit all other excerpts by descending signal score with newest-first ties. Render the selected rows chronologically. The non-user signal rubric uses visible, deterministic constants:

| Signal | Score |
| --- | --- |
| Textual diff content | +5 |
| Code fence (when no diff content) | +4 |
| Table rows (at least two table lines) | +4 |
| Error keywords, matched case-insensitively (panic, traceback, fatal, failed, failure, `error:`, `exit status` with a nonzero digit, `cannot` or `could not` followed by a space) | +4 |
| Architecture or decision language | +3 |
| Heading | +2 |
| Long form (≥ 5 non-empty lines or ≥ 800 characters) | +2 |
| Path-like text | +1 |
| Filler opener | −2 |
| Short status (only when no positive signal was earned) | −2 |
| Acknowledgement (only when no positive signal was earned) | −5 |

Diff content and code fences are mutually exclusive: a row containing a diff scores +5 and never also scores the fence. User rows, branch summaries, and native summaries score exactly the substantive threshold (3) regardless of text; tool results and bash rows score only on error evidence; assistant, tool-call, and custom rows use the full rubric. User admission precedes that scoring competition. The substantive threshold guards eviction: non-user rows scoring below it are non-substantive.

## Serialized budgets

The operating target is 8,192 Unicode code points; the hard serialized limit is 65,536. Count text escaping and framing. Never truncate a completed row or split Unicode code points. Clipping compares the bounded prefix and original UTF-16 lengths to determine truncation, then reconstructs clipped prefixes from their bounded numeric code points so they do not retain the original string storage.

| Field | Display bound |
| --- | --- |
| Focus, latest request, each excerpt | 2,048 code points |
| File path | 512 code points |
| Read facts and modification facts | 50 rows each |
| Commands | 10 rows |
| Command runner | 128 code points |
| Command and cwd | 512 code points each |
| Command result | 300 code points |

Mandatory framing, focus, and latest request have priority. Optional facts receive up to 2,048 serialized code points, choosing whole rows in repeated newest-modification, newest-command, newest-read order. Render each optional fact once and account incrementally for section overhead, separators, and omission-counter digit changes. A rejected candidate does not end admission: attempt smaller subsequent candidates in the same rotation. Remaining operating space goes to excerpts by the selection priority above. Full argument serialization remains in use.

Carry predecessor omission counters once and add newly omitted candidates once. Deduplication and replacement are not omissions. Records dropped before extraction count only as input omissions. Counters saturate at the maximum safe integer.

For hard serialized overflow or known rebuilt-context capacity overflow, evict whole optional rows in tiers: first the oldest non-substantive non-user excerpt, then the oldest non-error command, then the oldest remaining non-user excerpt, the oldest remaining command, the oldest read, the oldest modification, and finally the oldest user excerpt. Mandatory latest-request content is never an optional eviction candidate. Re-encode after each eviction. Capacity retries use Pi's `buildSessionContext()` and `estimateTokens()` on the exact proposed summary plus retained tail. Acceptance means fitting within the full model context window; it does not enforce a response reserve. Cancel if mandatory content still cannot fit. Unknown capacity stays explicitly unknown; token counts are host-consistent estimates, not provider billing measurements.
