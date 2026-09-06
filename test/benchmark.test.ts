import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { benchmarkReport, runBenchmark } from "../src/cli/benchmark.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { ViserConfig } from "../src/core/types.ts";

test("benchmarkReport measures Viser locally without external provider CLIs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-benchmark-test-"));
  try {
    const report = await benchmarkReport(testConfig(dir), { iterations: 3 });

    assert.match(report, /Viser benchmark: PASS/);
    assert.match(report, /mode: local-deterministic/);
    assert.match(report, /viser: PASS/);
    assert.match(report, /Competitive status: no-baseline/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runBenchmark can compare an explicit same-host baseline command without a shell", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-benchmark-baseline-"));
  try {
    const baselinePath = join(dir, "baseline.sh");
    await writeFile(baselinePath, "#!/bin/sh\nprintf '%s\\n' VISER_BENCHMARK_OK\n", "utf8");
    await chmod(baselinePath, 0o755);

    const result = await runBenchmark(testConfig(dir), {
      iterations: 2,
      hermes: `${baselinePath} {prompt}`
    });

    assert.equal(result.ok, true);
    assert.equal(result.baselines.length, 1);
    assert.equal(result.baselines[0]?.label, "hermes");
    assert.equal(result.baselines[0]?.ok, true);
    assert.match(JSON.stringify(result), /VISER_BENCHMARK_OK/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("benchmarkReport emits machine-readable JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-benchmark-json-"));
  try {
    const parsed = JSON.parse(await benchmarkReport(testConfig(dir), { iterations: 1, json: true })) as {
      ok: boolean;
      schemaVersion: number;
      viser: { stats: { count: number; okCount: number } };
      competitiveStatus: string;
    };

    assert.equal(parsed.ok, true);
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.viser.stats.count, 1);
    assert.equal(parsed.viser.stats.okCount, 1);
    assert.equal(parsed.competitiveStatus, "no-baseline");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runBenchmark can save a private benchmark artifact for release evidence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-benchmark-save-"));
  try {
    const artifactPath = join(dir, ".viser", "benchmarks", "saved.json");
    const result = await runBenchmark(testConfig(dir), {
      iterations: 1,
      save: true,
      artifactPath
    });
    const saved = JSON.parse(await readFile(artifactPath, "utf8")) as {
      schemaVersion: number;
      artifactPath: string;
      competitiveStatus: string;
      viser: { ok: boolean };
    };

    assert.equal(result.artifactPath, artifactPath);
    assert.equal(saved.schemaVersion, 1);
    assert.equal(saved.artifactPath, artifactPath);
    assert.equal(saved.competitiveStatus, "no-baseline");
    assert.equal(saved.viser.ok, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function testConfig(dir: string): ViserConfig {
  return {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, workdir: dir },
    storage: { dir: join(dir, ".viser") },
    memory: { ...DEFAULT_CONFIG.memory, dir: join(dir, ".viser", "memory") },
    personalization: { ...DEFAULT_CONFIG.personalization, dir: join(dir, ".viser", "personalization") },
    skills: { ...DEFAULT_CONFIG.skills, dirs: [join(dir, "skills"), join(dir, ".viser", "skills")] },
    plugins: { ...DEFAULT_CONFIG.plugins, dirs: [join(dir, "plugins"), join(dir, ".viser", "plugins")] },
    tools: { ...DEFAULT_CONFIG.tools, allowedReadRoots: [dir] },
    scheduler: { ...DEFAULT_CONFIG.scheduler, dir: join(dir, ".viser", "scheduler") },
    jobs: { ...DEFAULT_CONFIG.jobs, dir: join(dir, ".viser", "jobs") },
    access: { ...DEFAULT_CONFIG.access, dir: join(dir, ".viser", "access") },
    actions: { ...DEFAULT_CONFIG.actions, dir: join(dir, ".viser", "actions"), allowedWriteRoots: [dir] }
  };
}
