import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nextStepsReport } from "../src/cli/next-steps.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { ViserConfig } from "../src/core/types.ts";

test("nextStepsReport gives a launch checklist without running provider probes by default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-next-"));
  try {
    const report = await nextStepsReport(nextStepsConfig(dir));

    assert.match(report, /Viser next steps/);
    assert.match(report, /runtime not proven yet/);
    assert.match(report, /viser verify --live --probe-all-providers/);
    assert.match(report, /manual smoke tests in a normal terminal/);
    assert.match(report, /Single-command launch status: `viser launch-status`/);
    assert.match(report, /No-start preflight/);
    assert.match(report, /Foreground runtime: `viser`/);
    assert.match(report, /CLI chat: `viser chat`/);
    assert.match(report, /Gateway strict live provider-proof dry-run: `viser gateway --dry-run --strict --live --probe-all-providers`/);
    assert.match(report, /Live provider-proof foreground gateway: `viser gateway`/);
    assert.doesNotMatch(report, /service-run --live --probe-all-providers/);
    assert.match(report, /Explicit live provider-proof foreground gateway: `viser gateway --strict --live --probe-all-providers`/);
    assert.match(report, /Unsafe raw foreground gateway for debugging only: `viser gateway --unsafe-skip-gate`/);
    assert.match(report, /Legacy service cleanup only/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nextStepsReport highlights a working fallback provider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-next-fallback-"));
  try {
    const config = nextStepsConfig(dir);
    config.assistant.defaultProvider = "bad";
    config.assistant.fallbackProviders = ["good"];
    config.providers = {
      bad: {
        id: "bad",
        label: "Bad",
        command: "node",
        args: ["-e", "console.error('NOPE'); process.exit(2)"],
        promptMode: "argument",
        timeoutMs: 5000
      },
      good: {
        id: "good",
        label: "Good",
        command: "node",
        args: ["-e", "console.log('VISER_OK')"],
        promptMode: "argument",
        timeoutMs: 5000
      }
    };

    const report = await nextStepsReport(config, { probeAllProviders: true });

    assert.match(report, /usable default\/fallback provider\(s\): good/);
    assert.match(report, /fix bad:/);
    assert.match(report, /provider guide: `viser provider-guide --probe`/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nextStepsReport classifies provider probe failures into concrete recovery steps", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-next-provider-fix-"));
  try {
    const config = nextStepsConfig(dir);
    config.assistant.defaultProvider = "blocked";
    config.assistant.fallbackProviders = [];
    config.providers = {
      blocked: {
        id: "blocked",
        label: "Blocked",
        command: "node",
        args: ["-e", "console.error('Operation not permitted'); process.exit(1)"],
        promptMode: "argument",
        timeoutMs: 5000
      }
    };

    const report = await nextStepsReport(config, { probeAllProviders: true });

    assert.match(report, /detected issue: sandbox\/permission failure/);
    assert.match(report, /manual smoke test:/);
    assert.match(report, /viser verify --live --probe-all-providers/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nextStepsReport shows how to remove an unused missing fallback provider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-next-unused-fallback-"));
  try {
    const config = nextStepsConfig(dir);
    config.assistant.fallbackProviders = ["unused"];
    config.providers.unused = {
      id: "unused",
      label: "Unused",
      command: "definitely-not-a-real-viser-provider-command",
      args: [],
      promptMode: "argument",
      timeoutMs: 5000,
      loginHint: "Install the unused provider."
    };

    const report = await nextStepsReport(config);

    assert.match(report, /optional unused: definitely-not-a-real-viser-provider-command missing/);
    assert.match(report, /remove 'unused' from assistant\.fallbackProviders/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nextStepsReport gives connector and safety actions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-next-connectors-"));
  try {
    const report = await nextStepsReport(nextStepsConfig(dir));

    assert.match(report, /Messaging \/ gateway/);
    assert.match(report, /TELEGRAM_BOT_TOKEN=\.\.\./);
    assert.match(report, /DISCORD_BOT_TOKEN=\.\.\./);
    assert.match(report, /SLACK_BOT_TOKEN=\.\.\./);
    assert.match(report, /SLACK_APP_TOKEN=\.\.\./);
    assert.match(report, /SIGNAL_CLI_ACCOUNT=\+15551234567/);
    assert.match(report, /WHATSAPP_ACCESS_TOKEN=\.\.\./);
    assert.match(report, /WHATSAPP_PHONE_NUMBER_ID=\.\.\./);
    assert.match(report, /WHATSAPP_VERIFY_TOKEN=\.\.\./);
    assert.match(report, /LINE_CHANNEL_ACCESS_TOKEN=\.\.\./);
    assert.match(report, /LINE_CHANNEL_SECRET=\.\.\./);
    assert.match(report, /VISER_WEBHOOK_URL=\.\.\./);
    assert.match(report, /VISER_WEBHOOKS=ops=https:\/\/hooks\.example\.com\/viser\/\.\.\./);
    assert.match(report, /SYNOLOGY_CHAT_WEBHOOK_URL=\.\.\./);
    assert.match(report, /SYNOLOGY_CHAT_WEBHOOKS=ops=https:\/\/chat\.example\.com\/webapi\/entry\.cgi\?api=SYNO\.Chat\.External&method=incoming&version=2&token=\.\.\./);
    assert.match(report, /DINGTALK_WEBHOOK_URL=\.\.\./);
    assert.match(report, /WECOM_WEBHOOK_URL=\.\.\./);
    assert.match(report, /NTFY_BASE_URL=https:\/\/ntfy\.sh/);
    assert.match(report, /NTFY_TOPIC=viser\-alerts/);
    assert.match(report, /NTFY_TOPICS=ops=viser-ops-alerts/);
    assert.match(report, /MASTODON_BASE_URL=https:\/\/mastodon\.example/);
    assert.match(report, /MASTODON_ACCESS_TOKEN=\.\.\./);
    assert.match(report, /MASTODON_VISIBILITY=private/);
    assert.match(report, /MASTODON_TARGETS=ops=unlisted/);
    assert.match(report, /NEXTCLOUD_TALK_BASE_URL=https:\/\/nextcloud\.example\.com/);
    assert.match(report, /NEXTCLOUD_TALK_USERNAME=viser-bot/);
    assert.match(report, /NEXTCLOUD_TALK_APP_PASSWORD=\.\.\./);
    assert.match(report, /NEXTCLOUD_TALK_ROOM_TOKEN=roomtoken/);
    assert.match(report, /NEXTCLOUD_TALK_ROOMS=ops=roomtoken/);
    assert.match(report, /EMAIL_SENDMAIL_COMMAND=sendmail/);
    assert.match(report, /EMAIL_FROM=viser@example\.com/);
    assert.match(report, /EMAIL_RECIPIENT=operator@example\.com/);
    assert.match(report, /EMAIL_RECIPIENTS=ops=operator@example\.com/);
    assert.match(report, /GITHUB_TOKEN=\.\.\./);
    assert.match(report, /GITHUB_ISSUE_TARGET=owner\/repo#123/);
    assert.match(report, /GITHUB_ISSUE_TARGETS=release=owner\/repo#123/);
    assert.match(report, /TODOIST_API_TOKEN=\.\.\./);
    assert.match(report, /TODOIST_PROJECT_ID=6Jf8VQXxpwv56VQ7/);
    assert.match(report, /TODOIST_PROJECTS=ops=6Jf8VQXxpwv56VQ7/);
    const notionTokenEnv = ["NOTION", "TOKEN"].join("_");
    const notionPageIdEnv = ["NOTION", "PAGE", "ID"].join("_");
    const notionPagesEnv = ["NOTION", "PAGES"].join("_");
    const zeroNotionPageId = ["00000000", "0000", "0000", "0000", "000000000000"].join("-");
    assert.match(report, new RegExp(`${notionTokenEnv}=\\.\\.\\.`));
    assert.match(report, new RegExp(`${notionPageIdEnv}=${zeroNotionPageId}`));
    assert.match(report, new RegExp(`${notionPagesEnv}=ops=${zeroNotionPageId}`));
    assert.match(report, /pair-code telegram\|discord\|slack\|matrix\|signal\|imessage\|whatsapp\|line\|kakaotalk\|google-chat\|webhook\|home-assistant\|teams\|mattermost\|synology-chat\|rocket-chat\|feishu\|dingtalk\|wecom\|zalo\|irc\|twitch\|ntfy\|mastodon\|nextcloud-talk\|webex\|zulip\|email\|github\|todoist\|notion\|obsidian/);
    assert.match(report, /backup state\/config/);
    assert.match(report, /viser smoke/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nextStepsReport reports intentionally disabled connectors without token setup warnings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-next-disabled-connectors-"));
  try {
    const config = nextStepsConfig(dir);
    const report = await nextStepsReport(config, { live: true, probeAllProviders: true });

    assert.match(report, /live Telegram\/Discord\/Slack\/Matrix\/Signal\/iMessage\/WhatsApp\/LINE\/KakaoTalk\/Google Chat\/generic Webhook\/Home Assistant\/Teams\/Mattermost\/Synology Chat\/Rocket\.Chat\/Feishu\/DingTalk\/WeCom\/Zalo\/IRC\/Twitch\/ntfy\/Mastodon\/Nextcloud Talk\/Webex\/Zulip\/Email\/GitHub\/Todoist\/Notion\/Obsidian credential validation not configured/);
    assert.match(report, /ℹ️ live token check telegram: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check discord: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check slack: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check matrix: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check signal: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check imessage: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check whatsapp: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check line: disabled \(no token configured\)/);
    assert.match(report, /✅ live token check kakaotalk: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check google-chat: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check webhook: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check home-assistant: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check teams: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check mattermost: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check synology-chat: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check rocket-chat: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check feishu: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check dingtalk: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check wecom: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check zalo: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check irc: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check twitch: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check ntfy: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check mastodon: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check nextcloud-talk: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check webex: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check zulip: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check email: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check github: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check todoist: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check notion: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ live token check obsidian: disabled \(no token configured\)/);
    assert.doesNotMatch(report, /live Telegram\/Discord\/Slack token validation passed/);
    assert.doesNotMatch(report, /Set TELEGRAM_BOT_TOKEN\./);
    assert.doesNotMatch(report, /Set DISCORD_BOT_TOKEN\./);
    assert.doesNotMatch(report, /Set SLACK_BOT_TOKEN\./);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nextStepsReport turns live connector token rejection into messaging recovery actions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-next-live-token-"));
  const originalFetch = globalThis.fetch;
  try {
    const config = nextStepsConfig(dir);
    config.connectors.telegram.botToken = "bad-token";
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), {
      status: 401,
      statusText: "Unauthorized",
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

    const report = await nextStepsReport(config, { live: true });

    assert.match(report, /Messaging \/ gateway/);
    assert.match(report, /❌ live token check telegram: Unauthorized/);
    assert.match(report, /Check TELEGRAM_BOT_TOKEN; the configured token was rejected by telegram/);
    assert.match(report, /viser next-steps --live --probe-all-providers/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("nextStepsReport gives local tool recovery actions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-next-tools-"));
  try {
    const config = nextStepsConfig(dir);
    config.tools.shell.allowedCommands = ["definitely-not-a-real-viser-tool-command"];

    const report = await nextStepsReport(config);

    assert.match(report, /Local tools/);
    assert.match(report, /shell commands missing: definitely-not-a-real-viser-tool-command/);
    assert.match(report, /viser tools/);
    assert.match(report, /tools\.shell\.allowedCommands/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nextStepsReport gives starter skill setup actions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-next-skills-"));
  try {
    const report = await nextStepsReport(nextStepsConfig(dir));

    assert.match(report, /0 skills available/);
    assert.match(report, /viser setup/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function nextStepsConfig(dir: string): ViserConfig {
  return {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, defaultProvider: "echo", fallbackProviders: [], workdir: dir },
    storage: { dir: join(dir, ".viser") },
    memory: { ...DEFAULT_CONFIG.memory, dir: join(dir, ".viser", "memory") },
    personalization: { ...DEFAULT_CONFIG.personalization, dir: join(dir, ".viser", "personalization") },
    skills: { ...DEFAULT_CONFIG.skills, dirs: [join(dir, "skills"), join(dir, ".viser", "skills")] },
    plugins: { ...DEFAULT_CONFIG.plugins, dirs: [join(dir, "plugins"), join(dir, ".viser", "plugins")] },
    tools: { ...DEFAULT_CONFIG.tools, allowedReadRoots: [dir], shell: { ...DEFAULT_CONFIG.tools.shell } },
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
        timeoutMs: 5000,
        loginHint: "No login needed for test provider."
      }
    }
  };
}
