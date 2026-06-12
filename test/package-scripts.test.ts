import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);

test("package scripts expose strict provider-proof verification shortcuts", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string>; files: string[] };

  assert.equal(pkg.scripts.build, "npm run clean && tsc -p tsconfig.build.json && node -e \"require('fs').chmodSync('dist/index.js',0o755)\"");
  assert.equal(pkg.scripts.prepare, "npm run build");
  assert.equal(pkg.scripts.gateway, "node src/index.ts gateway --strict --live --probe-all-providers");
  assert.equal(pkg.scripts["env-check"], "node src/index.ts env-check");
  assert.equal(pkg.scripts["env-init"], "node src/index.ts env-init");
  assert.equal(pkg.scripts.slack, "node src/index.ts slack");
  assert.equal(pkg.scripts.signal, "node src/index.ts signal");
  assert.equal(pkg.scripts.whatsapp, "node src/index.ts whatsapp");
  assert.equal(pkg.scripts.audit, "node src/index.ts audit");
  assert.equal(pkg.scripts["release:audit"], "node src/index.ts audit");
  assert.equal(pkg.scripts["release:evidence"], "node src/index.ts release-evidence");
  assert.equal(pkg.scripts["release:evidence:providers"], "node src/index.ts release-evidence --live --probe-all-providers");
  assert.equal(pkg.scripts["release:evidence:strict"], "node src/index.ts release-evidence --strict --live --probe-all-providers");
  assert.equal(pkg.scripts.dashboard, "node src/index.ts dashboard");
  assert.equal(pkg.scripts["dashboard:check"], "node src/index.ts dashboard-check --strict");
  assert.equal(pkg.scripts["dashboard:web"], "node src/index.ts web-dashboard");
  assert.equal(pkg.scripts["mcp-client-config"], "node src/index.ts mcp-client-config");
  assert.equal(pkg.scripts["mcp-server"], "node src/index.ts mcp-server");
  assert.equal(pkg.scripts["gateway:raw"], "node src/index.ts gateway --unsafe-skip-gate");
  assert.equal(pkg.scripts.scheduler, "node src/index.ts scheduler");
  assert.equal(pkg.scripts["scheduler:raw"], "node src/index.ts scheduler --unsafe-skip-gate");
  assert.equal(pkg.scripts["run-jobs"], "node src/index.ts run-jobs");
  assert.equal(pkg.scripts["run-jobs:raw"], "node src/index.ts run-jobs --unsafe-skip-gate");
  assert.equal(pkg.scripts["job-worker"], "node src/index.ts job-worker");
  assert.equal(pkg.scripts["job-worker:raw"], "node src/index.ts job-worker --unsafe-skip-gate");
  assert.equal(pkg.scripts["verify:providers"], "node src/index.ts verify --strict --live --probe-all-providers");
  assert.equal(pkg.scripts.benchmark, "node src/index.ts benchmark");
  assert.equal(pkg.scripts["preflight:providers"], "node src/index.ts preflight --strict --live --probe-all-providers");
  assert.equal(pkg.scripts["launch-status"], "node src/index.ts launch-status");
  assert.equal(pkg.scripts["gateway:check"], "node src/index.ts gateway --dry-run --strict --live --probe-all-providers");
  assert.equal(pkg.scripts["service-run"], undefined);
  assert.equal(pkg.scripts.service, undefined);
});

test("package file allowlist excludes private runtime and orchestration state", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as { author: string; bin: Record<string, string>; files: string[]; license: string; private?: boolean };
  const npmignore = await readFile(".npmignore", "utf8");
  const npmrc = await readFile(".npmrc", "utf8");

  assert.equal(pkg.author, "KMokky");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.private, false);
  assert.equal(pkg.bin.viser, "./dist/index.js");
  assert.deepEqual(pkg.files.sort(), [
    ".env.example",
    "README.md",
    "SECURITY.md",
    "PRIVACY.md",
    "CONTRIBUTING.md",
    "assets",
    "config",
    "plugins",
    "skills",
    "dist",
    "src",
    "tools",
    "tsconfig.build.json",
    "tsconfig.json"
  ].sort());
  assert.match(npmignore, /\.viser\//);
  assert.match(npmignore, /\.omx\//);
  assert.match(npmignore, /^\.env$/m);
  assert.match(npmrc, /^cache=\.viser\/npm-cache$/m);
  assert.ok(!pkg.files.includes(".npmrc"));
});

test("packed npm install exposes a working simple viser command", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-package-install-"));
  try {
    const packDir = join(dir, "pack");
    const prefix = join(dir, "prefix");
    const home = join(dir, "home");
    const work = join(dir, "work");
    const cache = join(dir, "npm-cache");
    await mkdir(packDir, { recursive: true });
    await mkdir(home, { recursive: true });
    await mkdir(work, { recursive: true });

    const { stdout: packStdout } = await execFileAsync("npm", ["pack", "--json", "--pack-destination", packDir], {
      env: { ...process.env, npm_config_cache: cache },
      cwd: resolve("."),
      maxBuffer: 10_000_000
    });
    const pack = JSON.parse(packStdout) as Array<{ filename: string; files: Array<{ path: string }> }>;
    const archive = join(packDir, pack[0].filename);
    assert.ok(pack[0].files.some((file) => file.path === "dist/index.js"));

    await execFileAsync("npm", ["install", "-g", "--prefix", prefix, archive], {
      env: { ...process.env, npm_config_cache: cache },
      cwd: work,
      maxBuffer: 10_000_000
    });

    const viser = join(prefix, "bin", process.platform === "win32" ? "viser.cmd" : "viser");
    const { stdout: help } = await execFileAsync(viser, ["--help"], {
      env: { ...process.env, HOME: home, VISER_ENV: "" },
      cwd: work,
      maxBuffer: 1_000_000
    });
    assert.match(help, /Usage:/);
    assert.match(help, /viser setup/);

    const { stdout: mcpConfig } = await execFileAsync(viser, ["mcp-client-config", "generic", "--json"], {
      env: { ...process.env, HOME: home, VISER_ENV: "" },
      cwd: work,
      maxBuffer: 1_000_000
    });
    const parsed = JSON.parse(mcpConfig) as { clientConfig: { mcpServers: { viser: { args: string[] } } } };
    assert.match(parsed.clientConfig.mcpServers.viser.args[0], /dist\/index\.js$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
