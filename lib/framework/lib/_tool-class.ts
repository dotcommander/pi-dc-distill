/**
 * Tool-name classification regexes — single source of truth.
 *
 * These were duplicated inline across summarizeArgs / summarizeOutput /
 * toolColor / displayToolName in lib/tool.ts; the divergence let
 * COUNT_SUMMARIZER_PATTERN drift in as a one-branch patch. Centralized here
 * so a future change touches one site. NOT exported from the kernel barrel —
 * module-private to lib/. Each regex is lifted verbatim from its original
 * call site; the four functions keep their existing branch ORDER (load-bearing:
 * earlier branches pre-empt later ones, the sets overlap, and toolColor tests
 * the raw name while the others test name.toLowerCase()), so this is a rename,
 * not a behavior change.
 */
export const TASK_LIKE = /agent|taskagent|task/;
export const AFK_PREFIX = /^afk(?:_|$)/;
export const COLOR_READ = /read|fetch|search|recall|list|history/;
export const COLOR_WRITE = /write|create|add|save|append|journal/;
export const COLOR_EDIT = /edit|update|fix|improve|analyze|review/;
export const COLOR_AFK = /afk/;
export const COLOR_LINK = /grep|find|browser|navigate|click|youtube|transcribe/;
export const DISPLAY_GREP = /grep|search|recall|query/;
export const DISPLAY_READ =
  /find|list|ls|status|health|cost|read|fetch|extract|snapshot|screenshot|history|memory|knowledge|content/;
export const DISPLAY_WRITE =
  /write|create|add|save|append|journal|commit|release|merge|close/;
export const DISPLAY_EDIT =
  /edit|update|fix|improve|analy[sz]e|review|distill|reflect|learn|summari[sz]e|rewrite/;
export const DISPLAY_WEB =
  /browser|web|reddit|url|http|navigate|click|scroll|type|tab/;
export const ARGS_GREP_SEARCH = /grep|search|find|recall/;
export const ARGS_GREP = /grep|search|find/;
export const ARGS_BASH_RUN = /bash|exec|run/;
export const OUT_BASH_DURATION = /bash|exec|run|test|vet|agent|taskagent|task/;
export const OUT_READ = /read|cat|preview/;
export const OUT_GREP = /grep|search|recall|find/;
export const OUT_LIST = /list|ls|history/;
export const OUT_WRITE = /write|create|save|append/;
