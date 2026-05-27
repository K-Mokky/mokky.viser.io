import test from "node:test";
import assert from "node:assert/strict";
import { handleDiscordMessage, normalizeDiscordInput, sendDiscordMessage } from "../src/connectors/discord.ts";
import { ConnectorRateLimiter } from "../src/connectors/rate-limit.ts";
import { pollTelegramUpdates, sendTelegramMessage } from "../src/connectors/telegram.ts";
import { chunkText } from "../src/utils/text.ts";
import type { AssistantHandleOptions, DiscordConnectorConfig, TelegramConnectorConfig } from "../src/core/types.ts";

test("Discord input accepts DMs without prefix", () => {
  assert.equal(normalizeDiscordInput("hello", "!viser", "123", false), "hello");
});

test("Discord input requires prefix or mention in guild channels", () => {
  assert.equal(normalizeDiscordInput("hello", "!viser", "123", true), undefined);
  assert.equal(normalizeDiscordInput("!viser /help", "!viser", "123", true), "/help");
  assert.equal(normalizeDiscordInput("<@123> status", "!viser", "123", true), "status");
});

test("chunkText respects maximum chunk length", () => {
  const chunks = chunkText("a ".repeat(500), 100);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 100));
});

test("ConnectorRateLimiter limits each peer inside a rolling minute", () => {
  let now = 1_000;
  const limiter = new ConnectorRateLimiter(1, { now: () => now });

  assert.deepEqual(limiter.check("telegram:123"), { allowed: true, retryAfterMs: 0 });
  const denied = limiter.check("telegram:123");
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterMs, 60_000);
  assert.deepEqual(limiter.check("telegram:456"), { allowed: true, retryAfterMs: 0 });

  now += 60_001;
  assert.deepEqual(limiter.check("telegram:123"), { allowed: true, retryAfterMs: 0 });
});

test("pollTelegramUpdates advances offsets even when one update delivery fails", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const calls: string[] = [];
  const logged: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/getUpdates")) {
      return new Response(JSON.stringify({
        ok: true,
        result: [
          {
            update_id: 41,
            message: {
              message_id: 1,
              text: "hello",
              chat: { id: 123, type: "private" },
              from: { id: 7, username: "demo_user" }
            }
          }
        ]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: false, result: null, description: "send failed" }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
  console.error = (message?: unknown) => {
    logged.push(String(message));
  };

  try {
    const nextOffset = await pollTelegramUpdates("token", telegramConfig(), fakeAssistant(), 0);
    assert.equal(nextOffset, 42);
    assert.equal(calls.filter((url) => url.includes("/getUpdates")).length, 1);
    assert.equal(calls.filter((url) => url.includes("/sendMessage")).length, 2);
    assert.match(logged.join("\n"), /Telegram update 41 failed/);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test("pollTelegramUpdates applies per-chat rate limits before invoking the assistant", async () => {
  const originalFetch = globalThis.fetch;
  const sentTexts: string[] = [];
  let assistantCalls = 0;
  const limiter = new ConnectorRateLimiter(1, { now: () => 1_000 });

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/getUpdates")) {
      return new Response(JSON.stringify({
        ok: true,
        result: [
          {
            update_id: 41,
            message: {
              message_id: 1,
              text: "first",
              chat: { id: 123, type: "private" },
              from: { id: 7, username: "demo_user" }
            }
          },
          {
            update_id: 42,
            message: {
              message_id: 2,
              text: "second",
              chat: { id: 123, type: "private" },
              from: { id: 7, username: "demo_user" }
            }
          }
        ]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.includes("/sendMessage")) {
      sentTexts.push(String(JSON.parse(String(init?.body)).text));
      return new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as typeof fetch;

  try {
    const nextOffset = await pollTelegramUpdates("token", telegramConfig(), {
      async handle(_input: string, _sessionId: string, _options?: AssistantHandleOptions): Promise<string> {
        assistantCalls += 1;
        return "answer";
      }
    } as any, 0, undefined, limiter);

    assert.equal(nextOffset, 43);
    assert.equal(assistantCalls, 1);
    assert.deepEqual(sentTexts, [
      "answer",
      "Viser rate limit: too many messages from this chat/channel. Try again in 60s."
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pollTelegramUpdates rejects oversized chat input before invoking the assistant", async () => {
  const originalFetch = globalThis.fetch;
  const sentTexts: string[] = [];
  let assistantCalls = 0;
  const config = { ...telegramConfig(), maxInputChars: 5 };

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/getUpdates")) {
      return new Response(JSON.stringify({
        ok: true,
        result: [
          {
            update_id: 51,
            message: {
              message_id: 1,
              text: "too long",
              chat: { id: 123, type: "private" },
              from: { id: 7, username: "demo_user" }
            }
          }
        ]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.includes("/sendMessage")) {
      sentTexts.push(String(JSON.parse(String(init?.body)).text));
      return new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as typeof fetch;

  try {
    const nextOffset = await pollTelegramUpdates("token", config, {
      async handle(_input: string, _sessionId: string, _options?: AssistantHandleOptions): Promise<string> {
        assistantCalls += 1;
        return "answer";
      }
    } as any, 0);

    assert.equal(nextOffset, 52);
    assert.equal(assistantCalls, 0);
    assert.deepEqual(sentTexts, [
      "Viser input limit: messages from this connector must be 5 characters or fewer. Please shorten the message and try again."
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pollTelegramUpdates honors default chats when an allowlist also exists without access store", async () => {
  const originalFetch = globalThis.fetch;
  const sentTexts: string[] = [];
  let assistantCalls = 0;
  const config = { ...telegramConfig(), allowedChatIds: ["999"], defaultChatIds: ["123"] };

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/getUpdates")) {
      return new Response(JSON.stringify({
        ok: true,
        result: [
          {
            update_id: 61,
            message: {
              message_id: 1,
              text: "hello",
              chat: { id: 123, type: "private" },
              from: { id: 7, username: "demo_user" }
            }
          }
        ]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url.includes("/sendMessage")) {
      sentTexts.push(String(JSON.parse(String(init?.body)).text));
      return new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as typeof fetch;

  try {
    const nextOffset = await pollTelegramUpdates("token", config, {
      async handle(_input: string, _sessionId: string, _options?: AssistantHandleOptions): Promise<string> {
        assistantCalls += 1;
        return "answer";
      }
    } as any, 0);

    assert.equal(nextOffset, 62);
    assert.equal(assistantCalls, 1);
    assert.deepEqual(sentTexts, ["answer"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendTelegramMessage times out stalled Bot API calls", async () => {
  await assert.rejects(
    () => sendTelegramMessage("123456:telegram-secret-token", "123", "hello", {
      fetchImpl: hangingFetch(),
      timeoutMs: 5
    }),
    /fetch timed out after 5ms/
  );
});

test("handleDiscordMessage applies per-channel rate limits before invoking the assistant", async () => {
  const originalFetch = globalThis.fetch;
  const sentTexts: string[] = [];
  let assistantCalls = 0;
  const limiter = new ConnectorRateLimiter(1, { now: () => 1_000 });
  const config = discordConfig();

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentTexts.push(String(JSON.parse(String(init?.body)).content));
    return new Response("", { status: 200 });
  }) as typeof fetch;

  try {
    const assistant = {
      async handle(_input: string, _sessionId: string, _options?: AssistantHandleOptions): Promise<string> {
        assistantCalls += 1;
        return "answer";
      }
    } as any;

    await handleDiscordMessage("discord-secret-token", config, assistant, {
      id: "m1",
      channel_id: "channel-1",
      content: "first",
      author: { id: "user-1", username: "demo_user" }
    }, "bot-1", undefined, limiter);
    await handleDiscordMessage("discord-secret-token", config, assistant, {
      id: "m2",
      channel_id: "channel-1",
      content: "second",
      author: { id: "user-1", username: "demo_user" }
    }, "bot-1", undefined, limiter);

    assert.equal(assistantCalls, 1);
    assert.deepEqual(sentTexts, [
      "answer",
      "Viser rate limit: too many messages from this chat/channel. Try again in 60s."
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleDiscordMessage rejects oversized channel input before invoking the assistant", async () => {
  const originalFetch = globalThis.fetch;
  const sentTexts: string[] = [];
  let assistantCalls = 0;
  const config = { ...discordConfig(), maxInputChars: 5 };

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentTexts.push(String(JSON.parse(String(init?.body)).content));
    return new Response("", { status: 200 });
  }) as typeof fetch;

  try {
    await handleDiscordMessage("discord-secret-token", config, {
      async handle(_input: string, _sessionId: string, _options?: AssistantHandleOptions): Promise<string> {
        assistantCalls += 1;
        return "answer";
      }
    } as any, {
      id: "m1",
      channel_id: "channel-1",
      content: "too long",
      author: { id: "user-1", username: "demo_user" }
    }, "bot-1");

    assert.equal(assistantCalls, 0);
    assert.deepEqual(sentTexts, [
      "Viser input limit: messages from this connector must be 5 characters or fewer. Please shorten the message and try again."
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handleDiscordMessage honors default channels when an allowlist also exists", async () => {
  const originalFetch = globalThis.fetch;
  const sentTexts: string[] = [];
  let assistantCalls = 0;
  const config = { ...discordConfig(), allowedChannelIds: ["other-channel"], defaultChannelIds: ["channel-1"] };
  const access = {
    async isAllowed(_connector: string, _targetId: string, staticAllowlist: string[]): Promise<boolean> {
      assert.deepEqual(staticAllowlist, ["other-channel", "channel-1"]);
      return staticAllowlist.includes("channel-1");
    }
  };

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentTexts.push(String(JSON.parse(String(init?.body)).content));
    return new Response("", { status: 200 });
  }) as typeof fetch;

  try {
    await handleDiscordMessage("discord-secret-token", config, {
      async handle(_input: string, _sessionId: string, _options?: AssistantHandleOptions): Promise<string> {
        assistantCalls += 1;
        return "answer";
      }
    } as any, {
      id: "m1",
      channel_id: "channel-1",
      content: "hello",
      author: { id: "user-1", username: "demo_user" }
    }, "bot-1", access as any);

    assert.equal(assistantCalls, 1);
    assert.deepEqual(sentTexts, ["answer"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendDiscordMessage redacts bot tokens from REST errors", async () => {
  const token = "discord-secret-token";

  await assert.rejects(
    () => sendDiscordMessage(token, "channel", "hello", {
      fetchImpl: async () => new Response(`invalid Bot ${token}`, { status: 401 }),
      timeoutMs: 5
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /discord-secret-token/);
      return true;
    }
  );
});

test("sendDiscordMessage times out stalled REST calls", async () => {
  await assert.rejects(
    () => sendDiscordMessage("discord-secret-token", "channel", "hello", {
      fetchImpl: hangingFetch(),
      timeoutMs: 5
    }),
    /fetch timed out after 5ms/
  );
});

function fakeAssistant() {
  return {
    async handle(_input: string, _sessionId: string, _options?: AssistantHandleOptions): Promise<string> {
      return "answer";
    }
  } as any;
}

function telegramConfig(): TelegramConnectorConfig {
  return {
    enabled: true,
    botTokenEnv: "TELEGRAM_BOT_TOKEN",
    botToken: "token",
    allowedChatIds: [],
    defaultChatIds: [],
    maxMessagesPerMinute: 20,
    maxInputChars: 4000
  };
}

function discordConfig(): DiscordConnectorConfig {
  return {
    enabled: true,
    botTokenEnv: "DISCORD_BOT_TOKEN",
    botToken: "discord-secret-token",
    prefix: "!viser",
    allowedChannelIds: [],
    defaultChannelIds: [],
    maxMessagesPerMinute: 20,
    maxInputChars: 4000
  };
}

function hangingFetch(): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  })) as typeof fetch;
}
