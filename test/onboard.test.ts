import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

test("onboard prepares first-run files and prints a beginner 3-step guide", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-onboard-"));
  try {
    const { stdout } = await execFile(process.execPath, [resolve("src/index.ts"), "onboard"], {
      cwd: dir,
      timeout: 20_000,
      env: { ...process.env, TELEGRAM_BOT_TOKEN: "", DISCORD_BOT_TOKEN: "" }
    });

    assert.equal(existsSync(join(dir, "viser.config.json")), true);
    assert.equal(existsSync(join(dir, ".npmrc")), true);
    assert.equal(existsSync(join(dir, ".viser", "skills")), true);

    assert.match(stdout, /Viser 시작하기/);
    assert.match(stdout, /node src\/index.ts verify/);
    assert.match(stdout, /node src\/index.ts chat/);
    assert.match(stdout, /codex login/);
    assert.match(stdout, /SECURITY\.md/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("onboard --check reports the plan without creating files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-onboard-check-"));
  try {
    const { stdout } = await execFile(process.execPath, [resolve("src/index.ts"), "onboard", "--check"], {
      cwd: dir,
      timeout: 20_000,
      env: { ...process.env, TELEGRAM_BOT_TOKEN: "", DISCORD_BOT_TOKEN: "" }
    });

    assert.equal(existsSync(join(dir, "viser.config.json")), false);
    assert.equal(existsSync(join(dir, ".npmrc")), false);
    assert.match(stdout, /이제 딱 3가지만/);
    assert.match(stdout, /node src\/index.ts chat/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
