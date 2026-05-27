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

Do **not** paste real `TELEGRAM_BOT_TOKEN`, `DISCORD_BOT_TOKEN`, provider env,
model API keys, private keys, session logs, memory state, or local machine paths.
If a secret was exposed, rotate it before sharing the report.

## Security boundaries

Viser intentionally keeps these boundaries small and auditable:

1. **No model API key path**: core GPT/Codex, Gemini, and Claude routes must use
   exact local CLI command basenames (`codex`, `gemini`, `claude`). Audit and
   strict release evidence fail if model API key env names such as
   `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, or
   `GOOGLE_GENERATIVE_AI_API_KEY` are present in active/public/provider env
   surfaces.
2. **Prompt-injection guard**: untrusted user, memory, session, skill, and plugin
   content is fenced before provider handoff. High-risk instruction override,
   secret exfiltration, approval bypass, hidden HTML/zero-width/bidi control, and
   base64-encoded injection patterns are detected before the local CLI provider
   is invoked.
3. **Approval-gated mutation**: file writes, URL/mail/notification/TTS/calendar,
   clipboard, and outbound messenger actions are staged through `/propose` and
   must be explicitly approved before execution.
4. **Messenger access control**: Telegram/Discord bridges default to pairing or
   static allowlists, enforce per-peer rate limits, and cap inbound input length
   before provider calls.
5. **Private local state**: `.env`, `.viser/`, `.omx/`, local config, logs,
   backups, and service artifacts are excluded from public package/release
   artifacts and are checked for unsafe permissions or symlinks.
6. **Provider environment minimization**: provider subprocesses do not inherit
   shell secrets by default. Explicit provider env is redacted in output and is
   rejected when it contains model API key names.

## Required checks before public disclosure or release

Run these commands and include the redacted output in the release or fix notes
when relevant:

```bash
npm test
npm run typecheck
npm run audit
node src/index.ts verify --strict
node src/index.ts release-evidence
node src/index.ts release-evidence --strict --live --probe-all-providers
npm pack --dry-run
```

`release-evidence --strict --live --probe-all-providers` is expected to fail
until real local CLI login proof and configured Telegram/Discord token validation
are available. The report is safe to paste and includes redacted recovery steps
for any missing proof.
