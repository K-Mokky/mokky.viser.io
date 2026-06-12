import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createConnectorMessageSender } from "../src/connectors/notifier.ts";
import { pairingRequiredMessage, pairedMessage } from "../src/connectors/telegram.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { ViserConfig } from "../src/core/types.ts";

test("pairing messages explain how to authorize a chat", () => {
  assert.match(pairingRequiredMessage("telegram"), /pair-code telegram/);
  assert.match(pairingRequiredMessage("discord"), /\/pair CODE/);
  assert.match(pairingRequiredMessage("slack"), /pair-code slack/);
  assert.match(pairingRequiredMessage("signal"), /pair-code signal/);
  assert.match(pairingRequiredMessage("imessage"), /pair-code imessage/);
  assert.match(pairingRequiredMessage("whatsapp"), /pair-code whatsapp/);
  assert.match(pairingRequiredMessage("line"), /pair-code line/);
  assert.match(pairingRequiredMessage("google-chat"), /pair-code google-chat/);
  assert.match(pairingRequiredMessage("webhook"), /pair-code webhook/);
  assert.match(pairingRequiredMessage("home-assistant"), /pair-code home-assistant/);
  assert.match(pairingRequiredMessage("teams"), /pair-code teams/);
  assert.match(pairingRequiredMessage("mattermost"), /pair-code mattermost/);
  assert.match(pairingRequiredMessage("synology-chat"), /pair-code synology-chat/);
  assert.match(pairingRequiredMessage("rocket-chat"), /pair-code rocket-chat/);
  assert.match(pairingRequiredMessage("feishu"), /pair-code feishu/);
  assert.match(pairingRequiredMessage("dingtalk"), /pair-code dingtalk/);
  assert.match(pairingRequiredMessage("wecom"), /pair-code wecom/);
  assert.match(pairingRequiredMessage("zalo"), /pair-code zalo/);
  assert.match(pairingRequiredMessage("irc"), /pair-code irc/);
  assert.match(pairingRequiredMessage("ntfy"), /pair-code ntfy/);
  assert.match(pairingRequiredMessage("mastodon"), /pair-code mastodon/);
  assert.match(pairingRequiredMessage("nextcloud-talk"), /pair-code nextcloud-talk/);
  assert.match(pairingRequiredMessage("webex"), /pair-code webex/);
  assert.match(pairingRequiredMessage("zulip"), /pair-code zulip/);
  assert.match(pairingRequiredMessage("github"), /pair-code github/);
  assert.match(pairingRequiredMessage("notion"), /pair-code notion/);
  assert.match(pairingRequiredMessage("obsidian"), /pair-code obsidian/);
  assert.match(pairedMessage("telegram"), /Paired/);
});

test("connector message sender refuses unpaired outbound targets before token use", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-connector-message-deny-"));
  try {
    const config = testConfig(dir);
    const send = createConnectorMessageSender(config);

    await assert.rejects(
      () => send({ connector: "telegram", targetId: "123456", text: "hello" }),
      /not allowed/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("connector message sender reaches token check only for configured targets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-connector-message-allow-"));
  try {
    const config = testConfig(dir);
    config.connectors.discord.allowedChannelIds = ["1234567890"];
    config.connectors.slack.allowedChannelIds = ["C123456"];
    config.connectors.signal.allowedRecipientIds = ["+15551234567"];
    config.connectors.imessage.allowedHandleIds = ["user@example.com"];
    config.connectors.whatsapp.accessToken = "whatsapp-secret-token";
    config.connectors.whatsapp.phoneNumberId = "12345";
    config.connectors.whatsapp.allowedRecipientIds = ["+15551234567"];
    config.connectors.line.channelAccessToken = "line-secret-token";
    config.connectors.line.channelSecret = "line-channel-secret";
    config.connectors.line.allowedPeerIds = ["U1234567890abcdef"];
    config.connectors.googleChat.webhookUrl = "https://chat.googleapis.com/v1/spaces/AAAA/messages?key=secret-key&token=secret-token";
    config.connectors.googleChat.allowedWebhookIds = ["default"];
    config.connectors.webhook.webhookUrl = "https://hooks.example.com/viser/secret";
    config.connectors.webhook.allowedWebhookIds = ["default"];
    config.connectors.homeAssistant.baseUrl = "http://127.0.0.1:8123";
    config.connectors.homeAssistant.accessToken = "homeassistant-secret-token";
    config.connectors.homeAssistant.service = "notify.persistent_notification";
    config.connectors.homeAssistant.allowedServiceIds = ["default"];
    config.connectors.teams.webhookUrl = "https://example.webhook.office.com/webhookb2/secret";
    config.connectors.teams.allowedWebhookIds = ["default"];
    config.connectors.mattermost.webhookUrl = "https://mattermost.example.com/hooks/secret";
    config.connectors.mattermost.allowedWebhookIds = ["default"];
    config.connectors.synologyChat.webhookUrl = "https://synology.example.com/webapi/entry.cgi?api=SYNO.Chat.External&method=incoming&version=2&token=secret";
    config.connectors.synologyChat.allowedWebhookIds = ["default"];
    config.connectors.rocketChat.webhookUrl = "https://rocket.example.com/hooks/integration/secret";
    config.connectors.rocketChat.allowedWebhookIds = ["default"];
    config.connectors.feishu.webhookUrl = "https://open.feishu.cn/open-apis/bot/v2/hook/secret";
    config.connectors.feishu.allowedWebhookIds = ["default"];
    config.connectors.dingtalk.webhookUrl = "https://oapi.dingtalk.com/robot/send?access_token=secret";
    config.connectors.dingtalk.allowedWebhookIds = ["default"];
    config.connectors.wecom.webhookUrl = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret";
    config.connectors.wecom.allowedWebhookIds = ["default"];
    config.connectors.zalo.accessToken = "zalo-secret-token";
    config.connectors.zalo.recipient = "zalo-user-1";
    config.connectors.zalo.allowedRecipientIds = ["default"];
    config.connectors.irc.host = "irc.example.com";
    config.connectors.irc.port = 6697;
    config.connectors.irc.tls = true;
    config.connectors.irc.nick = "ViserBot";
    config.connectors.irc.password = "irc-secret-password";
    config.connectors.irc.channel = "#viser";
    config.connectors.irc.allowedChannelIds = ["default"];
    config.connectors.ntfy.baseUrl = "https://ntfy.example.com";
    config.connectors.ntfy.token = "ntfy-secret-token";
    config.connectors.ntfy.topic = "viser-alerts";
    config.connectors.ntfy.allowedTopicIds = ["default"];
    config.connectors.mastodon.baseUrl = "https://mastodon.example";
    config.connectors.mastodon.accessToken = "mastodon-secret-token";
    config.connectors.mastodon.visibility = "private";
    config.connectors.mastodon.allowedTargetIds = ["default"];
    config.connectors.nextcloudTalk.baseUrl = "https://cloud.example.com";
    config.connectors.nextcloudTalk.username = "viser-bot";
    config.connectors.nextcloudTalk.appPassword = "nextcloud-secret-password";
    config.connectors.nextcloudTalk.roomToken = "roomtoken1";
    config.connectors.nextcloudTalk.allowedRoomIds = ["default"];
    config.connectors.webex.accessToken = "webex-secret-token";
    config.connectors.webex.allowedRoomIds = ["Y2lzY29zcGFyazovL3VzL1JPT00vc21va2U"];
    config.connectors.zulip.siteUrl = "https://viser-smoke.zulipchat.com";
    config.connectors.zulip.botEmail = "viser-bot@example.com";
    config.connectors.zulip.apiKey = "zulip-secret-token";
    config.connectors.zulip.target = "stream:operations:alerts";
    config.connectors.zulip.allowedTargetIds = ["default"];
    config.connectors.github.token = "github-secret-token";
    config.connectors.github.target = "KMokky/viser#123";
    config.connectors.github.allowedTargetIds = ["default"];
    config.connectors.todoist.token = "todoist-secret-token";
    config.connectors.todoist.project = "6Jf8VQXxpwv56VQ7";
    config.connectors.todoist.allowedProjectIds = ["default"];
    config.connectors.notion.token = "notion-secret-token";
    config.connectors.notion.page = "00000000-0000-0000-0000-000000000000";
    config.connectors.notion.allowedPageIds = ["default"];
    config.connectors.obsidian.vaultDir = dir;
    config.connectors.obsidian.note = "Obsidian/Viser.md";
    config.connectors.obsidian.allowedNoteIds = ["default"];
    const imessageSent: string[] = [];
    const whatsappSent: string[] = [];
    const lineSent: string[] = [];
    const googleChatSent: string[] = [];
    const genericWebhookSent: string[] = [];
    const homeAssistantSent: string[] = [];
    const teamsSent: string[] = [];
    const mattermostSent: string[] = [];
    const synologyChatSent: string[] = [];
    const rocketChatSent: string[] = [];
    const feishuSent: string[] = [];
    const dingTalkSent: string[] = [];
    const weComSent: string[] = [];
    const zaloSent: string[] = [];
    const ircSent: string[] = [];
    const ntfySent: string[] = [];
    const mastodonSent: string[] = [];
    const nextcloudTalkSent: string[] = [];
    const webexSent: string[] = [];
    const zulipSent: string[] = [];
    const githubSent: string[] = [];
    const todoistSent: string[] = [];
    const notionSent: string[] = [];
    const send = createConnectorMessageSender(config, {
      whatsappFetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { text?: { body?: string } };
        whatsappSent.push(String(body.text?.body ?? ""));
        return new Response(JSON.stringify({ messages: [{ id: "wamid.test" }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      },
      lineFetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ text?: string }> };
        lineSent.push(String(body.messages?.[0]?.text ?? ""));
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      },
      googleChatFetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
        googleChatSent.push(String(body.text ?? ""));
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      },
      genericWebhookFetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
        genericWebhookSent.push(String(body.text ?? ""));
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      },
      homeAssistantFetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { message?: string };
        homeAssistantSent.push(String(body.message ?? ""));
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      },
      teamsFetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { attachments?: Array<{ content?: { body?: Array<{ text?: string }> } }> };
        teamsSent.push(String(body.attachments?.[0]?.content?.body?.[0]?.text ?? ""));
        return new Response("1", { status: 200, headers: { "content-type": "text/plain" } });
      },
      mattermostFetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
        mattermostSent.push(String(body.text ?? ""));
        return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
      },
      synologyChatFetch: async (_input, init) => {
        const params = new URLSearchParams(String(init?.body ?? ""));
        const body = JSON.parse(params.get("payload") ?? "{}") as { text?: string };
        synologyChatSent.push(String(body.text ?? ""));
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } });
      },
      rocketChatFetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
        rocketChatSent.push(String(body.text ?? ""));
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } });
      },
      feishuFetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { content?: { text?: string } };
        feishuSent.push(String(body.content?.text ?? ""));
        return new Response(JSON.stringify({ code: 0 }), { status: 200, headers: { "content-type": "application/json" } });
      },
      dingTalkFetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { text?: { content?: string } };
        dingTalkSent.push(String(body.text?.content ?? ""));
        return new Response(JSON.stringify({ errcode: 0 }), { status: 200, headers: { "content-type": "application/json" } });
      },
      weComFetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { text?: { content?: string } };
        weComSent.push(String(body.text?.content ?? ""));
        return new Response(JSON.stringify({ errcode: 0 }), { status: 200, headers: { "content-type": "application/json" } });
      },
      zaloFetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { message?: { text?: string } };
        zaloSent.push(String(body.message?.text ?? ""));
        return new Response(JSON.stringify({ error: 0 }), { status: 200, headers: { "content-type": "application/json" } });
      },
      ircRunner: async (input) => {
        ircSent.push(input.chunks.join(" "));
      },
      ntfyFetch: async (_input, init) => {
        ntfySent.push(String(init?.body ?? ""));
        return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
      },
      mastodonFetch: async (_input, init) => {
        const body = init?.body as URLSearchParams;
        mastodonSent.push(String(body.get("status") ?? ""));
        return new Response(JSON.stringify({ id: "status-id" }), { status: 200, headers: { "content-type": "application/json" } });
      },
      nextcloudTalkFetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { message?: string };
        nextcloudTalkSent.push(String(body.message ?? ""));
        return new Response(JSON.stringify({ ocs: { meta: { status: "ok", statuscode: 200 } } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      },
      webexFetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { markdown?: string };
        webexSent.push(String(body.markdown ?? ""));
        return new Response(JSON.stringify({ id: "message-id" }), { status: 200, headers: { "content-type": "application/json" } });
      },
      zulipFetch: async (_input, init) => {
        const body = new URLSearchParams(String(init?.body ?? ""));
        zulipSent.push(String(body.get("content") ?? ""));
        return new Response(JSON.stringify({ result: "success", id: 42 }), { status: 200, headers: { "content-type": "application/json" } });
      },
      githubFetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { body?: string };
        githubSent.push(String(body.body ?? ""));
        return new Response(JSON.stringify({ id: 1 }), { status: 201, headers: { "content-type": "application/json" } });
      },
      todoistFetch: async (_input, init) => {
        const params = new URLSearchParams(String(init?.body ?? ""));
        const commands = JSON.parse(params.get("commands") ?? "[]") as Array<{ uuid?: string; args?: { content?: string } }>;
        for (const command of commands) {
          todoistSent.push(String(command.args?.content ?? ""));
        }
        const syncStatus = Object.fromEntries(commands.map((command) => [String(command.uuid ?? "missing"), "ok"]));
        return new Response(JSON.stringify({ sync_status: syncStatus }), { status: 200, headers: { "content-type": "application/json" } });
      },
      notionFetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          children?: Array<{ paragraph?: { rich_text?: Array<{ text?: { content?: string } }> } }>;
        };
        notionSent.push(String(body.children?.[0]?.paragraph?.rich_text?.[0]?.text?.content ?? ""));
        return new Response(JSON.stringify({ object: "list", results: [] }), { status: 200, headers: { "content-type": "application/json" } });
      },
      imessageRunner: async (options) => {
        imessageSent.push(String(options.args.at(-1) ?? ""));
        return {
          stdout: "",
          stderr: "",
          exitCode: 0,
          signal: null,
          elapsedMs: 1,
          maxOutputBytes: 20_000,
          stdoutTruncated: false,
          stderrTruncated: false
        };
      }
    });

    await assert.rejects(
      () => send({ connector: "discord", targetId: "1234567890", text: "hello" }),
      /Discord token is missing/
    );
    await assert.rejects(
      () => send({ connector: "slack", targetId: "C123456", text: "hello" }),
      /Slack token is missing/
    );
    await assert.rejects(
      () => send({ connector: "signal", targetId: "+15551234567", text: "hello" }),
      /Signal account is missing/
    );
    await send({ connector: "imessage", targetId: "user@example.com", text: "hello imessage" });
    assert.deepEqual(imessageSent, ["hello imessage"]);
    await send({ connector: "whatsapp", targetId: "+15551234567", text: "hello whatsapp" });
    assert.deepEqual(whatsappSent, ["hello whatsapp"]);
    await send({ connector: "line", targetId: "U1234567890abcdef", text: "hello line" });
    assert.deepEqual(lineSent, ["hello line"]);
    await send({ connector: "google-chat", targetId: "default", text: "hello google chat" });
    assert.deepEqual(googleChatSent, ["hello google chat"]);
    await send({ connector: "webhook", targetId: "default", text: "hello generic webhook" });
    assert.deepEqual(genericWebhookSent, ["hello generic webhook"]);
    await send({ connector: "home-assistant", targetId: "default", text: "hello home assistant" });
    assert.deepEqual(homeAssistantSent, ["hello home assistant"]);
    await send({ connector: "teams", targetId: "default", text: "hello teams" });
    assert.deepEqual(teamsSent, ["hello teams"]);
    await send({ connector: "mattermost", targetId: "default", text: "hello mattermost" });
    assert.deepEqual(mattermostSent, ["hello mattermost"]);
    await send({ connector: "synology-chat", targetId: "default", text: "hello synology chat" });
    assert.deepEqual(synologyChatSent, ["hello synology chat"]);
    await send({ connector: "rocket-chat", targetId: "default", text: "hello rocket chat" });
    assert.deepEqual(rocketChatSent, ["hello rocket chat"]);
    await send({ connector: "feishu", targetId: "default", text: "hello feishu" });
    assert.deepEqual(feishuSent, ["hello feishu"]);
    await send({ connector: "dingtalk", targetId: "default", text: "hello dingtalk" });
    assert.deepEqual(dingTalkSent, ["hello dingtalk"]);
    await send({ connector: "wecom", targetId: "default", text: "hello wecom" });
    assert.deepEqual(weComSent, ["hello wecom"]);
    await send({ connector: "zalo", targetId: "default", text: "hello zalo" });
    assert.deepEqual(zaloSent, ["hello zalo"]);
    await send({ connector: "irc", targetId: "default", text: "hello irc" });
    assert.deepEqual(ircSent, ["hello irc"]);
    await send({ connector: "ntfy", targetId: "default", text: "hello ntfy" });
    assert.deepEqual(ntfySent, ["hello ntfy"]);
    await send({ connector: "mastodon", targetId: "default", text: "hello mastodon" });
    assert.deepEqual(mastodonSent, ["hello mastodon"]);
    await send({ connector: "nextcloud-talk", targetId: "default", text: "hello nextcloud" });
    assert.deepEqual(nextcloudTalkSent, ["hello nextcloud"]);
    await send({ connector: "webex", targetId: "Y2lzY29zcGFyazovL3VzL1JPT00vc21va2U", text: "hello webex" });
    assert.deepEqual(webexSent, ["hello webex"]);
    await send({ connector: "zulip", targetId: "default", text: "hello zulip" });
    assert.deepEqual(zulipSent, ["hello zulip"]);
    await send({ connector: "github", targetId: "default", text: "hello github" });
    assert.deepEqual(githubSent, ["hello github"]);
    await send({ connector: "todoist", targetId: "default", text: "hello todoist" });
    assert.deepEqual(todoistSent, ["hello todoist"]);
    await send({ connector: "notion", targetId: "default", text: "hello notion" });
    assert.deepEqual(notionSent, ["hello notion"]);
    await send({ connector: "obsidian", targetId: "default", text: "hello obsidian" });
    assert.match(await readFile(join(dir, "Obsidian", "Viser.md"), "utf8"), /hello obsidian/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function testConfig(dir: string): ViserConfig {
  const config = structuredClone(DEFAULT_CONFIG) as ViserConfig;
  config.access.dir = join(dir, "access");
  config.access.enabled = true;
  config.access.defaultPolicy = "pairing";
  config.connectors.telegram = { ...config.connectors.telegram, botToken: undefined, allowedChatIds: [], defaultChatIds: [] };
  config.connectors.discord = { ...config.connectors.discord, botToken: undefined, allowedChannelIds: [], defaultChannelIds: [] };
  config.connectors.slack = { ...config.connectors.slack, botToken: undefined, appToken: undefined, allowedChannelIds: [], defaultChannelIds: [] };
  config.connectors.signal = { ...config.connectors.signal, account: undefined, allowedRecipientIds: [], defaultRecipientIds: [] };
  config.connectors.imessage = { ...config.connectors.imessage, allowedHandleIds: [], defaultHandleIds: [] };
  config.connectors.whatsapp = { ...config.connectors.whatsapp, accessToken: undefined, phoneNumberId: undefined, verifyToken: undefined, allowedRecipientIds: [], defaultRecipientIds: [] };
  config.connectors.line = { ...config.connectors.line, channelAccessToken: undefined, channelSecret: undefined, allowedPeerIds: [], defaultPeerIds: [] };
  config.connectors.googleChat = { ...config.connectors.googleChat, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] };
  config.connectors.webhook = { ...config.connectors.webhook, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] };
  config.connectors.homeAssistant = { ...config.connectors.homeAssistant, baseUrl: undefined, accessToken: undefined, service: undefined, services: {}, allowedServiceIds: [], defaultServiceIds: [] };
  config.connectors.teams = { ...config.connectors.teams, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] };
  config.connectors.mattermost = { ...config.connectors.mattermost, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] };
  config.connectors.synologyChat = { ...config.connectors.synologyChat, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] };
  config.connectors.rocketChat = { ...config.connectors.rocketChat, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] };
  config.connectors.feishu = { ...config.connectors.feishu, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] };
  config.connectors.dingtalk = { ...config.connectors.dingtalk, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] };
  config.connectors.wecom = { ...config.connectors.wecom, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] };
  config.connectors.zalo = { ...config.connectors.zalo, accessToken: undefined, recipient: undefined, recipients: {}, allowedRecipientIds: [], defaultRecipientIds: [] };
  config.connectors.irc = { ...config.connectors.irc, host: undefined, nick: undefined, password: undefined, channel: undefined, channels: {}, allowedChannelIds: [], defaultChannelIds: [] };
  config.connectors.ntfy = { ...config.connectors.ntfy, token: undefined, topic: undefined, topics: {}, allowedTopicIds: [], defaultTopicIds: [] };
  config.connectors.nextcloudTalk = { ...config.connectors.nextcloudTalk, baseUrl: undefined, username: undefined, appPassword: undefined, roomToken: undefined, rooms: {}, allowedRoomIds: [], defaultRoomIds: [] };
  config.connectors.webex = { ...config.connectors.webex, accessToken: undefined, allowedRoomIds: [], defaultRoomIds: [] };
  config.connectors.zulip = { ...config.connectors.zulip, siteUrl: undefined, botEmail: undefined, apiKey: undefined, target: undefined, targets: {}, allowedTargetIds: [], defaultTargetIds: [] };
  config.connectors.github = { ...config.connectors.github, token: undefined, target: undefined, targets: {}, allowedTargetIds: [], defaultTargetIds: [] };
  config.connectors.todoist = { ...config.connectors.todoist, token: undefined, project: undefined, projects: {}, allowedProjectIds: [], defaultProjectIds: [] };
  config.connectors.notion = { ...config.connectors.notion, token: undefined, page: undefined, pages: {}, allowedPageIds: [], defaultPageIds: [] };
  config.connectors.obsidian = { ...config.connectors.obsidian, vaultDir: undefined, note: undefined, notes: {}, allowedNoteIds: [], defaultNoteIds: [] };
  return config;
}
