# Usage

Start a fresh Pi session with only the current extension enabled. Existing incompatible sessions use the old extension; there is no migration or historical reader.

| Command | Owner and purpose |
| --- | --- |
| `/compact [instructions]` | Pi's native compaction command; instructions supply the bounded focus. |

The extension registers no commands or tools. It intercepts every Pi compaction request identically, including manual, threshold, overflow, absent, and unfamiliar reasons. Pi alone decides when to compact and which entries remain.

Expand Pi's native compaction card to inspect the JSON. `latestRequest` is attributed native user context; `records` are selected excerpts; `files` and `commands` are observations. `origin: "current"` means observed in this compaction input, not current filesystem truth. Carried observations have `origin: "prior"`.

Omission counters describe lost candidates, so a summary with no visible failure is not proof that all commands passed. File writes marked create-capable do not prove creation. Readiness, verification, and authorization must be established outside this summary. No protected task or evidence preservation remains.

If compaction fails, the extension cancels it. It does not fall back to LLM summarization, trigger another compaction, abort a run, or send continuation messages. Only an independently validated newest active commit matching the full pending receipt may issue a synchronous best-effort UI notification. Pi's native compaction card is the persistent success display; notification text may disappear when Pi rebuilds chat. See [troubleshooting](troubleshooting.md).
