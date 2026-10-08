import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("..", import.meta.url));

async function escapedCheckout(run: (root: string) => Promise<void>) {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), "distill-path-regression-")));
  const root = join(temporary, "checkout with space # hash");
  try {
    await mkdir(root);
    await run(root);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

test("E2E launch arguments locate extension and provider in an escaped checkout", async () => {
  await escapedCheckout(async root => {
    const harness = join(root, "tests/e2e/harness");
    await mkdir(harness, { recursive: true });
    await cp(join(sourceRoot, "tests/e2e/harness/env.ts"), join(harness, "env.ts"));
    await writeFile(join(root, "index.ts"), "export const extension = true;");
    await writeFile(join(harness, "fake-provider.ts"), "export const provider = true;");
    const program = `
      import { scriptedArgs, REPO_ROOT } from "./tests/e2e/harness/env.ts";
      import { readFileSync } from "node:fs";
      const args = scriptedArgs({ sessionDir: "isolated-sessions" });
      const paths = args.flatMap((arg, i) => arg === "-e" ? [args[i + 1]] : []);
      const contents = paths.map(path => readFileSync(path, "utf8"));
      console.log(JSON.stringify({ root: REPO_ROOT, paths, contents }));
    `;
    const env = { ...process.env };
    delete env.DISTILL_EXTENSION_PATH;
    const child = Bun.spawn([process.execPath, "-e", program], {
      cwd: root, env, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
    expect(JSON.parse(stdout)).toEqual({ root, paths: [join(root, "index.ts"), join(harness, "fake-provider.ts")],
      contents: ["export const extension = true;", "export const provider = true;"] });
  });
});

test("saved-session test launches the real CLI from an escaped checkout", async () => {
  await escapedCheckout(async root => {
    // Copy source rather than symlinking it: module realpaths must retain the escaped directory.
    for (const path of ["index.ts", "lib", "scripts", "tests/harness"]) {
      await cp(join(sourceRoot, path), join(root, path), { recursive: true });
    }
    await symlink(join(sourceRoot, "node_modules"), join(root, "node_modules"), "dir");
    const child = Bun.spawn([process.execPath, "test", "./scripts/compact-session.test.ts", "--test-name-pattern",
      "BOM settings, file, explicit stdin and latest discovery"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ exit, output: stdout + stderr }).toMatchObject({ exit: 0 });
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("0 fail");
  });
}, 30_000);
