import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

test("setup creates first-run files and prints safe provider-proof launch guidance", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-setup-"));
  try {
    const { stdout } = await execFile(process.execPath, [resolve("src/index.ts"), "setup"], {
      cwd: dir,
      timeout: 20_000,
      env: {
        ...process.env,
        TELEGRAM_BOT_TOKEN: "",
        DISCORD_BOT_TOKEN: ""
      }
    });

    assert.equal(existsSync(join(dir, "viser.config.json")), true);
    assert.equal(existsSync(join(dir, ".env")), true);
    assert.equal(existsSync(join(dir, ".viser", "skills")), true);
    assert.match(stdout, /Viser setup/);
    assert.match(stdout, /Created .*\.env/);
    assert.match(stdout, /viser env-check/);
    assert.match(stdout, /viser gateway --dry-run --strict --live --probe-all-providers/);
    assert.match(stdout, /viser launch-status/);
    assert.match(stdout, /Start Viser with `viser` in a foreground terminal window only after the rehearsal passes/);
    assert.match(stdout, /Background service install\/start\/service-run and artifact generation are disabled/);
    assert.match(stdout, /viser service uninstall/);
    assert.match(stdout, /VISER_ENV/);
    assert.doesNotMatch(stdout, /Run `viser gateway` for scheduler \+ messaging/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("setup refuses to install starter skills through a symlinked target", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-setup-symlink-skills-"));
  try {
    const outside = join(dir, "outside-skills");
    await mkdir(join(dir, ".viser"), { recursive: true });
    await mkdir(outside);
    await writeFile(join(outside, "keep.txt"), "outside-original\n", "utf8");
    await symlink(outside, join(dir, ".viser", "skills"));

    await assert.rejects(
      () => execFile(process.execPath, [resolve("src/index.ts"), "setup"], {
        cwd: dir,
        timeout: 20_000,
        env: {
          ...process.env,
          TELEGRAM_BOT_TOKEN: "",
          DISCORD_BOT_TOKEN: ""
        }
      }),
      /symlink/i
    );

    assert.equal(await readFile(join(outside, "keep.txt"), "utf8"), "outside-original\n");
    assert.equal(existsSync(join(outside, "daily-brief")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("setup --force refuses to overwrite an existing symlinked starter skill target", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-setup-symlink-skill-target-"));
  try {
    const outside = join(dir, "outside-daily-brief");
    await mkdir(join(dir, ".viser", "skills"), { recursive: true });
    await mkdir(outside);
    await writeFile(join(outside, "keep.txt"), "outside-original\n", "utf8");
    await symlink(outside, join(dir, ".viser", "skills", "daily-brief"));

    await assert.rejects(
      () => execFile(process.execPath, [resolve("src/index.ts"), "setup", "--force"], {
        cwd: dir,
        timeout: 20_000,
        env: {
          ...process.env,
          TELEGRAM_BOT_TOKEN: "",
          DISCORD_BOT_TOKEN: ""
        }
      }),
      /symlink/i
    );

    assert.equal(await readFile(join(outside, "keep.txt"), "utf8"), "outside-original\n");
    assert.equal(existsSync(join(outside, "SKILL.md")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("setup refuses to skip an existing symlinked starter skill target", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-setup-skip-symlink-skill-target-"));
  try {
    const outside = join(dir, "outside-daily-brief");
    await mkdir(join(dir, ".viser", "skills"), { recursive: true });
    await mkdir(outside);
    await writeFile(join(outside, "keep.txt"), "outside-original\n", "utf8");
    await symlink(outside, join(dir, ".viser", "skills", "daily-brief"));

    await assert.rejects(
      () => execFile(process.execPath, [resolve("src/index.ts"), "setup"], {
        cwd: dir,
        timeout: 20_000,
        env: {
          ...process.env,
          TELEGRAM_BOT_TOKEN: "",
          DISCORD_BOT_TOKEN: ""
        }
      }),
      /symlink/i
    );

    assert.equal(await readFile(join(outside, "keep.txt"), "utf8"), "outside-original\n");
    assert.equal(existsSync(join(outside, "SKILL.md")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("setup --force refuses starter skill targets that contain symlinked files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-setup-symlink-skill-file-"));
  try {
    const skillDir = join(dir, ".viser", "skills", "daily-brief");
    const outside = join(dir, "outside-skill.md");
    await mkdir(skillDir, { recursive: true });
    await writeFile(outside, "outside-original\n", "utf8");
    await symlink(outside, join(skillDir, "SKILL.md"));

    await assert.rejects(
      () => execFile(process.execPath, [resolve("src/index.ts"), "setup", "--force"], {
        cwd: dir,
        timeout: 20_000,
        env: {
          ...process.env,
          TELEGRAM_BOT_TOKEN: "",
          DISCORD_BOT_TOKEN: ""
        }
      }),
      /symlink/i
    );

    assert.equal(await readFile(outside, "utf8"), "outside-original\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("setup refuses to skip starter skill targets that contain symlinked files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-setup-skip-symlink-skill-file-"));
  try {
    const skillDir = join(dir, ".viser", "skills", "daily-brief");
    const outside = join(dir, "outside-skill.md");
    await mkdir(skillDir, { recursive: true });
    await writeFile(outside, "outside-original\n", "utf8");
    await symlink(outside, join(skillDir, "SKILL.md"));

    await assert.rejects(
      () => execFile(process.execPath, [resolve("src/index.ts"), "setup"], {
        cwd: dir,
        timeout: 20_000,
        env: {
          ...process.env,
          TELEGRAM_BOT_TOKEN: "",
          DISCORD_BOT_TOKEN: ""
        }
      }),
      /symlink/i
    );

    assert.equal(await readFile(outside, "utf8"), "outside-original\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
