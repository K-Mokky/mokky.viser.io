import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { configCheckReport } from "../src/cli/config-check.ts";
import { assertValidConfig, configValidationItems } from "../src/config-validation.ts";
import { DEFAULT_CONFIG, loadConfig } from "../src/config.ts";

test("configValidationItems passes the default config shape", () => {
  const items = configValidationItems(DEFAULT_CONFIG);

  assert.ok(items.some((item) => item.severity === "pass" && item.path === "config"));
  assert.equal(items.some((item) => item.severity === "fail"), false);
});

test("configValidationItems reports actionable shape failures", () => {
  const config = {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, maxInputChars: 50_001 },
    personalization: { ...DEFAULT_CONFIG.personalization, promptLimit: 101, maxValueChars: 5001 },
    skills: { ...DEFAULT_CONFIG.skills, dirs: "skills" },
    plugins: { ...DEFAULT_CONFIG.plugins, promptLimit: 0 },
    tools: {
      ...DEFAULT_CONFIG.tools,
      webFetch: { ...DEFAULT_CONFIG.tools.webFetch, provider: "unsafe", extractMode: "html", cacheTtlMs: 9_999_999 },
      webSearch: { ...DEFAULT_CONFIG.tools.webSearch, provider: "unsafe", maxResults: 99 }
    },
    jobs: { ...DEFAULT_CONFIG.jobs, concurrency: 99 },
    webDashboard: { ...DEFAULT_CONFIG.webDashboard, host: "0.0.0.0", port: 70_000 },
    access: { ...DEFAULT_CONFIG.access, defaultPolicy: "everyone" },
    connectors: {
      telegram: { ...DEFAULT_CONFIG.connectors.telegram, maxMessagesPerMinute: 121, maxInputChars: 20_001 },
      discord: { ...DEFAULT_CONFIG.connectors.discord, maxMessagesPerMinute: 0, maxInputChars: 0 },
      slack: { ...DEFAULT_CONFIG.connectors.slack, maxMessagesPerMinute: 0, maxInputChars: 0 },
      matrix: { ...DEFAULT_CONFIG.connectors.matrix },
      signal: { ...DEFAULT_CONFIG.connectors.signal },
      imessage: { ...DEFAULT_CONFIG.connectors.imessage },
      whatsapp: { ...DEFAULT_CONFIG.connectors.whatsapp, webhookPort: 70_000, webhookPath: "bad", maxMessagesPerMinute: 0, maxInputChars: 0 },
      line: { ...DEFAULT_CONFIG.connectors.line, webhookPort: 70_000, webhookPath: "bad", maxMessagesPerMinute: 0, maxInputChars: 0, sendTimeoutMs: 200_000 },
      googleChat: { ...DEFAULT_CONFIG.connectors.googleChat, webhookUrls: { ops: 123 }, sendTimeoutMs: 200_000 },
      teams: { ...DEFAULT_CONFIG.connectors.teams, allowedWebhookIds: "ops", sendTimeoutMs: 200_000 },
      mattermost: { ...DEFAULT_CONFIG.connectors.mattermost, webhookUrls: { ops: 123 }, sendTimeoutMs: 200_000 },
      synologyChat: { ...DEFAULT_CONFIG.connectors.synologyChat, webhookUrls: { ops: 123 }, sendTimeoutMs: 200_000 },
      rocketChat: { ...DEFAULT_CONFIG.connectors.rocketChat, webhookUrls: { ops: 123 }, sendTimeoutMs: 200_000 },
      feishu: { ...DEFAULT_CONFIG.connectors.feishu, defaultWebhookIds: "ops", sendTimeoutMs: 200_000 },
      dingtalk: { ...DEFAULT_CONFIG.connectors.dingtalk, webhookUrls: { ops: 123 }, sendTimeoutMs: 200_000 },
      wecom: { ...DEFAULT_CONFIG.connectors.wecom, allowedWebhookIds: "ops", sendTimeoutMs: 200_000 },
      zalo: { ...DEFAULT_CONFIG.connectors.zalo, recipients: { ops: 123 }, allowedRecipientIds: "ops", sendTimeoutMs: 200_000 },
      irc: { ...DEFAULT_CONFIG.connectors.irc, host: undefined, nick: undefined, password: undefined, channel: undefined, channels: {}, allowedChannelIds: [], defaultChannelIds: [] },
      webex: { ...DEFAULT_CONFIG.connectors.webex, allowedRoomIds: "ops", sendTimeoutMs: 200_000 },
      zulip: { ...DEFAULT_CONFIG.connectors.zulip, targets: { ops: 123 }, allowedTargetIds: "ops", sendTimeoutMs: 200_000 },
      email: { ...DEFAULT_CONFIG.connectors.email, enabled: false, from: undefined, recipient: undefined, recipients: {}, allowedRecipientIds: [], defaultRecipientIds: [] },
      github: { ...DEFAULT_CONFIG.connectors.github, enabled: false, token: undefined, target: undefined, targets: {}, allowedTargetIds: [], defaultTargetIds: [] },
      todoist: { ...DEFAULT_CONFIG.connectors.todoist, enabled: false, token: undefined, project: undefined, projects: {}, allowedProjectIds: [], defaultProjectIds: [] },
      notion: { ...DEFAULT_CONFIG.connectors.notion, enabled: false, token: undefined, page: undefined, pages: {}, allowedPageIds: [], defaultPageIds: [] },
      obsidian: { ...DEFAULT_CONFIG.connectors.obsidian, enabled: false, vaultDir: undefined, note: undefined, notes: {}, allowedNoteIds: [], defaultNoteIds: [] }
    },
    providers: {
      bad: {
        id: "bad",
        command: "node",
        args: ["-e", "console.log('ok')"],
        promptMode: "template",
        timeoutMs: 1000,
        maxOutputBytes: 0
      }
    }
  };

  const items = configValidationItems(config);

  assert.ok(items.some((item) => item.severity === "fail" && item.path === "skills.dirs"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "assistant.maxInputChars"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "personalization.promptLimit"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "personalization.maxValueChars"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "plugins.promptLimit"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "tools.webFetch.extractMode"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "tools.webFetch.provider"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "tools.webFetch.cacheTtlMs"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "tools.webSearch.provider"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "tools.webSearch.maxResults"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "jobs.concurrency"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "webDashboard.host"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "webDashboard.port"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "access.defaultPolicy"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.telegram.maxMessagesPerMinute"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.discord.maxMessagesPerMinute"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.slack.maxMessagesPerMinute"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.whatsapp.maxMessagesPerMinute"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.whatsapp.webhookPort"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.whatsapp.webhookPath"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.line.maxMessagesPerMinute"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.line.webhookPort"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.line.webhookPath"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.line.sendTimeoutMs"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.googleChat.webhookUrls.ops"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.googleChat.sendTimeoutMs"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.teams.allowedWebhookIds"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.teams.sendTimeoutMs"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.mattermost.webhookUrls.ops"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.mattermost.sendTimeoutMs"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.synologyChat.webhookUrls.ops"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.synologyChat.sendTimeoutMs"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.rocketChat.webhookUrls.ops"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.rocketChat.sendTimeoutMs"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.feishu.defaultWebhookIds"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.feishu.sendTimeoutMs"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.dingtalk.webhookUrls.ops"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.dingtalk.sendTimeoutMs"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.wecom.allowedWebhookIds"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.wecom.sendTimeoutMs"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.zalo.recipients.ops"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.zalo.allowedRecipientIds"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.zalo.sendTimeoutMs"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.webex.allowedRoomIds"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.webex.sendTimeoutMs"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.zulip.targets.ops"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.zulip.allowedTargetIds"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.zulip.sendTimeoutMs"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.telegram.maxInputChars"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.discord.maxInputChars"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.slack.maxInputChars"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.whatsapp.maxInputChars"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "connectors.line.maxInputChars"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "providers.bad.args"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "providers.bad.maxOutputBytes"));
});

test("configValidationItems requires a safe SearXNG base URL when selected", () => {
  const missingBase = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webSearch: { ...DEFAULT_CONFIG.tools.webSearch, provider: "searxng-html", searxngBaseUrl: undefined }
    }
  });
  assert.ok(missingBase.some((item) => item.severity === "fail" && item.path === "tools.webSearch.searxngBaseUrl"));

  const unsafeBase = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webSearch: {
        ...DEFAULT_CONFIG.tools.webSearch,
        provider: "searxng-html",
        searxngBaseUrl: "http://user:pass@searxng.example.com"
      }
    }
  });
  assert.ok(unsafeBase.some((item) => item.severity === "fail" && item.path === "tools.webSearch.searxngBaseUrl" && /https/.test(item.message)));
  assert.ok(unsafeBase.some((item) => item.severity === "fail" && item.path === "tools.webSearch.searxngBaseUrl" && /credentials/.test(item.message)));

  const valid = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webSearch: { ...DEFAULT_CONFIG.tools.webSearch, provider: "searxng-html", searxngBaseUrl: "https://searxng.example.com" }
    }
  });
  assert.equal(valid.some((item) => item.severity === "fail"), false);
});

test("configValidationItems allows Firecrawl web-fetch provider only with a key source", () => {
  const missingKeySource = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webFetch: {
        ...DEFAULT_CONFIG.tools.webFetch,
        provider: "firecrawl-api",
        firecrawlApiKeyEnv: "",
        firecrawlApiKey: undefined
      }
    }
  });
  assert.ok(missingKeySource.some((item) => item.severity === "fail" && item.path === "tools.webFetch.firecrawlApiKeyEnv"));

  const unsafeLiteralKey = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webFetch: {
        ...DEFAULT_CONFIG.tools.webFetch,
        provider: "firecrawl-api",
        firecrawlApiKey: "firecrawl key with spaces"
      }
    }
  });
  assert.ok(unsafeLiteralKey.some((item) => item.severity === "fail" && item.path === "tools.webFetch.firecrawlApiKey"));

  const validEnvBacked = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webFetch: {
        ...DEFAULT_CONFIG.tools.webFetch,
        provider: "firecrawl-api",
        firecrawlApiKeyEnv: "FIRECRAWL_API_KEY",
        firecrawlApiKey: undefined
      }
    }
  });
  assert.equal(validEnvBacked.some((item) => item.severity === "fail"), false);
});

test("configValidationItems allows Brave Search API provider only with a key source", () => {
  const missingKeySource = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webSearch: {
        ...DEFAULT_CONFIG.tools.webSearch,
        provider: "brave-api",
        braveApiKeyEnv: "",
        braveApiKey: undefined
      }
    }
  });
  assert.ok(missingKeySource.some((item) => item.severity === "fail" && item.path === "tools.webSearch.braveApiKeyEnv"));

  const unsafeLiteralKey = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webSearch: {
        ...DEFAULT_CONFIG.tools.webSearch,
        provider: "brave-api",
        braveApiKey: "brave key with spaces"
      }
    }
  });
  assert.ok(unsafeLiteralKey.some((item) => item.severity === "fail" && item.path === "tools.webSearch.braveApiKey"));

  const validEnvBacked = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webSearch: {
        ...DEFAULT_CONFIG.tools.webSearch,
        provider: "brave-api",
        braveApiKeyEnv: "BRAVE_SEARCH_API_KEY",
        braveApiKey: undefined
      }
    }
  });
  assert.equal(validEnvBacked.some((item) => item.severity === "fail"), false);
});

test("configValidationItems allows Tavily Search API provider only with a key source", () => {
  const missingKeySource = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webSearch: {
        ...DEFAULT_CONFIG.tools.webSearch,
        provider: "tavily-api",
        tavilyApiKeyEnv: "",
        tavilyApiKey: undefined
      }
    }
  });
  assert.ok(missingKeySource.some((item) => item.severity === "fail" && item.path === "tools.webSearch.tavilyApiKeyEnv"));

  const unsafeLiteralKey = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webSearch: {
        ...DEFAULT_CONFIG.tools.webSearch,
        provider: "tavily-api",
        tavilyApiKey: "tavily key with spaces"
      }
    }
  });
  assert.ok(unsafeLiteralKey.some((item) => item.severity === "fail" && item.path === "tools.webSearch.tavilyApiKey"));

  const validEnvBacked = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webSearch: {
        ...DEFAULT_CONFIG.tools.webSearch,
        provider: "tavily-api",
        tavilyApiKeyEnv: "TAVILY_API_KEY",
        tavilyApiKey: undefined
      }
    }
  });
  assert.equal(validEnvBacked.some((item) => item.severity === "fail"), false);
});

test("configValidationItems allows Perplexity Search API provider only with a key source", () => {
  const missingKeySource = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webSearch: {
        ...DEFAULT_CONFIG.tools.webSearch,
        provider: "perplexity-api",
        perplexityApiKeyEnv: "",
        perplexityApiKey: undefined
      }
    }
  });
  assert.ok(missingKeySource.some((item) => item.severity === "fail" && item.path === "tools.webSearch.perplexityApiKeyEnv"));

  const unsafeLiteralKey = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webSearch: {
        ...DEFAULT_CONFIG.tools.webSearch,
        provider: "perplexity-api",
        perplexityApiKey: "perplexity key with spaces"
      }
    }
  });
  assert.ok(unsafeLiteralKey.some((item) => item.severity === "fail" && item.path === "tools.webSearch.perplexityApiKey"));

  const validEnvBacked = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webSearch: {
        ...DEFAULT_CONFIG.tools.webSearch,
        provider: "perplexity-api",
        perplexityApiKeyEnv: "PERPLEXITY_API_KEY",
        perplexityApiKey: undefined
      }
    }
  });
  assert.equal(validEnvBacked.some((item) => item.severity === "fail"), false);
});

test("configValidationItems allows Exa Search API provider only with a key source", () => {
  const missingKeySource = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webSearch: {
        ...DEFAULT_CONFIG.tools.webSearch,
        provider: "exa-api",
        exaApiKeyEnv: "",
        exaApiKey: undefined
      }
    }
  });
  assert.ok(missingKeySource.some((item) => item.severity === "fail" && item.path === "tools.webSearch.exaApiKeyEnv"));

  const unsafeLiteralKey = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webSearch: {
        ...DEFAULT_CONFIG.tools.webSearch,
        provider: "exa-api",
        exaApiKey: "exa key with spaces"
      }
    }
  });
  assert.ok(unsafeLiteralKey.some((item) => item.severity === "fail" && item.path === "tools.webSearch.exaApiKey"));

  const validEnvBacked = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webSearch: {
        ...DEFAULT_CONFIG.tools.webSearch,
        provider: "exa-api",
        exaApiKeyEnv: "EXA_API_KEY",
        exaApiKey: undefined
      }
    }
  });
  assert.equal(validEnvBacked.some((item) => item.severity === "fail"), false);
});

test("configValidationItems allows Firecrawl Search API provider only with a key source", () => {
  const missingKeySource = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webSearch: {
        ...DEFAULT_CONFIG.tools.webSearch,
        provider: "firecrawl-api",
        firecrawlApiKeyEnv: "",
        firecrawlApiKey: undefined
      }
    }
  });
  assert.ok(missingKeySource.some((item) => item.severity === "fail" && item.path === "tools.webSearch.firecrawlApiKeyEnv"));

  const unsafeLiteralKey = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webSearch: {
        ...DEFAULT_CONFIG.tools.webSearch,
        provider: "firecrawl-api",
        firecrawlApiKey: "firecrawl key with spaces"
      }
    }
  });
  assert.ok(unsafeLiteralKey.some((item) => item.severity === "fail" && item.path === "tools.webSearch.firecrawlApiKey"));

  const validEnvBacked = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webSearch: {
        ...DEFAULT_CONFIG.tools.webSearch,
        provider: "firecrawl-api",
        firecrawlApiKeyEnv: "FIRECRAWL_API_KEY",
        firecrawlApiKey: undefined
      }
    }
  });
  assert.equal(validEnvBacked.some((item) => item.severity === "fail"), false);
});

test("configValidationItems validates Ollama Web Search provider base URL and hosted key source", () => {
  const localDaemon = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webSearch: {
        ...DEFAULT_CONFIG.tools.webSearch,
        provider: "ollama-api",
        ollamaBaseUrl: "http://127.0.0.1:11434",
        ollamaApiKey: undefined
      }
    }
  });
  assert.equal(localDaemon.some((item) => item.severity === "fail"), false);

  const hostedMissingKey = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webSearch: {
        ...DEFAULT_CONFIG.tools.webSearch,
        provider: "ollama-api",
        ollamaBaseUrl: "https://ollama.com",
        ollamaApiKeyEnv: "",
        ollamaApiKey: undefined
      }
    }
  });
  assert.ok(hostedMissingKey.some((item) => item.severity === "fail" && item.path === "tools.webSearch.ollamaApiKeyEnv"));

  const unsafeBase = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webSearch: {
        ...DEFAULT_CONFIG.tools.webSearch,
        provider: "ollama-api",
        ollamaBaseUrl: "http://ollama.example.com?token=bad"
      }
    }
  });
  assert.ok(unsafeBase.some((item) => item.severity === "fail" && item.path === "tools.webSearch.ollamaBaseUrl" && /http/i.test(item.message)));
  assert.ok(unsafeBase.some((item) => item.severity === "fail" && item.path === "tools.webSearch.ollamaBaseUrl" && /query/i.test(item.message)));

  const unsafeLiteralKey = configValidationItems({
    ...DEFAULT_CONFIG,
    tools: {
      ...DEFAULT_CONFIG.tools,
      webSearch: {
        ...DEFAULT_CONFIG.tools.webSearch,
        provider: "ollama-api",
        ollamaBaseUrl: "https://ollama.com",
        ollamaApiKey: "ollama key with spaces"
      }
    }
  });
  assert.ok(unsafeLiteralKey.some((item) => item.severity === "fail" && item.path === "tools.webSearch.ollamaApiKey"));
});

test("configValidationItems validates Browser Use cloud task action bounds", () => {
  const config = {
    ...DEFAULT_CONFIG,
    actions: {
      ...DEFAULT_CONFIG.actions,
      browserTask: {
        ...DEFAULT_CONFIG.actions.browserTask,
        enabled: true,
        browserUseBaseUrl: "http://api.browser-use.com",
        browserbaseBaseUrl: "http://api.browserbase.com/v1",
        browserbaseSessionTimeoutSeconds: 59,
        firecrawlBaseUrl: "https://api.firecrawl.dev/v2",
        firecrawlInteractTimeoutSeconds: 301,
        firecrawlMaxResultChars: 50_001,
        localCdpBaseUrl: "http://192.168.1.10:9222/json",
        localCdpWaitMs: 30_001,
        localCdpMaxContentChars: 50_001,
        allowedDomains: ["localhost", "example.com:443"],
        maxAgentSteps: 301,
        timeoutMs: 121_000
      }
    }
  };

  const items = configValidationItems(config);

  assert.ok(items.some((item) => item.severity === "fail" && item.path === "actions.browserTask.browserUseBaseUrl" && /https/.test(item.message)));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "actions.browserTask.browserbaseBaseUrl" && /https|path/.test(item.message)));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "actions.browserTask.browserbaseSessionTimeoutSeconds"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "actions.browserTask.firecrawlBaseUrl" && /path/.test(item.message)));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "actions.browserTask.firecrawlInteractTimeoutSeconds"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "actions.browserTask.firecrawlMaxResultChars"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "actions.browserTask.localCdpBaseUrl" && /localhost|path/.test(item.message)));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "actions.browserTask.localCdpWaitMs"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "actions.browserTask.localCdpMaxContentChars"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "actions.browserTask.allowedDomains" && /public|invalid/.test(item.message)));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "actions.browserTask.maxAgentSteps"));
  assert.ok(items.some((item) => item.severity === "fail" && item.path === "actions.browserTask.timeoutMs"));
});

test("loadConfig resolves Brave Search API key from the configured env name", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-config-brave-search-env-"));
  const oldKey = process.env.BRAVE_SEARCH_API_KEY;
  try {
    const configPath = join(dir, "viser.config.json");
    await writeFile(configPath, JSON.stringify({
      tools: { webSearch: { provider: "brave-api" } }
    }), "utf8");
    process.env.BRAVE_SEARCH_API_KEY = "test-brave-key";

    const config = await loadConfig({ baseDir: dir, configPath });

    assert.equal(config.tools.webSearch.provider, "brave-api");
    assert.equal(config.tools.webSearch.braveApiKey, "test-brave-key");
  } finally {
    if (oldKey === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
    else process.env.BRAVE_SEARCH_API_KEY = oldKey;
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig resolves Tavily Search API key from the configured env name", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-config-tavily-search-env-"));
  const oldKey = process.env.TAVILY_API_KEY;
  try {
    const configPath = join(dir, "viser.config.json");
    await writeFile(configPath, JSON.stringify({
      tools: { webSearch: { provider: "tavily-api" } }
    }), "utf8");
    process.env.TAVILY_API_KEY = "test-tavily-key";

    const config = await loadConfig({ baseDir: dir, configPath });

    assert.equal(config.tools.webSearch.provider, "tavily-api");
    assert.equal(config.tools.webSearch.tavilyApiKey, "test-tavily-key");
  } finally {
    if (oldKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = oldKey;
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig resolves Perplexity Search API key from the configured env name", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-config-perplexity-search-env-"));
  const oldKey = process.env.PERPLEXITY_API_KEY;
  try {
    const configPath = join(dir, "viser.config.json");
    await writeFile(configPath, JSON.stringify({
      tools: { webSearch: { provider: "perplexity-api" } }
    }), "utf8");
    process.env.PERPLEXITY_API_KEY = "test-perplexity-key";

    const config = await loadConfig({ baseDir: dir, configPath });

    assert.equal(config.tools.webSearch.provider, "perplexity-api");
    assert.equal(config.tools.webSearch.perplexityApiKey, "test-perplexity-key");
  } finally {
    if (oldKey === undefined) delete process.env.PERPLEXITY_API_KEY;
    else process.env.PERPLEXITY_API_KEY = oldKey;
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig resolves Exa Search API key from the configured env name", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-config-exa-search-env-"));
  const oldKey = process.env.EXA_API_KEY;
  try {
    const configPath = join(dir, "viser.config.json");
    await writeFile(configPath, JSON.stringify({
      tools: { webSearch: { provider: "exa-api" } }
    }), "utf8");
    process.env.EXA_API_KEY = "test-exa-key";

    const config = await loadConfig({ baseDir: dir, configPath });

    assert.equal(config.tools.webSearch.provider, "exa-api");
    assert.equal(config.tools.webSearch.exaApiKey, "test-exa-key");
  } finally {
    if (oldKey === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = oldKey;
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig resolves Firecrawl Search API key from the configured env name", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-config-firecrawl-search-env-"));
  const oldKey = process.env.FIRECRAWL_API_KEY;
  try {
    const configPath = join(dir, "viser.config.json");
    await writeFile(configPath, JSON.stringify({
      tools: { webSearch: { provider: "firecrawl-api" } }
    }), "utf8");
    process.env.FIRECRAWL_API_KEY = "test-firecrawl-key";

    const config = await loadConfig({ baseDir: dir, configPath });

    assert.equal(config.tools.webSearch.provider, "firecrawl-api");
    assert.equal(config.tools.webSearch.firecrawlApiKey, "test-firecrawl-key");
  } finally {
    if (oldKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = oldKey;
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig resolves Ollama Web Search API key from the configured env name", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-config-ollama-search-env-"));
  const oldKey = process.env.OLLAMA_API_KEY;
  try {
    const configPath = join(dir, "viser.config.json");
    await writeFile(configPath, JSON.stringify({
      tools: { webSearch: { provider: "ollama-api", ollamaBaseUrl: "https://ollama.com" } }
    }), "utf8");
    process.env.OLLAMA_API_KEY = "test-ollama-key";

    const config = await loadConfig({ baseDir: dir, configPath });

    assert.equal(config.tools.webSearch.provider, "ollama-api");
    assert.equal(config.tools.webSearch.ollamaBaseUrl, "https://ollama.com");
    assert.equal(config.tools.webSearch.ollamaApiKey, "test-ollama-key");
  } finally {
    if (oldKey === undefined) delete process.env.OLLAMA_API_KEY;
    else process.env.OLLAMA_API_KEY = oldKey;
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig resolves Firecrawl Scrape API key from the configured env name", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-config-firecrawl-fetch-env-"));
  const oldKey = process.env.FIRECRAWL_API_KEY;
  try {
    const configPath = join(dir, "viser.config.json");
    await writeFile(configPath, JSON.stringify({
      tools: { webFetch: { provider: "firecrawl-api" } }
    }), "utf8");
    process.env.FIRECRAWL_API_KEY = "test-firecrawl-fetch-key";

    const config = await loadConfig({ baseDir: dir, configPath });

    assert.equal(config.tools.webFetch.provider, "firecrawl-api");
    assert.equal(config.tools.webFetch.firecrawlApiKey, "test-firecrawl-fetch-key");
  } finally {
    if (oldKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = oldKey;
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig resolves browser-task transport env values from configured env names", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-config-browser-use-env-"));
  const oldValue = process.env.BROWSER_USE_API_KEY;
  const oldCdpValue = process.env.VISER_TEST_BROWSER_CDP_URL;
  const oldBrowserbaseKey = process.env.VISER_TEST_BROWSERBASE_KEY;
  const oldBrowserbaseProject = process.env.VISER_TEST_BROWSERBASE_PROJECT;
  const oldFirecrawlKey = process.env.VISER_TEST_FIRECRAWL_BROWSER_KEY;
  try {
    const configPath = join(dir, "viser.config.json");
    await writeFile(configPath, JSON.stringify({
      actions: {
        browserTask: {
          browserUseApiKeyEnv: "VISER_TEST_BROWSER_USE_KEY",
          browserbaseApiKeyEnv: "VISER_TEST_BROWSERBASE_KEY",
          browserbaseProjectIdEnv: "VISER_TEST_BROWSERBASE_PROJECT",
          firecrawlApiKeyEnv: "VISER_TEST_FIRECRAWL_BROWSER_KEY",
          localCdpBaseUrlEnv: "VISER_TEST_BROWSER_CDP_URL"
        }
      }
    }), "utf8");
    process.env.VISER_TEST_BROWSER_USE_KEY = "browser-use-secret-token";
    process.env.VISER_TEST_BROWSERBASE_KEY = "browserbase-secret-token";
    process.env.VISER_TEST_BROWSERBASE_PROJECT = "project_123";
    process.env.VISER_TEST_FIRECRAWL_BROWSER_KEY = "firecrawl-secret-token";
    process.env.VISER_TEST_BROWSER_CDP_URL = "http://localhost:9333";

    const config = await loadConfig({ baseDir: dir, configPath });

    assert.equal(config.actions.browserTask.browserUseApiKey, "browser-use-secret-token");
    assert.equal(config.actions.browserTask.browserbaseApiKey, "browserbase-secret-token");
    assert.equal(config.actions.browserTask.browserbaseProjectId, "project_123");
    assert.equal(config.actions.browserTask.firecrawlApiKey, "firecrawl-secret-token");
    assert.equal(config.actions.browserTask.localCdpBaseUrl, "http://localhost:9333");
  } finally {
    if (oldValue === undefined) delete process.env.BROWSER_USE_API_KEY;
    else process.env.BROWSER_USE_API_KEY = oldValue;
    delete process.env.VISER_TEST_BROWSER_USE_KEY;
    if (oldBrowserbaseKey === undefined) delete process.env.VISER_TEST_BROWSERBASE_KEY;
    else process.env.VISER_TEST_BROWSERBASE_KEY = oldBrowserbaseKey;
    if (oldBrowserbaseProject === undefined) delete process.env.VISER_TEST_BROWSERBASE_PROJECT;
    else process.env.VISER_TEST_BROWSERBASE_PROJECT = oldBrowserbaseProject;
    if (oldFirecrawlKey === undefined) delete process.env.VISER_TEST_FIRECRAWL_BROWSER_KEY;
    else process.env.VISER_TEST_FIRECRAWL_BROWSER_KEY = oldFirecrawlKey;
    if (oldCdpValue === undefined) delete process.env.VISER_TEST_BROWSER_CDP_URL;
    else process.env.VISER_TEST_BROWSER_CDP_URL = oldCdpValue;
    await rm(dir, { recursive: true, force: true });
  }
});

test("configValidationItems allows non-local web dashboard host only with explicit remote opt-in", () => {
  const remote = {
    ...DEFAULT_CONFIG,
    webDashboard: { ...DEFAULT_CONFIG.webDashboard, host: "0.0.0.0", allowRemote: true }
  };

  const items = configValidationItems(remote);

  assert.equal(items.some((item) => item.severity === "fail" && item.path === "webDashboard.host"), false);
});

test("assertValidConfig throws a readable config error", () => {
  assert.throws(
    () => assertValidConfig({ ...DEFAULT_CONFIG, memory: { ...DEFAULT_CONFIG.memory, promptLimit: 0 } }),
    /Invalid Viser config:\n- memory\.promptLimit: must be a positive integer/
  );
});

test("loadConfig validates user JSON before path normalization", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-config-validation-"));
  try {
    const configPath = join(dir, "viser.config.json");
    await writeFile(configPath, JSON.stringify({ skills: { dirs: "not-an-array" } }), "utf8");

    await assert.rejects(
      loadConfig({ baseDir: dir, configPath }),
      /Invalid Viser config:\n- skills\.dirs: must be an array of strings/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig refuses to read symlinked config files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-config-symlink-"));
  try {
    const outsideConfig = join(dir, "outside.config.json");
    const configPath = join(dir, "viser.config.json");
    await writeFile(outsideConfig, JSON.stringify({ assistant: { defaultProvider: "outside" } }), "utf8");
    await symlink(outsideConfig, configPath);

    await assert.rejects(
      () => loadConfig({ baseDir: dir, configPath }),
      /symlink/i
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig refuses broken symlink config files instead of silently using defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-config-broken-symlink-"));
  try {
    const configPath = join(dir, "viser.config.json");
    await symlink(join(dir, "missing.config.json"), configPath);

    await assert.rejects(
      () => loadConfig({ baseDir: dir, configPath }),
      /symlink/i
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig fails fast when an explicit config path is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-config-missing-explicit-"));
  try {
    await assert.rejects(
      () => loadConfig({ baseDir: dir, configPath: join(dir, "missing.config.json") }),
      /ENOENT|no such file/i
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig fails fast when VISER_CONFIG points at a missing file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-config-missing-env-"));
  const oldViserConfig = process.env.VISER_CONFIG;
  try {
    await writeFile(join(dir, "viser.config.json"), JSON.stringify({ assistant: { defaultProvider: "default-file" } }), "utf8");
    process.env.VISER_CONFIG = join(dir, "missing.config.json");

    await assert.rejects(
      () => loadConfig({ baseDir: dir }),
      /ENOENT|no such file/i
    );
  } finally {
    if (oldViserConfig === undefined) delete process.env.VISER_CONFIG;
    else process.env.VISER_CONFIG = oldViserConfig;
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig refuses config files under symlinked parent components", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-config-parent-symlink-"));
  try {
    const outsideDir = join(dir, "outside-config");
    const linkDir = join(dir, "linked-config");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, "viser.config.json"), JSON.stringify({ assistant: { defaultProvider: "outside" } }), "utf8");
    await symlink(outsideDir, linkDir);

    await assert.rejects(
      () => loadConfig({ baseDir: dir, configPath: join(linkDir, "viser.config.json") }),
      /symlink/i
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig normalizes provider cwd relative to the config baseDir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-config-provider-cwd-"));
  const originalProvider = process.env.VISER_PROVIDER;
  delete process.env.VISER_PROVIDER;
  try {
    const configPath = join(dir, "viser.config.json");
    await writeFile(configPath, JSON.stringify({ providers: { codex: { cwd: "provider-cwd" } } }), "utf8");

    const config = await loadConfig({ baseDir: dir, configPath });

    assert.equal(config.providers.codex.cwd, join(dir, "provider-cwd"));
  } finally {
    if (originalProvider === undefined) delete process.env.VISER_PROVIDER;
    else process.env.VISER_PROVIDER = originalProvider;
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig does not mutate DEFAULT_CONFIG or reuse nested defaults", async () => {
  const firstDir = await mkdtemp(join(tmpdir(), "viser-config-first-"));
  const secondDir = await mkdtemp(join(tmpdir(), "viser-config-second-"));
  const originalProvider = process.env.VISER_PROVIDER;
  const originalConfig = process.env.VISER_CONFIG;
  delete process.env.VISER_PROVIDER;
  delete process.env.VISER_CONFIG;

  try {
    const before = JSON.stringify(DEFAULT_CONFIG);
    const first = await loadConfig({ baseDir: firstDir });
    const second = await loadConfig({ baseDir: secondDir });

    assert.equal(JSON.stringify(DEFAULT_CONFIG), before);
    assert.equal(DEFAULT_CONFIG.assistant.workdir, ".");
    assert.equal(DEFAULT_CONFIG.storage.dir, ".viser");
    assert.deepEqual(DEFAULT_CONFIG.skills.dirs, ["skills", ".viser/skills"]);
    assert.equal(first.assistant.workdir, firstDir);
    assert.equal(second.assistant.workdir, secondDir);
    assert.notEqual(first.assistant, DEFAULT_CONFIG.assistant);
    assert.notEqual(first.skills.dirs, DEFAULT_CONFIG.skills.dirs);
    assert.notEqual(first.providers.codex.args, DEFAULT_CONFIG.providers.codex.args);
  } finally {
    if (originalProvider === undefined) delete process.env.VISER_PROVIDER;
    else process.env.VISER_PROVIDER = originalProvider;
    if (originalConfig === undefined) delete process.env.VISER_CONFIG;
    else process.env.VISER_CONFIG = originalConfig;
    await rm(firstDir, { recursive: true, force: true });
    await rm(secondDir, { recursive: true, force: true });
  }
});

test("configCheckReport returns a user-facing validation summary", async () => {
  const report = await configCheckReport(DEFAULT_CONFIG);

  assert.match(report, /Viser config: VALID/);
  assert.match(report, /config.*shape is valid/);
});
