# Privacy Policy

Viser is a local-first personal assistant runtime by **KMokky**. Public project
artifacts should identify the project as `Viser` and credit `KMokky` as creator,
but should not include the maintainer's personal accounts, local machine paths,
private conversations, messenger identifiers, tokens, or runtime state.

## What Viser stores locally

Depending on enabled features, Viser can store local runtime data under private
workspace directories such as `.viser/`:

- session history and compacted transcripts;
- long-term memory entries and deterministic profile summaries;
- queued jobs, schedules, access pairing records, action proposals, and backups;
- service logs and local dashboard state.

These files are for the local operator only. They are excluded from npm/GitHub
release artifacts and should not be pasted into public issues.

## Secrets and identifiers

Keep these values out of public files, screenshots, logs, examples, and bug
reports:

- `.env` contents and shell environment dumps;
- `TELEGRAM_BOT_TOKEN`, `DISCORD_BOT_TOKEN`, provider env, private keys, or API
  keys;
- Telegram chat IDs, Discord channel/user IDs, bot usernames, personal handles,
  email addresses, and local filesystem paths;
- `.viser/`, `.omx/`, service artifacts, backups, memory, session, and job state.

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
