import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { ViserConfig } from "../src/core/types.ts";

const execFile = promisify(execFileCallback);

test("launch-status is a single live provider-proof launch gate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-launch-status-"));
  try {
    const configPath = await writeLaunchConfig(dir, ["-e", "console.log('VISER_OK')"]);
    const { stdout } = await runViser(dir, ["--config", configPath, "launch-status"]);

    assert.match(stdout, /Viser launch status: READY/);
    assert.match(stdout, /single-command live launch gate/);
    assert.match(stdout, /live connector token proof: requested/);
    assert.match(stdout, /provider runtime proof: requested/);
    assert.match(stdout, /Viser preflight: PASS/);
    assert.match(stdout, /Next: run `node src\/index.ts gateway`/);
    assert.match(stdout, /next-steps --live --probe-all-providers/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("launch-status exits non-zero when the live launch gate is blocked", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-launch-status-blocked-"));
  try {
    const configPath = await writeLaunchConfig(dir, ["-e", "process.exit(2)"]);

    await assert.rejects(
      runViser(dir, ["--config", configPath, "launch-status"]),
      (error) => {
        const failure = error as { code?: number; stdout?: string };
        assert.equal(failure.code, 1);
        assert.match(failure.stdout ?? "", /Viser launch status: BLOCKED/);
        assert.match(failure.stdout ?? "", /Viser preflight: BLOCKED/);
        assert.match(failure.stdout ?? "", /next-steps --live --probe-all-providers/);
        return true;
      }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function runViser(dir: string, args: string[]) {
  const emptyEnvPath = join(dir, "empty.env");
  await writeFile(emptyEnvPath, "", "utf8");
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    VISER_ENV: emptyEnvPath,
    TELEGRAM_BOT_TOKEN: "",
    DISCORD_BOT_TOKEN: ""
  };
  delete childEnv.VISER_CONFIG;
  delete childEnv.VISER_PROVIDER;

  return execFile(process.execPath, ["src/index.ts", ...args], {
    cwd: process.cwd(),
    timeout: 20_000,
    env: childEnv
  });
}

async function writeLaunchConfig(dir: string, providerArgs: string[]): Promise<string> {
  const config: ViserConfig = {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, defaultProvider: "echo", fallbackProviders: [], workdir: dir },
    storage: { dir: join(dir, ".viser") },
    memory: { ...DEFAULT_CONFIG.memory, dir: join(dir, ".viser", "memory") },
    skills: { ...DEFAULT_CONFIG.skills, dirs: [join(dir, "skills"), join(dir, ".viser", "skills")] },
    tools: { ...DEFAULT_CONFIG.tools, allowedReadRoots: [dir] },
    scheduler: { ...DEFAULT_CONFIG.scheduler, dir: join(dir, ".viser", "scheduler") },
    jobs: { ...DEFAULT_CONFIG.jobs, dir: join(dir, ".viser", "jobs") },
    access: { ...DEFAULT_CONFIG.access, dir: join(dir, ".viser", "access") },
    actions: { ...DEFAULT_CONFIG.actions, dir: join(dir, ".viser", "actions"), allowedWriteRoots: [dir] },
    connectors: {
      telegram: { ...DEFAULT_CONFIG.connectors.telegram, allowedChatIds: [], defaultChatIds: [] },
      discord: { ...DEFAULT_CONFIG.connectors.discord, allowedChannelIds: [], defaultChannelIds: [] }
    },
    providers: {
      echo: {
        id: "echo",
        label: "Echo",
        command: "node",
        args: providerArgs,
        promptMode: "argument",
        timeoutMs: 5000,
        loginHint: "No login needed for test provider."
      }
    }
  };
  const configPath = join(dir, "viser.config.json");
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
  return configPath;
}
