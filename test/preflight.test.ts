import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { preflight, preflightReport } from "../src/cli/preflight.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { ViserConfig } from "../src/core/types.ts";

test("preflight is a no-start launch gate over verify", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-preflight-"));
  try {
    const result = await preflight(preflightConfig(dir));

    assert.equal(result.ok, true);
    assert.match(result.report, /Viser preflight: PASS/);
    assert.match(result.report, /check-only/);
    assert.match(result.report, /no gateway, scheduler, job worker, or connector process was started/);
    assert.match(result.report, /Viser verify: PASS/);
    assert.match(result.report, /node src\/index.ts launch-status/);
    assert.match(result.report, /node src\/index.ts gateway/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("preflight reports provider-proof mode when probes are requested", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-preflight-probe-"));
  try {
    const result = await preflight(preflightConfig(dir), { probeAllProviders: true });

    assert.equal(result.ok, true);
    assert.match(result.report, /provider runtime proof: requested/);
    assert.match(result.report, /Provider runtime was included/);
    assert.match(result.report, /node src\/index.ts gateway/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("preflight blocks when provider probes fail", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-preflight-blocked-"));
  try {
    const config = preflightConfig(dir);
    config.assistant.defaultProvider = "bad";
    config.providers = {
      bad: {
        id: "bad",
        label: "Bad",
        command: "node",
        args: ["-e", "process.exit(2)"],
        promptMode: "argument",
        timeoutMs: 5000
      }
    };

    const report = await preflightReport(config, { probeAllProviders: true });

    assert.match(report, /Viser preflight: BLOCKED/);
    assert.match(report, /Do not launch yet/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function preflightConfig(dir: string): ViserConfig {
  return {
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
        args: ["-e", "console.log('VISER_OK')"],
        promptMode: "argument",
        timeoutMs: 5000,
        loginHint: "No login needed for test provider."
      }
    }
  };
}
