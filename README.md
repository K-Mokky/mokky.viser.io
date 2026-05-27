<p align="center">
  <img src="assets/viser-readme-logo.png" alt="Viser logo" width="720">
</p>

# Viser

Viser는 **API 키로 모델을 호출하지 않고**, 이미 로그인된 로컬 AI CLI(`codex`, `gemini`, `claude`)를 실행해서 답변을 받아오는 TypeScript-first 개인 비서 CLI예요. CLI에서 직접 대화할 수 있고, Telegram/Discord 봇을 교통수단으로 붙여 같은 비서와 대화할 수 있어요.

제작자: **KMokky**

라이선스: **MIT**

> 현재 Viser는 로컬-first 개인 비서 런타임으로 바로 실행 가능한 핵심 루프를 갖췄어요. 장기 메모리, user profile 요약, 세션 검색, SKILL.md 스킬, local plugin manifest, MCP stdio server, 명시적 로컬 도구, bounded-parallel durable job queue, dependency-gated team/fix-loop/supervisor workflow, 승인 기반 파일 쓰기/외부 URL 열기/메일 draft/로컬 TTS/캘린더 import/desktop notification/clipboard/메신저 outbound, 예약 작업, Telegram/Discord pairing, readiness/audit/provider 진단, prompt guard, 공개 배포 hygiene 점검, 상태 백업, foreground gateway가 포함돼요.

## 핵심 원칙

- **모델 API 미사용**: GPT/Codex, Gemini, Claude 응답은 로컬 CLI 계정 로그인 상태를 사용해요. `audit`은 핵심 provider route가 `codex`/`gemini`/`claude` CLI 명령인지 확인하고, 활성 `.env`나 provider env에 `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` 같은 model API key 변수가 들어오면 fail로 막아요.
- **Provider fallback**: 기본 provider가 실패하면 명시적 override가 없을 때 `fallbackProviders` 순서로 재시도해요.
- **TypeScript-first**: `src/**/*.ts`가 메인 구현이에요. Node 22.6+의 TypeScript stripping으로 바로 실행할 수 있어요.
- **Python은 보조 도구**: `tools/session_digest.py`는 대화 로그를 사람이 읽기 쉽게 요약해요.
- **읽고 고치기 쉽게 구성**: provider, connector, core runtime, memory, skills, tools, CLI entrypoint가 분리되어 있어요.
- **명시적 권한 경계**: 로컬 도구는 숨겨진 model tool이 아니라 `/tool ...` slash command로 직접 호출해요.
- **입력 크기 제한**: provider로 넘어가는 CLI/MCP/스킬/플러그인 작업 입력은 `assistant.maxInputChars` 기본 12000자로 제한해 로컬 AI CLI에 과대 prompt를 넘기지 않아요.
- **프롬프트 인젝션 방어**: 사용자/메모리/세션/스킬/플러그인 본문을 untrusted block으로 감싸고 의심 신호를 표시해 system/runtime 정책보다 높은 권한처럼 실행되지 않게 해요.
- **승인 기반 액션**: 파일 쓰기, 브라우저/메일 URL 열기, 메일 draft, 로컬 TTS, 캘린더 import, desktop notification은 `/propose`로 staging한 뒤 `/approve`해야 실행돼요.
- **메신저 접근 제어**: Discord/Telegram은 기본적으로 pairing code를 거친 chat/channel만 응답하고, chat/channel별 분당 메시지 제한과 입력 길이 제한으로 한 peer가 로컬 provider CLI를 무제한·과대 입력으로 호출하지 못하게 해요.

## 설치와 첫 실행

처음 받는 사람은 아래 순서만 먼저 따라 하면 돼요. `npm ci`는 테스트/typecheck처럼 개발 검증을 할 때 필요하고, 일반 실행은 Node 22.6+의 native TypeScript 실행으로 바로 시작할 수 있어요.

```bash
git clone https://github.com/<owner>/viser.git
cd viser

node --version   # Node.js 22.6 이상 필요
node src/index.ts setup
node src/index.ts doctor
node src/index.ts verify
node src/index.ts chat
```

AI 답변을 받으려면 사용할 provider CLI를 설치하고 한 번 로그인해 둬야 해요. Viser는 `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` 같은 모델 API 키를 요구하지 않아요.

```bash
codex login
gemini      # 첫 실행에서 브라우저 로그인이 열릴 수 있어요.
claude      # Claude Code 설치 후 interactive login
```

개발/검증까지 하려면 의존성을 설치한 뒤 테스트를 돌려요.

```bash
npm ci
npm test
npm run typecheck
```

전역 명령처럼 쓰고 싶으면 로컬에서 link해요.

```bash
npm link
viser setup
viser doctor
viser chat
```

Gateway를 실제로 띄우기 전에는 dry-run gate를 먼저 통과시키는 걸 권장해요.

```bash
node src/index.ts gateway --dry-run --strict --live --probe-all-providers
node src/index.ts gateway
```

## 빠른 명령 참조

```bash
node src/index.ts setup   # config 생성 + starter skills 설치 + 진단
node src/index.ts doctor
node src/index.ts env-init
node src/index.ts env-check
node src/index.ts config-check
node src/index.ts state-check
node src/index.ts dashboard
node src/index.ts dashboard --json
node src/index.ts web-dashboard
node src/index.ts dashboard-check
node src/index.ts verify
node src/index.ts preflight
node src/index.ts preflight --live --probe-all-providers
node src/index.ts launch-status
node src/index.ts smoke
node src/index.ts next-steps
npm run next-steps
npm run dashboard
npm run dashboard:check
npm run dashboard:web
npm run verify:providers
npm run launch-status
npm run gateway:check
npm run gateway        # live provider-proof strict foreground gateway
node src/index.ts readiness
node src/index.ts audit
npm run release:audit
node src/index.ts backup
node src/index.ts provider-guide
node src/index.ts readiness --probe-all-providers
node src/index.ts gateway --dry-run
node src/index.ts gateway --dry-run --strict
node src/index.ts gateway --dry-run --strict --live --probe-all-providers
node src/index.ts service-run --live --probe-all-providers  # launchd가 쓰는 live provider-proof service runner
node src/index.ts chat
node src/index.ts ask --provider gemini "오늘 할 일을 정리해줘"
node src/index.ts skills
node src/index.ts tools

# 선택: config만 생성
node src/index.ts init
```

전역 명령으로 쓰고 싶으면 이 폴더에서 `npm link`를 실행한 뒤 `viser doctor`처럼 사용할 수 있어요. 프로젝트 `.npmrc`는 npm cache를 `.viser/npm-cache`로 고정해 사용자 홈 npm cache 권한이 꼬여 있어도 `npm test`, `npm run ...`, `npm pack --dry-run` 같은 로컬 검증 명령을 바로 실행할 수 있게 해요. `.viser/npm-cache`는 backup/package 대상에서 제외돼요.

기본적으로 현재 작업 디렉터리의 `.env`를 먼저 읽어요. `node src/index.ts env-init`으로 secret 없는 개인 `.env` 템플릿을 만들 수 있고, 새 파일은 token 저장에 맞게 `0600` 권한으로 생성돼요. 다른 env 파일을 쓰려면 `--env ./path/to.env`를 붙이거나, 서비스/쉘 환경에 `VISER_ENV=./path/to.env`를 설정하면 돼요. 이 env 파일 안의 `VISER_CONFIG`, `VISER_PROVIDER`, `TELEGRAM_BOT_TOKEN`, `DISCORD_BOT_TOKEN`은 config 로딩 전에 반영돼요. `.env`는 메신저 transport token과 Viser runtime 선택값만 담아야 하며, GPT/Claude/Gemini model API key 이름이 들어가면 `audit`/`verify --strict`가 차단해요. 실제 어떤 파일/키가 적용됐는지는 secret 값을 노출하지 않는 `node src/index.ts env-check`로 확인해요.

## AI CLI 로그인

Viser는 모델 API 키를 받지 않아요. 대신 아래 CLI를 사용자가 직접 로그인해 둔 상태로 실행해요. `audit`은 `codex`/`gpt` route가 `codex`, `gemini` route가 `gemini`, `claude` route가 `claude` CLI 명령을 쓰는지 확인해 HTTP/API client wrapper로 바뀐 설정을 막아요. 활성 `.env` 또는 `providers.<id>.env`에 `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` 같은 model API key 변수를 넣으면 `node src/index.ts audit`과 `verify --strict`가 실패해요. 또한 직접 `chat`/`ask`로 provider를 실행하더라도 explicit `providers.<id>.env`의 model API key 변수는 provider subprocess를 spawn하기 전에 runtime에서 거부해요.

```bash
codex login      # GPT/Codex 계열
# gemini는 보통 첫 interactive 실행에서 브라우저 로그인을 진행해요.
gemini
# Claude Code 설치 후 interactive login
claude
```

설치 여부는 다음으로 확인해요.

```bash
node src/index.ts doctor
node src/index.ts login
node src/index.ts provider-guide --probe
```

`doctor`는 단순 설치 목록뿐 아니라 `verify --live --probe-all-providers`, `launch-status`, `gateway --dry-run --strict --live --probe-all-providers`, `next-steps --live --probe-all-providers`처럼 실제 launch 전에 필요한 live provider-proof 점검 명령도 함께 보여줘요.

Provider probe가 실패하면 `verify --live --probe-all-providers`, `launch-status`, `provider-guide --probe`, `next-steps --live --probe-all-providers`가 실패 유형을 분류해요. `provider-guide --probe`는 여러 로컬 CLI를 순차적으로 probe해서 Gemini/Claude 같은 interactive login prompt가 동시에 겹쳐 뜨지 않게 해요. Provider 출력에 shell env나 허용된 `provider.env`의 secret-looking 값이 섞여도 report/응답에는 `[REDACTED]`로 표시돼요. 단, `provider.env`에 model API key 변수명이 있으면 redaction 이전에 runtime이 실행을 거부해 유료 API 경로로 넘어가지 않아요. Codex처럼 banner가 긴 CLI도 runtime proof preview에는 통과 기준인 `VISER_OK` sentinel 주변을 보여줘서 실제 proof가 무엇인지 확인하기 쉬워요.
`provider-guide`가 출력하는 manual smoke test는 runtime과 같은 `{prompt}` 치환 규칙을 써서 `--prompt {prompt}`뿐 아니라 `--prompt={prompt}` 형태도 그대로 재현해요.

- `sandbox/permission failure`: Codex 같은 sandbox 안에서 막힌 경우예요. 출력된 manual smoke test를 일반 터미널에서 실행한 뒤 다시 `node src/index.ts launch-status`를 돌려요.
- `interactive login required`: Gemini/Claude 같은 CLI가 브라우저 로그인이나 계정 확인을 요구하는 경우예요. 해당 CLI를 일반 터미널에서 직접 실행해 로그인한 뒤 다시 probe해요.
- `provider command missing`: CLI 설치 또는 `providers.<id>.command` 설정이 필요해요.
- `provider returned empty output`, `unexpected probe response`, 또는 timeout: `promptMode`/`args`와 provider timeout을 점검해요. Provider runtime proof는 단순히 비어 있지 않은 출력이 아니라 `VISER_OK` probe sentinel을 포함해야 통과해요.

## CLI 명령

```bash
node src/index.ts help
node src/index.ts status
node src/index.ts dashboard
node src/index.ts dashboard --json
node src/index.ts dashboard-check [--strict] [--host 127.0.0.1] [--port 8787]
node src/index.ts web-dashboard [--host 127.0.0.1] [--port 8787]
node src/index.ts env-init [--output ./.env] [--force]
node src/index.ts env-check [--env ./prod.env]
node src/index.ts config-check
node src/index.ts state-check [--repair] [--force]
node src/index.ts preflight [--strict] [--live] [--probe-all-providers]
node src/index.ts launch-status
node src/index.ts verify [--strict] [--live] [--probe-providers|--probe-all-providers]
node src/index.ts smoke [--strict] [--keep]
node src/index.ts next-steps [--live] [--probe-all-providers]
node src/index.ts audit
node src/index.ts release-evidence [--strict] [--json] [--live] [--probe-all-providers]
node src/index.ts backup [--output ./viser-backup.json]
node src/index.ts compact-backups [--fix-permissions|--delete --force]
node src/index.ts providers
node src/index.ts login [provider]
node src/index.ts provider-guide [provider] [--probe]
node src/index.ts ask --provider codex "질문"
node src/index.ts chat --provider gemini
node src/index.ts sessions
node src/index.ts session-search "지난 결정"
node src/index.ts session-compact [session-id] [max-messages]
node src/index.ts skills
node src/index.ts plugins
node src/index.ts plugin release-check plan "GitHub 공개 전 점검 계획"
node src/index.ts mcp-client-config [generic|claude-desktop|codex] [--name viser] [--json]
node src/index.ts mcp-server
node src/index.ts memory [query]
node src/index.ts profile
node src/index.ts memory-compact [max-entries]
node src/index.ts remember "stable fact #tag"
node src/index.ts tools
node src/index.ts tool list-dir .
node src/index.ts pair-code telegram <nickname>
node src/index.ts access
node src/index.ts schedule every 1h "daily brief"
node src/index.ts schedules
node src/index.ts enqueue "긴 분석을 나중에 실행해줘"
node src/index.ts team "v0.1.0 공개 릴리스 점검"
node src/index.ts fix-loop "릴리스 체크리스트를 검토하고 고쳐줘"
node src/index.ts supervise "릴리스 목표를 끝까지 점검하고 승인 제안까지 만들어줘"
node src/index.ts jobs
node src/index.ts run-jobs 1
node src/index.ts run-jobs 4 --parallel 3  # team 역할 lane 후 synthesis까지 dependency-aware 실행
node src/index.ts run-jobs 6 --parallel 3
node src/index.ts propose write-file notes.txt "hello"
node src/index.ts propose open-url https://example.com "브라우저로 확인"
node src/index.ts propose mail-draft user@example.com "|" "상태 공유" "|" "본문 초안"
node src/index.ts propose speak "Viser 작업이 끝났어요"
node src/index.ts propose calendar-event 2026-06-01T09:00:00Z 30 "프로젝트 점검"
node src/index.ts propose notify "Viser 완료" "|" "검증이 끝났어요"
node src/index.ts propose clipboard "Viser 검증 요약"
node src/index.ts propose message telegram:-100123456 "|" "Viser 검증이 끝났어요"
node src/index.ts approvals
node src/index.ts delete-action <id>
node src/index.ts web-dashboard
node src/index.ts scheduler
node src/index.ts service-run --live --probe-all-providers
node src/index.ts gateway --dry-run --strict
node src/index.ts gateway --web-dashboard
node src/index.ts gateway
node src/index.ts telegram
node src/index.ts discord
```

대화 중 slash command:

- `/help`: 사용법
- `/providers`: provider 목록
- `/provider <id>`: 현재 세션 provider 변경
- `/login [id]`: 로그인 힌트
- `/provider-guide [id]`: provider별 설치/로그인/수동 smoke test 안내
- `/status`: 세션 상태
- `/dashboard [--json]`: provider 호출 없이 운영 상태 요약
- `/reset`: 현재 세션 기록 삭제
- `/sessions [limit]`: 저장된 세션 목록
- `/session [id] [limit]`: 현재 또는 지정 세션 전문 확인
- `/session-search <query>`: 저장된 세션 메시지 검색
- `/session-compact [id] [max-messages]`: 세션 원본을 백업하고 최신 N개 메시지만 유지
- `/remember <text> [#tag]`: 장기 메모리 저장
- `/memory [query]`: 장기 메모리 조회/검색
- `/profile [tag-limit]`: 장기 메모리를 tag별 user profile로 요약
- `/memory-compact [max-entries]`: 중복 메모리를 정리하고 선택적으로 최신 N개만 유지
- `/forget <memory-id>`: 장기 메모리 삭제
- `/skills`: 사용 가능한 `SKILL.md` 절차 목록
- `/skill <id> <task>`: 선택한 스킬을 prompt에 주입해 작업 실행
- `/plugins`: 사용 가능한 local plugin manifest 목록
- `/plugin <id> <command> <task>`: 선택한 plugin command를 prompt에 주입해 작업 실행
- `/schedule every <duration> <prompt>`: 반복 예약 작업 추가
- `/schedule at <ISO datetime> <prompt>`: 1회 예약 작업 추가
- `/schedules`: 예약 작업 목록
- `/unschedule <id>`: 예약 작업 삭제
- `/enqueue <prompt>`: 나중에 실행할 1회성 provider 작업을 queue에 저장
- `/team <task>` 또는 `/swarm <task>`: planner/executor/verifier 역할 job을 durable queue에 병렬 lane으로 저장
- `/fix-loop <task>` 또는 `/autofix <task>`: plan→implement→review→fix→verify→synthesize dependency-gated job loop 저장
- `/supervise <task>` 또는 `/autopilot <task>`: safety intake→repo scout→implementation plan→approval proposal→verification→release audit→handoff supervisor job loop 저장
- `/jobs [status]`: queued job 목록 조회
- `/run-jobs [limit] [--parallel <1-6>]`: pending job을 실행하고, 필요하면 bounded parallel provider 호출 사용
- `/cancel-job <id>`: pending/running job 취소
- `/delete-job <id>`: 완료/실패/취소된 job 기록 삭제
- `/pair <code>`: Discord/Telegram에서 pairing code로 현재 chat/channel 승인
- `/propose write-file <path> <content>`: 파일 쓰기 제안 생성
- `/propose append-file <path> <content>`: 파일 append 제안 생성
- `/propose open-url <https-url|mailto-url> [note]`: 브라우저/메일 URL 열기 제안 생성
- `/propose mail-draft <to> | <subject> | <body>`: 로컬 메일 draft 제안 생성
- `/propose speak <text>`: 로컬 TTS로 읽을 문장 제안 생성
- `/propose calendar-event <ISO-start> <duration-minutes> <title>`: 로컬 `.ics` 캘린더 import 제안 생성
- `/propose notify <title> | <body>`: 로컬 desktop notification 제안 생성
- `/propose clipboard <text>`: 로컬 clipboard copy 제안 생성
- `/propose message telegram:<chat-id>|discord:<channel-id> | <text>`: 허용된 메신저 target으로 보낼 outbound message 제안 생성
- `/approvals`: 승인 대기 action 목록
- `/approve <id>`: 승인 후 실행
- `/reject <id>`: 거절
- `/delete-action <id>`: 승인/거절 완료된 action 기록 삭제
- `/tools`: 로컬 도구 목록
- `/tool <tool> <args>`: 명시적 로컬 도구 실행

## 장기 메모리

메모리는 `.viser/memory/entries.jsonl`에 저장돼요. 일반 메시지를 provider에 보낼 때, 질문과 관련 있는 메모리가 prompt에 함께 들어가요. 검색은 정확한 단어/문구와 `#tag`뿐 아니라 외부 embedding API나 vector DB 없이 로컬 lexical vector(토큰, stem, 문자 n-gram cosine)로 오타·부분 일치도 함께 잡아요.

```bash
node src/index.ts remember "I prefer Korean haeyo style #preference"
node src/index.ts memory Korean
node src/index.ts profile
node src/index.ts memory-compact 500
node src/index.ts ask "내 응답 스타일을 어떻게 해야 해?"
```

`profile`은 저장된 메모리를 tag별로 묶어 선호/스타일/프로젝트 사실을 빠르게 보여줘요. 일반 provider prompt에도 compact profile summary가 함께 들어가서, 질문과 직접 일치하지 않는 안정적 선호도 답변에 반영될 수 있어요.

`memory-compact`는 같은 텍스트를 정규화해 중복을 제거하고, 변경 전 원본을 `.viser/memory/*.bak.jsonl`로 백업해요. 검색은 일반 단어와 `#tag` 질의를 우선순위 있게 처리한 뒤, dependency-free lexical vector score를 더해 `typscript`처럼 약간 틀린 질의도 `TypeScript` 메모리에 닿게 해요. 이 vector retrieval은 로컬 JSONL을 매번 읽어 계산하므로 추가 과금이나 외부 전송은 없지만, neural embedding처럼 의미 동의어를 깊게 이해하는 단계는 아니에요. Compact 백업은 일반 `backup` export에는 포함되지 않지만 로컬 디스크에는 남으므로, 오래 보관할 필요가 없으면 `node src/index.ts compact-backups`로 목록을 확인한 뒤 `node src/index.ts compact-backups --delete --force`로 명시 정리할 수 있어요. 권한이 넓은 compact 백업은 기본 목록에서 warning으로만 표시하고, `--fix-permissions`를 명시해야 `0600`으로 고쳐요.

## 터미널 Dashboard

`dashboard`는 provider를 호출하지 않고 현재 운영 상태를 한 화면에 모아요. `status`가 현재 세션 중심이라면, `dashboard`는 provider 설치 상태, scheduler/job worker 설정, connector 상태, 메모리/스킬/플러그인/스케줄/job/승인 대기 수, 최근 세션, 다음 실행 명령을 함께 보여줘요.

```bash
node src/index.ts dashboard
node src/index.ts dashboard --json
npm run dashboard
node src/index.ts dashboard --json | jq '.state.jobs'
```

대화 중에는 `/dashboard`를 쓰면 되고, 자동화나 이후 web/TUI dashboard에서 재사용할 상태 모델이 필요하면 `/dashboard --json` 또는 `node src/index.ts dashboard --json`을 쓰면 돼요. JSON 출력은 텍스트 dashboard와 같은 내부 snapshot에서 만들어져서 `schemaVersion: 1`, `runtime`, `state`, `providers`, `capabilities`, `nextCommands` 키를 안정적으로 제공합니다. `capabilities`는 dashboard surface가 read-only이며 provider 호출, write action, job 실행, live provider proof를 수행하지 않는다는 경계를 machine-readable로 보여줘요. Live provider/token 검증은 하지 않으므로 빠르게 상태를 보는 용도이고, 최종 launch 판정은 여전히 `node src/index.ts launch-status`가 담당해요.

## Web Dashboard

로컬 브라우저에서 볼 수 있는 read-only dashboard도 제공해요. 새 dependency 없이 Node HTTP 서버만 사용하고, 기본 bind는 `127.0.0.1:8787`이라 LAN에 열리지 않아요.

```bash
node src/index.ts web-dashboard
npm run dashboard:web
node src/index.ts dashboard-check --strict
npm run dashboard:check
curl http://127.0.0.1:8787/dashboard.canvas.svg > viser-dashboard.svg
# 다른 로컬 포트를 쓰고 싶을 때
node src/index.ts web-dashboard --port 8790
node src/index.ts dashboard-check --port 8790
# gateway/service와 함께 상시 띄우고 싶을 때
node src/index.ts gateway --web-dashboard
```

브라우저에서 표시되는 `/` 화면과 `/dashboard.json` API는 `DashboardData` snapshot을 그대로 재사용해요. `/dashboard.schema.json`은 현재 `dashboard.v1` JSON schema를 제공하므로 외부 UI나 플러그인이 key 계약을 확인할 수 있어요. `/dashboard.events`는 Server-Sent Events로 같은 snapshot을 주기적으로 보내서 브라우저 화면이 수동 refresh 없이 갱신되게 해요. `/` 화면에는 같은 snapshot으로 그리는 read-only `<canvas>` overview도 포함되어 provider/jobs/approvals/memory 상태를 시각적으로 보여줘요. `/dashboard.canvas.svg`는 JavaScript 없이 같은 snapshot을 정적 SVG canvas artifact로 내보내므로 README/이슈/외부 UI 미리보기나 screenshot workflow에서 바로 재사용할 수 있어요. 이 surface는 provider 호출, 파일 쓰기 승인/실행, job 실행 route를 제공하지 않고 상태 조회만 하므로, live launch 판정이나 provider/token 검증은 계속 `node src/index.ts launch-status`로 확인해요. 보안상 `--host`/`webDashboard.host`는 `127.0.0.1`, `localhost`, `::1`만 허용해요. 원격에서 봐야 한다면 dashboard 자체를 LAN에 열기보다 별도 SSH tunnel 같은 명시적 로컬 터널을 쓰는 편이 안전해요.

`dashboard-check`는 provider를 호출하지 않고 실제 HTTP listener의 `/healthz`, `/dashboard.json`, `/dashboard.schema.json`, `/dashboard.canvas.svg`를 확인해요. Live stream 자체는 같은 `DashboardData`를 쓰는 `/dashboard.events` route라 UI 자동 갱신용이며, schema 계약 확인은 `/dashboard.schema.json`, 정적 canvas artifact 확인은 `/dashboard.canvas.svg`가 담당해요. 로그에는 dashboard가 시작됐다고 보여도 예전 프로세스가 떠 있거나 schema/canvas route가 빠진 상태면 `BLOCKED`로 잡아내므로, service/gateway 재시작 후 바로 사용할 수 있는지 확인할 때 `node src/index.ts dashboard-check --strict`를 실행하면 돼요.

`viser.config.json`에서 아래처럼 켜면 `service-run`/launchd gateway에도 dashboard가 함께 붙어요. 현재 workspace config는 바로 볼 수 있게 localhost dashboard가 켜져 있어요.

```json
"webDashboard": {
  "enabled": true,
  "host": "127.0.0.1",
  "port": 8787
}
```

## 세션 기록 검색

대화 기록은 `.viser/sessions/*.jsonl`에 저장돼요. 장기 작업 중 과거 결정, provider 응답, 특정 에러를 다시 찾을 수 있어요.

```bash
node src/index.ts sessions
node src/index.ts session cli__example_project 50
node src/index.ts session-search "Operation not permitted"
node src/index.ts session-compact cli__example_project 500
```

대화 중에는 `/sessions`, `/session [id] [limit]`, `/session-search <query>`, `/session-compact [id] [max-messages]`를 사용할 수 있어요. `sessions`에 표시되는 id는 파일명 안전성을 위해 원래 session id를 정규화한 값이에요. `session-compact`는 `.viser/sessions/<id>.<timestamp>.bak`에 `0600` 백업을 만든 뒤 최신 메시지만 남겨, 검색 가능한 세션 로그가 무제한 커지거나 오래된 민감 대화가 계속 active JSONL에 남는 일을 줄여요. Compact 백업은 복구용 원본이므로 자동 삭제하지 않지만, `compact-backups` 명령으로 크기/목록을 확인하고 필요할 때만 강제로 정리할 수 있어요.

## 스킬 시스템

스킬은 `skills/<name>/SKILL.md` 또는 `.viser/skills/<name>/SKILL.md` 형식이에요. Skill body는 prompt에 직접 들어갈 수 있으므로 registry는 symlinked skill directory나 symlinked `SKILL.md`를 따라가지 않고 건너뛰어요. 현재 기본 스킬은 다음과 같아요.

- `daily-brief`
- `safe-automation`
- `message-triage`

```bash
node src/index.ts skills
node src/index.ts ask "/skill daily-brief 오늘 해야 할 일을 정리해줘"
```

## 로컬 플러그인 시스템

플러그인은 `plugins/<name>/plugin.json` 또는 `.viser/plugins/<name>/plugin.json` 형식의 선언형 manifest예요. Plugin command는 provider prompt에 주입되는 재사용 절차일 뿐이고, 숨겨진 도구/쉘/파일 권한을 얻지 못해요. Registry는 symlinked plugin directory나 symlinked `plugin.json`을 따라가지 않고 건너뛰어요.

기본 플러그인:

- `release-check`: GitHub 공개 전 release hygiene와 검증 checklist를 만드는 prompt plugin

```bash
node src/index.ts plugins
node src/index.ts plugin release-check plan "v0.1.0 공개 전 확인할 것"
```

대화 중에는 `/plugins`, `/plugin release-check plan ...`처럼 사용할 수 있어요.


## MCP stdio 서버

Viser는 dependency 없이 로컬 MCP stdio server도 제공해요. MCP의 tools/resources/prompts 흐름처럼 `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`, `prompts/get` JSON-RPC 메시지를 stdin/stdout으로 처리하고, 서버 capability에는 `tools`, `resources`, `prompts`를 선언해요. 이 surface는 외부 MCP client가 Viser 상태, 공개 문서, 안전한 proposal workflow, 재사용 prompt를 로컬에서 통합하기 위한 지점이에요.

```bash
node src/index.ts mcp-client-config generic
node src/index.ts mcp-client-config codex --name viser-local --json
node src/index.ts mcp-server
npm run mcp-server
```

`mcp-client-config`는 Viser를 외부 MCP client에 붙이기 위한 `mcpServers` JSON snippet을 출력해요. Snippet은 현재 Node 실행 파일, Viser `src/index.ts mcp-server`, config path(`VISER_CONFIG`가 필요한 경우), 그리고 작업 directory(`cwd`)만 포함하고, Telegram/Discord token이나 provider secret env는 복사하지 않아요. 출력 예시는 아래처럼 client 설정에 붙여넣을 수 있는 형태예요.

```json
{
  "mcpServers": {
    "viser": {
      "command": "/path/to/node",
      "args": ["/path/to/viser/src/index.ts", "mcp-server"],
      "cwd": "/path/to/viser",
      "env": {
        "VISER_CONFIG": "/path/to/viser/viser.config.json"
      }
    }
  }
}
```

지원 target은 `generic`, `claude-desktop`, `codex`예요. 세 target은 모두 local stdio MCP server 연결을 위한 같은 안전 config shape를 출력하고, client별 label만 달라요. 사용 중인 client가 `cwd` field를 지원하지 않으면 해당 directory에서 client를 실행하거나 작은 wrapper script로 같은 command를 실행하면 돼요.

현재 MCP tools:

- `viser_dashboard`: provider 호출 없는 dashboard JSON snapshot
- `viser_status`: provider 호출 없는 runtime status
- `viser_memory_search`: 로컬 장기 메모리 검색
- `viser_pending_approvals`: 승인 대기 action 조회
- `viser_propose_open_url`: `open-url` action을 승인 대기 상태로 staging
- `viser_propose_mail_draft`: `mail-draft` action을 승인 대기 상태로 staging
- `viser_propose_file_write`: 파일 write/append action을 승인 대기 상태로 staging
- `viser_propose_calendar_event`: 로컬 `.ics` calendar event action을 승인 대기 상태로 staging
- `viser_propose_notification`: 로컬 desktop notification action을 승인 대기 상태로 staging
- `viser_propose_clipboard`: 로컬 clipboard copy action을 승인 대기 상태로 staging
- `viser_propose_connector_message`: Telegram/Discord outbound message action을 승인 대기 상태로 staging

현재 MCP resources:

- `viser://dashboard`: provider 호출 없는 dashboard JSON
- `viser://status`: provider 호출 없는 runtime status text
- `viser://readme`: 공개 README markdown
- `viser://security`: 공개 SECURITY markdown

현재 MCP prompts:

- `viser_release_review`: 공개 배포 전 검증 checklist prompt
- `viser_safe_automation`: 요청을 `/tool`/`/propose` workflow로 바꾸는 안전 자동화 prompt
- `viser_messenger_triage`: Telegram/Discord 응답 triage prompt

MCP tools/resources/prompts는 직접 provider를 호출하거나 `/approve`를 실행하지 않아요. 파일 수정, 외부 URL 열기, 메일 draft, 캘린더 import, desktop notification, outbound messenger message는 MCP client가 proposal을 만들 수만 있고, 실제 실행은 사용자가 Viser에서 `/approve <id>`를 명시해야 해요. MCP stdio transport는 로컬 프로세스 환경에서 실행되므로 public network listener를 열지 않아요.

## 로컬 도구와 권한 게이트

`.env`는 기본적으로 현재 작업 디렉터리의 `.env`를 자동 로딩해요. 기존 shell 환경변수는 덮어쓰지 않아요. 다른 파일을 쓰려면 `--env ./path/to/.env` 또는 `VISER_ENV=./path/to/.env`를 사용해요. dotenv 줄은 `KEY=value`와 `export KEY=value`를 모두 지원하고, 따옴표 밖 inline comment는 무시해요.

```bash
node src/index.ts env-init
node src/index.ts env-init --output ./prod.env
node src/index.ts env-check
node src/index.ts env-check --env ./prod.env
```

`env-init`은 `.env`가 없을 때 private template을 만들고, 이미 있으면 실수로 덮어쓰지 않아요. 필요할 때만 `--force` 또는 `--output ./prod.env`를 써요. 새 env 파일은 `0600`으로 생성되며, 기존 env target이 symlink/non-file이거나 symlinked parent 아래 있으면 `--force` 없이 정상 env file처럼 skip하지 않아요. `--force` 대상이 symlink여도 linked file을 덮어쓰지 않고 symlink 자체를 regular private file로 교체해요. Env loader는 `.env`나 `VISER_ENV` 파일을 `O_NOFOLLOW`로 열고 현재 workspace/baseDir 아래 symlink parent component도 거부하기 때문에 symlinked env path는 암묵적으로 따라가 로드하지 않아요. 기본 `.env`가 없으면 optional로 넘어가지만, 사용자가 `--env` 또는 `VISER_ENV`를 명시한 runtime 명령에서는 파일이 없을 때 즉시 실패해 잘못된 launch 환경을 조용히 사용하지 않아요. `env-check`, `doctor`, `setup`, `env-init` 같은 진단/생성 명령은 missing explicit env도 계속 report로 보여줘요. `env-check`와 `audit`도 symlinked env file이나 symlink parent component를 normal file처럼 따라가지 않고 unsafe path로 보고해요. 기존 파일 권한이 너무 넓으면 `env-check`가 `chmod 600 ...` 복구 명령을 보여줘요. `env-check`는 어떤 env 파일이 발견됐는지, 어떤 키가 파일에서 로드됐는지, 어떤 키가 shell/pre-existing env 때문에 유지됐는지, Telegram/Discord token이 missing/empty/present인지 보여줘요. Token 값은 항상 redacted로 표시돼서 로그에 secret이 새지 않아요.

도구는 읽기 중심으로 제한돼요. 기본 도구:

- `list-dir <path>`
- `read-file <path>`
- `shell <command>`: allowlist에 있는 읽기 명령만 실행

```bash
node src/index.ts tool list-dir src
node src/index.ts tool read-file README.md
node src/index.ts tool shell "git status"
```

모델 provider에게 숨겨진 도구 권한을 주지 않았어요. provider가 로컬 조치를 원하면 사용자에게 `/tool` 실행이나 `/propose` 승인 action을 요청하도록 prompt에 명시돼 있어요.

파일 없음, 권한 오류, missing command 같은 일반적인 도구 실행 오류는 chat/gateway 프로세스를 깨지 않고 `status: failed` 결과로 반환돼요.
`read-file`과 `shell` 출력은 `tools.maxReadBytes` 기준으로 잘라 메모리 폭주를 막고, 잘린 경우 `[truncated ...]` 표시를 남겨요. Workspace 아래 tool allowed read root는 symlink component를 거부해 symlinked root 아래 외부 tree를 도구 root로 삼지 않아요. `read-file`과 `list-dir`은 allowed root 아래 path component를 `lstat`으로 확인해 symlinked file/directory를 직접 따라가지 않고, `read-file`의 최종 content read도 `O_NOFOLLOW`로 수행해 검사 이후 symlink로 바뀐 파일을 따라가지 않아요.
`shell`의 파일 인자는 실행 전에 realpath로 확인해 allowed read root 밖으로 나가는 symlink를 차단하고, allowed root 안을 가리키는 명시 symlink path도 거부해 shell command가 symlink를 직접 따라가 읽지 않게 해요. Shell command 자체도 실행 전에 PATH에서 절대 경로로 확정하고, workspace/allowed root 내부 command candidate는 symlink component/final symlink/non-file을 거부해 allowlisted command 이름이 project 내부 symlink executable로 바뀌는 상황을 막아요. `audit/verify`도 shell allowlist command와 현재 PATH의 첫 executable candidate를 검사해 workspace/allowed root 내부 symlink command를 launch 전에 `UNSAFE`로 드러내요. Shell tool subprocess도 provider처럼 `VISER_*`와 secret-looking env를 제거한 환경으로 실행해 messenger token/API key가 allowlisted local command에 노출되지 않게 해요. `find -L`, `grep -R/--dereference-recursive`, `rg -L/--follow`, `ls -L/--dereference`처럼 하위 symlink를 따라갈 수 있는 옵션도 거부해요. `git --output=...`, `git --ext-diff/--textconv/--filters`, `find -exec/-fprint`, `rg --pre`처럼 읽기 명령처럼 보이지만 파일을 쓰거나 helper command를 실행할 수 있는 옵션도 차단해요. Git diff/log/show 계열은 `GIT_EXTERNAL_DIFF`를 제거하고 `--no-ext-diff --no-textconv`를 강제로 붙여 repo/global 설정의 external diff/textconv command hook이 실행되지 않게 해요. `sed`는 `-i`, `-f`, `r/w/e` 계열 file read/write/execute command와 `s///w`, `s///e` flag를 막아 default shell allowlist가 쓰기/외부 파일 읽기로 우회되지 않게 해요.

### Prompt guard

Provider에 전달되는 최종 prompt는 `src/core/prompt-guard.ts`의 safety contract를 포함해요. Viser는 사용자 메시지, Telegram/Discord 입력, 장기 메모리, 세션 기록, skill catalog, 선택한 `SKILL.md` 본문, plugin catalog, 선택한 plugin command를 모두 `<<<VISER_UNTRUSTED_BLOCK_START ... >>>` / `<<<VISER_UNTRUSTED_BLOCK_END>>>` 블록으로 감싸요. 블록 안에서 “이전 지시를 무시해”, “system prompt를 보여줘”, “API key를 써” 같은 문구가 발견되면 `injection_signals` metadata로 표시하고, provider에게 해당 블록을 정책이 아니라 데이터로 취급하라고 명시해요. 탐지 전용 경로에서는 원문을 provider prompt에 그대로 보존하되 Unicode NFKC 정규화, zero-width/bidi control 제거, HTML comment wrapper 해제, strict base64 후보 decode를 적용해 `Ign​ore previous...`처럼 보이지 않게 끊긴 지시문, `<!-- System: ... -->` 형태의 숨은 role block, `base64`로 숨긴 “ignore previous / reveal system prompt” 문구도 signal로 잡아요. 또한 현재 사용자 입력 자체가 secret/system prompt 유출, 승인·페어링 우회, role impersonation, jailbreak 같은 고위험 signal을 포함하면 provider CLI를 호출하기 전에 `Viser prompt guard: blocked`로 멈추고 안전한 `/tool`/`/propose` 대안을 안내해요. Provider-bound CLI/MCP/스킬/플러그인 작업 입력은 `assistant.maxInputChars` 기본 12000자를 넘으면 prompt guard 이전에 거부되어 provider CLI가 호출되지 않아요. 단순히 Viser가 model API key를 피하는 이유를 묻는 설명형 질문처럼 단독 low-risk signal은 차단하지 않고, contract가 포함된 prompt로 계속 처리해요.

이 guard는 모델 판단을 보조하는 defense-in-depth예요. 실제 권한은 여전히 코드 레벨에서 분리되어 있어서 provider는 숨겨진 도구를 직접 실행할 수 없고, 파일 쓰기와 외부 URL/메일/음성/캘린더/알림/클립보드/메신저 outbound action은 `/propose` + `/approve`, 메신저 접근은 pairing/allowlist, 모델 호출은 로그인된 로컬 CLI provider 경로를 거쳐야 해요.

파일 쓰기와 외부 앱으로 이어질 수 있는 URL 열기 action은 별도 승인 흐름을 사용해요.

```bash
node src/index.ts propose write-file notes.txt "hello"
node src/index.ts propose open-url https://example.com "브라우저로 확인"
node src/index.ts propose mail-draft user@example.com "|" "상태 공유" "|" "본문 초안"
node src/index.ts propose speak "Viser 작업이 끝났어요"
node src/index.ts propose calendar-event 2026-06-01T09:00:00Z 30 "프로젝트 점검"
node src/index.ts propose notify "Viser 완료" "|" "검증이 끝났어요"
node src/index.ts propose clipboard "Viser 검증 요약"
node src/index.ts propose message telegram:-100123456 "|" "Viser 검증이 끝났어요"
node src/index.ts approvals
node src/index.ts approve <id>
node src/index.ts reject <id>
```

기본적으로 현재 workspace 안에서만 쓰기 가능하고, 기존 파일을 덮어쓸 때는 `.viser/actions/backups/`에 백업을 만들어요. 이 백업도 개인 파일 내용을 담을 수 있으므로 항상 `0600` 권한으로 저장되고, 백업 source도 `O_NOFOLLOW`로 열어 symlink를 따라가지 않아요. `open-url` action은 `http`, `https`, `mailto`만 허용하고 `file:`, `javascript:`, credential 포함 URL, control character를 거부해 브라우저/메일 자동화를 명시 승인된 외부 URL 열기 수준으로 제한해요. `mail-draft` action은 단일 recipient/subject/body를 검증해 `mailto:` URL을 만들고 승인 후에만 기본 mail client를 열어요. 실제 전송은 mail app에서 사용자가 해야 해요. `speak` action은 500자 이하의 control-character 없는 문장만 승인 대기 상태로 저장하고, 승인 후에만 macOS `say`, Linux `spd-say`, Windows SpeechSynthesizer를 shell 없이 호출해 로컬 음성 출력으로 제한해요. `calendar-event` action은 ISO 시작 시각, 1~1440분 duration, 120자 이하 title만 받아 private `.viser/actions/calendar/<id>.ics` 파일을 만든 뒤 승인 후에만 OS calendar/import handler를 shell 없이 열어요. `notify` action은 120자 이하 title과 500자 이하 body만 승인 대기 상태로 저장하고, 승인 후에만 macOS `osascript` notification, Linux `notify-send`, Windows PowerShell NotifyIcon을 shell 없이 호출해 로컬 desktop notification으로 제한해요. `clipboard` action은 control-character 없는 8000자 이하 text만 승인 대기 상태로 저장하고, 승인 후에만 macOS `pbcopy`, Linux `wl-copy`/`xclip`/`xsel`, Windows `Set-Clipboard`를 shell 없이 호출해 로컬 clipboard를 바꿔요. `connector-message` action은 `telegram:<chat-id>` 또는 `discord:<channel-id>`와 2000자 이하 message만 받고, 승인 후에도 해당 target이 pairing/access policy 또는 configured allow/default list에 허용되어 있고 connector token이 있을 때만 Bot API/Discord REST로 전송해요. Pending action은 승인 실행 전까지 본문을 보관하지만, audit log와 승인/거절이 끝난 action state에는 본문 대신 `[N bytes]` marker만 남겨 장기 상태에 제안 내용이나 비밀값이 중복 저장되지 않게 해요. Workspace 아래 action write root는 symlink component를 거부해 symlinked root 아래 외부 tree를 쓰기 root로 삼지 않아요. Action 제안 단계부터 target이 lexical write root 밖에 있거나 symlink target/path component를 포함하면 pending state에 저장하지 않고 거부해요. 승인된 action write도 같은 검사를 다시 수행하고, 최종 파일 open에도 `O_NOFOLLOW`를 사용해 승인한 경로가 다른 파일로 바뀌는 symlink clobber를 막아요. 승인으로 새 target directory를 만들 때는 `0700`으로 만들고, 이미 있던 directory의 권한은 임의로 바꾸지 않아요. 승인으로 생성/수정된 target file은 기존 파일 권한이 넓어도 `0600`으로 고정해 assistant가 쓴 내용이 group/world readable 상태로 남지 않게 해요.

## 상태 백업/내보내기

`.viser` 상태를 하나의 redacted JSON artifact로 내보낼 수 있어요. 장기 메모리, 세션, 예약 작업, access/action 상태처럼 운영에 필요한 파일을 담고, config 안의 token/secret/password처럼 보이는 값은 `[REDACTED]`로 가려요. Storage file content 안의 `TOKEN=...`, JSON `apiKey`, Telegram bot token, `Bearer ...`, `Bot ...`, `sk-...`, access pairing `"code": "ABCDEF12"`, legacy `pair:ABCDEF12` source 형태도 내보내기 전에 redaction해요.

```bash
node src/index.ts backup
node src/index.ts backup --output ./viser-backup.json
npm run backup
node src/index.ts compact-backups
node src/index.ts compact-backups --fix-permissions
node src/index.ts compact-backups --delete --force
```

기본 출력 위치는 `.viser/backups/viser-backup-<timestamp>.json`이에요. backup artifact는 `0600` 권한으로 생성되고, 기존 `.viser/backups/`, `.viser/repairs/`, `.viser/actions/backups/`, `.viser/logs/`, transient `.viser/npm-cache/`, session/memory compact backup artifact, atomic write temp file, symlink는 내보내지 않아요. 기존 output target도 `lstat`으로 검사해 symlink/broken symlink/non-file을 안전한 missing file처럼 취급하지 않고, `--force`는 symlink target을 따라 외부 파일을 덮어쓰지 않고 symlink 자체만 private backup artifact로 교체해요. 제외 디렉터리는 내부까지 재귀 탐색하지 않아서 오래된 로그/백업/cache tree가 크거나 접근 불가해도 active state export를 막지 않아요. `.viser` storage root 자체나 assistant workdir 아래 storage parent component가 symlink면 storage 밖 파일을 snapshot하지 않도록 backup을 거부해요. 각 파일 content도 최종 read 때 `O_NOFOLLOW` handle로 다시 열어 검사 이후 symlink로 바뀐 파일을 따라가지 않아요. service log는 복구에 필요한 상태가 아니라 provider 출력/운영 흔적을 담을 수 있으므로 기본 backup에서 제외하고, 필요한 경우 `node src/index.ts service logs`로 별도 확인해요. report의 `redacted files:` 항목은 content redaction이 적용된 파일을 보여줘요. 이 artifact는 자동 restore용이 아니라 사람이 검토한 뒤 필요한 파일만 `.viser`로 되돌리는 복구 스냅샷이에요.

`compact-backups`는 `.viser/memory/*.bak.jsonl`와 `.viser/sessions/*.bak` 같은 compact 원본 백업만 나열해요. 기본은 read-only 목록이고, 권한 복구는 `--fix-permissions`, 삭제는 `--delete --force`를 명시해야 해요. Symlink나 non-file artifact는 자동 삭제하지 않고 warning으로 남겨요. 삭제도 regular private file 검증을 다시 거친 artifact만 제거하므로, 목록 조회 뒤 대상이 symlink/non-file로 바뀌면 조용히 따라가서 지우지 않아요. `.viser`, `.viser/memory`, `.viser/sessions` 같은 inventory 대상 디렉터리 자체나 assistant workdir 아래 parent component가 symlink면 그 안을 훑지 않고 warning만 표시해 storage 밖 compact backup을 목록/권한복구/삭제 대상으로 삼지 않아요.

## 보안/운영 Audit

`readiness`가 “실행 가능한가”를 본다면, `audit`은 “이 설정을 켜 둬도 안전한가”를 봐요.

```bash
node src/index.ts audit
npm run audit
```

현재 audit은 다음 위험을 탐지해요.

- default/fallback provider 설정 오류
- `template` provider에 `{prompt}`가 없는 설정
- GPT/Codex·Gemini·Claude 핵심 provider route가 `codex`/`gemini`/`claude` local CLI가 아닌 경우
- provider cwd/command path가 missing/non-directory/non-executable/symlink이거나 assistant workdir 밖에 있는 경우
- Telegram/Discord token을 `viser.config.json`에 직접 저장한 경우
- `.env`가 symlink path이거나 `.env`/private state 파일 권한이 group/world readable인 경우
- 활성 `.env` 또는 provider env에 GPT/Claude/Gemini model API key 변수가 들어간 경우
- messenger가 켜져 있는데 access control이 꺼져 있거나 `open`인 경우
- 승인 기반 action backup 비활성화/너무 넓은 write root
- workspace 아래 tools read root/action write root가 symlink component를 통해 외부 tree로 이어지는 경우
- shell tool allowlist에 `rm`, `sudo`, `curl`, `node`, `npm` 같은 위험 명령이 들어간 경우
- storage/memory/scheduler/jobs/access/actions 경로가 assistant workdir 밖에 있는 경우
- scheduler tick이 너무 공격적인 경우
- 공개 배포용 package metadata/license/creator 표기 누락
- `.gitignore`/`.npmignore`가 `.env`, `.viser/`, `.omx/`, local config를 제외하지 못하는 경우
- 공개 예제 `.env.example` 또는 `config/viser.config.example.json` provider env에 GPT/Claude/Gemini model API key 변수가 남은 경우
- 공개 텍스트 파일에 로컬 home path, private workspace 경로 조각, 개인 messenger handle, 개인 memory fixture, token/API key/private key처럼 보이는 민감한 식별자가 남은 경우

공개 GitHub 업로드 전에는 아래 순서로 확인해요.

```bash
npm run release:audit
node src/index.ts release-evidence
node src/index.ts release-evidence --live --probe-all-providers
node src/index.ts release-evidence --strict --live --probe-all-providers
npm test
npm run typecheck
npm pack --dry-run
```

`release-evidence`는 `verify`/audit/package allowlist를 요약한 safe-to-paste 공개 릴리스 증거 보고서를 만들어요. 이 보고서는 로컬 workspace/home path, token-like 값, 이메일/메신저 handle을 redaction하고, 프로젝트 이름 `Viser`, 제작자 `KMokky`, GPT/Codex·Gemini·Claude provider가 정확한 local CLI command basename(`codex`, `gemini`, `claude`)을 쓰는지, Telegram/Discord connector, prompt guard, 공개 예제의 model API key 변수 배제, package `private=false`/MIT/license/files allowlist 상태를 한 화면에 보여줘요. 또한 `Goal completion audit`은 공개 릴리스 준비 상태와 별도로 전체 사용자 목표가 현재 증거로 `PROVEN`인지 `UNPROVEN`인지 표시하고, `Objective evidence matrix` 섹션에서 assistant core, identity, messenger, local CLI/no-model-API, build log, prompt security, open-source privacy 요구사항별 증거와 남은 strict live proof 명령을 함께 보여줘요. `--live --probe-all-providers`를 붙이면 같은 보고서에 provider runtime proof와 Telegram/Discord live token proof check를 안전하게 요약해 공개 전 “정말 로컬 CLI와 외부 메신저 token이 응답 가능한가”를 증명할 수 있어요. 이때 구성된 provider command가 설치되어 있지 않으면 누락된 provider도 `Runtime/live proof checks`에 warn/fail과 redacted `next:` 복구 지침으로 표시되어, `provider-guide <id> --probe`나 token env 설정으로 바로 복구할 수 있어요. 단, Telegram/Discord가 token 없이 disabled 상태인 것은 live token accepted로 보지 않고 completion audit/matrix의 `remaining proof`에 `TELEGRAM_BOT_TOKEN`/`DISCORD_BOT_TOKEN` 설정 안내와 함께 남겨요. Bot username 같은 connector identity는 `token accepted` 수준으로 축약돼요. `--strict`는 보고서를 출력한 뒤 public release gate가 막히거나 `Goal completion audit`이 `PROVEN`이 아니면 exit code 1로 종료하므로, 실제 메신저 token과 로그인된 provider CLI 증거를 붙인 최종 공개 전 gate에 써요. `--json`을 붙이면 GitHub issue/릴리스 자동화에 넣기 쉬운 machine-readable artifact를 출력해요.

`LICENSE`는 MIT로 제공되고, 공개 표기는 프로젝트 이름 `Viser`와 제작자 `KMokky`로 제한해요. 실제 token은 `.env`/shell에만 두고, `.viser/` runtime state와 `.omx/` orchestration state는 GitHub/npm 공개 대상에서 제외해야 해요. 보안 이슈 제보 지침은 `SECURITY.md`에 있어요.

## Telegram 연결

1. BotFather에서 Telegram 봇 토큰을 만들어요.
2. 환경변수를 설정해요.
3. pairing code를 만들어요.
4. 브리지를 실행하고, Telegram chat에서 `/pair CODE`를 보내요.

```bash
export TELEGRAM_BOT_TOKEN="123:abc"
node src/index.ts pair-code telegram <nickname>
node src/index.ts telegram
```

`access.defaultPolicy` 기본값은 `pairing`이라, `connectors.telegram.allowedChatIds/defaultChatIds`나 `.viser/access`에 등록되지 않은 chat에는 응답하지 않아요. `allowedChatIds`와 `defaultChatIds`는 둘 다 Telegram static allowlist로 쓰이므로 기본 delivery chat을 지정한 뒤 별도 allowlist를 추가해도 inbound 응답 경계가 일관되게 유지돼요. `connectors.telegram.maxMessagesPerMinute` 기본값은 20이고, chat별 1분 rolling window에서 초과 메시지는 provider CLI를 호출하지 않고 rate-limit 안내만 돌려줘요. `connectors.telegram.maxInputChars` 기본값은 4000이라 oversized chat input도 provider prompt 구성 전에 거부돼요.

Telegram bridge는 long-polling 오류나 개별 메시지 전송 실패가 나도 gateway 전체를 즉시 죽이지 않고 오류를 기록한 뒤 다음 polling 주기로 계속 진행해요. Bot API fetch는 기본 timeout을 적용해 네트워크가 멈춘 상태에서 무기한 대기하지 않으며, `getUpdates` long polling은 Telegram timeout보다 약간 긴 margin을 둬 정상 long poll은 허용해요.

## Discord 연결

1. Discord Developer Portal에서 Bot token을 만들어요.
2. 봇에 `MESSAGE CONTENT INTENT`를 켜고 서버에 초대해요.
3. pairing code를 만들어요.
4. 환경변수를 설정하고 브리지를 실행한 뒤, Discord DM 또는 서버 채널에서 `/pair CODE`를 보내요. 서버 채널에서는 `!viser /pair CODE`처럼 prefix가 필요해요.

```bash
export DISCORD_BOT_TOKEN="..."
node src/index.ts pair-code discord <nickname>
node src/index.ts discord
```

서버 채널에서는 기본 prefix `!viser` 또는 봇 멘션으로 호출해요. DM에서는 pairing 이후 일반 메시지에 바로 응답해요. `connectors.discord.allowedChannelIds`와 `connectors.discord.defaultChannelIds`는 둘 다 access static allowlist로 쓰이므로, 일부 채널을 allowlist하면서 기본 delivery channel도 함께 지정해도 inbound 응답 경계가 일관되게 유지돼요. `connectors.discord.maxMessagesPerMinute` 기본값은 20이고, channel별 1분 rolling window에서 초과 메시지는 provider CLI를 호출하지 않고 rate-limit 안내만 돌려줘요. `connectors.discord.maxInputChars` 기본값은 4000이라 oversized channel input도 provider prompt 구성 전에 거부돼요.

Discord gateway는 socket close/error뿐 아니라 message 처리 중 발생한 async 오류도 reconnect loop로 넘겨 unhandled rejection으로 조용히 새지 않게 해요. Discord REST message send도 fetch timeout과 token redaction을 적용해 stuck network나 API 오류가 장기 실행 loop를 멈추지 않게 해요.

## Access 관리

```bash
node src/index.ts pair-code telegram <nickname>
node src/index.ts pair-code discord <nickname>
node src/index.ts access
node src/index.ts allow telegram <chat-id> "Trusted user"
node src/index.ts revoke telegram <chat-id>
```

기본 정책은 `pairing`이에요. Pairing code는 성공적으로 사용되면 즉시 access state에서 제거되고, 만료되었거나 이미 사용된 code도 새 code 생성/ pairing 시 정리돼요. 승인된 peer의 `source`에는 code 값을 남기지 않고 `pair`만 저장하므로, `.viser/access/access.json`에 임시 credential이 오래 남지 않아요. `open`으로 바꾸면 토큰을 아는 모든 chat/channel에 응답할 수 있으므로 권장하지 않아요.

## Scheduler / Gateway

`scheduler`는 `.viser/scheduler/tasks.json`에 저장된 예약 작업을 foreground loop로 실행해요. CLI에서 만든 작업은 콘솔로 출력되고, Telegram/Discord 대화에서 만든 작업은 token이 있을 때 해당 채팅/채널로 결과를 돌려보낼 수 있어요.

```bash
node src/index.ts schedule every 1h "daily brief"
node src/index.ts schedules
node src/index.ts scheduler
npm run scheduler:raw   # 고급/디버그용: provider proof 없이 scheduler loop 시작
```

`scheduler` foreground loop도 live provider-proof `preflight`를 먼저 통과해야 시작해요. 실행 중 provider fallback이 모두 실패하면 해당 provider failure report를 성공 결과로 배송하지 않고 failed run으로 기록해 `lastError`/run log에 남겨요. 반복 작업은 다음 주기로 넘어가고, 1회 작업은 실패 기록 후 비활성화하지 않고 1분부터 최대 1시간까지 exponential backoff로 재시도해요. Telegram/Discord delivery 실패도 같은 방식으로 재시도되어 1회 예약 결과를 잃을 가능성을 줄여요. tick 처리 중 storage/JSON 같은 예외가 나도 loop 밖으로 던져 gateway 전체를 죽이지 않고 오류를 기록한 뒤 다음 tick에서 재시도해요. `.viser/scheduler/runs.jsonl`은 디버그용 run history라 provider 출력 전체를 무제한 저장하지 않고 bounded preview와 truncation note만 저장해 장기 실행 중 상태 파일이 과도하게 커지는 일을 줄여요. 실제 delivery에는 원래 provider output을 그대로 사용해요. 이미 provider 상태를 별도로 확인한 디버그 상황에서만 `node src/index.ts scheduler --unsafe-skip-gate` 또는 `npm run scheduler:raw`를 쓰면 돼요.

## Durable Job Queue

`jobs`는 즉시 실행하지 않을 1회성 provider 작업을 `.viser/jobs/jobs.json`에 저장해요. `/team`/`/swarm`은 같은 queue 위에 planner, executor, verifier 역할 job 3개와 이 셋이 끝난 뒤에만 실행되는 synthesizer job 1개를 role-scoped session으로 쌓아 작은 local team run을 만들어요. `/fix-loop`는 plan→implement→review→fix→verify→synthesize lane을 순차 dependency로 묶고, `/supervise`는 safety intake, repo scout, implementation planner, approval proposal stager, verifier, release auditor, final handoff lane을 만들어 장기 작업을 job-worker/gateway/service-run에서 계속 처리할 수 있는 supervisor workflow로 저장해요. 각 lane은 일반 logged-in local CLI provider job이라 API key나 추가 과금이 없고, 숨겨진 도구/승인 실행 권한도 없어요. Queue는 `dependsOn`을 이해하므로 `run-jobs 4 --parallel 3`처럼 실행하면 planner/executor/verifier wave가 먼저 돌고, 완료 후 synthesizer lane이 다음 wave로 이어져요. Synthesizer/supervisor handoff 실행 prompt에는 완료된 dependency job의 status/session/prompt preview/result artifact가 bounded context로 붙어서 최종 통합 job이 실제 선행 lane 결과를 보고 handoff를 만들 수 있어요. Dependency context는 provider-bound `assistant.maxInputChars` 안에 들어가도록 실행 직전에 한 번 더 절단되므로, 큰 선행 결과 때문에 후속 lane이 입력 제한에 걸려 바로 실패하는 일을 줄여요. Supervisor의 proposal-stager도 실제 파일을 직접 바꾸지 않고 필요한 mutation을 `/propose write-file`/`append-file` 같은 승인 workflow로 내보내도록 제한돼요. 수동 실행에서는 `--parallel <1-6>`으로 여러 provider job을 동시에 처리할 수 있고, 상시 `job-worker`/`gateway`/`service-run` 경로는 `jobs.concurrency` 설정값으로 tick당 처리 lane 수를 제어해요.

```bash
node src/index.ts enqueue "이번 주 일정 정리"
node src/index.ts team "v0.1.0 공개 릴리스 점검"
node src/index.ts fix-loop "릴리스 체크리스트를 검토하고 고쳐줘"
node src/index.ts supervise "릴리스 목표를 끝까지 점검하고 승인 제안까지 만들어줘"
node src/index.ts jobs pending
node src/index.ts run-jobs 1
node src/index.ts run-jobs 4 --parallel 3
node src/index.ts run-jobs 6 --parallel 3
npm run run-jobs:raw   # 고급/디버그용: provider proof 없이 pending job 소비
node src/index.ts job-worker --parallel 2
npm run job-worker:raw   # 고급/디버그용: provider proof 없이 job worker loop 시작
node src/index.ts jobs done
node src/index.ts cancel-job <id>
node src/index.ts delete-job <id>
```

대화 중에는 `/enqueue`, `/team`, `/swarm`, `/fix-loop`, `/jobs`, `/run-jobs`, `/cancel-job`, `/delete-job`을 사용할 수 있어요. CLI `run-jobs`는 pending job이 있을 때 live provider-proof `preflight`를 먼저 통과해야 job을 소비해요. 이렇게 provider 로그인/샌드박스 문제가 있는 상태에서 pending job을 곧바로 실행해버리는 일을 막아요. 많은 독립 job이나 team lane을 빨리 처리해야 할 때는 `node src/index.ts run-jobs 6 --parallel 3` 또는 `/run-jobs 6 --parallel 3`처럼 최대 6개 worker lane까지만 명시적으로 열어요. Dependency가 아직 끝나지 않은 pending job은 ready 상태로 보지 않고, dependency가 `done`이 되면 같은 `run-jobs` 호출의 다음 wave나 다음 worker tick에서 실행돼요. `/team`은 planner/executor/verifier를 병렬로 돌린 뒤 synthesis lane에 artifact를 주입하고, `/fix-loop`은 planner→implementer→reviewer→fixer→final-verifier→synthesizer를 dependency chain으로 실행해 앞 단계 결과를 다음 단계가 보게 해요. 상시 worker는 config의 `jobs.concurrency`를 사용하고, foreground 디버그 실행에서는 `node src/index.ts job-worker --parallel 2`처럼 일시 override할 수 있어요. 결과 상태 파일 write는 job 결과를 모은 뒤 순차 반영해 병렬 provider 호출이 job store를 덮어쓰지 않게 했어요. service/gateway/job-worker가 이미 실행 중이면 `/enqueue`, `/team`, `/fix-loop` 직후 worker가 먼저 job을 처리할 수 있으므로, 수동 `run-jobs`가 `No pending jobs`를 보여줄 때는 `node src/index.ts jobs done`에서 완료 결과를 확인하면 돼요. 완료/실패/취소된 terminal job record는 `node src/index.ts delete-job <id>`로 정리할 수 있고, pending/running job은 먼저 `cancel-job`으로 멈춘 뒤 삭제해요. raw/worker 실행 중 provider fallback이 모두 실패했다는 assistant report가 돌아와도 job을 영구 `failed`로 잃지 않고 `pending`으로 되돌리며 `attempts`, `last error`, `next attempt`를 남겨요. 재시도는 1분부터 시작해 최대 1시간까지 exponential backoff를 적용하므로 provider outage 중 worker가 같은 job을 매 tick 폭주 실행하지 않아요. provider가 복구된 뒤 다시 `/run-jobs`나 worker tick에서 재시도할 수 있어요. 이미 provider 상태를 별도로 확인한 고급/디버그 상황에서만 `node src/index.ts run-jobs [limit] --unsafe-skip-gate` 또는 `npm run run-jobs:raw`를 쓰면 돼요.

`job-worker`는 foreground loop로 pending job을 계속 처리해요. 시작 시 이전 worker가 남긴 `running` job은 `pending`으로 되돌려 재처리 가능하게 해요. startup recovery나 tick 처리 중 storage/JSON 예외가 나도 오류를 기록하고 다음 tick에서 재시도해 gateway 전체 장애로 번지는 일을 줄여요. 장기 실행 launchd 로그가 불필요하게 커지지 않도록 worker loop는 idle 상태의 `No pending jobs` tick 로그를 반복 출력하지 않고, 실제 job 실행/완료/실패와 오류만 기록해요. `jobs.concurrency`가 2 이상이면 한 tick에서 여러 pending job을 provider 호출 단계까지 병렬 처리하고, 상태 반영은 순차적으로 마무리해요. 이 loop도 live provider-proof `preflight`를 통과해야 시작하고, raw 디버그 실행은 `node src/index.ts job-worker --unsafe-skip-gate` 또는 `npm run job-worker:raw`로 분리했어요. `gateway`를 실행하면 scheduler와 함께 job worker도 같이 실행돼요.

macOS에서는 launchd plist를, Linux에서는 systemd `--user` unit을, Windows에서는 Task Scheduler XML과 PowerShell runner를 생성할 수 있어요. 실제 설치/등록은 OS 상태를 바꾸므로 먼저 workspace 아래 artifact를 쓰고 내용을 확인할 수 있고, 준비가 끝나면 같은 `service install`/`reinstall`/`uninstall`/`status`/`start`/`stop`/`restart` 명령이 현재 OS에 맞는 native service manager로 자동 dispatch돼요.

```bash
node src/index.ts service write-plist
node src/index.ts service write-systemd
node src/index.ts service write-windows
node src/index.ts service check
node src/index.ts service install
node src/index.ts service reinstall
node src/index.ts service status
node src/index.ts service restart
node src/index.ts service logs
node src/index.ts service health
node src/index.ts service trim-logs
node src/index.ts service uninstall
```

`service check`는 LaunchAgent, systemd unit, Windows scheduled task를 쓰거나 시작하지 않고 `service-run --live --probe-all-providers`와 같은 live provider-proof gate를 먼저 검증해요. `service install`은 현재 OS에 따라 macOS에서는 `~/Library/LaunchAgents`에 plist를 복사하고 `launchctl bootstrap`을 실행하고, Linux에서는 `~/.config/systemd/user`에 unit을 복사한 뒤 `systemctl --user daemon-reload`와 `enable --now`를 실행하며, Windows에서는 workspace Task Scheduler XML/PowerShell runner를 만든 뒤 `Register-ScheduledTask`와 `Start-ScheduledTask`를 PowerShell로 실행해요. 이 gate가 통과하지 않으면 어느 OS에서도 service artifact를 native registration 위치로 복사하거나 등록/시작하지 않아요. OS 상태를 바꾸는 명령이므로 실제 설치 전에는 macOS는 `service write-plist`, Linux는 `service write-systemd`, Windows는 `service write-windows`, 공통으로 `service check`를 먼저 확인하는 걸 권장해요. `service write-systemd`는 `.viser/systemd/com.mokky.viser.service`를 만들고 수동 등록 절차도 함께 안내하며, `service write-windows`는 `.viser/windows/com.mokky.viser.task.xml`과 `.viser/windows/com.mokky.viser.ps1` runner를 만들고 수동 등록/삭제 절차도 안내해요. systemd unit과 Windows runner도 `service-run --live --probe-all-providers`를 실행하고, 정상 gate-block exit은 restart loop로 만들지 않도록 OS별 restart 정책을 보수적으로 둬요. `service reinstall`은 현재 OS의 service manager에서 기존 등록을 제거/비활성화한 뒤 같은 gate를 재사용해 설치를 반복하고, `service status`/`start`/`stop`/`restart`도 launchd/systemd/Task Scheduler에 맞게 dispatch돼요. Linux에서 logout 이후에도 계속 실행하려면 user lingering은 여전히 관리자가 명시적으로 `loginctl enable-linger "$USER"`를 결정해야 해요. `service logs [lines]`로 `.viser/logs/gateway.out.log`와 `.viser/logs/gateway.err.log`의 최근 출력을 볼 수 있어요. `service health`는 provider 호출 없이 현재 config의 localhost dashboard listener와 `dashboard.v1` schema/capability contract를 확인해, launchd/systemd/Task Scheduler status나 로그만으로 놓칠 수 있는 오래된 프로세스/죽은 포트를 잡아요. `service trim-logs [maxBytes] [keepBytes]`는 gateway를 재시작하지 않고 같은 symlink-safe/private log trim 정책을 즉시 적용해요. `service write-plist`, `service write-systemd`, `service write-windows`는 service manager가 쓰기 전에 log directory를 `0700`, log/plist/unit/task/runner files를 `0600`으로 준비하고 symlinked service/log paths와 storage parent component symlink를 거부해요. launchd/systemd `PATH`에는 Homebrew/npm-global/system 경로를 포함하되 Codex 세션 temp path, `/tmp`, sandbox bootstrap처럼 재부팅 뒤 사라질 수 있는 transient path는 제외해요. Windows runner는 현재 사용자 `PATH`, `VISER_CONFIG`, `VISER_ENV`를 PowerShell 환경 변수로 고정한 뒤 stdout/stderr를 같은 `.viser/logs` 파일에 append해요. `service install`도 workspace plist/unit source, native registration directory, 대상 파일이 symlink면 설치를 거부하고, source artifact를 `O_NOFOLLOW`로 읽은 뒤 native registration 파일을 private atomic write로 `0600` 저장해요. LaunchAgent/systemd install/uninstall은 `~/Library`나 `~/.config/systemd/user` 같은 HOME 아래 parent component symlink도 거부하고, `service uninstall`도 native registration target이 symlink면 삭제를 거부해 외부 파일을 지우지 않아요. `service logs`도 symlink log file이나 symlinked storage parent를 따라 읽지 않고, 기존 log file은 읽을 때 `0600`으로 고정하며, token/API key처럼 보이는 값을 `[REDACTED]`로 가려요.
생성되는 launchd plist는 `node src/index.ts service-run --live --probe-all-providers`를 실행해요. `service-run`은 시작할 때 stdout/stderr log가 너무 커져 있으면 symlink를 따르지 않는 private file handle로 마지막 tail만 남겨 trim한 뒤 full `preflight` gate, live connector token validation, provider runtime proof를 실행해요. Gate를 통과하면 gateway를 시작하고, gate가 막히면 report를 남긴 뒤 exit code 0으로 종료해 launchd restart loop를 피하게 해요. 실제 gateway crash처럼 비정상 종료된 경우에는 launchd가 다시 시작할 수 있도록 `KeepAlive.SuccessfulExit=false`로 생성돼요.
`--env ./prod.env` 또는 `VISER_ENV=...`를 사용해 service plist를 생성하면, plist에도 절대경로 `VISER_ENV`가 기록되어 launchd 재시작 후에도 같은 env 파일을 읽어요. `VISER_CONFIG`는 실제로 로드한 config file이 있을 때만 plist에 고정해요. Defaults-only 실행에서는 존재하지 않는 `viser.config.json`을 explicit config처럼 주입하지 않아 service-run이 잘못된 missing config로 실패하지 않게 해요.

`gateway`는 scheduler, job worker, token이 있는 connector를 한 프로세스에서 함께 실행하는 foreground control plane이에요.

```bash
export TELEGRAM_BOT_TOKEN="..."
export DISCORD_BOT_TOKEN="..."
node src/index.ts jobs
node src/index.ts gateway --dry-run
node src/index.ts gateway --dry-run --strict
node src/index.ts gateway --web-dashboard
node src/index.ts gateway --strict --live --probe-all-providers
npm run gateway
npm run gateway:raw   # 고급/디버그용: node src/index.ts gateway --unsafe-skip-gate
node src/index.ts service-run --live --probe-all-providers
```

`gateway --dry-run`은 readiness만 출력하고 종료해요. `gateway --dry-run --strict`는 gateway를 시작하지 않고 full `preflight` gate를 실행해요. 이제 직접 `node src/index.ts gateway`도 live provider-proof `preflight`를 기본으로 통과해야 foreground gateway를 시작해요. `gateway --web-dashboard`를 붙이거나 `webDashboard.enabled=true`를 설정하면 같은 gateway 프로세스에서 localhost read-only dashboard도 같이 실행돼요. `gateway --strict --live --probe-all-providers`는 같은 안전 동작을 명시적으로 표현하는 호환 명령이에요. gate 없는 원시 foreground 실행은 고급 디버그용 `node src/index.ts gateway --unsafe-skip-gate` 또는 `npm run gateway:raw`로만 분리했어요.

`readiness`는 Node 22.6+ 런타임, Node 기능, provider CLI, persistent storage 쓰기 가능 여부, skills/access/scheduler/actions, local shell tool command 설치 상태, connector token 상태를 확인해요. Storage 쓰기 probe는 private directory를 확인한 뒤 `O_EXCL | O_NOFOLLOW` 파일 handle로 새 probe file만 만들어 기존/symlink path를 덮어쓰지 않고, cleanup도 regular private file 검증을 거쳐 수행해요. Shell tool readiness는 `tools.allowedReadRoots[0]` 기준 상대 command와 PATH command를 runtime lookup에 맞춰 확인하고, allowlist command가 없거나 첫 executable PATH candidate가 directory/symlink처럼 runtime에서 실행될 수 없는 형태면 launch 전 warning으로 설치/설정 누락을 보여줘요. `--live`는 설정된 Telegram/Discord token을 실제 API로 검증하고, token이 설정됐지만 거부되면 launch blocker로 처리해요. Live token 검증 fetch도 timeout을 적용해 launch gate가 네트워크 문제로 무기한 멈추지 않아요. token 검증 실패 detail에 transport/proxy 오류가 섞여도 실제 token 문자열은 redacted 처리돼요. token이 없고 connector도 비활성화되어 있으면 의도적으로 꺼진 상태로 보고 pass 처리해, 메신저를 쓰지 않는 로컬/서비스 launch가 불필요한 token warning에 묶이지 않게 해요. `--probe-providers`를 붙이면 default provider를 실제로 한 번 호출해 로그인/샌드박스 문제와 prompt wiring 문제까지 잡고, `--probe-all-providers`는 설정된 모든 provider를 probe해서 default가 실패해도 fallback으로 바로 실행 가능한지까지 보여줘요. Provider runtime proof는 probe 응답에 `VISER_OK` sentinel이 실제로 포함될 때만 통과해요.

`config-check`는 사용자가 직접 편집한 `viser.config.json`의 shape를 검증해요. 잘못된 배열/숫자/boolean/provider prompt mode는 런타임 TypeError가 나기 전에 `Invalid Viser config` 또는 `Viser config: INVALID`로 잡아요. `viser.config.json`이나 `VISER_CONFIG`로 지정한 config file도 `O_NOFOLLOW`로 읽고 현재 workspace/baseDir 아래 symlink parent component를 거부해 symlinked config path가 외부 설정을 암묵적으로 끌어오지 않게 해요. Config discovery도 `lstat`으로 symlink 자체를 확인하므로 broken symlink config를 “없는 파일”로 조용히 건너뛰지 않아요. 사용자가 `--config` 또는 `VISER_CONFIG`를 명시한 경우에는 파일이 없을 때 기본 설정으로 fallback하지 않고 즉시 실패해 잘못된 launch 설정을 조기에 드러내요.

```bash
node src/index.ts config-check
npm run config-check
```

`state-check`는 `.viser` 아래의 persistent JSON/JSONL state를 읽어 깨진 파일을 찾아요. 단순 JSON 파싱뿐 아니라 scheduler task, queued job, access peer/code, pending action의 필수 필드 shape와 private state 파일 권한도 확인해 런타임 tick에서 반복 실패하거나 개인 대화/메모리/작업 상태가 넓게 노출되는 상태를 미리 잡아요. 큰 session JSONL은 review warning으로 보고하고, `--repair --force`를 명시하면 원본 backup을 남긴 뒤 최신 1000개 JSONL message만 유지할 수 있어요. Access state가 valid JSON이어도 만료/사용된 pairing code나 과거 `pair:CODE` peer source를 담고 있으면 review warning으로 보고하고, `--repair --force`로 peer allowlist는 유지한 채 stale code와 legacy source만 정리할 수 있어요. Approved/rejected action state에 과거 write content가 남아 있으면 pending action은 유지하면서 결정 완료된 action content만 `[N bytes]` marker로 줄이는 repair도 제공해요. State 파일이나 state directory가 symlink면 storage 밖 파일을 읽거나 repair로 덮어쓰지 않도록 fail로 보고하고 자동 repair 대상에서 제외해요. `.viser` storage root가 symlink인 경우에도 state-check는 즉시 fail로 멈춰 바깥 경로의 세션/상태 파일을 검증 대상으로 삼지 않아요. state-check 자체도 assistant workdir 기준 parent component symlink를 검사해 custom state path가 symlinked parent를 통해 storage 밖 tree를 훑거나 repair하지 않게 해요. 상태 파일이 아직 없는 custom state directory도 parent symlink 검사를 먼저 거치므로, “아직 state가 없어서 건강함”으로 잘못 통과하지 않아요. 런타임의 memory/session/jobs/scheduler/access/actions store도 state JSON/JSONL을 읽기 전에 private directory와 regular file을 확인하고 file read에는 `O_NOFOLLOW`를 사용해, raw 실행이나 검사 누락 상황에서도 symlink state를 prompt나 작업 상태로 가져오지 않아요. Viser가 JSON/JSONL snapshot state를 새로 쓸 때는 같은 디렉터리의 private temp file에 먼저 쓴 뒤 rename하는 atomic private write를 사용해 프로세스 중단 중 partial write가 남을 가능성을 줄여요. append-only JSONL state/session/audit/event 파일도 `O_NOFOLLOW`로 열어 symlink를 따라가지 않고, private state directory는 `0700`, private state file은 `0600`으로 고정해요. 현재 workspace 아래 private path는 부모 component가 symlink여도 거부해 `.viser -> outside` 같은 우회 쓰기를 막아요. `--repair`는 기본 dry-run으로 어떤 파일을 백업/재작성할지 보여주고, 실제 적용은 `--repair --force`를 명시해야 해요. repair는 백업 직전에 source state file을 다시 `O_NOFOLLOW`로 읽어서 검사 이후 symlink로 바뀐 파일을 따라가지 않고, 백업/복구 파일도 `0600`으로 생성돼요.

```bash
node src/index.ts state-check
node src/index.ts state-check --repair
node src/index.ts state-check --repair --force
```

`preflight`는 **장기 프로세스를 시작하지 않는** launch gate예요. `verify`와 같은 로컬 gate를 돌린 뒤 종료하므로, 통과 후 foreground gateway로 들어가는 명령과 구분해서 안전하게 쓸 수 있어요. 같은 흐름은 `gateway --dry-run --strict`로도 확인할 수 있고, 직접 `gateway` 실행은 live connector token과 provider 로그인을 증명한 뒤에만 foreground gateway를 시작해요. 마지막 단일 판정이 필요하면 `node src/index.ts launch-status`를 쓰면 돼요.

```bash
node src/index.ts preflight
node src/index.ts preflight --live --probe-all-providers
node src/index.ts preflight --strict --live --probe-all-providers
```

`smoke`는 외부 provider CLI를 부르지 않고 임시 디렉터리와 내장 fake provider로 status, skills, provider history, prompt guard의 provider handoff 전 차단, memory/profile, read-only tools, approval-gated write, approval-gated Telegram/Discord outbound message, jobs, scheduler, access pairing, Telegram/Discord handler→assistant→mocked send path, backup을 end-to-end로 검증해요. `release-evidence`는 이 local smoke check 목록도 포함해서 prompt guard와 Telegram/Discord 소스 존재뿐 아니라 provider 호출 전 보안/메신저 adapter 경로가 작동한다는 증거를 보여줘요. `--keep`을 붙이면 임시 artifact를 남겨 사람이 확인할 수 있어요.

```bash
node src/index.ts smoke
node src/index.ts smoke --keep
```

`verify`는 `readiness`, `audit`, `smoke`를 한 번에 묶은 사용자용 최종 점검이에요. provider probe를 요청하면 응답한 provider와 fallback runtime proof도 함께 보여주고, 실패한 provider별로 sandbox/interactive login/command missing/timeout 같은 복구 조언을 바로 출력해요. Recommended commands에는 `next-steps --live --probe-all-providers`도 포함해 warning/blocker가 남았을 때 즉시 runbook으로 넘어갈 수 있어요. `launch-status`가 READY여도 warning이 남아 있으면 같은 next-steps 명령으로 connector/provider/local tools 복구를 먼저 확인할 수 있어요. `--strict`를 붙이면 blocker가 있을 때 exit code 1로 끝나 CI/service 설치 전 gate로 쓸 수 있어요.

일반 `ask`/`chat` 요청도 모든 provider fallback이 실패하면 `Provider recovery` 섹션을 함께 출력해요. 그래서 대화 중 실패해도 다시 `launch-status`, `verify --live --probe-all-providers`, provider별 manual smoke test로 바로 복구 루프에 들어갈 수 있어요.

```bash
node src/index.ts verify
node src/index.ts verify --strict
node src/index.ts verify --probe-providers
node src/index.ts verify --live --probe-all-providers
node src/index.ts release-evidence
node src/index.ts release-evidence --json
node src/index.ts release-evidence --live --probe-all-providers
node src/index.ts release-evidence --strict --live --probe-all-providers
```

`next-steps`는 현재 readiness/audit 결과를 바탕으로 “무엇을 고치고 어떤 명령으로 실행할지”를 한 화면 runbook으로 보여줘요. provider probe를 붙이면 실패 원인별로 normal terminal smoke test, interactive login, token/pairing, starter skills 설치, local tools command/PATH 복구, backup/audit 행동을 같이 정리해요. `--live`를 붙였을 때 Telegram/Discord token이 실제 API에서 거부되면 어떤 token env를 고쳐야 하는지도 Messaging runbook에 바로 표시해요.

```bash
node src/index.ts next-steps
node src/index.ts next-steps --live --probe-all-providers
```

## 설정 파일

`node src/index.ts setup`은 `viser.config.json`, secret 없는 `.env` 템플릿, starter skills를 만든 뒤 진단 결과와 안전한 launch 순서를 보여줘요. Starter skill 설치 경로인 `.viser/skills`는 private directory로 만들며, root나 개별 starter skill target뿐 아니라 기존 target 내부 파일/디렉터리가 symlink여도 외부 디렉터리에 복사하지 않고 setup을 중단해요. `--force` 없이 기존 starter skill을 건너뛰는 경우에도 target tree를 먼저 검사해 unsafe symlinked starter skill을 조용히 정상 상태처럼 남겨두지 않아요. 번들 starter skill도 symlink source를 거부하고, 파일 복사는 `O_NOFOLLOW` read + private atomic write로 수행해요. 특히 바로 `gateway`를 띄우라고 하지 않고, `gateway --dry-run --strict --live --probe-all-providers` 리허설과 `launch-status` 단일 verdict를 먼저 통과한 뒤 직접 `gateway` 또는 launchd의 `service-run --live --probe-all-providers` 경로를 쓰도록 안내해요. `node src/index.ts init`은 config 파일만 생성하고, 기존 `viser.config.json`이 symlink/non-file이면 `--force` 없이 정상 config처럼 skip하지 않아요. `--force`를 쓰면 symlink target을 따라 외부 파일을 덮어쓰지 않고 symlink 자체를 private regular config로 교체해요. `node src/index.ts env-init`은 `.env` 템플릿만 생성해요. 예시는 `config/viser.config.example.json`에 있어요.

Provider는 로컬 CLI 명령으로 정의해요.

```json
{
  "providers": {
    "codex": {
      "command": "codex",
      "args": ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "-"],
      "promptMode": "stdin"
    }
  }
}
```

`assistant.fallbackProviders`는 `--provider`나 `/provider`로 명시하지 않았을 때만 사용돼요. 명시 provider가 실패하면 안전하게 실패를 보고하고 다른 provider로 넘어가지 않아요. fallback provider가 설치되어 있지 않으면 readiness/next-steps가 설치·로그인 안내와 함께, 그 fallback을 쓰지 않을 경우 `assistant.fallbackProviders`에서 제거하라는 경로도 보여줘요. default/fallback 경로 밖의 provider config는 launch 준비 상태를 막지 않으므로, 예비 provider를 설정 파일에 남겨 두어도 자동 실행 경로 warning으로 처리하지 않아요.

`promptMode`:

- `stdin`: prompt를 stdin으로 전달해요.
- `template`: args 안의 `{prompt}`를 치환해요.
- `argument`: args 뒤에 prompt를 마지막 인자로 붙여요.

Provider subprocess stdout/stderr는 기본적으로 stream별 최대 1,000,000 bytes까지만 캡처해 장시간 실행 중 메모리 폭주를 막아요. Provider별로 더 작게 제한하려면 `providers.<id>.maxOutputBytes`를 양의 정수로 설정할 수 있고, 출력이 잘리면 응답이나 진단 report에 `[stdout truncated ...]` / `[stderr truncated ...]`가 붙어요.

Provider subprocess는 `process.env` 전체를 그대로 상속하지 않고, 기본적으로 `VISER_*`와 `token`/`secret`/`key`/`password`/`credential` 이름의 shell env를 제거한 뒤 실행해 messenger token이나 API key가 provider CLI에 노출되지 않게 해요. 특정 provider에 꼭 필요한 값은 `providers.<id>.env`에 명시할 수 있지만, secret-looking key는 audit warning으로 남아요.

`providers.<id>.cwd`를 쓰면 config `baseDir` 기준 절대 경로로 정규화되고, workspace 아래 symlink component나 최종 symlink cwd는 runtime/audit에서 거부해 provider가 symlink를 따라 외부 tree에서 실행되지 않게 해요. 상대 provider command(`./bin/provider` 등)를 쓰는 경우 readiness/doctor/provider-guide도 cwd 기준으로 command 존재 여부를 판단하고, manual smoke test는 `(cd <cwd> && ...)` 형태로 안내해 runtime 실행 위치와 맞춰요. Slash가 포함된 provider command path가 assistant workdir 또는 provider cwd 아래에 있으면 실행 직전에 symlink component, final symlink, non-file, non-executable 상태를 거부해 의도하지 않은 외부 executable을 따라가지 않아요. Slash 없는 provider command도 provider env의 `PATH`에서 먼저 절대 실행 경로로 확정한 뒤 spawn해서 PATH가 실행 직전에 바뀌는 문제를 줄이고, workspace/provider cwd 내부 PATH entry는 같은 nofollow 검사를 받아요. Homebrew/npm global bin처럼 project 밖 package-manager symlink는 실제 CLI 호환성을 위해 허용해요.

## 검증

```bash
npm test
npm run typecheck
npm run verify:providers
npm run launch-status
npm run gateway:check
npm run gateway
node src/index.ts config-check
node src/index.ts state-check
node src/index.ts verify
node src/index.ts preflight
node src/index.ts preflight --live --probe-all-providers
node src/index.ts smoke
node src/index.ts audit
node src/index.ts backup --output .viser/backups/verify-backup.json --force
node src/index.ts doctor
node src/index.ts env-init
node src/index.ts env-check
node src/index.ts readiness
node src/index.ts provider-guide
node src/index.ts readiness --probe-all-providers
node src/index.ts readiness --live
node src/index.ts gateway --dry-run
node src/index.ts gateway --dry-run --strict
node src/index.ts gateway --dry-run --strict --live --probe-all-providers
node src/index.ts gateway                              # live provider-proof foreground gateway
node src/index.ts gateway --strict --live --probe-all-providers   # provider가 모두 준비된 경우에만 foreground gateway 시작
node src/index.ts gateway --unsafe-skip-gate          # 고급/디버그용 raw foreground gateway
node src/index.ts service-run --live --probe-all-providers        # launchd와 같은 live provider-proof service runner
node src/index.ts next-steps --live --probe-all-providers
node src/index.ts skills
node src/index.ts tools
```

## 파일 구조

```text
src/index.ts                  CLI entrypoint
src/cli/audit.ts              security/operations configuration audit
src/cli/backup.ts             redacted state backup/export
src/cli/config-check.ts       editable config validation report
src/cli/state-health.ts       persistent state health check and repair planning
src/cli/preflight.ts          no-start launch gate over verify
src/cli/verify.ts             combined readiness/audit verification gate
src/cli/release-evidence.ts   safe-to-paste public release evidence report
src/cli/smoke.ts              local end-to-end smoke test without external provider CLIs
src/config-validation.ts      strict config shape validation before path normalization
src/core/assistant.ts         slash command, session, provider orchestration
src/core/history.ts           JSONL session storage/search/transcript
src/core/memory.ts            long-term memory store with local lexical vector retrieval
src/core/prompt-guard.ts      prompt injection detection, blocking, and untrusted data fencing
src/core/skills.ts            SKILL.md registry
src/core/plugins.ts           local plugin manifest registry
src/core/tools.ts             explicit local read-only tools
src/core/scheduler.ts         scheduled automation store and runner
src/core/jobs.ts              durable provider job queue, dependencies, team/fix-loop workflows
src/core/actions.ts           approval-gated file, app, and messenger actions
src/core/access.ts            Telegram/Discord pairing access control
src/cli/service.ts            macOS launchd, Linux systemd, Windows Task Scheduler service artifacts/control
src/cli/readiness.ts          executable readiness checklist
src/core/mcp-client-config.ts local MCP client config snippet generator
src/connectors/validate.ts    Telegram/Discord token validation
src/connectors/input-policy.ts inbound Telegram/Discord input size policy
src/connectors/rate-limit.ts  per-chat/channel connector abuse limiter
src/providers/cli-provider.ts logged-in CLI provider adapter
src/providers/guide.ts        provider login/smoke-test diagnostics
src/connectors/telegram.ts    Telegram long polling bridge
src/connectors/discord.ts     Discord Gateway bridge
src/connectors/gateway.ts     multi-connector foreground gateway
src/connectors/web-dashboard.ts localhost read-only live web dashboard + canvas/SVG overview
src/connectors/mcp-server.ts    local MCP stdio server tools surface
skills/*/SKILL.md             bundled reusable procedures
plugins/*/plugin.json         bundled local prompt plugins
tools/session_digest.py       Python helper for JSONL logs
aimake.md                     제작 과정 기록
```

## OpenClaw/Hermes 대비 남은 큰 차이

- cross-platform service는 macOS launchd, Linux systemd user unit, Windows Task Scheduler artifact와 현재 OS에 맞는 native 자동 install/reinstall/uninstall/status/start/stop/restart dispatch를 지원해요. 다만 Linux user service의 logout 후 지속 실행(`loginctl enable-linger`)처럼 관리자/사용자 정책 결정이 필요한 부분은 여전히 수동이에요.
- MCP 호환성은 local stdio tools/resources/prompts server와 `mcp-client-config` 기반 local client config export까지 확장했고, plugin ecosystem은 local `plugin.json` manifest registry와 명시적 `/plugin` 실행 경로를 제공하지만, 원격 MCP marketplace까지 포함한 완전한 생태계는 아직 아니에요.
- collaborative Canvas나 streaming voice conversation 같은 고급 UI는 아직 제한적이지만, 현재는 provider 호출 없는 터미널 dashboard, 같은 상태 모델의 JSON 출력(`dashboard --json`), gateway/service에 붙일 수 있는 localhost read-only live web dashboard(`/dashboard.events`), snapshot 기반 `<canvas>` overview와 정적 `/dashboard.canvas.svg`, 승인 기반 로컬 TTS `speak` action을 제공해요.
- 병렬 subagent orchestration은 durable job queue 기반 `/team`/`/swarm` role lanes, dependency-gated synthesizer lane, dependency artifact injection, `/fix-loop` plan→implement→review→fix→verify chain, `/supervise` safety→repo-scout→proposal→verification→release-audit handoff workflow까지 지원해요. 다만 안전을 위해 provider lane이 실제 코드 수정까지 무승인으로 반복 적용하지는 않고, mutation은 `/propose` + `/approve` 경계로 남겨요.
- 브라우저/메일 자동화는 승인 기반 `open-url`과 `mail-draft`, 캘린더 import는 승인 기반 `calendar-event` `.ics`, 로컬 desktop notification은 승인 기반 `notify`, 로컬 clipboard copy는 승인 기반 `clipboard`, 메신저 outbound는 승인 기반 `connector-message` action으로 시작했지만, 캘린더/메일 서비스 API처럼 rich external app integration은 아직 아니에요.
- 외부 embedding/vector DB 기반 semantic memory는 아직 없지만, 현재는 추가 과금 없는 로컬 lexical vector retrieval과 tag 기반 deterministic profile을 제공해요.
