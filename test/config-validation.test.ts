import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { configCheckReport } from "../src/cli/config-check.ts";
import { assertValidConfig, configValidationItems } from "../src/config-validation.ts";
import { DEFAULT_CONFIG, loadConfig } from "../src/config.ts";

test("configValidationItems passes the default config shape", () => {
  const items = configValidationItems(DEFAULT_CONFIG);

  assert.ok(items.some((item) => item.severity === "pass" && item.path === "config"));
  assert.equal(items.some((item) => item.severity === "fail"), false);
});

test("configValidationItems reports actionable shape failures", () => {
  const config = {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, maxInputChars: 50_001 },
    skills: { ...DEFAULT_CONFIG.skills, dirs: "skills" },
    plugins: { ...DEFAULT_CONFIG.plugins, promptLimit: 0 },
    jobs: { ...DEFAULT_CONFIG.jobs, concurrency: 99 },
    webDashboard: { ...DEFAULT_CONFIG.webDashboard, host: "0.0.0.0", port: 70_000 },
    access: { ...DEFAULT_CONFIG.access, defaultPolicy: "everyone" },
    connectors: {
      telegram: { ...DEFAULT_CONFIG.connectors.telegram, maxMessagesPerMinute: 121, maxInputChars: 20_001 },
      discord: { ...DEFAULT_CONFIG.connectors.discord, maxMessagesPerMinute: 0, maxInputChars: 0 }
    },
    providers: {
      bad: {
        id: "bad",
        command: "node",
        args: ["-e", "console.log('ok')"],
        promptMode: "template",
        timeoutMs: 1000,
        maxOutputBytes: 0
      }
    }
  };

  const items = configValidationItems(config);

  assert.ok(items.some((item) => item.severity === "fail" && item.path === "skills.dirs"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "assistant.maxInputChars"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "plugins.promptLimit"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "jobs.concurrency"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "webDashboard.host"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "webDashboard.port"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "access.defaultPolicy"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.telegram.maxMessagesPerMinute"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.discord.maxMessagesPerMinute"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.telegram.maxInputChars"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.discord.maxInputChars"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "providers.bad.args"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "providers.bad.maxOutputBytes"));
});

test("assertValidConfig throws a readable config error", () => {
  assert.throws(
    () => assertValidConfig({ ...DEFAULT_CONFIG, memory: { ...DEFAULT_CONFIG.memory, promptLimit: 0 } }),
    /Invalid Viser config:\n- memory\.promptLimit: must be a positive integer/
  );
});

test("loadConfig validates user JSON before path normalization", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-config-validation-"));
  try {
    const configPath = join(dir, "viser.config.json");
    await writeFile(configPath, JSON.stringify({ skills: { dirs: "not-an-array" } }), "utf8");

    await assert.rejects(
      loadConfig({ baseDir: dir, configPath }),
      /Invalid Viser config:\n- skills\.dirs: must be an array of strings/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig refuses to read symlinked config files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-config-symlink-"));
  try {
    const outsideConfig = join(dir, "outside.config.json");
    const configPath = join(dir, "viser.config.json");
    await writeFile(outsideConfig, JSON.stringify({ assistant: { defaultProvider: "outside" } }), "utf8");
    await symlink(outsideConfig, configPath);

    await assert.rejects(
      () => loadConfig({ baseDir: dir, configPath }),
      /symlink/i
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig refuses broken symlink config files instead of silently using defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-config-broken-symlink-"));
  try {
    const configPath = join(dir, "viser.config.json");
    await symlink(join(dir, "missing.config.json"), configPath);

    await assert.rejects(
      () => loadConfig({ baseDir: dir, configPath }),
      /symlink/i
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig fails fast when an explicit config path is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-config-missing-explicit-"));
  try {
    await assert.rejects(
      () => loadConfig({ baseDir: dir, configPath: join(dir, "missing.config.json") }),
      /ENOENT|no such file/i
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig fails fast when VISER_CONFIG points at a missing file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-config-missing-env-"));
  const oldViserConfig = process.env.VISER_CONFIG;
  try {
    await writeFile(join(dir, "viser.config.json"), JSON.stringify({ assistant: { defaultProvider: "default-file" } }), "utf8");
    process.env.VISER_CONFIG = join(dir, "missing.config.json");

    await assert.rejects(
      () => loadConfig({ baseDir: dir }),
      /ENOENT|no such file/i
    );
  } finally {
    if (oldViserConfig === undefined) delete process.env.VISER_CONFIG;
    else process.env.VISER_CONFIG = oldViserConfig;
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig refuses config files under symlinked parent components", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-config-parent-symlink-"));
  try {
    const outsideDir = join(dir, "outside-config");
    const linkDir = join(dir, "linked-config");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, "viser.config.json"), JSON.stringify({ assistant: { defaultProvider: "outside" } }), "utf8");
    await symlink(outsideDir, linkDir);

    await assert.rejects(
      () => loadConfig({ baseDir: dir, configPath: join(linkDir, "viser.config.json") }),
      /symlink/i
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig normalizes provider cwd relative to the config baseDir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-config-provider-cwd-"));
  const originalProvider = process.env.VISER_PROVIDER;
  delete process.env.VISER_PROVIDER;
  try {
    const configPath = join(dir, "viser.config.json");
    await writeFile(configPath, JSON.stringify({ providers: { codex: { cwd: "provider-cwd" } } }), "utf8");

    const config = await loadConfig({ baseDir: dir, configPath });

    assert.equal(config.providers.codex.cwd, join(dir, "provider-cwd"));
  } finally {
    if (originalProvider === undefined) delete process.env.VISER_PROVIDER;
    else process.env.VISER_PROVIDER = originalProvider;
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig does not mutate DEFAULT_CONFIG or reuse nested defaults", async () => {
  const firstDir = await mkdtemp(join(tmpdir(), "viser-config-first-"));
  const secondDir = await mkdtemp(join(tmpdir(), "viser-config-second-"));
  const originalProvider = process.env.VISER_PROVIDER;
  const originalConfig = process.env.VISER_CONFIG;
  delete process.env.VISER_PROVIDER;
  delete process.env.VISER_CONFIG;

  try {
    const before = JSON.stringify(DEFAULT_CONFIG);
    const first = await loadConfig({ baseDir: firstDir });
    const second = await loadConfig({ baseDir: secondDir });

    assert.equal(JSON.stringify(DEFAULT_CONFIG), before);
    assert.equal(DEFAULT_CONFIG.assistant.workdir, ".");
    assert.equal(DEFAULT_CONFIG.storage.dir, ".viser");
    assert.deepEqual(DEFAULT_CONFIG.skills.dirs, ["skills", ".viser/skills"]);
    assert.equal(first.assistant.workdir, firstDir);
    assert.equal(second.assistant.workdir, secondDir);
    assert.notEqual(first.assistant, DEFAULT_CONFIG.assistant);
    assert.notEqual(first.skills.dirs, DEFAULT_CONFIG.skills.dirs);
    assert.notEqual(first.providers.codex.args, DEFAULT_CONFIG.providers.codex.args);
  } finally {
    if (originalProvider === undefined) delete process.env.VISER_PROVIDER;
    else process.env.VISER_PROVIDER = originalProvider;
    if (originalConfig === undefined) delete process.env.VISER_CONFIG;
    else process.env.VISER_CONFIG = originalConfig;
    await rm(firstDir, { recursive: true, force: true });
    await rm(secondDir, { recursive: true, force: true });
  }
});

test("configCheckReport returns a user-facing validation summary", async () => {
  const report = await configCheckReport(DEFAULT_CONFIG);

  assert.match(report, /Viser config: VALID/);
  assert.match(report, /config.*shape is valid/);
});
