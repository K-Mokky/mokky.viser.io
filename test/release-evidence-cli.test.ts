import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

test("release-evidence --strict exits zero when objective completion is proven", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-release-evidence-cli-"));
  try {
    const configPath = await writeCliConfig(dir);
    const envPath = join(dir, ".env");
    await writeFile(envPath, "", "utf8");

    const relaxed = await runViser(["--config", configPath, "--env", envPath, "release-evidence"]);
    assert.match(relaxed.stdout, /Viser public release evidence: READY/);
    assert.match(relaxed.stdout, /Goal completion audit:/);
    assert.match(relaxed.stdout, /status: PROVEN/);

    const strict = await runViser(["--config", configPath, "--env", envPath, "release-evidence", "--strict"]);
    assert.match(strict.stdout, /Viser public release evidence: READY/);
    assert.match(strict.stdout, /status: PROVEN/);
    assert.match(strict.stdout, /remaining proof:\n  - none/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function runViser(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return await execFile(process.execPath, ["src/index.ts", ...args], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? "",
      TMPDIR: process.env.TMPDIR ?? tmpdir()
    },
    maxBuffer: 1024 * 1024 * 8
  });
}

async function writeCliConfig(dir: string): Promise<string> {
  const configPath = join(dir, "viser.config.json");
  await writeFile(configPath, JSON.stringify({
    assistant: {
      defaultProvider: "echo",
      fallbackProviders: [],
      workdir: dir
    },
    storage: { dir: join(dir, ".viser") },
    memory: { dir: join(dir, ".viser", "memory") },
    skills: { dirs: [join(dir, "skills"), join(dir, ".viser", "skills")] },
    plugins: { dirs: [join(dir, "plugins"), join(dir, ".viser", "plugins")] },
    tools: { allowedReadRoots: [dir] },
    scheduler: { dir: join(dir, ".viser", "scheduler") },
    jobs: { dir: join(dir, ".viser", "jobs") },
    access: { dir: join(dir, ".viser", "access") },
    actions: {
      dir: join(dir, ".viser", "actions"),
      allowedWriteRoots: [dir]
    },
    connectors: {
      telegram: { enabled: false, allowedChatIds: [], defaultChatIds: [] },
      discord: { enabled: false, allowedChannelIds: [], defaultChannelIds: [] },
      slack: { enabled: false, allowedChannelIds: [], defaultChannelIds: [] },
      matrix: { enabled: false, allowedRoomIds: [], defaultRoomIds: [] },
      signal: { enabled: false, allowedRecipientIds: [], defaultRecipientIds: [] }
    },
    providers: {
      echo: {
        id: "echo",
        label: "Echo",
        command: "node",
        args: ["-e", "console.log('VISER_OK')"],
        promptMode: "argument",
        timeoutMs: 5000
      }
    }
  }), "utf8");
  return configPath;
}
