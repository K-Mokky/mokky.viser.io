import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeExampleConfig } from "../src/cli/init.ts";

test("writeExampleConfig creates a private config file and skips safe existing files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-init-"));
  const originalCwd = process.cwd();
  try {
    process.chdir(dir);

    const first = await writeExampleConfig();
    const second = await writeExampleConfig();
    const configPath = join(dir, "viser.config.json");

    assert.match(first, /Created .*viser\.config\.json/);
    assert.match(second, /already exists/);
    assert.equal(statSync(configPath).mode & 0o777, 0o600);
    assert.match(await readFile(configPath, "utf8"), /"assistant"/);
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeExampleConfig refuses to skip a symlinked config target", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-init-symlink-"));
  const originalCwd = process.cwd();
  try {
    process.chdir(dir);
    const outside = join(dir, "outside.config.json");
    const target = join(dir, "viser.config.json");
    await writeFile(outside, "{\"outside\":true}\n", "utf8");
    await symlink(outside, target);

    await assert.rejects(() => writeExampleConfig(), /symlink/i);

    assert.equal(await readFile(outside, "utf8"), "{\"outside\":true}\n");
    assert.equal((await lstat(target)).isSymbolicLink(), true);
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeExampleConfig force replaces config symlinks without clobbering linked files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-init-force-symlink-"));
  const originalCwd = process.cwd();
  try {
    process.chdir(dir);
    const outside = join(dir, "outside.config.json");
    const target = join(dir, "viser.config.json");
    await writeFile(outside, "{\"outside\":true}\n", "utf8");
    await symlink(outside, target);

    const report = await writeExampleConfig(true);

    assert.match(report, /Created .*viser\.config\.json/);
    assert.equal(await readFile(outside, "utf8"), "{\"outside\":true}\n");
    assert.equal((await lstat(target)).isSymbolicLink(), false);
    assert.match(await readFile(target, "utf8"), /"assistant"/);
    assert.equal(statSync(target).mode & 0o777, 0o600);
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});
