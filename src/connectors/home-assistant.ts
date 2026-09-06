// ================================================================
// Home Assistant REST service-call connector
// ================================================================
// Home Assistant is a smart-home action surface, not a chat transport. Viser
// keeps it approval-gated by routing only configured service aliases through
// connector-message actions or scheduler delivery. The real URL and long-lived
// token stay in local env/config until the final REST call boundary.

import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout, type FetchLike } from "../utils/fetch.ts";
import { normalizeWebhookId } from "./google-chat.ts";
import type { HomeAssistantConnectorConfig } from "../core/types.ts";

export interface HomeAssistantFetchOptions {
  fetchImpl?: FetchLike;
}

export async function callHomeAssistantService(
  config: HomeAssistantConnectorConfig,
  serviceId: string,
  payloadText: string,
  options: HomeAssistantFetchOptions = {}
): Promise<void> {
  const baseUrl = normalizeHomeAssistantBaseUrl(config.baseUrl);
  const accessToken = normalizeHomeAssistantAccessToken(config.accessToken);
  const service = resolveHomeAssistantService(config, serviceId);
  const payload = normalizeHomeAssistantPayload(payloadText);
  const fetchImpl = options.fetchImpl ?? fetch;
  const [domain, serviceName] = service.split(".", 2);
  const url = `${baseUrl}/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(serviceName)}`;

  const response = await fetchWithTimeout(fetchImpl, url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  }, config.sendTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
  const bodyText = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(redactHomeAssistantDetail(`Home Assistant service call failed: ${response.status} ${response.statusText} ${bodyText}`, config, serviceId, service, payloadText));
  }
}

export function resolveHomeAssistantService(config: HomeAssistantConnectorConfig, serviceId: string): string {
  const alias = normalizeHomeAssistantServiceAlias(serviceId);
  const service = config.services[alias] ?? (alias === "default" ? config.service : undefined);
  if (!service) {
    throw new Error(`Home Assistant service alias '${alias}' is not configured. Set ${config.serviceEnv} or ${config.servicesEnv}.`);
  }
  return normalizeHomeAssistantServiceSpec(service);
}

export function hasHomeAssistantService(config: Pick<HomeAssistantConnectorConfig, "service" | "services">): boolean {
  return Boolean(config.service || Object.keys(config.services).length > 0);
}

export function hasHomeAssistantCredentials(config: Pick<HomeAssistantConnectorConfig, "baseUrl" | "accessToken">): boolean {
  return Boolean(config.baseUrl && config.accessToken);
}

export function normalizeHomeAssistantServiceAlias(value: string | undefined): string {
  const id = normalizeWebhookId(value);
  if (!id) throw new Error("Home Assistant service alias must be a short alias such as default or lights.");
  return id.toLowerCase();
}

export function parseHomeAssistantServiceMap(value: string | undefined): Record<string, string> {
  const raw = value?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const output: Record<string, string> = {};
      for (const [key, service] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof service === "string") {
          output[normalizeHomeAssistantServiceAlias(key)] = normalizeHomeAssistantServiceSpec(service);
        }
      }
      return output;
    }
  } catch {
    // Fall back to shell-friendly alias=domain.service lists.
  }

  const output: Record<string, string> = {};
  for (const part of raw.split(/[,\n;]/u)) {
    const item = part.trim();
    if (!item) continue;
    const separator = item.indexOf("=");
    if (separator <= 0 || separator === item.length - 1) {
      throw new Error("Home Assistant service maps must look like default=notify.persistent_notification,lights=light.turn_on.");
    }
    output[normalizeHomeAssistantServiceAlias(item.slice(0, separator))] = normalizeHomeAssistantServiceSpec(item.slice(separator + 1));
  }
  return output;
}

export function normalizeHomeAssistantBaseUrl(value: string | undefined): string {
  const raw = value?.trim() ?? "";
  if (!raw) throw new Error("Home Assistant base URL is required.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Home Assistant base URL must be a valid URL.");
  }
  if (url.username || url.password) throw new Error("Home Assistant base URL must not include credentials.");
  if (url.search || url.hash) throw new Error("Home Assistant base URL must not include query strings or fragments.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalHomeAssistantHost(url.hostname))) {
    throw new Error("Home Assistant base URL must use https://, except local/private http:// Home Assistant hosts.");
  }
  url.pathname = url.pathname.replace(/\/+$/u, "");
  return url.toString().replace(/\/$/u, "");
}

export function normalizeHomeAssistantAccessToken(value: string | undefined): string {
  const token = value?.trim() ?? "";
  if (!token) throw new Error("Home Assistant access token is required.");
  if (token.length < 10 || token.length > 8192 || /[\s\u0000-\u001f\u007f]/u.test(token)) {
    throw new Error("Home Assistant access token must be a single opaque bearer token.");
  }
  return token;
}

export function normalizeHomeAssistantServiceSpec(value: string | undefined): string {
  const service = value?.trim() ?? "";
  if (!/^[a-z0-9_]+\.[a-z0-9_]+$/u.test(service)) {
    throw new Error("Home Assistant service must look like domain.service, for example notify.persistent_notification.");
  }
  return service;
}

export function normalizeHomeAssistantPayload(raw: string): Record<string, unknown> {
  const text = raw.trim();
  if (!text) throw new Error("Home Assistant service payload is required.");
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text)) {
    throw new Error("Home Assistant service payload contains control characters.");
  }
  if (text.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new Error("Home Assistant JSON payload must be a valid object.");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Home Assistant JSON payload must be an object.");
    }
    return parsed as Record<string, unknown>;
  }
  return { message: text };
}

export function redactHomeAssistantDetail(
  detail: string,
  config: HomeAssistantConnectorConfig,
  alias?: string,
  service?: string,
  payloadText?: string
): string {
  let output = detail;
  for (const secret of [config.baseUrl, config.accessToken, config.service, ...Object.values(config.services), alias, service, payloadText]) {
    if (secret) output = output.split(secret).join("[REDACTED]");
  }
  return output;
}

function isLocalHomeAssistantHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "::1" || host.endsWith(".local")) return true;
  if (/^127\./u.test(host)) return true;
  if (/^10\./u.test(host)) return true;
  if (/^192\.168\./u.test(host)) return true;
  const match = /^172\.(\d{1,2})\./u.exec(host);
  if (match) {
    const second = Number(match[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}
