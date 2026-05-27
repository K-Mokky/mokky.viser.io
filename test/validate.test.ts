import test from "node:test";
import assert from "node:assert/strict";
import { validateDiscordToken, validateTelegramToken } from "../src/connectors/validate.ts";

function jsonResponse(body: unknown, ok = true, statusText = "OK"): Response {
  return {
    ok,
    statusText,
    json: async () => body
  } as Response;
}

test("validateTelegramToken accepts valid getMe responses", async () => {
  const result = await validateTelegramToken("token", async () => jsonResponse({ ok: true, result: { username: "viser_bot" } }));
  assert.equal(result.ok, true);
  assert.match(result.detail, /viser_bot/);
});

test("validateDiscordToken reports invalid tokens", async () => {
  const result = await validateDiscordToken("bad", async () => jsonResponse({ message: "401: Unauthorized" }, false, "Unauthorized"));
  assert.equal(result.ok, false);
  assert.match(result.detail, /Unauthorized/);
});

test("validateTelegramToken redacts tokens from transport errors", async () => {
  const token = "123456:top-secret-telegram-token";
  const result = await validateTelegramToken(token, async () => {
    throw new Error(`GET https://api.telegram.org/bot${token}/getMe failed`);
  });

  assert.equal(result.ok, false);
  assert.doesNotMatch(result.detail, /top-secret-telegram-token/);
  assert.match(result.detail, /\[REDACTED]/);
});

test("validateDiscordToken redacts tokens from API and transport errors", async () => {
  const token = "discord-secret-token";
  const apiResult = await validateDiscordToken(token, async () => jsonResponse({ message: `invalid Bot ${token}` }, false, "Unauthorized"));
  const transportResult = await validateDiscordToken(token, async () => {
    throw new Error(`authorization header was Bot ${token}`);
  });

  assert.equal(apiResult.ok, false);
  assert.equal(transportResult.ok, false);
  assert.doesNotMatch(apiResult.detail, /discord-secret-token/);
  assert.doesNotMatch(transportResult.detail, /discord-secret-token/);
  assert.match(apiResult.detail, /\[REDACTED]/);
  assert.match(transportResult.detail, /\[REDACTED]/);
});

test("validateDiscordToken times out stalled token validation", async () => {
  const result = await validateDiscordToken("discord-secret-token", hangingFetch(), { timeoutMs: 5 });

  assert.equal(result.ok, false);
  assert.match(result.detail, /timed out after 5ms/);
  assert.doesNotMatch(result.detail, /discord-secret-token/);
});

function hangingFetch(): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  })) as typeof fetch;
}
