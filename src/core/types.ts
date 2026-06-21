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
}

export interface ProviderResponse {
  text: string;
  providerId: string;
  elapsedMs: number;
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
  // Optional: minimum milliseconds between outbound provider CLI invocations.
  // Omit or set <= 0 to disable. Use it to avoid hammering a subscription CLI.
  providerMinIntervalMs?: number;
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

export interface StorageConfig {
  dir: string;
}

export interface MemoryConfig {
  enabled: boolean;
  dir: string;
  promptLimit: number;
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

export interface ToolsConfig {
  enabled: boolean;
  allowedReadRoots: string[];
  maxReadBytes: number;
  shell: ToolShellConfig;
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
}

export type AccessConnector = "telegram" | "discord";

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
}

export interface ViserConfig {
  assistant: AssistantConfig;
  storage: StorageConfig;
  memory: MemoryConfig;
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
    // Optional acknowledgement that relaying a single-seat provider login to
    // chat peers may violate provider ToS and risk account bans.
    acknowledgeRelayToS?: boolean;
  };
  providers: Record<string, CliProviderConfig>;
  configPath?: string;
}

export interface AssistantHandleOptions {
  providerId?: string;
  source?: "cli" | "telegram" | "discord" | "test";
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
    };
    pendingApprovals: {
      enabled: boolean;
      count: number;
    };
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
  kind: "console" | "telegram" | "discord";
  targetId?: string;
}

export interface ScheduledTask {
  id: string;
  prompt: string;
  sessionId: string;
  source: "cli" | "telegram" | "discord" | "test";
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
  source: "cli" | "telegram" | "discord" | "test";
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
  type: "write-file" | "append-file" | "open-url" | "speak" | "calendar-event" | "mail-draft" | "notify" | "clipboard" | "connector-message";
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
