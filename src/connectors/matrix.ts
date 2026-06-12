// ================================================================
// Matrix bridge
// ================================================================
// Matrix uses the standard Client-Server HTTP API for sync/send transport.
// Viser stays foreground-only: polling runs only while the user keeps this
// process open, and model access still goes through local CLI providers.

import { randomUUID } from "node:crypto";
import { AccessStore } from "../core/access.ts";
import { chunkText } from "../utils/text.ts";
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout, type FetchLike } from "../utils/fetch.ts";
import { pairedMessage, pairingRequiredMessage } from "./telegram.ts";
import { connectorInputLimitMessage, connectorInputTooLong } from "./input-policy.ts";
import { ConnectorRateLimiter, connectorRateLimitMessage } from "./rate-limit.ts";
import type { AssistantRuntime } from "../core/assistant.ts";
import type { MatrixConnectorConfig } from "../core/types.ts";

const MATRIX_RETRY_DELAY_MS = 5000;
const MATRIX_LONG_POLL_MARGIN_MS = 5000;

export interface MatrixMessageEvent {
  type?: string;
  sender?: string;
  event_id?: string;
  content?: {
    msgtype?: string;
    body?: string;
  };
}

interface MatrixSyncResponse {
  next_batch?: string;
  rooms?: {
    join?: Record<string, {
      timeline?: {
        events?: MatrixMessageEvent[];
      };
    }>;
  };
}

interface MatrixErrorResponse {
  errcode?: string;
  error?: string;
}

export interface MatrixRequestOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export async function runMatrixBridge(
  config: MatrixConnectorConfig,
  assistant: AssistantRuntime,
  access?: AccessStore
): Promise<void> {
  const token = config.accessToken;
  if (!token) throw new Error(`Matrix access token is missing. Set ${config.accessTokenEnv}.`);
  if (!config.homeserverUrl) throw new Error(`Matrix homeserver URL is missing. Set ${config.homeserverUrlEnv}.`);
  const rateLimiter = new ConnectorRateLimiter(config.maxMessagesPerMinute);

  let since: string | undefined;
  let stopped = false;
  process.once("SIGINT", () => {
    stopped = true;
  });
  process.once("SIGTERM", () => {
    stopped = true;
  });

  console.log("Matrix bridge is running. Press Ctrl+C to stop.");

  while (!stopped) {
    try {
      since = await pollMatrixSync(token, config, assistant, since, access, rateLimiter, { processEvents: Boolean(since) });
    } catch (error) {
      if (stopped) break;
      console.error(`Matrix sync failed; retrying: ${error instanceof Error ? error.message : String(error)}`);
      await new Promise((resolve) => setTimeout(resolve, MATRIX_RETRY_DELAY_MS));
    }
  }
}

export async function pollMatrixSync(
  token: string,
  config: MatrixConnectorConfig,
  assistant: AssistantRuntime,
  since?: string,
  access?: AccessStore,
  rateLimiter?: ConnectorRateLimiter,
  options: MatrixRequestOptions & { processEvents?: boolean } = {}
): Promise<string | undefined> {
  const params = new URLSearchParams({ timeout: String(config.pollTimeoutMs) });
  if (since) params.set("since", since);
  const response = await matrixApiCall<MatrixSyncResponse>(
    token,
    config,
    `/_matrix/client/v3/sync?${params.toString()}`,
    { method: "GET" },
    { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs ?? config.pollTimeoutMs + MATRIX_LONG_POLL_MARGIN_MS }
  );

  if (options.processEvents !== false) {
    for (const [roomId, room] of Object.entries(response.rooms?.join ?? {})) {
      for (const event of room.timeline?.events ?? []) {
        try {
          await handleMatrixEvent(token, config, assistant, roomId, event, access, rateLimiter);
        } catch (error) {
          console.error(`Matrix event ${event.event_id ?? "unknown"} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  return response.next_batch ?? since;
}

export async function handleMatrixEvent(
  token: string,
  config: MatrixConnectorConfig,
  assistant: AssistantRuntime,
  roomId: string,
  event: MatrixMessageEvent,
  access?: AccessStore,
  rateLimiter?: ConnectorRateLimiter
): Promise<void> {
  if (event.type !== "m.room.message" || event.sender === config.userId) return;
  const body = event.content?.body;
  if (!body || !["m.text", "m.notice"].includes(event.content?.msgtype ?? "")) return;

  const staticAllowlist = [...config.allowedRoomIds, ...config.defaultRoomIds];
  if (config.allowedRoomIds.length > 0 && !staticAllowlist.includes(roomId)) return;

  const normalized = normalizeMatrixInput(body, config.prefix, config.userId);
  if (!normalized) return;

  if (access && !(await access.isAllowed("matrix", roomId, staticAllowlist))) {
    const label = event.sender ? `matrix-user:${event.sender}` : `matrix:${roomId}`;
    const paired = await access.tryPairCommand(normalized, "matrix", roomId, label);
    await sendMatrixMessage(token, config, roomId, paired ? pairedMessage("matrix") : pairingRequiredMessage("matrix"));
    return;
  }

  if (connectorInputTooLong(normalized, config.maxInputChars)) {
    await sendMatrixMessage(token, config, roomId, connectorInputLimitMessage(config.maxInputChars));
    return;
  }

  const rate = rateLimiter?.check(`matrix:${roomId}`);
  if (rate && !rate.allowed) {
    await sendMatrixMessage(token, config, roomId, connectorRateLimitMessage(rate.retryAfterMs));
    return;
  }

  try {
    const answer = await assistant.handle(normalized, `matrix:${roomId}`, { source: "matrix" });
    await sendMatrixMessage(token, config, roomId, answer);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await sendMatrixMessage(token, config, roomId, `Viser error:\n${detail}`);
  }
}

export function normalizeMatrixInput(content: string, prefix: string, botUserId?: string): string | undefined {
  const trimmed = content.trim();
  if (!trimmed) return undefined;
  if (/^\/pair\s+\S+/u.test(trimmed)) return trimmed;
  if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length).trim() || "/help";
  if (botUserId && trimmed.startsWith(`${botUserId}:`)) return trimmed.slice(botUserId.length + 1).trim() || "/help";
  if (botUserId && trimmed.startsWith(botUserId)) return trimmed.slice(botUserId.length).trim() || "/help";
  return undefined;
}

export async function sendMatrixMessage(
  token: string,
  config: MatrixConnectorConfig,
  roomId: string,
  text: string,
  options: MatrixRequestOptions = {}
): Promise<void> {
  for (const chunk of chunkText(text, 3900)) {
    await matrixApiCall(
      token,
      config,
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(randomUUID())}`,
      {
        method: "PUT",
        body: JSON.stringify({ msgtype: "m.text", body: chunk })
      },
      options
    );
  }
}

export async function matrixApiCall<T>(
  token: string,
  config: MatrixConnectorConfig,
  pathAndQuery: string,
  init: RequestInit,
  options: MatrixRequestOptions = {}
): Promise<T> {
  try {
    const base = normalizeHomeserverUrl(config.homeserverUrl);
    const response = await fetchWithTimeout(options.fetchImpl ?? fetch, `${base}${pathAndQuery}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...init.headers
      }
    }, options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
    const body = (await response.json().catch(() => ({}))) as T & MatrixErrorResponse;
    if (!response.ok) {
      throw new Error(`Matrix API failed: ${body.errcode ? `${body.errcode} ` : ""}${body.error ?? response.statusText}`);
    }
    return body;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(redactToken(message, token));
  }
}

function normalizeHomeserverUrl(value: string | undefined): string {
  const url = (value ?? "").trim().replace(/\/+$/u, "");
  if (!/^https?:\/\/[^/\s]+/iu.test(url)) {
    throw new Error("Matrix homeserver URL must be an http(s) URL such as https://matrix.example.org.");
  }
  return url;
}

function redactToken(detail: string, token: string): string {
  return detail.split(token).join("[REDACTED]");
}
