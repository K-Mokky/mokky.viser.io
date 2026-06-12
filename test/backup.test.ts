import test from "node:test";
import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBackup, createBackupReport, readBackupFileNoFollow } from "../src/cli/backup.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { ViserConfig } from "../src/core/types.ts";

const FAKE_TELEGRAM_TOKEN = `123456:${"abcdefghijklmnopqrstuvwxyzABCDE"}`;
const FAKE_MODEL_API_KEY = `sk-${"1234567890abcdefghijklmnop"}`;

test("createBackup exports storage files and redacts token-like config values", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-backup-"));
  try {
    const config = backupConfig(dir);
    config.connectors.telegram.botToken = "123:secret";
    config.connectors.slack.botToken = "slack-secret-token";
    config.connectors.slack.appToken = "slack-app-secret-token";
    config.connectors.signal.account = "+15551234567";
    config.connectors.whatsapp.accessToken = "whatsapp-secret-token";
    config.connectors.whatsapp.phoneNumberId = "12345";
    config.connectors.whatsapp.verifyToken = "whatsapp-verify-token";
    config.connectors.line.channelAccessToken = "line-secret-token";
    config.connectors.line.channelSecret = "line-channel-secret";
    config.connectors.googleChat.webhookUrl = "https://chat.googleapis.com/v1/spaces/AAAA/messages?key=secret-key&token=secret-token";
    config.connectors.googleChat.webhookUrls = { ops: "https://chat.googleapis.com/v1/spaces/OPS/messages?key=secret-key&token=secret-token" };
    config.connectors.teams.webhookUrl = "https://example.webhook.office.com/webhookb2/secret";
    config.connectors.teams.webhookUrls = { ops: "https://example.webhook.office.com/webhookb2/ops-secret" };
    config.connectors.mattermost.webhookUrl = "https://mattermost.example.com/hooks/secret";
    config.connectors.mattermost.webhookUrls = { ops: "https://mattermost.example.com/hooks/ops-secret" };
    config.connectors.rocketChat.webhookUrl = "https://rocket.example.com/hooks/integration/secret";
    config.connectors.rocketChat.webhookUrls = { ops: "https://rocket.example.com/hooks/integration/ops-secret" };
    config.connectors.feishu.webhookUrl = "https://open.feishu.cn/open-apis/bot/v2/hook/secret";
    config.connectors.feishu.webhookUrls = { ops: "https://open.feishu.cn/open-apis/bot/v2/hook/ops-secret" };
    config.connectors.dingtalk.webhookUrl = "https://oapi.dingtalk.com/robot/send?access_token=secret";
    config.connectors.dingtalk.webhookUrls = { ops: "https://oapi.dingtalk.com/robot/send?access_token=ops-secret" };
    config.connectors.wecom.webhookUrl = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret";
    config.connectors.wecom.webhookUrls = { ops: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=ops-secret" };
    config.connectors.zalo.accessToken = "zalo-secret-token";
    config.connectors.zalo.recipient = "zalo-user-1";
    config.connectors.zalo.recipients = { ops: "zalo-user-2" };
    config.connectors.zulip.siteUrl = "https://private.zulipchat.com";
    config.connectors.zulip.botEmail = "viser-bot@example.com";
    config.connectors.zulip.apiKey = "zulip-secret-token";
    config.connectors.zulip.target = "stream:ops:alerts";
    config.connectors.zulip.targets = { ops: "stream:ops:alerts" };
    config.tools.webFetch.firecrawlApiKey = "firecrawl-fetch-secret-token";
    config.tools.webSearch.braveApiKey = "brave-secret-token";
    config.tools.webSearch.tavilyApiKey = "tavily-secret-token";
    config.tools.webSearch.perplexityApiKey = "perplexity-secret-token";
    config.tools.webSearch.exaApiKey = "exa-secret-token";
    config.tools.webSearch.firecrawlApiKey = "firecrawl-secret-token";
    config.tools.webSearch.ollamaApiKey = "ollama-secret-token";
    config.actions.browserTask.browserUseApiKey = "browser-use-secret-token";
    await mkdir(join(config.storage.dir, "memory"), { recursive: true });
    await writeFile(join(config.storage.dir, "memory", "entries.jsonl"), JSON.stringify({ text: "remember me" }) + "\n", "utf8");

    const outputPath = join(dir, "snapshot.json");
    const result = await createBackup(config, { outputPath });
    const raw = await readFile(result.path, "utf8");
    const parsed = JSON.parse(raw);

    assert.equal(parsed.format, "viser.backup.v1");
    assert.equal((await stat(result.path)).mode & 0o777, 0o600);
    assert.ok(parsed.files.some((file: { path: string }) => file.path === "memory/entries.jsonl"));
    assert.equal(parsed.config.connectors.telegram.botToken, "[REDACTED]");
    assert.equal(parsed.config.connectors.slack.botToken, "[REDACTED]");
    assert.equal(parsed.config.connectors.slack.appToken, "[REDACTED]");
    assert.equal(parsed.config.connectors.signal.account, "[REDACTED]");
    assert.equal(parsed.config.connectors.whatsapp.accessToken, "[REDACTED]");
    assert.equal(parsed.config.connectors.whatsapp.phoneNumberId, "[REDACTED]");
    assert.equal(parsed.config.connectors.whatsapp.verifyToken, "[REDACTED]");
    assert.equal(parsed.config.connectors.line.channelAccessToken, "[REDACTED]");
    assert.equal(parsed.config.connectors.line.channelSecret, "[REDACTED]");
    assert.equal(parsed.config.connectors.googleChat.webhookUrl, "[REDACTED]");
    assert.equal(parsed.config.connectors.googleChat.webhookUrls.ops, "[REDACTED]");
    assert.equal(parsed.config.connectors.teams.webhookUrl, "[REDACTED]");
    assert.equal(parsed.config.connectors.teams.webhookUrls.ops, "[REDACTED]");
    assert.equal(parsed.config.connectors.mattermost.webhookUrl, "[REDACTED]");
    assert.equal(parsed.config.connectors.mattermost.webhookUrls.ops, "[REDACTED]");
    assert.equal(parsed.config.connectors.rocketChat.webhookUrl, "[REDACTED]");
    assert.equal(parsed.config.connectors.rocketChat.webhookUrls.ops, "[REDACTED]");
    assert.equal(parsed.config.connectors.feishu.webhookUrl, "[REDACTED]");
    assert.equal(parsed.config.connectors.feishu.webhookUrls.ops, "[REDACTED]");
    assert.equal(parsed.config.connectors.dingtalk.webhookUrl, "[REDACTED]");
    assert.equal(parsed.config.connectors.dingtalk.webhookUrls.ops, "[REDACTED]");
    assert.equal(parsed.config.connectors.wecom.webhookUrl, "[REDACTED]");
    assert.equal(parsed.config.connectors.wecom.webhookUrls.ops, "[REDACTED]");
    assert.equal(parsed.config.connectors.zalo.accessToken, "[REDACTED]");
    assert.equal(parsed.config.connectors.zalo.recipient, "[REDACTED]");
    assert.equal(parsed.config.connectors.zalo.recipients.ops, "[REDACTED]");
    assert.equal(parsed.config.connectors.zulip.siteUrl, "[REDACTED]");
    assert.equal(parsed.config.connectors.zulip.botEmail, "[REDACTED]");
    assert.equal(parsed.config.connectors.zulip.apiKey, "[REDACTED]");
    assert.equal(parsed.config.connectors.zulip.target, "[REDACTED]");
    assert.equal(parsed.config.connectors.zulip.targets.ops, "[REDACTED]");
    assert.equal(parsed.config.tools.webFetch.firecrawlApiKey, "[REDACTED]");
    assert.equal(parsed.config.tools.webSearch.braveApiKey, "[REDACTED]");
    assert.equal(parsed.config.tools.webSearch.tavilyApiKey, "[REDACTED]");
    assert.equal(parsed.config.tools.webSearch.perplexityApiKey, "[REDACTED]");
    assert.equal(parsed.config.tools.webSearch.exaApiKey, "[REDACTED]");
    assert.equal(parsed.config.tools.webSearch.firecrawlApiKey, "[REDACTED]");
    assert.equal(parsed.config.tools.webSearch.ollamaApiKey, "[REDACTED]");
    assert.equal(parsed.config.actions.browserTask.browserUseApiKey, "[REDACTED]");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createBackup refuses to overwrite without force", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-backup-overwrite-"));
  try {
    const config = backupConfig(dir);
    await mkdir(config.storage.dir, { recursive: true });
    const outputPath = join(dir, "snapshot.json");
    await createBackup(config, { outputPath });
    await assert.rejects(() => createBackup(config, { outputPath }), /already exists/);
    await createBackup(config, { outputPath, force: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createBackup refuses symlinked output targets without force", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-backup-output-symlink-"));
  try {
    const config = backupConfig(dir);
    await mkdir(config.storage.dir, { recursive: true });
    const outsidePath = join(dir, "outside-snapshot.json");
    const outputPath = join(dir, "snapshot.json");
    await writeFile(outsidePath, "outside backup target\n", "utf8");
    await symlink(outsidePath, outputPath);

    await assert.rejects(() => createBackup(config, { outputPath }), /symlink/i);

    assert.equal(await readFile(outsidePath, "utf8"), "outside backup target\n");
    assert.equal((await lstat(outputPath)).isSymbolicLink(), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createBackup force replaces symlinked output targets without clobbering linked files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-backup-output-symlink-force-"));
  try {
    const config = backupConfig(dir);
    await mkdir(config.storage.dir, { recursive: true });
    const outsidePath = join(dir, "outside-snapshot.json");
    const outputPath = join(dir, "snapshot.json");
    await writeFile(outsidePath, "outside backup target\n", "utf8");
    await symlink(outsidePath, outputPath);

    const result = await createBackup(config, { outputPath, force: true });

    assert.equal(result.path, outputPath);
    assert.equal(await readFile(outsidePath, "utf8"), "outside backup target\n");
    const outputInfo = await lstat(outputPath);
    assert.equal(outputInfo.isSymbolicLink(), false);
    assert.equal(outputInfo.mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(outputPath, "utf8")).format, "viser.backup.v1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createBackup refuses broken symlink output targets without force", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-backup-output-broken-symlink-"));
  try {
    const config = backupConfig(dir);
    await mkdir(config.storage.dir, { recursive: true });
    const outputPath = join(dir, "snapshot.json");
    await symlink(join(dir, "missing-outside-snapshot.json"), outputPath);

    await assert.rejects(() => createBackup(config, { outputPath }), /symlink/i);

    assert.equal((await lstat(outputPath)).isSymbolicLink(), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createBackup refuses non-file output targets even with force", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-backup-output-non-file-"));
  try {
    const config = backupConfig(dir);
    await mkdir(config.storage.dir, { recursive: true });
    const outputPath = join(dir, "snapshot-dir");
    await mkdir(outputPath, { recursive: true });

    await assert.rejects(() => createBackup(config, { outputPath, force: true }), /not a regular file/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createBackup marks oversized files as truncated", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-backup-truncate-"));
  try {
    const config = backupConfig(dir);
    await mkdir(config.storage.dir, { recursive: true });
    await writeFile(join(config.storage.dir, "big.txt"), "abcdef", "utf8");
    const result = await createBackup(config, { outputPath: join(dir, "snapshot.json"), maxFileBytes: 3 });

    assert.deepEqual(result.truncatedFiles, ["big.txt"]);
    assert.equal(result.artifact.files.find((file) => file.path === "big.txt")?.content, "abc");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createBackup excludes backup, repair, and transient cache directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-backup-exclude-cache-"));
  try {
    const config = backupConfig(dir);
    await mkdir(join(config.storage.dir, "backups"), { recursive: true });
    await mkdir(join(config.storage.dir, "npm-cache", "_logs"), { recursive: true });
    await mkdir(join(config.storage.dir, "repairs", "2026-05-23"), { recursive: true });
    await mkdir(join(config.storage.dir, "actions", "backups", "action-1"), { recursive: true });
    await mkdir(join(config.storage.dir, "memory"), { recursive: true });
    await writeFile(join(config.storage.dir, "backups", "old.json"), "{}\n", "utf8");
    await writeFile(join(config.storage.dir, "npm-cache", "_logs", "debug.log"), "cache log\n", "utf8");
    await writeFile(join(config.storage.dir, "repairs", "2026-05-23", "jobs.json.bak"), "repair backup\n", "utf8");
    await writeFile(join(config.storage.dir, "actions", "backups", "action-1", "notes.txt.bak"), "action backup\n", "utf8");
    await writeFile(join(config.storage.dir, "memory", "entries.jsonl"), "{}\n", "utf8");

    const result = await createBackup(config, { outputPath: join(dir, "snapshot.json") });

    assert.deepEqual(result.artifact.files.map((file) => file.path), ["memory/entries.jsonl"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createBackup excludes memory and session compact backup artifacts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-backup-exclude-compact-bak-"));
  try {
    const config = backupConfig(dir);
    await mkdir(join(config.storage.dir, "memory"), { recursive: true });
    await mkdir(join(config.storage.dir, "sessions"), { recursive: true });
    await writeFile(join(config.storage.dir, "memory", "entries.jsonl"), "{\"text\":\"current memory\"}\n", "utf8");
    await writeFile(join(config.storage.dir, "memory", "entries.2026-05-23T00-00-00-000Z.bak.jsonl"), "old memory secret\n", "utf8");
    await writeFile(join(config.storage.dir, "sessions", "chat.jsonl"), "{\"role\":\"user\",\"content\":\"current\"}\n", "utf8");
    await writeFile(join(config.storage.dir, "sessions", "chat.2026-05-23T00-00-00-000Z.bak"), "old session secret\n", "utf8");

    const result = await createBackup(config, { outputPath: join(dir, "snapshot.json") });

    assert.deepEqual(result.artifact.files.map((file) => file.path), [
      "memory/entries.jsonl",
      "sessions/chat.jsonl"
    ]);
    assert.doesNotMatch(JSON.stringify(result.artifact), /old memory secret|old session secret/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createBackup excludes service logs by default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-backup-exclude-logs-"));
  try {
    const config = backupConfig(dir);
    await mkdir(join(config.storage.dir, "logs"), { recursive: true });
    await mkdir(join(config.storage.dir, "sessions"), { recursive: true });
    await writeFile(join(config.storage.dir, "logs", "gateway.out.log"), "provider output that should stay out of backups\n", "utf8");
    await writeFile(join(config.storage.dir, "logs", "gateway.err.log"), "TOKEN=secret-token-value-123456\n", "utf8");
    await writeFile(join(config.storage.dir, "sessions", "chat.jsonl"), "{\"role\":\"user\",\"content\":\"current\"}\n", "utf8");

    const result = await createBackup(config, { outputPath: join(dir, "snapshot.json") });

    assert.deepEqual(result.artifact.files.map((file) => file.path), ["sessions/chat.jsonl"]);
    assert.doesNotMatch(JSON.stringify(result.artifact), /provider output|secret-token/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createBackup prunes excluded directories before descending into them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-backup-prune-excluded-"));
  const unreadableDir = join(dir, ".viser", "logs", "private");
  try {
    const config = backupConfig(dir);
    await mkdir(unreadableDir, { recursive: true });
    await mkdir(join(config.storage.dir, "memory"), { recursive: true });
    await chmod(unreadableDir, 0o000);
    await writeFile(join(config.storage.dir, "memory", "entries.jsonl"), "{\"text\":\"current memory\"}\n", "utf8");

    const result = await createBackup(config, { outputPath: join(dir, "snapshot.json") });

    assert.deepEqual(result.artifact.files.map((file) => file.path), ["memory/entries.jsonl"]);
  } finally {
    await chmod(unreadableDir, 0o700).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

test("createBackup does not follow symlinks out of storage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-backup-symlink-"));
  try {
    const config = backupConfig(dir);
    await mkdir(config.storage.dir, { recursive: true });
    await writeFile(join(dir, "outside-secret.txt"), `TELEGRAM_BOT_TOKEN=${FAKE_TELEGRAM_TOKEN}\n`, "utf8");
    await writeFile(join(config.storage.dir, "state.json"), "{}\n", "utf8");
    await symlink(join(dir, "outside-secret.txt"), join(config.storage.dir, "outside-link.txt"));

    const result = await createBackup(config, { outputPath: join(dir, "snapshot.json") });

    assert.deepEqual(result.artifact.files.map((file) => file.path), ["state.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readBackupFileNoFollow refuses a symlinked file even if called directly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-backup-read-nofollow-"));
  try {
    const outside = join(dir, "outside-secret.txt");
    const link = join(dir, "link.txt");
    await writeFile(outside, "outside secret\n", "utf8");
    await symlink(outside, link);

    const raw = await readBackupFileNoFollow(link);

    assert.equal(raw, undefined);
    assert.equal(await readFile(outside, "utf8"), "outside secret\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createBackup refuses a symlinked storage root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-backup-root-symlink-"));
  try {
    const config = backupConfig(dir);
    const outsideStorage = join(dir, "outside-storage");
    await mkdir(outsideStorage, { recursive: true });
    await writeFile(join(outsideStorage, "leaked.txt"), "outside secret\n", "utf8");
    await symlink(outsideStorage, config.storage.dir);

    await assert.rejects(
      () => createBackup(config, { outputPath: join(dir, "snapshot.json") }),
      /storage path is a symlink/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createBackup refuses storage roots reached through symlinked parents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-backup-parent-symlink-"));
  try {
    const storageLink = join(dir, "storage-link");
    const outsideRoot = join(dir, "outside-root");
    const outsideStorage = join(outsideRoot, ".viser");
    const config: ViserConfig = {
      ...backupConfig(dir),
      storage: { dir: join(storageLink, ".viser") }
    };

    await mkdir(outsideStorage, { recursive: true });
    await writeFile(join(outsideStorage, "leaked.txt"), "outside secret\n", "utf8");
    await symlink(outsideRoot, storageLink);

    await assert.rejects(
      () => createBackup(config, { outputPath: join(dir, "snapshot.json") }),
      /symlink/i
    );
    await assert.rejects(() => readFile(join(dir, "snapshot.json"), "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createBackup excludes stale atomic temp files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-backup-temp-exclude-"));
  try {
    const config = backupConfig(dir);
    await mkdir(join(config.storage.dir, "jobs"), { recursive: true });
    await writeFile(join(config.storage.dir, "jobs", "jobs.json"), "[]\n", "utf8");
    await writeFile(join(config.storage.dir, "jobs", ".jobs.json.1234.123e4567-e89b-12d3-a456-426614174000.tmp"), "partial secret\n", "utf8");

    const result = await createBackup(config, { outputPath: join(dir, "snapshot.json") });

    assert.deepEqual(result.artifact.files.map((file) => file.path), ["jobs/jobs.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createBackup redacts secret-looking content inside storage files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-backup-redact-files-"));
  try {
    const config = backupConfig(dir);
    await mkdir(join(config.storage.dir, "memory"), { recursive: true });
    await writeFile(
      join(config.storage.dir, "memory", "entries.jsonl"),
      [
        `TELEGRAM_BOT_TOKEN=${FAKE_TELEGRAM_TOKEN}`,
        `{"apiKey":"${FAKE_MODEL_API_KEY}","note":"keep me"}`,
        "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345",
        "Bot MTAabcdefghijklmnopqrstuvwxyz012345"
      ].join("\n"),
      "utf8"
    );

    const result = await createBackup(config, { outputPath: join(dir, "snapshot.json") });
    const file = result.artifact.files.find((item) => item.path === "memory/entries.jsonl");

    assert.ok(file);
    assert.equal(file.redacted, true);
    assert.deepEqual(result.redactedFiles, ["memory/entries.jsonl"]);
    assert.match(file.content, /\[REDACTED]/);
    assert.match(file.content, /"note":"keep me"/);
    assert.doesNotMatch(file.content, new RegExp(escapeRegExp(FAKE_TELEGRAM_TOKEN)));
    assert.doesNotMatch(file.content, new RegExp(escapeRegExp(FAKE_MODEL_API_KEY)));
    assert.doesNotMatch(file.content, /abcdefghijklmnopqrstuvwxyz012345/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createBackup redacts transient access pairing codes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-backup-redact-access-"));
  try {
    const config = backupConfig(dir);
    await mkdir(join(config.storage.dir, "access"), { recursive: true });
    await writeFile(
      join(config.storage.dir, "access", "access.json"),
      JSON.stringify({
        peers: [{ connector: "telegram", id: "42", createdAt: "2026-01-01T00:00:00.000Z", source: "pair:ABCDEF12" }],
        codes: [{ code: "ABCDEF12", connector: "telegram", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T00:10:00.000Z" }]
      }),
      "utf8"
    );

    const result = await createBackup(config, { outputPath: join(dir, "snapshot.json") });
    const file = result.artifact.files.find((item) => item.path === "access/access.json");

    assert.ok(file);
    assert.equal(file.redacted, true);
    assert.match(file.content, /\[REDACTED]/);
    assert.doesNotMatch(file.content, /ABCDEF12/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createBackupReport returns a user-facing summary", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-backup-report-"));
  try {
    const config = backupConfig(dir);
    await mkdir(config.storage.dir, { recursive: true });
    await writeFile(join(config.storage.dir, "events.jsonl"), "TOKEN=secret-token-value-123456\n", "utf8");
    const report = await createBackupReport(config, { outputPath: join(dir, "snapshot.json") });

    assert.match(report, /Viser backup created/);
    assert.match(report, /redacted files: events\.jsonl/);
    assert.match(report, /Restore note/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function backupConfig(dir: string): ViserConfig {
  return {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, workdir: dir },
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
      codex: { ...DEFAULT_CONFIG.providers.codex },
      gpt: { ...DEFAULT_CONFIG.providers.gpt },
      gemini: { ...DEFAULT_CONFIG.providers.gemini },
      claude: { ...DEFAULT_CONFIG.providers.claude }
    }
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
