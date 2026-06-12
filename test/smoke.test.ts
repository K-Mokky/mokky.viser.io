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
    assert.ok(result.items.some((item) => item.area === "dashboard-collab" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "dashboard-auth" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "web-chat" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "webhook-inbound" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "voice-loop" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "voice-capture" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "media-capture" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "learning-curator" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "provider-stream" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "file-search" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "mcp-file-search" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "web-search" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "web-search-searxng" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "web-search-brave" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "web-search-tavily" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "web-search-perplexity" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "web-search-exa" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "web-search-firecrawl" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "web-search-ollama" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "web-fetch-firecrawl" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "mcp-web-search" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "web-fetch" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "mcp-web-fetch" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "browser-task" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "messenger-outbound" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "jobs" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "security" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "telegram" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "discord" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "slack" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "matrix" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "signal" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "imessage" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "whatsapp" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "line" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "google-chat" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "teams" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "mattermost" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "synology-chat" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "rocket-chat" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "feishu" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "dingtalk" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "wecom" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "zalo" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "irc" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "twitch" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "ntfy" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "todoist" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "obsidian" && item.status === "pass"));
    assert.ok(result.items.some((item) => item.area === "benchmark" && item.status === "pass"));
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
    assert.match(report, /\[dashboard-collab]/);
    assert.match(report, /\[dashboard-auth]/);
    assert.match(report, /\[web-chat]/);
    assert.match(report, /\[webhook-inbound]/);
    assert.match(report, /\[voice-loop]/);
    assert.match(report, /\[voice-capture]/);
    assert.match(report, /\[media-capture]/);
    assert.match(report, /\[learning-curator]/);
    assert.match(report, /\[provider-stream]/);
    assert.match(report, /\[file-search]/);
    assert.match(report, /\[mcp-file-search]/);
    assert.match(report, /\[web-search]/);
    assert.match(report, /\[web-search-searxng]/);
    assert.match(report, /\[web-search-brave]/);
    assert.match(report, /\[web-search-tavily]/);
    assert.match(report, /\[web-search-perplexity]/);
    assert.match(report, /\[web-search-exa]/);
    assert.match(report, /\[web-search-firecrawl]/);
    assert.match(report, /\[web-search-ollama]/);
    assert.match(report, /\[web-fetch-firecrawl]/);
    assert.match(report, /\[mcp-web-search]/);
    assert.match(report, /\[web-fetch]/);
    assert.match(report, /\[mcp-web-fetch]/);
    assert.match(report, /\[browser-task]/);
    assert.match(report, /\[security]/);
    assert.match(report, /\[messenger-outbound]/);
    assert.match(report, /\[telegram]/);
    assert.match(report, /\[discord]/);
    assert.match(report, /\[slack]/);
    assert.match(report, /\[matrix]/);
    assert.match(report, /\[signal]/);
    assert.match(report, /\[imessage]/);
    assert.match(report, /\[whatsapp]/);
    assert.match(report, /\[line]/);
    assert.match(report, /\[google-chat]/);
    assert.match(report, /\[teams]/);
    assert.match(report, /\[mattermost]/);
    assert.match(report, /\[synology-chat]/);
    assert.match(report, /\[rocket-chat]/);
    assert.match(report, /\[feishu]/);
    assert.match(report, /\[dingtalk]/);
    assert.match(report, /\[wecom]/);
    assert.match(report, /\[zalo]/);
    assert.match(report, /\[irc]/);
    assert.match(report, /\[twitch]/);
    assert.match(report, /\[ntfy]/);
    assert.match(report, /\[todoist]/);
    assert.match(report, /\[obsidian]/);
    assert.match(report, /\[benchmark]/);
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
    personalization: { ...DEFAULT_CONFIG.personalization, dir: join(dir, ".viser", "personalization") },
    skills: { ...DEFAULT_CONFIG.skills, dirs: [join(dir, "skills"), join(dir, ".viser", "skills")] },
    plugins: { ...DEFAULT_CONFIG.plugins, dirs: [join(dir, "plugins"), join(dir, ".viser", "plugins")] },
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
