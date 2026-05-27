import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readToolFileNoFollow, splitCommandLine, ToolRunner } from "../src/core/tools.ts";
import type { ToolsConfig } from "../src/core/types.ts";

test("splitCommandLine handles quoted arguments", () => {
  assert.deepEqual(splitCommandLine('read-file "hello world.txt"'), ["read-file", "hello world.txt"]);
});

test("ToolRunner reads only under allowed roots and blocks shell metacharacters", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-"));
  try {
    await writeFile(join(dir, "note.txt"), "hello", "utf8");
    const runner = new ToolRunner(testToolsConfig(dir));
    const read = await runner.run("read-file note.txt");
    assert.equal(read.ok, true);
    assert.equal(read.output, "hello");

    const shell = await runner.run("shell pwd; rm -rf /tmp/nope");
    assert.equal(shell.ok, false);
    assert.match(shell.output, /metacharacters/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner read-file and list-dir refuse symlinked tool paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-nofollow-"));
  try {
    const targetDir = join(dir, "target");
    await mkdir(targetDir);
    await writeFile(join(targetDir, "note.txt"), "inside-but-symlinked", "utf8");
    await symlink(join(targetDir, "note.txt"), join(dir, "note-link.txt"));
    await symlink(targetDir, join(dir, "dir-link"));

    const runner = new ToolRunner(testToolsConfig(dir));
    const read = await runner.run("read-file note-link.txt");
    const list = await runner.run("list-dir dir-link");

    assert.equal(read.ok, false);
    assert.match(read.output, /symlink/i);
    assert.doesNotMatch(read.output, /inside-but-symlinked/);
    assert.equal(list.ok, false);
    assert.match(list.output, /symlink/i);
    assert.doesNotMatch(list.output, /note\.txt/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner refuses allowed read roots reached through symlinked parents", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".viser-tools-root-nofollow-"));
  try {
    const outsideRoot = join(dir, "outside-root");
    const outsideAllowed = join(outsideRoot, "allowed");
    const rootLink = join(dir, "root-link");
    await mkdir(outsideAllowed, { recursive: true });
    await writeFile(join(outsideAllowed, "note.txt"), "outside-through-root-link", "utf8");
    await symlink(outsideRoot, rootLink);

    const runner = new ToolRunner(testToolsConfig(join(rootLink, "allowed")));
    const read = await runner.run("read-file note.txt");
    const list = await runner.run("list-dir .");
    const shell = await runner.run("shell pwd");

    for (const result of [read, list, shell]) {
      assert.equal(result.ok, false);
      assert.match(result.output, /symlink/i);
      assert.doesNotMatch(result.output, /outside-through-root-link/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function testToolsConfig(dir: string): ToolsConfig {
  return {
    enabled: true,
    allowedReadRoots: [dir],
    maxReadBytes: 1000,
    shell: {
      enabled: true,
      allowedCommands: ["pwd", "ls", "cat", "git"],
      timeoutMs: 1000
    }
  };
}

test("ToolRunner blocks shell paths outside the allowed root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-paths-"));
  try {
    const runner = new ToolRunner(testToolsConfig(dir));
    const absolute = await runner.run("shell cat /etc/passwd");
    assert.equal(absolute.ok, false);
    assert.match(absolute.output, /Absolute paths/);

    const traversal = await runner.run("shell cat ../secret.txt");
    assert.equal(traversal.ok, false);
    assert.match(traversal.output, /Path traversal/);

    const gitRedirect = await runner.run("shell git -C /tmp status");
    assert.equal(gitRedirect.ok, false);
    assert.match(gitRedirect.output, /redirection/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner blocks shell symlinks that resolve outside the allowed root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-symlink-"));
  try {
    const allowed = join(dir, "allowed");
    await mkdir(allowed);
    await writeFile(join(dir, "outside-secret.txt"), "outside-secret", "utf8");
    await symlink(join(dir, "outside-secret.txt"), join(allowed, "link.txt"));

    const runner = new ToolRunner(testToolsConfig(allowed));
    const result = await runner.run("shell cat link.txt");

    assert.equal(result.ok, false);
    assert.match(result.output, /outside allowed read roots/);
    assert.doesNotMatch(result.output, /outside-secret/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner blocks shell symlink paths even when they resolve inside the allowed root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-shell-nofollow-"));
  try {
    const targetPath = join(dir, "target.txt");
    const linkPath = join(dir, "target-link.txt");
    await writeFile(targetPath, "inside-through-symlink", "utf8");
    await symlink(targetPath, linkPath);

    const runner = new ToolRunner(testToolsConfig(dir));
    const result = await runner.run("shell cat target-link.txt");

    assert.equal(result.ok, false);
    assert.match(result.output, /symlink/i);
    assert.doesNotMatch(result.output, /inside-through-symlink/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readToolFileNoFollow refuses symlinked files even if called directly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-read-nofollow-"));
  try {
    const outside = join(dir, "outside-secret.txt");
    const link = join(dir, "link.txt");
    await writeFile(outside, "outside-secret", "utf8");
    await symlink(outside, link);

    const raw = await readToolFileNoFollow(link);

    assert.equal(raw, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner blocks shell symlink-following recursive options", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-follow-flags-"));
  try {
    const runner = new ToolRunner({
      ...testToolsConfig(dir),
      shell: {
        ...testToolsConfig(dir).shell,
        allowedCommands: ["find", "grep", "rg", "ls"]
      }
    });

    for (const command of ["shell find -L .", "shell grep -R needle .", "shell grep --dereference-recursive needle .", "shell rg -L needle .", "shell ls -L ."]) {
      const result = await runner.run(command);
      assert.equal(result.ok, false, command);
      assert.match(result.output, /Symlink|symlink/, command);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner blocks shell options that can write or execute helpers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-option-safety-"));
  try {
    const runner = new ToolRunner({
      ...testToolsConfig(dir),
      shell: {
        ...testToolsConfig(dir).shell,
        allowedCommands: ["git", "find", "rg"]
      }
    });

    const gitOutput = await runner.run("shell git diff --output=diff.txt");
    assert.equal(gitOutput.ok, false);
    assert.match(gitOutput.output, /redirection/);

    const findOutput = await runner.run("shell find . -fprint out.txt");
    assert.equal(findOutput.ok, false);
    assert.match(findOutput.output, /Mutating find/);

    const rgOutput = await runner.run("shell rg --pre cat needle .");
    assert.equal(rgOutput.ok, false);
    assert.match(rgOutput.output, /preprocessor/);

    const gitExtDiff = await runner.run("shell git diff --ext-diff");
    assert.equal(gitExtDiff.ok, false);
    assert.match(gitExtDiff.output, /external diff/);

    const gitTextconv = await runner.run("shell git show --textconv HEAD");
    assert.equal(gitTextconv.ok, false);
    assert.match(gitTextconv.output, /textconv/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner hardens git diff rendering against env and repo-config command hooks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-git-hardening-"));
  const previousExternalDiff = process.env.GIT_EXTERNAL_DIFF;
  try {
    runGit(dir, "init");
    runGit(dir, "config", "user.email", "test@example.com");
    runGit(dir, "config", "user.name", "Test");
    runGit(dir, "config", "diff.evil.textconv", `sh -c 'touch ${join(dir, "pwned-textconv")}; cat "$1"' sh`);
    await writeFile(join(dir, ".gitattributes"), "*.bin diff=evil\n", "utf8");
    await writeFile(join(dir, "sample.bin"), "one\n", "utf8");
    runGit(dir, "add", ".");
    runGit(dir, "commit", "-m", "init");
    await writeFile(join(dir, "sample.bin"), "two\n", "utf8");
    process.env.GIT_EXTERNAL_DIFF = `sh -c 'touch ${join(dir, "pwned-env")}'`;

    const runner = new ToolRunner({
      ...testToolsConfig(dir),
      shell: {
        ...testToolsConfig(dir).shell,
        allowedCommands: ["git"]
      }
    });

    const result = await runner.run("shell git diff");

    assert.equal(result.ok, true);
    assert.equal(existsSync(join(dir, "pwned-env")), false);
    assert.equal(existsSync(join(dir, "pwned-textconv")), false);
  } finally {
    if (previousExternalDiff === undefined) delete process.env.GIT_EXTERNAL_DIFF;
    else process.env.GIT_EXTERNAL_DIFF = previousExternalDiff;
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner shell does not inherit secret env values", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-shell-env-strip-"));
  const oldToken = process.env.VISER_TOOL_SECRET_TOKEN;
  const oldApiKey = process.env.SHELL_TOOL_API_KEY;
  try {
    process.env.VISER_TOOL_SECRET_TOKEN = "tool-secret-token-1234567890";
    process.env.SHELL_TOOL_API_KEY = "tool-api-key-1234567890";
    const runner = new ToolRunner({
      ...testToolsConfig(dir),
      shell: {
        ...testToolsConfig(dir).shell,
        allowedCommands: ["node"]
      }
    });

    const result = await runner.run("shell node -e \"process.stdout.write(JSON.stringify([process.env.SHELL_TOOL_API_KEY,process.env.VISER_TOOL_SECRET_TOKEN]))\"");

    assert.equal(result.ok, true);
    assert.equal(result.output, "[null,null]");
  } finally {
    if (oldToken === undefined) delete process.env.VISER_TOOL_SECRET_TOKEN;
    else process.env.VISER_TOOL_SECRET_TOKEN = oldToken;
    if (oldApiKey === undefined) delete process.env.SHELL_TOOL_API_KEY;
    else process.env.SHELL_TOOL_API_KEY = oldApiKey;
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner shell resolves PATH commands before running", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-shell-path-command-"));
  const oldPath = process.env.PATH;
  try {
    const binDir = join(dir, "bin");
    const commandPath = join(binDir, "tool-ok");
    await mkdir(binDir, { recursive: true });
    await writeFile(commandPath, "#!/bin/sh\nprintf 'TOOL_OK\\n'\n", "utf8");
    await chmod(commandPath, 0o700);
    process.env.PATH = binDir;
    const runner = new ToolRunner({
      ...testToolsConfig(dir),
      shell: {
        ...testToolsConfig(dir).shell,
        allowedCommands: ["tool-ok"]
      }
    });

    const result = await runner.run("shell tool-ok");

    assert.equal(result.ok, true);
    assert.equal(result.output, "TOOL_OK");
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner shell refuses PATH commands reached through workspace symlink components", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".viser-tools-shell-command-nofollow-"));
  const oldPath = process.env.PATH;
  try {
    const outsideRoot = join(dir, "outside-root");
    const outsideBin = join(outsideRoot, "bin");
    const outsideTouched = join(outsideRoot, "touched.txt");
    const commandPath = join(outsideBin, "tool-ok");
    const rootLink = join(dir, "root-link");
    await mkdir(outsideBin, { recursive: true });
    await writeFile(commandPath, `#!/bin/sh\nprintf ran > ${JSON.stringify(outsideTouched)}\nprintf 'TOOL_OK\\n'\n`, "utf8");
    await chmod(commandPath, 0o700);
    await symlink(outsideRoot, rootLink);
    process.env.PATH = join(rootLink, "bin");
    const runner = new ToolRunner({
      ...testToolsConfig(dir),
      shell: {
        ...testToolsConfig(dir).shell,
        allowedCommands: ["tool-ok"]
      }
    });

    const result = await runner.run("shell tool-ok");

    assert.equal(result.ok, false);
    assert.match(result.output, /symlink/i);
    assert.equal(existsSync(outsideTouched), false);
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner blocks sed file read, write, and script-file escape commands", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-sed-safety-"));
  try {
    await writeFile(join(dir, "note.txt"), "hello\n", "utf8");
    await writeFile(join(dir, "script.sed"), "1r/etc/passwd\n", "utf8");
    const runner = new ToolRunner({
      ...testToolsConfig(dir),
      shell: {
        ...testToolsConfig(dir).shell,
        allowedCommands: ["sed"]
      }
    });

    const safe = await runner.run("shell sed s/hello/HELLO/ note.txt");
    assert.equal(safe.ok, true);
    assert.match(safe.output, /HELLO/);

    for (const command of [
      "shell sed 1r/etc/passwd note.txt",
      "shell sed 1wout.txt note.txt",
      "shell sed s/hello/HELLO/wout2.txt note.txt",
      "shell sed -f script.sed note.txt"
    ]) {
      const result = await runner.run(command);
      assert.equal(result.ok, false, command);
      assert.match(result.output, /Sed/, command);
    }

    assert.equal(existsSync(join(dir, "out.txt")), false);
    assert.equal(existsSync(join(dir, "out2.txt")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner caps shell command output using maxReadBytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-output-cap-"));
  try {
    await writeFile(join(dir, "big.txt"), "abcdefghijklmnop", "utf8");
    const runner = new ToolRunner({
      ...testToolsConfig(dir),
      maxReadBytes: 5
    });

    const result = await runner.run("shell cat big.txt");

    assert.equal(result.ok, true);
    assert.match(result.output, /^abcde/);
    assert.match(result.output, /stdout truncated at 5 bytes/);
    assert.doesNotMatch(result.output, /fgh/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner returns failed results for filesystem and spawn errors instead of throwing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-errors-"));
  try {
    const runner = new ToolRunner({
      ...testToolsConfig(dir),
      shell: {
        ...testToolsConfig(dir).shell,
        allowedCommands: ["missing-viser-test-command"]
      }
    });

    const missingFile = await runner.run("read-file missing.txt");
    assert.equal(missingFile.ok, false);
    assert.equal(missingFile.title, "tool error");
    assert.match(missingFile.output, /not found/i);

    const missingDir = await runner.run("list-dir missing-dir");
    assert.equal(missingDir.ok, false);
    assert.equal(missingDir.title, "tool error");
    assert.match(missingDir.output, /not found/i);

    const missingCommand = await runner.run("shell missing-viser-test-command");
    assert.equal(missingCommand.ok, false);
    assert.equal(missingCommand.title, "tool error");
    assert.match(missingCommand.output, /not found/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function runGit(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
}
