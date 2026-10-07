# Settings

There is no extension configuration. Pi owns its native compaction settings, triggering, cut selection, and rebuilt context. dc-distill handles all requests Pi emits, regardless of reason. Native `/compact` instructions supply the current focus; prior focus is not carried.

The extension reads no legacy tool-output, recall, trigger, or dump settings. It adds no timers, tools, commands, storage, or focus injection. Existing stored data is preserved and is not migrated or loaded.

The compiler's fixed bounds are policy, not settings: 20 MiB whole-record input, an 8,192-code-point operating target, and a 65,536-code-point hard serialized summary limit. See [algorithm](algorithm.md).
