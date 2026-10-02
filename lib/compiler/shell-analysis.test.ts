import { describe, expect, test } from "bun:test";
import { analyzeShell, shellSegmentHasUnsafeCheckOptions, shellSegmentHasUnsafeOptions } from "./shell-analysis.ts";
import { effectiveShellCwd, isVerificationCommand, verificationIdentity } from "./tool-tracker.ts";

describe("bounded shell analysis", () => {
  test("decodes arguments without changing original bytes and records every separator", () => {
    const command = "cat 'a;b' && rg \"x|y\" file\\ name; pwd\nls || head file | tail file";
    expect(analyzeShell(command)).toEqual({
      command, supported: true,
      segments: [["cat", "a;b"], ["rg", "x|y", "file name"], ["pwd"], ["ls"], ["head", "file"], ["tail", "file"]],
      operators: ["&&", ";", "\n", "||", "|"],
    });
  });

  test("escaped operators and quoted syntax are literal data", () => {
    const command = "cat a\\;b a\\&b a\\|b '$HOME $(rm x) > * # { }' \"a\\$b\"";
    const result = analyzeShell(command);
    expect(result.supported).toBe(true);
    expect(result.segments).toEqual([["cat", "a;b", "a&b", "a|b", "$HOME $(rm x) > * # { }", "a$b"]]);
    expect(result.operators).toEqual([]);
  });

  test("shell expansions, redirections, unsupported syntax and malformed syntax fail closed", () => {
    for (const command of ["cat $(rm x)", "cat `rm x`", 'cat "$HOME"', "cat $HOME", "cat *.ts", "cat ~/x", "cat > x", "cat < x", "cat <<EOF\nx\nEOF", "cat &", "(cat x)", "{ cat x; }", "cat x # comment", "cat 'x", "cat x\\", "cat x &&", "cat x ||", "cat x |", "cat x ;; pwd", "&& pwd", "cat ${x}"]) {
      expect(analyzeShell(command).supported).toBe(false);
      expect(isVerificationCommand(command)).toBe(false);
    }
  });

  test("Git ancestry tildes stay literal while home expansion stays blocked", () => {
    const command = "git diff HEAD~1 HEAD~2~3 --stat";
    expect(analyzeShell(command)).toEqual({ command, supported: true, segments: [["git", "diff", "HEAD~1", "HEAD~2~3", "--stat"]], operators: [] });
    for (const unsafe of ["git diff ~/x HEAD --stat", "git diff ~user/x HEAD --stat", "git diff PATH=~/x HEAD --stat", "git diff HEAD~1; rm x", "git diff HEAD~1 $(rm x)"]) {
      if (unsafe.includes(";")) expect(isVerificationCommand(unsafe)).toBe(false);
      else expect(analyzeShell(unsafe).supported).toBe(false);
    }
  });

  test("admits exact check tokens and check-only conjunctions", () => {
    for (const command of ["bun test", "bun x tsc --noEmit", "go mod verify", "git diff --check", "bun test &&\n git diff --check", "cd '../other dir' && bun test && tsc --noEmit"]) expect(isVerificationCommand(command)).toBe(true);
    for (const command of ["echo 'bun test'", "sh -c 'bun test'", "env bun test", "bun test; rm x", "bun test | cat", "bun test || bun test", "bun test\nbun test", "bun test;", "bun test && cat x", "bun test --update-snapshots", "ruff check --fix", "ruff format", "git diff --check --output=x", "git diff --check --ext-diff", "cd - && bun test", "cd && bun test"]) expect(isVerificationCommand(command)).toBe(false);
  });

  test("resolves literal directories consistently and rejects unknown relative bases", () => {
    const command = "cd '../other dir' && bun  test";
    const call = { name: "bash", args: { command, cwd: "/tmp/proj" } };
    expect(effectiveShellCwd(command, "/tmp/proj")).toBe("/tmp/other dir");
    expect(verificationIdentity(call, "/ignored")).toBe(JSON.stringify(["bash", command, "/tmp/other dir"]));
    expect(verificationIdentity({ name: "bash", args: { command } })).toBeUndefined();
    expect(effectiveShellCwd("cd /tmp/proj/../other && bun test")).toBe("/tmp/other");
  });

  test("check words in filename arguments and modifying tool subcommands are not checks", () => {
    expect(isVerificationCommand("git diff -- --check")).toBe(false);
    expect(isVerificationCommand("golangci-lint cache clean")).toBe(false);
    expect(isVerificationCommand("golangci-lint run")).toBe(true);
  });

  test("Go single-dash execution hooks cannot produce fresh check evidence", () => {
    for (const command of ["go test -exec ./mutate", "go test -exec=./mutate", "go test -toolexec ./mutate", "go test -toolexec=./mutate", "go build -toolexec=./mutate"]) {
      expect(isVerificationCommand(command)).toBe(false);
    }
  });

  test("inspects every conditional, pipeline and compound segment without assuming it was skipped", () => {
    const command = "cat first && cat second || rm third; head fourth | tee fifth\ntail sixth";
    expect(analyzeShell(command)).toEqual({
      command, supported: true,
      segments: [["cat", "first"], ["cat", "second"], ["rm", "third"], ["head", "fourth"], ["tee", "fifth"], ["tail", "sixth"]],
      operators: ["&&", "||", ";", "|", "\n"],
    });
    expect(isVerificationCommand(command)).toBe(false);
  });

  test("literal escaped newlines join words and quoted separators never create a segment", () => {
    const command = "ca\\\nt 'one;two' &&\nrg \"three&&four\\\nfive\" file\\|name | cat";
    expect(analyzeShell(command)).toEqual({
      command, supported: true,
      segments: [["cat", "one;two"], ["rg", "three&&fourfive", "file|name"], ["cat"]],
      operators: ["&&", "|"],
    });
  });

  test("unsupported execution forms never establish effects even behind a familiar read", () => {
    for (const command of [
      "cat first && eval 'cat second'", "cat first || source script", "cat first; . script",
      "cat first | sh script", "cat first; bash -c 'cat second'", "if cat first; then rm second; fi",
      "for file in a b; do cat file; done", "function f() { cat first; }; f", "cat first >second",
      "cat first 2>>second", "cat first <<<second", "cat first <<'EOF'\nrm second\nEOF",
      "cat first |& cat second", "cat first & cat second", "cat first <(rm second)",
      "cat first $(cat second); cat third", "cat first; exec cat second",
    ]) {
      expect(analyzeShell(command).supported).toBe(false);
      expect(isVerificationCommand(command)).toBe(false);
    }
  });

  test("bounds reject the complete command rather than trusting a safe prefix", () => {
    for (const command of [
      "cat " + "x".repeat(65_536), Array(257).fill("cat x").join(";"),
      "cat " + Array(4_097).fill("x").join(" "), "bun test\0; rm file", "bun test\r",
    ]) {
      const result = analyzeShell(command);
      expect(result.command).toBe(command);
      expect(result.supported).toBe(false);
      expect(result.segments.length).toBeLessThanOrEqual(256);
      expect(result.segments.reduce((sum, segment) => sum + segment.length, 0)).toBeLessThanOrEqual(4_096);
      expect(isVerificationCommand(command)).toBe(false);
    }
  });

  test("write and subprocess options are unsafe before utility-specific option boundaries", () => {
    for (const args of [
      ["find", ".", "-exec", "rm", "{}", ";"], ["find", "--", ".", "-delete"],
      ["find", ".", "-fprint0", "list"], ["find", ".", "-okdir", "rm", "{}", ";"],
      ["rg", "--pre=./filter", "text"], ["rg", "-niz", "text"], ["rg", "--search-zip", "text"],
      ["git", "diff", "--output=patch"], ["git", "diff", "--ext-diff"], ["git", "diff", "--textconv"],
    ]) expect(shellSegmentHasUnsafeOptions(args)).toBe(true);
    for (const args of [
      ["cat", "--", "--output=literal"], ["rg", "--", "--pre=literal"],
      ["git", "diff", "--", "--output=literal"], ["find", ".", "-name", "literal"],
    ]) expect(shellSegmentHasUnsafeOptions(args)).toBe(false);
  });

  test("runner output, rewriting and execution-hook flags cannot establish a check-only receipt", () => {
    for (const args of [
      ["bun", "test", "--update-snapshots"], ["bun", "test", "-u"], ["bun", "test", "--watchAll"],
      ["bun", "test", "--preload=setup.ts"], ["ruff", "check", "--fix-only"],
      ["go", "test", "-coverprofile=coverage.out"], ["go", "test", "-trace", "trace.out"],
      ["go", "test", "-exec=./hook"], ["go", "build", "-oartifact"],
      ["bun", "x", "tsc", "--outDir", "dist"], ["tsc", "--build"],
      ["pytest", "--junitxml=results.xml"], ["bun", "test", "--", "--write"],
    ]) expect(shellSegmentHasUnsafeCheckOptions(args)).toBe(true);
    for (const args of [["bun", "test"], ["go", "test", "./..."], ["bun", "x", "tsc", "--noEmit"], ["git", "diff", "--check"]]) {
      expect(shellSegmentHasUnsafeCheckOptions(args)).toBe(false);
    }
  });

  test("TypeScript noEmit cannot hide explicit build-info or diagnostic output modes", () => {
    for (const prefix of [["tsc"], ["bun", "x", "tsc"]]) {
      for (const option of [
        "--incremental", "--incremental=true", "--incremental=false", "-incremental", "-i", "--INCREMENTAL",
        "--composite", "--Composite=true", "-composite", "--tsBuildInfoFile", "--tsbuildinfofile=state.tsbuildinfo",
        "--generateCpuProfile=profile.json", "-generateTrace", "--GENERATETRACE=trace", "--build", "-b",
        "--OUTDIR=dist", "-outFile", "--declarationDir=types", "--emitDeclarationOnly", "--WATCH", "-w",
      ]) {
        expect(shellSegmentHasUnsafeCheckOptions([...prefix, "--noEmit", option])).toBe(true);
      }
      expect(shellSegmentHasUnsafeCheckOptions([...prefix, "--noEmit", "--pretty", "false"])).toBe(false);
    }
  });
});
