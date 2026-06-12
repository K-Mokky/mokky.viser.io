// ================================================================
// Rocket.Chat incoming webhook sender
// ================================================================
// Rocket.Chat incoming integrations expose a secret /hooks/<id>/<token> URL
// that accepts JSON message payloads. Viser keeps only local aliases in
// actions/schedules and resolves the raw URL at the final approved send edge.

import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout, type FetchLike } from "../utils/fetch.ts";
import { chunkText } from "../utils/text.ts";
import { normalizeWebhookId, parseWebhookUrlMap } from "./google-chat.ts";
import type { RocketChatConnectorConfig } from "../core/types.ts";

const ROCKET_CHAT_CHUNK_SIZE = 3900;

export interface RocketChatFetchOptions {
  fetchImpl?: FetchLike;
}

export async function sendRocketChatMessage(
  config: RocketChatConnectorConfig,
  webhookId: string,
  text: string,
  options: RocketChatFetchOptions = {}
): Promise<void> {
  const url = resolveRocketChatWebhookUrl(config, webhookId);
  const fetchImpl = options.fetchImpl ?? fetch;

  for (const chunk of chunkText(text, ROCKET_CHAT_CHUNK_SIZE)) {
    const response = await fetchWithTimeout(fetchImpl, url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: chunk })
    }, config.sendTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
    const bodyText = await response.text().catch(() => "");
    if (!response.ok) {
      throw new Error(redactRocketChatDetail(`Rocket.Chat send failed: ${response.status} ${response.statusText} ${bodyText}`, config, webhookId, chunk));
    }
  }
}

export function resolveRocketChatWebhookUrl(config: RocketChatConnectorConfig, webhookId: string): string {
  const id = normalizeWebhookId(webhookId);
  if (!id) throw new Error("Rocket.Chat webhook id must be a short alias such as default or ops.");
  const mapped = config.webhookUrls[id] ?? (id === "default" ? config.webhookUrl : undefined);
  if (!mapped) {
    throw new Error(`Rocket.Chat webhook id '${id}' is not configured. Set ${config.webhookUrlEnv} or ${config.webhookUrlsEnv}.`);
  }
  return normalizeRocketChatWebhookUrl(mapped);
}

export function normalizeRocketChatWebhookUrl(value: string): string {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Rocket.Chat webhook URL must be an https URL.");
  }
  if (url.protocol !== "https:") throw new Error("Rocket.Chat webhook URL must use https.");
  if (url.username || url.password) throw new Error("Rocket.Chat webhook URL must not contain credentials.");
  if (!/^\/hooks\/[^/]+\/[^/]+\/?$/u.test(url.pathname)) {
    throw new Error("Rocket.Chat webhook URL must use /hooks/<integrationId>/<token>.");
  }
  return url.toString();
}

export function parseRocketChatWebhookUrlMap(value: string | undefined): Record<string, string> {
  return parseWebhookUrlMap(value);
}

function redactRocketChatDetail(detail: string, config: RocketChatConnectorConfig, webhookId?: string, text?: string): string {
  let output = detail;
  const urls = [config.webhookUrl, ...Object.values(config.webhookUrls)];
  for (const secret of [...urls, webhookId, text]) {
    if (secret) output = output.split(secret).join("[REDACTED]");
  }
  return output;
}
