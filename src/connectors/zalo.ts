// ================================================================
// Zalo Official Account message sender
// ================================================================
// Zalo OA messaging is outbound from Viser's perspective: approvals and
// schedules reference a short local alias, while the real user_id and OA access
// token stay in configuration/env until the final send boundary.

import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout, type FetchLike } from "../utils/fetch.ts";
import { chunkText } from "../utils/text.ts";
import { normalizeWebhookId, parseWebhookUrlMap } from "./google-chat.ts";
import type { ZaloConnectorConfig } from "../core/types.ts";

const ZALO_MESSAGE_URL = "https://openapi.zalo.me/v2.0/oa/message";
const ZALO_CHUNK_SIZE = 1_900;

export interface ZaloFetchOptions {
  fetchImpl?: FetchLike;
}

export async function sendZaloMessage(
  config: ZaloConnectorConfig,
  recipientId: string,
  text: string,
  options: ZaloFetchOptions = {}
): Promise<void> {
  const accessToken = normalizeZaloAccessToken(config.accessToken);
  const userId = resolveZaloRecipient(config, recipientId);
  const fetchImpl = options.fetchImpl ?? fetch;

  for (const chunk of chunkText(text, ZALO_CHUNK_SIZE)) {
    const response = await fetchWithTimeout(fetchImpl, ZALO_MESSAGE_URL, {
      method: "POST",
      headers: {
        access_token: accessToken,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        recipient: { user_id: userId },
        message: { text: chunk }
      })
    }, config.sendTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
    const bodyText = await response.text().catch(() => "");
    if (!response.ok || zaloJsonFailed(bodyText)) {
      throw new Error(redactZaloDetail(`Zalo send failed: ${response.status} ${response.statusText} ${bodyText}`, config, recipientId, userId, chunk));
    }
  }
}

export function resolveZaloRecipient(config: ZaloConnectorConfig, recipientId: string): string {
  const alias = normalizeZaloRecipientAlias(recipientId);
  const recipient = config.recipients[alias] ?? (alias === "default" ? config.recipient : undefined);
  if (!recipient) {
    throw new Error(`Zalo recipient alias '${alias}' is not configured. Set ${config.recipientEnv} or ${config.recipientsEnv}.`);
  }
  return normalizeZaloUserId(recipient);
}

export function hasZaloRecipient(config: ZaloConnectorConfig): boolean {
  return Boolean(config.recipient || Object.keys(config.recipients).length > 0);
}

export function normalizeZaloRecipientAlias(value: string | undefined): string {
  const id = normalizeWebhookId(value);
  if (!id) throw new Error("Zalo recipient alias must be a short alias such as default or ops.");
  return id.toLowerCase();
}

export function parseZaloRecipientMap(value: string | undefined): Record<string, string> {
  const parsed = parseWebhookUrlMap(value);
  const output: Record<string, string> = {};
  for (const [alias, recipient] of Object.entries(parsed)) {
    output[normalizeZaloRecipientAlias(alias)] = normalizeZaloUserId(recipient);
  }
  return output;
}

export function normalizeZaloAccessToken(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error("Zalo OA access token is required.");
  if (trimmed.length < 10 || trimmed.length > 4096 || /[\s\u0000-\u001f\u007f]/u.test(trimmed)) {
    throw new Error("Zalo OA access token must be a non-empty opaque token.");
  }
  return trimmed;
}

export function normalizeZaloUserId(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error("Zalo recipient user_id is required.");
  if (!/^[A-Za-z0-9._-]{3,128}$/u.test(trimmed)) {
    throw new Error("Zalo recipient must be the opaque OA user_id value, not a phone number, URL, or display name.");
  }
  return trimmed;
}

export function redactZaloDetail(detail: string, config: ZaloConnectorConfig, alias?: string, userId?: string, text?: string): string {
  let output = detail;
  for (const secret of [config.accessToken, config.recipient, ...Object.values(config.recipients), alias, userId, text]) {
    if (secret) output = output.split(secret).join("[REDACTED]");
  }
  return output;
}

function zaloJsonFailed(bodyText: string): boolean {
  if (!bodyText.trim()) return false;
  try {
    const parsed = JSON.parse(bodyText) as { error?: unknown; error_code?: unknown; code?: unknown };
    const code = typeof parsed.error === "number"
      ? parsed.error
      : typeof parsed.error_code === "number"
        ? parsed.error_code
        : parsed.code;
    return typeof code === "number" && code !== 0;
  } catch {
    return false;
  }
}
