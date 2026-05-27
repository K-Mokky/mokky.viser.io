import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendPrivateFile,
  ensurePrivateDir,
  listPrivateDirIfExists,
  privateFileStatIfExists,
  readPrivateFileIfExists,
  removePrivateFileIfExists,
  writePrivateFile
} from "../src/utils/files.ts";

test("writePrivateFile writes private files without leaving temp files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-files-private-"));
  try {
    const path = join(dir, "state.json");

    await writePrivateFile(path, "{\"ok\":true}\n");

    assert.equal(await readFile(path, "utf8"), "{\"ok\":true}\n");
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual((await readdir(dir)).sort(), ["state.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writePrivateFile replaces symlink targets without modifying the linked file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-files-symlink-"));
  try {
    const outside = join(dir, "outside.txt");
    const path = join(dir, "state.json");
    await writeFile(outside, "outside", "utf8");
    await symlink(outside, path);

    await writePrivateFile(path, "new-state");

    assert.equal(await readFile(outside, "utf8"), "outside");
    assert.equal(await readFile(path, "utf8"), "new-state");
    assert.equal((await lstat(path)).isSymbolicLink(), false);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writePrivateFile replaces broad existing files with private atomic output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-files-private-replace-"));
  try {
    const path = join(dir, "state.json");
    await writeFile(path, "old-state", "utf8");

    await writePrivateFile(path, "new-state");

    assert.equal(await readFile(path, "utf8"), "new-state");
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writePrivateFile removes temporary files when atomic replace fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-files-private-fail-cleanup-"));
  try {
    const path = join(dir, "state.json");
    await mkdir(path);

    await assert.rejects(() => writePrivateFile(path, "new-state"));

    assert.deepEqual((await readdir(dir)).sort(), ["state.json"]);
    assert.equal((await lstat(path)).isDirectory(), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendPrivateFile writes through private directories and refuses symlink targets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-files-append-private-"));
  try {
    const privateDir = join(dir, "state");
    const path = join(privateDir, "events.jsonl");

    await appendPrivateFile(path, "one\n");
    await appendPrivateFile(path, "two\n");

    assert.equal(await readFile(path, "utf8"), "one\ntwo\n");
    assert.equal((await stat(privateDir)).mode & 0o777, 0o700);
    assert.equal((await stat(path)).mode & 0o777, 0o600);

    const outside = join(dir, "outside.jsonl");
    const link = join(privateDir, "link.jsonl");
    await writeFile(outside, "outside\n", "utf8");
    await symlink(outside, link);

    await assert.rejects(() => appendPrivateFile(link, "secret\n"));
    assert.equal(await readFile(outside, "utf8"), "outside\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ensurePrivateDir rejects symlinked directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-files-private-dir-"));
  try {
    await mkdir(join(dir, "real"));
    await symlink(join(dir, "real"), join(dir, "link"));

    await assert.rejects(() => ensurePrivateDir(join(dir, "link")), /symlink/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ensurePrivateDir rejects symlinked private path components under cwd", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-files-private-parent-"));
  const originalCwd = process.cwd();
  try {
    process.chdir(dir);
    await mkdir("outside");
    await symlink("outside", ".viser");

    await assert.rejects(() => ensurePrivateDir(".viser/memory"), /symlink/);
    await assert.rejects(() => stat(join(dir, "outside", "memory")));
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});

test("private state readers reject symlinked private path components under cwd", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-files-private-reader-parent-"));
  const originalCwd = process.cwd();
  try {
    process.chdir(dir);
    await mkdir(join(dir, "outside", "jobs"), { recursive: true });
    await writeFile(join(dir, "outside", "jobs", "jobs.json"), "[]\n", "utf8");
    await symlink("outside", ".viser");

    await assert.rejects(
      () => readPrivateFileIfExists(".viser/jobs/jobs.json", { dirs: [".viser/jobs"] }),
      /symlink/i
    );
    await assert.rejects(
      () => privateFileStatIfExists(".viser/jobs/jobs.json", { dirs: [".viser/jobs"] }),
      /symlink/i
    );
    await assert.rejects(
      () => listPrivateDirIfExists(".viser/jobs", { dirs: [".viser"] }),
      /symlink/i
    );
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});

test("removePrivateFileIfExists removes only regular private files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-files-private-remove-"));
  try {
    const privateDir = join(dir, "state");
    const path = join(privateDir, "events.jsonl");
    const missing = join(privateDir, "missing.jsonl");
    await ensurePrivateDir(privateDir);
    await writePrivateFile(path, "private event\n");

    assert.equal(await removePrivateFileIfExists(path, { dirs: [privateDir] }), true);
    assert.equal(await removePrivateFileIfExists(missing, { dirs: [privateDir] }), false);
    await assert.rejects(() => readFile(path, "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("removePrivateFileIfExists refuses symlink targets without deleting linked files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-files-private-remove-symlink-"));
  try {
    const privateDir = join(dir, "state");
    const outside = join(dir, "outside.jsonl");
    const link = join(privateDir, "events.jsonl");
    await mkdir(privateDir);
    await writeFile(outside, "outside event\n", "utf8");
    await symlink(outside, link);

    await assert.rejects(() => removePrivateFileIfExists(link, { dirs: [privateDir] }), /symlink/i);
    assert.equal(await readFile(outside, "utf8"), "outside event\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
