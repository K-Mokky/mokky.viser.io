import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("package scripts expose strict provider-proof verification shortcuts", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string>; files: string[] };

  assert.equal(pkg.scripts.gateway, "node src/index.ts gateway --strict --live --probe-all-providers");
  assert.equal(pkg.scripts["env-check"], "node src/index.ts env-check");
  assert.equal(pkg.scripts["env-init"], "node src/index.ts env-init");
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
  assert.equal(pkg.scripts["preflight:providers"], "node src/index.ts preflight --strict --live --probe-all-providers");
  assert.equal(pkg.scripts["launch-status"], "node src/index.ts launch-status");
  assert.equal(pkg.scripts["gateway:check"], "node src/index.ts gateway --dry-run --strict --live --probe-all-providers");
  assert.equal(pkg.scripts["service-run"], "node src/index.ts service-run --live --probe-all-providers");
});

test("package file allowlist excludes private runtime and orchestration state", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as { author: string; files: string[]; license: string; private?: boolean };
  const npmignore = await readFile(".npmignore", "utf8");
  const npmrc = await readFile(".npmrc", "utf8");

  assert.equal(pkg.author, "KMokky");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.private, false);
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
    "src",
    "tools",
    "tsconfig.json"
  ].sort());
  assert.match(npmignore, /\.viser\//);
  assert.match(npmignore, /\.omx\//);
  assert.match(npmignore, /^\.env$/m);
  assert.match(npmrc, /^cache=\.viser\/npm-cache$/m);
  assert.ok(!pkg.files.includes(".npmrc"));
});
