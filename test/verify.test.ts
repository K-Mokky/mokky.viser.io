import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verify } from "../src/cli/verify.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { ViserConfig } from "../src/core/types.ts";

test("verify combines readiness and audit into one pass report", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-verify-"));
  try {
    const result = await verify(verifyConfig(dir));

    assert.equal(result.ok, true);
    assert.match(result.report, /Viser verify: PASS/);
    assert.match(result.report, /readiness:/);
    assert.match(result.report, /audit:/);
    assert.match(result.report, /local smoke: PASS/);
    assert.match(result.report, /gateway strict gate: pass/);
    assert.match(result.report, /viser gateway --dry-run --strict/);
    assert.match(result.report, /viser launch-status/);
    assert.match(result.report, /viser next-steps --live --probe-all-providers/);
    assert.match(result.report, /viser gateway/);
    assert.doesNotMatch(result.report, /viser service-run --live --probe-all-providers/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("verify reports blockers when readiness fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-verify-blocked-"));
  try {
    const config = verifyConfig(dir);
    config.assistant.defaultProvider = "missing";
    config.providers = {
      missing: {
        id: "missing",
        command: "definitely-not-real-viser-provider",
        args: [],
        promptMode: "argument",
        timeoutMs: 1000
      }
    };
    const result = await verify(config, { strict: true });

    assert.equal(result.ok, false);
    assert.match(result.report, /Viser verify: BLOCKED/);
    assert.match(result.report, /Blockers:/);
    assert.match(result.report, /default provider command/);
    assert.match(result.report, /strict mode: on/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("verify fails the gateway strict gate when audit fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-verify-audit-blocked-"));
  try {
    const config = verifyConfig(dir);
    config.tools.shell.allowedCommands = ["ls", "rm"];

    const result = await verify(config);

    assert.equal(result.ok, false);
    assert.match(result.report, /Viser verify: BLOCKED/);
    assert.match(result.report, /gateway strict gate: fail/);
    assert.match(result.report, /\[audit:tools]/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("verify can validate provider fallback with all-provider probe", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-verify-probe-all-"));
  try {
    const config = verifyConfig(dir);
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

    const result = await verify(config, { probeAllProviders: true });

    assert.equal(result.ok, true);
    assert.match(result.report, /Viser verify: PASS/);
    assert.match(result.report, /usable default\/fallback provider\(s\): good/);
    assert.match(result.report, /viser provider-guide --probe/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("verify reports blockers when all provider probes fail", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-verify-probe-all-fail-"));
  try {
    const config = verifyConfig(dir);
    config.assistant.defaultProvider = "bad";
    config.assistant.fallbackProviders = [];
    config.providers = {
      bad: {
        id: "bad",
        label: "Bad",
        command: "node",
        args: ["-e", "console.error('NOPE'); process.exit(2)"],
        promptMode: "argument",
        timeoutMs: 5000
      }
    };

    const result = await verify(config, { probeAllProviders: true });

    assert.equal(result.ok, false);
    assert.match(result.report, /Viser verify: BLOCKED/);
    assert.match(result.report, /no default\/fallback provider responded successfully/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("verify includes provider-specific recovery advice for failed probes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-verify-provider-recovery-"));
  try {
    const config = verifyConfig(dir);
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

    const result = await verify(config, { probeAllProviders: true });

    assert.equal(result.ok, false);
    assert.match(result.report, /Provider recovery:/);
    assert.match(result.report, /blocked: detected issue: sandbox\/permission failure/);
    assert.match(result.report, /manual smoke test:/);
    assert.match(result.report, /viser verify --live --probe-all-providers/);
    assert.match(result.report, /viser launch-status/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function verifyConfig(dir: string): ViserConfig {
  return {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, defaultProvider: "echo", fallbackProviders: [], workdir: dir },
    storage: { dir: join(dir, ".viser") },
    memory: { ...DEFAULT_CONFIG.memory, dir: join(dir, ".viser", "memory") },
    personalization: { ...DEFAULT_CONFIG.personalization, dir: join(dir, ".viser", "personalization") },
    skills: { ...DEFAULT_CONFIG.skills, dirs: [join(dir, "skills"), join(dir, ".viser", "skills")] },
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
        timeoutMs: 5000
      }
    }
  };
}
