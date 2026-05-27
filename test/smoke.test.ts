import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { localSmoke, smokeReport } from "../src/cli/smoke.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { ViserConfig } from "../src/core/types.ts";

test("localSmoke proves local runtime features without external provider CLIs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-smoke-test-"));
  try {
    const result = await localSmoke(smokeConfig(dir));

    assert.equal(result.ok, true);
    assert.equal(result.summary.failCount, 0);
    assert.ok(result.summary.passCount >= 9);
    assert.ok(result.items.some((item) => item.area === "actions" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "messenger-outbound" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "jobs" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "security" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "telegram" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "discord" && item.status === "pass"));
    assert.match(result.report, /Viser local smoke: PASS/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("localSmoke can keep artifacts for manual debugging", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-smoke-keep-test-"));
  try {
    const result = await localSmoke(smokeConfig(dir), { keepArtifacts: true });

    assert.equal(result.ok, true);
    await stat(result.artifactDir);
    assert.match(result.report, /artifacts:/);
    await rm(result.artifactDir, { recursive: true, force: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("smokeReport returns a user-facing summary", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-smoke-report-test-"));
  try {
    const report = await smokeReport(smokeConfig(dir));

    assert.match(report, /Viser local smoke: PASS/);
    assert.match(report, /\[security]/);
    assert.match(report, /\[messenger-outbound]/);
    assert.match(report, /\[telegram]/);
    assert.match(report, /\[discord]/);
    assert.match(report, /\[memory]/);
    assert.match(report, /\[backup]/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function smokeConfig(dir: string): ViserConfig {
  return {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, workdir: dir },
    storage: { dir: join(dir, ".viser") },
    memory: { ...DEFAULT_CONFIG.memory, dir: join(dir, ".viser", "memory") },
    skills: { ...DEFAULT_CONFIG.skills, dirs: [join(dir, "skills"), join(dir, ".viser", "skills")] },
    plugins: { ...DEFAULT_CONFIG.plugins, dirs: [join(dir, "plugins"), join(dir, ".viser", "plugins")] },
    tools: { ...DEFAULT_CONFIG.tools, allowedReadRoots: [dir] },
    scheduler: { ...DEFAULT_CONFIG.scheduler, dir: join(dir, ".viser", "scheduler") },
    jobs: { ...DEFAULT_CONFIG.jobs, dir: join(dir, ".viser", "jobs") },
    access: { ...DEFAULT_CONFIG.access, dir: join(dir, ".viser", "access") },
    actions: { ...DEFAULT_CONFIG.actions, dir: join(dir, ".viser", "actions"), allowedWriteRoots: [dir] },
    connectors: {
      telegram: { ...DEFAULT_CONFIG.connectors.telegram, allowedChatIds: [], defaultChatIds: [] },
      discord: { ...DEFAULT_CONFIG.connectors.discord, allowedChannelIds: [], defaultChannelIds: [] }
    }
  };
}
