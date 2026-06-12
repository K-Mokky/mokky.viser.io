# Privacy Policy

Viser is a local-first personal assistant runtime by **KMokky**. Public project
artifacts should identify the project as `Viser` and credit `KMokky` as creator,
but should not include the maintainer's personal accounts, local machine paths,
private conversations, messenger identifiers, tokens, or runtime state.

## What Viser stores locally

Depending on enabled features, Viser can store local runtime data under private
workspace directories such as `.viser/`:

- session history and compacted transcripts;
- explicit personalization/global settings, long-term memory entries, and deterministic profile summaries;
- queued jobs, schedules, access pairing records, action proposals, and backups;
- service logs and local dashboard state.

Local `/chat.html` WebChat prompts and explicitly enabled generic inbound
webhook payload text plus bounded attachment metadata/text excerpts are treated
like CLI/chat prompts: they can be sent to the configured logged-in local
provider CLI and stored in the local session history. Viser does not download or
persist inbound webhook attachment files; any supplied attachment URL/text is
operator-provided prompt context. Dashboard status, canvas, voice capture, and
media capture routes remain provider-free unless the operator explicitly uses
WebChat or the inbound webhook route.

Explicit `/tool web-fetch` and MCP `viser_web_fetch` results are read-only
remote page excerpts, but when run through Viser they may appear in the local
session transcript like other tool output. Web fetch does not execute page
JavaScript and does not store a separate web cache.

These files are for the local operator only. They are excluded from npm/GitHub
release artifacts and should not be pasted into public issues.

## Secrets and identifiers

Keep these values out of public files, screenshots, logs, examples, and bug
reports:

- `.env` contents and shell environment dumps;
- `TELEGRAM_BOT_TOKEN`, `DISCORD_BOT_TOKEN`, `SLACK_BOT_TOKEN`,
  `MATRIX_ACCESS_TOKEN`, `SIGNAL_CLI_ACCOUNT`, `WHATSAPP_ACCESS_TOKEN`,
  `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `KAKAOTALK_SKILL_TOKEN`, `GOOGLE_CHAT_WEBHOOK_URL`, `GOOGLE_CHAT_WEBHOOKS`, `VISER_WEBHOOK_URL`, `VISER_WEBHOOKS`, `VISER_WEBHOOK_INBOUND_TOKEN`, `VISER_WEBHOOK_INBOUND_SIGNATURE_SECRET`, `HOME_ASSISTANT_BASE_URL`, `HOME_ASSISTANT_ACCESS_TOKEN`, `HOME_ASSISTANT_SERVICE`, `HOME_ASSISTANT_SERVICES`, `TEAMS_WEBHOOK_URL`, `TEAMS_WEBHOOKS`, `MATTERMOST_WEBHOOK_URL`, `MATTERMOST_WEBHOOKS`, `ROCKET_CHAT_WEBHOOK_URL`, `ROCKET_CHAT_WEBHOOKS`, `FEISHU_WEBHOOK_URL`, `FEISHU_WEBHOOKS`, `DINGTALK_WEBHOOK_URL`, `DINGTALK_WEBHOOKS`, `WECOM_WEBHOOK_URL`, `WECOM_WEBHOOKS`, `ZALO_OA_ACCESS_TOKEN`, `ZALO_RECIPIENT_ID`, `ZALO_RECIPIENTS`, `IRC_HOST`, `IRC_PORT`, `IRC_TLS`, `IRC_NICK`, `IRC_PASSWORD`, `IRC_CHANNEL`, `IRC_CHANNELS`, `TWITCH_ACCESS_TOKEN`, `TWITCH_BOT_USERNAME`, `TWITCH_CHANNEL`, `TWITCH_CHANNELS`, `NTFY_BASE_URL`, `NTFY_TOKEN`, `NTFY_TOPIC`, `NTFY_TOPICS`, `MASTODON_BASE_URL`, `MASTODON_ACCESS_TOKEN`, `MASTODON_VISIBILITY`, `MASTODON_TARGETS`, `NEXTCLOUD_TALK_BASE_URL`, `NEXTCLOUD_TALK_USERNAME`, `NEXTCLOUD_TALK_APP_PASSWORD`, `NEXTCLOUD_TALK_ROOM_TOKEN`, `NEXTCLOUD_TALK_ROOMS`, `WEBEX_ACCESS_TOKEN`, `ZULIP_SITE_URL`, `ZULIP_BOT_EMAIL`, `ZULIP_API_KEY`, `ZULIP_TARGET`, `ZULIP_TARGETS`, `EMAIL_FROM`, `EMAIL_RECIPIENT`, `EMAIL_RECIPIENTS`, `GITHUB_TOKEN`, `GITHUB_ISSUE_TARGET`, `GITHUB_ISSUE_TARGETS`, `TODOIST_API_TOKEN`, `TODOIST_PROJECT_ID`, `TODOIST_PROJECTS`, `NOTION_TOKEN`, `NOTION_PAGE_ID`, `NOTION_PAGES`, `OBSIDIAN_VAULT_DIR`, `OBSIDIAN_NOTE`, `OBSIDIAN_NOTES`, provider env, private keys,
  or API keys;
- Telegram chat IDs, Discord channel/user IDs, bot usernames, personal handles, KakaoTalk user IDs, custom webhook URLs/aliases, Home Assistant base URLs/service aliases/payloads, Zalo OA user IDs, IRC host/channel/nick values, Twitch OAuth/channel values, ntfy base URL/token/topic/topic aliases, Mastodon base URL/access token/visibility/target aliases, Nextcloud Talk base URLs/usernames/room tokens/room aliases, Webex room IDs, Email recipient aliases, GitHub owner/repo/issue target aliases, Todoist project aliases/IDs, Notion page aliases/IDs, Obsidian vault paths/note aliases,
  email addresses, and local filesystem paths;
- `.viser/`, `.omx/`, service artifacts, backups, personalization, memory, session, and job state.

Use fake credentials and generic examples such as `/Users/example`,
`demo-user`, `telegram:123`, or `discord:456` when documenting issues.

## Model access privacy

Viser should not require GPT/Gemini/Claude model HTTP API keys. The configured
core model routes are expected to call already logged-in local CLIs (`codex`,
`gemini`, `claude`). Release evidence and audit checks reject model API key env
names in public examples, active env files, and provider env configuration.

## Public release checklist

Before publishing, run:

```bash
npm run audit
node src/index.ts release-evidence
node src/index.ts release-evidence --strict --live --probe-all-providers
npm pack --dry-run
```

The safe-to-paste release evidence redacts local paths and token-like values,
then reports whether public package files exclude private state and whether live
provider/messenger proof is still missing.
