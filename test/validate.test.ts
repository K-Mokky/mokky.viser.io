import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateDingTalkWebhook, validateDiscordToken, validateFeishuWebhook, validateGenericInboundWebhookToken, validateGenericWebhook, validateGitHubTarget, validateGitHubToken, validateGoogleChatWebhook, validateHomeAssistantApi, validateImessageLocal, validateIrcConfig, validateLineToken, validateMastodonToken, validateMattermostWebhook, validateMatrixToken, validateNextcloudTalkConfig, validateNotionTarget, validateNotionToken, validateNtfyTarget, validateObsidianTarget, validateRocketChatWebhook, validateSignalCli, validateSlackToken, validateSynologyChatWebhook, validateTeamsWebhook, validateTelegramToken, validateTodoistTarget, validateTodoistToken, validateTwitchConfig, validateWeComWebhook, validateWebexToken, validateWhatsappToken, validateZaloCredentials, validateZulipToken } from "../src/connectors/validate.ts";

function jsonResponse(body: unknown, ok = true, statusText = "OK"): Response {
  return {
    ok,
    statusText,
    json: async () => body
  } as Response;
}

test("validateTelegramToken accepts valid getMe responses", async () => {
  const result = await validateTelegramToken("token", async () => jsonResponse({ ok: true, result: { username: "viser_bot" } }));
  assert.equal(result.ok, true);
  assert.match(result.detail, /viser_bot/);
});

test("validateDiscordToken reports invalid tokens", async () => {
  const result = await validateDiscordToken("bad", async () => jsonResponse({ message: "401: Unauthorized" }, false, "Unauthorized"));
  assert.equal(result.ok, false);
  assert.match(result.detail, /Unauthorized/);
});

test("validateSlackToken accepts valid auth.test responses", async () => {
  const result = await validateSlackToken("token", async () => jsonResponse({ ok: true, user: "U123456" }));
  assert.equal(result.ok, true);
  assert.match(result.detail, /U123456/);
});

test("validateWebexToken accepts valid People API responses", async () => {
  const result = await validateWebexToken("token", async (input, init) => {
    assert.equal(String(input), "https://webexapis.com/v1/people/me");
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer token");
    return jsonResponse({ displayName: "Viser Bot" });
  });

  assert.equal(result.ok, true);
  assert.equal(result.detail, "bot Viser Bot");
});

test("validateMastodonToken accepts account credential responses", async () => {
  const result = await validateMastodonToken("https://mastodon.example", "mastodon-secret-token", "private", async (input, init) => {
    assert.equal(String(input), "https://mastodon.example/api/v1/accounts/verify_credentials");
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer mastodon-secret-token");
    return jsonResponse({ acct: "viser@mastodon.example" });
  });

  assert.equal(result.ok, true);
  assert.equal(result.detail, "account viser@mastodon.example");
});

test("validateGitHubToken accepts valid user API responses", async () => {
  const result = await validateGitHubToken("github-secret-token", async (input, init) => {
    assert.equal(String(input), "https://api.github.com/user");
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer github-secret-token");
    return jsonResponse({ login: "kmokky" });
  });

  assert.equal(result.ok, true);
  assert.equal(result.detail, "user kmokky");
});

test("validateNotionToken accepts valid users/me responses", async () => {
  const result = await validateNotionToken("notion-secret-token", async (input, init) => {
    assert.equal(String(input), "https://api.notion.com/v1/users/me");
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer notion-secret-token");
    assert.match(headers["notion-version"], /^\d{4}-\d{2}-\d{2}$/);
    return jsonResponse({ name: "Viser Notion Bot" });
  });

  assert.equal(result.ok, true);
  assert.equal(result.detail, "bot Viser Notion Bot");
});

test("validateTodoistToken accepts valid projects API responses", async () => {
  const result = await validateTodoistToken("todoist-secret-token", async (input, init) => {
    assert.equal(String(input), "https://api.todoist.com/api/v1/projects");
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer todoist-secret-token");
    assert.equal(headers["content-type"], "application/x-www-form-urlencoded");
    return jsonResponse([{ id: "6Jf8VQXxpwv56VQ7", name: "Viser" }]);
  });

  assert.equal(result.ok, true);
  assert.equal(result.detail, "token accepted");
});

test("validateZulipToken accepts valid users/me responses", async () => {
  const result = await validateZulipToken("https://viser-smoke.zulipchat.com", "viser-bot@example.com", "zulip-secret-token", async (input, init) => {
    assert.equal(String(input), "https://viser-smoke.zulipchat.com/api/v1/users/me");
    assert.match((init?.headers as Record<string, string>).authorization, /^Basic /);
    return jsonResponse({ result: "success", full_name: "Viser Zulip Bot" });
  });

  assert.equal(result.ok, true);
  assert.equal(result.detail, "bot Viser Zulip Bot");
});

test("validateWhatsappToken accepts valid Graph API phone number responses", async () => {
  const result = await validateWhatsappToken("v18.0", "12345", "token", async (input, init) => {
    assert.equal(String(input), "https://graph.facebook.com/v18.0/12345?fields=id,display_phone_number");
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer token");
    return jsonResponse({ id: "12345", display_phone_number: "+1 555 123 4567" });
  });

  assert.equal(result.ok, true);
  assert.equal(result.detail, "phone number ID accepted");
});

test("validateLineToken accepts valid bot info responses", async () => {
  const result = await validateLineToken("line-token", async (input, init) => {
    assert.equal(String(input), "https://api.line.me/v2/bot/info");
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer line-token");
    return jsonResponse({ displayName: "Viser LINE Bot" });
  });

  assert.equal(result.ok, true);
  assert.equal(result.detail, "bot Viser LINE Bot");
});

test("validate webhook connectors accept configured URL shape without network sends", () => {
  assert.deepEqual(validateGoogleChatWebhook("https://chat.googleapis.com/v1/spaces/AAAA/messages?key=secret-key&token=secret-token"), {
    ok: true,
    label: "google-chat",
    detail: "webhook URL configured"
  });
  assert.deepEqual(validateGenericWebhook("https://hooks.example.com/viser/secret"), {
    ok: true,
    label: "webhook",
    detail: "webhook URL configured"
  });
  assert.deepEqual(validateGenericInboundWebhookToken("abcdefghijklmnopqrstuvwxyz"), {
    ok: true,
    label: "webhook-inbound",
    detail: "inbound webhook token configured"
  });
  assert.deepEqual(validateTeamsWebhook("https://example.webhook.office.com/webhookb2/secret"), {
    ok: true,
    label: "teams",
    detail: "webhook URL configured"
  });
  assert.deepEqual(validateMattermostWebhook("https://mattermost.example.com/hooks/secret"), {
    ok: true,
    label: "mattermost",
    detail: "webhook URL configured"
  });
  assert.deepEqual(validateSynologyChatWebhook("https://synology.example.com/webapi/entry.cgi?api=SYNO.Chat.External&method=incoming&version=2&token=secret"), {
    ok: true,
    label: "synology-chat",
    detail: "webhook URL configured"
  });
  assert.deepEqual(validateRocketChatWebhook("https://rocket.example.com/hooks/integration/secret"), {
    ok: true,
    label: "rocket-chat",
    detail: "webhook URL configured"
  });
  assert.deepEqual(validateFeishuWebhook("https://open.feishu.cn/open-apis/bot/v2/hook/secret"), {
    ok: true,
    label: "feishu",
    detail: "webhook URL configured"
  });
  assert.deepEqual(validateDingTalkWebhook("https://oapi.dingtalk.com/robot/send?access_token=secret"), {
    ok: true,
    label: "dingtalk",
    detail: "webhook URL configured"
  });
  assert.deepEqual(validateWeComWebhook("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret"), {
    ok: true,
    label: "wecom",
    detail: "webhook URL configured"
  });
  assert.deepEqual(validateZaloCredentials("zalo-secret-token", "zalo-user-1"), {
    ok: true,
    label: "zalo",
    detail: "access token and recipient configured"
  });
  assert.deepEqual(validateIrcConfig("irc.example.com", 6697, "ViserBot", "#viser", "irc-secret"), {
    ok: true,
    label: "irc",
    detail: "host, nick, and channel configured"
  });
  assert.deepEqual(validateTwitchConfig("oauth:twitch-secret-token", "ViserBot", "#viser"), {
    ok: true,
    label: "twitch",
    detail: "OAuth token, bot username, and channel configured"
  });
  assert.deepEqual(validateNtfyTarget("https://ntfy.example.com", "ntfy-secret-token", "viser-alerts"), {
    ok: true,
    label: "ntfy",
    detail: "base URL, token, and topic configured"
  });
  assert.deepEqual(validateNtfyTarget("https://ntfy.example.com", undefined, "public-alerts"), {
    ok: true,
    label: "ntfy",
    detail: "base URL and public topic configured"
  });
  assert.deepEqual(validateNextcloudTalkConfig("https://cloud.example.com", "viser-bot", "nextcloud-secret-password", "roomtoken"), {
    ok: true,
    label: "nextcloud-talk",
    detail: "base URL, user, app password, and room configured"
  });
  assert.deepEqual(validateGitHubTarget("github-secret-token", "KMokky/viser#123"), {
    ok: true,
    label: "github",
    detail: "token and issue target configured"
  });
  assert.deepEqual(validateTodoistTarget("todoist-secret-token", "6Jf8VQXxpwv56VQ7"), {
    ok: true,
    label: "todoist",
    detail: "token and project target configured"
  });
  assert.deepEqual(validateTodoistTarget("todoist-secret-token", undefined), {
    ok: true,
    label: "todoist",
    detail: "token configured for inbox target"
  });
  assert.deepEqual(validateNotionTarget("notion-secret-token", "00000000000000000000000000000000"), {
    ok: true,
    label: "notion",
    detail: "token and page target configured"
  });
  assert.deepEqual(validateObsidianTarget("/tmp/viser-vault", "Daily/Viser.md"), {
    ok: true,
    label: "obsidian",
    detail: "vault and note target configured"
  });

  const google = validateGoogleChatWebhook("https://example.com/hook?key=secret-key&token=secret-token");
  const genericWebhook = validateGenericWebhook("https://user:pass@hooks.example.com/viser/secret");
  const genericInboundWebhook = validateGenericInboundWebhookToken("short");
  const teams = validateTeamsWebhook("http://example.webhook.office.com/webhookb2/secret");
  const mattermost = validateMattermostWebhook("https://mattermost.example.com/not-hooks/secret");
  const synologyChat = validateSynologyChatWebhook("https://synology.example.com/webapi/entry.cgi?api=SYNO.Chat.External&method=outgoing&token=secret");
  const rocketChat = validateRocketChatWebhook("https://rocket.example.com/api/v1/chat.postMessage?token=secret");
  const feishu = validateFeishuWebhook("https://example.com/open-apis/bot/v2/hook/secret");
  const dingTalk = validateDingTalkWebhook("https://oapi.dingtalk.com/robot/send");
  const weCom = validateWeComWebhook("https://qyapi.weixin.qq.com/cgi-bin/webhook/send");
  const zalo = validateZaloCredentials("short", "https://zalo.me/user");
  const irc = validateIrcConfig("irc.example.com:6697", 6697, "1bad", "bad channel", "irc-secret");
  const twitch = validateTwitchConfig("short", "bad user", "bad channel");
  const ntfy = validateNtfyTarget("http://ntfy.example.com", "short", "https://ntfy.sh/private-topic");
  const nextcloudTalk = validateNextcloudTalkConfig("http://cloud.example.com", "viser bot", "nextcloud-secret-password", "https://cloud.example.com/call/roomtoken");
  const github = validateGitHubTarget("short", "https://example.com/not-github/1");
  const todoist = validateTodoistTarget("short", "tmp-private-project");
  const notion = validateNotionTarget("short", "https://evilnotion.so/00000000000000000000000000000000");
  const obsidian = validateObsidianTarget("/tmp/private-vault", "../secret.md");
  assert.equal(google.ok, false);
  assert.equal(genericWebhook.ok, false);
  assert.equal(genericInboundWebhook.ok, false);
  assert.equal(teams.ok, false);
  assert.equal(mattermost.ok, false);
  assert.equal(synologyChat.ok, false);
  assert.equal(rocketChat.ok, false);
  assert.equal(feishu.ok, false);
  assert.equal(dingTalk.ok, false);
  assert.equal(weCom.ok, false);
  assert.equal(zalo.ok, false);
  assert.equal(irc.ok, false);
  assert.equal(twitch.ok, false);
  assert.equal(ntfy.ok, false);
  assert.equal(nextcloudTalk.ok, false);
  assert.equal(github.ok, false);
  assert.equal(todoist.ok, false);
  assert.equal(notion.ok, false);
  assert.equal(obsidian.ok, false);
  assert.doesNotMatch(google.detail, /secret-key|secret-token/);
  assert.doesNotMatch(genericWebhook.detail, /user:pass|hooks\.example|viser\/secret/);
  assert.doesNotMatch(genericInboundWebhook.detail, /short/);
  assert.doesNotMatch(teams.detail, /teams\/secret|webhookb2\/secret/);
  assert.doesNotMatch(mattermost.detail, /hooks\/secret|mattermost\.example/);
  assert.doesNotMatch(synologyChat.detail, /token=secret|synology\.example/);
  assert.doesNotMatch(rocketChat.detail, /token=secret|rocket\.example/);
  assert.doesNotMatch(feishu.detail, /hook\/secret/);
  assert.doesNotMatch(dingTalk.detail, /access_token=secret/);
  assert.doesNotMatch(weCom.detail, /key=secret/);
  assert.doesNotMatch(zalo.detail, /short|zalo\.me\/user/);
  assert.doesNotMatch(twitch.detail, /short|bad user|bad channel/);
  assert.doesNotMatch(ntfy.detail, /ntfy\.example|short|private-topic/);
  assert.doesNotMatch(nextcloudTalk.detail, /cloud\.example|viser bot|nextcloud-secret-password|roomtoken/);
  assert.doesNotMatch(github.detail, /short|example\.com/);
  assert.doesNotMatch(todoist.detail, /short|tmp-private/);
  assert.doesNotMatch(notion.detail, /short|evilnotion/);
  assert.doesNotMatch(obsidian.detail, /private-vault|secret/);
});

test("validateHomeAssistantApi probes /api/ with bearer token and redacts failures", async () => {
  const accepted = await validateHomeAssistantApi(
    "http://127.0.0.1:8123",
    "homeassistant-secret-token",
    "notify.persistent_notification",
    async (input, init) => {
      assert.equal(String(input), "http://127.0.0.1:8123/api/");
      assert.equal((init?.headers as Record<string, string>).authorization, "Bearer homeassistant-secret-token");
      return new Response(JSON.stringify({ message: "API running." }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  );
  assert.equal(accepted.ok, true);
  assert.equal(accepted.detail, "Home Assistant API accepted token");

  const rejected = await validateHomeAssistantApi(
    "http://127.0.0.1:8123",
    "homeassistant-secret-token",
    "notify.persistent_notification",
    async () => new Response("homeassistant-secret-token http://127.0.0.1:8123 notify.persistent_notification", {
      status: 401,
      statusText: "Unauthorized"
    })
  );
  assert.equal(rejected.ok, false);
  assert.match(rejected.detail, /\[REDACTED\]/);
  assert.doesNotMatch(rejected.detail, /homeassistant-secret-token|127\.0\.0\.1|notify\.persistent_notification/);
});

test("validateTelegramToken redacts tokens from transport errors", async () => {
  const token = "123456:top-secret-telegram-token";
  const result = await validateTelegramToken(token, async () => {
    throw new Error(`GET https://api.telegram.org/bot${token}/getMe failed`);
  });

  assert.equal(result.ok, false);
  assert.doesNotMatch(result.detail, /top-secret-telegram-token/);
  assert.match(result.detail, /\[REDACTED]/);
});

test("validateDiscordToken redacts tokens from API and transport errors", async () => {
  const token = "discord-secret-token";
  const apiResult = await validateDiscordToken(token, async () => jsonResponse({ message: `invalid Bot ${token}` }, false, "Unauthorized"));
  const transportResult = await validateDiscordToken(token, async () => {
    throw new Error(`authorization header was Bot ${token}`);
  });

  assert.equal(apiResult.ok, false);
  assert.equal(transportResult.ok, false);
  assert.doesNotMatch(apiResult.detail, /discord-secret-token/);
  assert.doesNotMatch(transportResult.detail, /discord-secret-token/);
  assert.match(apiResult.detail, /\[REDACTED]/);
  assert.match(transportResult.detail, /\[REDACTED]/);
});

test("validateSlackToken redacts tokens from API and transport errors", async () => {
  const token = "slack-secret-token";
  const apiResult = await validateSlackToken(token, async () => jsonResponse({ ok: false, error: `invalid_auth ${token}` }));
  const transportResult = await validateSlackToken(token, async () => {
    throw new Error(`authorization header was Bearer ${token}`);
  });

  assert.equal(apiResult.ok, false);
  assert.equal(transportResult.ok, false);
  assert.doesNotMatch(apiResult.detail, /slack-secret-token/);
  assert.doesNotMatch(transportResult.detail, /slack-secret-token/);
  assert.match(apiResult.detail, /\[REDACTED]/);
  assert.match(transportResult.detail, /\[REDACTED]/);
});

test("validateWebexToken redacts tokens from API and transport errors", async () => {
  const token = "webex-secret-token";
  const apiResult = await validateWebexToken(token, async () => jsonResponse({ message: `invalid ${token}` }, false, "Unauthorized"));
  const transportResult = await validateWebexToken(token, async () => {
    throw new Error(`authorization header was Bearer ${token}`);
  });

  assert.equal(apiResult.ok, false);
  assert.equal(transportResult.ok, false);
  assert.doesNotMatch(apiResult.detail, /webex-secret-token/);
  assert.doesNotMatch(transportResult.detail, /webex-secret-token/);
  assert.match(apiResult.detail, /\[REDACTED]/);
  assert.match(transportResult.detail, /\[REDACTED]/);
});

test("validateZulipToken redacts credentials from API and transport errors", async () => {
  const token = "zulip-secret-token";
  const siteUrl = "https://private.zulipchat.com";
  const email = "viser-bot@example.com";
  const apiResult = await validateZulipToken(siteUrl, email, token, async () => jsonResponse({ result: "error", msg: `invalid ${siteUrl} ${email} ${token}` }, false, "Unauthorized"));
  const transportResult = await validateZulipToken(siteUrl, email, token, async () => {
    throw new Error(`authorization header was Basic ${email}:${token} for ${siteUrl}`);
  });

  assert.equal(apiResult.ok, false);
  assert.equal(transportResult.ok, false);
  assert.doesNotMatch(apiResult.detail, /zulip-secret-token|viser-bot@example\.com|private\.zulipchat/);
  assert.doesNotMatch(transportResult.detail, /zulip-secret-token|viser-bot@example\.com|private\.zulipchat/);
  assert.match(apiResult.detail, /\[REDACTED]/);
  assert.match(transportResult.detail, /\[REDACTED]/);
});

test("validateGitHubToken redacts token from API and transport errors", async () => {
  const token = "github-secret-token";
  const apiResult = await validateGitHubToken(token, async () => jsonResponse({ message: `bad ${token}` }, false, "Forbidden"));
  const transportResult = await validateGitHubToken(token, async () => {
    throw new Error(`authorization header was Bearer ${token}`);
  });

  assert.equal(apiResult.ok, false);
  assert.equal(transportResult.ok, false);
  assert.doesNotMatch(apiResult.detail, /github-secret-token/);
  assert.doesNotMatch(transportResult.detail, /github-secret-token/);
  assert.match(apiResult.detail, /\[REDACTED]/);
  assert.match(transportResult.detail, /\[REDACTED]/);
});

test("validateTodoistToken redacts token from API and transport errors", async () => {
  const token = "todoist-secret-token";
  const apiResult = await validateTodoistToken(token, async () => jsonResponse({ error: `bad ${token}` }, false, "Forbidden"));
  const transportResult = await validateTodoistToken(token, async () => {
    throw new Error(`authorization header was Bearer ${token}`);
  });

  assert.equal(apiResult.ok, false);
  assert.equal(transportResult.ok, false);
  assert.doesNotMatch(apiResult.detail, /todoist-secret-token/);
  assert.doesNotMatch(transportResult.detail, /todoist-secret-token/);
  assert.match(apiResult.detail, /\[REDACTED]/);
  assert.match(transportResult.detail, /\[REDACTED]/);
});

test("validateNotionToken redacts token from API and transport errors", async () => {
  const token = "notion-secret-token";
  const apiResult = await validateNotionToken(token, async () => jsonResponse({ message: `bad ${token}` }, false, "Forbidden"));
  const transportResult = await validateNotionToken(token, async () => {
    throw new Error(`authorization header was Bearer ${token}`);
  });

  assert.equal(apiResult.ok, false);
  assert.equal(transportResult.ok, false);
  assert.doesNotMatch(apiResult.detail, /notion-secret-token/);
  assert.doesNotMatch(transportResult.detail, /notion-secret-token/);
  assert.match(apiResult.detail, /\[REDACTED]/);
  assert.match(transportResult.detail, /\[REDACTED]/);
});

test("validateWhatsappToken redacts token and phone number ID from API and transport errors", async () => {
  const token = "whatsapp-secret-token";
  const phoneNumberId = "12345";
  const apiResult = await validateWhatsappToken("v18.0", phoneNumberId, token, async () => jsonResponse({
    error: { message: `invalid ${token} ${phoneNumberId}` }
  }, false, "Unauthorized"));
  const transportResult = await validateWhatsappToken("v18.0", phoneNumberId, token, async () => {
    throw new Error(`authorization header was Bearer ${token} for ${phoneNumberId}`);
  });

  assert.equal(apiResult.ok, false);
  assert.equal(transportResult.ok, false);
  assert.doesNotMatch(apiResult.detail, /whatsapp-secret-token|12345/);
  assert.doesNotMatch(transportResult.detail, /whatsapp-secret-token|12345/);
  assert.match(apiResult.detail, /\[REDACTED]/);
  assert.match(transportResult.detail, /\[REDACTED]/);
});

test("validateLineToken redacts tokens from API and transport errors", async () => {
  const token = "line-secret-token";
  const apiResult = await validateLineToken(token, async () => jsonResponse({ message: `invalid ${token}` }, false, "Unauthorized"));
  const transportResult = await validateLineToken(token, async () => {
    throw new Error(`authorization header was Bearer ${token}`);
  });

  assert.equal(apiResult.ok, false);
  assert.equal(transportResult.ok, false);
  assert.doesNotMatch(apiResult.detail, /line-secret-token/);
  assert.doesNotMatch(transportResult.detail, /line-secret-token/);
  assert.match(apiResult.detail, /\[REDACTED]/);
  assert.match(transportResult.detail, /\[REDACTED]/);
});

test("validateDiscordToken times out stalled token validation", async () => {
  const result = await validateDiscordToken("discord-secret-token", hangingFetch(), { timeoutMs: 5 });

  assert.equal(result.ok, false);
  assert.match(result.detail, /timed out after 5ms/);
  assert.doesNotMatch(result.detail, /discord-secret-token/);
});

test("validateSlackToken times out stalled token validation", async () => {
  const result = await validateSlackToken("slack-secret-token", hangingFetch(), { timeoutMs: 5 });

  assert.equal(result.ok, false);
  assert.match(result.detail, /timed out after 5ms/);
  assert.doesNotMatch(result.detail, /slack-secret-token/);
});

test("validateWebexToken times out stalled token validation", async () => {
  const result = await validateWebexToken("webex-secret-token", hangingFetch(), { timeoutMs: 5 });

  assert.equal(result.ok, false);
  assert.match(result.detail, /timed out after 5ms/);
  assert.doesNotMatch(result.detail, /webex-secret-token/);
});

test("validateZulipToken times out stalled token validation", async () => {
  const result = await validateZulipToken("https://private.zulipchat.com", "viser-bot@example.com", "zulip-secret-token", hangingFetch(), { timeoutMs: 5 });

  assert.equal(result.ok, false);
  assert.match(result.detail, /timed out after 5ms/);
  assert.doesNotMatch(result.detail, /zulip-secret-token|viser-bot@example\.com|private\.zulipchat/);
});

test("validateWhatsappToken times out stalled token validation", async () => {
  const result = await validateWhatsappToken("v18.0", "12345", "whatsapp-secret-token", hangingFetch(), { timeoutMs: 5 });

  assert.equal(result.ok, false);
  assert.match(result.detail, /timed out after 5ms/);
  assert.doesNotMatch(result.detail, /whatsapp-secret-token|12345/);
});

test("validateLineToken times out stalled token validation", async () => {
  const result = await validateLineToken("line-secret-token", hangingFetch(), { timeoutMs: 5 });

  assert.equal(result.ok, false);
  assert.match(result.detail, /timed out after 5ms/);
  assert.doesNotMatch(result.detail, /line-secret-token/);
});

test("validateSignalCli treats local signal-cli setup as account plus command", () => {
  assert.deepEqual(validateSignalCli("node", "+15551234567"), {
    ok: true,
    label: "signal",
    detail: "local signal-cli configured"
  });
  assert.deepEqual(validateSignalCli("node", undefined), {
    ok: false,
    label: "signal",
    detail: "missing account"
  });
});

test("validateImessageLocal treats local macOS Messages setup as command plus readable chat database path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-imessage-validate-"));
  try {
    const chatDbPath = join(dir, "chat.db");
    await writeFile(chatDbPath, "", "utf8");
    assert.deepEqual(validateImessageLocal("node", "node", chatDbPath), {
      ok: true,
      label: "imessage",
      detail: "local macOS Messages commands configured"
    });
    assert.deepEqual(validateImessageLocal("node", "node", undefined), {
      ok: false,
      label: "imessage",
      detail: "missing chat database path"
    });
    assert.deepEqual(validateImessageLocal(undefined, "node", chatDbPath), {
      ok: false,
      label: "imessage",
      detail: "missing sqlite command"
    });
    assert.deepEqual(validateImessageLocal("node", undefined, chatDbPath), {
      ok: false,
      label: "imessage",
      detail: "missing osascript command"
    });
    assert.deepEqual(validateImessageLocal("node", "node", join(dir, "missing.db")), {
      ok: false,
      label: "imessage",
      detail: "chat database path is not readable"
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function hangingFetch(): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  })) as typeof fetch;
}
