# Security Policy

Viser is a local-first assistant runtime. It is designed to call already logged-in
local AI CLIs (`codex`, `gemini`, `claude`) instead of GPT/Gemini/Claude model
HTTP APIs or model API keys. Please do not file reports or examples that include
real tokens, `.env` contents, private `.viser/` state, `.omx/` runtime state,
session transcripts, personal chat identifiers, or other personal data.

## Supported versions

The current public development line is `0.1.x`. Security fixes should target the
latest `main` branch and the newest published package when applicable.

## Reporting a vulnerability

Use GitHub private vulnerability reporting when available, or contact the
maintainer privately. Include:

- affected command or connector (`chat`, `gateway`, `telegram`, `discord`, MCP,
  jobs, scheduler, actions, provider runtime, etc.);
- exact reproduction steps using fake credentials only;
- expected versus observed impact;
- whether a local provider CLI, messenger token, or approval-gated action was
  involved.

Do **not** paste real `TELEGRAM_BOT_TOKEN`, `DISCORD_BOT_TOKEN`, `SLACK_BOT_TOKEN`,
`MATRIX_ACCESS_TOKEN`, `SIGNAL_CLI_ACCOUNT`, `WHATSAPP_ACCESS_TOKEN`,
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `KAKAOTALK_SKILL_TOKEN`, `BROWSER_USE_API_KEY`, `GOOGLE_CHAT_WEBHOOK_URL`, `GOOGLE_CHAT_WEBHOOKS`, `VISER_WEBHOOK_URL`, `VISER_WEBHOOKS`, `VISER_WEBHOOK_INBOUND_TOKEN`, `VISER_WEBHOOK_INBOUND_SIGNATURE_SECRET`, `HOME_ASSISTANT_BASE_URL`, `HOME_ASSISTANT_ACCESS_TOKEN`, `HOME_ASSISTANT_SERVICE`, `HOME_ASSISTANT_SERVICES`, `TEAMS_WEBHOOK_URL`, `TEAMS_WEBHOOKS`, `MATTERMOST_WEBHOOK_URL`, `MATTERMOST_WEBHOOKS`, `ROCKET_CHAT_WEBHOOK_URL`, `ROCKET_CHAT_WEBHOOKS`, `FEISHU_WEBHOOK_URL`, `FEISHU_WEBHOOKS`, `DINGTALK_WEBHOOK_URL`, `DINGTALK_WEBHOOKS`, `WECOM_WEBHOOK_URL`, `WECOM_WEBHOOKS`, `ZALO_OA_ACCESS_TOKEN`, `ZALO_RECIPIENT_ID`, `ZALO_RECIPIENTS`, `IRC_HOST`, `IRC_PORT`, `IRC_TLS`, `IRC_NICK`, `IRC_PASSWORD`, `IRC_CHANNEL`, `IRC_CHANNELS`, `TWITCH_ACCESS_TOKEN`, `TWITCH_BOT_USERNAME`, `TWITCH_CHANNEL`, `TWITCH_CHANNELS`, `NTFY_BASE_URL`, `NTFY_TOKEN`, `NTFY_TOPIC`, `NTFY_TOPICS`, `MASTODON_BASE_URL`, `MASTODON_ACCESS_TOKEN`, `MASTODON_VISIBILITY`, `MASTODON_TARGETS`, `NEXTCLOUD_TALK_BASE_URL`, `NEXTCLOUD_TALK_USERNAME`, `NEXTCLOUD_TALK_APP_PASSWORD`, `NEXTCLOUD_TALK_ROOM_TOKEN`, `NEXTCLOUD_TALK_ROOMS`, `WEBEX_ACCESS_TOKEN`, `ZULIP_SITE_URL`, `ZULIP_BOT_EMAIL`, `ZULIP_API_KEY`, `ZULIP_TARGET`, `ZULIP_TARGETS`, `GITHUB_TOKEN`, `GITHUB_ISSUE_TARGET`, `GITHUB_ISSUE_TARGETS`, `TODOIST_API_TOKEN`, `TODOIST_PROJECT_ID`, `TODOIST_PROJECTS`, `NOTION_TOKEN`, `NOTION_PAGE_ID`, `NOTION_PAGES`, provider env, model API keys,
private keys, session logs, memory state, or local machine paths.
If a secret was exposed, rotate it before sharing the report.

## Security boundaries

Viser intentionally keeps these boundaries small and auditable:

1. **No model API key path**: core GPT/Codex, Gemini, and Claude routes must use
   exact local CLI command basenames (`codex`, `gemini`, `claude`). Audit and
   strict release evidence fail if model API key env names such as
   `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, or
   `GOOGLE_GENERATIVE_AI_API_KEY` are present in active/public/provider env
   surfaces.
2. **Prompt-injection guard**: untrusted user, personalization, memory, session, skill, and plugin
   content is fenced before provider handoff. High-risk instruction override,
   secret exfiltration, approval bypass, hidden HTML/zero-width/bidi control, and
   base64/base64url/hex/percent/HTML-entity encoded injection patterns are detected before the local CLI provider
   is invoked.
3. **Approval-gated mutation**: file writes, URL/mail/notification/TTS/calendar, browser task,
   clipboard, and outbound messenger actions are staged through `/propose` and
   must be explicitly approved before execution.
4. **Approval-gated browser task boundary**: Browser Use Cloud, Browserbase,
   Firecrawl Interact, and local CDP automation are disabled by default and require
   `actions.browserTask.enabled=true`, public `allowedDomains`, and bounded
   `maxSteps`. Browser Use Cloud additionally requires `BROWSER_USE_API_KEY`
   and sends it only to the configured HTTPS Browser Use API endpoint after
   explicit approval. Browserbase requires `BROWSERBASE_API_KEY`, creates a
   bounded remote session, uses CDP only after approval, and requests session
   release by default. Firecrawl Interact requires `FIRECRAWL_API_KEY`, starts
   from a public-domain scrape session, runs a bounded interact prompt, and
   deletes the interact session by default. Local CDP requires a loopback-only
   `VISER_BROWSER_CDP_URL`/`localCdpBaseUrl` and rejects remote DevTools hosts.
   Providers do not receive hidden browser-control tools, localhost/private
   target domains are rejected, and direct config secrets are audited/redacted.
5. **Read-only file/web tool boundary**: `/tool search-files` and MCP
   `viser_search_files` perform bounded literal text search under configured
   read roots, skip symlinks plus private/heavy entries such as `.env*`,
   `.npmrc`, `.viser`, `.omx`, `.git`, and `node_modules`, and cap searched
   files, bytes, and match output. `/tool web-search` and MCP
   `viser_web_search` call only the configured DuckDuckGo HTML, SearXNG HTML, Brave Search API, Tavily Search API, Perplexity Search API,
   Exa Search API, Firecrawl Search API, or Ollama Web Search API provider, do not execute JavaScript, cap response bytes and result count, and
   filter result URLs with credentials or localhost/private/internal hosts.
   `/tool web-fetch` and MCP `viser_web_fetch` perform bounded direct HTTP(S)
   GET or a configured Firecrawl Scrape API call only after the same public URL
   safety checks, do not execute JavaScript locally, block URL credentials,
   localhost/internal hostnames, private/link-local/loopback/reserved IPs,
   private DNS results, and unsafe direct-provider redirects, cap response bytes
   before text/markdown extraction, and keep any repeated-fetch cache short-lived
   and in-memory only.
6. **Connector access control**: Telegram/Discord/Slack/Matrix/Signal/iMessage/WhatsApp/LINE/KakaoTalk inbound or reply bridges and outbound-only Google Chat/generic Webhook/Home Assistant/Teams/Mattermost/Synology Chat/Rocket.Chat/Feishu/DingTalk/WeCom/Zalo/IRC/Twitch/ntfy/Mastodon/Nextcloud Talk/Webex/Zulip/Email/GitHub/Todoist/Notion/Obsidian senders default to pairing or
   static allowlists, enforce per-peer rate limits where inbound exists, and cap inbound input length
   before provider calls.
7. **Web dashboard execution boundary**: `/dashboard.json`, canvas, voice capture,
   and media capture routes remain provider-free. `/chat.html` can call a
   provider only from localhost with a same-origin `x-viser-web-chat-token`.
   Optional generic inbound webhook callbacks can call a provider only when
   explicitly enabled and protected by `VISER_WEBHOOK_INBOUND_TOKEN`; operators
   can also require `VISER_WEBHOOK_INBOUND_SIGNATURE_SECRET` HMAC headers
   (`x-viser-webhook-timestamp` plus `x-viser-webhook-signature`) to reduce
   replay/token-reuse risk. Inbound attachment handling accepts bounded
   metadata/text only, does not download files, and requires credential-free
   `https://` attachment URLs. Remote dashboard binds should use SSH tunnels or
   equivalent network controls.
8. **Private local state**: `.env`, `.viser/`, `.omx/`, local config, logs,
   backups, and service artifacts are excluded from public package/release
   artifacts and are checked for unsafe permissions or symlinks.
9. **Provider environment minimization**: provider subprocesses do not inherit
   shell secrets by default. Explicit provider env is redacted in output and is
   rejected when it contains model API key names.

## Required checks before public disclosure or release

Run these commands and include the redacted output in the release or fix notes
when relevant:

```bash
npm run build
npm test
npm run typecheck
npm run audit
node src/index.ts verify --strict
node src/index.ts release-evidence
node src/index.ts release-evidence --strict --live --probe-all-providers
npm pack --dry-run
```

`release-evidence --strict --live --probe-all-providers` is expected to fail
until real local CLI login proof and configured messenger credential validation
are available. The report is safe to paste and includes redacted recovery steps
for any missing proof.
