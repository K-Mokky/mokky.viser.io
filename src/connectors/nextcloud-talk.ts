// ================================================================
// Nextcloud Talk outbound connector
// ================================================================
// Talk delivery is outbound-only: approvals and schedules reference a short
// local room alias while the Nextcloud URL, username, app password, and room
// token stay in local configuration until the final OCS send boundary.

import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout, type FetchLike } from "../utils/fetch.ts";
import { chunkText } from "../utils/text.ts";
import { normalizeWebhookId } from "./google-chat.ts";
import type { NextcloudTalkConnectorConfig } from "../core/types.ts";

const NEXTCLOUD_TALK_CHUNK_SIZE = 2_000;

export interface NextcloudTalkFetchOptions {
  fetchImpl?: FetchLike;
}

export async function sendNextcloudTalkMessage(
  config: NextcloudTalkConnectorConfig,
  roomId: string,
  text: string,
  options: NextcloudTalkFetchOptions = {}
): Promise<void> {
  const baseUrl = normalizeNextcloudTalkBaseUrl(config.baseUrl);
  const username = normalizeNextcloudTalkUsername(config.username);
  const appPassword = normalizeNextcloudTalkAppPassword(config.appPassword);
  const roomToken = resolveNextcloudTalkRoom(config, roomId);
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${baseUrl}/ocs/v2.php/apps/spreed/api/v1/chat/${encodeURIComponent(roomToken)}`;

  for (const chunk of chunkText(normalizeNextcloudTalkMessageBody(text), NEXTCLOUD_TALK_CHUNK_SIZE)) {
    const response = await fetchWithTimeout(fetchImpl, url, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: nextcloudTalkAuthorizationHeader(username, appPassword),
        "content-type": "application/json",
        "ocs-apirequest": "true"
      },
      body: JSON.stringify({ token: roomToken, message: chunk })
    }, config.sendTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
    const bodyText = await response.text().catch(() => "");
    if (!response.ok || nextcloudTalkJsonFailed(bodyText)) {
      throw new Error(redactNextcloudTalkDetail(`Nextcloud Talk send failed: ${response.status} ${response.statusText} ${bodyText}`, config, roomId, roomToken, chunk));
    }
  }
}

export function resolveNextcloudTalkRoom(config: NextcloudTalkConnectorConfig, roomId: string): string {
  const alias = normalizeNextcloudTalkRoomAlias(roomId);
  const roomToken = config.rooms[alias] ?? (alias === "default" ? config.roomToken : undefined);
  if (!roomToken) {
    throw new Error(`Nextcloud Talk room alias '${alias}' is not configured. Set ${config.roomTokenEnv} or ${config.roomsEnv}.`);
  }
  return normalizeNextcloudTalkRoomToken(roomToken);
}

export function hasNextcloudTalkRoom(config: Pick<NextcloudTalkConnectorConfig, "roomToken" | "rooms">): boolean {
  return Boolean(config.roomToken || Object.keys(config.rooms).length > 0);
}

export function parseNextcloudTalkRoomMap(raw: string | undefined): Record<string, string> {
  const output: Record<string, string> = {};
  for (const part of (raw ?? "").split(/[,;\n]/u)) {
    const item = part.trim();
    if (!item) continue;
    const separator = item.indexOf("=");
    if (separator <= 0 || separator === item.length - 1) {
      throw new Error("Nextcloud Talk room maps must look like default=roomtoken,alerts=othertoken.");
    }
    output[normalizeNextcloudTalkRoomAlias(item.slice(0, separator))] = normalizeNextcloudTalkRoomToken(item.slice(separator + 1));
  }
  return output;
}

export function normalizeNextcloudTalkRoomAlias(value: string | undefined): string {
  const id = normalizeWebhookId(value);
  if (!id) throw new Error("Nextcloud Talk room alias must be a short alias such as default or ops.");
  return id.toLowerCase();
}

export function normalizeNextcloudTalkBaseUrl(value: string | undefined): string {
  const raw = value?.trim() ?? "";
  if (!raw) throw new Error("Nextcloud Talk base URL is required.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Nextcloud Talk base URL must be a valid https:// URL.");
  }
  if (url.protocol !== "https:") throw new Error("Nextcloud Talk base URL must use https.");
  if (url.username || url.password) throw new Error("Nextcloud Talk base URL must not include credentials.");
  if (url.search || url.hash) throw new Error("Nextcloud Talk base URL must not include query strings or fragments.");
  url.pathname = url.pathname.replace(/\/+$/u, "");
  return url.toString().replace(/\/$/u, "");
}

export function normalizeNextcloudTalkUsername(value: string | undefined): string {
  const username = value?.trim() ?? "";
  if (!username) throw new Error("Nextcloud Talk username is required.");
  if (username.length > 128 || /[:\s\x00-\x1f\x7f]/u.test(username)) {
    throw new Error("Nextcloud Talk username must be a single user id without spaces or ':'.");
  }
  return username;
}

export function normalizeNextcloudTalkAppPassword(value: string | undefined): string {
  const password = value?.trim() ?? "";
  if (!password) throw new Error("Nextcloud Talk app password is required.");
  if (password.length > 512 || /[\r\n\x00]/u.test(password)) {
    throw new Error("Nextcloud Talk app password must be a single opaque line.");
  }
  return password;
}

export function normalizeNextcloudTalkRoomToken(value: string | undefined): string {
  const token = value?.trim() ?? "";
  if (!token) throw new Error("Nextcloud Talk room token is required.");
  if (!/^[A-Za-z0-9_-]{3,128}$/u.test(token)) {
    throw new Error("Nextcloud Talk room token must be the opaque conversation token, not a room URL.");
  }
  return token;
}

export function nextcloudTalkAuthorizationHeader(username: string, appPassword: string): string {
  return `Basic ${Buffer.from(`${username}:${appPassword}`, "utf8").toString("base64")}`;
}

export function redactNextcloudTalkDetail(
  detail: string,
  config: NextcloudTalkConnectorConfig,
  alias?: string,
  roomToken?: string,
  text?: string
): string {
  let output = detail;
  for (const secret of [config.baseUrl, config.username, config.appPassword, config.roomToken, ...Object.values(config.rooms), alias, roomToken, text]) {
    if (secret) output = output.split(secret).join("[REDACTED]");
  }
  return output;
}

function normalizeNextcloudTalkMessageBody(raw: string): string {
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(raw)) throw new Error("Nextcloud Talk message contains control characters.");
  const text = raw.replace(/\r\n?/gu, "\n").trim();
  if (!text) throw new Error("Nextcloud Talk message is required.");
  if (text.length > 20_000) throw new Error("Nextcloud Talk message is too long.");
  return text;
}

function nextcloudTalkJsonFailed(bodyText: string): boolean {
  if (!bodyText.trim()) return false;
  try {
    const parsed = JSON.parse(bodyText) as { ocs?: { meta?: { status?: unknown; statuscode?: unknown; message?: unknown } }; message?: unknown };
    const meta = parsed.ocs?.meta;
    if (!meta) return false;
    if (typeof meta.status === "string" && meta.status.toLowerCase() === "failure") return true;
    if (typeof meta.statuscode === "number" && meta.statuscode >= 400) return true;
    return false;
  } catch {
    return false;
  }
}
