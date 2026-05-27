import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nextStepsReport } from "../src/cli/next-steps.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { ViserConfig } from "../src/core/types.ts";

test("nextStepsReport gives a launch checklist without running provider probes by default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-next-"));
  try {
    const report = await nextStepsReport(nextStepsConfig(dir));

    assert.match(report, /Viser next steps/);
    assert.match(report, /runtime not proven yet/);
    assert.match(report, /node src\/index.ts verify --live --probe-all-providers/);
    assert.match(report, /manual smoke tests in a normal terminal/);
    assert.match(report, /Single-command launch status: `node src\/index.ts launch-status`/);
    assert.match(report, /No-start preflight/);
    assert.match(report, /CLI chat: `node src\/index.ts chat`/);
    assert.match(report, /Gateway strict live provider-proof dry-run: `node src\/index.ts gateway --dry-run --strict --live --probe-all-providers`/);
    assert.match(report, /Live provider-proof foreground gateway: `node src\/index.ts gateway`/);
    assert.match(report, /Live provider-proof launchd service runner: `node src\/index.ts service-run --live --probe-all-providers`/);
    assert.match(report, /Explicit live provider-proof foreground gateway: `node src\/index.ts gateway --strict --live --probe-all-providers`/);
    assert.match(report, /Unsafe raw foreground gateway for debugging only: `node src\/index.ts gateway --unsafe-skip-gate`/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nextStepsReport highlights a working fallback provider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-next-fallback-"));
  try {
    const config = nextStepsConfig(dir);
    config.assistant.defaultProvider = "bad";
    config.assistant.fallbackProviders = ["good"];
    config.providers = {
      bad: {
        id: "bad",
        label: "Bad",
        command: "node",
        args: ["-e", "console.error('NOPE'); process.exit(2)"],
        promptMode: "argument",
        timeoutMs: 5000
      },
      good: {
        id: "good",
        label: "Good",
        command: "node",
        args: ["-e", "console.log('VISER_OK')"],
        promptMode: "argument",
        timeoutMs: 5000
      }
    };

    const report = await nextStepsReport(config, { probeAllProviders: true });

    assert.match(report, /usable default\/fallback provider\(s\): good/);
    assert.match(report, /fix bad:/);
    assert.match(report, /provider guide: `node src\/index.ts provider-guide --probe`/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nextStepsReport classifies provider probe failures into concrete recovery steps", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-next-provider-fix-"));
  try {
    const config = nextStepsConfig(dir);
    config.assistant.defaultProvider = "blocked";
    config.assistant.fallbackProviders = [];
    config.providers = {
      blocked: {
        id: "blocked",
        label: "Blocked",
        command: "node",
        args: ["-e", "console.error('Operation not permitted'); process.exit(1)"],
        promptMode: "argument",
        timeoutMs: 5000
      }
    };

    const report = await nextStepsReport(config, { probeAllProviders: true });

    assert.match(report, /detected issue: sandbox\/permission failure/);
    assert.match(report, /manual smoke test:/);
    assert.match(report, /node src\/index.ts verify --live --probe-all-providers/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nextStepsReport shows how to remove an unused missing fallback provider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-next-unused-fallback-"));
  try {
    const config = nextStepsConfig(dir);
    config.assistant.fallbackProviders = ["unused"];
    config.providers.unused = {
      id: "unused",
      label: "Unused",
      command: "definitely-not-a-real-viser-provider-command",
      args: [],
      promptMode: "argument",
      timeoutMs: 5000,
      loginHint: "Install the unused provider."
    };

    const report = await nextStepsReport(config);

    assert.match(report, /optional unused: definitely-not-a-real-viser-provider-command missing/);
    assert.match(report, /remove 'unused' from assistant\.fallbackProviders/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nextStepsReport gives connector and safety actions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-next-connectors-"));
  try {
    const report = await nextStepsReport(nextStepsConfig(dir));

    assert.match(report, /Messaging \/ gateway/);
    assert.match(report, /TELEGRAM_BOT_TOKEN=\.\.\./);
    assert.match(report, /DISCORD_BOT_TOKEN=\.\.\./);
    assert.match(report, /pair-code telegram\|discord/);
    assert.match(report, /backup state\/config/);
    assert.match(report, /node src\/index.ts smoke/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nextStepsReport reports intentionally disabled connectors without token setup warnings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-next-disabled-connectors-"));
  try {
    const config = nextStepsConfig(dir);
    const report = await nextStepsReport(config, { live: true, probeAllProviders: true });

    assert.match(report, /live Telegram\/Discord token validation not configured/);
    assert.match(report, /ℹ️ live token check telegram: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check discord: disabled \(no token configured\)/);
    assert.doesNotMatch(report, /live Telegram\/Discord token validation passed/);
    assert.doesNotMatch(report, /Set TELEGRAM_BOT_TOKEN\./);
    assert.doesNotMatch(report, /Set DISCORD_BOT_TOKEN\./);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nextStepsReport turns live connector token rejection into messaging recovery actions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-next-live-token-"));
  const originalFetch = globalThis.fetch;
  try {
    const config = nextStepsConfig(dir);
    config.connectors.telegram.botToken = "bad-token";
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), {
      status: 401,
      statusText: "Unauthorized",
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

    const report = await nextStepsReport(config, { live: true });

    assert.match(report, /Messaging \/ gateway/);
    assert.match(report, /❌ live token check telegram: Unauthorized/);
    assert.match(report, /Check TELEGRAM_BOT_TOKEN; the configured token was rejected by telegram/);
    assert.match(report, /node src\/index.ts next-steps --live --probe-all-providers/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("nextStepsReport gives local tool recovery actions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-next-tools-"));
  try {
    const config = nextStepsConfig(dir);
    config.tools.shell.allowedCommands = ["definitely-not-a-real-viser-tool-command"];

    const report = await nextStepsReport(config);

    assert.match(report, /Local tools/);
    assert.match(report, /shell commands missing: definitely-not-a-real-viser-tool-command/);
    assert.match(report, /node src\/index.ts tools/);
    assert.match(report, /tools\.shell\.allowedCommands/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nextStepsReport gives starter skill setup actions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-next-skills-"));
  try {
    const report = await nextStepsReport(nextStepsConfig(dir));

    assert.match(report, /0 skills available/);
    assert.match(report, /node src\/index.ts setup/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function nextStepsConfig(dir: string): ViserConfig {
  return {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, defaultProvider: "echo", fallbackProviders: [], workdir: dir },
    storage: { dir: join(dir, ".viser") },
    memory: { ...DEFAULT_CONFIG.memory, dir: join(dir, ".viser", "memory") },
    skills: { ...DEFAULT_CONFIG.skills, dirs: [join(dir, "skills"), join(dir, ".viser", "skills")] },
    plugins: { ...DEFAULT_CONFIG.plugins, dirs: [join(dir, "plugins"), join(dir, ".viser", "plugins")] },
    tools: { ...DEFAULT_CONFIG.tools, allowedReadRoots: [dir], shell: { ...DEFAULT_CONFIG.tools.shell } },
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
        args: ["-e", "console.log('VISER_OK')"],
        promptMode: "argument",
        timeoutMs: 5000,
        loginHint: "No login needed for test provider."
      }
    }
  };
}
