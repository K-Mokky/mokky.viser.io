// ================================================================
// Slack bridge
// ================================================================
// Slack is a first-class transport surface. Socket Mode is used for foreground
// inbound events so Viser does not need to expose a public webhook while the
// model answer still comes from the local CLI-backed AssistantRuntime.

import { AccessStore } from "../core/access.ts";
import { chunkText } from "../utils/text.ts";
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout, type FetchLike } from "../utils/fetch.ts";
import { pairedMessage, pairingRequiredMessage } from "./telegram.ts";
import { connectorInputLimitMessage, connectorInputTooLong } from "./input-policy.ts";
import { ConnectorRateLimiter, connectorRateLimitMessage } from "./rate-limit.ts";
import type { AssistantRuntime } from "../core/assistant.ts";
import type { SlackConnectorConfig } from "../core/types.ts";

const SLACK_API_BASE = "https://slack.com/api";
const SLACK_RECONNECT_DELAY_MS = 5000;

interface SlackApiResponse {
  ok?: boolean;
  error?: string;
}

interface SlackSocketOpenResponse extends SlackApiResponse {
  url?: string;
}

interface SlackSocketEnvelope {
  envelope_id?: string;
  type?: string;
  accepts_response_payload?: boolean;
  payload?: {
    type?: string;
    event?: SlackMessageEvent;
  };
}

export interface SlackMessageEvent {
  type: string;
  channel?: string;
  channel_type?: string;
  user?: string;
  text?: string;
  bot_id?: string;
  subtype?: string;
}

export interface SlackRequestOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export async function runSlackBridge(
  config: SlackConnectorConfig,
  assistant: AssistantRuntime,
  access?: AccessStore
): Promise<void> {
  const botToken = config.botToken;
  if (!botToken) throw new Error(`Slack bot token is missing. Set ${config.botTokenEnv}.`);
  const appToken = config.appToken;
  if (!appToken) throw new Error(`Slack app-level token is missing. Set ${config.appTokenEnv} for Socket Mode.`);
  if (typeof WebSocket !== "function") throw new Error("This Node runtime does not provide WebSocket.");
  const rateLimiter = new ConnectorRateLimiter(config.maxMessagesPerMinute);

  let stopped = false;
  process.once("SIGINT", () => {
    stopped = true;
  });
  process.once("SIGTERM", () => {
    stopped = true;
  });

  console.log("Slack bridge is running in Socket Mode. Press Ctrl+C to stop.");

  while (!stopped) {
    try {
      await connectSlackSocket(appToken, botToken, config, assistant, () => stopped, access, rateLimiter);
    } catch (error) {
      if (stopped) break;
      console.error(error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, SLACK_RECONNECT_DELAY_MS));
    }
  }
}

async function connectSlackSocket(
  appToken: string,
  botToken: string,
  config: SlackConnectorConfig,
  assistant: AssistantRuntime,
  shouldStop: () => boolean,
  access?: AccessStore,
  rateLimiter?: ConnectorRateLimiter
): Promise<void> {
  const url = await openSlackSocket(appToken);
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url);

    const ack = (envelopeId: string) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ envelope_id: envelopeId }));
    };

    socket.addEventListener("message", (event) => {
      void (async () => {
        const envelope = JSON.parse(String(event.data)) as SlackSocketEnvelope;
        if (envelope.envelope_id) ack(envelope.envelope_id);
        if (envelope.type !== "events_api" || envelope.payload?.type !== "event_callback" || !envelope.payload.event) return;
        await handleSlackEvent(botToken, config, assistant, envelope.payload.event, access, rateLimiter);
      })().catch((error) => {
        reject(error instanceof Error ? error : new Error(String(error)));
        try {
          socket.close();
        } catch {
          // The rejection above carries the failure.
        }
      });
    });

    socket.addEventListener("error", () => reject(new Error("Slack socket error.")));
    socket.addEventListener("close", () => {
      if (shouldStop()) resolve();
      else reject(new Error("Slack socket closed; reconnecting."));
    });
  });
}

async function openSlackSocket(appToken: string, options: SlackRequestOptions = {}): Promise<string> {
  const response = await slackApiCall<SlackSocketOpenResponse>(
    appToken,
    "apps.connections.open",
    {},
    options
  );
  if (!response.url) throw new Error("Slack Socket Mode did not return a websocket URL.");
  return response.url;
}

export async function handleSlackEvent(
  token: string,
  config: SlackConnectorConfig,
  assistant: AssistantRuntime,
  event: SlackMessageEvent,
  access?: AccessStore,
  rateLimiter?: ConnectorRateLimiter
): Promise<void> {
  if (event.type !== "message" || !event.text || !event.channel || event.bot_id || event.subtype) return;
  const staticAllowlist = [...config.allowedChannelIds, ...config.defaultChannelIds];
  if (config.allowedChannelIds.length > 0 && !staticAllowlist.includes(event.channel)) return;

  const normalized = normalizeSlackInput(event.text, config.prefix, config.botUserId, event.channel_type === "im");
  if (!normalized) return;

  if (access && !(await access.isAllowed("slack", event.channel, staticAllowlist))) {
    const label = event.user ? `slack-user:${event.user}` : `slack:${event.channel}`;
    const paired = await access.tryPairCommand(normalized, "slack", event.channel, label);
    await sendSlackMessage(token, event.channel, paired ? pairedMessage("slack") : pairingRequiredMessage("slack"));
    return;
  }

  if (connectorInputTooLong(normalized, config.maxInputChars)) {
    await sendSlackMessage(token, event.channel, connectorInputLimitMessage(config.maxInputChars));
    return;
  }

  const rate = rateLimiter?.check(`slack:${event.channel}`);
  if (rate && !rate.allowed) {
    await sendSlackMessage(token, event.channel, connectorRateLimitMessage(rate.retryAfterMs));
    return;
  }

  try {
    const answer = await assistant.handle(normalized, `slack:${event.channel}`, { source: "slack" });
    await sendSlackMessage(token, event.channel, answer);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await sendSlackMessage(token, event.channel, `Viser error:\n${detail}`);
  }
}

export function normalizeSlackInput(
  content: string,
  prefix: string,
  botUserId: string | undefined,
  isDirectMessage: boolean
): string | undefined {
  const trimmed = content.trim();
  const mention = botUserId ? `<@${botUserId}>` : undefined;
  if (!trimmed) return undefined;
  if (isDirectMessage) return trimmed;
  if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length).trim() || "/help";
  if (mention && trimmed.startsWith(mention)) return trimmed.slice(mention.length).trim() || "/help";
  return undefined;
}

export async function sendSlackMessage(
  token: string,
  channelId: string,
  text: string,
  options: SlackRequestOptions = {}
): Promise<void> {
  for (const chunk of chunkText(text, 3900)) {
    await slackApiCall(token, "chat.postMessage", { channel: channelId, text: chunk }, options);
  }
}

export async function slackApiCall<T extends SlackApiResponse>(
  token: string,
  method: string,
  payload: unknown,
  options: SlackRequestOptions = {}
): Promise<T> {
  try {
    const response = await fetchWithTimeout(options.fetchImpl ?? fetch, `${SLACK_API_BASE}/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    }, options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);

    const body = (await response.json().catch(() => ({}))) as T;
    if (!response.ok || !body.ok) {
      throw new Error(`Slack ${method} failed: ${body.error ?? response.statusText}`);
    }
    return body;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(redactToken(message, token));
  }
}

function redactToken(detail: string, token: string): string {
  return detail.split(token).join("[REDACTED]");
}
