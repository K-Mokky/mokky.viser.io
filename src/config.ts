// ================================================================
// Configuration loading and defaults
// ================================================================
// Viser works out of the box with sane defaults. A local `viser.config.json`
// can override any section without needing code changes.

import { lstatSync } from "node:fs";
import { cwd, env } from "node:process";
import { resolve } from "node:path";
import { assertNoSymlinkComponentsUnderRoot, readJsonFile } from "./utils/files.ts";
import { assertValidConfig } from "./config-validation.ts";
import { parseDingTalkWebhookUrlMap } from "./connectors/dingtalk.ts";
import { parseFeishuWebhookUrlMap } from "./connectors/feishu.ts";
import { parseEmailRecipientMap } from "./connectors/email.ts";
import { parseGenericWebhookUrlMap } from "./connectors/generic-webhook.ts";
import { parseGitHubIssueTargetMap } from "./connectors/github.ts";
import { parseTodoistProjectMap } from "./connectors/todoist.ts";
import { parseNotionPageMap } from "./connectors/notion.ts";
import { parseObsidianNoteMap } from "./connectors/obsidian.ts";
import { parseHomeAssistantServiceMap } from "./connectors/home-assistant.ts";
import { parseIrcChannelMap } from "./connectors/irc.ts";
import { parseWebhookUrlMap } from "./connectors/google-chat.ts";
import { parseMattermostWebhookUrlMap } from "./connectors/mattermost.ts";
import { parseNextcloudTalkRoomMap } from "./connectors/nextcloud-talk.ts";
import { parseNtfyTopicMap } from "./connectors/ntfy.ts";
import { normalizeMastodonVisibility, parseMastodonTargetMap } from "./connectors/mastodon.ts";
import { parseRocketChatWebhookUrlMap } from "./connectors/rocket-chat.ts";
import { parseSynologyChatWebhookUrlMap } from "./connectors/synology-chat.ts";
import { parseTeamsWebhookUrlMap } from "./connectors/teams.ts";
import { parseTwitchChannelMap } from "./connectors/twitch.ts";
import { parseWeComWebhookUrlMap } from "./connectors/wecom.ts";
import { parseZaloRecipientMap } from "./connectors/zalo.ts";
import { parseZulipTargetMap } from "./connectors/zulip.ts";
import type { ViserConfig } from "./core/types.ts";

export const DEFAULT_CONFIG: ViserConfig = {
  assistant: {
    name: "Viser",
    defaultProvider: "codex",
    fallbackProviders: ["gemini", "claude", "gpt"],
    systemPrompt:
      "You are Viser, a local-first CLI assistant created by KMokky. Be concise, practical, and ask before destructive actions.",
    historyLimit: 12,
    maxInputChars: 12_000,
    workdir: "."
  },
  storage: {
    dir: ".viser"
  },
  memory: {
    enabled: true,
    dir: ".viser/memory",
    promptLimit: 12
  },
  personalization: {
    enabled: true,
    dir: ".viser/personalization",
    promptLimit: 12,
    maxValueChars: 1_000
  },
  skills: {
    enabled: true,
    dirs: ["skills", ".viser/skills"],
    promptLimit: 8
  },
  plugins: {
    enabled: true,
    dirs: ["plugins", ".viser/plugins"],
    promptLimit: 8
  },
  tools: {
    enabled: true,
    allowedReadRoots: ["."],
    maxReadBytes: 20_000,
    shell: {
      enabled: true,
      allowedCommands: ["pwd", "ls", "cat", "sed", "grep", "rg", "find", "wc", "git"],
      timeoutMs: 30_000
    },
    webFetch: {
      enabled: true,
      provider: "direct-http",
      extractMode: "text",
      firecrawlApiKeyEnv: "FIRECRAWL_API_KEY",
      firecrawlApiKey: undefined,
      maxResponseBytes: 1_000_000,
      timeoutMs: 15_000,
      maxRedirects: 3,
      cacheTtlMs: 900_000,
      userAgent: "Viser/0.1 web-fetch (+https://github.com/KMokky/viser)"
    },
    webSearch: {
      enabled: true,
      provider: "duckduckgo-html",
      searxngBaseUrl: undefined,
      braveApiKeyEnv: "BRAVE_SEARCH_API_KEY",
      braveApiKey: undefined,
      tavilyApiKeyEnv: "TAVILY_API_KEY",
      tavilyApiKey: undefined,
      perplexityApiKeyEnv: "PERPLEXITY_API_KEY",
      perplexityApiKey: undefined,
      exaApiKeyEnv: "EXA_API_KEY",
      exaApiKey: undefined,
      firecrawlApiKeyEnv: "FIRECRAWL_API_KEY",
      firecrawlApiKey: undefined,
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaApiKeyEnv: "OLLAMA_API_KEY",
      ollamaApiKey: undefined,
      maxResults: 5,
      maxResponseBytes: 500_000,
      timeoutMs: 15_000,
      userAgent: "Viser/0.1 web-search (+https://github.com/KMokky/viser)"
    }
  },
  scheduler: {
    enabled: true,
    dir: ".viser/scheduler",
    tickMs: 15_000
  },
  jobs: {
    enabled: true,
    dir: ".viser/jobs",
    tickMs: 15_000,
    concurrency: 1
  },
  webDashboard: {
    enabled: false,
    host: "127.0.0.1",
    port: 8787,
    canvasDir: ".viser/dashboard",
    allowRemote: false,
    authTokenEnv: "VISER_DASHBOARD_TOKEN"
  },
  access: {
    enabled: true,
    dir: ".viser/access",
    defaultPolicy: "pairing",
    pairingCodeTtlMs: 10 * 60 * 1000
  },
  actions: {
    enabled: true,
    dir: ".viser/actions",
    allowedWriteRoots: ["."],
    maxWriteBytes: 50_000,
    createBackups: true,
    browserTask: {
      enabled: false,
      provider: "browser-use-cloud",
      browserUseBaseUrl: "https://api.browser-use.com",
      browserUseApiKeyEnv: "BROWSER_USE_API_KEY",
      browserUseApiKey: undefined,
      browserbaseBaseUrl: "https://api.browserbase.com",
      browserbaseApiKeyEnv: "BROWSERBASE_API_KEY",
      browserbaseApiKey: undefined,
      browserbaseProjectIdEnv: "BROWSERBASE_PROJECT_ID",
      browserbaseProjectId: undefined,
      browserbaseSessionTimeoutSeconds: 60,
      browserbaseReleaseSession: true,
      firecrawlBaseUrl: "https://api.firecrawl.dev",
      firecrawlApiKeyEnv: "FIRECRAWL_API_KEY",
      firecrawlApiKey: undefined,
      firecrawlInteractTimeoutSeconds: 30,
      firecrawlStopSession: true,
      firecrawlMaxResultChars: 6000,
      localCdpBaseUrl: "http://127.0.0.1:9222",
      localCdpBaseUrlEnv: "VISER_BROWSER_CDP_URL",
      localCdpWaitMs: 1500,
      localCdpMaxContentChars: 6000,
      localCdpCloseTab: true,
      maxTaskChars: 4000,
      maxAgentSteps: 25,
      allowedDomains: [],
      timeoutMs: 30_000
    }
  },
  connectors: {
    telegram: {
      enabled: false,
      botTokenEnv: "TELEGRAM_BOT_TOKEN",
      allowedChatIds: [],
      defaultChatIds: [],
      maxMessagesPerMinute: 20,
      maxInputChars: 4000
    },
    discord: {
      enabled: false,
      botTokenEnv: "DISCORD_BOT_TOKEN",
      prefix: "!viser",
      allowedChannelIds: [],
      defaultChannelIds: [],
      maxMessagesPerMinute: 20,
      maxInputChars: 4000
    },
    slack: {
      enabled: false,
      botTokenEnv: "SLACK_BOT_TOKEN",
      appTokenEnv: "SLACK_APP_TOKEN",
      botUserIdEnv: "SLACK_BOT_USER_ID",
      prefix: "!viser",
      allowedChannelIds: [],
      defaultChannelIds: [],
      maxMessagesPerMinute: 20,
      maxInputChars: 4000
    },
    matrix: {
      enabled: false,
      homeserverUrlEnv: "MATRIX_HOMESERVER_URL",
      accessTokenEnv: "MATRIX_ACCESS_TOKEN",
      userIdEnv: "MATRIX_USER_ID",
      prefix: "!viser",
      allowedRoomIds: [],
      defaultRoomIds: [],
      maxMessagesPerMinute: 20,
      maxInputChars: 4000,
      pollTimeoutMs: 30_000
    },
    signal: {
      enabled: false,
      commandEnv: "SIGNAL_CLI_COMMAND",
      command: "signal-cli",
      accountEnv: "SIGNAL_CLI_ACCOUNT",
      allowedRecipientIds: [],
      defaultRecipientIds: [],
      maxMessagesPerMinute: 20,
      maxInputChars: 4000,
      pollIntervalMs: 5000,
      receiveTimeoutMs: 30_000,
      sendTimeoutMs: 30_000
    },
    imessage: {
      enabled: false,
      sqliteCommandEnv: "IMESSAGE_SQLITE_COMMAND",
      sqliteCommand: "sqlite3",
      osascriptCommandEnv: "IMESSAGE_OSASCRIPT_COMMAND",
      osascriptCommand: "osascript",
      chatDbPathEnv: "IMESSAGE_CHAT_DB",
      chatDbPath: "~/Library/Messages/chat.db",
      allowedHandleIds: [],
      defaultHandleIds: [],
      maxMessagesPerMinute: 20,
      maxInputChars: 4000,
      pollIntervalMs: 5000,
      queryTimeoutMs: 30_000,
      sendTimeoutMs: 30_000
    },
    whatsapp: {
      enabled: false,
      accessTokenEnv: "WHATSAPP_ACCESS_TOKEN",
      phoneNumberIdEnv: "WHATSAPP_PHONE_NUMBER_ID",
      verifyTokenEnv: "WHATSAPP_VERIFY_TOKEN",
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
    },
    line: {
      enabled: false,
      channelAccessTokenEnv: "LINE_CHANNEL_ACCESS_TOKEN",
      channelSecretEnv: "LINE_CHANNEL_SECRET",
      webhookHost: "127.0.0.1",
      webhookPort: 8789,
      webhookPath: "/line/webhook",
      allowedPeerIds: [],
      defaultPeerIds: [],
      maxMessagesPerMinute: 20,
      maxInputChars: 4000,
      sendTimeoutMs: 30_000
    },
    kakaotalk: {
      enabled: false,
      requestTokenEnv: "KAKAOTALK_SKILL_TOKEN",
      webhookHost: "127.0.0.1",
      webhookPort: 8790,
      webhookPath: "/kakaotalk/skill",
      allowedUserIds: [],
      defaultUserIds: [],
      maxMessagesPerMinute: 20,
      maxInputChars: 4000
    },
    googleChat: {
      enabled: false,
      webhookUrlEnv: "GOOGLE_CHAT_WEBHOOK_URL",
      webhookUrlsEnv: "GOOGLE_CHAT_WEBHOOKS",
      webhookUrls: {},
      allowedWebhookIds: [],
      defaultWebhookIds: [],
      sendTimeoutMs: 30_000
    },
    webhook: {
      enabled: false,
      webhookUrlEnv: "VISER_WEBHOOK_URL",
      webhookUrlsEnv: "VISER_WEBHOOKS",
      webhookUrls: {},
      inboundEnabled: false,
      inboundTokenEnv: "VISER_WEBHOOK_INBOUND_TOKEN",
      inboundSignatureSecretEnv: "VISER_WEBHOOK_INBOUND_SIGNATURE_SECRET",
      inboundSignatureToleranceMs: 300_000,
      inboundPath: "/webhook/viser",
      inboundMaxInputChars: 4000,
      allowedWebhookIds: [],
      defaultWebhookIds: [],
      sendTimeoutMs: 30_000
    },
    homeAssistant: {
      enabled: false,
      baseUrlEnv: "HOME_ASSISTANT_BASE_URL",
      accessTokenEnv: "HOME_ASSISTANT_ACCESS_TOKEN",
      serviceEnv: "HOME_ASSISTANT_SERVICE",
      servicesEnv: "HOME_ASSISTANT_SERVICES",
      services: {},
      allowedServiceIds: [],
      defaultServiceIds: [],
      sendTimeoutMs: 30_000
    },
    teams: {
      enabled: false,
      webhookUrlEnv: "TEAMS_WEBHOOK_URL",
      webhookUrlsEnv: "TEAMS_WEBHOOKS",
      webhookUrls: {},
      allowedWebhookIds: [],
      defaultWebhookIds: [],
      sendTimeoutMs: 30_000
    },
    mattermost: {
      enabled: false,
      webhookUrlEnv: "MATTERMOST_WEBHOOK_URL",
      webhookUrlsEnv: "MATTERMOST_WEBHOOKS",
      webhookUrls: {},
      allowedWebhookIds: [],
      defaultWebhookIds: [],
      sendTimeoutMs: 30_000
    },
    synologyChat: {
      enabled: false,
      webhookUrlEnv: "SYNOLOGY_CHAT_WEBHOOK_URL",
      webhookUrlsEnv: "SYNOLOGY_CHAT_WEBHOOKS",
      webhookUrls: {},
      allowedWebhookIds: [],
      defaultWebhookIds: [],
      sendTimeoutMs: 30_000
    },
    rocketChat: {
      enabled: false,
      webhookUrlEnv: "ROCKET_CHAT_WEBHOOK_URL",
      webhookUrlsEnv: "ROCKET_CHAT_WEBHOOKS",
      webhookUrls: {},
      allowedWebhookIds: [],
      defaultWebhookIds: [],
      sendTimeoutMs: 30_000
    },
    feishu: {
      enabled: false,
      webhookUrlEnv: "FEISHU_WEBHOOK_URL",
      webhookUrlsEnv: "FEISHU_WEBHOOKS",
      webhookUrls: {},
      allowedWebhookIds: [],
      defaultWebhookIds: [],
      sendTimeoutMs: 30_000
    },
    dingtalk: {
      enabled: false,
      webhookUrlEnv: "DINGTALK_WEBHOOK_URL",
      webhookUrlsEnv: "DINGTALK_WEBHOOKS",
      webhookUrls: {},
      allowedWebhookIds: [],
      defaultWebhookIds: [],
      sendTimeoutMs: 30_000
    },
    wecom: {
      enabled: false,
      webhookUrlEnv: "WECOM_WEBHOOK_URL",
      webhookUrlsEnv: "WECOM_WEBHOOKS",
      webhookUrls: {},
      allowedWebhookIds: [],
      defaultWebhookIds: [],
      sendTimeoutMs: 30_000
    },
    zalo: {
      enabled: false,
      accessTokenEnv: "ZALO_OA_ACCESS_TOKEN",
      recipientEnv: "ZALO_RECIPIENT_ID",
      recipientsEnv: "ZALO_RECIPIENTS",
      recipients: {},
      allowedRecipientIds: [],
      defaultRecipientIds: [],
      sendTimeoutMs: 30_000
    },
    irc: {
      enabled: false,
      hostEnv: "IRC_HOST",
      portEnv: "IRC_PORT",
      port: 6697,
      tlsEnv: "IRC_TLS",
      tls: true,
      nickEnv: "IRC_NICK",
      passwordEnv: "IRC_PASSWORD",
      channelEnv: "IRC_CHANNEL",
      channelsEnv: "IRC_CHANNELS",
      channels: {},
      allowedChannelIds: [],
      defaultChannelIds: [],
      sendTimeoutMs: 30_000
    },
    twitch: {
      enabled: false,
      accessTokenEnv: "TWITCH_ACCESS_TOKEN",
      botUsernameEnv: "TWITCH_BOT_USERNAME",
      channelEnv: "TWITCH_CHANNEL",
      channelsEnv: "TWITCH_CHANNELS",
      channels: {},
      allowedChannelIds: [],
      defaultChannelIds: [],
      sendTimeoutMs: 30_000
    },
    ntfy: {
      enabled: false,
      baseUrlEnv: "NTFY_BASE_URL",
      baseUrl: "https://ntfy.sh",
      tokenEnv: "NTFY_TOKEN",
      topicEnv: "NTFY_TOPIC",
      topicsEnv: "NTFY_TOPICS",
      topics: {},
      allowedTopicIds: [],
      defaultTopicIds: [],
      sendTimeoutMs: 30_000
    },
    mastodon: {
      enabled: false,
      baseUrlEnv: "MASTODON_BASE_URL",
      baseUrl: undefined,
      accessTokenEnv: "MASTODON_ACCESS_TOKEN",
      visibilityEnv: "MASTODON_VISIBILITY",
      visibility: "private",
      targetsEnv: "MASTODON_TARGETS",
      targets: {},
      allowedTargetIds: [],
      defaultTargetIds: [],
      sendTimeoutMs: 30_000
    },
    nextcloudTalk: {
      enabled: false,
      baseUrlEnv: "NEXTCLOUD_TALK_BASE_URL",
      usernameEnv: "NEXTCLOUD_TALK_USERNAME",
      appPasswordEnv: "NEXTCLOUD_TALK_APP_PASSWORD",
      roomTokenEnv: "NEXTCLOUD_TALK_ROOM_TOKEN",
      roomsEnv: "NEXTCLOUD_TALK_ROOMS",
      rooms: {},
      allowedRoomIds: [],
      defaultRoomIds: [],
      sendTimeoutMs: 30_000
    },
    webex: {
      enabled: false,
      accessTokenEnv: "WEBEX_ACCESS_TOKEN",
      allowedRoomIds: [],
      defaultRoomIds: [],
      sendTimeoutMs: 30_000
    },
    zulip: {
      enabled: false,
      siteUrlEnv: "ZULIP_SITE_URL",
      botEmailEnv: "ZULIP_BOT_EMAIL",
      apiKeyEnv: "ZULIP_API_KEY",
      targetEnv: "ZULIP_TARGET",
      targetsEnv: "ZULIP_TARGETS",
      targets: {},
      allowedTargetIds: [],
      defaultTargetIds: [],
      sendTimeoutMs: 30_000
    },
    email: {
      enabled: false,
      sendmailCommandEnv: "EMAIL_SENDMAIL_COMMAND",
      sendmailCommand: "sendmail",
      fromEnv: "EMAIL_FROM",
      recipientEnv: "EMAIL_RECIPIENT",
      recipientsEnv: "EMAIL_RECIPIENTS",
      recipients: {},
      allowedRecipientIds: [],
      defaultRecipientIds: [],
      sendTimeoutMs: 30_000
    },
    github: {
      enabled: false,
      tokenEnv: "GITHUB_TOKEN",
      targetEnv: "GITHUB_ISSUE_TARGET",
      targetsEnv: "GITHUB_ISSUE_TARGETS",
      targets: {},
      allowedTargetIds: [],
      defaultTargetIds: [],
      sendTimeoutMs: 30_000
    },
    todoist: {
      enabled: false,
      tokenEnv: "TODOIST_API_TOKEN",
      projectEnv: "TODOIST_PROJECT_ID",
      projectsEnv: "TODOIST_PROJECTS",
      projects: {},
      allowedProjectIds: [],
      defaultProjectIds: [],
      sendTimeoutMs: 30_000
    },
    notion: {
      enabled: false,
      tokenEnv: "NOTION_TOKEN",
      pageEnv: "NOTION_PAGE_ID",
      pagesEnv: "NOTION_PAGES",
      pages: {},
      allowedPageIds: [],
      defaultPageIds: [],
      sendTimeoutMs: 30_000
    },
    obsidian: {
      enabled: false,
      vaultDirEnv: "OBSIDIAN_VAULT_DIR",
      noteEnv: "OBSIDIAN_NOTE",
      notesEnv: "OBSIDIAN_NOTES",
      notes: {},
      allowedNoteIds: [],
      defaultNoteIds: [],
      maxMessageChars: 20_000
    }
  },
  providers: {
    codex: {
      id: "codex",
      label: "OpenAI Codex CLI",
      command: "codex",
      args: [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "-"
      ],
      promptMode: "stdin",
      timeoutMs: 600_000,
      loginHint: "Run `codex login` once in your terminal, then use this provider."
    },
    gpt: {
      id: "gpt",
      label: "GPT through Codex CLI",
      command: "codex",
      args: [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "-"
      ],
      promptMode: "stdin",
      timeoutMs: 600_000,
      loginHint: "Run `codex login`; this alias routes GPT-style requests through the logged-in Codex CLI."
    },
    gemini: {
      id: "gemini",
      label: "Gemini CLI",
      command: "gemini",
      args: ["--prompt", "{prompt}", "--approval-mode", "plan"],
      promptMode: "template",
      timeoutMs: 600_000,
      loginHint: "Run `gemini` interactively once and complete the browser login."
    },
    claude: {
      id: "claude",
      label: "Claude Code CLI",
      command: "claude",
      args: ["-p", "{prompt}"],
      promptMode: "template",
      timeoutMs: 600_000,
      loginHint: "Install Claude Code, then run `claude` once and complete account login."
    }
  }
};

export interface LoadConfigOptions {
  configPath?: string;
  baseDir?: string;
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<ViserConfig> {
  const baseDir = options.baseDir ?? cwd();
  const configPath = findConfigPath(baseDir, options.configPath);
  if (configPath) await assertNoSymlinkComponentsUnderRoot(configPath, baseDir);
  const userConfig = configPath ? await readJsonFile<Partial<ViserConfig>>(configPath) : {};
  const merged = deepMerge(DEFAULT_CONFIG, userConfig) as ViserConfig;

  assertValidConfig(merged);

  // Environment variables are convenient for secrets and runtime switching.
  if (env.VISER_PROVIDER) merged.assistant.defaultProvider = env.VISER_PROVIDER;

  assertValidConfig(merged);

  const telegramEnvName = merged.connectors.telegram.botTokenEnv;
  const browserUseApiKeyEnvName = merged.actions.browserTask.browserUseApiKeyEnv;
  const browserbaseApiKeyEnvName = merged.actions.browserTask.browserbaseApiKeyEnv;
  const browserbaseProjectIdEnvName = merged.actions.browserTask.browserbaseProjectIdEnv;
  const browserTaskFirecrawlApiKeyEnvName = merged.actions.browserTask.firecrawlApiKeyEnv;
  const browserCdpBaseUrlEnvName = merged.actions.browserTask.localCdpBaseUrlEnv;
  const discordEnvName = merged.connectors.discord.botTokenEnv;
  const slackBotEnvName = merged.connectors.slack.botTokenEnv;
  const slackAppEnvName = merged.connectors.slack.appTokenEnv;
  const slackBotUserIdEnvName = merged.connectors.slack.botUserIdEnv;
  const matrixHomeserverEnvName = merged.connectors.matrix.homeserverUrlEnv;
  const matrixAccessTokenEnvName = merged.connectors.matrix.accessTokenEnv;
  const matrixUserIdEnvName = merged.connectors.matrix.userIdEnv;
  const signalCommandEnvName = merged.connectors.signal.commandEnv;
  const signalAccountEnvName = merged.connectors.signal.accountEnv;
  const imessageSqliteCommandEnvName = merged.connectors.imessage.sqliteCommandEnv;
  const imessageOsascriptCommandEnvName = merged.connectors.imessage.osascriptCommandEnv;
  const imessageChatDbPathEnvName = merged.connectors.imessage.chatDbPathEnv;
  const whatsappAccessTokenEnvName = merged.connectors.whatsapp.accessTokenEnv;
  const whatsappPhoneNumberIdEnvName = merged.connectors.whatsapp.phoneNumberIdEnv;
  const whatsappVerifyTokenEnvName = merged.connectors.whatsapp.verifyTokenEnv;
  const whatsappGraphApiVersionEnvName = merged.connectors.whatsapp.graphApiVersionEnv;
  const lineChannelAccessTokenEnvName = merged.connectors.line.channelAccessTokenEnv;
  const lineChannelSecretEnvName = merged.connectors.line.channelSecretEnv;
  const kakaotalkRequestTokenEnvName = merged.connectors.kakaotalk.requestTokenEnv;
  const googleChatWebhookUrlEnvName = merged.connectors.googleChat.webhookUrlEnv;
  const googleChatWebhookUrlsEnvName = merged.connectors.googleChat.webhookUrlsEnv;
  const genericWebhookUrlEnvName = merged.connectors.webhook.webhookUrlEnv;
  const genericWebhookUrlsEnvName = merged.connectors.webhook.webhookUrlsEnv;
  const genericWebhookInboundTokenEnvName = merged.connectors.webhook.inboundTokenEnv;
  const genericWebhookInboundSignatureSecretEnvName = merged.connectors.webhook.inboundSignatureSecretEnv;
  const homeAssistantBaseUrlEnvName = merged.connectors.homeAssistant.baseUrlEnv;
  const homeAssistantAccessTokenEnvName = merged.connectors.homeAssistant.accessTokenEnv;
  const homeAssistantServiceEnvName = merged.connectors.homeAssistant.serviceEnv;
  const homeAssistantServicesEnvName = merged.connectors.homeAssistant.servicesEnv;
  const teamsWebhookUrlEnvName = merged.connectors.teams.webhookUrlEnv;
  const teamsWebhookUrlsEnvName = merged.connectors.teams.webhookUrlsEnv;
  const mattermostWebhookUrlEnvName = merged.connectors.mattermost.webhookUrlEnv;
  const mattermostWebhookUrlsEnvName = merged.connectors.mattermost.webhookUrlsEnv;
  const synologyChatWebhookUrlEnvName = merged.connectors.synologyChat.webhookUrlEnv;
  const synologyChatWebhookUrlsEnvName = merged.connectors.synologyChat.webhookUrlsEnv;
  const rocketChatWebhookUrlEnvName = merged.connectors.rocketChat.webhookUrlEnv;
  const rocketChatWebhookUrlsEnvName = merged.connectors.rocketChat.webhookUrlsEnv;
  const feishuWebhookUrlEnvName = merged.connectors.feishu.webhookUrlEnv;
  const feishuWebhookUrlsEnvName = merged.connectors.feishu.webhookUrlsEnv;
  const dingTalkWebhookUrlEnvName = merged.connectors.dingtalk.webhookUrlEnv;
  const dingTalkWebhookUrlsEnvName = merged.connectors.dingtalk.webhookUrlsEnv;
  const weComWebhookUrlEnvName = merged.connectors.wecom.webhookUrlEnv;
  const weComWebhookUrlsEnvName = merged.connectors.wecom.webhookUrlsEnv;
  const zaloAccessTokenEnvName = merged.connectors.zalo.accessTokenEnv;
  const zaloRecipientEnvName = merged.connectors.zalo.recipientEnv;
  const zaloRecipientsEnvName = merged.connectors.zalo.recipientsEnv;
  const ircHostEnvName = merged.connectors.irc.hostEnv;
  const ircPortEnvName = merged.connectors.irc.portEnv;
  const ircTlsEnvName = merged.connectors.irc.tlsEnv;
  const ircNickEnvName = merged.connectors.irc.nickEnv;
  const ircPasswordEnvName = merged.connectors.irc.passwordEnv;
  const ircChannelEnvName = merged.connectors.irc.channelEnv;
  const ircChannelsEnvName = merged.connectors.irc.channelsEnv;
  const twitchAccessTokenEnvName = merged.connectors.twitch.accessTokenEnv;
  const twitchBotUsernameEnvName = merged.connectors.twitch.botUsernameEnv;
  const twitchChannelEnvName = merged.connectors.twitch.channelEnv;
  const twitchChannelsEnvName = merged.connectors.twitch.channelsEnv;
  const ntfyBaseUrlEnvName = merged.connectors.ntfy.baseUrlEnv;
  const ntfyTokenEnvName = merged.connectors.ntfy.tokenEnv;
  const ntfyTopicEnvName = merged.connectors.ntfy.topicEnv;
  const ntfyTopicsEnvName = merged.connectors.ntfy.topicsEnv;
  const mastodonBaseUrlEnvName = merged.connectors.mastodon.baseUrlEnv;
  const mastodonAccessTokenEnvName = merged.connectors.mastodon.accessTokenEnv;
  const mastodonVisibilityEnvName = merged.connectors.mastodon.visibilityEnv;
  const mastodonTargetsEnvName = merged.connectors.mastodon.targetsEnv;
  const nextcloudTalkBaseUrlEnvName = merged.connectors.nextcloudTalk.baseUrlEnv;
  const nextcloudTalkUsernameEnvName = merged.connectors.nextcloudTalk.usernameEnv;
  const nextcloudTalkAppPasswordEnvName = merged.connectors.nextcloudTalk.appPasswordEnv;
  const nextcloudTalkRoomTokenEnvName = merged.connectors.nextcloudTalk.roomTokenEnv;
  const nextcloudTalkRoomsEnvName = merged.connectors.nextcloudTalk.roomsEnv;
  const webexAccessTokenEnvName = merged.connectors.webex.accessTokenEnv;
  const zulipSiteUrlEnvName = merged.connectors.zulip.siteUrlEnv;
  const zulipBotEmailEnvName = merged.connectors.zulip.botEmailEnv;
  const zulipApiKeyEnvName = merged.connectors.zulip.apiKeyEnv;
  const zulipTargetEnvName = merged.connectors.zulip.targetEnv;
  const zulipTargetsEnvName = merged.connectors.zulip.targetsEnv;
  const emailSendmailCommandEnvName = merged.connectors.email.sendmailCommandEnv;
  const emailFromEnvName = merged.connectors.email.fromEnv;
  const emailRecipientEnvName = merged.connectors.email.recipientEnv;
  const emailRecipientsEnvName = merged.connectors.email.recipientsEnv;
  const githubTokenEnvName = merged.connectors.github.tokenEnv;
  const githubTargetEnvName = merged.connectors.github.targetEnv;
  const githubTargetsEnvName = merged.connectors.github.targetsEnv;
  const todoistTokenEnvName = merged.connectors.todoist.tokenEnv;
  const todoistProjectEnvName = merged.connectors.todoist.projectEnv;
  const todoistProjectsEnvName = merged.connectors.todoist.projectsEnv;
  const notionTokenEnvName = merged.connectors.notion.tokenEnv;
  const notionPageEnvName = merged.connectors.notion.pageEnv;
  const notionPagesEnvName = merged.connectors.notion.pagesEnv;
  const obsidianVaultDirEnvName = merged.connectors.obsidian.vaultDirEnv;
  const obsidianNoteEnvName = merged.connectors.obsidian.noteEnv;
  const obsidianNotesEnvName = merged.connectors.obsidian.notesEnv;
  const webDashboardAuthTokenEnvName = merged.webDashboard.authTokenEnv;
  const webFetchFirecrawlApiKeyEnvName = merged.tools.webFetch.firecrawlApiKeyEnv;
  const braveApiKeyEnvName = merged.tools.webSearch.braveApiKeyEnv;
  const tavilyApiKeyEnvName = merged.tools.webSearch.tavilyApiKeyEnv;
  const perplexityApiKeyEnvName = merged.tools.webSearch.perplexityApiKeyEnv;
  const exaApiKeyEnvName = merged.tools.webSearch.exaApiKeyEnv;
  const firecrawlApiKeyEnvName = merged.tools.webSearch.firecrawlApiKeyEnv;
  const ollamaApiKeyEnvName = merged.tools.webSearch.ollamaApiKeyEnv;
  if (browserUseApiKeyEnvName && env[browserUseApiKeyEnvName]) merged.actions.browserTask.browserUseApiKey = env[browserUseApiKeyEnvName];
  if (browserbaseApiKeyEnvName && env[browserbaseApiKeyEnvName]) merged.actions.browserTask.browserbaseApiKey = env[browserbaseApiKeyEnvName];
  if (browserbaseProjectIdEnvName && env[browserbaseProjectIdEnvName]) merged.actions.browserTask.browserbaseProjectId = env[browserbaseProjectIdEnvName];
  if (browserTaskFirecrawlApiKeyEnvName && env[browserTaskFirecrawlApiKeyEnvName]) merged.actions.browserTask.firecrawlApiKey = env[browserTaskFirecrawlApiKeyEnvName];
  if (browserCdpBaseUrlEnvName && env[browserCdpBaseUrlEnvName]) merged.actions.browserTask.localCdpBaseUrl = env[browserCdpBaseUrlEnvName];
  if (telegramEnvName && env[telegramEnvName]) merged.connectors.telegram.botToken = env[telegramEnvName];
  if (discordEnvName && env[discordEnvName]) merged.connectors.discord.botToken = env[discordEnvName];
  if (slackBotEnvName && env[slackBotEnvName]) merged.connectors.slack.botToken = env[slackBotEnvName];
  if (slackAppEnvName && env[slackAppEnvName]) merged.connectors.slack.appToken = env[slackAppEnvName];
  if (slackBotUserIdEnvName && env[slackBotUserIdEnvName]) merged.connectors.slack.botUserId = env[slackBotUserIdEnvName];
  if (matrixHomeserverEnvName && env[matrixHomeserverEnvName]) merged.connectors.matrix.homeserverUrl = env[matrixHomeserverEnvName];
  if (matrixAccessTokenEnvName && env[matrixAccessTokenEnvName]) merged.connectors.matrix.accessToken = env[matrixAccessTokenEnvName];
  if (matrixUserIdEnvName && env[matrixUserIdEnvName]) merged.connectors.matrix.userId = env[matrixUserIdEnvName];
  if (signalCommandEnvName && env[signalCommandEnvName]) merged.connectors.signal.command = env[signalCommandEnvName];
  if (signalAccountEnvName && env[signalAccountEnvName]) merged.connectors.signal.account = env[signalAccountEnvName];
  if (imessageSqliteCommandEnvName && env[imessageSqliteCommandEnvName]) merged.connectors.imessage.sqliteCommand = env[imessageSqliteCommandEnvName];
  if (imessageOsascriptCommandEnvName && env[imessageOsascriptCommandEnvName]) merged.connectors.imessage.osascriptCommand = env[imessageOsascriptCommandEnvName];
  if (imessageChatDbPathEnvName && env[imessageChatDbPathEnvName]) merged.connectors.imessage.chatDbPath = env[imessageChatDbPathEnvName];
  if (whatsappAccessTokenEnvName && env[whatsappAccessTokenEnvName]) merged.connectors.whatsapp.accessToken = env[whatsappAccessTokenEnvName];
  if (whatsappPhoneNumberIdEnvName && env[whatsappPhoneNumberIdEnvName]) merged.connectors.whatsapp.phoneNumberId = env[whatsappPhoneNumberIdEnvName];
  if (whatsappVerifyTokenEnvName && env[whatsappVerifyTokenEnvName]) merged.connectors.whatsapp.verifyToken = env[whatsappVerifyTokenEnvName];
  if (whatsappGraphApiVersionEnvName && env[whatsappGraphApiVersionEnvName]) merged.connectors.whatsapp.graphApiVersion = env[whatsappGraphApiVersionEnvName];
  if (lineChannelAccessTokenEnvName && env[lineChannelAccessTokenEnvName]) merged.connectors.line.channelAccessToken = env[lineChannelAccessTokenEnvName];
  if (lineChannelSecretEnvName && env[lineChannelSecretEnvName]) merged.connectors.line.channelSecret = env[lineChannelSecretEnvName];
  if (kakaotalkRequestTokenEnvName && env[kakaotalkRequestTokenEnvName]) merged.connectors.kakaotalk.requestToken = env[kakaotalkRequestTokenEnvName];
  if (googleChatWebhookUrlEnvName && env[googleChatWebhookUrlEnvName]) merged.connectors.googleChat.webhookUrl = env[googleChatWebhookUrlEnvName];
  if (googleChatWebhookUrlsEnvName && env[googleChatWebhookUrlsEnvName]) {
    merged.connectors.googleChat.webhookUrls = {
      ...merged.connectors.googleChat.webhookUrls,
      ...parseWebhookUrlMap(env[googleChatWebhookUrlsEnvName])
    };
  }
  if (genericWebhookUrlEnvName && env[genericWebhookUrlEnvName]) merged.connectors.webhook.webhookUrl = env[genericWebhookUrlEnvName];
  if (genericWebhookUrlsEnvName && env[genericWebhookUrlsEnvName]) {
    merged.connectors.webhook.webhookUrls = {
      ...merged.connectors.webhook.webhookUrls,
      ...parseGenericWebhookUrlMap(env[genericWebhookUrlsEnvName])
    };
  }
  if (genericWebhookInboundTokenEnvName && env[genericWebhookInboundTokenEnvName]) merged.connectors.webhook.inboundToken = env[genericWebhookInboundTokenEnvName];
  if (genericWebhookInboundSignatureSecretEnvName && env[genericWebhookInboundSignatureSecretEnvName]) merged.connectors.webhook.inboundSignatureSecret = env[genericWebhookInboundSignatureSecretEnvName];
  if (homeAssistantBaseUrlEnvName && env[homeAssistantBaseUrlEnvName]) merged.connectors.homeAssistant.baseUrl = env[homeAssistantBaseUrlEnvName];
  if (homeAssistantAccessTokenEnvName && env[homeAssistantAccessTokenEnvName]) merged.connectors.homeAssistant.accessToken = env[homeAssistantAccessTokenEnvName];
  if (homeAssistantServiceEnvName && env[homeAssistantServiceEnvName]) merged.connectors.homeAssistant.service = env[homeAssistantServiceEnvName];
  if (homeAssistantServicesEnvName && env[homeAssistantServicesEnvName]) {
    merged.connectors.homeAssistant.services = {
      ...merged.connectors.homeAssistant.services,
      ...parseHomeAssistantServiceMap(env[homeAssistantServicesEnvName])
    };
  }
  if (teamsWebhookUrlEnvName && env[teamsWebhookUrlEnvName]) merged.connectors.teams.webhookUrl = env[teamsWebhookUrlEnvName];
  if (teamsWebhookUrlsEnvName && env[teamsWebhookUrlsEnvName]) {
    merged.connectors.teams.webhookUrls = {
      ...merged.connectors.teams.webhookUrls,
      ...parseTeamsWebhookUrlMap(env[teamsWebhookUrlsEnvName])
    };
  }
  if (mattermostWebhookUrlEnvName && env[mattermostWebhookUrlEnvName]) merged.connectors.mattermost.webhookUrl = env[mattermostWebhookUrlEnvName];
  if (mattermostWebhookUrlsEnvName && env[mattermostWebhookUrlsEnvName]) {
    merged.connectors.mattermost.webhookUrls = {
      ...merged.connectors.mattermost.webhookUrls,
      ...parseMattermostWebhookUrlMap(env[mattermostWebhookUrlsEnvName])
    };
  }
  if (synologyChatWebhookUrlEnvName && env[synologyChatWebhookUrlEnvName]) merged.connectors.synologyChat.webhookUrl = env[synologyChatWebhookUrlEnvName];
  if (synologyChatWebhookUrlsEnvName && env[synologyChatWebhookUrlsEnvName]) {
    merged.connectors.synologyChat.webhookUrls = {
      ...merged.connectors.synologyChat.webhookUrls,
      ...parseSynologyChatWebhookUrlMap(env[synologyChatWebhookUrlsEnvName])
    };
  }
  if (rocketChatWebhookUrlEnvName && env[rocketChatWebhookUrlEnvName]) merged.connectors.rocketChat.webhookUrl = env[rocketChatWebhookUrlEnvName];
  if (rocketChatWebhookUrlsEnvName && env[rocketChatWebhookUrlsEnvName]) {
    merged.connectors.rocketChat.webhookUrls = {
      ...merged.connectors.rocketChat.webhookUrls,
      ...parseRocketChatWebhookUrlMap(env[rocketChatWebhookUrlsEnvName])
    };
  }
  if (feishuWebhookUrlEnvName && env[feishuWebhookUrlEnvName]) merged.connectors.feishu.webhookUrl = env[feishuWebhookUrlEnvName];
  if (feishuWebhookUrlsEnvName && env[feishuWebhookUrlsEnvName]) {
    merged.connectors.feishu.webhookUrls = {
      ...merged.connectors.feishu.webhookUrls,
      ...parseFeishuWebhookUrlMap(env[feishuWebhookUrlsEnvName])
    };
  }
  if (dingTalkWebhookUrlEnvName && env[dingTalkWebhookUrlEnvName]) merged.connectors.dingtalk.webhookUrl = env[dingTalkWebhookUrlEnvName];
  if (dingTalkWebhookUrlsEnvName && env[dingTalkWebhookUrlsEnvName]) {
    merged.connectors.dingtalk.webhookUrls = {
      ...merged.connectors.dingtalk.webhookUrls,
      ...parseDingTalkWebhookUrlMap(env[dingTalkWebhookUrlsEnvName])
    };
  }
  if (weComWebhookUrlEnvName && env[weComWebhookUrlEnvName]) merged.connectors.wecom.webhookUrl = env[weComWebhookUrlEnvName];
  if (weComWebhookUrlsEnvName && env[weComWebhookUrlsEnvName]) {
    merged.connectors.wecom.webhookUrls = {
      ...merged.connectors.wecom.webhookUrls,
      ...parseWeComWebhookUrlMap(env[weComWebhookUrlsEnvName])
    };
  }
  if (zaloAccessTokenEnvName && env[zaloAccessTokenEnvName]) merged.connectors.zalo.accessToken = env[zaloAccessTokenEnvName];
  if (zaloRecipientEnvName && env[zaloRecipientEnvName]) merged.connectors.zalo.recipient = env[zaloRecipientEnvName];
  if (zaloRecipientsEnvName && env[zaloRecipientsEnvName]) {
    merged.connectors.zalo.recipients = {
      ...merged.connectors.zalo.recipients,
      ...parseZaloRecipientMap(env[zaloRecipientsEnvName])
    };
  }
  if (ircHostEnvName && env[ircHostEnvName]) merged.connectors.irc.host = env[ircHostEnvName];
  if (ircPortEnvName && env[ircPortEnvName]) merged.connectors.irc.port = parseEnvInteger(env[ircPortEnvName], ircPortEnvName);
  if (ircTlsEnvName && env[ircTlsEnvName]) merged.connectors.irc.tls = parseEnvBoolean(env[ircTlsEnvName], ircTlsEnvName);
  if (ircNickEnvName && env[ircNickEnvName]) merged.connectors.irc.nick = env[ircNickEnvName];
  if (ircPasswordEnvName && env[ircPasswordEnvName]) merged.connectors.irc.password = env[ircPasswordEnvName];
  if (ircChannelEnvName && env[ircChannelEnvName]) merged.connectors.irc.channel = env[ircChannelEnvName];
  if (ircChannelsEnvName && env[ircChannelsEnvName]) {
    merged.connectors.irc.channels = {
      ...merged.connectors.irc.channels,
      ...parseIrcChannelMap(env[ircChannelsEnvName])
    };
  }
  if (twitchAccessTokenEnvName && env[twitchAccessTokenEnvName]) merged.connectors.twitch.accessToken = env[twitchAccessTokenEnvName];
  if (twitchBotUsernameEnvName && env[twitchBotUsernameEnvName]) merged.connectors.twitch.botUsername = env[twitchBotUsernameEnvName];
  if (twitchChannelEnvName && env[twitchChannelEnvName]) merged.connectors.twitch.channel = env[twitchChannelEnvName];
  if (twitchChannelsEnvName && env[twitchChannelsEnvName]) {
    merged.connectors.twitch.channels = {
      ...merged.connectors.twitch.channels,
      ...parseTwitchChannelMap(env[twitchChannelsEnvName])
    };
  }
  if (ntfyBaseUrlEnvName && env[ntfyBaseUrlEnvName]) merged.connectors.ntfy.baseUrl = env[ntfyBaseUrlEnvName];
  if (ntfyTokenEnvName && env[ntfyTokenEnvName]) merged.connectors.ntfy.token = env[ntfyTokenEnvName];
  if (ntfyTopicEnvName && env[ntfyTopicEnvName]) merged.connectors.ntfy.topic = env[ntfyTopicEnvName];
  if (ntfyTopicsEnvName && env[ntfyTopicsEnvName]) {
    merged.connectors.ntfy.topics = {
      ...merged.connectors.ntfy.topics,
      ...parseNtfyTopicMap(env[ntfyTopicsEnvName])
    };
  }
  if (mastodonBaseUrlEnvName && env[mastodonBaseUrlEnvName]) merged.connectors.mastodon.baseUrl = env[mastodonBaseUrlEnvName];
  if (mastodonAccessTokenEnvName && env[mastodonAccessTokenEnvName]) merged.connectors.mastodon.accessToken = env[mastodonAccessTokenEnvName];
  if (mastodonVisibilityEnvName && env[mastodonVisibilityEnvName]) merged.connectors.mastodon.visibility = normalizeMastodonVisibility(env[mastodonVisibilityEnvName]);
  if (mastodonTargetsEnvName && env[mastodonTargetsEnvName]) {
    merged.connectors.mastodon.targets = {
      ...merged.connectors.mastodon.targets,
      ...parseMastodonTargetMap(env[mastodonTargetsEnvName])
    };
  }
  if (nextcloudTalkBaseUrlEnvName && env[nextcloudTalkBaseUrlEnvName]) merged.connectors.nextcloudTalk.baseUrl = env[nextcloudTalkBaseUrlEnvName];
  if (nextcloudTalkUsernameEnvName && env[nextcloudTalkUsernameEnvName]) merged.connectors.nextcloudTalk.username = env[nextcloudTalkUsernameEnvName];
  if (nextcloudTalkAppPasswordEnvName && env[nextcloudTalkAppPasswordEnvName]) merged.connectors.nextcloudTalk.appPassword = env[nextcloudTalkAppPasswordEnvName];
  if (nextcloudTalkRoomTokenEnvName && env[nextcloudTalkRoomTokenEnvName]) merged.connectors.nextcloudTalk.roomToken = env[nextcloudTalkRoomTokenEnvName];
  if (nextcloudTalkRoomsEnvName && env[nextcloudTalkRoomsEnvName]) {
    merged.connectors.nextcloudTalk.rooms = {
      ...merged.connectors.nextcloudTalk.rooms,
      ...parseNextcloudTalkRoomMap(env[nextcloudTalkRoomsEnvName])
    };
  }
  if (webexAccessTokenEnvName && env[webexAccessTokenEnvName]) merged.connectors.webex.accessToken = env[webexAccessTokenEnvName];
  if (zulipSiteUrlEnvName && env[zulipSiteUrlEnvName]) merged.connectors.zulip.siteUrl = env[zulipSiteUrlEnvName];
  if (zulipBotEmailEnvName && env[zulipBotEmailEnvName]) merged.connectors.zulip.botEmail = env[zulipBotEmailEnvName];
  if (zulipApiKeyEnvName && env[zulipApiKeyEnvName]) merged.connectors.zulip.apiKey = env[zulipApiKeyEnvName];
  if (zulipTargetEnvName && env[zulipTargetEnvName]) merged.connectors.zulip.target = env[zulipTargetEnvName];
  if (zulipTargetsEnvName && env[zulipTargetsEnvName]) {
    merged.connectors.zulip.targets = {
      ...merged.connectors.zulip.targets,
      ...parseZulipTargetMap(env[zulipTargetsEnvName])
    };
  }
  if (emailSendmailCommandEnvName && env[emailSendmailCommandEnvName]) merged.connectors.email.sendmailCommand = env[emailSendmailCommandEnvName];
  if (emailFromEnvName && env[emailFromEnvName]) merged.connectors.email.from = env[emailFromEnvName];
  if (emailRecipientEnvName && env[emailRecipientEnvName]) merged.connectors.email.recipient = env[emailRecipientEnvName];
  if (emailRecipientsEnvName && env[emailRecipientsEnvName]) {
    merged.connectors.email.recipients = {
      ...merged.connectors.email.recipients,
      ...parseEmailRecipientMap(env[emailRecipientsEnvName])
    };
  }
  if (githubTokenEnvName && env[githubTokenEnvName]) merged.connectors.github.token = env[githubTokenEnvName];
  if (githubTargetEnvName && env[githubTargetEnvName]) merged.connectors.github.target = env[githubTargetEnvName];
  if (githubTargetsEnvName && env[githubTargetsEnvName]) {
    merged.connectors.github.targets = {
      ...merged.connectors.github.targets,
      ...parseGitHubIssueTargetMap(env[githubTargetsEnvName])
    };
  }
  if (todoistTokenEnvName && env[todoistTokenEnvName]) merged.connectors.todoist.token = env[todoistTokenEnvName];
  if (todoistProjectEnvName && env[todoistProjectEnvName]) merged.connectors.todoist.project = env[todoistProjectEnvName];
  if (todoistProjectsEnvName && env[todoistProjectsEnvName]) {
    merged.connectors.todoist.projects = {
      ...merged.connectors.todoist.projects,
      ...parseTodoistProjectMap(env[todoistProjectsEnvName])
    };
  }
  if (notionTokenEnvName && env[notionTokenEnvName]) merged.connectors.notion.token = env[notionTokenEnvName];
  if (notionPageEnvName && env[notionPageEnvName]) merged.connectors.notion.page = env[notionPageEnvName];
  if (notionPagesEnvName && env[notionPagesEnvName]) {
    merged.connectors.notion.pages = {
      ...merged.connectors.notion.pages,
      ...parseNotionPageMap(env[notionPagesEnvName])
    };
  }
  if (obsidianVaultDirEnvName && env[obsidianVaultDirEnvName]) merged.connectors.obsidian.vaultDir = env[obsidianVaultDirEnvName];
  if (obsidianNoteEnvName && env[obsidianNoteEnvName]) merged.connectors.obsidian.note = env[obsidianNoteEnvName];
  if (obsidianNotesEnvName && env[obsidianNotesEnvName]) {
    merged.connectors.obsidian.notes = {
      ...merged.connectors.obsidian.notes,
      ...parseObsidianNoteMap(env[obsidianNotesEnvName])
    };
  }
  if (webDashboardAuthTokenEnvName && env[webDashboardAuthTokenEnvName]) {
    merged.webDashboard.authToken = env[webDashboardAuthTokenEnvName];
  }
  if (webFetchFirecrawlApiKeyEnvName && env[webFetchFirecrawlApiKeyEnvName]) {
    merged.tools.webFetch.firecrawlApiKey = env[webFetchFirecrawlApiKeyEnvName];
  }
  if (braveApiKeyEnvName && env[braveApiKeyEnvName]) {
    merged.tools.webSearch.braveApiKey = env[braveApiKeyEnvName];
  }
  if (tavilyApiKeyEnvName && env[tavilyApiKeyEnvName]) {
    merged.tools.webSearch.tavilyApiKey = env[tavilyApiKeyEnvName];
  }
  if (perplexityApiKeyEnvName && env[perplexityApiKeyEnvName]) {
    merged.tools.webSearch.perplexityApiKey = env[perplexityApiKeyEnvName];
  }
  if (exaApiKeyEnvName && env[exaApiKeyEnvName]) {
    merged.tools.webSearch.exaApiKey = env[exaApiKeyEnvName];
  }
  if (firecrawlApiKeyEnvName && env[firecrawlApiKeyEnvName]) {
    merged.tools.webSearch.firecrawlApiKey = env[firecrawlApiKeyEnvName];
  }
  if (ollamaApiKeyEnvName && env[ollamaApiKeyEnvName]) {
    merged.tools.webSearch.ollamaApiKey = env[ollamaApiKeyEnvName];
  }

  assertValidConfig(merged);

  merged.assistant.workdir = resolve(baseDir, merged.assistant.workdir);
  merged.storage.dir = resolve(baseDir, merged.storage.dir);
  merged.memory.dir = resolve(baseDir, merged.memory.dir);
  merged.personalization.dir = resolve(baseDir, merged.personalization.dir);
  merged.skills.dirs = merged.skills.dirs.map((dir) => resolve(baseDir, dir));
  merged.plugins.dirs = merged.plugins.dirs.map((dir) => resolve(baseDir, dir));
  merged.tools.allowedReadRoots = merged.tools.allowedReadRoots.map((dir) => resolve(baseDir, dir));
  if (merged.connectors.obsidian.vaultDir) {
    merged.connectors.obsidian.vaultDir = resolve(baseDir, merged.connectors.obsidian.vaultDir);
  }
  merged.scheduler.dir = resolve(baseDir, merged.scheduler.dir);
  merged.jobs.dir = resolve(baseDir, merged.jobs.dir);
  merged.webDashboard.canvasDir = resolve(baseDir, merged.webDashboard.canvasDir);
  merged.access.dir = resolve(baseDir, merged.access.dir);
  merged.actions.dir = resolve(baseDir, merged.actions.dir);
  merged.actions.allowedWriteRoots = merged.actions.allowedWriteRoots.map((dir) => resolve(baseDir, dir));
  merged.configPath = configPath;

  // Keep provider ids consistent even when a user omits the nested `id` field.
  for (const [id, provider] of Object.entries(merged.providers)) {
    provider.id = provider.id || id;
    if (provider.cwd) provider.cwd = resolve(baseDir, provider.cwd);
  }

  return merged;
}

function parseEnvInteger(value: string, name: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/u.test(trimmed)) throw new Error(`${name} must be an integer.`);
  return Number(trimmed);
}

function parseEnvBoolean(value: string, name: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name} must be true/false, 1/0, yes/no, or on/off.`);
}

export function findConfigPath(baseDir: string, explicitPath?: string): string | undefined {
  const envPath = env.VISER_CONFIG;
  if (explicitPath) return resolve(baseDir, explicitPath);
  if (envPath) return resolve(baseDir, envPath);

  const defaultPath = resolve(baseDir, "viser.config.json");
  if (pathExistsOrIsSymlink(defaultPath)) return defaultPath;

  return undefined;
}

export function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) return clonePlain((override ?? base) as T);

  const output = clonePlain(base) as Record<string, unknown>;
  for (const [key, value] of Object.entries(override)) {
    const current = output[key];
    output[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : clonePlain(value);
  }

  return output as T;
}

function clonePlain<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => clonePlain(item)) as T;
  if (!isPlainObject(value)) return value;

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) output[key] = clonePlain(child);
  return output as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pathExistsOrIsSymlink(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
