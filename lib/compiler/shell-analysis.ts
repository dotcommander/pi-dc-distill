/** Bounded shell lexing, not a shell interpreter. Unsupported syntax fails closed. */
export interface ShellAnalysis {
  command: string;
  segments: string[][];
  operators: (";" | "&&" | "||" | "|" | "\n")[];
  supported: boolean;
}

// Limits apply to the supplied command, never a truncated prefix. A rejected
// command retains its original bytes but cannot establish read-only effects.
const MAX_COMMAND_LENGTH = 65_536;
const MAX_SEGMENTS = 256;
const MAX_WORDS = 4_096;
const unsupportedCommands = new Set([
  "eval", "source", ".", "exec", "sh", "bash", "zsh", "dash", "ksh", "fish",
  "if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done",
  "case", "esac", "select", "function", "time", "coproc",
]);

/** Unsafe effects in otherwise familiar utilities. This is not an allowlist. */
export function shellSegmentHasUnsafeOptions(args: string[]): boolean {
  const [executable, subcommand] = args;
  if (unsupportedCommands.has(executable)) return true;
  // find's expression syntax does not honor the usual end-of-options rule.
  if (executable === "find") {
    return args.slice(1).some((arg) => /^-(?:delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)(?:=|$)/.test(arg));
  }
  const separator = args.indexOf("--");
  const options = args.slice(1, separator < 0 ? undefined : separator);
  if (executable === "rg") return options.some((arg) =>
    /^--(?:pre|search-zip)(?:=|$)/.test(arg) || /^-[^-]*z/.test(arg));
  if (executable === "git" && subcommand === "diff") return options.some((arg) =>
    /^--(?:output|ext-diff|textconv)(?:=|$)/.test(arg));
  return false;
}

/** Explicit rewrite/output/hook flags cannot supply a check-only receipt. */
export function shellSegmentHasUnsafeCheckOptions(args: string[]): boolean {
  if (shellSegmentHasUnsafeOptions(args)) return true;
  // Runner wrappers may forward arguments after --; inspecting the whole
  // supplied segment deliberately errs toward fencing, including ambiguity.
  if (args.slice(1).some((arg) =>
    /^--(?:fix(?:-only)?|write|watch(?:All)?|update(?:-snapshots?|Snapshot)?|output(?:-file)?|out-dir|outDir|outFile|exec|toolexec|preload|require|import)(?:=|$)/.test(arg)
    || /^-[uwo](?:[^-].*)?$/.test(arg))) return true;
  const [executable, subcommand] = args;
  if (executable === "go") return args.slice(2).some((arg) =>
    /^-(?:exec|toolexec|o|outputdir|coverprofile|cpuprofile|memprofile|blockprofile|mutexprofile|trace|fuzz)(?:=|$)/.test(arg));
  if (executable === "tsc" || (executable === "bun" && subcommand === "x" && args[2] === "tsc")) {
    // noEmit does not prevent incremental/composite build-info or diagnostic
    // trace/profile output. Fence explicit output modes even when a supplied
    // false value might disable one: config and conflicting flags stay unknown.
    // TypeScript option spelling is case-insensitive and accepts one or two
    // leading hyphens; include its build/incremental/watch short aliases.
    return args.slice(1).some((arg) => /^-{1,2}(?:build|b|incremental|i|composite|tsBuildInfoFile|generateCpuProfile|generateTrace|outDir|outFile|declarationDir|emitDeclarationOnly|watch|w)(?:=|$)/i.test(arg));
  }
  if (executable === "pytest") return args.slice(1).some((arg) => /^--(?:junitxml|junit-xml|basetemp)(?:=|$)/.test(arg));
  return false;
}

export function analyzeShell(command: string): ShellAnalysis {
  const analysis: ShellAnalysis = { command, segments: [], operators: [], supported: true };
  if (command.length > MAX_COMMAND_LENGTH || command.includes("\0") || command.includes("\r")) {
    analysis.supported = false;
    return analysis;
  }
  let args: string[] = [];
  let word = "";
  let started = false;
  let quote: "'" | '"' | undefined;
  let words = 0;
  const finishWord = () => {
    if (started) {
      if (++words > MAX_WORDS) analysis.supported = false;
      else args.push(word);
    }
    word = "";
    started = false;
  };
  const finishSegment = () => {
    if (unsupportedCommands.has(args[0])) analysis.supported = false;
    if (analysis.segments.length >= MAX_SEGMENTS) {
      analysis.supported = false;
      args = [];
      return false;
    }
    analysis.segments.push(args);
    args = [];
    return true;
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote === "'") {
      if (ch === "'") quote = undefined;
      else word += ch;
      continue;
    }
    if (ch === "\\") {
      const next = command[++i];
      if (next === undefined) { analysis.supported = false; break; }
      if (next === "\n") continue;
      if (quote === '"' && !['$', '`', '"', '\\'].includes(next)) word += "\\";
      word += next;
      started = true;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = undefined;
      else {
        if (ch === "$" || ch === "`") analysis.supported = false;
        word += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; started = true; continue; }
    if (ch === " " || ch === "\t") { finishWord(); continue; }
    if (ch === ";" || ch === "&" || ch === "|" || ch === "\n") {
      finishWord();
      let operator: ShellAnalysis["operators"][number];
      if ((ch === "&" || ch === "|") && command[i + 1] === ch) {
        operator = ch === "&" ? "&&" : "||";
        i++;
      } else if (ch === "&") { analysis.supported = false; break; }
      else operator = ch;
      // Blank lines (including continuation after &&/||/|) contain no command.
      if (!args.length && operator === "\n") continue;
      if (!args.length) { analysis.supported = false; break; }
      if (!finishSegment()) break;
      analysis.operators.push(operator);
      continue;
    }
    // Expansion, redirection, grouping, comments and shell-specific syntax.
    // Git ancestry operators are literal within a revision word. Leading ~
    // and assignment-like forms can expand home directories and remain blocked.
    if (ch === "~" && !(args[0] === "git" && args[1] === "diff" && /^[A-Za-z0-9_./-]+(?:[~^][0-9]*)*$/.test(word))) analysis.supported = false;
    if ("$`<>(){}*?[]#!".includes(ch)) analysis.supported = false;
    word += ch;
    started = true;
  }
  finishWord();
  if (quote) analysis.supported = false;
  if (args.length) finishSegment();
  else if (analysis.operators.length) {
    const trailing = analysis.operators.at(-1);
    if (trailing !== ";" && trailing !== "\n") analysis.supported = false;
  }
  if (!analysis.segments.length) analysis.supported = false;
  return analysis;
}
