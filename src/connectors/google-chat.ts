// ================================================================
// Google Chat incoming webhook sender
// ================================================================
// Google Chat webhooks are outbound-only: they can post asynchronous messages
// to a registered Chat space, but they cannot receive user messages. Viser
// keeps them behind the same approval/scheduler and access allowlist path used
// by the two-way messenger connectors.

import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout, type FetchLike } from "../utils/fetch.ts";
import { chunkText } from "../utils/text.ts";
import type { GoogleChatConnectorConfig } from "../core/types.ts";

const GOOGLE_CHAT_CHUNK_SIZE = 3900;

export interface GoogleChatFetchOptions {
  fetchImpl?: FetchLike;
}

export async function sendGoogleChatMessage(
  config: GoogleChatConnectorConfig,
  webhookId: string,
  text: string,
  options: GoogleChatFetchOptions = {}
): Promise<void> {
  const url = resolveGoogleChatWebhookUrl(config, webhookId);
  const fetchImpl = options.fetchImpl ?? fetch;

  for (const chunk of chunkText(text, GOOGLE_CHAT_CHUNK_SIZE)) {
    const response = await fetchWithTimeout(fetchImpl, url, {
      method: "POST",
      headers: { "content-type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ text: chunk })
    }, config.sendTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
    const bodyText = await response.text().catch(() => "");
    if (!response.ok) {
      throw new Error(redactGoogleChatDetail(`Google Chat send failed: ${response.status} ${response.statusText} ${bodyText}`, config, webhookId, chunk));
    }
  }
}

export function resolveGoogleChatWebhookUrl(config: GoogleChatConnectorConfig, webhookId: string): string {
  const id = normalizeWebhookId(webhookId);
  if (!id) throw new Error("Google Chat webhook id must be a short alias such as default or ops.");
  const mapped = config.webhookUrls[id] ?? (id === "default" ? config.webhookUrl : undefined);
  if (!mapped) {
    throw new Error(`Google Chat webhook id '${id}' is not configured. Set ${config.webhookUrlEnv} or ${config.webhookUrlsEnv}.`);
  }
  return normalizeGoogleChatWebhookUrl(mapped);
}

export function normalizeWebhookId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 80) return undefined;
  if (/^[A-Za-z0-9._-]+$/u.test(trimmed)) return trimmed;
  return undefined;
}

export function parseWebhookUrlMap(value: string | undefined): Record<string, string> {
  const raw = value?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const output: Record<string, string> = {};
      for (const [key, url] of Object.entries(parsed as Record<string, unknown>)) {
        const id = normalizeWebhookId(key);
        if (id && typeof url === "string" && url.trim()) output[id] = url.trim();
      }
      return output;
    }
  } catch {
    // Fall back to a shell-friendly alias=url list.
  }

  const output: Record<string, string> = {};
  for (const part of raw.split(/[,\n;]/u)) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const id = normalizeWebhookId(part.slice(0, separator));
    const url = part.slice(separator + 1).trim();
    if (id && url) output[id] = url;
  }
  return output;
}

export function normalizeGoogleChatWebhookUrl(value: string): string {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Google Chat webhook URL must be an https://chat.googleapis.com/... URL.");
  }
  if (url.protocol !== "https:" || url.hostname !== "chat.googleapis.com") {
    throw new Error("Google Chat webhook URL must use https://chat.googleapis.com.");
  }
  if (!url.searchParams.get("key") || !url.searchParams.get("token")) {
    throw new Error("Google Chat webhook URL must include key and token query parameters.");
  }
  return url.toString();
}

function redactGoogleChatDetail(detail: string, config: GoogleChatConnectorConfig, webhookId?: string, text?: string): string {
  let output = detail;
  const urls = [config.webhookUrl, ...Object.values(config.webhookUrls)];
  for (const secret of [...urls, webhookId, text]) {
    if (secret) output = output.split(secret).join("[REDACTED]");
  }
  return output;
}
