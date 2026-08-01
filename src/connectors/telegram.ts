// ================================================================
// Telegram bridge
// ================================================================
// Telegram uses the Bot API for message transport. LLM access still happens
// through local logged-in CLIs inside AssistantRuntime.

import { join } from "node:path";
import { AccessStore } from "../core/access.ts";
import { ensurePrivateDir, readPrivateFileIfExists, writePrivateFile } from "../utils/files.ts";
import { connectorInputLimitMessage, connectorInputTooLong } from "./input-policy.ts";
import { ConnectorRateLimiter, connectorRateLimitMessage } from "./rate-limit.ts";
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout, type FetchLike } from "../utils/fetch.ts";
import { chunkText } from "../utils/text.ts";
import type { AssistantRuntime } from "../core/assistant.ts";
import type { TelegramConnectorConfig } from "../core/types.ts";

const TELEGRAM_RETRY_DELAY_MS = 5000;
const TELEGRAM_LONG_POLL_MARGIN_MS = 5_000;

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number | string; type: string };
    from?: { id: number; is_bot?: boolean; username?: string };
  };
}

interface TelegramResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

export interface TelegramRequestOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export interface TelegramBridgeOptions {
  /** Directory for durable bridge state (long-poll offset). Omit to keep state in memory only. */
  stateDir?: string;
}

export async function runTelegramBridge(
  config: TelegramConnectorConfig,
  assistant: AssistantRuntime,
  access?: AccessStore,
  bridgeOptions: TelegramBridgeOptions = {}
): Promise<void> {
  const token = config.botToken;
  if (!token) throw new Error(`Telegram token is missing. Set ${config.botTokenEnv}.`);
  const rateLimiter = new ConnectorRateLimiter(config.maxMessagesPerMinute);

  const offsetStore = bridgeOptions.stateDir ? new TelegramOffsetStore(bridgeOptions.stateDir) : undefined;
  let offset = (await offsetStore?.read()) ?? 0;
  let stopped = false;
  process.once("SIGINT", () => {
    stopped = true;
  });
  process.once("SIGTERM", () => {
    stopped = true;
  });

  await registerTelegramCommands(token);
  console.log("Telegram bridge is running. Press Ctrl+C to stop.");

  while (!stopped) {
    try {
      const nextOffset = await pollTelegramUpdates(token, config, assistant, offset, access, rateLimiter);
      if (nextOffset !== offset) {
        offset = nextOffset;
        await offsetStore?.write(offset);
      }
    } catch (error) {
      if (stopped) break;
      console.error(`Telegram polling failed; retrying: ${error instanceof Error ? error.message : String(error)}`);
      await delay(TELEGRAM_RETRY_DELAY_MS);
    }
  }
}

export async function pollTelegramUpdates(
  token: string,
  config: TelegramConnectorConfig,
  assistant: AssistantRuntime,
  offset: number,
  access?: AccessStore,
  rateLimiter?: ConnectorRateLimiter
): Promise<number> {
  const updates = await telegramCall<TelegramUpdate[]>(token, "getUpdates", {
    timeout: 30,
    offset,
    allowed_updates: ["message"]
  });

  let nextOffset = offset;
  for (const update of updates) {
    nextOffset = Math.max(nextOffset, update.update_id + 1);
    try {
      await handleTelegramUpdate(token, config, assistant, update, access, rateLimiter);
    } catch (error) {
      console.error(`Telegram update ${update.update_id} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return nextOffset;
}

export async function handleTelegramUpdate(
  token: string,
  config: TelegramConnectorConfig,
  assistant: AssistantRuntime,
  update: TelegramUpdate,
  access?: AccessStore,
  rateLimiter?: ConnectorRateLimiter
): Promise<void> {
  const message = update.message;
  if (!message?.text || message.from?.is_bot) return;

  const chatId = String(message.chat.id);
  const label = message.from?.username ? `@${message.from.username}` : `telegram:${chatId}`;
  const staticAllowlist = [...config.allowedChatIds, ...config.defaultChatIds];

  if (access && !(await access.isAllowed("telegram", chatId, staticAllowlist))) {
    const paired = await access.tryPairCommand(message.text, "telegram", chatId, label);
    await sendTelegramMessage(token, chatId, paired ? pairedMessage("telegram") : pairingRequiredMessage("telegram"));
    return;
  }

  if (!access && staticAllowlist.length > 0 && !staticAllowlist.includes(chatId)) {
    await sendTelegramMessage(token, chatId, "This chat is not allowed to use this Viser instance.");
    return;
  }

  if (connectorInputTooLong(message.text, config.maxInputChars)) {
    await sendTelegramMessage(token, chatId, connectorInputLimitMessage(config.maxInputChars));
    return;
  }

  const rate = rateLimiter?.check(`telegram:${chatId}`);
  if (rate && !rate.allowed) {
    await sendTelegramMessage(token, chatId, connectorRateLimitMessage(rate.retryAfterMs));
    return;
  }

  try {
    await sendTelegramTyping(token, chatId);
    const answer = await assistant.handle(message.text, `telegram:${chatId}`, { source: "telegram" });
    await sendTelegramMessage(token, chatId, answer);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await sendTelegramMessage(token, chatId, `Viser error:\n${detail}`);
  }
}

export function pairingRequiredMessage(connector: "telegram" | "discord"): string {
  return [
    "This chat is not paired with Viser yet.",
    `Run \`node src/index.ts pair-code ${connector}\` on the Viser machine, then send:`,
    "/pair CODE"
  ].join("\n");
}

export function pairedMessage(connector: "telegram" | "discord"): string {
  return `Paired this ${connector} chat with Viser. You can now send commands.`;
}

// Persisting the confirmed long-poll offset means a restarted bridge does not
// replay the backlog of already-answered messages.
export class TelegramOffsetStore {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async read(): Promise<number | undefined> {
    try {
      const raw = await readPrivateFileIfExists(this.path(), { dirs: [this.dir] });
      if (raw === undefined) return undefined;
      const parsed = JSON.parse(raw) as { offset?: unknown };
      return typeof parsed.offset === "number" && Number.isInteger(parsed.offset) && parsed.offset >= 0
        ? parsed.offset
        : undefined;
    } catch {
      return undefined;
    }
  }

  async write(offset: number): Promise<void> {
    try {
      await ensurePrivateDir(this.dir);
      await writePrivateFile(this.path(), `${JSON.stringify({ offset })}\n`);
    } catch (error) {
      console.error(`Telegram offset persistence failed (continuing): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private path(): string {
    return join(this.dir, "telegram-offset.json");
  }
}

// Both calls below are best-effort UX affordances; failures never block replies.
export async function sendTelegramTyping(token: string, chatId: string, options: TelegramRequestOptions = {}): Promise<void> {
  try {
    await telegramCall(token, "sendChatAction", { chat_id: chatId, action: "typing" }, options);
  } catch {
    // Typing indicator is cosmetic only.
  }
}

export const TELEGRAM_BOT_COMMANDS: Array<{ command: string; description: string }> = [
  { command: "start", description: "Welcome and quickstart" },
  { command: "help", description: "Show all commands" },
  { command: "brief", description: "Daily briefing from todos and reminders" },
  { command: "status", description: "Show assistant status" },
  { command: "remind", description: "Set a reminder: /remind 10m text" },
  { command: "reminders", description: "List reminders" },
  { command: "todo", description: "Add or manage todos" },
  { command: "todos", description: "List todos" },
  { command: "remember", description: "Save a long-term memory" },
  { command: "memory", description: "Search long-term memories" },
  { command: "provider", description: "Switch AI provider" },
  { command: "reset", description: "Clear this chat's history" }
];

export async function registerTelegramCommands(token: string, options: TelegramRequestOptions = {}): Promise<void> {
  try {
    await telegramCall(token, "setMyCommands", { commands: TELEGRAM_BOT_COMMANDS }, options);
  } catch (error) {
    console.error(`Telegram setMyCommands failed (continuing): ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  options: TelegramRequestOptions = {}
): Promise<void> {
  for (const chunk of chunkText(text, 3900)) {
    await telegramCall(token, "sendMessage", {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true
    }, options);
  }
}

async function telegramCall<T>(
  token: string,
  method: string,
  payload: unknown,
  options: TelegramRequestOptions = {}
): Promise<T> {
  try {
    const response = await fetchWithTimeout(options.fetchImpl ?? fetch, `https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }, telegramTimeoutMs(method, payload, options.timeoutMs));

    const body = (await response.json()) as TelegramResponse<T>;
    if (!response.ok || !body.ok) {
      throw new Error(`Telegram ${method} failed: ${body.description ?? response.statusText}`);
    }

    return body.result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(redactToken(message, token));
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function telegramTimeoutMs(method: string, payload: unknown, explicitTimeoutMs?: number): number {
  if (explicitTimeoutMs) return explicitTimeoutMs;
  if (method === "getUpdates" && isPlainObject(payload) && typeof payload.timeout === "number") {
    return Math.max(DEFAULT_FETCH_TIMEOUT_MS, payload.timeout * 1000 + TELEGRAM_LONG_POLL_MARGIN_MS);
  }
  return DEFAULT_FETCH_TIMEOUT_MS;
}

function redactToken(detail: string, token: string): string {
  return detail.split(token).join("[REDACTED]");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
