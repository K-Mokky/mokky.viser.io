// ================================================================
// Connector token validation
// ================================================================
// Used by readiness checks. These calls validate transport credentials only;
// model access still happens through local logged-in CLIs.

import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout, type FetchLike } from "../utils/fetch.ts";

export interface TokenValidationResult {
  ok: boolean;
  label: string;
  detail: string;
}

export interface TokenValidationOptions {
  timeoutMs?: number;
}

export async function validateTelegramToken(
  token: string | undefined,
  fetchImpl: FetchLike = fetch,
  options: TokenValidationOptions = {}
): Promise<TokenValidationResult> {
  if (!token) return { ok: false, label: "telegram", detail: "missing token" };

  try {
    const response = await fetchWithTimeout(fetchImpl, `https://api.telegram.org/bot${token}/getMe`, { method: "GET" }, options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: { username?: string }; description?: string };
    if (!response.ok || !body.ok) {
      return { ok: false, label: "telegram", detail: redactToken(body.description ?? response.statusText, token) };
    }
    return { ok: true, label: "telegram", detail: body.result?.username ? `bot @${body.result.username}` : "token accepted" };
  } catch (error) {
    return { ok: false, label: "telegram", detail: redactToken(error instanceof Error ? error.message : String(error), token) };
  }
}

export async function validateDiscordToken(
  token: string | undefined,
  fetchImpl: FetchLike = fetch,
  options: TokenValidationOptions = {}
): Promise<TokenValidationResult> {
  if (!token) return { ok: false, label: "discord", detail: "missing token" };

  try {
    const response = await fetchWithTimeout(fetchImpl, "https://discord.com/api/v10/users/@me", {
      method: "GET",
      headers: { authorization: `Bot ${token}` }
    }, options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
    const body = (await response.json().catch(() => ({}))) as { username?: string; message?: string };
    if (!response.ok) {
      return { ok: false, label: "discord", detail: redactToken(body.message ?? response.statusText, token) };
    }
    return { ok: true, label: "discord", detail: body.username ? `bot ${body.username}` : "token accepted" };
  } catch (error) {
    return { ok: false, label: "discord", detail: redactToken(error instanceof Error ? error.message : String(error), token) };
  }
}

function redactToken(detail: string, token: string): string {
  return detail.split(token).join("[REDACTED]");
}
