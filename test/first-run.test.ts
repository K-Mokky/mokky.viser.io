import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

test("bare viser invocation performs non-destructive first-run setup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-first-run-"));
  try {
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    delete childEnv.VISER_ENV;
    delete childEnv.VISER_CONFIG;
    delete childEnv.VISER_PROVIDER;
    delete childEnv.TELEGRAM_BOT_TOKEN;
    delete childEnv.DISCORD_BOT_TOKEN;

    const { stdout } = await execFile(process.execPath, [resolve("src/index.ts")], {
      cwd: dir,
      timeout: 20_000,
      env: childEnv
    });

    assert.match(stdout, /Viser first-run setup/);
    assert.match(stdout, /Created .*viser\.config\.json/);
    assert.match(stdout, /Created .*\.env/);
    assert.match(stdout, /run `viser` again to start chat/);
    assert.ok(existsSync(join(dir, "viser.config.json")));
    assert.ok(existsSync(join(dir, ".env")));
    assert.ok(existsSync(join(dir, ".viser", "skills")));
    assert.match(await readFile(join(dir, ".env"), "utf8"), /VISER_PROVIDER=codex/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
