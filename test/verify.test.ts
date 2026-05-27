import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verify } from "../src/cli/verify.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { ViserConfig } from "../src/core/types.ts";

test("verify combines readiness and audit into one pass report", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-verify-"));
  try {
    const result = await verify(verifyConfig(dir));

    assert.equal(result.ok, true);
    assert.match(result.report, /Viser verify: PASS/);
    assert.match(result.report, /readiness:/);
    assert.match(result.report, /audit:/);
    assert.match(result.report, /local smoke: PASS/);
    assert.match(result.report, /gateway strict gate: pass/);
    assert.match(result.report, /node src\/index.ts gateway --dry-run --strict/);
    assert.match(result.report, /node src\/index.ts launch-status/);
    assert.match(result.report, /node src\/index.ts next-steps --live --probe-all-providers/);
    assert.match(result.report, /node src\/index.ts gateway/);
    assert.match(result.report, /node src\/index.ts service-run --live --probe-all-providers/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("verify reports blockers when readiness fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-verify-blocked-"));
  try {
    const config = verifyConfig(dir);
    config.assistant.defaultProvider = "missing";
    config.providers = {
      missing: {
        id: "missing",
        command: "definitely-not-real-viser-provider",
        args: [],
        promptMode: "argument",
        timeoutMs: 1000
      }
    };
    const result = await verify(config, { strict: true });

    assert.equal(result.ok, false);
    assert.match(result.report, /Viser verify: BLOCKED/);
    assert.match(result.report, /Blockers:/);
    assert.match(result.report, /default provider command/);
    assert.match(result.report, /strict mode: on/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("verify fails the gateway strict gate when audit fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-verify-audit-blocked-"));
  try {
    const config = verifyConfig(dir);
    config.tools.shell.allowedCommands = ["ls", "rm"];

    const result = await verify(config);

    assert.equal(result.ok, false);
    assert.match(result.report, /Viser verify: BLOCKED/);
    assert.match(result.report, /gateway strict gate: fail/);
    assert.match(result.report, /\[audit:tools]/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("verify can validate provider fallback with all-provider probe", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-verify-probe-all-"));
  try {
    const config = verifyConfig(dir);
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

    const result = await verify(config, { probeAllProviders: true });

    assert.equal(result.ok, true);
    assert.match(result.report, /Viser verify: PASS/);
    assert.match(result.report, /usable default\/fallback provider\(s\): good/);
    assert.match(result.report, /node src\/index.ts provider-guide --probe/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("verify reports blockers when all provider probes fail", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-verify-probe-all-fail-"));
  try {
    const config = verifyConfig(dir);
    config.assistant.defaultProvider = "bad";
    config.assistant.fallbackProviders = [];
    config.providers = {
      bad: {
        id: "bad",
        label: "Bad",
        command: "node",
        args: ["-e", "console.error('NOPE'); process.exit(2)"],
        promptMode: "argument",
        timeoutMs: 5000
      }
    };

    const result = await verify(config, { probeAllProviders: true });

    assert.equal(result.ok, false);
    assert.match(result.report, /Viser verify: BLOCKED/);
    assert.match(result.report, /no default\/fallback provider responded successfully/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("verify includes provider-specific recovery advice for failed probes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-verify-provider-recovery-"));
  try {
    const config = verifyConfig(dir);
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

    const result = await verify(config, { probeAllProviders: true });

    assert.equal(result.ok, false);
    assert.match(result.report, /Provider recovery:/);
    assert.match(result.report, /blocked: detected issue: sandbox\/permission failure/);
    assert.match(result.report, /manual smoke test:/);
    assert.match(result.report, /node src\/index.ts verify --live --probe-all-providers/);
    assert.match(result.report, /node src\/index.ts launch-status/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function verifyConfig(dir: string): ViserConfig {
  return {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, defaultProvider: "echo", fallbackProviders: [], workdir: dir },
    storage: { dir: join(dir, ".viser") },
    memory: { ...DEFAULT_CONFIG.memory, dir: join(dir, ".viser", "memory") },
    skills: { ...DEFAULT_CONFIG.skills, dirs: [join(dir, "skills"), join(dir, ".viser", "skills")] },
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
        timeoutMs: 5000
      }
    }
  };
}
