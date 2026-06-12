## Summary

Describe the user-facing change and why it is needed.

## Security and privacy checklist

- [ ] I did not add or commit `.env`, `.viser/`, `.omx/`, legacy service logs, backups,
      session/memory/job state, real tokens, personal handles, emails, IDs, or
      local filesystem paths.
- [ ] I preserved Viser's local CLI-only model access boundary for core
      GPT/Codex, Gemini, and Claude routes (`codex`, `gemini`, `claude`) and did
      not add model API key or HTTP model-client requirements.
- [ ] I preserved prompt-injection guard behavior before provider handoff when
      touching prompts, memory, sessions, skills, plugins, or provider routing.
- [ ] I kept mutation behind approval-gated `/propose` + approval flows.
- [ ] I used fake credentials and generic examples in docs/tests.
- [ ] I did not reintroduce background service install/start/service-run behavior
      or service artifact generator/install helper exports; Viser must start
      only from a foreground terminal command.

## Verification

Paste the relevant command output or explain why a check is not applicable.

- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run audit`
- [ ] `node src/index.ts verify --strict`
- [ ] `node src/index.ts release-evidence`
- [ ] `npm pack --dry-run`

For final live proof, run when local provider CLIs and messenger credentials are
configured:

- [ ] `node src/index.ts release-evidence --strict --live --probe-all-providers`
