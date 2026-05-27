import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { commandExists, runCommand } from "../src/utils/exec.ts";

test("runCommand can abort when output matches an interactive prompt", async () => {
  const result = await runCommand({
    command: "node",
    args: ["-e", "console.log('Do you want to continue? [Y/n]'); setTimeout(() => {}, 10000);"],
    timeoutMs: 10_000,
    abortOnOutputPatterns: [/Do you want to continue\?/]
  });
  assert.match(result.stdout, /Do you want to continue/);
  assert.match(result.abortedReason ?? "", /matched/);
});

test("runCommand caps stdout and stderr capture", async () => {
  const result = await runCommand({
    command: "node",
    args: ["-e", "process.stdout.write('abcdef'); process.stderr.write('uvwxyz');"],
    timeoutMs: 5000,
    maxOutputBytes: 4
  });

  assert.equal(result.stdout, "abcd");
  assert.equal(result.stderr, "uvwx");
  assert.equal(result.stdoutTruncated, true);
  assert.equal(result.stderrTruncated, true);
  assert.equal(result.maxOutputBytes, 4);
});

test("runCommand can run without inheriting process env", async () => {
  const oldValue = process.env.VISER_EXEC_TEST_TOKEN;
  process.env.VISER_EXEC_TEST_TOKEN = "shell-secret-value";
  try {
    const result = await runCommand({
      command: process.execPath,
      args: ["-e", "console.log(process.env.VISER_EXEC_TEST_TOKEN || 'missing')"],
      timeoutMs: 5000,
      inheritEnv: false
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.trim(), "missing");
  } finally {
    if (oldValue === undefined) delete process.env.VISER_EXEC_TEST_TOKEN;
    else process.env.VISER_EXEC_TEST_TOKEN = oldValue;
  }
});

test("commandExists rejects executable directories as commands", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-exec-command-dir-"));
  try {
    const binDir = join(dir, "bin");
    await mkdir(join(binDir, "tool-ok"), { recursive: true });
    await chmod(join(binDir, "tool-ok"), 0o700);

    assert.equal(commandExists("tool-ok", { cwd: dir, pathValue: binDir }), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("commandExists mirrors runtime PATH lookup when the first executable candidate is unsafe", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".viser-exec-command-path-"));
  try {
    const outsideRoot = join(dir, "outside-root");
    const outsideBin = join(outsideRoot, "bin");
    const safeBin = join(dir, "safe-bin");
    const rootLink = join(dir, "root-link");
    await mkdir(outsideBin, { recursive: true });
    await mkdir(safeBin, { recursive: true });
    await writeFile(join(outsideBin, "tool-ok"), "#!/bin/sh\nprintf unsafe\n", "utf8");
    await writeFile(join(safeBin, "tool-ok"), "#!/bin/sh\nprintf safe\n", "utf8");
    await chmod(join(outsideBin, "tool-ok"), 0o700);
    await chmod(join(safeBin, "tool-ok"), 0o700);
    await symlink(outsideRoot, rootLink);

    assert.equal(commandExists("tool-ok", { cwd: dir, pathValue: `${join(rootLink, "bin")}:${safeBin}` }), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
