// ================================================================
// Mattermost incoming webhook sender
// ================================================================
// Mattermost incoming webhooks post Markdown text into a channel or DM through
// a secret URL. Viser exposes only local aliases so approval-gated actions and
// scheduled deliveries never have to contain the raw webhook.

import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout, type FetchLike } from "../utils/fetch.ts";
import { chunkText } from "../utils/text.ts";
import { normalizeWebhookId, parseWebhookUrlMap } from "./google-chat.ts";
import type { MattermostConnectorConfig } from "../core/types.ts";

const MATTERMOST_CHUNK_SIZE = 3900;

export interface MattermostFetchOptions {
  fetchImpl?: FetchLike;
}

export async function sendMattermostMessage(
  config: MattermostConnectorConfig,
  webhookId: string,
  text: string,
  options: MattermostFetchOptions = {}
): Promise<void> {
  const url = resolveMattermostWebhookUrl(config, webhookId);
  const fetchImpl = options.fetchImpl ?? fetch;

  for (const chunk of chunkText(text, MATTERMOST_CHUNK_SIZE)) {
    const response = await fetchWithTimeout(fetchImpl, url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: chunk })
    }, config.sendTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
    const bodyText = await response.text().catch(() => "");
    if (!response.ok) {
      throw new Error(redactMattermostDetail(`Mattermost send failed: ${response.status} ${response.statusText} ${bodyText}`, config, webhookId, chunk));
    }
  }
}

export function resolveMattermostWebhookUrl(config: MattermostConnectorConfig, webhookId: string): string {
  const id = normalizeWebhookId(webhookId);
  if (!id) throw new Error("Mattermost webhook id must be a short alias such as default or ops.");
  const mapped = config.webhookUrls[id] ?? (id === "default" ? config.webhookUrl : undefined);
  if (!mapped) {
    throw new Error(`Mattermost webhook id '${id}' is not configured. Set ${config.webhookUrlEnv} or ${config.webhookUrlsEnv}.`);
  }
  return normalizeMattermostWebhookUrl(mapped);
}

export function normalizeMattermostWebhookUrl(value: string): string {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Mattermost webhook URL must be an https URL.");
  }
  if (url.protocol !== "https:") throw new Error("Mattermost webhook URL must use https.");
  if (!url.pathname.includes("/hooks/")) throw new Error("Mattermost webhook URL must include /hooks/.");
  return url.toString();
}

export function parseMattermostWebhookUrlMap(value: string | undefined): Record<string, string> {
  return parseWebhookUrlMap(value);
}

function redactMattermostDetail(detail: string, config: MattermostConnectorConfig, webhookId?: string, text?: string): string {
  let output = detail;
  const urls = [config.webhookUrl, ...Object.values(config.webhookUrls)];
  for (const secret of [...urls, webhookId, text]) {
    if (secret) output = output.split(secret).join("[REDACTED]");
  }
  return output;
}
