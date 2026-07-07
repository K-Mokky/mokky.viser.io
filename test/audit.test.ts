import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { auditItems, auditReport, releaseLeakPatternsForRoot, summarizeAudit } from "../src/cli/audit.ts";
import { DEFAULT_CONFIG, loadConfig } from "../src/config.ts";
import type { ViserConfig } from "../src/core/types.ts";

test("auditReport reports a safe default-shaped local config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-audit-"));
  try {
    const report = await auditReport(auditConfig(dir));
    assert.match(report, /Viser audit: SAFE/);
    assert.match(report, /summary:/);
    assert.match(report, /job worker concurrency is bounded/);
    assert.match(report, /package metadata is open-source ready/);
    assert.match(report, /public text files contain no known personal\/local or token-like identifiers/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("auditItems fails when GitHub ignore rules can publish private runtime state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-audit-release-ignore-"));
  const originalCwd = process.cwd();
  try {
    await writeFile(join(dir, "package.json"), JSON.stringify({
      name: "viser",
      author: "KMokky",
      private: false,
      license: "MIT",
      files: [".env.example", "README.md", "SECURITY.md", "PRIVACY.md", "CONTRIBUTING.md", "config", "plugins", "skills", "src", "tools", "tsconfig.json"]
    }), "utf8");
    await writeFile(join(dir, ".gitignore"), ".env\n.viser/\nviser.config.json\nnode_modules/\n", "utf8");
    await writeFile(join(dir, ".npmignore"), ".env\n.viser/\n.omx/\n.npmrc\nviser.config.json\n", "utf8");
    process.chdir(dir);

    const items = await auditItems(auditConfig(dir));

    assert.ok(items.some((item) =>
      item.area === "public-release"
      && item.severity === "fail"
      && /release ignore coverage is incomplete/.test(item.message)
      && /\.gitignore:\.omx\//.test(item.message)
      && /\.gitignore:\.npmrc/.test(item.message)
    ));
    assert.equal(summarizeAudit(items).verdict, "UNSAFE");
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});

test("auditItems warns when job worker concurrency is high", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-audit-jobs-concurrency-"));
  try {
    const config = auditConfig(dir);
    config.jobs.concurrency = 4;
    const items = await auditItems(config);

    assert.ok(items.some((item) => item.area === "jobs" && item.severity === "warn" && /concurrency is high/.test(item.message)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("auditItems fails for mutating shell commands", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-audit-tools-"));
  try {
    const config = auditConfig(dir);
    config.tools.shell.allowedCommands = ["ls", "rm"];
    const items = await auditItems(config);
    assert.ok(items.some((item) => item.area === "tools" && item.severity === "fail" && /rm/.test(item.message)));
    assert.equal(summarizeAudit(items).verdict, "UNSAFE");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("auditItems fails tool read roots reached through workspace symlink components", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-audit-tool-root-symlink-"));
  try {
    const outsideRoot = join(dir, "outside-root");
    const outsideRead = join(outsideRoot, "read-root");
    const rootLink = join(dir, "root-link");
    await mkdir(outsideRead, { recursive: true });
    await symlink(outsideRoot, rootLink);
    const config = auditConfig(dir);
    config.tools.allowedReadRoots = [join(rootLink, "read-root")];

    const items = await auditItems(config);

    assert.ok(items.some((item) => item.area === "tools" && item.severity === "fail" && /symlink component/.test(item.message)));
    assert.equal(summarizeAudit(items).verdict, "UNSAFE");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("auditItems fails action write roots reached through workspace symlink components", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-audit-action-root-symlink-"));
  try {
    const outsideRoot = join(dir, "outside-root");
    const outsideWrite = join(outsideRoot, "write-root");
    const rootLink = join(dir, "root-link");
    await mkdir(outsideWrite, { recursive: true });
    await symlink(outsideRoot, rootLink);
    const config = auditConfig(dir);
    config.actions.allowedWriteRoots = [join(rootLink, "write-root")];

    const items = await auditItems(config);

    assert.ok(items.some((item) => item.area === "actions" && item.severity === "fail" && /symlink component/.test(item.message)));
    assert.equal(summarizeAudit(items).verdict, "UNSAFE");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("auditItems fails provider cwd reached through workspace symlink components", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-audit-provider-cwd-symlink-"));
  try {
    const outsideRoot = join(dir, "outside-root");
    const outsideCwd = join(outsideRoot, "provider-cwd");
    const rootLink = join(dir, "root-link");
    await mkdir(outsideCwd, { recursive: true });
    await symlink(outsideRoot, rootLink);
    const config = auditConfig(dir);
    config.providers.codex.cwd = join(rootLink, "provider-cwd");

    const items = await auditItems(config);

    assert.ok(items.some((item) => item.area === "provider" && item.severity === "fail" && /provider cwd.*symlink component/.test(item.message)));
    assert.equal(summarizeAudit(items).verdict, "UNSAFE");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("auditItems fails provider command paths reached through workspace symlink components", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-audit-provider-command-symlink-"));
  try {
    const outsideRoot = join(dir, "outside-root");
    const outsideBin = join(outsideRoot, "bin");
    const commandPath = join(outsideBin, "provider-ok");
    const rootLink = join(dir, "root-link");
    await mkdir(outsideBin, { recursive: true });
    await writeFile(commandPath, "#!/bin/sh\nprintf 'VISER_OK\\n'\n", "utf8");
    await chmod(commandPath, 0o700);
    await symlink(outsideRoot, rootLink);
    const config = auditConfig(dir);
    config.providers.codex.command = join(rootLink, "bin", "provider-ok");

    const items = await auditItems(config);

    assert.ok(items.some((item) => item.area === "provider" && item.severity === "fail" && /provider command.*symlink component/.test(item.message)));
    assert.equal(summarizeAudit(items).verdict, "UNSAFE");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("auditItems fails provider PATH commands reached through workspace symlink components", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-audit-provider-path-command-symlink-"));
  try {
    const outsideRoot = join(dir, "outside-root");
    const outsideBin = join(outsideRoot, "bin");
    const commandPath = join(outsideBin, "provider-ok");
    const rootLink = join(dir, "root-link");
    await mkdir(outsideBin, { recursive: true });
    await writeFile(commandPath, "#!/bin/sh\nprintf 'VISER_OK\\n'\n", "utf8");
    await chmod(commandPath, 0o700);
    await symlink(outsideRoot, rootLink);
    const config = auditConfig(dir);
    config.providers.codex.command = "provider-ok";
    config.providers.codex.env = { PATH: join(rootLink, "bin") };

    const items = await auditItems(config);

    assert.ok(items.some((item) => item.area === "provider" && item.severity === "fail" && /provider PATH command.*symlink component/.test(item.message)));
    assert.equal(summarizeAudit(items).verdict, "UNSAFE");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("auditItems fails shell PATH commands reached through workspace symlink components", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-audit-shell-path-command-symlink-"));
  const oldPath = process.env.PATH;
  try {
    const outsideRoot = join(dir, "outside-root");
    const outsideBin = join(outsideRoot, "bin");
    const commandPath = join(outsideBin, "tool-ok");
    const rootLink = join(dir, "root-link");
    await mkdir(outsideBin, { recursive: true });
    await writeFile(commandPath, "#!/bin/sh\nprintf 'TOOL_OK\\n'\n", "utf8");
    await chmod(commandPath, 0o700);
    await symlink(outsideRoot, rootLink);
    process.env.PATH = join(rootLink, "bin");
    const config = auditConfig(dir);
    config.tools.shell.allowedCommands = ["tool-ok"];

    const items = await auditItems(config);

    assert.ok(items.some((item) => item.area === "tools" && item.severity === "fail" && /shell PATH command.*symlink component/.test(item.message)));
    assert.equal(summarizeAudit(items).verdict, "UNSAFE");
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test("auditItems fails for open messenger access", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-audit-access-"));
  try {
    const config = auditConfig(dir);
    config.access.defaultPolicy = "open";
    config.connectors.telegram.enabled = true;
    config.connectors.telegram.botToken = "redacted";
    const items = await auditItems(config);
    assert.ok(items.some((item) => item.area === "access" && item.severity === "fail" && /open/.test(item.message)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("auditItems warns about messenger relay ToS risk until acknowledged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-audit-relay-"));
  try {
    const config = auditConfig(dir);
    config.connectors.telegram.enabled = true;

    const warned = await auditItems(config);
    assert.ok(warned.some((item) =>
      item.area === "access"
      && item.severity === "warn"
      && /relays your single-seat provider subscription/.test(item.message)
    ));

    config.connectors.acknowledgeRelayToS = true;
    const acknowledged = await auditItems(config);
    assert.ok(acknowledged.some((item) =>
      item.area === "access"
      && item.severity === "pass"
      && /relay ToS\/ban risk acknowledged/.test(item.message)
    ));
    assert.ok(!acknowledged.some((item) => /relays your single-seat provider subscription/.test(item.message)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("auditItems detects messenger tokens stored in config files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-audit-secret-"));
  try {
    const configPath = join(dir, "viser.config.json");
    await writeFile(configPath, JSON.stringify({
      connectors: {
        telegram: { botToken: "123:secret" }
      }
    }), "utf8");
    const config = await loadConfig({ baseDir: dir, configPath });
    const items = await auditItems(config);
    assert.ok(items.some((item) => item.area === "secret" && item.severity === "fail" && /Telegram/.test(item.message)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("auditItems fails provider model API key env configuration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-audit-provider-api-key-env-"));
  try {
    const config = auditConfig(dir);
    config.providers.codex.env = {
      PATH: process.env.PATH ?? "",
      OPENAI_API_KEY: "sk-should-not-be-used"
    };

    const items = await auditItems(config);

    assert.ok(items.some((item) =>
      item.area === "provider"
      && item.severity === "fail"
      && /model API key variables.*OPENAI_API_KEY/.test(item.message)
    ));
    assert.equal(summarizeAudit(items).verdict, "UNSAFE");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("auditItems fails when core model routes are not local CLI commands", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-audit-core-cli-route-"));
  try {
    const config = auditConfig(dir);
    config.providers.gpt.command = "curl";

    const items = await auditItems(config);

    assert.ok(items.some((item) =>
      item.area === "provider"
      && item.severity === "fail"
      && /GPT\/Codex route must use logged-in local codex CLI/.test(item.message)
    ));
    assert.equal(summarizeAudit(items).verdict, "UNSAFE");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("auditItems fails model API key variables in the active env file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-audit-env-model-api-key-"));
  const oldViserEnv = process.env.VISER_ENV;
  try {
    const envPath = join(dir, ".env");
    await writeFile(envPath, "TELEGRAM_BOT_TOKEN=redacted\nOPENAI_API_KEY=sk-should-not-be-used\n", "utf8");
    await chmod(envPath, 0o600);
    process.env.VISER_ENV = envPath;

    const items = await auditItems(auditConfig(dir));

    assert.ok(items.some((item) =>
      item.area === "env"
      && item.severity === "fail"
      && /model API key variables.*OPENAI_API_KEY/.test(item.message)
    ));
    assert.equal(summarizeAudit(items).verdict, "UNSAFE");
  } finally {
    if (oldViserEnv === undefined) delete process.env.VISER_ENV;
    else process.env.VISER_ENV = oldViserEnv;
    await rm(dir, { recursive: true, force: true });
  }
});

test("release leak patterns detect private local workspace path tokens", () => {
  const patterns = releaseLeakPatternsForRoot(
    "/Users/example/SensitiveCampus/App/Viser",
    "/Users/example"
  );

  const localTokenPattern = patterns.find((pattern) => pattern.id === "local-workspace-token");

  assert.ok(localTokenPattern);
  assert.equal(localTokenPattern.pattern.test("notes about SensitiveCampus"), true);
  assert.equal(patterns.some((pattern) => pattern.pattern.test("Viser")), false);
  assert.equal(patterns.some((pattern) => pattern.pattern.test("App")), false);
});

test("release leak patterns detect token-like public secrets while allowing fixtures", () => {
  const patterns = releaseLeakPatternsForRoot("/Users/example/demo-workspace/Viser", "/Users/example");
  const modelKey = "sk-" + "live-secret-value-1234567890";
  const telegramToken = "123456789:" + "AAAbbbCCCdddEEEfffGGGhhhIIIjjjKKKlll";
  const privateKeyHeader = "-----BEGIN " + "PRIVATE KEY-----";

  assert.ok(patterns.some((pattern) => pattern.id === "model-api-key-literal" && pattern.pattern.test(`OPENAI_API_KEY=${modelKey}`)));
  assert.ok(patterns.some((pattern) => pattern.id === "telegram-token-literal" && pattern.pattern.test(telegramToken)));
  assert.ok(patterns.some((pattern) => pattern.id === "private-key-block" && pattern.pattern.test(privateKeyHeader)));
  assert.equal(patterns.some((pattern) => pattern.pattern.test("OPENAI_API_KEY=sk-test-secret-value-1234567890")), false);
  assert.equal(patterns.some((pattern) => pattern.pattern.test("TELEGRAM_BOT_TOKEN=redacted")), false);
});

test("auditItems warns when a token env file is too broadly readable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-audit-env-"));
  const oldViserEnv = process.env.VISER_ENV;
  try {
    const envPath = join(dir, ".env");
    await writeFile(envPath, "TELEGRAM_BOT_TOKEN=redacted\n", "utf8");
    await chmod(envPath, 0o644);
    process.env.VISER_ENV = envPath;

    const items = await auditItems(auditConfig(dir));

    assert.ok(items.some((item) => item.area === "env" && item.severity === "warn" && /group\/world accessible/.test(item.message)));
  } finally {
    if (oldViserEnv === undefined) delete process.env.VISER_ENV;
    else process.env.VISER_ENV = oldViserEnv;
    await rm(dir, { recursive: true, force: true });
  }
});

test("auditItems fails symlinked env files without following linked targets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-audit-env-symlink-"));
  const oldViserEnv = process.env.VISER_ENV;
  const originalCwd = process.cwd();
  try {
    const outside = join(dir, "outside.env");
    const link = join(dir, ".env");
    await writeFile(outside, "TELEGRAM_BOT_TOKEN=redacted\n", "utf8");
    await symlink(outside, link);
    process.chdir(dir);
    process.env.VISER_ENV = ".env";

    const items = await auditItems(auditConfig(dir));

    assert.ok(items.some((item) => item.area === "env" && item.severity === "fail" && /symlink/i.test(item.message)));
  } finally {
    process.chdir(originalCwd);
    if (oldViserEnv === undefined) delete process.env.VISER_ENV;
    else process.env.VISER_ENV = oldViserEnv;
    await rm(dir, { recursive: true, force: true });
  }
});

test("auditItems fails env files under symlinked workspace parents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-audit-env-parent-symlink-"));
  const oldViserEnv = process.env.VISER_ENV;
  const originalCwd = process.cwd();
  try {
    const outsideDir = join(dir, "outside-env");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, ".env"), "TELEGRAM_BOT_TOKEN=redacted\n", "utf8");
    await symlink(outsideDir, join(dir, "linked-env"));
    process.chdir(dir);
    process.env.VISER_ENV = "linked-env/.env";

    const items = await auditItems(auditConfig(dir));

    assert.ok(items.some((item) => item.area === "env" && item.severity === "fail" && /symlink/i.test(item.message)));
  } finally {
    process.chdir(originalCwd);
    if (oldViserEnv === undefined) delete process.env.VISER_ENV;
    else process.env.VISER_ENV = oldViserEnv;
    await rm(dir, { recursive: true, force: true });
  }
});

test("auditItems warns when persistent state files are too broadly readable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-audit-state-perms-"));
  try {
    const config = auditConfig(dir);
    const jobsPath = join(config.jobs.dir, "jobs.json");
    await mkdir(config.jobs.dir, { recursive: true });
    await writeFile(jobsPath, "[]\n", { encoding: "utf8", mode: 0o644 });
    await chmod(jobsPath, 0o644);

    const items = await auditItems(config);

    assert.ok(items.some((item) => item.area === "state" && item.severity === "warn" && /group\/world accessible/.test(item.message)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function auditConfig(dir: string): ViserConfig {
  return {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, workdir: dir },
    storage: { dir: join(dir, ".viser") },
    memory: { ...DEFAULT_CONFIG.memory, dir: join(dir, ".viser", "memory") },
    skills: { ...DEFAULT_CONFIG.skills, dirs: [join(dir, "skills"), join(dir, ".viser", "skills")] },
    tools: { ...DEFAULT_CONFIG.tools, allowedReadRoots: [dir], shell: { ...DEFAULT_CONFIG.tools.shell, allowedCommands: ["pwd", "ls", "cat", "sed", "grep", "rg", "find", "wc", "git"] } },
    scheduler: { ...DEFAULT_CONFIG.scheduler, dir: join(dir, ".viser", "scheduler") },
    jobs: { ...DEFAULT_CONFIG.jobs, dir: join(dir, ".viser", "jobs") },
    access: { ...DEFAULT_CONFIG.access, dir: join(dir, ".viser", "access") },
    actions: { ...DEFAULT_CONFIG.actions, dir: join(dir, ".viser", "actions"), allowedWriteRoots: [dir] },
    connectors: {
      telegram: { ...DEFAULT_CONFIG.connectors.telegram, allowedChatIds: [], defaultChatIds: [] },
      discord: { ...DEFAULT_CONFIG.connectors.discord, allowedChannelIds: [], defaultChannelIds: [] }
    },
    providers: {
      codex: { ...DEFAULT_CONFIG.providers.codex },
      gpt: { ...DEFAULT_CONFIG.providers.gpt },
      gemini: { ...DEFAULT_CONFIG.providers.gemini },
      claude: { ...DEFAULT_CONFIG.providers.claude }
    }
  };
}
