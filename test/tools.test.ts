import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readToolFileNoFollow, splitCommandLine, ToolRunner } from "../src/core/tools.ts";
import type { ToolsConfig } from "../src/core/types.ts";

test("splitCommandLine handles quoted arguments", () => {
  assert.deepEqual(splitCommandLine('read-file "hello world.txt"'), ["read-file", "hello world.txt"]);
});

test("ToolRunner reads only under allowed roots and blocks shell metacharacters", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-"));
  try {
    await writeFile(join(dir, "note.txt"), "hello", "utf8");
    const runner = new ToolRunner(testToolsConfig(dir));
    const read = await runner.run("read-file note.txt");
    assert.equal(read.ok, true);
    assert.equal(read.output, "hello");

    const shell = await runner.run("shell pwd; rm -rf /tmp/nope");
    assert.equal(shell.ok, false);
    assert.match(shell.output, /metacharacters/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner web-fetch reads bounded remote text without JavaScript execution", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-web-fetch-"));
  try {
    const requested: string[] = [];
    const runner = new ToolRunner(testToolsConfig(dir), {
      lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
      fetchImpl: async (input) => {
        requested.push(String(input));
        return new Response("<html><head><script>window.evil=1</script></head><body><h1>Hello &amp; safe</h1><p>Readable web text.</p></body></html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" }
        });
      }
    });

    const result = await runner.run("web-fetch https://example.com/page 80");
    const cached = await runner.run("web-fetch https://example.com/page 80");
    const markdown = await runner.run("web-fetch https://example.com/page 200 markdown");

    assert.equal(result.ok, true);
    assert.equal(cached.ok, true);
    assert.equal(markdown.ok, true);
    assert.deepEqual(requested, ["https://example.com/page", "https://example.com/page"]);
    assert.match(result.output, /url: https:\/\/example\.com\/page/);
    assert.match(result.output, /extract-mode: text/);
    assert.match(result.output, /cache: miss/);
    assert.match(result.output, /Hello & safe/);
    assert.match(result.output, /Readable web text/);
    assert.doesNotMatch(result.output, /window\.evil/);
    assert.match(cached.output, /cache: hit/);
    assert.match(markdown.output, /extract-mode: markdown/);
    assert.match(markdown.output, /# Hello & safe/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner web-fetch can use a configured Firecrawl Scrape API provider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-web-fetch-firecrawl-"));
  try {
    const requested: string[] = [];
    const seenAuth: string[] = [];
    const seenBodies: string[] = [];
    const config = testToolsConfig(dir);
    config.webFetch = {
      ...config.webFetch,
      provider: "firecrawl-api",
      firecrawlApiKey: "firecrawl-smoke-token"
    };
    const runner = new ToolRunner(config, {
      lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
      fetchImpl: async (input, init) => {
        requested.push(String(input));
        seenAuth.push(new Headers(init?.headers).get("authorization") ?? "");
        seenBodies.push(String(init?.body ?? ""));
        return new Response(JSON.stringify({
          success: true,
          data: {
            html: "<main><h1>Firecrawl &amp; Page</h1><script>NOPE</script><p>Readable scrape text.</p></main>",
            metadata: { statusCode: 200 }
          }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    const result = await runner.run("web-fetch https://example.com/page 200");

    assert.equal(result.ok, true);
    assert.deepEqual(requested, ["https://api.firecrawl.dev/v2/scrape"]);
    assert.deepEqual(seenAuth, ["Bearer firecrawl-smoke-token"]);
    assert.deepEqual(seenBodies.map((body) => JSON.parse(body)), [{
      url: "https://example.com/page",
      formats: ["html"],
      onlyMainContent: true,
      removeBase64Images: true,
      blockAds: true,
      timeout: 3000
    }]);
    assert.match(result.output, /url: https:\/\/example\.com\/page/);
    assert.match(result.output, /content-type: text\/html/);
    assert.match(result.output, /Firecrawl & Page/);
    assert.match(result.output, /Readable scrape text/);
    assert.doesNotMatch(result.output, /NOPE/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner web-fetch blocks internal hosts, private DNS results, and unsafe redirects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-web-fetch-ssrf-"));
  try {
    const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
    const privateLookup = async () => [{ address: "127.0.0.1", family: 4 }];
    const okFetch = async () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });

    const localhost = await new ToolRunner(testToolsConfig(dir), { lookupImpl: publicLookup, fetchImpl: okFetch }).run("web-fetch http://localhost:8080");
    assert.equal(localhost.ok, false);
    assert.match(localhost.output, /private|internal/i);

    const privateDns = await new ToolRunner(testToolsConfig(dir), { lookupImpl: privateLookup, fetchImpl: okFetch }).run("web-fetch https://intranet.example.com");
    assert.equal(privateDns.ok, false);
    assert.match(privateDns.output, /private|internal/i);

    const redirect = await new ToolRunner(testToolsConfig(dir), {
      lookupImpl: publicLookup,
      fetchImpl: async () => new Response("", {
        status: 302,
        headers: { "location": "http://127.0.0.1/admin" }
      })
    }).run("web-fetch https://example.com/start");
    assert.equal(redirect.ok, false);
    assert.match(redirect.output, /private|internal/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner web-search parses key-free HTML results without JavaScript execution", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-web-search-"));
  try {
    const requested: string[] = [];
    const runner = new ToolRunner(testToolsConfig(dir), {
      fetchImpl: async (input) => {
        requested.push(String(input));
        return new Response(`
          <html><body>
            <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Example &amp; Docs</a>
            <a class="result__snippet">Readable result <script>NOPE</script> snippet</a>
            <a class="result__a" href="http://127.0.0.1/private">Private result</a>
          </body></html>
        `, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    });

    const result = await runner.run("web-search openclaw 5");

    assert.equal(result.ok, true);
    assert.deepEqual(requested, ["https://duckduckgo.com/html/?q=openclaw"]);
    assert.match(result.output, /provider: duckduckgo-html/);
    assert.match(result.output, /Example & Docs/);
    assert.match(result.output, /https:\/\/example\.com\/docs/);
    assert.match(result.output, /Readable result/);
    assert.doesNotMatch(result.output, /NOPE/);
    assert.doesNotMatch(result.output, /127\.0\.0\.1/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner web-search can use a configured SearXNG HTML provider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-web-search-searxng-"));
  try {
    const requested: string[] = [];
    const config = testToolsConfig(dir);
    config.webSearch = {
      ...config.webSearch,
      provider: "searxng-html",
      searxngBaseUrl: "https://searxng.example.com"
    };
    const runner = new ToolRunner(config, {
      fetchImpl: async (input) => {
        requested.push(String(input));
        return new Response(`
          <html><body>
            <article class="result result-default">
              <h3><a href="https://example.org/searx-result">SearXNG &amp; Result</a></h3>
              <p class="content">SearXNG readable <script>NOPE</script> snippet</p>
            </article>
            <article class="result result-default">
              <h3><a href="/search?q=internal">Provider navigation</a></h3>
            </article>
          </body></html>
        `, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
      }
    });

    const result = await runner.run("web-search parity 4");

    assert.equal(result.ok, true);
    assert.deepEqual(requested, ["https://searxng.example.com/search?q=parity&format=html"]);
    assert.match(result.output, /provider: searxng-html/);
    assert.match(result.output, /SearXNG & Result/);
    assert.match(result.output, /https:\/\/example\.org\/searx-result/);
    assert.match(result.output, /SearXNG readable/);
    assert.doesNotMatch(result.output, /NOPE/);
    assert.doesNotMatch(result.output, /Provider navigation/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner web-search can use a configured Brave Search API provider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-web-search-brave-"));
  try {
    const requested: string[] = [];
    const seenTokens: string[] = [];
    const config = testToolsConfig(dir);
    config.webSearch = {
      ...config.webSearch,
      provider: "brave-api",
      braveApiKey: "brave-smoke-token"
    };
    const runner = new ToolRunner(config, {
      fetchImpl: async (input, init) => {
        requested.push(String(input));
        seenTokens.push(new Headers(init?.headers).get("x-subscription-token") ?? "");
        return new Response(JSON.stringify({
          web: {
            results: [
              {
                title: "Brave &amp; Result",
                url: "https://example.net/brave-result",
                description: "Brave readable <script>NOPE</script> snippet"
              },
              {
                title: "Private result",
                url: "http://127.0.0.1/private",
                description: "SHOULD_NOT_APPEAR"
              }
            ]
          }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    const result = await runner.run("web-search parity 4");

    assert.equal(result.ok, true);
    assert.deepEqual(requested, ["https://api.search.brave.com/res/v1/web/search?q=parity&count=4"]);
    assert.deepEqual(seenTokens, ["brave-smoke-token"]);
    assert.match(result.output, /provider: brave-api/);
    assert.match(result.output, /Brave & Result/);
    assert.match(result.output, /https:\/\/example\.net\/brave-result/);
    assert.match(result.output, /Brave readable/);
    assert.doesNotMatch(result.output, /NOPE/);
    assert.doesNotMatch(result.output, /127\.0\.0\.1/);
    assert.doesNotMatch(result.output, /SHOULD_NOT_APPEAR/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner web-search can use a configured Tavily Search API provider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-web-search-tavily-"));
  try {
    const requested: string[] = [];
    const seenAuth: string[] = [];
    const seenBodies: string[] = [];
    const config = testToolsConfig(dir);
    config.webSearch = {
      ...config.webSearch,
      provider: "tavily-api",
      tavilyApiKey: "tavily-smoke-token"
    };
    const runner = new ToolRunner(config, {
      fetchImpl: async (input, init) => {
        requested.push(String(input));
        seenAuth.push(new Headers(init?.headers).get("authorization") ?? "");
        seenBodies.push(String(init?.body ?? ""));
        return new Response(JSON.stringify({
          results: [
            {
              title: "Tavily &amp; Result",
              url: "https://example.net/tavily-result",
              content: "Tavily readable <script>NOPE</script> snippet"
            },
            {
              title: "Private result",
              url: "http://127.0.0.1/private",
              content: "SHOULD_NOT_APPEAR"
            }
          ]
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    const result = await runner.run("web-search parity 4");

    assert.equal(result.ok, true);
    assert.deepEqual(requested, ["https://api.tavily.com/search"]);
    assert.deepEqual(seenAuth, ["Bearer tavily-smoke-token"]);
    assert.deepEqual(seenBodies.map((body) => JSON.parse(body)), [{
      query: "parity",
      max_results: 4,
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false
    }]);
    assert.match(result.output, /provider: tavily-api/);
    assert.match(result.output, /Tavily & Result/);
    assert.match(result.output, /https:\/\/example\.net\/tavily-result/);
    assert.match(result.output, /Tavily readable/);
    assert.doesNotMatch(result.output, /NOPE/);
    assert.doesNotMatch(result.output, /127\.0\.0\.1/);
    assert.doesNotMatch(result.output, /SHOULD_NOT_APPEAR/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner web-search can use a configured Perplexity Search API provider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-web-search-perplexity-"));
  try {
    const requested: string[] = [];
    const seenAuth: string[] = [];
    const seenBodies: string[] = [];
    const config = testToolsConfig(dir);
    config.webSearch = {
      ...config.webSearch,
      provider: "perplexity-api",
      perplexityApiKey: "perplexity-smoke-token"
    };
    const runner = new ToolRunner(config, {
      fetchImpl: async (input, init) => {
        requested.push(String(input));
        seenAuth.push(new Headers(init?.headers).get("authorization") ?? "");
        seenBodies.push(String(init?.body ?? ""));
        return new Response(JSON.stringify({
          results: [
            {
              title: "Perplexity &amp; Result",
              url: "https://example.net/perplexity-result",
              snippet: "Perplexity readable <script>NOPE</script> snippet"
            },
            {
              title: "Private result",
              url: "http://127.0.0.1/private",
              snippet: "SHOULD_NOT_APPEAR"
            }
          ]
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    const result = await runner.run("web-search parity 4");

    assert.equal(result.ok, true);
    assert.deepEqual(requested, ["https://api.perplexity.ai/search"]);
    assert.deepEqual(seenAuth, ["Bearer perplexity-smoke-token"]);
    assert.deepEqual(seenBodies.map((body) => JSON.parse(body)), [{
      query: "parity",
      max_results: 4,
      max_tokens: 5000,
      max_tokens_per_page: 1024
    }]);
    assert.match(result.output, /provider: perplexity-api/);
    assert.match(result.output, /Perplexity & Result/);
    assert.match(result.output, /https:\/\/example\.net\/perplexity-result/);
    assert.match(result.output, /Perplexity readable/);
    assert.doesNotMatch(result.output, /NOPE/);
    assert.doesNotMatch(result.output, /127\.0\.0\.1/);
    assert.doesNotMatch(result.output, /SHOULD_NOT_APPEAR/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner web-search can use a configured Exa Search API provider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-web-search-exa-"));
  try {
    const requested: string[] = [];
    const seenTokens: string[] = [];
    const seenBodies: string[] = [];
    const config = testToolsConfig(dir);
    config.webSearch = {
      ...config.webSearch,
      provider: "exa-api",
      exaApiKey: "exa-smoke-token"
    };
    const runner = new ToolRunner(config, {
      fetchImpl: async (input, init) => {
        requested.push(String(input));
        seenTokens.push(new Headers(init?.headers).get("x-api-key") ?? "");
        seenBodies.push(String(init?.body ?? ""));
        return new Response(JSON.stringify({
          results: [
            {
              title: "Exa &amp; Result",
              url: "https://example.net/exa-result",
              highlights: ["Exa readable <script>NOPE</script> snippet"]
            },
            {
              title: "Private result",
              url: "http://127.0.0.1/private",
              highlights: ["SHOULD_NOT_APPEAR"]
            }
          ]
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    const result = await runner.run("web-search parity 4");

    assert.equal(result.ok, true);
    assert.deepEqual(requested, ["https://api.exa.ai/search"]);
    assert.deepEqual(seenTokens, ["exa-smoke-token"]);
    assert.deepEqual(seenBodies.map((body) => JSON.parse(body)), [{
      query: "parity",
      numResults: 4,
      contents: { highlights: true }
    }]);
    assert.match(result.output, /provider: exa-api/);
    assert.match(result.output, /Exa & Result/);
    assert.match(result.output, /https:\/\/example\.net\/exa-result/);
    assert.match(result.output, /Exa readable/);
    assert.doesNotMatch(result.output, /NOPE/);
    assert.doesNotMatch(result.output, /127\.0\.0\.1/);
    assert.doesNotMatch(result.output, /SHOULD_NOT_APPEAR/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner web-search can use a configured Firecrawl Search API provider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-web-search-firecrawl-"));
  try {
    const requested: string[] = [];
    const seenAuth: string[] = [];
    const seenBodies: string[] = [];
    const config = testToolsConfig(dir);
    config.webSearch = {
      ...config.webSearch,
      provider: "firecrawl-api",
      firecrawlApiKey: "firecrawl-smoke-token"
    };
    const runner = new ToolRunner(config, {
      fetchImpl: async (input, init) => {
        requested.push(String(input));
        seenAuth.push(new Headers(init?.headers).get("authorization") ?? "");
        seenBodies.push(String(init?.body ?? ""));
        return new Response(JSON.stringify({
          success: true,
          data: {
            web: [
              {
                title: "Firecrawl &amp; Result",
                url: "https://example.net/firecrawl-result",
                description: "Firecrawl readable <script>NOPE</script> snippet"
              },
              {
                title: "Private result",
                url: "http://127.0.0.1/private",
                description: "SHOULD_NOT_APPEAR"
              }
            ]
          }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    const result = await runner.run("web-search parity 4");

    assert.equal(result.ok, true);
    assert.deepEqual(requested, ["https://api.firecrawl.dev/v2/search"]);
    assert.deepEqual(seenAuth, ["Bearer firecrawl-smoke-token"]);
    assert.deepEqual(seenBodies.map((body) => JSON.parse(body)), [{
      query: "parity",
      limit: 4,
      sources: ["web"],
      ignoreInvalidURLs: true
    }]);
    assert.match(result.output, /provider: firecrawl-api/);
    assert.match(result.output, /Firecrawl & Result/);
    assert.match(result.output, /https:\/\/example\.net\/firecrawl-result/);
    assert.match(result.output, /Firecrawl readable/);
    assert.doesNotMatch(result.output, /NOPE/);
    assert.doesNotMatch(result.output, /127\.0\.0\.1/);
    assert.doesNotMatch(result.output, /SHOULD_NOT_APPEAR/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner web-search can use a configured local Ollama Web Search provider without leaking hosted API keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-web-search-ollama-"));
  try {
    const requested: string[] = [];
    const seenAuth: string[] = [];
    const seenBodies: string[] = [];
    const config = testToolsConfig(dir);
    config.webSearch = {
      ...config.webSearch,
      provider: "ollama-api",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaApiKey: "hosted-ollama-token"
    };
    const runner = new ToolRunner(config, {
      fetchImpl: async (input, init) => {
        requested.push(String(input));
        seenAuth.push(new Headers(init?.headers).get("authorization") ?? "");
        seenBodies.push(String(init?.body ?? ""));
        return new Response(JSON.stringify({
          results: [
            {
              title: "Ollama &amp; Result",
              url: "https://example.net/ollama-result",
              content: "Ollama readable <script>NOPE</script> snippet"
            },
            {
              title: "Private result",
              url: "http://127.0.0.1/private",
              content: "SHOULD_NOT_APPEAR"
            }
          ]
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    const result = await runner.run("web-search parity 4");

    assert.equal(result.ok, true);
    assert.deepEqual(requested, ["http://127.0.0.1:11434/api/experimental/web_search"]);
    assert.deepEqual(seenAuth, [""]);
    assert.deepEqual(seenBodies.map((body) => JSON.parse(body)), [{
      query: "parity",
      max_results: 4
    }]);
    assert.match(result.output, /provider: ollama-api/);
    assert.match(result.output, /Ollama & Result/);
    assert.match(result.output, /https:\/\/example\.net\/ollama-result/);
    assert.match(result.output, /Ollama readable/);
    assert.doesNotMatch(result.output, /NOPE/);
    assert.doesNotMatch(result.output, /127\.0\.0\.1\/private/);
    assert.doesNotMatch(result.output, /SHOULD_NOT_APPEAR/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner web-search can use hosted Ollama Web Search with a bearer API key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-web-search-ollama-hosted-"));
  try {
    const requested: string[] = [];
    const seenAuth: string[] = [];
    const seenBodies: string[] = [];
    const config = testToolsConfig(dir);
    config.webSearch = {
      ...config.webSearch,
      provider: "ollama-api",
      ollamaBaseUrl: "https://ollama.com",
      ollamaApiKey: "hosted-ollama-token"
    };
    const runner = new ToolRunner(config, {
      fetchImpl: async (input, init) => {
        requested.push(String(input));
        seenAuth.push(new Headers(init?.headers).get("authorization") ?? "");
        seenBodies.push(String(init?.body ?? ""));
        return new Response(JSON.stringify({
          results: [
            {
              title: "Hosted Ollama",
              url: "https://example.net/hosted-ollama-result",
              content: "hosted ollama readable snippet"
            }
          ]
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    const result = await runner.run("web-search parity 15");

    assert.equal(result.ok, true);
    assert.deepEqual(requested, ["https://ollama.com/api/web_search"]);
    assert.deepEqual(seenAuth, ["Bearer hosted-ollama-token"]);
    assert.deepEqual(seenBodies.map((body) => JSON.parse(body)), [{
      query: "parity",
      max_results: 5
    }]);
    assert.match(result.output, /provider: ollama-api/);
    assert.match(result.output, /Hosted Ollama/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner search-files finds literal text without scanning private or symlinked trees", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-search-"));
  const outsideDir = await mkdtemp(join(tmpdir(), "viser-tools-search-outside-"));
  try {
    await mkdir(join(dir, "src"), { recursive: true });
    await mkdir(join(dir, ".viser"), { recursive: true });
    await writeFile(join(dir, "src", "note.txt"), "alpha\nNeedle line\nomega", "utf8");
    await writeFile(join(dir, ".viser", "secret.txt"), "Needle should stay private", "utf8");
    await writeFile(join(outsideDir, "linked.txt"), "Needle through symlink", "utf8");
    await symlink(outsideDir, join(dir, "src", "outside-link"));

    const result = await new ToolRunner(testToolsConfig(dir)).run("search-files Needle . 10");

    assert.equal(result.ok, true);
    assert.match(result.output, /src\/note\.txt:2: Needle line/);
    assert.doesNotMatch(result.output, /secret/);
    assert.doesNotMatch(result.output, /linked/);
    assert.match(result.output, /skipped:/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  }
});

test("ToolRunner read-file and list-dir refuse symlinked tool paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-nofollow-"));
  try {
    const targetDir = join(dir, "target");
    await mkdir(targetDir);
    await writeFile(join(targetDir, "note.txt"), "inside-but-symlinked", "utf8");
    await symlink(join(targetDir, "note.txt"), join(dir, "note-link.txt"));
    await symlink(targetDir, join(dir, "dir-link"));

    const runner = new ToolRunner(testToolsConfig(dir));
    const read = await runner.run("read-file note-link.txt");
    const list = await runner.run("list-dir dir-link");

    assert.equal(read.ok, false);
    assert.match(read.output, /symlink/i);
    assert.doesNotMatch(read.output, /inside-but-symlinked/);
    assert.equal(list.ok, false);
    assert.match(list.output, /symlink/i);
    assert.doesNotMatch(list.output, /note\.txt/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner refuses allowed read roots reached through symlinked parents", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".viser-tools-root-nofollow-"));
  try {
    const outsideRoot = join(dir, "outside-root");
    const outsideAllowed = join(outsideRoot, "allowed");
    const rootLink = join(dir, "root-link");
    await mkdir(outsideAllowed, { recursive: true });
    await writeFile(join(outsideAllowed, "note.txt"), "outside-through-root-link", "utf8");
    await symlink(outsideRoot, rootLink);

    const runner = new ToolRunner(testToolsConfig(join(rootLink, "allowed")));
    const read = await runner.run("read-file note.txt");
    const list = await runner.run("list-dir .");
    const shell = await runner.run("shell pwd");

    for (const result of [read, list, shell]) {
      assert.equal(result.ok, false);
      assert.match(result.output, /symlink/i);
      assert.doesNotMatch(result.output, /outside-through-root-link/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function testToolsConfig(dir: string): ToolsConfig {
  return {
    enabled: true,
    allowedReadRoots: [dir],
    maxReadBytes: 1000,
    shell: {
      enabled: true,
      allowedCommands: ["pwd", "ls", "cat", "git"],
      timeoutMs: 3000
    },
    webFetch: {
      enabled: true,
      provider: "direct-http",
      extractMode: "text",
      firecrawlApiKeyEnv: "FIRECRAWL_API_KEY",
      maxResponseBytes: 2000,
      timeoutMs: 3000,
      maxRedirects: 3,
      cacheTtlMs: 900000,
      userAgent: "Viser test"
    },
    webSearch: {
      enabled: true,
      provider: "duckduckgo-html",
      braveApiKeyEnv: "BRAVE_SEARCH_API_KEY",
      tavilyApiKeyEnv: "TAVILY_API_KEY",
      perplexityApiKeyEnv: "PERPLEXITY_API_KEY",
      exaApiKeyEnv: "EXA_API_KEY",
      firecrawlApiKeyEnv: "FIRECRAWL_API_KEY",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaApiKeyEnv: "OLLAMA_API_KEY",
      maxResults: 5,
      maxResponseBytes: 2000,
      timeoutMs: 3000,
      userAgent: "Viser test"
    }
  };
}

test("ToolRunner blocks shell paths outside the allowed root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-paths-"));
  try {
    const runner = new ToolRunner(testToolsConfig(dir));
    const absolute = await runner.run("shell cat /etc/passwd");
    assert.equal(absolute.ok, false);
    assert.match(absolute.output, /Absolute paths/);

    const traversal = await runner.run("shell cat ../secret.txt");
    assert.equal(traversal.ok, false);
    assert.match(traversal.output, /Path traversal/);

    const gitRedirect = await runner.run("shell git -C /tmp status");
    assert.equal(gitRedirect.ok, false);
    assert.match(gitRedirect.output, /redirection/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner blocks shell symlinks that resolve outside the allowed root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-symlink-"));
  try {
    const allowed = join(dir, "allowed");
    await mkdir(allowed);
    await writeFile(join(dir, "outside-secret.txt"), "outside-secret", "utf8");
    await symlink(join(dir, "outside-secret.txt"), join(allowed, "link.txt"));

    const runner = new ToolRunner(testToolsConfig(allowed));
    const result = await runner.run("shell cat link.txt");

    assert.equal(result.ok, false);
    assert.match(result.output, /outside allowed read roots/);
    assert.doesNotMatch(result.output, /outside-secret/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner blocks shell symlink paths even when they resolve inside the allowed root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-shell-nofollow-"));
  try {
    const targetPath = join(dir, "target.txt");
    const linkPath = join(dir, "target-link.txt");
    await writeFile(targetPath, "inside-through-symlink", "utf8");
    await symlink(targetPath, linkPath);

    const runner = new ToolRunner(testToolsConfig(dir));
    const result = await runner.run("shell cat target-link.txt");

    assert.equal(result.ok, false);
    assert.match(result.output, /symlink/i);
    assert.doesNotMatch(result.output, /inside-through-symlink/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readToolFileNoFollow refuses symlinked files even if called directly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-read-nofollow-"));
  try {
    const outside = join(dir, "outside-secret.txt");
    const link = join(dir, "link.txt");
    await writeFile(outside, "outside-secret", "utf8");
    await symlink(outside, link);

    const raw = await readToolFileNoFollow(link);

    assert.equal(raw, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner blocks shell symlink-following recursive options", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-follow-flags-"));
  try {
    const runner = new ToolRunner({
      ...testToolsConfig(dir),
      shell: {
        ...testToolsConfig(dir).shell,
        allowedCommands: ["find", "grep", "rg", "ls"]
      }
    });

    for (const command of ["shell find -L .", "shell grep -R needle .", "shell grep --dereference-recursive needle .", "shell rg -L needle .", "shell ls -L ."]) {
      const result = await runner.run(command);
      assert.equal(result.ok, false, command);
      assert.match(result.output, /Symlink|symlink/, command);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner blocks shell options that can write or execute helpers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-option-safety-"));
  try {
    const runner = new ToolRunner({
      ...testToolsConfig(dir),
      shell: {
        ...testToolsConfig(dir).shell,
        allowedCommands: ["git", "find", "rg"]
      }
    });

    const gitOutput = await runner.run("shell git diff --output=diff.txt");
    assert.equal(gitOutput.ok, false);
    assert.match(gitOutput.output, /redirection/);

    const findOutput = await runner.run("shell find . -fprint out.txt");
    assert.equal(findOutput.ok, false);
    assert.match(findOutput.output, /Mutating find/);

    const rgOutput = await runner.run("shell rg --pre cat needle .");
    assert.equal(rgOutput.ok, false);
    assert.match(rgOutput.output, /preprocessor/);

    const gitExtDiff = await runner.run("shell git diff --ext-diff");
    assert.equal(gitExtDiff.ok, false);
    assert.match(gitExtDiff.output, /external diff/);

    const gitTextconv = await runner.run("shell git show --textconv HEAD");
    assert.equal(gitTextconv.ok, false);
    assert.match(gitTextconv.output, /textconv/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner hardens git diff rendering against env and repo-config command hooks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-git-hardening-"));
  const previousExternalDiff = process.env.GIT_EXTERNAL_DIFF;
  try {
    runGit(dir, "init");
    runGit(dir, "config", "user.email", "test@example.com");
    runGit(dir, "config", "user.name", "Test");
    runGit(dir, "config", "diff.evil.textconv", `sh -c 'touch ${join(dir, "pwned-textconv")}; cat "$1"' sh`);
    await writeFile(join(dir, ".gitattributes"), "*.bin diff=evil\n", "utf8");
    await writeFile(join(dir, "sample.bin"), "one\n", "utf8");
    runGit(dir, "add", ".");
    runGit(dir, "commit", "-m", "init");
    await writeFile(join(dir, "sample.bin"), "two\n", "utf8");
    process.env.GIT_EXTERNAL_DIFF = `sh -c 'touch ${join(dir, "pwned-env")}'`;

    const runner = new ToolRunner({
      ...testToolsConfig(dir),
      shell: {
        ...testToolsConfig(dir).shell,
        allowedCommands: ["git"]
      }
    });

    const result = await runner.run("shell git diff");

    assert.equal(result.ok, true);
    assert.equal(existsSync(join(dir, "pwned-env")), false);
    assert.equal(existsSync(join(dir, "pwned-textconv")), false);
  } finally {
    if (previousExternalDiff === undefined) delete process.env.GIT_EXTERNAL_DIFF;
    else process.env.GIT_EXTERNAL_DIFF = previousExternalDiff;
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner shell does not inherit secret env values", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-shell-env-strip-"));
  const oldToken = process.env.VISER_TOOL_SECRET_TOKEN;
  const oldApiKey = process.env.SHELL_TOOL_API_KEY;
  try {
    process.env.VISER_TOOL_SECRET_TOKEN = "tool-secret-token-1234567890";
    process.env.SHELL_TOOL_API_KEY = "tool-api-key-1234567890";
    const runner = new ToolRunner({
      ...testToolsConfig(dir),
      shell: {
        ...testToolsConfig(dir).shell,
        allowedCommands: ["node"]
      }
    });

    const result = await runner.run("shell node -e \"process.stdout.write(JSON.stringify([process.env.SHELL_TOOL_API_KEY,process.env.VISER_TOOL_SECRET_TOKEN]))\"");

    assert.equal(result.ok, true);
    assert.equal(result.output, "[null,null]");
  } finally {
    if (oldToken === undefined) delete process.env.VISER_TOOL_SECRET_TOKEN;
    else process.env.VISER_TOOL_SECRET_TOKEN = oldToken;
    if (oldApiKey === undefined) delete process.env.SHELL_TOOL_API_KEY;
    else process.env.SHELL_TOOL_API_KEY = oldApiKey;
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner shell resolves PATH commands before running", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-shell-path-command-"));
  const oldPath = process.env.PATH;
  try {
    const binDir = join(dir, "bin");
    const commandPath = join(binDir, "tool-ok");
    await mkdir(binDir, { recursive: true });
    await writeFile(commandPath, "#!/bin/sh\nprintf 'TOOL_OK\\n'\n", "utf8");
    await chmod(commandPath, 0o700);
    process.env.PATH = binDir;
    const runner = new ToolRunner({
      ...testToolsConfig(dir),
      shell: {
        ...testToolsConfig(dir).shell,
        allowedCommands: ["tool-ok"]
      }
    });

    const result = await runner.run("shell tool-ok");

    assert.equal(result.ok, true);
    assert.equal(result.output, "TOOL_OK");
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner shell refuses PATH commands reached through workspace symlink components", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".viser-tools-shell-command-nofollow-"));
  const oldPath = process.env.PATH;
  try {
    const outsideRoot = join(dir, "outside-root");
    const outsideBin = join(outsideRoot, "bin");
    const outsideTouched = join(outsideRoot, "touched.txt");
    const commandPath = join(outsideBin, "tool-ok");
    const rootLink = join(dir, "root-link");
    await mkdir(outsideBin, { recursive: true });
    await writeFile(commandPath, `#!/bin/sh\nprintf ran > ${JSON.stringify(outsideTouched)}\nprintf 'TOOL_OK\\n'\n`, "utf8");
    await chmod(commandPath, 0o700);
    await symlink(outsideRoot, rootLink);
    process.env.PATH = join(rootLink, "bin");
    const runner = new ToolRunner({
      ...testToolsConfig(dir),
      shell: {
        ...testToolsConfig(dir).shell,
        allowedCommands: ["tool-ok"]
      }
    });

    const result = await runner.run("shell tool-ok");

    assert.equal(result.ok, false);
    assert.match(result.output, /symlink/i);
    assert.equal(existsSync(outsideTouched), false);
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner blocks sed file read, write, and script-file escape commands", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-sed-safety-"));
  try {
    await writeFile(join(dir, "note.txt"), "hello\n", "utf8");
    await writeFile(join(dir, "script.sed"), "1r/etc/passwd\n", "utf8");
    const runner = new ToolRunner({
      ...testToolsConfig(dir),
      shell: {
        ...testToolsConfig(dir).shell,
        allowedCommands: ["sed"]
      }
    });

    const safe = await runner.run("shell sed s/hello/HELLO/ note.txt");
    assert.equal(safe.ok, true);
    assert.match(safe.output, /HELLO/);

    for (const command of [
      "shell sed 1r/etc/passwd note.txt",
      "shell sed 1wout.txt note.txt",
      "shell sed s/hello/HELLO/wout2.txt note.txt",
      "shell sed -f script.sed note.txt"
    ]) {
      const result = await runner.run(command);
      assert.equal(result.ok, false, command);
      assert.match(result.output, /Sed/, command);
    }

    assert.equal(existsSync(join(dir, "out.txt")), false);
    assert.equal(existsSync(join(dir, "out2.txt")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner caps shell command output using maxReadBytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-output-cap-"));
  try {
    await writeFile(join(dir, "big.txt"), "abcdefghijklmnop", "utf8");
    const runner = new ToolRunner({
      ...testToolsConfig(dir),
      maxReadBytes: 5
    });

    const result = await runner.run("shell cat big.txt");

    assert.equal(result.ok, true);
    assert.match(result.output, /^abcde/);
    assert.match(result.output, /stdout truncated at 5 bytes/);
    assert.doesNotMatch(result.output, /fgh/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ToolRunner returns failed results for filesystem and spawn errors instead of throwing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tools-errors-"));
  try {
    const runner = new ToolRunner({
      ...testToolsConfig(dir),
      shell: {
        ...testToolsConfig(dir).shell,
        allowedCommands: ["missing-viser-test-command"]
      }
    });

    const missingFile = await runner.run("read-file missing.txt");
    assert.equal(missingFile.ok, false);
    assert.equal(missingFile.title, "tool error");
    assert.match(missingFile.output, /not found/i);

    const missingDir = await runner.run("list-dir missing-dir");
    assert.equal(missingDir.ok, false);
    assert.equal(missingDir.title, "tool error");
    assert.match(missingDir.output, /not found/i);

    const missingCommand = await runner.run("shell missing-viser-test-command");
    assert.equal(missingCommand.ok, false);
    assert.equal(missingCommand.title, "tool error");
    assert.match(missingCommand.output, /not found/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function runGit(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
}
