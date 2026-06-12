// ================================================================
// Telegram bridge
// ================================================================
// Telegram uses the Bot API for message transport. LLM access still happens
// through local logged-in CLIs inside AssistantRuntime.

import { AccessStore } from "../core/access.ts";
import { connectorInputLimitMessage, connectorInputTooLong } from "./input-policy.ts";
import { ConnectorRateLimiter, connectorRateLimitMessage } from "./rate-limit.ts";
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout, type FetchLike } from "../utils/fetch.ts";
import { chunkText } from "../utils/text.ts";
import type { AssistantRuntime } from "../core/assistant.ts";
import type { AccessConnector, TelegramConnectorConfig } from "../core/types.ts";

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

export async function runTelegramBridge(
  config: TelegramConnectorConfig,
  assistant: AssistantRuntime,
  access?: AccessStore
): Promise<void> {
  const token = config.botToken;
  if (!token) throw new Error(`Telegram token is missing. Set ${config.botTokenEnv}.`);
  const rateLimiter = new ConnectorRateLimiter(config.maxMessagesPerMinute);

  let offset = 0;
  let stopped = false;
  process.once("SIGINT", () => {
    stopped = true;
  });
  process.once("SIGTERM", () => {
    stopped = true;
  });

  console.log("Telegram bridge is running. Press Ctrl+C to stop.");

  while (!stopped) {
    try {
      offset = await pollTelegramUpdates(token, config, assistant, offset, access, rateLimiter);
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
    const answer = await assistant.handle(message.text, `telegram:${chatId}`, { source: "telegram" });
    await sendTelegramMessage(token, chatId, answer);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await sendTelegramMessage(token, chatId, `Viser error:\n${detail}`);
  }
}

export function pairingRequiredMessage(connector: AccessConnector): string {
  return [
    "This chat is not paired with Viser yet.",
    `Run \`viser pair-code ${connector}\` on the Viser machine, then send:`,
    "/pair CODE"
  ].join("\n");
}

export function pairedMessage(connector: AccessConnector): string {
  return `Paired this ${connector} chat with Viser. You can now send commands.`;
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
