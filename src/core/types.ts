// ================================================================
// Core shared types
// ================================================================
// This file is intentionally dependency-free so every runtime surface
// (CLI, Discord, Telegram, gateway, and tests) can share the same contracts.

export type PromptMode = "stdin" | "template" | "argument";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  at: string;
  provider?: string;
}

export interface SessionSummary {
  id: string;
  path: string;
  messageCount: number;
  firstAt?: string;
  lastAt?: string;
  providers: string[];
  bytes: number;
}

export interface SessionSearchResult {
  sessionId: string;
  message: ChatMessage;
  messageIndex: number;
  score: number;
  preview: string;
}

export interface SessionCompactionResult {
  sessionId: string;
  beforeCount: number;
  afterCount: number;
  trimmedCount: number;
  beforeBytes: number;
  afterBytes: number;
  backupPath?: string;
}

export interface ProviderRequest {
  prompt: string;
  sessionId: string;
  providerId: string;
  onOutputChunk?: (chunk: ProviderOutputChunk) => void;
}

export interface ProviderResponse {
  text: string;
  providerId: string;
  elapsedMs: number;
}

export interface ProviderOutputChunk {
  stream: "stdout" | "stderr";
  text: string;
}

export interface ModelProvider {
  id: string;
  label: string;
  generate(request: ProviderRequest): Promise<ProviderResponse>;
}

export interface CliProviderConfig {
  id: string;
  label?: string;
  command: string;
  args: string[];
  promptMode: PromptMode;
  timeoutMs: number;
  maxOutputBytes?: number;
  cwd?: string;
  env?: Record<string, string>;
  loginHint?: string;
}

export interface AssistantConfig {
  name: string;
  defaultProvider: string;
  fallbackProviders: string[];
  systemPrompt: string;
  historyLimit: number;
  maxInputChars: number;
  workdir: string;
}

export interface TelegramConnectorConfig {
  enabled: boolean;
  botTokenEnv: string;
  botToken?: string;
  allowedChatIds: string[];
  defaultChatIds: string[];
  maxMessagesPerMinute: number;
  maxInputChars: number;
}

export interface DiscordConnectorConfig {
  enabled: boolean;
  botTokenEnv: string;
  botToken?: string;
  prefix: string;
  allowedChannelIds: string[];
  defaultChannelIds: string[];
  maxMessagesPerMinute: number;
  maxInputChars: number;
}

export interface SlackConnectorConfig {
  enabled: boolean;
  botTokenEnv: string;
  botToken?: string;
  appTokenEnv: string;
  appToken?: string;
  botUserIdEnv: string;
  botUserId?: string;
  prefix: string;
  allowedChannelIds: string[];
  defaultChannelIds: string[];
  maxMessagesPerMinute: number;
  maxInputChars: number;
}

export interface MatrixConnectorConfig {
  enabled: boolean;
  homeserverUrlEnv: string;
  homeserverUrl?: string;
  accessTokenEnv: string;
  accessToken?: string;
  userIdEnv: string;
  userId?: string;
  prefix: string;
  allowedRoomIds: string[];
  defaultRoomIds: string[];
  maxMessagesPerMinute: number;
  maxInputChars: number;
  pollTimeoutMs: number;
}

export interface SignalConnectorConfig {
  enabled: boolean;
  commandEnv: string;
  command: string;
  accountEnv: string;
  account?: string;
  allowedRecipientIds: string[];
  defaultRecipientIds: string[];
  maxMessagesPerMinute: number;
  maxInputChars: number;
  pollIntervalMs: number;
  receiveTimeoutMs: number;
  sendTimeoutMs: number;
}

export interface ImessageConnectorConfig {
  enabled: boolean;
  sqliteCommandEnv: string;
  sqliteCommand: string;
  osascriptCommandEnv: string;
  osascriptCommand: string;
  chatDbPathEnv: string;
  chatDbPath: string;
  allowedHandleIds: string[];
  defaultHandleIds: string[];
  maxMessagesPerMinute: number;
  maxInputChars: number;
  pollIntervalMs: number;
  queryTimeoutMs: number;
  sendTimeoutMs: number;
}

export interface WhatsappConnectorConfig {
  enabled: boolean;
  accessTokenEnv: string;
  accessToken?: string;
  phoneNumberIdEnv: string;
  phoneNumberId?: string;
  verifyTokenEnv: string;
  verifyToken?: string;
  graphApiVersionEnv: string;
  graphApiVersion: string;
  webhookHost: string;
  webhookPort: number;
  webhookPath: string;
  allowedRecipientIds: string[];
  defaultRecipientIds: string[];
  maxMessagesPerMinute: number;
  maxInputChars: number;
  sendTimeoutMs: number;
}

export interface LineConnectorConfig {
  enabled: boolean;
  channelAccessTokenEnv: string;
  channelAccessToken?: string;
  channelSecretEnv: string;
  channelSecret?: string;
  webhookHost: string;
  webhookPort: number;
  webhookPath: string;
  allowedPeerIds: string[];
  defaultPeerIds: string[];
  maxMessagesPerMinute: number;
  maxInputChars: number;
  sendTimeoutMs: number;
}

export interface KakaotalkConnectorConfig {
  enabled: boolean;
  requestTokenEnv: string;
  requestToken?: string;
  webhookHost: string;
  webhookPort: number;
  webhookPath: string;
  allowedUserIds: string[];
  defaultUserIds: string[];
  maxMessagesPerMinute: number;
  maxInputChars: number;
}

export interface GoogleChatConnectorConfig {
  enabled: boolean;
  webhookUrlEnv: string;
  webhookUrl?: string;
  webhookUrlsEnv: string;
  webhookUrls: Record<string, string>;
  allowedWebhookIds: string[];
  defaultWebhookIds: string[];
  sendTimeoutMs: number;
}

export interface GenericWebhookConnectorConfig {
  enabled: boolean;
  webhookUrlEnv: string;
  webhookUrl?: string;
  webhookUrlsEnv: string;
  webhookUrls: Record<string, string>;
  inboundEnabled?: boolean;
  inboundTokenEnv?: string;
  inboundToken?: string;
  inboundSignatureSecretEnv?: string;
  inboundSignatureSecret?: string;
  inboundSignatureToleranceMs?: number;
  inboundPath?: string;
  inboundMaxInputChars?: number;
  allowedWebhookIds: string[];
  defaultWebhookIds: string[];
  sendTimeoutMs: number;
}

export interface HomeAssistantConnectorConfig {
  enabled: boolean;
  baseUrlEnv: string;
  baseUrl?: string;
  accessTokenEnv: string;
  accessToken?: string;
  serviceEnv: string;
  service?: string;
  servicesEnv: string;
  services: Record<string, string>;
  allowedServiceIds: string[];
  defaultServiceIds: string[];
  sendTimeoutMs: number;
}

export interface TeamsConnectorConfig {
  enabled: boolean;
  webhookUrlEnv: string;
  webhookUrl?: string;
  webhookUrlsEnv: string;
  webhookUrls: Record<string, string>;
  allowedWebhookIds: string[];
  defaultWebhookIds: string[];
  sendTimeoutMs: number;
}

export interface MattermostConnectorConfig {
  enabled: boolean;
  webhookUrlEnv: string;
  webhookUrl?: string;
  webhookUrlsEnv: string;
  webhookUrls: Record<string, string>;
  allowedWebhookIds: string[];
  defaultWebhookIds: string[];
  sendTimeoutMs: number;
}

export interface SynologyChatConnectorConfig {
  enabled: boolean;
  webhookUrlEnv: string;
  webhookUrl?: string;
  webhookUrlsEnv: string;
  webhookUrls: Record<string, string>;
  allowedWebhookIds: string[];
  defaultWebhookIds: string[];
  sendTimeoutMs: number;
}

export interface RocketChatConnectorConfig {
  enabled: boolean;
  webhookUrlEnv: string;
  webhookUrl?: string;
  webhookUrlsEnv: string;
  webhookUrls: Record<string, string>;
  allowedWebhookIds: string[];
  defaultWebhookIds: string[];
  sendTimeoutMs: number;
}

export interface FeishuConnectorConfig {
  enabled: boolean;
  webhookUrlEnv: string;
  webhookUrl?: string;
  webhookUrlsEnv: string;
  webhookUrls: Record<string, string>;
  allowedWebhookIds: string[];
  defaultWebhookIds: string[];
  sendTimeoutMs: number;
}

export interface DingTalkConnectorConfig {
  enabled: boolean;
  webhookUrlEnv: string;
  webhookUrl?: string;
  webhookUrlsEnv: string;
  webhookUrls: Record<string, string>;
  allowedWebhookIds: string[];
  defaultWebhookIds: string[];
  sendTimeoutMs: number;
}

export interface WeComConnectorConfig {
  enabled: boolean;
  webhookUrlEnv: string;
  webhookUrl?: string;
  webhookUrlsEnv: string;
  webhookUrls: Record<string, string>;
  allowedWebhookIds: string[];
  defaultWebhookIds: string[];
  sendTimeoutMs: number;
}

export interface ZaloConnectorConfig {
  enabled: boolean;
  accessTokenEnv: string;
  accessToken?: string;
  recipientEnv: string;
  recipient?: string;
  recipientsEnv: string;
  recipients: Record<string, string>;
  allowedRecipientIds: string[];
  defaultRecipientIds: string[];
  sendTimeoutMs: number;
}

export interface IrcConnectorConfig {
  enabled: boolean;
  hostEnv: string;
  host?: string;
  portEnv: string;
  port: number;
  tlsEnv: string;
  tls: boolean;
  nickEnv: string;
  nick?: string;
  passwordEnv: string;
  password?: string;
  channelEnv: string;
  channel?: string;
  channelsEnv: string;
  channels: Record<string, string>;
  allowedChannelIds: string[];
  defaultChannelIds: string[];
  sendTimeoutMs: number;
}


export interface TwitchConnectorConfig {
  enabled: boolean;
  accessTokenEnv: string;
  accessToken?: string;
  botUsernameEnv: string;
  botUsername?: string;
  channelEnv: string;
  channel?: string;
  channelsEnv: string;
  channels: Record<string, string>;
  allowedChannelIds: string[];
  defaultChannelIds: string[];
  sendTimeoutMs: number;
}

export interface NtfyConnectorConfig {
  enabled: boolean;
  baseUrlEnv: string;
  baseUrl: string;
  tokenEnv: string;
  token?: string;
  topicEnv: string;
  topic?: string;
  topicsEnv: string;
  topics: Record<string, string>;
  allowedTopicIds: string[];
  defaultTopicIds: string[];
  sendTimeoutMs: number;
}

export interface MastodonConnectorConfig {
  enabled: boolean;
  baseUrlEnv: string;
  baseUrl?: string;
  accessTokenEnv: string;
  accessToken?: string;
  visibilityEnv: string;
  visibility: "public" | "unlisted" | "private" | "direct";
  targetsEnv: string;
  targets: Record<string, "public" | "unlisted" | "private" | "direct">;
  allowedTargetIds: string[];
  defaultTargetIds: string[];
  sendTimeoutMs: number;
}

export interface NextcloudTalkConnectorConfig {
  enabled: boolean;
  baseUrlEnv: string;
  baseUrl?: string;
  usernameEnv: string;
  username?: string;
  appPasswordEnv: string;
  appPassword?: string;
  roomTokenEnv: string;
  roomToken?: string;
  roomsEnv: string;
  rooms: Record<string, string>;
  allowedRoomIds: string[];
  defaultRoomIds: string[];
  sendTimeoutMs: number;
}

export interface WebexConnectorConfig {
  enabled: boolean;
  accessTokenEnv: string;
  accessToken?: string;
  allowedRoomIds: string[];
  defaultRoomIds: string[];
  sendTimeoutMs: number;
}

export interface ZulipConnectorConfig {
  enabled: boolean;
  siteUrlEnv: string;
  siteUrl?: string;
  botEmailEnv: string;
  botEmail?: string;
  apiKeyEnv: string;
  apiKey?: string;
  targetEnv: string;
  target?: string;
  targetsEnv: string;
  targets: Record<string, string>;
  allowedTargetIds: string[];
  defaultTargetIds: string[];
  sendTimeoutMs: number;
}

export interface EmailConnectorConfig {
  enabled: boolean;
  sendmailCommandEnv: string;
  sendmailCommand: string;
  fromEnv: string;
  from?: string;
  recipientEnv: string;
  recipient?: string;
  recipientsEnv: string;
  recipients: Record<string, string>;
  allowedRecipientIds: string[];
  defaultRecipientIds: string[];
  sendTimeoutMs: number;
}

export interface GitHubConnectorConfig {
  enabled: boolean;
  tokenEnv: string;
  token?: string;
  targetEnv: string;
  target?: string;
  targetsEnv: string;
  targets: Record<string, string>;
  allowedTargetIds: string[];
  defaultTargetIds: string[];
  sendTimeoutMs: number;
}

export interface TodoistConnectorConfig {
  enabled: boolean;
  tokenEnv: string;
  token?: string;
  projectEnv: string;
  project?: string;
  projectsEnv: string;
  projects: Record<string, string>;
  allowedProjectIds: string[];
  defaultProjectIds: string[];
  sendTimeoutMs: number;
}

export interface NotionConnectorConfig {
  enabled: boolean;
  tokenEnv: string;
  token?: string;
  pageEnv: string;
  page?: string;
  pagesEnv: string;
  pages: Record<string, string>;
  allowedPageIds: string[];
  defaultPageIds: string[];
  sendTimeoutMs: number;
}

export interface ObsidianConnectorConfig {
  enabled: boolean;
  vaultDirEnv: string;
  vaultDir?: string;
  noteEnv: string;
  note?: string;
  notesEnv: string;
  notes: Record<string, string>;
  allowedNoteIds: string[];
  defaultNoteIds: string[];
  maxMessageChars: number;
}

export interface StorageConfig {
  dir: string;
}

export interface MemoryConfig {
  enabled: boolean;
  dir: string;
  promptLimit: number;
}

export interface PersonalizationConfig {
  enabled: boolean;
  dir: string;
  promptLimit: number;
  maxValueChars: number;
}

export interface SkillsConfig {
  enabled: boolean;
  dirs: string[];
  promptLimit: number;
}

export interface PluginsConfig {
  enabled: boolean;
  dirs: string[];
  promptLimit: number;
}

export interface ToolShellConfig {
  enabled: boolean;
  allowedCommands: string[];
  timeoutMs: number;
}

export interface ToolWebFetchConfig {
  enabled: boolean;
  provider: "direct-http" | "firecrawl-api";
  extractMode: ToolWebFetchExtractMode;
  firecrawlApiKeyEnv: string;
  firecrawlApiKey?: string;
  maxResponseBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  cacheTtlMs: number;
  userAgent: string;
}

export type ToolWebFetchExtractMode = "text" | "markdown";

export interface ToolWebSearchConfig {
  enabled: boolean;
  provider: "duckduckgo-html" | "searxng-html" | "brave-api" | "tavily-api" | "perplexity-api" | "exa-api" | "firecrawl-api" | "ollama-api";
  searxngBaseUrl?: string;
  braveApiKeyEnv: string;
  braveApiKey?: string;
  tavilyApiKeyEnv: string;
  tavilyApiKey?: string;
  perplexityApiKeyEnv: string;
  perplexityApiKey?: string;
  exaApiKeyEnv: string;
  exaApiKey?: string;
  firecrawlApiKeyEnv: string;
  firecrawlApiKey?: string;
  ollamaBaseUrl: string;
  ollamaApiKeyEnv: string;
  ollamaApiKey?: string;
  maxResults: number;
  maxResponseBytes: number;
  timeoutMs: number;
  userAgent: string;
}

export interface ToolsConfig {
  enabled: boolean;
  allowedReadRoots: string[];
  maxReadBytes: number;
  shell: ToolShellConfig;
  webFetch: ToolWebFetchConfig;
  webSearch: ToolWebSearchConfig;
}

export interface SchedulerConfig {
  enabled: boolean;
  dir: string;
  tickMs: number;
}

export interface JobsConfig {
  enabled: boolean;
  dir: string;
  tickMs: number;
  concurrency: number;
}

export interface WebDashboardConfig {
  enabled: boolean;
  host: string;
  port: number;
  canvasDir: string;
  allowRemote: boolean;
  authTokenEnv: string;
  authToken?: string;
}

export type AccessConnector = "telegram" | "discord" | "slack" | "matrix" | "signal" | "imessage" | "whatsapp" | "line" | "kakaotalk" | "google-chat" | "webhook" | "home-assistant" | "teams" | "mattermost" | "synology-chat" | "rocket-chat" | "feishu" | "dingtalk" | "wecom" | "zalo" | "irc" | "twitch" | "ntfy" | "mastodon" | "nextcloud-talk" | "webex" | "zulip" | "email" | "github" | "todoist" | "notion" | "obsidian";

export interface AccessConfig {
  enabled: boolean;
  dir: string;
  defaultPolicy: "pairing" | "allowlist" | "open";
  pairingCodeTtlMs: number;
}

export interface ActionConfig {
  enabled: boolean;
  dir: string;
  allowedWriteRoots: string[];
  maxWriteBytes: number;
  createBackups: boolean;
  browserTask: BrowserTaskActionConfig;
}

export type BrowserTaskProvider = "browser-use-cloud" | "local-cdp" | "browserbase-session" | "firecrawl-interact";

export interface BrowserTaskActionConfig {
  enabled: boolean;
  provider: BrowserTaskProvider;
  browserUseBaseUrl: string;
  browserUseApiKeyEnv: string;
  browserUseApiKey?: string;
  browserbaseBaseUrl: string;
  browserbaseApiKeyEnv: string;
  browserbaseApiKey?: string;
  browserbaseProjectIdEnv: string;
  browserbaseProjectId?: string;
  browserbaseSessionTimeoutSeconds: number;
  browserbaseReleaseSession: boolean;
  firecrawlBaseUrl: string;
  firecrawlApiKeyEnv: string;
  firecrawlApiKey?: string;
  firecrawlInteractTimeoutSeconds: number;
  firecrawlStopSession: boolean;
  firecrawlMaxResultChars: number;
  localCdpBaseUrl: string;
  localCdpBaseUrlEnv: string;
  localCdpWaitMs: number;
  localCdpMaxContentChars: number;
  localCdpCloseTab: boolean;
  maxTaskChars: number;
  maxAgentSteps: number;
  allowedDomains: string[];
  timeoutMs: number;
}

export interface ViserConfig {
  assistant: AssistantConfig;
  storage: StorageConfig;
  memory: MemoryConfig;
  personalization: PersonalizationConfig;
  skills: SkillsConfig;
  plugins: PluginsConfig;
  tools: ToolsConfig;
  scheduler: SchedulerConfig;
  jobs: JobsConfig;
  webDashboard: WebDashboardConfig;
  access: AccessConfig;
  actions: ActionConfig;
  connectors: {
    telegram: TelegramConnectorConfig;
    discord: DiscordConnectorConfig;
    slack: SlackConnectorConfig;
    matrix: MatrixConnectorConfig;
    signal: SignalConnectorConfig;
    imessage: ImessageConnectorConfig;
    whatsapp: WhatsappConnectorConfig;
    line: LineConnectorConfig;
    kakaotalk: KakaotalkConnectorConfig;
    googleChat: GoogleChatConnectorConfig;
    webhook: GenericWebhookConnectorConfig;
    homeAssistant: HomeAssistantConnectorConfig;
    teams: TeamsConnectorConfig;
    mattermost: MattermostConnectorConfig;
    synologyChat: SynologyChatConnectorConfig;
    rocketChat: RocketChatConnectorConfig;
    feishu: FeishuConnectorConfig;
    dingtalk: DingTalkConnectorConfig;
    wecom: WeComConnectorConfig;
    zalo: ZaloConnectorConfig;
    irc: IrcConnectorConfig;
    twitch: TwitchConnectorConfig;
    ntfy: NtfyConnectorConfig;
    mastodon: MastodonConnectorConfig;
    nextcloudTalk: NextcloudTalkConnectorConfig;
    webex: WebexConnectorConfig;
    zulip: ZulipConnectorConfig;
    email: EmailConnectorConfig;
    github: GitHubConnectorConfig;
    todoist: TodoistConnectorConfig;
    notion: NotionConnectorConfig;
    obsidian: ObsidianConnectorConfig;
  };
  providers: Record<string, CliProviderConfig>;
  configPath?: string;
}

export interface AssistantHandleOptions {
  providerId?: string;
  source?: "cli" | "voice" | "web-chat" | "telegram" | "discord" | "slack" | "matrix" | "signal" | "imessage" | "whatsapp" | "line" | "kakaotalk" | "google-chat" | "webhook" | "home-assistant" | "teams" | "mattermost" | "synology-chat" | "rocket-chat" | "feishu" | "dingtalk" | "wecom" | "zalo" | "irc" | "twitch" | "ntfy" | "mastodon" | "nextcloud-talk" | "webex" | "zulip" | "email" | "github" | "todoist" | "notion" | "obsidian" | "test";
  onProviderOutputChunk?: (chunk: ProviderOutputChunk) => void;
  suppressProviderText?: boolean;
}

export interface AssistantCommandResult {
  handled: boolean;
  text?: string;
}

export type DashboardConnectorState = "enabled_with_token" | "enabled_missing_token" | "disabled_with_token" | "disabled";

export interface DashboardConnectorStatus {
  enabled: boolean;
  tokenConfigured: boolean;
  state: DashboardConnectorState;
  label: string;
}

export interface DashboardProviderStatus {
  id: string;
  label: string;
  command: string;
  installed: boolean;
  launchRoute: boolean;
}

export interface DashboardRecentSession {
  id: string;
  messageCount: number;
  firstAt?: string;
  lastAt?: string;
  providers: string[];
  bytes: number;
}

export interface DashboardNextSchedule {
  id: string;
  nextRunAt: string;
  prompt: string;
}

export interface DashboardJobPreview {
  id: string;
  status: QueuedJobStatus;
  attempts: number;
  source: QueuedJob["source"];
  providerId?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  nextAttemptAt?: string;
  promptPreview: string;
}

export interface DashboardPendingApprovalPreview {
  id: string;
  type: PendingAction["type"];
  targetPath: string;
  source: string;
  createdAt: string;
  preview: string;
}

export type DashboardActivityKind = "approval" | "job" | "schedule" | "session";
export type DashboardActivityTone = "ok" | "warn" | "bad" | "info";

export interface DashboardActivityItem {
  id: string;
  kind: DashboardActivityKind;
  title: string;
  status: string;
  detail: string;
  tone: DashboardActivityTone;
  at?: string;
  command?: string;
}

export interface DashboardOperatorActivity {
  count: number;
  items: DashboardActivityItem[];
}

export interface DashboardData {
  schemaVersion: 1;
  assistantName: string;
  generatedAt: string;
  sessionId: string;
  provider: string;
  fallbackRoute: string[];
  configPath: string | null;
  storageDir: string;
  runtime: {
    scheduler: {
      enabled: boolean;
      tickMs: number;
    };
    jobWorker: {
      enabled: boolean;
      tickMs: number;
      concurrency: number;
    };
    webDashboard: {
      enabled: boolean;
      host: string;
      port: number;
      canvasPersistence: "private-local-json";
      authRequired: boolean;
      allowRemote: boolean;
    };
    tools: {
      enabled: boolean;
    };
    actions: {
      enabled: boolean;
    };
    connectors: {
      telegram: DashboardConnectorStatus;
      discord: DashboardConnectorStatus;
      slack: DashboardConnectorStatus;
      matrix: DashboardConnectorStatus;
      signal: DashboardConnectorStatus;
      imessage: DashboardConnectorStatus;
      whatsapp: DashboardConnectorStatus;
      line: DashboardConnectorStatus;
      kakaotalk: DashboardConnectorStatus;
      googleChat: DashboardConnectorStatus;
      webhook: DashboardConnectorStatus;
      homeAssistant: DashboardConnectorStatus;
      teams: DashboardConnectorStatus;
      mattermost: DashboardConnectorStatus;
      synologyChat: DashboardConnectorStatus;
      rocketChat: DashboardConnectorStatus;
      feishu: DashboardConnectorStatus;
      dingtalk: DashboardConnectorStatus;
      wecom: DashboardConnectorStatus;
      zalo: DashboardConnectorStatus;
      irc: DashboardConnectorStatus;
      twitch: DashboardConnectorStatus;
      ntfy: DashboardConnectorStatus;
      mastodon: DashboardConnectorStatus;
      nextcloudTalk: DashboardConnectorStatus;
      webex: DashboardConnectorStatus;
      zulip: DashboardConnectorStatus;
      email: DashboardConnectorStatus;
      github: DashboardConnectorStatus;
      todoist: DashboardConnectorStatus;
      notion: DashboardConnectorStatus;
      obsidian: DashboardConnectorStatus;
    };
  };
  state: {
    currentSessionHistory: number;
    savedSessions: {
      count: number;
      recent: DashboardRecentSession[];
    };
    memories: {
      enabled: boolean;
      count: number;
    };
    personalization: {
      enabled: boolean;
      count: number;
    };
    skills: {
      enabled: boolean;
      count: number;
    };
    plugins: {
      enabled: boolean;
      count: number;
    };
    schedules: {
      enabled: boolean;
      total: number;
      enabledCount: number;
      next: DashboardNextSchedule[];
    };
    jobs: {
      enabled: boolean;
      pending: number;
      running: number;
      done: number;
      failed: number;
      cancelled: number;
      recent: DashboardJobPreview[];
    };
    pendingApprovals: {
      enabled: boolean;
      count: number;
      recent: DashboardPendingApprovalPreview[];
    };
    operatorActivity: DashboardOperatorActivity;
  };
  providers: DashboardProviderStatus[];
  capabilities: {
    readOnly: true;
    providerCalls: false;
    writeActions: false;
    jobExecution: false;
    liveProviderProof: false;
  };
  nextCommands: string[];
}

export interface MemoryEntry {
  id: string;
  text: string;
  tags: string[];
  source: string;
  createdAt: string;
}

export interface MemoryCompactionResult {
  beforeCount: number;
  afterCount: number;
  duplicateCount: number;
  trimmedCount: number;
  backupPath?: string;
}

export interface MemoryProfileGroup {
  tag: string;
  count: number;
  latestAt?: string;
  entries: MemoryEntry[];
}

export interface MemoryProfile {
  totalCount: number;
  generatedAt: string;
  groups: MemoryProfileGroup[];
  untagged: MemoryEntry[];
}

export interface PersonalizationSetting {
  key: string;
  value: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalizationState {
  version: 1;
  updatedAt?: string;
  settings: PersonalizationSetting[];
}

export interface SkillDefinition {
  id: string;
  title: string;
  description: string;
  body: string;
  path: string;
}

export interface PluginCommandDefinition {
  id: string;
  description: string;
  prompt: string;
}

export interface PluginDefinition {
  id: string;
  title: string;
  description: string;
  version?: string;
  capabilities: string[];
  commands: PluginCommandDefinition[];
  path: string;
  dir: string;
}

export interface PluginSelection {
  plugin: PluginDefinition;
  command: PluginCommandDefinition;
}

export interface ToolResult {
  ok: boolean;
  title: string;
  output: string;
}

export interface ScheduledDelivery {
  kind: "console" | "telegram" | "discord" | "slack" | "matrix" | "signal" | "imessage" | "whatsapp" | "line" | "google-chat" | "webhook" | "home-assistant" | "teams" | "mattermost" | "synology-chat" | "rocket-chat" | "feishu" | "dingtalk" | "wecom" | "zalo" | "irc" | "twitch" | "ntfy" | "mastodon" | "nextcloud-talk" | "webex" | "zulip" | "email" | "github" | "todoist" | "notion" | "obsidian";
  targetId?: string;
}

export interface ScheduledTask {
  id: string;
  prompt: string;
  sessionId: string;
  source: "cli" | "voice" | "web-chat" | "telegram" | "discord" | "slack" | "matrix" | "signal" | "imessage" | "whatsapp" | "line" | "kakaotalk" | "google-chat" | "webhook" | "home-assistant" | "teams" | "mattermost" | "synology-chat" | "rocket-chat" | "feishu" | "dingtalk" | "wecom" | "zalo" | "irc" | "twitch" | "ntfy" | "mastodon" | "nextcloud-talk" | "webex" | "zulip" | "email" | "github" | "todoist" | "notion" | "obsidian" | "test";
  providerId?: string;
  enabled: boolean;
  createdAt: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastError?: string;
  intervalMs?: number;
  runCount: number;
  delivery: ScheduledDelivery;
}

export type QueuedJobStatus = "pending" | "running" | "done" | "failed" | "cancelled";

export interface QueuedJob {
  id: string;
  prompt: string;
  sessionId: string;
  source: "cli" | "voice" | "web-chat" | "telegram" | "discord" | "slack" | "matrix" | "signal" | "imessage" | "whatsapp" | "line" | "kakaotalk" | "google-chat" | "webhook" | "home-assistant" | "teams" | "mattermost" | "synology-chat" | "rocket-chat" | "feishu" | "dingtalk" | "wecom" | "zalo" | "irc" | "twitch" | "ntfy" | "mastodon" | "nextcloud-talk" | "webex" | "zulip" | "email" | "github" | "todoist" | "notion" | "obsidian" | "test";
  providerId?: string;
  dependsOn?: string[];
  status: QueuedJobStatus;
  attempts: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  nextAttemptAt?: string;
  result?: string;
  error?: string;
}

export interface PendingAction {
  id: string;
  type: "write-file" | "append-file" | "open-url" | "speak" | "calendar-event" | "mail-draft" | "notify" | "clipboard" | "connector-message" | "browser-task";
  targetPath: string;
  content: string;
  status: "pending" | "approved" | "rejected";
  source: string;
  createdAt: string;
  decidedAt?: string;
  backupPath?: string;
}

export interface AuthorizedPeer {
  connector: AccessConnector;
  id: string;
  label?: string;
  createdAt: string;
  source: string;
}

export interface PairingCode {
  code: string;
  connector?: AccessConnector;
  label?: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
}
