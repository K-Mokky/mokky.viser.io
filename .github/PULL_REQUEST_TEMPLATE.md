## Summary

Describe the user-facing change and why it is needed.

## Security and privacy checklist

- [ ] I did not add or commit `.env`, `.viser/`, `.omx/`, legacy service logs, backups,
      session/memory/job state, real tokens, personal handles, emails, IDs, or
      local filesystem paths.
- [ ] I preserved Viser's local CLI-only model access boundary for core
      GPT/Codex, Gemini, Claude, Grok/xAI, and Cursor routes (`codex`, `gemini`, `claude`, `grok`, `cursor-agent`) and did
      not add model API key or HTTP model-client requirements.
- [ ] I preserved prompt-injection guard behavior before provider handoff when
      touching prompts, memory, sessions, skills, plugins, or provider routing.
- [ ] I kept mutation behind approval-gated `/propose` + approval flows.
- [ ] I used fake credentials and generic examples in docs/tests.
- [ ] Native always-on service install stays behind the live provider-proof gate
      (`viser service install` / `viser service-run`); I did not add a hidden model API path.

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
