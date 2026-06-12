import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compactBackupReport } from "../src/cli/compact-backups.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { ViserConfig } from "../src/core/types.ts";

test("compactBackupReport lists compact backup artifacts without active state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-compact-backups-list-"));
  try {
    const config = compactConfig(dir);
    await writeCompactFixtures(config);

    const report = await compactBackupReport(config);

    assert.match(report, /Viser compact backups: FOUND/);
    assert.match(report, /memory\/entries\.2026-05-23T00-00-00-000Z\.bak\.jsonl/);
    assert.match(report, /sessions\/chat\.2026-05-23T00-00-00-000Z\.bak/);
    assert.doesNotMatch(report, /memory\/entries\.jsonl/);
    assert.doesNotMatch(report, /sessions\/chat\.jsonl/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("compactBackupReport requires explicit force before deleting compact backups", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-compact-backups-delete-"));
  try {
    const config = compactConfig(dir);
    const paths = await writeCompactFixtures(config);

    const blocked = await compactBackupReport(config, { delete: true });
    assert.match(blocked, /blocked/);
    assert.match(await readFile(paths.memoryBackup, "utf8"), /old memory secret/);

    const deleted = await compactBackupReport(config, { delete: true, force: true });

    assert.match(deleted, /removed: 2/);
    await assert.rejects(() => readFile(paths.memoryBackup, "utf8"));
    await assert.rejects(() => readFile(paths.sessionBackup, "utf8"));
    assert.match(await readFile(paths.memoryActive, "utf8"), /current memory/);
    assert.match(await readFile(paths.sessionActive, "utf8"), /current session/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("compactBackupReport only fixes broad compact backup permissions when explicitly requested", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-compact-backups-permissions-"));
  try {
    const config = compactConfig(dir);
    const paths = await writeCompactFixtures(config);
    await chmod(paths.memoryBackup, 0o644);

    const listed = await compactBackupReport(config);
    assert.match(listed, /permissions are group\/world accessible/);
    assert.equal((await stat(paths.memoryBackup)).mode & 0o777, 0o644);

    const fixed = await compactBackupReport(config, { fixPermissions: true });
    assert.match(fixed, /permissions fixed: 1/);
    assert.equal((await stat(paths.memoryBackup)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("compactBackupReport refuses to inspect or delete a symlinked compact backup directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-compact-backups-dir-symlink-"));
  try {
    const config = compactConfig(dir);
    const outsideMemory = join(dir, "outside-memory");
    const outsideBackup = join(outsideMemory, "entries.2026-05-23T00-00-00-000Z.bak.jsonl");
    await mkdir(config.storage.dir, { recursive: true });
    await mkdir(outsideMemory, { recursive: true });
    await writeFile(outsideBackup, "outside compact backup secret\n", "utf8");
    await symlink(outsideMemory, config.memory.dir);

    const listed = await compactBackupReport(config);
    assert.match(listed, /compact backup directory is a symlink/);
    assert.doesNotMatch(listed, /outside compact backup secret/);
    assert.doesNotMatch(listed, /entries\.2026-05-23T00-00-00-000Z\.bak\.jsonl/);

    const deleted = await compactBackupReport(config, { delete: true, force: true });
    assert.match(deleted, /skipped warnings: 1/);
    assert.match(await readFile(outsideBackup, "utf8"), /outside compact backup secret/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("compactBackupReport refuses compact backup directories reached through symlinked parents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-compact-backups-parent-symlink-"));
  try {
    const storageLink = join(dir, "storage-link");
    const outsideRoot = join(dir, "outside-root");
    const outsideMemory = join(outsideRoot, ".viser", "memory");
    const outsideBackup = join(outsideMemory, "entries.2026-05-23T00-00-00-000Z.bak.jsonl");
    const config: ViserConfig = {
      ...compactConfig(dir),
      storage: { dir: join(storageLink, ".viser") },
      memory: { ...DEFAULT_CONFIG.memory, dir: join(storageLink, ".viser", "memory") },
      personalization: { ...DEFAULT_CONFIG.personalization, dir: join(storageLink, ".viser", "personalization") }
    };

    await mkdir(outsideMemory, { recursive: true });
    await writeFile(outsideBackup, "outside compact backup secret\n", "utf8");
    await chmod(outsideBackup, 0o644);
    await symlink(outsideRoot, storageLink);

    const listed = await compactBackupReport(config, { fixPermissions: true });
    assert.match(listed, /symlink/i);
    assert.doesNotMatch(listed, /entries\.2026-05-23T00-00-00-000Z\.bak\.jsonl/);
    assert.equal((await stat(outsideBackup)).mode & 0o777, 0o644);

    const deleted = await compactBackupReport(config, { delete: true, force: true });
    assert.match(deleted, /skipped warnings: 1/);
    assert.match(await readFile(outsideBackup, "utf8"), /outside compact backup secret/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("compactBackupReport does not chmod symlink compact backup artifacts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-compact-backups-artifact-symlink-"));
  try {
    const config = compactConfig(dir);
    const outsideBackup = join(dir, "outside-backup.jsonl");
    await mkdir(config.memory.dir, { recursive: true });
    await writeFile(outsideBackup, "outside compact backup secret\n", "utf8");
    await chmod(outsideBackup, 0o644);
    await symlink(outsideBackup, join(config.memory.dir, "entries.2026-05-23T00-00-00-000Z.bak.jsonl"));

    const report = await compactBackupReport(config, { fixPermissions: true });
    assert.match(report, /symlink compact backup artifact/);
    assert.equal((await stat(outsideBackup)).mode & 0o777, 0o644);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("compactBackupReport delete skips symlink compact backup artifacts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-compact-backups-delete-artifact-symlink-"));
  try {
    const config = compactConfig(dir);
    const outsideBackup = join(dir, "outside-backup.jsonl");
    const link = join(config.memory.dir, "entries.2026-05-23T00-00-00-000Z.bak.jsonl");
    await mkdir(config.memory.dir, { recursive: true });
    await writeFile(outsideBackup, "outside compact backup secret\n", "utf8");
    await symlink(outsideBackup, link);

    const report = await compactBackupReport(config, { delete: true, force: true });

    assert.match(report, /skipped warnings: 1/);
    assert.match(await readFile(outsideBackup, "utf8"), /outside compact backup secret/);
    assert.match(await readFile(link, "utf8"), /outside compact backup secret/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function writeCompactFixtures(config: ViserConfig): Promise<{
  memoryActive: string;
  memoryBackup: string;
  sessionActive: string;
  sessionBackup: string;
}> {
  await mkdir(config.memory.dir, { recursive: true });
  await mkdir(join(config.storage.dir, "sessions"), { recursive: true });

  const memoryActive = join(config.memory.dir, "entries.jsonl");
  const memoryBackup = join(config.memory.dir, "entries.2026-05-23T00-00-00-000Z.bak.jsonl");
  const sessionActive = join(config.storage.dir, "sessions", "chat.jsonl");
  const sessionBackup = join(config.storage.dir, "sessions", "chat.2026-05-23T00-00-00-000Z.bak");

  await writeFile(memoryActive, "current memory\n", "utf8");
  await writeFile(memoryBackup, "old memory secret\n", "utf8");
  await writeFile(sessionActive, "current session\n", "utf8");
  await writeFile(sessionBackup, "old session secret\n", "utf8");
  await chmod(memoryBackup, 0o600);
  await chmod(sessionBackup, 0o600);

  return { memoryActive, memoryBackup, sessionActive, sessionBackup };
}

function compactConfig(dir: string): ViserConfig {
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
    }
  };
}
