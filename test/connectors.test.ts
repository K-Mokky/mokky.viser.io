import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeDingTalkWebhookUrl, sendDingTalkMessage } from "../src/connectors/dingtalk.ts";
import { handleDiscordMessage, normalizeDiscordInput, sendDiscordMessage } from "../src/connectors/discord.ts";
import { parseEmailRecipientMap, sendEmailMessage } from "../src/connectors/email.ts";
import { normalizeFeishuWebhookUrl, sendFeishuMessage } from "../src/connectors/feishu.ts";
import { handleGenericWebhookInbound, normalizeGenericWebhookInboundPath, normalizeGenericWebhookInboundToken, normalizeGenericWebhookUrl, parseGenericWebhookUrlMap, sendGenericWebhookMessage } from "../src/connectors/generic-webhook.ts";
import { parseGitHubIssueTarget, parseGitHubIssueTargetMap, sendGitHubIssueComment } from "../src/connectors/github.ts";
import { normalizeGoogleChatWebhookUrl, parseWebhookUrlMap, sendGoogleChatMessage } from "../src/connectors/google-chat.ts";
import { callHomeAssistantService, normalizeHomeAssistantAccessToken, normalizeHomeAssistantBaseUrl, normalizeHomeAssistantPayload, normalizeHomeAssistantServiceSpec, parseHomeAssistantServiceMap } from "../src/connectors/home-assistant.ts";
import { normalizeIrcChannel, normalizeIrcHost, normalizeIrcNick, parseIrcChannelMap, sendIrcMessage } from "../src/connectors/irc.ts";
import { handleImessageMessage, normalizeImessageHandle, parseImessageRows, sendImessageMessage } from "../src/connectors/imessage.ts";
import { handleKakaotalkSkillPayload, kakaotalkSkillResponse, normalizeKakaotalkUserId, parseKakaotalkSkillMessage, verifyKakaotalkRequestToken } from "../src/connectors/kakaotalk.ts";
import { handleLineWebhookPayload, normalizeLinePeerId, parseLineWebhookMessages, sendLinePushMessage, verifyLineSignature } from "../src/connectors/line.ts";
import { normalizeMattermostWebhookUrl, sendMattermostMessage } from "../src/connectors/mattermost.ts";
import { normalizeNextcloudTalkBaseUrl, normalizeNextcloudTalkRoomToken, parseNextcloudTalkRoomMap, sendNextcloudTalkMessage } from "../src/connectors/nextcloud-talk.ts";
import { normalizeNtfyBaseUrl, normalizeNtfyTopicAlias, normalizeNtfyToken, parseNtfyTopicMap, parseNtfyTopicTarget, sendNtfyMessage } from "../src/connectors/ntfy.ts";
import { normalizeMastodonAccessToken, normalizeMastodonBaseUrl, normalizeMastodonTargetAlias, normalizeMastodonVisibility, parseMastodonTargetMap, sendMastodonStatus } from "../src/connectors/mastodon.ts";
import { appendNotionPageMessage, parseNotionPageMap, parseNotionPageTarget } from "../src/connectors/notion.ts";
import { appendObsidianNoteMessage, parseObsidianNoteMap } from "../src/connectors/obsidian.ts";
import { ConnectorRateLimiter } from "../src/connectors/rate-limit.ts";
import { normalizeRocketChatWebhookUrl, sendRocketChatMessage } from "../src/connectors/rocket-chat.ts";
import { handleSignalEnvelope, normalizeSignalAddress, parseSignalEnvelopes, sendSignalMessage } from "../src/connectors/signal.ts";
import { handleSlackEvent, normalizeSlackInput, sendSlackMessage } from "../src/connectors/slack.ts";
import { normalizeSynologyChatWebhookUrl, sendSynologyChatMessage } from "../src/connectors/synology-chat.ts";
import { normalizeTeamsWebhookUrl, sendTeamsMessage } from "../src/connectors/teams.ts";
import { normalizeTwitchAccessToken, normalizeTwitchChannel, normalizeTwitchUsername, parseTwitchChannelMap, sendTwitchMessage } from "../src/connectors/twitch.ts";
import { parseTodoistProjectMap, parseTodoistProjectTarget, sendTodoistTask } from "../src/connectors/todoist.ts";
import { normalizeWebexRoomId, sendWebexMessage } from "../src/connectors/webex.ts";
import { normalizeWeComWebhookUrl, sendWeComMessage } from "../src/connectors/wecom.ts";
import { pollTelegramUpdates, sendTelegramMessage } from "../src/connectors/telegram.ts";
import { handleWhatsappWebhookPayload, normalizeWhatsappRecipient, parseWhatsappWebhookMessages, sendWhatsappMessage } from "../src/connectors/whatsapp.ts";
import { normalizeZaloAccessToken, normalizeZaloUserId, parseZaloRecipientMap, sendZaloMessage } from "../src/connectors/zalo.ts";
import { normalizeZulipSiteUrl, parseZulipTargetSpec, sendZulipMessage } from "../src/connectors/zulip.ts";
import { chunkText } from "../src/utils/text.ts";
import type { AssistantHandleOptions, DingTalkConnectorConfig, DiscordConnectorConfig, EmailConnectorConfig, FeishuConnectorConfig, GenericWebhookConnectorConfig, GitHubConnectorConfig, GoogleChatConnectorConfig, HomeAssistantConnectorConfig, ImessageConnectorConfig, IrcConnectorConfig, KakaotalkConnectorConfig, LineConnectorConfig, MastodonConnectorConfig, MattermostConnectorConfig, NextcloudTalkConnectorConfig, NotionConnectorConfig, NtfyConnectorConfig, ObsidianConnectorConfig, RocketChatConnectorConfig, SignalConnectorConfig, SlackConnectorConfig, SynologyChatConnectorConfig, TeamsConnectorConfig, TelegramConnectorConfig, TodoistConnectorConfig, TwitchConnectorConfig, WeComConnectorConfig, WebexConnectorConfig, WhatsappConnectorConfig, ZaloConnectorConfig, ZulipConnectorConfig } from "../src/core/types.ts";

test("Discord input accepts DMs without prefix", () => {
  assert.equal(normalizeDiscordInput("hello", "!viser", "123", false), "hello");
});

test("Discord input requires prefix or mention in guild channels", () => {
  assert.equal(normalizeDiscordInput("hello", "!viser", "123", true), undefined);
  assert.equal(normalizeDiscordInput("!viser /help", "!viser", "123", true), "/help");
  assert.equal(normalizeDiscordInput("<@123> status", "!viser", "123", true), "status");
});

test("Slack input accepts DMs and requires prefix or mention in channels", () => {
  assert.equal(normalizeSlackInput("hello", "!viser", "U123", true), "hello");
  assert.equal(normalizeSlackInput("hello", "!viser", "U123", false), undefined);
  assert.equal(normalizeSlackInput("!viser /help", "!viser", "U123", false), "/help");
  assert.equal(normalizeSlackInput("<@U123> status", "!viser", "U123", false), "status");
});

test("chunkText respects maximum chunk length", () => {
  const chunks = chunkText("a ".repeat(500), 100);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 100));
});

test("Signal address and envelope parsing normalize signal-cli output", () => {
  assert.equal(normalizeSignalAddress("15551234567"), "+15551234567");
  assert.equal(normalizeSignalAddress("+15551234567"), "+15551234567");
  assert.equal(normalizeSignalAddress("550e8400-e29b-41d4-a716-446655440000"), "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(normalizeSignalAddress("not-a-recipient"), undefined);

  const envelopes = parseSignalEnvelopes([
    JSON.stringify({ envelope: { sourceNumber: "+15551234567", dataMessage: { message: "one" } } }),
    "progress line",
    JSON.stringify({ sourceNumber: "+15557654321", dataMessage: { message: "two" } })
  ].join("\n"));

  assert.equal(envelopes.length, 2);
});

test("iMessage handle and row parsing normalize Messages chat.db rows", () => {
  assert.equal(normalizeImessageHandle("15551234567"), "+15551234567");
  assert.equal(normalizeImessageHandle("+15551234567"), "+15551234567");
  assert.equal(normalizeImessageHandle("USER@EXAMPLE.COM"), "user@example.com");
  assert.equal(normalizeImessageHandle("not-a-handle"), undefined);

  const rows = parseImessageRows(JSON.stringify([
    { rowid: 7, handle_id: "USER@EXAMPLE.COM", chat_guid: "iMessage;-;user@example.com", text: "hello" },
    { rowid: "8", handle_id: "15557654321", text: "world" },
    { rowid: 9, handle_id: "bad", text: "ignored" }
  ]));

  assert.deepEqual(rows, [
    { rowid: 7, handleId: "user@example.com", chatGuid: "iMessage;-;user@example.com", text: "hello" },
    { rowid: 8, handleId: "+15557654321", text: "world", chatGuid: undefined }
  ]);
});

test("WhatsApp recipient and webhook parsing normalize Cloud API payloads", () => {
  assert.equal(normalizeWhatsappRecipient("15551234567"), "+15551234567");
  assert.equal(normalizeWhatsappRecipient("+15551234567"), "+15551234567");
  assert.equal(normalizeWhatsappRecipient("not-a-phone"), undefined);

  assert.deepEqual(parseWhatsappWebhookMessages({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                { id: "wamid.one", from: "15551234567", type: "text", text: { body: "hello" } },
                { id: "wamid.image", from: "15551234567", type: "image" },
                { id: "wamid.bad", from: "bad", type: "text", text: { body: "ignored" } }
              ]
            }
          }
        ]
      }
    ]
  }), [
    { id: "wamid.one", from: "+15551234567", text: "hello" }
  ]);
});

test("LINE peer, signature, and webhook parsing normalize Messaging API payloads", () => {
  const config = lineConfig();
  const body = JSON.stringify({
    events: [
      {
        type: "message",
        replyToken: "reply-token",
        source: { type: "group", groupId: "C1234567890abcdef", userId: "Uignored" },
        message: { id: "line.one", type: "text", text: "hello" }
      },
      {
        type: "message",
        source: { type: "user", userId: "bad peer" },
        message: { id: "line.bad", type: "text", text: "ignored" }
      },
      {
        type: "message",
        source: { type: "user", userId: "U1234567890abcdef" },
        message: { id: "line.image", type: "image" }
      }
    ]
  });
  const signature = createHmac("sha256", config.channelSecret ?? "").update(body).digest("base64");

  assert.equal(normalizeLinePeerId(" U1234567890abcdef "), "U1234567890abcdef");
  assert.equal(normalizeLinePeerId("bad peer"), undefined);
  assert.equal(verifyLineSignature(config, body, signature), true);
  assert.equal(verifyLineSignature(config, body, "bad-signature"), false);
  assert.deepEqual(parseLineWebhookMessages(JSON.parse(body)), [
    { id: "line.one", peerId: "C1234567890abcdef", replyToken: "reply-token", text: "hello" }
  ]);
});

test("KakaoTalk Skill payload and response parsing normalize Open Builder JSON", () => {
  assert.equal(normalizeKakaotalkUserId("bot-user-key-123"), "bot-user-key-123");
  assert.equal(normalizeKakaotalkUserId("bad user"), undefined);

  assert.deepEqual(parseKakaotalkSkillMessage({
    userRequest: {
      timezone: "Asia/Seoul",
      utterance: "안녕 Viser",
      lang: "ko",
      user: { id: "bot-user-key-123" }
    }
  }), {
    userId: "bot-user-key-123",
    utterance: "안녕 Viser",
    timezone: "Asia/Seoul",
    lang: "ko"
  });

  assert.deepEqual(kakaotalkSkillResponse("hello").template.outputs, [
    { simpleText: { text: "hello" } }
  ]);

  const config = kakaotalkConfig();
  assert.equal(verifyKakaotalkRequestToken(config, { headers: { authorization: "Bearer kakaotalk-skill-secret" } } as any), true);
  assert.equal(verifyKakaotalkRequestToken(config, { headers: { "x-viser-kakaotalk-token": "kakaotalk-skill-secret" } } as any), true);
  assert.equal(verifyKakaotalkRequestToken(config, { headers: { authorization: "Bearer wrong-token" } } as any), false);
});

test("Webhook connector aliases normalize Google Chat, generic Webhook, Home Assistant, Teams, Mattermost, Synology Chat, Rocket.Chat, Feishu, DingTalk, WeCom, Zalo, IRC, Twitch, ntfy, Mastodon, and Nextcloud Talk settings", () => {
  assert.equal(
    normalizeGoogleChatWebhookUrl("https://chat.googleapis.com/v1/spaces/AAAA/messages?key=secret-key&token=secret-token"),
    "https://chat.googleapis.com/v1/spaces/AAAA/messages?key=secret-key&token=secret-token"
  );
  assert.throws(() => normalizeGoogleChatWebhookUrl("https://example.com/hook?key=a&token=b"), /chat.googleapis.com/);
  assert.equal(normalizeTeamsWebhookUrl("https://example.webhook.office.com/webhookb2/secret").startsWith("https://"), true);
  assert.throws(() => normalizeTeamsWebhookUrl("http://example.webhook.office.com/webhookb2/secret"), /https/);
  assert.equal(normalizeMattermostWebhookUrl("https://mattermost.example.com/hooks/secret"), "https://mattermost.example.com/hooks/secret");
  assert.throws(() => normalizeMattermostWebhookUrl("https://mattermost.example.com/not-hooks/secret"), /\/hooks\//);
  assert.equal(
    normalizeSynologyChatWebhookUrl("https://synology.example.com/webapi/entry.cgi?api=SYNO.Chat.External&method=incoming&version=2&token=secret"),
    "https://synology.example.com/webapi/entry.cgi?api=SYNO.Chat.External&method=incoming&version=2&token=secret"
  );
  assert.throws(() => normalizeSynologyChatWebhookUrl("https://synology.example.com/webapi/entry.cgi?api=SYNO.Chat.External&method=outgoing&token=secret"), /method=incoming/);
  assert.equal(normalizeRocketChatWebhookUrl("https://rocket.example.com/hooks/integration/token"), "https://rocket.example.com/hooks/integration/token");
  assert.throws(() => normalizeRocketChatWebhookUrl("https://rocket.example.com/api/v1/chat.postMessage"), /\/hooks\/<integrationId>\/<token>/);
  assert.throws(() => normalizeRocketChatWebhookUrl("https://user:pass@rocket.example.com/hooks/integration/token"), /credentials/);
  assert.equal(normalizeFeishuWebhookUrl("https://open.feishu.cn/open-apis/bot/v2/hook/secret"), "https://open.feishu.cn/open-apis/bot/v2/hook/secret");
  assert.throws(() => normalizeFeishuWebhookUrl("https://example.com/open-apis/bot/v2/hook/secret"), /Feishu\/Lark/);
  assert.equal(normalizeDingTalkWebhookUrl("https://oapi.dingtalk.com/robot/send?access_token=secret"), "https://oapi.dingtalk.com/robot/send?access_token=secret");
  assert.throws(() => normalizeDingTalkWebhookUrl("https://oapi.dingtalk.com/robot/send"), /access_token/);
  assert.equal(normalizeWeComWebhookUrl("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret"), "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret");
  assert.throws(() => normalizeWeComWebhookUrl("https://qyapi.weixin.qq.com/cgi-bin/webhook/send"), /key query/);
  assert.equal(normalizeZaloAccessToken("zalo-secret-token"), "zalo-secret-token");
  assert.throws(() => normalizeZaloAccessToken("short"), /opaque token/);
  assert.equal(normalizeZaloUserId("zalo-user_123"), "zalo-user_123");
  assert.throws(() => normalizeZaloUserId("https://zalo.me/user"), /opaque OA user_id/);
  assert.deepEqual(parseZaloRecipientMap("ops=zalo-user-1,alerts=zalo-user-2"), {
    ops: "zalo-user-1",
    alerts: "zalo-user-2"
  });
  assert.equal(normalizeIrcHost("IRC.Libera.Chat"), "irc.libera.chat");
  assert.throws(() => normalizeIrcHost("irc.example.com:6697"), /plain hostname/);
  assert.equal(normalizeIrcNick("ViserBot"), "ViserBot");
  assert.throws(() => normalizeIrcNick("1bad"), /nickname/);
  assert.equal(normalizeIrcChannel("#viser"), "#viser");
  assert.throws(() => normalizeIrcChannel("viser"), /channel name/);
  assert.deepEqual(parseIrcChannelMap("ops=#viser,alerts=#alerts"), {
    ops: "#viser",
    alerts: "#alerts"
  });
  assert.equal(normalizeTwitchAccessToken("oauth:twitch-secret-token"), "twitch-secret-token");
  assert.throws(() => normalizeTwitchAccessToken("short"), /OAuth token/);
  assert.equal(normalizeTwitchUsername("@Viser_Bot"), "viser_bot");
  assert.throws(() => normalizeTwitchUsername("bad user"), /username/);
  assert.equal(normalizeTwitchChannel("ViserChannel"), "#viserchannel");
  assert.deepEqual(parseTwitchChannelMap("ops=ViserChannel,alerts=#Alerts_Channel"), {
    ops: "#viserchannel",
    alerts: "#alerts_channel"
  });
  assert.equal(normalizeNtfyBaseUrl("https://ntfy.example.com/"), "https://ntfy.example.com");
  assert.equal(normalizeNtfyBaseUrl("http://localhost:8080/"), "http://localhost:8080");
  assert.throws(() => normalizeNtfyBaseUrl("http://ntfy.example.com"), /https/);
  assert.equal(normalizeNtfyToken("ntfy-secret-token"), "ntfy-secret-token");
  assert.throws(() => normalizeNtfyToken("short"), /single opaque token/);
  assert.equal(normalizeNtfyTopicAlias("Ops-Alerts"), "ops-alerts");
  assert.throws(() => normalizeNtfyTopicAlias("../ops"), /topic alias/);
  assert.equal(parseNtfyTopicTarget("viser_ops-alerts"), "viser_ops-alerts");
  assert.throws(() => parseNtfyTopicTarget("https://ntfy.sh/viser"), /not a URL/);
  assert.deepEqual(parseNtfyTopicMap('{"Ops":"viser-ops","alerts":"viser-alerts"}'), {
    ops: "viser-ops",
    alerts: "viser-alerts"
  });
  assert.deepEqual(parseNtfyTopicMap("ops=viser-ops;alerts=viser-alerts"), {
    ops: "viser-ops",
    alerts: "viser-alerts"
  });
  assert.equal(normalizeMastodonBaseUrl("https://mastodon.example/"), "https://mastodon.example");
  assert.equal(normalizeMastodonBaseUrl("http://localhost:3000/"), "http://localhost:3000");
  assert.throws(() => normalizeMastodonBaseUrl("http://mastodon.example"), /https/);
  assert.equal(normalizeMastodonAccessToken("mastodon-secret-token"), "mastodon-secret-token");
  assert.throws(() => normalizeMastodonAccessToken("short"), /single opaque token/);
  assert.equal(normalizeMastodonTargetAlias("Ops-Status"), "ops-status");
  assert.throws(() => normalizeMastodonTargetAlias("../ops"), /target alias/);
  assert.equal(normalizeMastodonVisibility("Unlisted"), "unlisted");
  assert.throws(() => normalizeMastodonVisibility("followers"), /visibility/);
  assert.deepEqual(parseMastodonTargetMap('{"Ops":"unlisted","private":"private"}'), {
    ops: "unlisted",
    private: "private"
  });
  assert.deepEqual(parseMastodonTargetMap("ops=unlisted;public=public"), {
    ops: "unlisted",
    public: "public"
  });
  assert.equal(normalizeNextcloudTalkBaseUrl("https://cloud.example.com/"), "https://cloud.example.com");
  assert.throws(() => normalizeNextcloudTalkBaseUrl("http://cloud.example.com"), /https/);
  assert.equal(normalizeNextcloudTalkRoomToken("roomtoken_123"), "roomtoken_123");
  assert.throws(() => normalizeNextcloudTalkRoomToken("https://cloud.example.com/call/roomtoken"), /not a room URL/);
  assert.deepEqual(parseNextcloudTalkRoomMap("ops=roomtoken1,alerts=roomtoken2"), {
    ops: "roomtoken1",
    alerts: "roomtoken2"
  });
  assert.deepEqual(parseWebhookUrlMap("ops=https://chat.googleapis.com/v1/spaces/OPS/messages?key=k&token=t,alerts=https://chat.googleapis.com/v1/spaces/ALERTS/messages?key=k&token=t"), {
    ops: "https://chat.googleapis.com/v1/spaces/OPS/messages?key=k&token=t",
    alerts: "https://chat.googleapis.com/v1/spaces/ALERTS/messages?key=k&token=t"
  });
  assert.equal(normalizeGenericWebhookUrl("https://hooks.example.com/viser/token"), "https://hooks.example.com/viser/token");
  assert.throws(() => normalizeGenericWebhookUrl("http://hooks.example.com/viser/token"), /https/);
  assert.throws(() => normalizeGenericWebhookUrl("https://user:pass@hooks.example.com/viser/token"), /credentials/);
  assert.deepEqual(parseGenericWebhookUrlMap('{"Ops":"https://hooks.example.com/ops","alerts":"https://hooks.example.com/alerts"}'), {
    ops: "https://hooks.example.com/ops",
    alerts: "https://hooks.example.com/alerts"
  });
  assert.deepEqual(parseGenericWebhookUrlMap("ops=https://hooks.example.com/ops;alerts=https://hooks.example.com/alerts"), {
    ops: "https://hooks.example.com/ops",
    alerts: "https://hooks.example.com/alerts"
  });
  assert.equal(normalizeHomeAssistantBaseUrl("http://127.0.0.1:8123/"), "http://127.0.0.1:8123");
  assert.equal(normalizeHomeAssistantBaseUrl("https://ha.example.com/hass/"), "https://ha.example.com/hass");
  assert.throws(() => normalizeHomeAssistantBaseUrl("http://ha.example.com"), /https/);
  assert.equal(normalizeHomeAssistantAccessToken("homeassistant-secret-token"), "homeassistant-secret-token");
  assert.throws(() => normalizeHomeAssistantAccessToken("short"), /opaque bearer token/);
  assert.equal(normalizeHomeAssistantServiceSpec("light.turn_on"), "light.turn_on");
  assert.throws(() => normalizeHomeAssistantServiceSpec("Light.turn-on"), /domain.service/);
  assert.deepEqual(parseHomeAssistantServiceMap("Lights=light.turn_on;notify=notify.persistent_notification"), {
    lights: "light.turn_on",
    notify: "notify.persistent_notification"
  });
  assert.deepEqual(normalizeHomeAssistantPayload("hello"), { message: "hello" });
  assert.deepEqual(normalizeHomeAssistantPayload('{"entity_id":"light.study"}'), { entity_id: "light.study" });
});

test("Home Assistant service calls post bearer-authenticated JSON payloads and redact failures", async () => {
  const calls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
  const config = homeAssistantConfig();
  await callHomeAssistantService(config, "default", "hello home", {
    fetchImpl: async (input, init) => {
      calls.push({
        url: String(input),
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body ?? "{}"))
      });
      return new Response("[]", { status: 200 });
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "http://127.0.0.1:8123/api/services/notify/persistent_notification");
  assert.equal(calls[0]?.headers.authorization, "Bearer homeassistant-secret-token");
  assert.equal(calls[0]?.headers["content-type"], "application/json");
  assert.deepEqual(calls[0]?.body, { message: "hello home" });

  calls.length = 0;
  await callHomeAssistantService({ ...config, services: { lights: "light.turn_on" } }, "lights", '{"entity_id":"light.study"}', {
    fetchImpl: async (input, init) => {
      calls.push({
        url: String(input),
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body ?? "{}"))
      });
      return new Response("[]", { status: 200 });
    }
  });
  assert.equal(calls[0]?.url, "http://127.0.0.1:8123/api/services/light/turn_on");
  assert.deepEqual(calls[0]?.body, { entity_id: "light.study" });

  await assert.rejects(
    () => callHomeAssistantService(config, "default", "secret payload", {
      fetchImpl: async () => new Response("homeassistant-secret-token http://127.0.0.1:8123 notify.persistent_notification default secret payload", {
        status: 401,
        statusText: "Unauthorized"
      })
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED\]/);
      assert.doesNotMatch(error.message, /homeassistant-secret-token|127\.0\.0\.1|notify\.persistent_notification|default|secret payload/);
      return true;
    }
  );
});

test("Webex room IDs accept opaque IDs and reject URLs", () => {
  assert.equal(normalizeWebexRoomId(" Y2lzY29zcGFyazovL3VzL1JPT00vc21va2U "), "Y2lzY29zcGFyazovL3VzL1JPT00vc21va2U");
  assert.throws(() => normalizeWebexRoomId("https://webexapis.com/v1/messages"), /opaque Webex roomId/);
});

test("Zulip site URLs and target specs normalize safe outbound destinations", () => {
  assert.equal(normalizeZulipSiteUrl(" https://viser.zulipchat.com/ "), "https://viser.zulipchat.com");
  assert.throws(() => normalizeZulipSiteUrl("http://viser.zulipchat.com"), /https/);
  assert.deepEqual(parseZulipTargetSpec("stream:operations:alerts"), { kind: "stream", to: "operations", topic: "alerts" });
  assert.deepEqual(parseZulipTargetSpec("direct:user@example.com|12345"), { kind: "direct", to: ["user@example.com", 12345] });
  assert.throws(() => parseZulipTargetSpec("stream:operations"), /topic/);
});

test("Email recipient aliases normalize safe outbound destinations", () => {
  assert.deepEqual(parseEmailRecipientMap("Ops=ops@example.com; alerts=alerts@example.com"), {
    ops: "ops@example.com",
    alerts: "alerts@example.com"
  });
  assert.throws(() => parseEmailRecipientMap("bad alias=ops@example.com"), /target id/);
  assert.throws(() => parseEmailRecipientMap("ops=bad address"), /single plain|valid/);
});

test("ConnectorRateLimiter limits each peer inside a rolling minute", () => {
  let now = 1_000;
  const limiter = new ConnectorRateLimiter(1, { now: () => now });

  assert.deepEqual(limiter.check("telegram:123"), { allowed: true, retryAfterMs: 0 });
  const denied = limiter.check("telegram:123");
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterMs, 60_000);
  assert.deepEqual(limiter.check("telegram:456"), { allowed: true, retryAfterMs: 0 });

  now += 60_001;
  assert.deepEqual(limiter.check("telegram:123"), { allowed: true, retryAfterMs: 0 });
});

test("pollTelegramUpdates advances offsets even when one update delivery fails", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const calls: string[] = [];
  const logged: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/getUpdates")) {
      return new Response(JSON.stringify({
        ok: true,
        result: [
          {
            update_id: 41,
            message: {
              message_id: 1,
              text: "hello",
              chat: { id: 123, type: "private" },
              from: { id: 7, username: "demo_user" }
            }
          }
        ]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: false, result: null, description: "send failed" }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
  console.error = (message?: unknown) => {
    logged.push(String(message));
  };

  try {
    const nextOffset = await pollTelegramUpdates("token", telegramConfig(), fakeAssistant(), 0);
    assert.equal(nextOffset, 42);
    assert.equal(calls.filter((url) => url.includes("/getUpdates")).length, 1);
    assert.equal(calls.filter((url) => url.includes("/sendMessage")).length, 2);
    assert.match(logged.join("\n"), /Telegram update 41 failed/);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test("pollTelegramUpdates applies per-chat rate limits before invoking the assistant", async () => {
  const originalFetch = globalThis.fetch;
  const sentTexts: string[] = [];
  let assistantCalls = 0;
  const limiter = new ConnectorRateLimiter(1, { now: () => 1_000 });

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/getUpdates")) {
      return new Response(JSON.stringify({
        ok: true,
        result: [
          {
            update_id: 41,
            message: {
              message_id: 1,
              text: "first",
              chat: { id: 123, type: "private" },
              from: { id: 7, username: "demo_user" }
            }
          },
          {
            update_id: 42,
            message: {
              message_id: 2,
              text: "second",
              chat: { id: 123, type: "private" },
              from: { id: 7, username: "demo_user" }
            }
          }
        ]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.includes("/sendMessage")) {
      sentTexts.push(String(JSON.parse(String(init?.body)).text));
      return new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as typeof fetch;

  try {
    const nextOffset = await pollTelegramUpdates("token", telegramConfig(), {
      async handle(_input: string, _sessionId: string, _options?: AssistantHandleOptions): Promise<string> {
        assistantCalls += 1;
        return "answer";
      }
    } as any, 0, undefined, limiter);

    assert.equal(nextOffset, 43);
    assert.equal(assistantCalls, 1);
    assert.deepEqual(sentTexts, [
      "answer",
      "Viser rate limit: too many messages from this chat/channel. Try again in 60s."
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pollTelegramUpdates rejects oversized chat input before invoking the assistant", async () => {
  const originalFetch = globalThis.fetch;
  const sentTexts: string[] = [];
  let assistantCalls = 0;
  const config = { ...telegramConfig(), maxInputChars: 5 };

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/getUpdates")) {
      return new Response(JSON.stringify({
        ok: true,
        result: [
          {
            update_id: 51,
            message: {
              message_id: 1,
              text: "too long",
              chat: { id: 123, type: "private" },
              from: { id: 7, username: "demo_user" }
            }
          }
        ]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.includes("/sendMessage")) {
      sentTexts.push(String(JSON.parse(String(init?.body)).text));
      return new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as typeof fetch;

  try {
    const nextOffset = await pollTelegramUpdates("token", config, {
      async handle(_input: string, _sessionId: string, _options?: AssistantHandleOptions): Promise<string> {
        assistantCalls += 1;
        return "answer";
      }
    } as any, 0);

    assert.equal(nextOffset, 52);
    assert.equal(assistantCalls, 0);
    assert.deepEqual(sentTexts, [
      "Viser input limit: messages from this connector must be 5 characters or fewer. Please shorten the message and try again."
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pollTelegramUpdates honors default chats when an allowlist also exists without access store", async () => {
  const originalFetch = globalThis.fetch;
  const sentTexts: string[] = [];
  let assistantCalls = 0;
  const config = { ...telegramConfig(), allowedChatIds: ["999"], defaultChatIds: ["123"] };

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/getUpdates")) {
      return new Response(JSON.stringify({
        ok: true,
        result: [
          {
            update_id: 61,
            message: {
              message_id: 1,
              text: "hello",
              chat: { id: 123, type: "private" },
              from: { id: 7, username: "demo_user" }
            }
          }
        ]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.includes("/sendMessage")) {
      sentTexts.push(String(JSON.parse(String(init?.body)).text));
      return new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as typeof fetch;

  try {
    const nextOffset = await pollTelegramUpdates("token", config, {
      async handle(_input: string, _sessionId: string, _options?: AssistantHandleOptions): Promise<string> {
        assistantCalls += 1;
        return "answer";
      }
    } as any, 0);

    assert.equal(nextOffset, 62);
    assert.equal(assistantCalls, 1);
    assert.deepEqual(sentTexts, ["answer"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendTelegramMessage times out stalled Bot API calls", async () => {
  await assert.rejects(
    () => sendTelegramMessage("123456:telegram-secret-token", "123", "hello", {
      fetchImpl: hangingFetch(),
      timeoutMs: 5
    }),
    /fetch timed out after 5ms/
  );
});

test("handleDiscordMessage applies per-channel rate limits before invoking the assistant", async () => {
  const originalFetch = globalThis.fetch;
  const sentTexts: string[] = [];
  let assistantCalls = 0;
  const limiter = new ConnectorRateLimiter(1, { now: () => 1_000 });
  const config = discordConfig();

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentTexts.push(String(JSON.parse(String(init?.body)).content));
    return new Response("", { status: 200 });
  }) as typeof fetch;

  try {
    const assistant = {
      async handle(_input: string, _sessionId: string, _options?: AssistantHandleOptions): Promise<string> {
        assistantCalls += 1;
        return "answer";
      }
    } as any;

    await handleDiscordMessage("discord-secret-token", config, assistant, {
      id: "m1",
      channel_id: "channel-1",
      content: "first",
      author: { id: "user-1", username: "demo_user" }
    }, "bot-1", undefined, limiter);
    await handleDiscordMessage("discord-secret-token", config, assistant, {
      id: "m2",
      channel_id: "channel-1",
      content: "second",
      author: { id: "user-1", username: "demo_user" }
    }, "bot-1", undefined, limiter);

    assert.equal(assistantCalls, 1);
    assert.deepEqual(sentTexts, [
      "answer",
      "Viser rate limit: too many messages from this chat/channel. Try again in 60s."
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleDiscordMessage rejects oversized channel input before invoking the assistant", async () => {
  const originalFetch = globalThis.fetch;
  const sentTexts: string[] = [];
  let assistantCalls = 0;
  const config = { ...discordConfig(), maxInputChars: 5 };

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentTexts.push(String(JSON.parse(String(init?.body)).content));
    return new Response("", { status: 200 });
  }) as typeof fetch;

  try {
    await handleDiscordMessage("discord-secret-token", config, {
      async handle(_input: string, _sessionId: string, _options?: AssistantHandleOptions): Promise<string> {
        assistantCalls += 1;
        return "answer";
      }
    } as any, {
      id: "m1",
      channel_id: "channel-1",
      content: "too long",
      author: { id: "user-1", username: "demo_user" }
    }, "bot-1");

    assert.equal(assistantCalls, 0);
    assert.deepEqual(sentTexts, [
      "Viser input limit: messages from this connector must be 5 characters or fewer. Please shorten the message and try again."
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleDiscordMessage honors default channels when an allowlist also exists", async () => {
  const originalFetch = globalThis.fetch;
  const sentTexts: string[] = [];
  let assistantCalls = 0;
  const config = { ...discordConfig(), allowedChannelIds: ["other-channel"], defaultChannelIds: ["channel-1"] };
  const access = {
    async isAllowed(_connector: string, _targetId: string, staticAllowlist: string[]): Promise<boolean> {
      assert.deepEqual(staticAllowlist, ["other-channel", "channel-1"]);
      return staticAllowlist.includes("channel-1");
    }
  };

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentTexts.push(String(JSON.parse(String(init?.body)).content));
    return new Response("", { status: 200 });
  }) as typeof fetch;

  try {
    await handleDiscordMessage("discord-secret-token", config, {
      async handle(_input: string, _sessionId: string, _options?: AssistantHandleOptions): Promise<string> {
        assistantCalls += 1;
        return "answer";
      }
    } as any, {
      id: "m1",
      channel_id: "channel-1",
      content: "hello",
      author: { id: "user-1", username: "demo_user" }
    }, "bot-1", access as any);

    assert.equal(assistantCalls, 1);
    assert.deepEqual(sentTexts, ["answer"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendDiscordMessage redacts bot tokens from REST errors", async () => {
  const token = "discord-secret-token";

  await assert.rejects(
    () => sendDiscordMessage(token, "channel", "hello", {
      fetchImpl: async () => new Response(`invalid Bot ${token}`, { status: 401 }),
      timeoutMs: 5
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /discord-secret-token/);
      return true;
    }
  );
});

test("sendDiscordMessage times out stalled REST calls", async () => {
  await assert.rejects(
    () => sendDiscordMessage("discord-secret-token", "channel", "hello", {
      fetchImpl: hangingFetch(),
      timeoutMs: 5
    }),
    /fetch timed out after 5ms/
  );
});

test("handleSlackEvent applies per-channel rate limits before invoking the assistant", async () => {
  const originalFetch = globalThis.fetch;
  const sentTexts: string[] = [];
  let assistantCalls = 0;
  const limiter = new ConnectorRateLimiter(1, { now: () => 1_000 });
  const config = slackConfig();

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentTexts.push(String(JSON.parse(String(init?.body)).text));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const assistant = {
      async handle(_input: string, _sessionId: string, _options?: AssistantHandleOptions): Promise<string> {
        assistantCalls += 1;
        return "answer";
      }
    } as any;

    await handleSlackEvent("xoxb-slack-secret-token", config, assistant, {
      type: "message",
      channel: "C123456",
      channel_type: "channel",
      text: "!viser first",
      user: "U123"
    }, undefined, limiter);
    await handleSlackEvent("xoxb-slack-secret-token", config, assistant, {
      type: "message",
      channel: "C123456",
      channel_type: "channel",
      text: "!viser second",
      user: "U123"
    }, undefined, limiter);

    assert.equal(assistantCalls, 1);
    assert.deepEqual(sentTexts, [
      "answer",
      "Viser rate limit: too many messages from this chat/channel. Try again in 60s."
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleSlackEvent rejects oversized channel input before invoking the assistant", async () => {
  const originalFetch = globalThis.fetch;
  const sentTexts: string[] = [];
  let assistantCalls = 0;
  const config = { ...slackConfig(), maxInputChars: 5 };

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentTexts.push(String(JSON.parse(String(init?.body)).text));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    await handleSlackEvent("xoxb-slack-secret-token", config, {
      async handle(_input: string, _sessionId: string, _options?: AssistantHandleOptions): Promise<string> {
        assistantCalls += 1;
        return "answer";
      }
    } as any, {
      type: "message",
      channel: "C123456",
      channel_type: "channel",
      text: "!viser too long",
      user: "U123"
    });

    assert.equal(assistantCalls, 0);
    assert.deepEqual(sentTexts, [
      "Viser input limit: messages from this connector must be 5 characters or fewer. Please shorten the message and try again."
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendSlackMessage redacts bot tokens from Web API errors", async () => {
  const token = "xoxb-slack-secret-token";

  await assert.rejects(
    () => sendSlackMessage(token, "C123456", "hello", {
      fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: `invalid_auth ${token}` }), {
        status: 200,
        headers: { "content-type": "application/json" }
      }),
      timeoutMs: 5
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /xoxb-slack-secret-token/);
      return true;
    }
  );
});

test("sendSlackMessage times out stalled Web API calls", async () => {
  await assert.rejects(
    () => sendSlackMessage("xoxb-slack-secret-token", "C123456", "hello", {
      fetchImpl: hangingFetch(),
      timeoutMs: 5
    }),
    /fetch timed out after 5ms/
  );
});

test("handleSignalEnvelope routes allowed messages through the assistant and signal-cli send", async () => {
  const sentTexts: string[] = [];
  let assistantCalls = 0;

  await handleSignalEnvelope(
    { ...signalConfig(), allowedRecipientIds: ["+15551234567"] },
    {
      async handle(input: string, sessionId: string, options?: AssistantHandleOptions): Promise<string> {
        assistantCalls += 1;
        assert.equal(input, "hello");
        assert.equal(sessionId, "signal:+15551234567");
        assert.equal(options?.source, "signal");
        return "answer";
      }
    } as any,
    { envelope: { sourceNumber: "15551234567", dataMessage: { message: "hello" } } },
    undefined,
    undefined,
    { runner: async (options) => {
      sentTexts.push(String(options.args[options.args.indexOf("-m") + 1] ?? ""));
      return commandResult();
    } }
  );

  assert.equal(assistantCalls, 1);
  assert.deepEqual(sentTexts, ["answer"]);
});

test("sendSignalMessage redacts account, recipient, and body from signal-cli errors", async () => {
  const config = signalConfig();

  await assert.rejects(
    () => sendSignalMessage(config, "+15551234567", "hello secret body", {
      runner: async (options) => commandResult(`failed ${options.args.join(" ")}`, 1)
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /\+15550000000|\+15551234567|hello secret body/);
      return true;
    }
  );
});

test("handleImessageMessage routes allowed handles through the assistant and local osascript send", async () => {
  const sentTexts: string[] = [];
  let assistantCalls = 0;

  await handleImessageMessage(
    { ...imessageConfig(), allowedHandleIds: ["user@example.com"] },
    {
      async handle(input: string, sessionId: string, options?: AssistantHandleOptions): Promise<string> {
        assistantCalls += 1;
        assert.equal(input, "hello");
        assert.equal(sessionId, "imessage:user@example.com");
        assert.equal(options?.source, "imessage");
        return "answer";
      }
    } as any,
    { rowid: 1, handleId: "USER@EXAMPLE.COM", text: "hello" },
    undefined,
    undefined,
    { runner: async (options) => {
      sentTexts.push(String(options.args.at(-1) ?? ""));
      return commandResult();
    } }
  );

  assert.equal(assistantCalls, 1);
  assert.deepEqual(sentTexts, ["answer"]);
});

test("sendImessageMessage redacts recipient, body, and chat database path from osascript errors", async () => {
  const config = imessageConfig();

  await assert.rejects(
    () => sendImessageMessage(config, "user@example.com", "hello secret body", {
      runner: async (options) => commandResult(`failed ${config.chatDbPath} ${options.args.join(" ")}`, 1)
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /user@example.com|hello secret body|\/tmp\/viser-imessage-chat\.db/);
      return true;
    }
  );
});

test("handleWhatsappWebhookPayload routes allowed messages through assistant and Graph API send", async () => {
  const sentTexts: string[] = [];
  let assistantCalls = 0;

  const count = await handleWhatsappWebhookPayload(
    { ...whatsappConfig(), allowedRecipientIds: ["+15551234567"] },
    {
      async handle(input: string, sessionId: string, options?: AssistantHandleOptions): Promise<string> {
        assistantCalls += 1;
        assert.equal(input, "hello");
        assert.equal(sessionId, "whatsapp:+15551234567");
        assert.equal(options?.source, "whatsapp");
        return "answer";
      }
    } as any,
    {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { id: "wamid.one", from: "15551234567", type: "text", text: { body: "hello" } }
                ]
              }
            }
          ]
        }
      ]
    },
    undefined,
    undefined,
    {
      fetchImpl: async (_input, init) => {
        const payload = JSON.parse(String(init?.body ?? "{}")) as { text?: { body?: string } };
        sentTexts.push(String(payload.text?.body ?? ""));
        return new Response(JSON.stringify({ messages: [{ id: "wamid.reply" }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    }
  );

  assert.equal(count, 1);
  assert.equal(assistantCalls, 1);
  assert.deepEqual(sentTexts, ["answer"]);
});

test("handleLineWebhookPayload routes allowed messages through assistant and Messaging API reply", async () => {
  const sentTexts: string[] = [];
  let assistantCalls = 0;

  const count = await handleLineWebhookPayload(
    { ...lineConfig(), allowedPeerIds: ["U1234567890abcdef"] },
    {
      async handle(input: string, sessionId: string, options?: AssistantHandleOptions): Promise<string> {
        assistantCalls += 1;
        assert.equal(input, "hello");
        assert.equal(sessionId, "line:U1234567890abcdef");
        assert.equal(options?.source, "line");
        return "answer";
      }
    } as any,
    {
      events: [
        {
          type: "message",
          replyToken: "line-reply-token",
          source: { type: "user", userId: "U1234567890abcdef" },
          message: { id: "line.one", type: "text", text: "hello" }
        }
      ]
    },
    undefined,
    undefined,
    {
      fetchImpl: async (_input, init) => {
        const payload = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ text?: string }> };
        sentTexts.push(String(payload.messages?.[0]?.text ?? ""));
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    }
  );

  assert.equal(count, 1);
  assert.equal(assistantCalls, 1);
  assert.deepEqual(sentTexts, ["answer"]);
});

test("handleKakaotalkSkillPayload routes allowed Open Builder skill calls through assistant", async () => {
  let assistantCalls = 0;

  const response = await handleKakaotalkSkillPayload(
    { ...kakaotalkConfig(), allowedUserIds: ["bot-user-key-123"] },
    {
      async handle(input: string, sessionId: string, options?: AssistantHandleOptions): Promise<string> {
        assistantCalls += 1;
        assert.equal(input, "안녕");
        assert.equal(sessionId, "kakaotalk:bot-user-key-123");
        assert.equal(options?.source, "kakaotalk");
        return "카카오톡 응답";
      }
    } as any,
    {
      userRequest: {
        utterance: "안녕",
        user: { id: "bot-user-key-123" }
      }
    }
  );

  assert.equal(assistantCalls, 1);
  assert.equal(response.version, "2.0");
  assert.deepEqual(response.template.outputs, [
    { simpleText: { text: "카카오톡 응답" } }
  ]);
});

test("sendWhatsappMessage redacts token, phone number ID, recipient, and body from Graph API errors", async () => {
  const config = whatsappConfig();

  await assert.rejects(
    () => sendWhatsappMessage(config, "+15551234567", "hello secret body", {
      fetchImpl: async (_input, init) => new Response(JSON.stringify({
        error: { message: `bad ${config.accessToken} ${config.phoneNumberId} ${JSON.parse(String(init?.body)).to} hello secret body` }
      }), {
        status: 401,
        statusText: "Unauthorized",
        headers: { "content-type": "application/json" }
      })
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /whatsapp-secret-token|12345|\+15551234567|15551234567|hello secret body/);
      return true;
    }
  );
});

test("sendLinePushMessage posts text and redacts token, peer, secret, and body from Messaging API errors", async () => {
  const config = lineConfig();
  const sentTexts: string[] = [];

  await sendLinePushMessage(config, "U1234567890abcdef", "hello line", {
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://api.line.me/v2/bot/message/push");
      assert.equal((init?.headers as Record<string, string>).authorization, "Bearer line-secret-token");
      const payload = JSON.parse(String(init?.body ?? "{}")) as { to?: string; messages?: Array<{ text?: string }> };
      assert.equal(payload.to, "U1234567890abcdef");
      sentTexts.push(String(payload.messages?.[0]?.text ?? ""));
      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.deepEqual(sentTexts, ["hello line"]);

  await assert.rejects(
    () => sendLinePushMessage(config, "U1234567890abcdef", "line secret body", {
      fetchImpl: async (_input) => new Response(`bad ${config.channelAccessToken} ${config.channelSecret} U1234567890abcdef line secret body`, {
        status: 401,
        statusText: "Unauthorized"
      })
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /line-secret-token|line-channel-secret|U1234567890abcdef|line secret body/);
      return true;
    }
  );
});

test("sendGoogleChatMessage posts text and redacts webhook URL, alias, and body from errors", async () => {
  const config = googleChatConfig();
  const sentTexts: string[] = [];

  await sendGoogleChatMessage(config, "default", "hello google chat", {
    fetchImpl: async (_input, init) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
      sentTexts.push(String(payload.text ?? ""));
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.deepEqual(sentTexts, ["hello google chat"]);

  await assert.rejects(
    () => sendGoogleChatMessage(config, "default", "google secret body", {
      fetchImpl: async (input) => new Response(`bad ${String(input)} default google secret body`, { status: 403, statusText: "Forbidden" })
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /google-secret-key|google-secret-token|default|google secret body/);
      return true;
    }
  );
});

test("sendGenericWebhookMessage posts generic JSON and redacts webhook URL, alias, and body from errors", async () => {
  const config = genericWebhookConfig();
  const sentPayloads: Array<{ source?: string; text?: string; sentAt?: string }> = [];

  await sendGenericWebhookMessage(config, "default", "hello generic webhook", {
    fetchImpl: async (_input, init) => {
      assert.equal((init?.headers as Record<string, string>)["content-type"], "application/json; charset=UTF-8");
      const payload = JSON.parse(String(init?.body ?? "{}")) as { source?: string; text?: string; sentAt?: string };
      sentPayloads.push(payload);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(sentPayloads.length, 1);
  assert.deepEqual(sentPayloads.map((payload) => ({ source: payload.source, text: payload.text })), [
    { source: "viser", text: "hello generic webhook" }
  ]);
  assert.ok(sentPayloads[0]?.sentAt);

  await assert.rejects(
    () => sendGenericWebhookMessage(config, "default", "generic webhook secret body", {
      fetchImpl: async (input) => new Response(`bad ${String(input)} default generic webhook secret body`, { status: 403, statusText: "Forbidden" })
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /generic-secret|default|generic webhook secret body/);
      return true;
    }
  );
});

test("handleGenericWebhookInbound routes bounded JSON text to a webhook session", async () => {
  const config = genericWebhookConfig();
  assert.equal(normalizeGenericWebhookInboundToken("abcdefghijklmnopqrstuvwxyz"), "abcdefghijklmnopqrstuvwxyz");
  assert.equal(normalizeGenericWebhookInboundPath("/webhook/viser"), "/webhook/viser");
  assert.throws(() => normalizeGenericWebhookInboundPath("/chat.json"), /must not overlap/);

  const calls: Array<{ prompt: string; sessionId: string; source?: string; providerId?: string }> = [];
  const result = await handleGenericWebhookInbound(config, {
    source: "Ops_System",
    text: "summarize incident queue",
    providerId: "gemini"
  }, {
    async handle(prompt: string, sessionId: string, options?: { source?: string; providerId?: string }) {
      calls.push({ prompt, sessionId, source: options?.source, providerId: options?.providerId });
      return "ack";
    }
  } as never);

  assert.deepEqual(result, { sessionId: "webhook:ops_system", sourceId: "ops_system", attachmentCount: 0, reply: "ack" });
  assert.deepEqual(calls, [{ prompt: "summarize incident queue", sessionId: "webhook:ops_system", source: "webhook", providerId: "gemini" }]);
  await assert.rejects(
    () => handleGenericWebhookInbound(config, { source: "ops", text: "x".repeat(5000) }, { async handle() { return "no"; } } as never),
    /4000 characters or fewer/
  );
});

test("handleGenericWebhookInbound adds bounded attachment metadata and text without fetching files", async () => {
  const config = genericWebhookConfig();
  const calls: Array<{ prompt: string; sessionId: string }> = [];
  const result = await handleGenericWebhookInbound(config, {
    source: "ops",
    text: "summarize attached incident context",
    attachments: [
      {
        name: "incident.png",
        type: "image/png",
        url: "https://files.example.com/incidents/123.png",
        sizeBytes: 12345,
        text: "Screenshot OCR: database queue is red"
      },
      {
        filename: "runbook.txt",
        mimeType: "text/plain",
        description: "Restart only after draining workers."
      }
    ]
  }, {
    async handle(prompt: string, sessionId: string) {
      calls.push({ prompt, sessionId });
      return "ack";
    }
  } as never);

  assert.equal(result.attachmentCount, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.sessionId, "webhook:ops");
  assert.match(calls[0]?.prompt ?? "", /summarize attached incident context/);
  assert.match(calls[0]?.prompt ?? "", /metadata\/text only; Viser did not download or verify files/);
  assert.match(calls[0]?.prompt ?? "", /name=incident\.png; type=image\/png; sizeBytes=12345/);
  assert.match(calls[0]?.prompt ?? "", /https:\/\/files\.example\.com\/incidents\/123\.png/);
  assert.match(calls[0]?.prompt ?? "", /Screenshot OCR: database queue is red/);
  assert.match(calls[0]?.prompt ?? "", /name=runbook\.txt; type=text\/plain/);

  calls.length = 0;
  const attachmentOnly = await handleGenericWebhookInbound(config, {
    source: "ops",
    attachments: [{ name: "voice-note.txt", text: "Transcribed voice note." }]
  }, {
    async handle(prompt: string, sessionId: string) {
      calls.push({ prompt, sessionId });
      return "ack";
    }
  } as never);
  assert.equal(attachmentOnly.attachmentCount, 1);
  assert.match(calls[0]?.prompt ?? "", /Review the inbound webhook attachment context/);
  assert.match(calls[0]?.prompt ?? "", /Transcribed voice note/);

  await assert.rejects(
    () => handleGenericWebhookInbound(config, { text: "x", attachments: [{ url: "http://files.example.com/plain.png" }] }, { async handle() { return "no"; } } as never),
    /credential-free https:\/\/ URL/
  );
  await assert.rejects(
    () => handleGenericWebhookInbound(config, { text: "x", attachments: [{ text: "y".repeat(2100) }] }, { async handle() { return "no"; } } as never),
    /attachment 1 text must be 2000 characters or fewer/
  );
  await assert.rejects(
    () => handleGenericWebhookInbound(config, { text: "x", attachments: [{}, {}, {}, {}, {}, {}] }, { async handle() { return "no"; } } as never),
    /at most 5 attachments/
  );
});

test("sendTeamsMessage posts adaptive card text and redacts webhook URL, alias, and body from errors", async () => {
  const config = teamsConfig();
  const sentTexts: string[] = [];

  await sendTeamsMessage(config, "default", "hello teams", {
    fetchImpl: async (_input, init) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { attachments?: Array<{ content?: { body?: Array<{ text?: string }> } }> };
      sentTexts.push(String(payload.attachments?.[0]?.content?.body?.[0]?.text ?? ""));
      return new Response("1", { status: 200, headers: { "content-type": "text/plain" } });
    }
  });
  assert.deepEqual(sentTexts, ["hello teams"]);

  await assert.rejects(
    () => sendTeamsMessage(config, "default", "teams secret body", {
      fetchImpl: async (input) => new Response(`bad ${String(input)} default teams secret body`, { status: 403, statusText: "Forbidden" })
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /teams-secret|default|teams secret body/);
      return true;
    }
  );
});

test("sendMattermostMessage posts text and redacts webhook URL, alias, and body from errors", async () => {
  const config = mattermostConfig();
  const sentTexts: string[] = [];

  await sendMattermostMessage(config, "default", "hello mattermost", {
    fetchImpl: async (_input, init) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
      sentTexts.push(String(payload.text ?? ""));
      return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
    }
  });
  assert.deepEqual(sentTexts, ["hello mattermost"]);

  await assert.rejects(
    () => sendMattermostMessage(config, "default", "mattermost secret body", {
      fetchImpl: async (input) => new Response(`bad ${String(input)} default mattermost secret body`, { status: 403, statusText: "Forbidden" })
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /mattermost-secret|default|mattermost secret body/);
      return true;
    }
  );
});

test("sendSynologyChatMessage posts form payload and redacts webhook URL, alias, and body from errors", async () => {
  const config = synologyChatConfig();
  const sentTexts: string[] = [];

  await sendSynologyChatMessage(config, "default", "hello synology", {
    fetchImpl: async (_input, init) => {
      const params = new URLSearchParams(String(init?.body ?? ""));
      const payload = JSON.parse(params.get("payload") ?? "{}") as { text?: string };
      sentTexts.push(String(payload.text ?? ""));
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.deepEqual(sentTexts, ["hello synology"]);

  await assert.rejects(
    () => sendSynologyChatMessage(config, "default", "synology secret body", {
      fetchImpl: async (input) => new Response(`bad ${String(input)} default synology secret body`, { status: 403, statusText: "Forbidden" })
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /synology-secret|default|synology secret body/);
      return true;
    }
  );
});

test("sendRocketChatMessage posts text and redacts webhook URL, alias, and body from errors", async () => {
  const config = rocketChatConfig();
  const sentTexts: string[] = [];

  await sendRocketChatMessage(config, "default", "hello rocket chat", {
    fetchImpl: async (_input, init) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
      sentTexts.push(String(payload.text ?? ""));
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.deepEqual(sentTexts, ["hello rocket chat"]);

  await assert.rejects(
    () => sendRocketChatMessage(config, "default", "rocket chat secret body", {
      fetchImpl: async (input) => new Response(`bad ${String(input)} default rocket chat secret body`, { status: 403, statusText: "Forbidden" })
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /rocket-secret|default|rocket chat secret body/);
      return true;
    }
  );
});

test("sendFeishuMessage posts custom bot text and redacts webhook URL, alias, and body from errors", async () => {
  const config = feishuConfig();
  const sentTexts: string[] = [];

  await sendFeishuMessage(config, "default", "hello feishu", {
    fetchImpl: async (_input, init) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { content?: { text?: string } };
      sentTexts.push(String(payload.content?.text ?? ""));
      return new Response(JSON.stringify({ code: 0, msg: "success" }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.deepEqual(sentTexts, ["hello feishu"]);

  await assert.rejects(
    () => sendFeishuMessage(config, "default", "feishu secret body", {
      fetchImpl: async (input) => new Response(`bad ${String(input)} default feishu secret body`, { status: 403, statusText: "Forbidden" })
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /feishu-secret|default|feishu secret body/);
      return true;
    }
  );
});

test("sendDingTalkMessage posts custom robot text and redacts webhook URL, alias, and body from API errors", async () => {
  const config = dingTalkConfig();
  const sentTexts: string[] = [];

  await sendDingTalkMessage(config, "default", "hello dingtalk", {
    fetchImpl: async (_input, init) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { text?: { content?: string } };
      sentTexts.push(String(payload.text?.content ?? ""));
      return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.deepEqual(sentTexts, ["hello dingtalk"]);

  await assert.rejects(
    () => sendDingTalkMessage(config, "default", "dingtalk secret body", {
      fetchImpl: async (input) => new Response(JSON.stringify({ errcode: 310000, errmsg: `bad ${String(input)} default dingtalk secret body` }), { status: 200, statusText: "OK" })
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /dingtalk-secret|default|dingtalk secret body/);
      return true;
    }
  );
});

test("sendWeComMessage posts group robot text and redacts webhook URL, alias, and body from API errors", async () => {
  const config = weComConfig();
  const sentTexts: string[] = [];

  await sendWeComMessage(config, "default", "hello wecom", {
    fetchImpl: async (_input, init) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { text?: { content?: string } };
      sentTexts.push(String(payload.text?.content ?? ""));
      return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.deepEqual(sentTexts, ["hello wecom"]);

  await assert.rejects(
    () => sendWeComMessage(config, "default", "wecom secret body", {
      fetchImpl: async (input) => new Response(JSON.stringify({ errcode: 40013, errmsg: `bad ${String(input)} default wecom secret body` }), { status: 200, statusText: "OK" })
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /wecom-secret|default|wecom secret body/);
      return true;
    }
  );
});

test("sendZaloMessage posts OA text and redacts token, alias, recipient, and body from API errors", async () => {
  const config = zaloConfig();
  const sentTexts: string[] = [];

  await sendZaloMessage(config, "default", "hello zalo", {
    fetchImpl: async (_input, init) => {
      assert.equal((init?.headers as Record<string, string>).access_token, "zalo-secret-token");
      const payload = JSON.parse(String(init?.body ?? "{}")) as { recipient?: { user_id?: string }; message?: { text?: string } };
      assert.equal(payload.recipient?.user_id, "zalo-user-1");
      sentTexts.push(String(payload.message?.text ?? ""));
      return new Response(JSON.stringify({ error: 0, message: "Success" }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.deepEqual(sentTexts, ["hello zalo"]);

  await assert.rejects(
    () => sendZaloMessage(config, "default", "zalo secret body", {
      fetchImpl: async () => new Response(JSON.stringify({ error: -201, message: "bad zalo-secret-token zalo-user-1 default zalo secret body" }), { status: 200, statusText: "OK" })
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /zalo-secret-token|zalo-user-1|default|zalo secret body/);
      return true;
    }
  );
});

test("sendIrcMessage builds bounded PRIVMSG input and redacts host, password, channel, alias, and body from errors", async () => {
  const config = ircConfig();
  const sent: string[] = [];

  await sendIrcMessage(config, "default", "hello\nirc", {
    runner: async (input) => {
      assert.equal(input.host, "irc.example.com");
      assert.equal(input.port, 6697);
      assert.equal(input.tls, true);
      assert.equal(input.nick, "ViserBot");
      assert.equal(input.password, "irc-secret-password");
      assert.equal(input.channel, "#viser");
      sent.push(...input.chunks);
    }
  });
  assert.deepEqual(sent, ["hello / irc"]);

  await assert.rejects(
    () => sendIrcMessage(config, "default", "irc secret body", {
      runner: async () => { throw new Error("bad irc.example.com irc-secret-password #viser default irc secret body"); }
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /irc\.example\.com|irc-secret-password|#viser|default|irc secret body/);
      return true;
    }
  );
});

test("sendTwitchMessage builds bounded chat PRIVMSG input and redacts token, username, channel, alias, and body from errors", async () => {
  const config = twitchConfig();
  const sent: string[] = [];

  await sendTwitchMessage(config, "default", "hello\ntwitch", {
    runner: async (input) => {
      assert.equal(input.accessToken, "twitch-secret-token");
      assert.equal(input.botUsername, "viserbot");
      assert.equal(input.channel, "#viserchannel");
      sent.push(...input.chunks);
    }
  });
  assert.deepEqual(sent, ["hello / twitch"]);

  await assert.rejects(
    () => sendTwitchMessage(config, "default", "twitch secret body", {
      runner: async () => { throw new Error("bad twitch-secret-token viserbot #viserchannel default twitch secret body"); }
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /twitch-secret-token|viserbot|viserchannel|default|twitch secret body/);
      return true;
    }
  );
});

test("sendNtfyMessage posts plain text to aliased topics and redacts base URL, token, topic, alias, and body from errors", async () => {
  const config = ntfyConfig();
  const sentTexts: string[] = [];

  await sendNtfyMessage(config, "default", "hello ntfy", {
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://ntfy.example.com/viser-alerts");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers.authorization, "Bearer ntfy-secret-token");
      assert.equal(headers.title, "Viser");
      assert.equal(headers.cache, "no");
      sentTexts.push(String(init?.body ?? ""));
      return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
    }
  });
  assert.deepEqual(sentTexts, ["hello ntfy"]);

  await sendNtfyMessage(config, "ops", "hello ops", {
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://ntfy.example.com/viser-ops");
      sentTexts.push(String(init?.body ?? ""));
      return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
    }
  });
  assert.deepEqual(sentTexts, ["hello ntfy", "hello ops"]);

  await assert.rejects(
    () => sendNtfyMessage(config, "default", "ntfy secret body", {
      fetchImpl: async () => new Response("bad https://ntfy.example.com ntfy-secret-token viser-alerts default ntfy secret body", { status: 403, statusText: "Forbidden" })
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /ntfy\.example\.com|ntfy-secret-token|viser-alerts|default|ntfy secret body/);
      return true;
    }
  );
});

test("sendMastodonStatus posts form-encoded statuses and redacts URL, token, alias, and body from errors", async () => {
  const config = mastodonConfig();
  const sentTexts: string[] = [];

  await sendMastodonStatus(config, "default", "hello mastodon", {
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://mastodon.example/api/v1/statuses");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers.authorization, "Bearer mastodon-secret-token");
      assert.equal(headers["content-type"], "application/x-www-form-urlencoded; charset=UTF-8");
      const body = init?.body as URLSearchParams;
      assert.equal(body.get("visibility"), "private");
      sentTexts.push(String(body.get("status") ?? ""));
      return new Response(JSON.stringify({ id: "1" }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.deepEqual(sentTexts, ["hello mastodon"]);

  await sendMastodonStatus(config, "ops", "hello ops", {
    fetchImpl: async (_input, init) => {
      const body = init?.body as URLSearchParams;
      assert.equal(body.get("visibility"), "unlisted");
      sentTexts.push(String(body.get("status") ?? ""));
      return new Response(JSON.stringify({ id: "2" }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.deepEqual(sentTexts, ["hello mastodon", "hello ops"]);

  await assert.rejects(
    () => sendMastodonStatus(config, "default", "mastodon secret body", {
      fetchImpl: async () => new Response("bad https://mastodon.example mastodon-secret-token default mastodon secret body", { status: 403, statusText: "Forbidden" })
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /mastodon\.example|mastodon-secret-token|default|mastodon secret body/);
      return true;
    }
  );
});

test("sendNextcloudTalkMessage posts OCS chat text and redacts URL, credentials, room, alias, and body from errors", async () => {
  const config = nextcloudTalkConfig();
  const sentTexts: string[] = [];

  await sendNextcloudTalkMessage(config, "default", "hello nextcloud", {
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://cloud.example.com/ocs/v2.php/apps/spreed/api/v1/chat/roomtoken1");
      const headers = init?.headers as Record<string, string>;
      assert.match(headers.authorization, /^Basic /);
      assert.equal(headers["ocs-apirequest"], "true");
      const payload = JSON.parse(String(init?.body ?? "{}")) as { token?: string; message?: string };
      assert.equal(payload.token, "roomtoken1");
      sentTexts.push(String(payload.message ?? ""));
      return new Response(JSON.stringify({ ocs: { meta: { status: "ok", statuscode: 200 } } }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.deepEqual(sentTexts, ["hello nextcloud"]);

  await assert.rejects(
    () => sendNextcloudTalkMessage(config, "default", "nextcloud secret body", {
      fetchImpl: async () => new Response(JSON.stringify({ ocs: { meta: { status: "failure", statuscode: 404, message: "bad https://cloud.example.com viser-bot nextcloud-secret-password roomtoken1 default nextcloud secret body" } } }), { status: 200, statusText: "OK" })
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /cloud\.example\.com|viser-bot|nextcloud-secret-password|roomtoken1|default|nextcloud secret body/);
      return true;
    }
  );
});

test("sendWebexMessage posts markdown and redacts token, room, and body from errors", async () => {
  const config = webexConfig();
  const sentTexts: string[] = [];

  await sendWebexMessage(config, "Y2lzY29zcGFyazovL3VzL1JPT00vc21va2U", "hello webex", {
    fetchImpl: async (_input, init) => {
      assert.equal((init?.headers as Record<string, string>).authorization, "Bearer webex-secret-token");
      const payload = JSON.parse(String(init?.body ?? "{}")) as { roomId?: string; markdown?: string };
      assert.equal(payload.roomId, "Y2lzY29zcGFyazovL3VzL1JPT00vc21va2U");
      sentTexts.push(String(payload.markdown ?? ""));
      return new Response(JSON.stringify({ id: "message-id" }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.deepEqual(sentTexts, ["hello webex"]);

  await assert.rejects(
    () => sendWebexMessage(config, "Y2lzY29zcGFyazovL3VzL1JPT00vc21va2U", "webex secret body", {
      fetchImpl: async (_input) => new Response("bad webex-secret-token Y2lzY29zcGFyazovL3VzL1JPT00vc21va2U webex secret body", { status: 403, statusText: "Forbidden" })
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /webex-secret-token|Y2lzY29zcGFyazovL3VzL1JPT00vc21va2U|webex secret body/);
      return true;
    }
  );
});

test("sendZulipMessage posts form payloads and redacts credential, target, and body from errors", async () => {
  const config = zulipConfig();
  const sentTexts: string[] = [];

  await sendZulipMessage(config, "default", "hello zulip", {
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://viser-smoke.zulipchat.com/api/v1/messages");
      assert.match((init?.headers as Record<string, string>).authorization, /^Basic /);
      const body = new URLSearchParams(String(init?.body ?? ""));
      assert.equal(body.get("type"), "stream");
      assert.equal(body.get("to"), "\"operations\"");
      assert.equal(body.get("topic"), "alerts");
      sentTexts.push(String(body.get("content") ?? ""));
      return new Response(JSON.stringify({ result: "success", id: 42 }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.deepEqual(sentTexts, ["hello zulip"]);

  await assert.rejects(
    () => sendZulipMessage(config, "default", "zulip secret body", {
      fetchImpl: async (_input) => new Response("bad zulip-secret-key viser-bot@example.com stream:operations:alerts zulip secret body", { status: 403, statusText: "Forbidden" })
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /zulip-secret-key|viser-bot@example\.com|stream:operations:alerts|zulip secret body/);
      return true;
    }
  );
});

test("sendEmailMessage pipes sendmail payloads and redacts envelope and body from errors", async () => {
  const config = emailConfig();
  const sentMessages: string[] = [];

  await sendEmailMessage(config, "ops", "hello email", {
    runner: async (options) => {
      assert.equal(options.command, "sendmail");
      assert.deepEqual(options.args, ["-t"]);
      assert.equal(options.inheritEnv, false);
      sentMessages.push(String(options.stdin ?? ""));
      return commandResult();
    }
  });

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /^From: viser@example\.com/m);
  assert.match(sentMessages[0], /^To: ops@example\.com/m);
  assert.match(sentMessages[0], /^Subject: Viser message/m);
  assert.match(sentMessages[0], /hello email/);

  await assert.rejects(
    () => sendEmailMessage(config, "ops", "email secret body", {
      runner: async () => commandResult("bad viser@example.com ops@example.com email secret body", 75)
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /viser@example\.com|ops@example\.com|email secret body/);
      return true;
    }
  );
});

test("sendGitHubIssueComment posts issue comments and redacts token, target, alias, and body from errors", async () => {
  const config = githubConfig();
  const sentTexts: string[] = [];

  assert.deepEqual(parseGitHubIssueTarget("KMokky/viser#123"), {
    owner: "KMokky",
    repo: "viser",
    issueNumber: 123
  });
  assert.deepEqual(parseGitHubIssueTarget("https://github.com/KMokky/viser/pull/456"), {
    owner: "KMokky",
    repo: "viser",
    issueNumber: 456
  });
  assert.deepEqual(parseGitHubIssueTargetMap("release=KMokky/viser#123"), {
    release: "KMokky/viser#123"
  });

  await sendGitHubIssueComment(config, "release", "hello github", {
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://api.github.com/repos/KMokky/viser/issues/123/comments");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers.authorization, "Bearer github-secret-token");
      assert.equal(headers.accept, "application/vnd.github+json");
      const payload = JSON.parse(String(init?.body ?? "{}")) as { body?: string };
      sentTexts.push(String(payload.body ?? ""));
      return new Response(JSON.stringify({ id: 1 }), { status: 201, headers: { "content-type": "application/json" } });
    }
  });

  assert.deepEqual(sentTexts, ["hello github"]);

  await assert.rejects(
    () => sendGitHubIssueComment(config, "release", "github secret body", {
      fetchImpl: async () => new Response("bad github-secret-token KMokky/viser#123 release github secret body", { status: 403, statusText: "Forbidden" })
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /github-secret-token|KMokky\/viser#123|release|github secret body/);
      return true;
    }
  );
});

test("sendTodoistTask creates tasks and redacts token, project, alias, and body from errors", async () => {
  const config = todoistConfig();
  const sentTasks: Array<{ content?: string; description?: string; project_id?: string }> = [];

  assert.equal(parseTodoistProjectTarget("6Jf8VQXxpwv56VQ7"), "6Jf8VQXxpwv56VQ7");
  assert.throws(() => parseTodoistProjectTarget("tmp-project-id"), /tmp-\*/);
  assert.deepEqual(parseTodoistProjectMap("Release=6Jf8VQXxpwv56VQ7;Errands=7Jf8VQXxpwv56VQ8"), {
    release: "6Jf8VQXxpwv56VQ7",
    errands: "7Jf8VQXxpwv56VQ8"
  });

  const ids = ["todoist-command-uuid", "todoist-temp-id"];
  await sendTodoistTask(config, "release", "hello todoist\nmore detail", {
    uuidFactory: () => ids.shift() ?? "fallback-uuid",
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://api.todoist.com/api/v1/sync");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers.authorization, "Bearer todoist-secret-token");
      assert.equal(headers["content-type"], "application/x-www-form-urlencoded");
      const params = new URLSearchParams(String(init?.body ?? ""));
      const commands = JSON.parse(params.get("commands") ?? "[]") as Array<{
        type?: string;
        temp_id?: string;
        uuid?: string;
        args?: { content?: string; description?: string; project_id?: string };
      }>;
      assert.equal(commands.length, 1);
      assert.equal(commands[0]?.type, "item_add");
      assert.equal(commands[0]?.temp_id, "todoist-temp-id");
      assert.equal(commands[0]?.uuid, "todoist-command-uuid");
      sentTasks.push(commands[0]?.args ?? {});
      return new Response(JSON.stringify({ sync_status: { "todoist-command-uuid": "ok" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.deepEqual(sentTasks, [
    {
      content: "hello todoist",
      description: "more detail",
      project_id: "6Jf8VQXxpwv56VQ7"
    }
  ]);

  await sendTodoistTask(config, "inbox", "inbox todoist", {
    uuidFactory: () => "todoist-inbox-uuid",
    fetchImpl: async (_input, init) => {
      const params = new URLSearchParams(String(init?.body ?? ""));
      const commands = JSON.parse(params.get("commands") ?? "[]") as Array<{ uuid?: string; args?: { project_id?: string } }>;
      assert.equal(commands[0]?.args?.project_id, undefined);
      return new Response(JSON.stringify({ sync_status: { "todoist-inbox-uuid": "ok" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  await assert.rejects(
    () => sendTodoistTask(config, "release", "todoist secret body", {
      uuidFactory: () => "todoist-error-uuid",
      fetchImpl: async () => new Response("bad todoist-secret-token 6Jf8VQXxpwv56VQ7 release todoist secret body", {
        status: 403,
        statusText: "Forbidden"
      })
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /todoist-secret-token|6Jf8VQXxpwv56VQ7|release|todoist secret body/);
      return true;
    }
  );
});

test("appendNotionPageMessage appends paragraph blocks and redacts token, page, alias, and body from errors", async () => {
  const config = notionConfig();
  const sentTexts: string[] = [];

  assert.deepEqual(parseNotionPageTarget("00000000000000000000000000000000"), {
    pageId: "00000000-0000-0000-0000-000000000000"
  });
  assert.deepEqual(parseNotionPageTarget("https://www.notion.so/KMokky/Release-Notes-00000000000000000000000000000000?pvs=4"), {
    pageId: "00000000-0000-0000-0000-000000000000"
  });
  assert.throws(() => parseNotionPageTarget("https://evilnotion.so/00000000000000000000000000000000"), /notion\.so/);
  assert.deepEqual(parseNotionPageMap("Release=00000000000000000000000000000000"), {
    release: "00000000-0000-0000-0000-000000000000"
  });

  await appendNotionPageMessage(config, "release", "hello notion", {
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://api.notion.com/v1/blocks/00000000-0000-0000-0000-000000000000/children");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers.authorization, "Bearer notion-secret-token");
      assert.equal(headers["content-type"], "application/json");
      assert.match(headers["notion-version"], /^\d{4}-\d{2}-\d{2}$/);
      const payload = JSON.parse(String(init?.body ?? "{}")) as {
        children?: Array<{ paragraph?: { rich_text?: Array<{ text?: { content?: string } }> } }>;
      };
      sentTexts.push(String(payload.children?.[0]?.paragraph?.rich_text?.[0]?.text?.content ?? ""));
      return new Response(JSON.stringify({ object: "list", results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.deepEqual(sentTexts, ["hello notion"]);

  await assert.rejects(
    () => appendNotionPageMessage(config, "release", "notion secret body", {
      fetchImpl: async () => new Response("bad notion-secret-token 00000000-0000-0000-0000-000000000000 release notion secret body", {
        status: 403,
        statusText: "Forbidden"
      })
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /notion-secret-token|00000000-0000-0000-0000-000000000000|release|notion secret body/);
      return true;
    }
  );
});

test("appendObsidianNoteMessage appends local Markdown notes and redacts vault, note, alias, and body from errors", async () => {
  const vaultDir = await mkdtemp(join(tmpdir(), "viser-obsidian-vault-"));
  try {
    const config = obsidianConfig(vaultDir);

    assert.deepEqual(parseObsidianNoteMap("Daily=Daily/Viser.md"), {
      daily: "Daily/Viser.md"
    });
    assert.throws(() => parseObsidianNoteMap("bad=../secrets.md"), /traversal/);

    await appendObsidianNoteMessage(config, "daily", "hello obsidian", {
      now: new Date("2026-01-01T00:00:00.000Z")
    });

    const note = await readFile(join(vaultDir, "Daily", "Viser.md"), "utf8");
    assert.match(note, /## Viser — 2026-01-01T00:00:00.000Z/);
    assert.match(note, /hello obsidian/);

    const missingVaultConfig = {
      ...config,
      vaultDir: join(vaultDir, "missing-secret-vault")
    };
    await assert.rejects(
      () => appendObsidianNoteMessage(missingVaultConfig, "daily", "obsidian secret body"),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /\[REDACTED]/);
        assert.doesNotMatch(error.message, /missing-secret-vault|Daily\/Viser\.md|daily|obsidian secret body/);
        return true;
      }
    );
  } finally {
    await rm(vaultDir, { recursive: true, force: true });
  }
});

function fakeAssistant() {
  return {
    async handle(_input: string, _sessionId: string, _options?: AssistantHandleOptions): Promise<string> {
      return "answer";
    }
  } as any;
}

function telegramConfig(): TelegramConnectorConfig {
  return {
    enabled: true,
    botTokenEnv: "TELEGRAM_BOT_TOKEN",
    botToken: "token",
    allowedChatIds: [],
    defaultChatIds: [],
    maxMessagesPerMinute: 20,
    maxInputChars: 4000
  };
}

function discordConfig(): DiscordConnectorConfig {
  return {
    enabled: true,
    botTokenEnv: "DISCORD_BOT_TOKEN",
    botToken: "discord-secret-token",
    prefix: "!viser",
    allowedChannelIds: [],
    defaultChannelIds: [],
    maxMessagesPerMinute: 20,
    maxInputChars: 4000
  };
}

function slackConfig(): SlackConnectorConfig {
  return {
    enabled: true,
    botTokenEnv: "SLACK_BOT_TOKEN",
    botToken: "xoxb-slack-secret-token",
    appTokenEnv: "SLACK_APP_TOKEN",
    appToken: "xapp-slack-secret-token",
    botUserIdEnv: "SLACK_BOT_USER_ID",
    botUserId: "U999",
    prefix: "!viser",
    allowedChannelIds: [],
    defaultChannelIds: [],
    maxMessagesPerMinute: 20,
    maxInputChars: 4000
  };
}

function signalConfig(): SignalConnectorConfig {
  return {
    enabled: true,
    commandEnv: "SIGNAL_CLI_COMMAND",
    command: "signal-cli",
    accountEnv: "SIGNAL_CLI_ACCOUNT",
    account: "+15550000000",
    allowedRecipientIds: [],
    defaultRecipientIds: [],
    maxMessagesPerMinute: 20,
    maxInputChars: 4000,
    pollIntervalMs: 5000,
    receiveTimeoutMs: 30_000,
    sendTimeoutMs: 30_000
  };
}

function imessageConfig(): ImessageConnectorConfig {
  return {
    enabled: true,
    sqliteCommandEnv: "IMESSAGE_SQLITE_COMMAND",
    sqliteCommand: "sqlite3",
    osascriptCommandEnv: "IMESSAGE_OSASCRIPT_COMMAND",
    osascriptCommand: "osascript",
    chatDbPathEnv: "IMESSAGE_CHAT_DB",
    chatDbPath: "/tmp/viser-imessage-chat.db",
    allowedHandleIds: [],
    defaultHandleIds: [],
    maxMessagesPerMinute: 20,
    maxInputChars: 4000,
    pollIntervalMs: 5000,
    queryTimeoutMs: 30_000,
    sendTimeoutMs: 30_000
  };
}

function whatsappConfig(): WhatsappConnectorConfig {
  return {
    enabled: true,
    accessTokenEnv: "WHATSAPP_ACCESS_TOKEN",
    accessToken: "whatsapp-secret-token",
    phoneNumberIdEnv: "WHATSAPP_PHONE_NUMBER_ID",
    phoneNumberId: "12345",
    verifyTokenEnv: "WHATSAPP_VERIFY_TOKEN",
    verifyToken: "whatsapp-verify-token",
    graphApiVersionEnv: "WHATSAPP_GRAPH_API_VERSION",
    graphApiVersion: "v18.0",
    webhookHost: "127.0.0.1",
    webhookPort: 8788,
    webhookPath: "/whatsapp/webhook",
    allowedRecipientIds: [],
    defaultRecipientIds: [],
    maxMessagesPerMinute: 20,
    maxInputChars: 4000,
    sendTimeoutMs: 30_000
  };
}

function lineConfig(): LineConnectorConfig {
  return {
    enabled: true,
    channelAccessTokenEnv: "LINE_CHANNEL_ACCESS_TOKEN",
    channelAccessToken: "line-secret-token",
    channelSecretEnv: "LINE_CHANNEL_SECRET",
    channelSecret: "line-channel-secret",
    webhookHost: "127.0.0.1",
    webhookPort: 8789,
    webhookPath: "/line/webhook",
    allowedPeerIds: [],
    defaultPeerIds: [],
    maxMessagesPerMinute: 20,
    maxInputChars: 4000,
    sendTimeoutMs: 30_000
  };
}

function kakaotalkConfig(): KakaotalkConnectorConfig {
  return {
    enabled: true,
    requestTokenEnv: "KAKAOTALK_SKILL_TOKEN",
    requestToken: "kakaotalk-skill-secret",
    webhookHost: "127.0.0.1",
    webhookPort: 8790,
    webhookPath: "/kakaotalk/skill",
    allowedUserIds: [],
    defaultUserIds: [],
    maxMessagesPerMinute: 20,
    maxInputChars: 4000
  };
}

function googleChatConfig(): GoogleChatConnectorConfig {
  return {
    enabled: true,
    webhookUrlEnv: "GOOGLE_CHAT_WEBHOOK_URL",
    webhookUrl: "https://chat.googleapis.com/v1/spaces/AAAA/messages?key=google-secret-key&token=google-secret-token",
    webhookUrlsEnv: "GOOGLE_CHAT_WEBHOOKS",
    webhookUrls: {},
    allowedWebhookIds: [],
    defaultWebhookIds: [],
    sendTimeoutMs: 30_000
  };
}

function genericWebhookConfig(): GenericWebhookConnectorConfig {
  return {
    enabled: true,
    webhookUrlEnv: "VISER_WEBHOOK_URL",
    webhookUrl: "https://hooks.example.com/viser/generic-secret",
    webhookUrlsEnv: "VISER_WEBHOOKS",
    webhookUrls: {},
    inboundEnabled: true,
    inboundTokenEnv: "VISER_WEBHOOK_INBOUND_TOKEN",
    inboundToken: "abcdefghijklmnopqrstuvwxyz",
    inboundPath: "/webhook/viser",
    inboundMaxInputChars: 4000,
    allowedWebhookIds: [],
    defaultWebhookIds: [],
    sendTimeoutMs: 30_000
  };
}

function homeAssistantConfig(): HomeAssistantConnectorConfig {
  return {
    enabled: true,
    baseUrlEnv: "HOME_ASSISTANT_BASE_URL",
    baseUrl: "http://127.0.0.1:8123",
    accessTokenEnv: "HOME_ASSISTANT_ACCESS_TOKEN",
    accessToken: "homeassistant-secret-token",
    serviceEnv: "HOME_ASSISTANT_SERVICE",
    service: "notify.persistent_notification",
    servicesEnv: "HOME_ASSISTANT_SERVICES",
    services: {},
    allowedServiceIds: [],
    defaultServiceIds: [],
    sendTimeoutMs: 30_000
  };
}

function teamsConfig(): TeamsConnectorConfig {
  return {
    enabled: true,
    webhookUrlEnv: "TEAMS_WEBHOOK_URL",
    webhookUrl: "https://example.webhook.office.com/webhookb2/teams-secret",
    webhookUrlsEnv: "TEAMS_WEBHOOKS",
    webhookUrls: {},
    allowedWebhookIds: [],
    defaultWebhookIds: [],
    sendTimeoutMs: 30_000
  };
}

function mattermostConfig(): MattermostConnectorConfig {
  return {
    enabled: true,
    webhookUrlEnv: "MATTERMOST_WEBHOOK_URL",
    webhookUrl: "https://mattermost.example.com/hooks/mattermost-secret",
    webhookUrlsEnv: "MATTERMOST_WEBHOOKS",
    webhookUrls: {},
    allowedWebhookIds: [],
    defaultWebhookIds: [],
    sendTimeoutMs: 30_000
  };
}

function synologyChatConfig(): SynologyChatConnectorConfig {
  return {
    enabled: true,
    webhookUrlEnv: "SYNOLOGY_CHAT_WEBHOOK_URL",
    webhookUrl: "https://synology.example.com/webapi/entry.cgi?api=SYNO.Chat.External&method=incoming&version=2&token=synology-secret",
    webhookUrlsEnv: "SYNOLOGY_CHAT_WEBHOOKS",
    webhookUrls: {},
    allowedWebhookIds: [],
    defaultWebhookIds: [],
    sendTimeoutMs: 30_000
  };
}

function rocketChatConfig(): RocketChatConnectorConfig {
  return {
    enabled: true,
    webhookUrlEnv: "ROCKET_CHAT_WEBHOOK_URL",
    webhookUrl: "https://rocket.example.com/hooks/integration/rocket-secret",
    webhookUrlsEnv: "ROCKET_CHAT_WEBHOOKS",
    webhookUrls: {},
    allowedWebhookIds: [],
    defaultWebhookIds: [],
    sendTimeoutMs: 30_000
  };
}

function feishuConfig(): FeishuConnectorConfig {
  return {
    enabled: true,
    webhookUrlEnv: "FEISHU_WEBHOOK_URL",
    webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/feishu-secret",
    webhookUrlsEnv: "FEISHU_WEBHOOKS",
    webhookUrls: {},
    allowedWebhookIds: [],
    defaultWebhookIds: [],
    sendTimeoutMs: 30_000
  };
}

function dingTalkConfig(): DingTalkConnectorConfig {
  return {
    enabled: true,
    webhookUrlEnv: "DINGTALK_WEBHOOK_URL",
    webhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=dingtalk-secret",
    webhookUrlsEnv: "DINGTALK_WEBHOOKS",
    webhookUrls: {},
    allowedWebhookIds: [],
    defaultWebhookIds: [],
    sendTimeoutMs: 30_000
  };
}

function weComConfig(): WeComConnectorConfig {
  return {
    enabled: true,
    webhookUrlEnv: "WECOM_WEBHOOK_URL",
    webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=wecom-secret",
    webhookUrlsEnv: "WECOM_WEBHOOKS",
    webhookUrls: {},
    allowedWebhookIds: [],
    defaultWebhookIds: [],
    sendTimeoutMs: 30_000
  };
}

function zaloConfig(): ZaloConnectorConfig {
  return {
    enabled: true,
    accessTokenEnv: "ZALO_OA_ACCESS_TOKEN",
    accessToken: "zalo-secret-token",
    recipientEnv: "ZALO_RECIPIENT_ID",
    recipient: "zalo-user-1",
    recipientsEnv: "ZALO_RECIPIENTS",
    recipients: {},
    allowedRecipientIds: [],
    defaultRecipientIds: [],
    sendTimeoutMs: 30_000
  };
}

function ircConfig(): IrcConnectorConfig {
  return {
    enabled: true,
    hostEnv: "IRC_HOST",
    host: "irc.example.com",
    portEnv: "IRC_PORT",
    port: 6697,
    tlsEnv: "IRC_TLS",
    tls: true,
    nickEnv: "IRC_NICK",
    nick: "ViserBot",
    passwordEnv: "IRC_PASSWORD",
    password: "irc-secret-password",
    channelEnv: "IRC_CHANNEL",
    channel: "#viser",
    channelsEnv: "IRC_CHANNELS",
    channels: {},
    allowedChannelIds: [],
    defaultChannelIds: [],
    sendTimeoutMs: 30_000
  };
}

function twitchConfig(): TwitchConnectorConfig {
  return {
    enabled: true,
    accessTokenEnv: "TWITCH_ACCESS_TOKEN",
    accessToken: "oauth:twitch-secret-token",
    botUsernameEnv: "TWITCH_BOT_USERNAME",
    botUsername: "ViserBot",
    channelEnv: "TWITCH_CHANNEL",
    channel: "ViserChannel",
    channelsEnv: "TWITCH_CHANNELS",
    channels: {},
    allowedChannelIds: [],
    defaultChannelIds: [],
    sendTimeoutMs: 30_000
  };
}

function ntfyConfig(): NtfyConnectorConfig {
  return {
    enabled: true,
    baseUrlEnv: "NTFY_BASE_URL",
    baseUrl: "https://ntfy.example.com",
    tokenEnv: "NTFY_TOKEN",
    token: "ntfy-secret-token",
    topicEnv: "NTFY_TOPIC",
    topic: "viser-alerts",
    topicsEnv: "NTFY_TOPICS",
    topics: {
      ops: "viser-ops"
    },
    allowedTopicIds: [],
    defaultTopicIds: [],
    sendTimeoutMs: 30_000
  };
}

function mastodonConfig(): MastodonConnectorConfig {
  return {
    enabled: true,
    baseUrlEnv: "MASTODON_BASE_URL",
    baseUrl: "https://mastodon.example",
    accessTokenEnv: "MASTODON_ACCESS_TOKEN",
    accessToken: "mastodon-secret-token",
    visibilityEnv: "MASTODON_VISIBILITY",
    visibility: "private",
    targetsEnv: "MASTODON_TARGETS",
    targets: {
      ops: "unlisted"
    },
    allowedTargetIds: [],
    defaultTargetIds: [],
    sendTimeoutMs: 30_000
  };
}

function nextcloudTalkConfig(): NextcloudTalkConnectorConfig {
  return {
    enabled: true,
    baseUrlEnv: "NEXTCLOUD_TALK_BASE_URL",
    baseUrl: "https://cloud.example.com",
    usernameEnv: "NEXTCLOUD_TALK_USERNAME",
    username: "viser-bot",
    appPasswordEnv: "NEXTCLOUD_TALK_APP_PASSWORD",
    appPassword: "nextcloud-secret-password",
    roomTokenEnv: "NEXTCLOUD_TALK_ROOM_TOKEN",
    roomToken: "roomtoken1",
    roomsEnv: "NEXTCLOUD_TALK_ROOMS",
    rooms: {},
    allowedRoomIds: [],
    defaultRoomIds: [],
    sendTimeoutMs: 30_000
  };
}

function webexConfig(): WebexConnectorConfig {
  return {
    enabled: true,
    accessTokenEnv: "WEBEX_ACCESS_TOKEN",
    accessToken: "webex-secret-token",
    allowedRoomIds: [],
    defaultRoomIds: [],
    sendTimeoutMs: 30_000
  };
}

function zulipConfig(): ZulipConnectorConfig {
  return {
    enabled: true,
    siteUrlEnv: "ZULIP_SITE_URL",
    siteUrl: "https://viser-smoke.zulipchat.com",
    botEmailEnv: "ZULIP_BOT_EMAIL",
    botEmail: "viser-bot@example.com",
    apiKeyEnv: "ZULIP_API_KEY",
    apiKey: "zulip-secret-key",
    targetEnv: "ZULIP_TARGET",
    target: "stream:operations:alerts",
    targetsEnv: "ZULIP_TARGETS",
    targets: {},
    allowedTargetIds: [],
    defaultTargetIds: [],
    sendTimeoutMs: 30_000
  };
}

function emailConfig(): EmailConnectorConfig {
  return {
    enabled: true,
    sendmailCommandEnv: "EMAIL_SENDMAIL_COMMAND",
    sendmailCommand: "sendmail",
    fromEnv: "EMAIL_FROM",
    from: "viser@example.com",
    recipientEnv: "EMAIL_RECIPIENT",
    recipient: "operator@example.com",
    recipientsEnv: "EMAIL_RECIPIENTS",
    recipients: { ops: "ops@example.com" },
    allowedRecipientIds: [],
    defaultRecipientIds: [],
    sendTimeoutMs: 30_000
  };
}

function githubConfig(): GitHubConnectorConfig {
  return {
    enabled: true,
    tokenEnv: "GITHUB_TOKEN",
    token: "github-secret-token",
    targetEnv: "GITHUB_ISSUE_TARGET",
    target: "KMokky/viser#123",
    targetsEnv: "GITHUB_ISSUE_TARGETS",
    targets: { release: "KMokky/viser#123" },
    allowedTargetIds: [],
    defaultTargetIds: [],
    sendTimeoutMs: 30_000
  };
}

function todoistConfig(): TodoistConnectorConfig {
  return {
    enabled: true,
    tokenEnv: "TODOIST_API_TOKEN",
    token: "todoist-secret-token",
    projectEnv: "TODOIST_PROJECT_ID",
    project: "6Jf8VQXxpwv56VQ7",
    projectsEnv: "TODOIST_PROJECTS",
    projects: { release: "6Jf8VQXxpwv56VQ7" },
    allowedProjectIds: [],
    defaultProjectIds: [],
    sendTimeoutMs: 30_000
  };
}

function notionConfig(): NotionConnectorConfig {
  return {
    enabled: true,
    tokenEnv: "NOTION_TOKEN",
    token: "notion-secret-token",
    pageEnv: "NOTION_PAGE_ID",
    page: "00000000-0000-0000-0000-000000000000",
    pagesEnv: "NOTION_PAGES",
    pages: { release: "00000000-0000-0000-0000-000000000000" },
    allowedPageIds: [],
    defaultPageIds: [],
    sendTimeoutMs: 30_000
  };
}

function obsidianConfig(vaultDir: string): ObsidianConnectorConfig {
  return {
    enabled: true,
    vaultDirEnv: "OBSIDIAN_VAULT_DIR",
    vaultDir,
    noteEnv: "OBSIDIAN_NOTE",
    note: "Viser.md",
    notesEnv: "OBSIDIAN_NOTES",
    notes: { daily: "Daily/Viser.md" },
    allowedNoteIds: [],
    defaultNoteIds: [],
    maxMessageChars: 20_000
  };
}

function commandResult(stderr = "", exitCode = 0) {
  return {
    stdout: "",
    stderr,
    exitCode,
    signal: null,
    elapsedMs: 1,
    maxOutputBytes: 20_000,
    stdoutTruncated: false,
    stderrTruncated: false
  };
}

function hangingFetch(): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  })) as typeof fetch;
}
