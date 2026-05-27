# Contributing to Viser

Thanks for helping improve **Viser**, a local-first assistant runtime by
**KMokky**. Contributions should preserve the project goal: talk to users through
CLI and optional Telegram/Discord bridges while using already logged-in local AI
CLIs instead of GPT/Gemini/Claude model HTTP APIs or model API keys.

## Ground rules

- Keep public identity limited to the project name `Viser` and creator credit
  `KMokky` unless the maintainer explicitly adds more public information.
- Do not commit `.env`, `.viser/`, `.omx/`, service logs, backups, session
  transcripts, memory entries, messenger chat/channel IDs, personal handles,
  emails, local filesystem paths, or real tokens.
- Do not add model API key requirements or fallback HTTP model clients for the
  core GPT/Codex, Gemini, or Claude routes. They must keep using local CLI
  commands (`codex`, `gemini`, `claude`).
- Keep mutation behind approval-gated actions. Do not add hidden provider tools
  that write files, open URLs, send messages, or access external apps without a
  `/propose` + approval boundary.
- Treat user, memory, session, plugin, and skill content as untrusted input and
  preserve prompt-injection guard behavior before provider handoff.

## Development workflow

1. Install dependencies with the existing lockfile.
2. Keep diffs small and prefer reuse over new dependencies.
3. Add or update tests for behavior changes.
4. Run the verification set before opening a PR:

```bash
npm test
npm run typecheck
npm run audit
node src/index.ts verify --strict
node src/index.ts release-evidence
npm pack --dry-run
```

For final local-provider and messenger proof, run this in an environment where
`codex`, `gemini`, and `claude` are installed/logged in and real Telegram/Discord
tokens are configured:

```bash
node src/index.ts release-evidence --strict --live --probe-all-providers
```

## Pull request hygiene

- Summarize the user-facing behavior change and verification evidence.
- Mention security/privacy impact when touching providers, prompt construction,
  connectors, actions, state, backups, docs, release evidence, or package files.
- Use fake credentials and generic examples only.
- Update `aimake.md` when the change is part of the staged build history.
- If committing locally, use the repository's Lore-style commit message with
  useful `Constraint:`, `Rejected:`, `Tested:`, and `Not-tested:` trailers.
