import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { envCheckReport, writeEnvTemplate } from "../src/cli/env-check.ts";
import { loadEnvFile, parseEnvLine, readEnvFileNoFollow } from "../src/utils/env.ts";
import type { ViserConfig } from "../src/core/types.ts";

const execFile = promisify(execFileCallback);

test("parseEnvLine parses quoted and plain assignments", () => {
  assert.deepEqual(parseEnvLine('TOKEN="abc"'), ["TOKEN", "abc"]);
  assert.deepEqual(parseEnvLine("PLAIN=value"), ["PLAIN", "value"]);
  assert.deepEqual(parseEnvLine("export EXPORTED=value"), ["EXPORTED", "value"]);
  assert.deepEqual(parseEnvLine("INLINE=value # comment"), ["INLINE", "value"]);
  assert.deepEqual(parseEnvLine('HASHED="value # not comment" # comment'), ["HASHED", "value # not comment"]);
  assert.deepEqual(parseEnvLine("PASSWORD=abc#123"), ["PASSWORD", "abc#123"]);
  assert.equal(parseEnvLine("# ignored"), undefined);
});

test("loadEnvFile loads missing values without overwriting existing env", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-env-"));
  const oldExisting = process.env.VISER_ENV_TEST_EXISTING;
  const oldNew = process.env.VISER_ENV_TEST_NEW;
  try {
    process.env.VISER_ENV_TEST_EXISTING = "from-shell";
    delete process.env.VISER_ENV_TEST_NEW;
    await writeFile(join(dir, ".env"), "VISER_ENV_TEST_EXISTING=from-file\nVISER_ENV_TEST_NEW=loaded\n", "utf8");
    const result = await loadEnvFile(".env", dir);
    assert.deepEqual(result.loaded, ["VISER_ENV_TEST_NEW"]);
    assert.deepEqual(result.skipped, ["VISER_ENV_TEST_EXISTING"]);
    assert.equal(process.env.VISER_ENV_TEST_EXISTING, "from-shell");
    assert.equal(process.env.VISER_ENV_TEST_NEW, "loaded");
  } finally {
    if (oldExisting === undefined) delete process.env.VISER_ENV_TEST_EXISTING;
    else process.env.VISER_ENV_TEST_EXISTING = oldExisting;
    if (oldNew === undefined) delete process.env.VISER_ENV_TEST_NEW;
    else process.env.VISER_ENV_TEST_NEW = oldNew;
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadEnvFile treats absent env files as optional unless required", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-env-missing-optional-"));
  try {
    const result = await loadEnvFile("missing.env", dir);

    assert.equal(result.path, join(dir, "missing.env"));
    assert.equal(result.missing, true);
    assert.deepEqual(result.loaded, []);
    assert.deepEqual(result.skipped, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadEnvFile fails fast for missing required env files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-env-missing-required-"));
  try {
    await assert.rejects(
      () => loadEnvFile("missing.env", dir, { required: true }),
      /Env file does not exist/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadEnvFile refuses symlinked env files without loading linked values", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-env-symlink-load-"));
  const oldValue = process.env.VISER_ENV_TEST_LINKED;
  try {
    delete process.env.VISER_ENV_TEST_LINKED;
    const outside = join(dir, "outside.env");
    const link = join(dir, ".env");
    await writeFile(outside, "VISER_ENV_TEST_LINKED=outside\n", "utf8");
    await symlink(outside, link);

    await assert.rejects(() => loadEnvFile(".env", dir), /symlink/i);
    await assert.rejects(() => readEnvFileNoFollow(link), /symlink/i);
    assert.equal(process.env.VISER_ENV_TEST_LINKED, undefined);
  } finally {
    restoreEnv("VISER_ENV_TEST_LINKED", oldValue);
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadEnvFile refuses env files under symlinked parent components", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-env-parent-symlink-load-"));
  const oldValue = process.env.VISER_ENV_TEST_PARENT_LINKED;
  try {
    delete process.env.VISER_ENV_TEST_PARENT_LINKED;
    const outsideDir = join(dir, "outside-env");
    await mkdir(outsideDir, { recursive: true });
    await symlink(outsideDir, join(dir, "linked-env"));
    await writeFile(join(outsideDir, ".env"), "VISER_ENV_TEST_PARENT_LINKED=outside\n", "utf8");

    await assert.rejects(() => loadEnvFile("linked-env/.env", dir), /symlink/i);
    assert.equal(process.env.VISER_ENV_TEST_PARENT_LINKED, undefined);
  } finally {
    restoreEnv("VISER_ENV_TEST_PARENT_LINKED", oldValue);
    await rm(dir, { recursive: true, force: true });
  }
});

test("envCheckReport explains env sources without leaking token values", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-env-check-report-"));
  const oldProvider = process.env.VISER_PROVIDER;
  const oldTelegram = process.env.TELEGRAM_BOT_TOKEN;
  const oldDiscord = process.env.DISCORD_BOT_TOKEN;
  const oldSlackBot = process.env.SLACK_BOT_TOKEN;
  const oldSlackApp = process.env.SLACK_APP_TOKEN;
  const oldSlackBotUserId = process.env.SLACK_BOT_USER_ID;
  try {
    const envPath = join(dir, ".env");
    await writeFile(envPath, "TELEGRAM_BOT_TOKEN=secret-token\n", "utf8");
    process.env.VISER_PROVIDER = "echo";
    process.env.TELEGRAM_BOT_TOKEN = "secret-token";
    process.env.DISCORD_BOT_TOKEN = "";
    const config = envConfig(dir);
    config.connectors.telegram.botToken = "secret-token";

    const report = envCheckReport(config, {
      path: envPath,
      loaded: ["TELEGRAM_BOT_TOKEN"],
      skipped: ["VISER_PROVIDER", "DISCORD_BOT_TOKEN"]
    });

    assert.match(report, /Viser env check/);
    assert.match(report, /env file: .*found/);
    assert.match(report, /TELEGRAM_BOT_TOKEN: present \(redacted\) · source=env-file/);
    assert.match(report, /DISCORD_BOT_TOKEN: empty · source=shell\/pre-existing/);
    assert.match(report, /VISER_PROVIDER: set \(echo\) · source=shell\/pre-existing/);
    assert.match(report, /edit .*\.env with real credential values/);
    assert.match(report, /env file permissions are broad/);
    assert.match(report, /viser launch-status/);
    assert.doesNotMatch(report, /secret-token/);
  } finally {
    restoreEnv("VISER_PROVIDER", oldProvider);
    restoreEnv("TELEGRAM_BOT_TOKEN", oldTelegram);
    restoreEnv("DISCORD_BOT_TOKEN", oldDiscord);
    restoreEnv("SLACK_BOT_TOKEN", oldSlackBot);
    restoreEnv("SLACK_APP_TOKEN", oldSlackApp);
    restoreEnv("SLACK_BOT_USER_ID", oldSlackBotUserId);
    await rm(dir, { recursive: true, force: true });
  }
});

test("envCheckReport reports symlinked env files as unsafe", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-env-check-symlink-"));
  const originalCwd = process.cwd();
  try {
    const outside = join(dir, "outside.env");
    const link = join(dir, ".env");
    await writeFile(outside, "TELEGRAM_BOT_TOKEN=secret-token\n", "utf8");
    await symlink(outside, link);
    process.chdir(dir);

    const report = envCheckReport(envConfig(dir), {
      path: ".env",
      loaded: [],
      skipped: []
    });

    assert.match(report, /env file: \.env \(found\)/);
    assert.match(report, /env file is a symlink/i);
    assert.doesNotMatch(report, /secret-token/);
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});

test("envCheckReport reports env files under symlinked workspace parents as unsafe", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-env-check-parent-symlink-"));
  const originalCwd = process.cwd();
  try {
    const outsideDir = join(dir, "outside-env");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, ".env"), "TELEGRAM_BOT_TOKEN=secret-token\n", "utf8");
    await symlink(outsideDir, join(dir, "linked-env"));
    process.chdir(dir);

    const report = envCheckReport(envConfig(dir), {
      path: "linked-env/.env",
      loaded: [],
      skipped: []
    });

    assert.match(report, /env file: linked-env\/\.env \(found\)/);
    assert.match(report, /symlink component/i);
    assert.doesNotMatch(report, /secret-token/);
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});

test("envCheckReport suggests env-init only when the env file is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-env-check-missing-"));
  try {
    const envPath = join(dir, ".env");
    const report = envCheckReport(envConfig(dir), {
      path: envPath,
      loaded: [],
      skipped: []
    });

    assert.match(report, /env file: .*not found/);
    assert.match(report, /viser env-init/);
    assert.doesNotMatch(report, /edit .*\.env with real credential values/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--env missing fails fast for runtime commands instead of silently skipping env", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-cli-env-missing-runtime-"));
  try {
    const missingEnv = join(dir, "missing.env");
    const cliEnv: NodeJS.ProcessEnv = { ...process.env };
    delete cliEnv.VISER_ENV;
    delete cliEnv.VISER_CONFIG;
    delete cliEnv.VISER_PROVIDER;

    await assert.rejects(
      execFile(process.execPath, [resolve("src/index.ts"), "--env", missingEnv, "status"], {
        cwd: process.cwd(),
        timeout: 20_000,
        env: cliEnv
      }),
      (error) => {
        const failure = error as { code?: number; stderr?: string };
        assert.equal(failure.code, 1);
        assert.match(failure.stderr ?? "", /Env file does not exist/);
        return true;
      }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("env-check still diagnoses a missing explicit env file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-cli-env-missing-check-"));
  try {
    const missingEnv = join(dir, "missing.env");
    const cliEnv: NodeJS.ProcessEnv = { ...process.env };
    delete cliEnv.VISER_ENV;
    delete cliEnv.VISER_CONFIG;
    delete cliEnv.VISER_PROVIDER;

    const { stdout } = await execFile(process.execPath, [resolve("src/index.ts"), "--env", missingEnv, "env-check"], {
      cwd: process.cwd(),
      timeout: 20_000,
      env: cliEnv
    });

    assert.match(stdout, /Viser env check/);
    assert.match(stdout, /env file: .*missing\.env \(not found\)/);
    assert.match(stdout, /viser env-init/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("VISER_ENV points the CLI at a custom env file before config loading", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-cli-env-"));
  try {
    const configPath = join(dir, "viser.config.json");
    const config: ViserConfig = {
      ...DEFAULT_CONFIG,
      assistant: { ...DEFAULT_CONFIG.assistant, defaultProvider: "echo", fallbackProviders: [], workdir: dir },
      storage: { dir: join(dir, ".viser") },
      memory: { ...DEFAULT_CONFIG.memory, dir: join(dir, ".viser", "memory") },
      personalization: { ...DEFAULT_CONFIG.personalization, dir: join(dir, ".viser", "personalization") },
      skills: { ...DEFAULT_CONFIG.skills, dirs: [join(dir, "skills"), join(dir, ".viser", "skills")] },
      tools: { ...DEFAULT_CONFIG.tools, allowedReadRoots: [dir] },
      scheduler: { ...DEFAULT_CONFIG.scheduler, dir: join(dir, ".viser", "scheduler") },
      jobs: { ...DEFAULT_CONFIG.jobs, dir: join(dir, ".viser", "jobs") },
      access: { ...DEFAULT_CONFIG.access, dir: join(dir, ".viser", "access") },
      actions: { ...DEFAULT_CONFIG.actions, dir: join(dir, ".viser", "actions"), allowedWriteRoots: [dir] },
      connectors: {
        telegram: { ...DEFAULT_CONFIG.connectors.telegram, allowedChatIds: [], defaultChatIds: [] },
        discord: { ...DEFAULT_CONFIG.connectors.discord, allowedChannelIds: [], defaultChannelIds: [] },
        slack: { ...DEFAULT_CONFIG.connectors.slack, allowedChannelIds: [], defaultChannelIds: [] },
      matrix: { ...DEFAULT_CONFIG.connectors.matrix, allowedRoomIds: [], defaultRoomIds: [] },
      signal: { ...DEFAULT_CONFIG.connectors.signal, allowedRecipientIds: [], defaultRecipientIds: [] },
      imessage: { ...DEFAULT_CONFIG.connectors.imessage, allowedHandleIds: [], defaultHandleIds: [] },
      whatsapp: { ...DEFAULT_CONFIG.connectors.whatsapp, allowedRecipientIds: [], defaultRecipientIds: [] },
      line: { ...DEFAULT_CONFIG.connectors.line, allowedPeerIds: [], defaultPeerIds: [] },
      kakaotalk: { ...DEFAULT_CONFIG.connectors.kakaotalk, allowedUserIds: [], defaultUserIds: [] },
      googleChat: { ...DEFAULT_CONFIG.connectors.googleChat, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      webhook: { ...DEFAULT_CONFIG.connectors.webhook, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      homeAssistant: { ...DEFAULT_CONFIG.connectors.homeAssistant, baseUrl: undefined, accessToken: undefined, service: undefined, services: {}, allowedServiceIds: [], defaultServiceIds: [] },
      teams: { ...DEFAULT_CONFIG.connectors.teams, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      mattermost: { ...DEFAULT_CONFIG.connectors.mattermost, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      synologyChat: { ...DEFAULT_CONFIG.connectors.synologyChat, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      rocketChat: { ...DEFAULT_CONFIG.connectors.rocketChat, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      feishu: { ...DEFAULT_CONFIG.connectors.feishu, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      dingtalk: { ...DEFAULT_CONFIG.connectors.dingtalk, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      wecom: { ...DEFAULT_CONFIG.connectors.wecom, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      zalo: { ...DEFAULT_CONFIG.connectors.zalo, accessToken: undefined, recipient: undefined, recipients: {}, allowedRecipientIds: [], defaultRecipientIds: [] },
      irc: { ...DEFAULT_CONFIG.connectors.irc, host: undefined, nick: undefined, password: undefined, channel: undefined, channels: {}, allowedChannelIds: [], defaultChannelIds: [] },
      twitch: { ...DEFAULT_CONFIG.connectors.twitch, enabled: false, accessToken: undefined, botUsername: undefined, channel: undefined, channels: {}, allowedChannelIds: [], defaultChannelIds: [] },
      ntfy: { ...DEFAULT_CONFIG.connectors.ntfy, enabled: false, token: undefined, topic: undefined, topics: {}, allowedTopicIds: [], defaultTopicIds: [] },
      mastodon: { ...DEFAULT_CONFIG.connectors.mastodon, enabled: false, baseUrl: undefined, accessToken: undefined, visibility: "private", targets: {}, allowedTargetIds: [], defaultTargetIds: [] },
      nextcloudTalk: { ...DEFAULT_CONFIG.connectors.nextcloudTalk, baseUrl: undefined, username: undefined, appPassword: undefined, roomToken: undefined, rooms: {}, allowedRoomIds: [], defaultRoomIds: [] },
      webex: { ...DEFAULT_CONFIG.connectors.webex, accessToken: undefined, allowedRoomIds: [], defaultRoomIds: [] },
      zulip: { ...DEFAULT_CONFIG.connectors.zulip, siteUrl: undefined, botEmail: undefined, apiKey: undefined, target: undefined, targets: {}, allowedTargetIds: [], defaultTargetIds: [] },
      email: { ...DEFAULT_CONFIG.connectors.email, enabled: false, from: undefined, recipient: undefined, recipients: {}, allowedRecipientIds: [], defaultRecipientIds: [] },
      github: { ...DEFAULT_CONFIG.connectors.github, enabled: false, token: undefined, target: undefined, targets: {}, allowedTargetIds: [], defaultTargetIds: [] },
      todoist: { ...DEFAULT_CONFIG.connectors.todoist, enabled: false, token: undefined, project: undefined, projects: {}, allowedProjectIds: [], defaultProjectIds: [] },
      notion: { ...DEFAULT_CONFIG.connectors.notion, enabled: false, token: undefined, page: undefined, pages: {}, allowedPageIds: [], defaultPageIds: [] },
      obsidian: { ...DEFAULT_CONFIG.connectors.obsidian, enabled: false, vaultDir: undefined, note: undefined, notes: {}, allowedNoteIds: [], defaultNoteIds: [] }
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
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    const envPath = join(dir, "custom.env");
    await writeFile(envPath, `VISER_CONFIG=${configPath}\nVISER_PROVIDER=echo\n`, "utf8");
    const cliEnv: NodeJS.ProcessEnv = { ...process.env, VISER_ENV: envPath };
    delete cliEnv.VISER_CONFIG;
    delete cliEnv.VISER_PROVIDER;

    const { stdout } = await execFile(process.execPath, ["src/index.ts", "status"], {
      cwd: process.cwd(),
      timeout: 20_000,
      env: cliEnv
    });

    assert.match(stdout, /provider: echo/);
    assert.match(stdout, new RegExp(`config: ${escapeRegExp(configPath)}`));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("env-check CLI reports custom env loading and redacts connector tokens", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-cli-env-check-"));
  try {
    const configPath = join(dir, "viser.config.json");
    await writeFile(configPath, `${JSON.stringify(envConfig(dir), null, 2)}\n`, "utf8");
    const envPath = join(dir, "custom.env");
    await writeFile(envPath, `VISER_CONFIG=${configPath}\nVISER_PROVIDER=echo\nTELEGRAM_BOT_TOKEN=top-secret-token\n`, "utf8");
    const cliEnv: NodeJS.ProcessEnv = { ...process.env };
    delete cliEnv.VISER_ENV;
    delete cliEnv.VISER_CONFIG;
    delete cliEnv.VISER_PROVIDER;
    delete cliEnv.TELEGRAM_BOT_TOKEN;
    delete cliEnv.DISCORD_BOT_TOKEN;
    delete cliEnv.SLACK_BOT_TOKEN;
    delete cliEnv.SLACK_APP_TOKEN;
    delete cliEnv.SLACK_BOT_USER_ID;

    const { stdout } = await execFile(process.execPath, ["src/index.ts", "--env", envPath, "env-check"], {
      cwd: process.cwd(),
      timeout: 20_000,
      env: cliEnv
    });

    assert.match(stdout, /Viser env check/);
    assert.match(stdout, /loaded from env file: VISER_CONFIG, VISER_PROVIDER, TELEGRAM_BOT_TOKEN/);
    assert.match(stdout, /TELEGRAM_BOT_TOKEN: present \(redacted\) · source=env-file/);
    assert.match(stdout, /default provider: echo/);
    assert.doesNotMatch(stdout, /top-secret-token/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeEnvTemplate creates a private editable env template without secrets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-env-template-"));
  const originalCwd = process.cwd();
  try {
    process.chdir(dir);
    const config = envConfig(dir);
    config.configPath = join(dir, "viser.config.json");
    const report = await writeEnvTemplate(config);
    const content = await readFile(join(dir, ".env"), "utf8");
    const second = await writeEnvTemplate(config);
    const mode = statSync(join(dir, ".env")).mode & 0o777;

    assert.match(report, /Created .*\.env/);
    assert.match(content, /VISER_PROVIDER=echo/);
    assert.match(content, /VISER_CONFIG=\.\/viser\.config\.json/);
    assert.match(content, /TELEGRAM_BOT_TOKEN=\n/);
    assert.match(content, /DISCORD_BOT_TOKEN=\n/);
    assert.match(content, /SLACK_BOT_TOKEN=\n/);
    assert.match(content, /SLACK_APP_TOKEN=\n/);
    assert.match(content, /SLACK_BOT_USER_ID=\n/);
    assert.match(content, /WHATSAPP_ACCESS_TOKEN=\n/);
    assert.match(content, /WHATSAPP_PHONE_NUMBER_ID=\n/);
    assert.match(content, /WHATSAPP_VERIFY_TOKEN=\n/);
    assert.match(content, /WHATSAPP_GRAPH_API_VERSION=v18\.0/);
    assert.match(content, /LINE_CHANNEL_ACCESS_TOKEN=\n/);
    assert.match(content, /LINE_CHANNEL_SECRET=\n/);
    assert.match(content, /BRAVE_SEARCH_API_KEY=\n/);
    assert.match(content, /TAVILY_API_KEY=\n/);
    assert.match(content, /PERPLEXITY_API_KEY=\n/);
    assert.match(content, /EXA_API_KEY=\n/);
    assert.match(content, /FIRECRAWL_API_KEY=\n/);
    assert.match(content, /OLLAMA_API_KEY=\n/);
    assert.match(content, /BROWSER_USE_API_KEY=\n/);
    assert.match(content, /BROWSERBASE_API_KEY=\n/);
    assert.match(content, /BROWSERBASE_PROJECT_ID=\n/);
    assert.match(content, /VISER_BROWSER_CDP_URL=http:\/\/127\.0\.0\.1:9222\n/);
    assert.doesNotMatch(content, /token-value/i);
    assert.equal(mode, 0o600);
    assert.match(second, /\.env already exists/);
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeEnvTemplate force replaces env symlinks without clobbering linked files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-env-template-symlink-"));
  const originalCwd = process.cwd();
  try {
    process.chdir(dir);
    await writeFile(join(dir, "outside.env"), "OUTSIDE=keep\n", "utf8");
    await symlink(join(dir, "outside.env"), join(dir, ".env"));

    const config = envConfig(dir);
    config.configPath = join(dir, "viser.config.json");
    const report = await writeEnvTemplate(config, { force: true });

    assert.match(report, /Created .*\.env/);
    assert.equal(await readFile(join(dir, "outside.env"), "utf8"), "OUTSIDE=keep\n");
    assert.equal((await lstat(join(dir, ".env"))).isSymbolicLink(), false);
    assert.match(await readFile(join(dir, ".env"), "utf8"), /VISER_PROVIDER=echo/);
    assert.equal(statSync(join(dir, ".env")).mode & 0o777, 0o600);
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeEnvTemplate refuses to skip symlinked env targets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-env-template-symlink-skip-"));
  const originalCwd = process.cwd();
  try {
    process.chdir(dir);
    await writeFile(join(dir, "outside.env"), "OUTSIDE=keep\n", "utf8");
    await symlink(join(dir, "outside.env"), join(dir, ".env"));

    const config = envConfig(dir);
    config.configPath = join(dir, "viser.config.json");

    await assert.rejects(() => writeEnvTemplate(config), /unsafe|symlink/i);
    assert.equal(await readFile(join(dir, "outside.env"), "utf8"), "OUTSIDE=keep\n");
    assert.equal((await lstat(join(dir, ".env"))).isSymbolicLink(), true);
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeEnvTemplate refuses to skip env targets under symlinked parents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-env-template-parent-symlink-skip-"));
  const originalCwd = process.cwd();
  try {
    process.chdir(dir);
    const outsideDir = join(dir, "outside-env");
    const linkDir = join(dir, "linked-env");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, ".env"), "OUTSIDE=keep\n", "utf8");
    await symlink(outsideDir, linkDir);

    const config = envConfig(dir);
    config.configPath = join(dir, "viser.config.json");

    await assert.rejects(() => writeEnvTemplate(config, { outputPath: "linked-env/.env" }), /unsafe|symlink/i);
    assert.equal(await readFile(join(outsideDir, ".env"), "utf8"), "OUTSIDE=keep\n");
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});

test("env-init CLI writes a template and refuses accidental overwrite", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-cli-env-init-"));
  try {
    const configPath = join(dir, "viser.config.json");
    await writeFile(configPath, `${JSON.stringify(envConfig(dir), null, 2)}\n`, "utf8");
    const cliEnv: NodeJS.ProcessEnv = { ...process.env, VISER_CONFIG: configPath };
    delete cliEnv.VISER_ENV;
    delete cliEnv.TELEGRAM_BOT_TOKEN;
    delete cliEnv.DISCORD_BOT_TOKEN;
    delete cliEnv.SLACK_BOT_TOKEN;
    delete cliEnv.SLACK_APP_TOKEN;
    delete cliEnv.SLACK_BOT_USER_ID;
    delete cliEnv.WHATSAPP_ACCESS_TOKEN;
    delete cliEnv.WHATSAPP_PHONE_NUMBER_ID;
    delete cliEnv.WHATSAPP_VERIFY_TOKEN;
    delete cliEnv.LINE_CHANNEL_ACCESS_TOKEN;
    delete cliEnv.LINE_CHANNEL_SECRET;

    const first = await execFile(process.execPath, [resolve("src/index.ts"), "env-init"], {
      cwd: dir,
      timeout: 20_000,
      env: cliEnv
    });
    const second = await execFile(process.execPath, [resolve("src/index.ts"), "env-init"], {
      cwd: dir,
      timeout: 20_000,
      env: cliEnv
    });
    const content = await readFile(join(dir, ".env"), "utf8");

    assert.match(first.stdout, /Created .*\.env/);
    assert.match(second.stdout, /\.env already exists/);
    assert.match(content, /VISER_PROVIDER=echo/);
    assert.doesNotMatch(content, /top-secret-token/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--env does not generate background service plists through the CLI", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-cli-env-plist-"));
  try {
    const configPath = join(dir, "viser.config.json");
    const config: ViserConfig = {
      ...DEFAULT_CONFIG,
      assistant: { ...DEFAULT_CONFIG.assistant, defaultProvider: "echo", fallbackProviders: [], workdir: dir },
      storage: { dir: join(dir, ".viser") },
      memory: { ...DEFAULT_CONFIG.memory, dir: join(dir, ".viser", "memory") },
      personalization: { ...DEFAULT_CONFIG.personalization, dir: join(dir, ".viser", "personalization") },
      skills: { ...DEFAULT_CONFIG.skills, dirs: [join(dir, "skills"), join(dir, ".viser", "skills")] },
      tools: { ...DEFAULT_CONFIG.tools, allowedReadRoots: [dir] },
      scheduler: { ...DEFAULT_CONFIG.scheduler, dir: join(dir, ".viser", "scheduler") },
      jobs: { ...DEFAULT_CONFIG.jobs, dir: join(dir, ".viser", "jobs") },
      access: { ...DEFAULT_CONFIG.access, dir: join(dir, ".viser", "access") },
      actions: { ...DEFAULT_CONFIG.actions, dir: join(dir, ".viser", "actions"), allowedWriteRoots: [dir] },
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
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    const envPath = join(dir, "prod.env");
    await writeFile(envPath, `VISER_CONFIG=${configPath}\nVISER_PROVIDER=echo\n`, "utf8");
    const cliEnv: NodeJS.ProcessEnv = { ...process.env };
    delete cliEnv.VISER_ENV;
    delete cliEnv.VISER_CONFIG;
    delete cliEnv.VISER_PROVIDER;

    const { stdout } = await execFile(process.execPath, ["src/index.ts", "--env", envPath, "service", "plist"], {
      cwd: process.cwd(),
      timeout: 20_000,
      env: cliEnv
    });

    assert.match(stdout, /Viser service plist: disabled/);
    assert.match(stdout, /foreground terminal window/);
    assert.doesNotMatch(stdout, /<key>VISER_ENV<\/key>/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function envConfig(dir: string): ViserConfig {
  return {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, defaultProvider: "echo", fallbackProviders: [], workdir: dir },
    storage: { dir: join(dir, ".viser") },
    memory: { ...DEFAULT_CONFIG.memory, dir: join(dir, ".viser", "memory") },
    personalization: { ...DEFAULT_CONFIG.personalization, dir: join(dir, ".viser", "personalization") },
    skills: { ...DEFAULT_CONFIG.skills, dirs: [join(dir, "skills"), join(dir, ".viser", "skills")] },
    tools: { ...DEFAULT_CONFIG.tools, allowedReadRoots: [dir] },
    scheduler: { ...DEFAULT_CONFIG.scheduler, dir: join(dir, ".viser", "scheduler") },
    jobs: { ...DEFAULT_CONFIG.jobs, dir: join(dir, ".viser", "jobs") },
    access: { ...DEFAULT_CONFIG.access, dir: join(dir, ".viser", "access") },
    actions: { ...DEFAULT_CONFIG.actions, dir: join(dir, ".viser", "actions"), allowedWriteRoots: [dir] },
    connectors: {
      telegram: { ...DEFAULT_CONFIG.connectors.telegram, allowedChatIds: [], defaultChatIds: [] },
      discord: { ...DEFAULT_CONFIG.connectors.discord, allowedChannelIds: [], defaultChannelIds: [] },
      slack: { ...DEFAULT_CONFIG.connectors.slack, allowedChannelIds: [], defaultChannelIds: [] },
      matrix: { ...DEFAULT_CONFIG.connectors.matrix, allowedRoomIds: [], defaultRoomIds: [] },
      signal: { ...DEFAULT_CONFIG.connectors.signal, allowedRecipientIds: [], defaultRecipientIds: [] },
      imessage: { ...DEFAULT_CONFIG.connectors.imessage, allowedHandleIds: [], defaultHandleIds: [] },
      whatsapp: { ...DEFAULT_CONFIG.connectors.whatsapp, allowedRecipientIds: [], defaultRecipientIds: [] },
      line: { ...DEFAULT_CONFIG.connectors.line, allowedPeerIds: [], defaultPeerIds: [] },
      kakaotalk: { ...DEFAULT_CONFIG.connectors.kakaotalk, allowedUserIds: [], defaultUserIds: [] },
      googleChat: { ...DEFAULT_CONFIG.connectors.googleChat, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      webhook: { ...DEFAULT_CONFIG.connectors.webhook, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      homeAssistant: { ...DEFAULT_CONFIG.connectors.homeAssistant, baseUrl: undefined, accessToken: undefined, service: undefined, services: {}, allowedServiceIds: [], defaultServiceIds: [] },
      teams: { ...DEFAULT_CONFIG.connectors.teams, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      mattermost: { ...DEFAULT_CONFIG.connectors.mattermost, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      synologyChat: { ...DEFAULT_CONFIG.connectors.synologyChat, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      rocketChat: { ...DEFAULT_CONFIG.connectors.rocketChat, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      feishu: { ...DEFAULT_CONFIG.connectors.feishu, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      dingtalk: { ...DEFAULT_CONFIG.connectors.dingtalk, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      wecom: { ...DEFAULT_CONFIG.connectors.wecom, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      zalo: { ...DEFAULT_CONFIG.connectors.zalo, accessToken: undefined, recipient: undefined, recipients: {}, allowedRecipientIds: [], defaultRecipientIds: [] },
      irc: { ...DEFAULT_CONFIG.connectors.irc, host: undefined, nick: undefined, password: undefined, channel: undefined, channels: {}, allowedChannelIds: [], defaultChannelIds: [] },
      twitch: { ...DEFAULT_CONFIG.connectors.twitch, enabled: false, accessToken: undefined, botUsername: undefined, channel: undefined, channels: {}, allowedChannelIds: [], defaultChannelIds: [] },
      ntfy: { ...DEFAULT_CONFIG.connectors.ntfy, enabled: false, token: undefined, topic: undefined, topics: {}, allowedTopicIds: [], defaultTopicIds: [] },
      mastodon: { ...DEFAULT_CONFIG.connectors.mastodon, enabled: false, baseUrl: undefined, accessToken: undefined, visibility: "private", targets: {}, allowedTargetIds: [], defaultTargetIds: [] },
      nextcloudTalk: { ...DEFAULT_CONFIG.connectors.nextcloudTalk, baseUrl: undefined, username: undefined, appPassword: undefined, roomToken: undefined, rooms: {}, allowedRoomIds: [], defaultRoomIds: [] },
      webex: { ...DEFAULT_CONFIG.connectors.webex, accessToken: undefined, allowedRoomIds: [], defaultRoomIds: [] },
      zulip: { ...DEFAULT_CONFIG.connectors.zulip, siteUrl: undefined, botEmail: undefined, apiKey: undefined, target: undefined, targets: {}, allowedTargetIds: [], defaultTargetIds: [] },
      email: { ...DEFAULT_CONFIG.connectors.email, enabled: false, from: undefined, recipient: undefined, recipients: {}, allowedRecipientIds: [], defaultRecipientIds: [] },
      github: { ...DEFAULT_CONFIG.connectors.github, enabled: false, token: undefined, target: undefined, targets: {}, allowedTargetIds: [], defaultTargetIds: [] },
      todoist: { ...DEFAULT_CONFIG.connectors.todoist, enabled: false, token: undefined, project: undefined, projects: {}, allowedProjectIds: [], defaultProjectIds: [] },
      notion: { ...DEFAULT_CONFIG.connectors.notion, enabled: false, token: undefined, page: undefined, pages: {}, allowedPageIds: [], defaultPageIds: [] },
      obsidian: { ...DEFAULT_CONFIG.connectors.obsidian, enabled: false, vaultDir: undefined, note: undefined, notes: {}, allowedNoteIds: [], defaultNoteIds: [] }
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

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
