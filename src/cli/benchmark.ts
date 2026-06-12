// ================================================================
// Local and competitive benchmark harness
// ================================================================
// Release evidence can prove that Viser has a bounded-parallel runtime, but
// equal-or-better performance claims need repeatable timing data. This module
// provides a dependency-free harness that measures Viser's provider path and,
// when explicitly supplied, same-host Hermes/OpenClaw baseline commands.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssistantRuntime } from "../core/assistant.ts";
import { splitCommandLine } from "../core/tools.ts";
import { runCommand } from "../utils/exec.ts";
import { listPrivateDirIfExists, readPrivateFileIfExists, writePrivateFile } from "../utils/files.ts";
import { formatDuration } from "../utils/text.ts";
import type { ModelProvider, ProviderRequest, ProviderResponse, ViserConfig } from "../core/types.ts";

const BENCHMARK_SENTINEL = "VISER_BENCHMARK_OK";
const DEFAULT_ITERATIONS = 5;
const MAX_ITERATIONS = 50;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_PROMPT = `Reply with exactly: ${BENCHMARK_SENTINEL}`;

export interface BenchmarkOptions {
  live?: boolean;
  json?: boolean;
  providerId?: string;
  prompt?: string;
  iterations?: number;
  warmup?: number;
  timeoutMs?: number;
  baseline?: string;
  hermes?: string;
  openclaw?: string;
  save?: boolean;
  artifactPath?: string;
}

export interface BenchmarkStats {
  count: number;
  okCount: number;
  failCount: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
}

export interface BenchmarkRun {
  label: string;
  ok: boolean;
  command?: string;
  stats: BenchmarkStats;
  failures: string[];
}

export interface BenchmarkResult {
  ok: boolean;
  schemaVersion: 1;
  mode: "local-deterministic" | "live-provider";
  generatedAt: string;
  prompt: string;
  sentinel: string;
  iterations: number;
  warmup: number;
  providerId: string;
  viser: BenchmarkRun;
  baselines: BenchmarkRun[];
  competitiveStatus: "no-baseline" | "viser-not-slower" | "baseline-faster" | "baseline-failed" | "viser-failed";
  next: string[];
  artifactPath?: string;
}

export interface BenchmarkArtifactSummary {
  found: boolean;
  generatedAt?: string;
  mode?: BenchmarkResult["mode"];
  providerId?: string;
  competitiveStatus?: BenchmarkResult["competitiveStatus"];
  baselineLabels: string[];
  hasHermes: boolean;
  hasOpenclaw: boolean;
  ok?: boolean;
}

export async function benchmarkReport(config: ViserConfig, options: BenchmarkOptions = {}): Promise<string> {
  const result = await runBenchmark(config, options);
  return options.json ? JSON.stringify(result, null, 2) : formatBenchmark(result);
}

export async function runBenchmark(config: ViserConfig, options: BenchmarkOptions = {}): Promise<BenchmarkResult> {
  const iterations = clampPositiveInteger(options.iterations, DEFAULT_ITERATIONS, MAX_ITERATIONS);
  const warmup = clampNonNegativeInteger(options.warmup, options.live ? 1 : 0, MAX_ITERATIONS);
  const timeoutMs = clampPositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 10 * 60_000);
  const prompt = (options.prompt ?? DEFAULT_PROMPT).trim() || DEFAULT_PROMPT;
  const live = Boolean(options.live);
  const providerId = options.providerId ?? (live ? config.assistant.defaultProvider : "benchmark-local");
  const artifactDir = await mkdtemp(join(tmpdir(), "viser-benchmark-"));

  try {
    const benchmarkConfig = benchmarkConfigFor(config, artifactDir, { live, providerId });
    const providers = live ? undefined : { [providerId]: new BenchmarkProvider() };
    const assistant = new AssistantRuntime(benchmarkConfig, providers);
    const viser = await runViserProviderBenchmark(assistant, providerId, prompt, iterations, warmup);
    const baselineSpecs = parseBaselineSpecs(options);
    const baselines: BenchmarkRun[] = [];
    for (const spec of baselineSpecs) {
      baselines.push(await runBaselineBenchmark(spec, prompt, iterations, warmup, timeoutMs, benchmarkConfig.assistant.workdir));
    }
    const competitiveStatus = compareRuns(viser, baselines);

    const result: BenchmarkResult = {
      ok: viser.ok && baselines.every((baseline) => baseline.ok),
      schemaVersion: 1,
      mode: live ? "live-provider" : "local-deterministic",
      generatedAt: new Date().toISOString(),
      prompt,
      sentinel: BENCHMARK_SENTINEL,
      iterations,
      warmup,
      providerId,
      viser,
      baselines,
      competitiveStatus,
      next: benchmarkNextSteps(live, baselines.length)
    };

    if (options.save || options.artifactPath) {
      result.artifactPath = await saveBenchmarkArtifact(config, result, options.artifactPath);
    }

    return result;
  } finally {
    await rm(artifactDir, { recursive: true, force: true });
  }
}

export async function latestBenchmarkArtifactSummary(config: ViserConfig): Promise<BenchmarkArtifactSummary> {
  const dir = benchmarkArtifactDir(config);
  const entries = await listPrivateDirIfExists(dir, { dirs: [config.storage.dir] });
  if (!entries) return emptyBenchmarkArtifactSummary();

  const artifacts: BenchmarkResult[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const raw = await readPrivateFileIfExists(join(dir, entry.name), { dirs: [dir] });
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as BenchmarkResult;
      if (parsed.schemaVersion !== 1 || !parsed.generatedAt || !parsed.viser) continue;
      artifacts.push(parsed);
    } catch {
      // Ignore malformed private artifacts here; state-health/audit owns state repair.
    }
  }

  const latest = artifacts.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0];
  if (!latest) return emptyBenchmarkArtifactSummary();
  const baselineLabels = latest.baselines.map((baseline) => baseline.label);
  return {
    found: true,
    generatedAt: latest.generatedAt,
    mode: latest.mode,
    providerId: latest.providerId,
    competitiveStatus: latest.competitiveStatus,
    baselineLabels,
    hasHermes: baselineLabels.includes("hermes"),
    hasOpenclaw: baselineLabels.includes("openclaw"),
    ok: latest.ok
  };
}

class BenchmarkProvider implements ModelProvider {
  id = "benchmark-local";
  label = "Viser deterministic benchmark provider";

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    const started = Date.now();
    return {
      text: BENCHMARK_SENTINEL,
      providerId: request.providerId,
      elapsedMs: Date.now() - started
    };
  }
}

async function runViserProviderBenchmark(
  assistant: AssistantRuntime,
  providerId: string,
  prompt: string,
  iterations: number,
  warmup: number
): Promise<BenchmarkRun> {
  for (let index = 0; index < warmup; index += 1) {
    await assistant.handle(prompt, `benchmark:warmup:${index}`, { source: "test", providerId });
  }

  const samples: Array<{ ok: boolean; elapsedMs: number; failure?: string }> = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = Date.now();
    try {
      const output = await assistant.handle(prompt, `benchmark:${index}`, { source: "test", providerId });
      const elapsedMs = Date.now() - started;
      samples.push({
        ok: output.includes(BENCHMARK_SENTINEL),
        elapsedMs,
        failure: output.includes(BENCHMARK_SENTINEL) ? undefined : "provider output did not include benchmark sentinel"
      });
    } catch (error) {
      samples.push({
        ok: false,
        elapsedMs: Date.now() - started,
        failure: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return benchmarkRun("viser", samples);
}

interface BaselineSpec {
  label: string;
  command: string;
  args: string[];
}

async function runBaselineBenchmark(
  spec: BaselineSpec,
  prompt: string,
  iterations: number,
  warmup: number,
  timeoutMs: number,
  cwd: string
): Promise<BenchmarkRun> {
  for (let index = 0; index < warmup; index += 1) {
    await runBaselineOnce(spec, prompt, timeoutMs, cwd).catch(() => undefined);
  }

  const samples: Array<{ ok: boolean; elapsedMs: number; failure?: string }> = [];
  for (let index = 0; index < iterations; index += 1) {
    samples.push(await runBaselineOnce(spec, prompt, timeoutMs, cwd));
  }
  return { ...benchmarkRun(spec.label, samples), command: [spec.command, ...spec.args].join(" ") };
}

async function runBaselineOnce(
  spec: BaselineSpec,
  prompt: string,
  timeoutMs: number,
  cwd: string
): Promise<{ ok: boolean; elapsedMs: number; failure?: string }> {
  const args = spec.args.some((arg) => arg.includes("{prompt}"))
    ? spec.args.map((arg) => arg.split("{prompt}").join(prompt))
    : [...spec.args, prompt];
  try {
    const result = await runCommand({
      command: spec.command,
      args,
      cwd,
      timeoutMs,
      maxOutputBytes: 8_000
    });
    const output = `${result.stdout}\n${result.stderr}`;
    const ok = result.exitCode === 0 && !result.signal && output.includes(BENCHMARK_SENTINEL);
    return {
      ok,
      elapsedMs: result.elapsedMs,
      failure: ok
        ? undefined
        : `exit=${result.exitCode ?? "null"} signal=${result.signal ?? "none"}${output.includes(BENCHMARK_SENTINEL) ? "" : " missing sentinel"}`
    };
  } catch (error) {
    return {
      ok: false,
      elapsedMs: 0,
      failure: error instanceof Error ? error.message : String(error)
    };
  }
}

function benchmarkRun(label: string, samples: Array<{ ok: boolean; elapsedMs: number; failure?: string }>): BenchmarkRun {
  return {
    label,
    ok: samples.length > 0 && samples.every((sample) => sample.ok),
    stats: summarizeSamples(samples),
    failures: samples.flatMap((sample, index) => sample.failure ? [`#${index + 1}: ${sample.failure}`] : [])
  };
}

function summarizeSamples(samples: Array<{ ok: boolean; elapsedMs: number }>): BenchmarkStats {
  const elapsed = samples.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
  const okCount = samples.filter((sample) => sample.ok).length;
  if (elapsed.length === 0) {
    return { count: 0, okCount: 0, failCount: 0, minMs: 0, maxMs: 0, meanMs: 0, medianMs: 0, p95Ms: 0 };
  }

  return {
    count: elapsed.length,
    okCount,
    failCount: elapsed.length - okCount,
    minMs: elapsed[0] ?? 0,
    maxMs: elapsed[elapsed.length - 1] ?? 0,
    meanMs: round(elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length),
    medianMs: percentile(elapsed, 0.5),
    p95Ms: percentile(elapsed, 0.95)
  };
}

function percentile(sorted: number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index] ?? 0;
}

function compareRuns(viser: BenchmarkRun, baselines: BenchmarkRun[]): BenchmarkResult["competitiveStatus"] {
  if (!viser.ok) return "viser-failed";
  if (baselines.length === 0) return "no-baseline";
  if (baselines.some((baseline) => !baseline.ok)) return "baseline-failed";
  return baselines.every((baseline) => viser.stats.medianMs <= baseline.stats.medianMs)
    ? "viser-not-slower"
    : "baseline-faster";
}

function parseBaselineSpecs(options: BenchmarkOptions): BaselineSpec[] {
  const specs = [
    options.hermes ? parseBaselineSpec("hermes", options.hermes) : undefined,
    options.openclaw ? parseBaselineSpec("openclaw", options.openclaw) : undefined,
    options.baseline ? parseBaselineSpec("baseline", options.baseline) : undefined
  ];
  return specs.filter((spec): spec is BaselineSpec => Boolean(spec));
}

function parseBaselineSpec(defaultLabel: string, raw: string): BaselineSpec {
  const separator = raw.indexOf("::");
  const label = separator > 0 ? raw.slice(0, separator).trim() || defaultLabel : defaultLabel;
  const commandLine = (separator > 0 ? raw.slice(separator + 2) : raw).trim();
  const [command, ...args] = splitCommandLine(commandLine);
  if (!command) throw new Error(`Benchmark baseline '${label}' is missing a command.`);
  return { label, command, args };
}

function benchmarkConfigFor(
  config: ViserConfig,
  artifactDir: string,
  options: { live: boolean; providerId: string }
): ViserConfig {
  const clone = JSON.parse(JSON.stringify(config)) as ViserConfig;
  clone.assistant = {
    ...clone.assistant,
    defaultProvider: options.providerId,
    fallbackProviders: [],
    workdir: artifactDir
  };
  clone.storage = { dir: join(artifactDir, ".viser", "sessions") };
  clone.memory = { ...clone.memory, dir: join(artifactDir, ".viser", "memory") };
  clone.skills = { ...clone.skills, dirs: [join(artifactDir, "skills"), join(artifactDir, ".viser", "skills")] };
  clone.plugins = { ...clone.plugins, dirs: [join(artifactDir, "plugins"), join(artifactDir, ".viser", "plugins")] };
  clone.tools = { ...clone.tools, allowedReadRoots: [artifactDir] };
  clone.scheduler = { ...clone.scheduler, dir: join(artifactDir, ".viser", "scheduler") };
  clone.jobs = { ...clone.jobs, dir: join(artifactDir, ".viser", "jobs") };
  clone.access = { ...clone.access, dir: join(artifactDir, ".viser", "access") };
  clone.actions = { ...clone.actions, dir: join(artifactDir, ".viser", "actions"), allowedWriteRoots: [artifactDir] };
  if (!options.live) {
    clone.providers = {
      [options.providerId]: {
        id: options.providerId,
        label: "Viser deterministic benchmark provider",
        command: "node",
        args: ["-e", `console.log('${BENCHMARK_SENTINEL}')`],
        promptMode: "argument",
        timeoutMs: 1_000
      }
    };
  }
  return clone;
}

async function saveBenchmarkArtifact(config: ViserConfig, result: BenchmarkResult, artifactPath?: string): Promise<string> {
  const path = artifactPath?.trim() || join(benchmarkArtifactDir(config), `${safeTimestamp(result.generatedAt)}-${result.mode}.json`);
  const artifact = { ...result, artifactPath: path };
  await writePrivateFile(path, `${JSON.stringify(artifact, null, 2)}\n`);
  return path;
}

function benchmarkArtifactDir(config: ViserConfig): string {
  return join(config.storage.dir, "benchmarks");
}

function safeTimestamp(value: string): string {
  return value.replace(/[^0-9A-Za-z._-]+/gu, "-").replace(/^-+|-+$/gu, "") || "benchmark";
}

function emptyBenchmarkArtifactSummary(): BenchmarkArtifactSummary {
  return {
    found: false,
    baselineLabels: [],
    hasHermes: false,
    hasOpenclaw: false
  };
}

function formatBenchmark(result: BenchmarkResult): string {
  return [
    `Viser benchmark: ${result.ok ? "PASS" : "FAIL"}`,
    `mode: ${result.mode}`,
    `generated: ${result.generatedAt}`,
    `provider: ${result.providerId}`,
    `iterations: ${result.iterations} (+${result.warmup} warmup)`,
    `sentinel: ${result.sentinel}`,
    "",
    "Viser provider path:",
    formatRun(result.viser),
    "",
    "Baselines:",
    ...(result.baselines.length ? result.baselines.map(formatRun) : ["- none supplied"]),
    "",
    `Competitive status: ${result.competitiveStatus}`,
    result.artifactPath ? `artifact: ${result.artifactPath}` : undefined,
    "",
    "Next:",
    ...result.next.map((line) => `- ${line}`)
  ].filter((line): line is string => line !== undefined).join("\n");
}

function formatRun(run: BenchmarkRun): string {
  const command = run.command ? ` · command: ${run.command}` : "";
  const failures = run.failures.length ? `\n  failures: ${run.failures.slice(0, 3).join("; ")}` : "";
  return [
    `- ${run.label}: ${run.ok ? "PASS" : "FAIL"}${command}`,
    `  samples: ${run.stats.okCount}/${run.stats.count} ok · median ${formatDuration(run.stats.medianMs)} · p95 ${formatDuration(run.stats.p95Ms)} · mean ${formatDuration(run.stats.meanMs)} · min/max ${formatDuration(run.stats.minMs)}/${formatDuration(run.stats.maxMs)}${failures}`
  ].join("\n");
}

function benchmarkNextSteps(live: boolean, baselineCount: number): string[] {
  const lines = [];
  if (!live) {
    lines.push("Run `viser benchmark --live --provider <provider>` to measure the logged-in local CLI provider path.");
  }
  if (baselineCount === 0) {
    lines.push("Attach same-host competitor baselines with `--hermes \"hermes ... {prompt}\"` and `--openclaw \"openclaw ... {prompt}\"` before claiming equal-or-better end-to-end performance.");
  }
  lines.push("Keep benchmark output with release evidence when making performance claims, or add `--save` to store a private `.viser/benchmarks/*.json` artifact.");
  return lines;
}

function clampPositiveInteger(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value) || !value || value < 1) return fallback;
  return Math.min(max, Math.floor(value));
}

function clampNonNegativeInteger(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value) || value === undefined || value < 0) return fallback;
  return Math.min(max, Math.floor(value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
