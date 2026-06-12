import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { releaseEvidence, releaseEvidenceReport } from "../src/cli/release-evidence.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { ViserConfig } from "../src/core/types.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("releaseEvidenceReport summarizes public release readiness without local paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-release-evidence-"));
  try {
    const report = await releaseEvidenceReport(testConfig(dir), { rootDir: REPO_ROOT });

    assert.match(report, /Viser public release evidence: READY/);
    assert.match(report, /safe-to-paste: yes/);
    assert.match(report, /creator: KMokky/);
    assert.match(report, /Logged-in local CLI providers only/);
    assert.match(report, /Goal completion audit:/);
    assert.match(report, /status: PROVEN/);
    assert.match(report, /remaining proof:\n  - none/);
    assert.match(report, /Objective evidence matrix:/);
    assert.match(report, /\[assistant-core\] OpenClaw\/Hermes-like local CLI assistant core works end-to-end/);
    assert.match(report, /\[foreground-only-runtime\] Honor the explicit no-background-service constraint/);
    assert.match(report, /\[skill-learning\] Hermes-style reusable skill capture exists/);
    assert.match(report, /\[automation-orchestration\] Scheduled automation and bounded parallel work queues/);
    assert.match(report, /\[browser-automation\] Browser automation tasks are available without granting hidden web-control authority to model providers/);
    assert.match(report, /\[performance-envelope\] Performance claims are bounded by measurable local parallelism and repeatable benchmark tooling/);
    assert.match(report, /no equal-or-better performance claim is made without an explicit same-host Hermes\/OpenClaw baseline artifact/);
    assert.match(report, /\[local-cli-no-model-api\] GPT\/Codex, Gemini, and Claude use logged-in local CLIs instead of model API keys/);
    assert.match(report, /\[open-source-privacy\] GitHub\/npm public release excludes private runtime state and sensitive personal data/);
    assert.match(report, /\[objective\] GPT\/Codex route uses exact logged-in local codex CLI provider/);
    assert.match(report, /\[objective\] web dashboard source is present/);
    assert.match(report, /\[objective\] MCP stdio server source is present/);
    assert.match(report, /\[objective\] durable job queue source is present/);
    assert.match(report, /\[objective\] benchmark harness source is present/);
    assert.match(report, /\[security\] prompt guard blocks high-risk injection before provider handoff/);
    assert.match(report, /\[voice-capture\] web dashboard serves browser-side microphone transcript capture without provider calls/);
    assert.match(report, /\[media-capture\] web dashboard serves browser-side camera and screen capture without provider calls/);
    assert.match(report, /\[web-chat\] localhost WebChat routes browser messages through AssistantRuntime with a same-origin token/);
    assert.match(report, /\[webhook-inbound\] generic inbound webhook routes token\/HMAC-protected JSON text plus bounded attachment metadata through AssistantRuntime/);
    assert.match(report, /\[provider-stream\] provider output streaming forwards bounded stdout chunks while preserving session history/);
    assert.match(report, /\[file-search\] explicit file search tool finds local text while skipping private\/heavy trees/);
    assert.match(report, /\[mcp-file-search\] MCP file search exposes guarded local text search without provider calls/);
    assert.match(report, /\[web-search\] explicit web-search tool retrieves key-free readable result snippets without JavaScript execution/);
    assert.match(report, /\[web-search-searxng\] explicit web-search tool can use a configured SearXNG HTML provider without JavaScript execution/);
    assert.match(report, /\[web-search-brave\] explicit web-search tool can use a configured Brave Search API provider without JavaScript execution/);
    assert.match(report, /\[web-search-tavily\] explicit web-search tool can use a configured Tavily Search API provider without JavaScript execution/);
    assert.match(report, /\[web-search-perplexity\] explicit web-search tool can use a configured Perplexity Search API provider without JavaScript execution/);
    assert.match(report, /\[web-search-exa\] explicit web-search tool can use a configured Exa Search API provider without JavaScript execution/);
    assert.match(report, /\[web-search-firecrawl\] explicit web-search tool can use a configured Firecrawl Search API provider without JavaScript execution/);
    assert.match(report, /\[web-search-ollama\] explicit web-search tool can use a configured Ollama Web Search provider without JavaScript execution/);
    assert.match(report, /\[web-fetch-firecrawl\] explicit web-fetch tool can use a configured Firecrawl Scrape API provider without JavaScript execution/);
    assert.match(report, /\[mcp-web-search\] MCP web-search tool exposes guarded readable search results without provider calls/);
    assert.match(report, /\[web-fetch\] explicit web-fetch tool retrieves cached bounded text\/markdown without JavaScript execution/);
    assert.match(report, /\[mcp-web-fetch\] MCP web-fetch tool exposes guarded readable markdown\/text without provider calls/);
    assert.match(report, /\[browser-task\] approval-gated Browser Use cloud, Browserbase, Firecrawl Interact, and local CDP tasks are staged and executed only after approval with bounded public domains/);
    assert.match(report, /\[skill-authoring\] learned skills are staged as approval-gated SKILL\.md writes/);
    assert.match(report, /\[skill-reflection\] provider-assisted session reflection records durable proof and stages reusable skills through approval-gated writes/);
    assert.match(report, /\[learning-curator\] automatic learning curator drafts reusable skills from recent sessions through the same approval gate/);
    assert.match(report, /\[parallel-jobs\] bounded parallel job execution processes independent work concurrently/);
    assert.match(report, /\[benchmark\] local benchmark harness measures provider path latency and saves private artifacts without external CLIs/);
    assert.match(report, /\[messenger-outbound\] approval-gated Telegram\/Discord\/Slack\/Matrix\/Signal\/iMessage\/WhatsApp\/LINE\/Google Chat\/generic Webhook\/Home Assistant\/Teams\/Mattermost\/Synology Chat\/Rocket\.Chat\/Feishu\/DingTalk\/WeCom\/Zalo\/IRC\/Twitch\/ntfy\/Mastodon\/Nextcloud Talk\/Webex\/Zulip\/Email\/GitHub\/Todoist\/Notion\/Obsidian outbound messages use connector senders/);
    assert.match(report, /\[telegram\] Telegram handler routes an allowed chat through AssistantRuntime and Bot API send/);
    assert.match(report, /\[discord\] Discord handler routes an allowed channel through AssistantRuntime and REST send/);
    assert.match(report, /\[slack\] Slack handler routes an allowed channel through AssistantRuntime and Web API send/);
    assert.match(report, /\[matrix\] Matrix handler routes an allowed room through AssistantRuntime and Client-Server send/);
    assert.match(report, /\[signal\] Signal handler routes an allowed recipient through AssistantRuntime and local signal-cli send/);
    assert.match(report, /\[imessage\] iMessage handler routes an allowed handle through AssistantRuntime and local osascript send/);
    assert.match(report, /\[whatsapp\] WhatsApp webhook handler routes an allowed recipient through AssistantRuntime and Graph API send/);
    assert.match(report, /\[line\] LINE webhook handler verifies an allowed peer through AssistantRuntime and Messaging API reply/);
    assert.match(report, /\[google-chat\] Google Chat incoming webhook sender posts a redacted alias message payload/);
    assert.match(report, /\[webhook\] Generic HTTPS webhook sender posts a redacted custom JSON payload/);
    assert.match(report, /\[teams\] Microsoft Teams incoming webhook sender posts an Adaptive Card message payload/);
    assert.match(report, /\[mattermost\] Mattermost incoming webhook sender posts a redacted alias text payload/);
    assert.match(report, /\[synology-chat\] Synology Chat incoming webhook sender posts a redacted alias payload/);
    assert.match(report, /\[rocket-chat\] Rocket\.Chat incoming webhook sender posts a redacted alias text payload/);
    assert.match(report, /\[feishu\] Feishu custom bot webhook sender posts a text message payload/);
    assert.match(report, /\[dingtalk\] DingTalk custom robot webhook sender posts a text message payload/);
    assert.match(report, /\[wecom\] WeCom group robot webhook sender posts a text message payload/);
    assert.match(report, /\[zalo\] Zalo OA sender posts a text message payload/);
    assert.match(report, /\[irc\] IRC sender writes a PRIVMSG through a redacted channel alias/);
    assert.match(report, /\[twitch\] Twitch IRC sender writes a chat PRIVMSG through a redacted channel alias/);
    assert.match(report, /\[ntfy\] ntfy sender posts a redacted push message payload/);
    assert.match(report, /\[nextcloud-talk\] Nextcloud Talk sender posts a redacted OCS chat message payload/);
    assert.match(report, /\[webex\] Webex Messages API sender posts a redacted room markdown payload/);
    assert.match(report, /\[zulip\] Zulip Messages API sender posts a redacted alias form payload/);
    assert.match(report, /\[email\] Email local sendmail sender writes a redacted RFC822 payload/);
    assert.match(report, /\[objective\] Telegram connector source is present/);
    assert.match(report, /\[objective\] Slack connector source is present/);
    assert.match(report, /\[objective\] Generic webhook connector source is present/);
    assert.match(report, /\[objective\] Signal connector source is present/);
    assert.match(report, /\[objective\] iMessage connector source is present/);
    assert.match(report, /\[objective\] WhatsApp connector source is present/);
    assert.match(report, /\[objective\] LINE connector source is present/);
    assert.match(report, /\[objective\] Google Chat connector source is present/);
    assert.match(report, /\[objective\] Microsoft Teams connector source is present/);
    assert.match(report, /\[objective\] Mattermost connector source is present/);
    assert.match(report, /\[objective\] Synology Chat connector source is present/);
    assert.match(report, /\[objective\] Rocket\.Chat connector source is present/);
    assert.match(report, /\[objective\] Feishu connector source is present/);
    assert.match(report, /\[objective\] DingTalk connector source is present/);
    assert.match(report, /\[objective\] WeCom connector source is present/);
    assert.match(report, /\[objective\] Twitch connector source is present/);
    assert.match(report, /\[objective\] ntfy connector source is present/);
    assert.match(report, /\[objective\] Nextcloud Talk connector source is present/);
    assert.match(report, /\[objective\] Webex connector source is present/);
    assert.match(report, /\[objective\] Zulip connector source is present/);
    assert.match(report, /\[objective\] Email connector source is present/);
    assert.match(report, /\[objective\] prompt injection guard source is present/);
    assert.match(report, /\[public-example\] \.env\.example excludes model API key variables/);
    assert.match(report, /\[public-example\] config example provider env excludes model API key variables/);
    assert.match(report, /\[security-doc\] SECURITY\.md documents local CLI model access and no model API key boundary/);
    assert.match(report, /\[security-doc\] SECURITY\.md documents prompt-injection defenses/);
    assert.match(report, /\[security-doc\] SECURITY\.md tells reporters not to disclose tokens or private state/);
    assert.match(report, /\[privacy-doc\] PRIVACY\.md limits public identity to Viser and KMokky creator credit/);
    assert.match(report, /\[privacy-doc\] PRIVACY\.md identifies local runtime state that must stay private/);
    assert.match(report, /\[privacy-doc\] PRIVACY\.md tells users not to publish tokens, handles, emails, or local paths/);
    assert.match(report, /\[contributing-doc\] CONTRIBUTING\.md tells contributors to preserve local CLI model access/);
    assert.match(report, /\[contributing-doc\] CONTRIBUTING\.md tells contributors not to commit private data/);
    assert.match(report, /\[contributing-doc\] CONTRIBUTING\.md lists required verification commands/);
    assert.match(report, /\[github-template\] \.github\/ISSUE_TEMPLATE\/bug_report\.yml is present/);
    assert.match(report, /\[github-template\] GitHub bug report template warns against private data disclosure/);
    assert.match(report, /\[github-template\] GitHub PR template preserves local CLI\/no model API boundary/);
    assert.match(report, /\[github-template\] GitHub PR template lists release verification commands/);
    assert.match(report, /\[release-ignore\] \.gitignore excludes \.omx\//);
    assert.match(report, /\[release-ignore\] \.gitignore excludes \.npmrc/);
    assert.match(report, /\[release-ignore\] \.npmignore excludes \.npmrc/);
    assert.match(report, /package: viser@0\.1\.0/);
    assert.match(report, /viser release-evidence/);
    assert.match(report, /viser release-evidence --strict --live --probe-all-providers/);
    assert.doesNotMatch(report, new RegExp(escapeRegExp(dir)));
    assert.doesNotMatch(report, /\/Users\/[^/\s]+/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("releaseEvidenceReport can emit safe machine-readable JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-release-evidence-json-"));
  try {
    const parsed = JSON.parse(await releaseEvidenceReport(testConfig(dir), { rootDir: REPO_ROOT, json: true })) as {
      ok: boolean;
      safeToPaste: boolean;
      creator: string;
      modelAccessRule: string;
      package: { filesCount: number };
      providers: Array<{ command: string }>;
      verification: {
        proof: { live: boolean; probeProviders: boolean; probeAllProviders: boolean };
        smokeChecks: Array<{ area: string; status: string; message: string }>;
        proofChecks: Array<{ area: string; status: string; message: string }>;
      };
      checks: Array<{ area: string; message: string; status: string }>;
      objectiveMatrix: Array<{ id: string; status: string; evidence: string[]; remaining: string[] }>;
      completion: { status: string; blockers: string[]; remainingProof: string[] };
    };

    assert.equal(parsed.ok, true);
    assert.equal(parsed.safeToPaste, true);
    assert.equal(parsed.creator, "KMokky");
    assert.match(parsed.modelAccessRule, /local CLI/);
    assert.equal(parsed.package.filesCount, 14);
    assert.deepEqual(parsed.verification.proof, { live: false, probeProviders: false, probeAllProviders: false });
    assert.deepEqual(parsed.verification.proofChecks, []);
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "security"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "personalization"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "dashboard"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "dashboard-collab"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "dashboard-auth"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "web-chat"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "webhook-inbound"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "voice-loop"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "voice-capture"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "media-capture"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "provider-stream"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "file-search"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "mcp-file-search"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "web-search"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "web-search-searxng"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "web-search-brave"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "web-search-tavily"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "web-search-perplexity"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "web-search-exa"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "web-search-firecrawl"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "web-search-ollama"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "web-fetch-firecrawl"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "mcp-web-search"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "mcp-web-fetch"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "browser-task"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "skill-authoring"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "skill-reflection"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "learning-curator"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "parallel-jobs"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "benchmark"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "messenger-outbound"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "telegram"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "discord"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "slack"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "matrix"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "signal"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "imessage"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "whatsapp"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "line"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "google-chat"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "teams"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "mattermost"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "synology-chat"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "rocket-chat"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "feishu"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "dingtalk"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "wecom"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "zalo"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "irc"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "ntfy"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "nextcloud-talk"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "webex"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "zulip"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "email"));
    assert.ok(parsed.providers.every((provider) => !provider.command.includes("/")));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "objective" && /Gemini route/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "public-example" && /\.env\.example excludes model API key variables/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "public-example" && /config example provider env excludes model API key variables/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "package" && /package files include SECURITY\.md/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "package" && /package files include PRIVACY\.md/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "package" && /package files include CONTRIBUTING\.md/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "package" && /package files include assets/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "package" && /viser CLI bin points to compiled \.\/dist\/index\.js/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "package" && /compiled dist CLI entry is present/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "package" && /package prepare script builds dist/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "package" && /exclude background service-run/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "release-ignore" && /\.gitignore excludes \.omx\//.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "objective" && /web dashboard source/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "objective" && /MCP stdio server source/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "objective" && /personalization global settings source/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "objective" && /durable job queue source/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "objective" && /benchmark harness source/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "release-ignore" && /\.gitignore excludes \.npmrc/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "release-ignore" && /\.npmignore excludes \.npmrc/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "security-doc" && /local CLI model access/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "security-doc" && /prompt-injection defenses/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "security-doc" && /tokens or private state/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "privacy-doc" && /public identity/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "privacy-doc" && /runtime state/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "privacy-doc" && /tokens, handles, emails, or local paths/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "contributing-doc" && /local CLI model access/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "contributing-doc" && /private data/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "contributing-doc" && /verification commands/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "github-template" && /bug_report\.yml is present/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "github-template" && /bug report template warns/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "github-template" && /PR template preserves local CLI\/no model API/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "github-template" && /PR template lists release verification/.test(check.message)));
    assert.ok(parsed.objectiveMatrix.some((item) => item.id === "assistant-core" && item.status === "pass"));
    assert.ok(parsed.objectiveMatrix.some((item) => item.id === "command-usability" && item.status === "pass" && item.evidence.some((evidence) => /node_modules/.test(evidence))));
    assert.ok(parsed.objectiveMatrix.some((item) => item.id === "foreground-only-runtime" && item.status === "pass"));
    assert.ok(parsed.objectiveMatrix.some((item) => item.id === "messenger" && item.status === "pass" && item.remaining.length === 0 && item.evidence.some((evidence) => /optional deployment proof/.test(evidence))));
    assert.ok(parsed.objectiveMatrix.some((item) => item.id === "channel-breadth" && item.status === "pass" && item.remaining.length === 0 && item.evidence.some((evidence) => /does not claim exhaustive parity/.test(evidence))));
    assert.ok(parsed.objectiveMatrix.some((item) => item.id === "local-cli-no-model-api" && item.status === "pass" && item.remaining.length === 0 && item.evidence.some((evidence) => /static route/.test(evidence))));
    assert.ok(parsed.objectiveMatrix.some((item) => item.id === "personalization-global-settings" && item.status === "pass" && item.evidence.some((evidence) => /ai\.tone/.test(evidence))));
    assert.ok(parsed.objectiveMatrix.some((item) => item.id === "skill-learning" && item.status === "pass" && item.evidence.some((evidence) => /automatic learning curator/.test(evidence)) && item.remaining.length === 0));
    assert.ok(parsed.objectiveMatrix.some((item) => item.id === "automation-orchestration" && item.status === "pass"));
    assert.ok(parsed.objectiveMatrix.some((item) => item.id === "browser-automation" && item.status === "pass" && item.remaining.length === 0 && item.evidence.some((evidence) => /optional stronger live browser automation evidence/.test(evidence))));
    assert.ok(parsed.objectiveMatrix.some((item) => item.id === "dashboard-ux" && item.status === "pass" && item.evidence.some((evidence) => /localhost WebChat/.test(evidence)) && item.evidence.some((evidence) => /browser-side microphone transcript capture/.test(evidence)) && item.evidence.some((evidence) => /browser-side camera and screen capture/.test(evidence)) && item.remaining.length === 0));
    assert.ok(parsed.objectiveMatrix.some((item) => item.id === "performance-envelope" && item.status === "pass" && item.evidence.some((evidence) => /benchmark harness/.test(evidence)) && item.remaining.length === 0));
    assert.ok(parsed.objectiveMatrix.some((item) => item.id === "prompt-injection-security" && item.status === "pass"));
    assert.ok(parsed.objectiveMatrix.some((item) => item.id === "open-source-privacy" && item.status === "pass"));
    assert.equal(parsed.completion.status, "proven");
    assert.deepEqual(parsed.completion.blockers, []);
    assert.deepEqual(parsed.completion.remainingProof, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("releaseEvidence recognizes approved real-provider skill reflection proof", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-release-evidence-reflection-proof-"));
  try {
    const config = testConfig(dir);
    const proofDir = join(dir, ".viser", "skills");
    const skillDir = join(proofDir, "live-proof");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "# Live Proof\n\nUse this procedure to preserve real-provider reflection proof without leaking private transcript details.\n",
      "utf8"
    );
    await mkdir(config.actions.dir, { recursive: true });
    await writeFile(join(config.actions.dir, "actions.json"), JSON.stringify([
      {
        id: "act-live-proof",
        type: "write-file",
        targetPath: join(skillDir, "SKILL.md"),
        content: "[107 bytes]",
        status: "approved",
        source: "cli",
        createdAt: "2026-05-30T00:00:00.000Z",
        decidedAt: "2026-05-30T00:01:00.000Z"
      }
    ]), "utf8");
    await writeFile(join(proofDir, "reflection-proofs.jsonl"), `${JSON.stringify({
      id: "proof-live",
      mode: "manual",
      skillId: "live-proof",
      description: "Live provider proof",
      sessionId: "test:live-proof",
      source: "cli",
      providerId: "gpt",
      actionId: "act-live-proof",
      target: "live-proof/SKILL.md",
      transcriptMessages: 2,
      transcriptHash: "abc123",
      procedureBytes: 107,
      createdAt: "2026-05-30T00:00:00.000Z"
    })}\n`, "utf8");

    const result = await releaseEvidence(config, { rootDir: REPO_ROOT });
    const skill = result.objectiveMatrix.find((item) => item.id === "skill-learning");

    assert.equal(skill?.status, "pass");
    assert.ok(skill?.evidence.some((evidence) => /latest approved real-provider reflection proof exists \(provider=gpt, mode=manual, transcriptMessages=2, procedureBytes=107\)/.test(evidence)));
    assert.ok(!skill?.remaining.some((remaining) => /closed-loop reflection/.test(remaining)));
    assert.ok(!result.completion.remainingProof.some((remaining) => /skill-learning.*closed-loop reflection/.test(remaining)));
    assert.equal(result.completion.status, "proven");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("releaseEvidence recognizes approved localhost CDP browser-task proof", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-release-evidence-browser-proof-"));
  try {
    const config = testConfig(dir);
    await mkdir(config.actions.dir, { recursive: true });
    await writeFile(join(config.actions.dir, "actions.json"), JSON.stringify([
      {
        id: "act-local-cdp",
        type: "browser-task",
        targetPath: "local-cdp:example.com",
        content: "[128 bytes]",
        status: "approved",
        source: "cli",
        createdAt: "2026-05-30T00:00:00.000Z",
        decidedAt: "2026-05-30T00:01:00.000Z"
      }
    ]), "utf8");
    await writeFile(join(config.actions.dir, "browser-task-proofs.jsonl"), `${JSON.stringify({
      id: "proof-local-cdp",
      actionId: "act-local-cdp",
      provider: "local-cdp",
      allowedDomains: ["example.com"],
      maxAgentSteps: 4,
      resultId: "local-cdp-target",
      urlHost: "example.com",
      urlProtocol: "https:",
      titleBytes: 14,
      textBytes: 513,
      createdAt: "2026-05-30T00:00:00.000Z"
    })}\n`, "utf8");

    const result = await releaseEvidence(config, { rootDir: REPO_ROOT });
    const browser = result.objectiveMatrix.find((item) => item.id === "browser-automation");

    assert.equal(browser?.status, "pass");
    assert.ok(browser?.evidence.some((evidence) => /approved live browser-task proof exists \(provider=local-cdp, resultId=local-cdp-target, host=example\.com, titleBytes=14, textBytes=513\)/.test(evidence)));
    assert.ok(browser?.evidence.some((evidence) => /Browser Use, Browserbase, and Firecrawl API credential\/task proof/.test(evidence)));
    assert.ok(!browser?.evidence.some((evidence) => /localhost CDP browser run/.test(evidence)));
    assert.deepEqual(browser?.remaining, []);
    assert.equal(result.completion.status, "proven");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("releaseEvidence blocks unsafe package metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-release-evidence-blocked-"));
  try {
    const rootDir = join(dir, "repo");
    await mkdir(rootDir, { recursive: true });
    await writeFile(join(rootDir, "package.json"), JSON.stringify({
      name: "viser-private",
      version: "0.0.0",
      private: true,
      author: "Someone",
      license: "UNLICENSED",
      bin: {},
      files: [".env", "src"]
    }), "utf8");
    await writeFile(join(rootDir, ".npmignore"), "", "utf8");

    const result = await releaseEvidence(testConfig(dir), { rootDir });
    const report = await releaseEvidenceReport(testConfig(dir), { rootDir });

    assert.equal(result.ok, false);
    assert.ok(result.checks.some((check) => check.status === "fail" && /private=false/.test(check.message)));
    assert.ok(result.checks.some((check) => check.status === "fail" && /exclude \.env/.test(check.message)));
    assert.match(report, /Viser public release evidence: BLOCKED/);
    assert.doesNotMatch(report, new RegExp(escapeRegExp(rootDir)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("releaseEvidence blocks model API keys in public examples", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-release-evidence-public-example-"));
  try {
    const rootDir = join(dir, "repo");
    await mkdir(join(rootDir, "config"), { recursive: true });
    await writeFile(join(rootDir, "package.json"), JSON.stringify({
      name: "viser",
      version: "0.1.0",
      private: false,
      author: "KMokky",
      license: "MIT",
      bin: { viser: "./dist/index.js" },
      files: [".env.example", "README.md", "SECURITY.md", "PRIVACY.md", "CONTRIBUTING.md", "assets", "config", "plugins", "skills", "dist", "src", "tools", "tsconfig.build.json", "tsconfig.json"],
      scripts: {
        build: "npm run clean && tsc -p tsconfig.build.json && node -e \"require('fs').chmodSync('dist/index.js',0o755)\"",
        prepare: "npm run build"
      }
    }), "utf8");
    await mkdir(join(rootDir, "dist"), { recursive: true });
    await writeFile(join(rootDir, "dist", "index.js"), "#!/usr/bin/env node\n", "utf8");
    await writeFile(join(rootDir, ".npmignore"), ".viser/\n.omx/\n.env\nviser.config.json\n", "utf8");
    await writeFile(join(rootDir, ".env.example"), "OPENAI_API_KEY=sk-example\nTELEGRAM_BOT_TOKEN=\n", "utf8");
    await writeFile(join(rootDir, "config", "viser.config.example.json"), JSON.stringify({
      providers: {
        codex: {
          command: "codex",
          env: { ANTHROPIC_API_KEY: "not-used" }
        }
      }
    }), "utf8");

    const result = await releaseEvidence(testConfig(dir), { rootDir });
    const report = await releaseEvidenceReport(testConfig(dir), { rootDir });

    assert.equal(result.ok, false);
    assert.equal(
      result.checks.find((check) => check.message === ".env.example excludes model API key variables")?.status,
      "fail"
    );
    assert.equal(
      result.checks.find((check) => check.message === "config example provider env excludes model API key variables")?.status,
      "fail"
    );
    assert.match(report, /Viser public release evidence: BLOCKED/);
    assert.doesNotMatch(report, /sk-example/);
    assert.doesNotMatch(report, new RegExp(escapeRegExp(rootDir)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("releaseEvidence requires exact local CLI command basenames for objective routes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-release-evidence-route-"));
  try {
    const config = testConfig(dir);
    config.providers.gpt = { ...config.providers.gpt, command: "codex-api-wrapper" };

    const result = await releaseEvidence(config, { rootDir: REPO_ROOT });

    assert.equal(result.ok, false);
    assert.equal(
      result.checks.find((check) => /GPT\/Codex route uses exact logged-in local codex CLI provider/.test(check.message))?.status,
      "fail"
    );
    assert.equal(result.objectiveMatrix.find((item) => item.id === "local-cli-no-model-api")?.status, "fail");
    assert.equal(result.completion.status, "unproven");
    assert.ok(result.completion.blockers.some((blocker) => /local-cli-no-model-api/.test(blocker)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("releaseEvidence can include live all-provider local CLI proof", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-release-evidence-live-"));
  try {
    const binDir = join(dir, "bin");
    await mkdir(binDir, { recursive: true });
    await writeProbeCli(binDir, "codex");
    await writeProbeCli(binDir, "gemini");
    await writeProbeCli(binDir, "claude");

    const config = testConfig(dir);
    config.providers.gpt = { ...config.providers.gpt, env: { PATH: binDir } };
    config.providers.gemini = { ...config.providers.gemini, env: { PATH: binDir } };
    config.providers.claude = { ...config.providers.claude, env: { PATH: binDir } };

    const result = await releaseEvidence(config, {
      rootDir: REPO_ROOT,
      verifyOptions: { live: true, probeAllProviders: true }
    });
    const report = await releaseEvidenceReport(config, {
      rootDir: REPO_ROOT,
      verifyOptions: { live: true, probeAllProviders: true }
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.verification.proof, { live: true, probeProviders: false, probeAllProviders: true });
    assert.ok(result.verification.proofChecks.some((check) => check.status === "pass" && check.area === "provider-probe" && check.message === "gpt: responded through local CLI probe"));
    assert.ok(result.verification.proofChecks.some((check) => check.status === "pass" && check.area === "live" && check.message === "telegram: disabled (no token configured)"));
    assert.ok(result.verification.proofChecks.some((check) => check.status === "pass" && check.area === "live" && check.message === "slack: disabled (no token configured)"));
    assert.ok(result.verification.proofChecks.some((check) => check.status === "pass" && check.area === "live" && check.message === "matrix: disabled (no token configured)"));
    assert.ok(result.verification.proofChecks.some((check) => check.status === "pass" && check.area === "live" && check.message === "signal: disabled (no token configured)"));
    assert.ok(result.verification.proofChecks.some((check) => check.status === "pass" && check.area === "live" && check.message === "imessage: disabled (no token configured)"));
    assert.ok(result.verification.proofChecks.some((check) => check.status === "pass" && check.area === "live" && check.message === "whatsapp: disabled (no token configured)"));
    assert.ok(result.verification.proofChecks.some((check) => check.status === "pass" && check.area === "live" && check.message === "line: disabled (no token configured)"));
    assert.ok(result.verification.proofChecks.some((check) => check.status === "pass" && check.area === "live" && check.message === "synology-chat: disabled (no token configured)"));
    assert.ok(result.verification.proofChecks.some((check) => check.status === "pass" && check.area === "live" && check.message === "nextcloud-talk: disabled (no token configured)"));
    assert.match(report, /ℹ️ \[live\] telegram: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ \[live\] slack: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ \[live\] matrix: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ \[live\] signal: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ \[live\] imessage: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ \[live\] whatsapp: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ \[live\] line: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ \[live\] synology-chat: disabled \(no token configured\)/);
    assert.match(report, /ℹ️ \[live\] nextcloud-talk: disabled \(no token configured\)/);
    assert.equal(result.verification.readiness.failCount, 0);
    assert.deepEqual(result.objectiveMatrix.find((item) => item.id === "local-cli-no-model-api")?.remaining, []);
    assert.deepEqual(result.objectiveMatrix.find((item) => item.id === "messenger")?.remaining, []);
    assert.equal(result.completion.status, "proven");
    assert.deepEqual(result.completion.remainingProof, []);
    assert.ok(result.recommendedCommands.includes("viser release-evidence --strict --live --probe-all-providers"));
    assert.ok(result.recommendedCommands.includes("viser release-evidence --live --probe-all-providers"));
    assert.ok(result.recommendedCommands.includes("viser next-steps --live --probe-all-providers"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("releaseEvidence surfaces missing configured provider commands during all-provider proof", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-release-evidence-missing-provider-"));
  try {
    const binDir = join(dir, "bin");
    await mkdir(binDir, { recursive: true });
    await writeProbeCli(binDir, "codex");
    await writeProbeCli(binDir, "gemini");

    const config = testConfig(dir);
    config.providers.gpt = { ...config.providers.gpt, env: { PATH: binDir } };
    config.providers.gemini = { ...config.providers.gemini, env: { PATH: binDir } };
    config.providers.claude = { ...config.providers.claude, env: { PATH: binDir } };

    const result = await releaseEvidence(config, {
      rootDir: REPO_ROOT,
      verifyOptions: { live: true, probeAllProviders: true }
    });
    const report = await releaseEvidenceReport(config, {
      rootDir: REPO_ROOT,
      verifyOptions: { live: true, probeAllProviders: true }
    });

    const claudeProof = result.verification.proofChecks.find((check) => check.status === "warn" && check.area === "provider-probe" && /claude: command 'claude' missing/.test(check.message));
    assert.ok(claudeProof);
    assert.match(claudeProof.next ?? "", /provider-guide claude --probe/);
    assert.equal(result.objectiveMatrix.find((item) => item.id === "local-cli-no-model-api")?.status, "pass");
    assert.deepEqual(result.objectiveMatrix.find((item) => item.id === "local-cli-no-model-api")?.remaining, []);
    assert.deepEqual(result.completion.blockers, []);
    assert.deepEqual(result.completion.remainingProof, []);
    assert.match(report, /⚠️ \[provider-probe\] claude: command 'claude' missing/);
    assert.match(report, /next: .*provider-guide claude --probe/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("releaseEvidence redacts live connector identities in safe-to-paste proof checks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-release-evidence-live-redact-"));
  const originalFetch = globalThis.fetch;
  try {
    const config = testConfig(dir);
    config.providers = {
      echo: {
        id: "echo",
        label: "Echo",
        command: process.execPath,
        args: ["-e", "console.log('VISER_OK')"],
        promptMode: "argument",
        timeoutMs: 5000
      }
    };
    config.assistant.defaultProvider = "echo";
    config.assistant.fallbackProviders = [];
    config.connectors.telegram = {
      ...config.connectors.telegram,
      enabled: true,
      botToken: "123456:telegram-live-secret",
      botTokenEnv: "TELEGRAM_BOT_TOKEN"
    };
    config.connectors.discord = {
      ...config.connectors.discord,
      enabled: true,
      botToken: "discord-live-secret-token",
      botTokenEnv: "DISCORD_BOT_TOKEN"
    };
    config.connectors.slack = {
      ...config.connectors.slack,
      enabled: true,
      botToken: "slack-live-secret-token",
      botTokenEnv: "SLACK_BOT_TOKEN"
    };
    config.connectors.matrix = {
      ...config.connectors.matrix,
      enabled: true,
      homeserverUrl: "https://matrix.example.org",
      accessToken: "matrix-live-secret-token",
      homeserverUrlEnv: "MATRIX_HOMESERVER_URL",
      accessTokenEnv: "MATRIX_ACCESS_TOKEN"
    };
    config.connectors.signal = {
      ...config.connectors.signal,
      enabled: true,
      command: "node",
      commandEnv: "SIGNAL_CLI_COMMAND",
      account: "+15551234567",
      accountEnv: "SIGNAL_CLI_ACCOUNT"
    };
    const imessageChatDbPath = join(dir, "private-chat.db");
    await writeFile(imessageChatDbPath, "", "utf8");
    config.connectors.imessage = {
      ...config.connectors.imessage,
      enabled: true,
      sqliteCommand: "node",
      sqliteCommandEnv: "IMESSAGE_SQLITE_COMMAND",
      osascriptCommand: "node",
      osascriptCommandEnv: "IMESSAGE_OSASCRIPT_COMMAND",
      chatDbPath: imessageChatDbPath,
      chatDbPathEnv: "IMESSAGE_CHAT_DB"
    };
    config.connectors.whatsapp = {
      ...config.connectors.whatsapp,
      enabled: true,
      accessToken: "whatsapp-live-secret-token",
      accessTokenEnv: "WHATSAPP_ACCESS_TOKEN",
      phoneNumberId: "12345",
      phoneNumberIdEnv: "WHATSAPP_PHONE_NUMBER_ID",
      verifyToken: "whatsapp-live-verify-token",
      verifyTokenEnv: "WHATSAPP_VERIFY_TOKEN"
    };
    config.connectors.line = {
      ...config.connectors.line,
      enabled: true,
      channelAccessToken: "line-live-secret-token",
      channelAccessTokenEnv: "LINE_CHANNEL_ACCESS_TOKEN",
      channelSecret: "line-live-channel-secret",
      channelSecretEnv: "LINE_CHANNEL_SECRET"
    };
    config.connectors.googleChat = {
      ...config.connectors.googleChat,
      enabled: true,
      webhookUrl: "https://chat.googleapis.com/v1/spaces/AAAA/messages?key=google-chat-live-secret&token=google-chat-live-token",
      webhookUrlEnv: "GOOGLE_CHAT_WEBHOOK_URL"
    };
    config.connectors.webhook = {
      ...config.connectors.webhook,
      enabled: true,
      webhookUrl: "https://hooks.example.com/viser/webhook-live-secret",
      webhookUrlEnv: "VISER_WEBHOOK_URL"
    };
    config.connectors.homeAssistant = {
      ...config.connectors.homeAssistant,
      enabled: true,
      baseUrl: "http://127.0.0.1:8123",
      baseUrlEnv: "HOME_ASSISTANT_BASE_URL",
      accessToken: "home-assistant-live-secret-token",
      accessTokenEnv: "HOME_ASSISTANT_ACCESS_TOKEN",
      service: "notify.persistent_notification",
      serviceEnv: "HOME_ASSISTANT_SERVICE",
      allowedServiceIds: ["default"],
      defaultServiceIds: ["default"]
    };
    config.connectors.teams = {
      ...config.connectors.teams,
      enabled: true,
      webhookUrl: "https://example.webhook.office.com/webhookb2/teams-live-secret",
      webhookUrlEnv: "TEAMS_WEBHOOK_URL"
    };
    config.connectors.mattermost = {
      ...config.connectors.mattermost,
      enabled: true,
      webhookUrl: "https://mattermost.example.com/hooks/mattermost-live-secret",
      webhookUrlEnv: "MATTERMOST_WEBHOOK_URL"
    };
    config.connectors.synologyChat = {
      ...config.connectors.synologyChat,
      enabled: true,
      webhookUrl: "https://synology.example.com/webapi/entry.cgi?api=SYNO.Chat.External&method=incoming&version=2&token=synology-live-secret",
      webhookUrlEnv: "SYNOLOGY_CHAT_WEBHOOK_URL"
    };
    config.connectors.rocketChat = {
      ...config.connectors.rocketChat,
      enabled: true,
      webhookUrl: "https://rocket.example.com/hooks/integration/rocket-chat-live-secret",
      webhookUrlEnv: "ROCKET_CHAT_WEBHOOK_URL"
    };
    config.connectors.feishu = {
      ...config.connectors.feishu,
      enabled: true,
      webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/feishu-live-secret",
      webhookUrlEnv: "FEISHU_WEBHOOK_URL"
    };
    config.connectors.dingtalk = {
      ...config.connectors.dingtalk,
      enabled: true,
      webhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=dingtalk-live-secret",
      webhookUrlEnv: "DINGTALK_WEBHOOK_URL"
    };
    config.connectors.wecom = {
      ...config.connectors.wecom,
      enabled: true,
      webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=wecom-live-secret",
      webhookUrlEnv: "WECOM_WEBHOOK_URL"
    };
    config.connectors.zalo = {
      ...config.connectors.zalo,
      enabled: true,
      accessToken: "zalo-live-secret-token",
      accessTokenEnv: "ZALO_OA_ACCESS_TOKEN",
      recipient: "zalo-live-user",
      recipientEnv: "ZALO_RECIPIENT_ID"
    };
    config.connectors.irc = {
      ...config.connectors.irc,
      enabled: true,
      host: "private.irc.example.com",
      port: 6697,
      tls: true,
      nick: "private-irc-nick",
      password: "irc-live-secret-password",
      channel: "#private-ops",
      allowedChannelIds: ["default"]
    };
    config.connectors.twitch = {
      ...config.connectors.twitch,
      enabled: true,
      accessToken: "oauth:twitch-live-secret-token",
      accessTokenEnv: "TWITCH_ACCESS_TOKEN",
      botUsername: "private_twitch_bot",
      botUsernameEnv: "TWITCH_BOT_USERNAME",
      channel: "privatechannel",
      channelEnv: "TWITCH_CHANNEL",
      allowedChannelIds: ["default"],
      defaultChannelIds: ["default"]
    };
    config.connectors.ntfy = {
      ...config.connectors.ntfy,
      enabled: true,
      baseUrl: "https://private-ntfy.example.com",
      baseUrlEnv: "NTFY_BASE_URL",
      token: "ntfy-live-secret-token",
      tokenEnv: "NTFY_TOKEN",
      topic: "private-ntfy-topic",
      topicEnv: "NTFY_TOPIC",
      allowedTopicIds: ["default"],
      defaultTopicIds: ["default"]
    };
    config.connectors.mastodon = {
      ...config.connectors.mastodon,
      enabled: true,
      baseUrl: "https://mastodon.example",
      baseUrlEnv: "MASTODON_BASE_URL",
      accessToken: "mastodon-live-secret-token",
      accessTokenEnv: "MASTODON_ACCESS_TOKEN",
      visibility: "private",
      visibilityEnv: "MASTODON_VISIBILITY",
      targets: { ops: "unlisted" },
      targetsEnv: "MASTODON_TARGETS",
      allowedTargetIds: ["ops"],
      defaultTargetIds: ["ops"]
    };
    config.connectors.nextcloudTalk = {
      ...config.connectors.nextcloudTalk,
      enabled: true,
      baseUrl: "https://private-nextcloud.example.com",
      baseUrlEnv: "NEXTCLOUD_TALK_BASE_URL",
      username: "private-nextcloud-user",
      usernameEnv: "NEXTCLOUD_TALK_USERNAME",
      appPassword: "nextcloud-live-app-password",
      appPasswordEnv: "NEXTCLOUD_TALK_APP_PASSWORD",
      roomToken: "privateroomtoken",
      roomTokenEnv: "NEXTCLOUD_TALK_ROOM_TOKEN",
      allowedRoomIds: ["default"]
    };
    config.connectors.webex = {
      ...config.connectors.webex,
      enabled: true,
      accessToken: "webex-live-secret-token",
      accessTokenEnv: "WEBEX_ACCESS_TOKEN"
    };
    config.connectors.zulip = {
      ...config.connectors.zulip,
      enabled: true,
      siteUrl: "https://private.zulipchat.com",
      siteUrlEnv: "ZULIP_SITE_URL",
      botEmail: "private-zulip-bot@example.com",
      botEmailEnv: "ZULIP_BOT_EMAIL",
      apiKey: "zulip-live-secret-token",
      apiKeyEnv: "ZULIP_API_KEY",
      target: "stream:ops:alerts",
      targetEnv: "ZULIP_TARGET"
    };
    config.connectors.email = {
      ...config.connectors.email,
      enabled: true,
      sendmailCommand: "node",
      sendmailCommandEnv: "EMAIL_SENDMAIL_COMMAND",
      from: "private-viser@example.com",
      fromEnv: "EMAIL_FROM",
      recipient: "private-operator@example.com",
      recipientEnv: "EMAIL_RECIPIENT"
    };
    config.connectors.github = {
      ...config.connectors.github,
      enabled: true,
      token: "github-live-secret-token",
      tokenEnv: "GITHUB_TOKEN",
      target: "private-owner/private-repo#98765",
      targetEnv: "GITHUB_ISSUE_TARGET"
    };
    config.connectors.todoist = {
      ...config.connectors.todoist,
      enabled: true,
      token: "todoist-live-secret-token",
      tokenEnv: "TODOIST_API_TOKEN",
      project: "private-todoist-project",
      projectEnv: "TODOIST_PROJECT_ID"
    };
    config.connectors.notion = {
      ...config.connectors.notion,
      enabled: true,
      token: "notion-live-secret-token",
      tokenEnv: "NOTION_TOKEN",
      page: "11111111-1111-1111-1111-111111111111",
      pageEnv: "NOTION_PAGE_ID"
    };
    config.connectors.obsidian = {
      ...config.connectors.obsidian,
      enabled: true,
      vaultDir: join(dir, "private-obsidian-vault"),
      vaultDirEnv: "OBSIDIAN_VAULT_DIR",
      note: "private/live-note.md",
      noteEnv: "OBSIDIAN_NOTE"
    };

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("api.telegram.org")) {
        return new Response(JSON.stringify({
          ok: true,
          result: { username: "private_viser_bot" }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("discord.com")) {
        return new Response(JSON.stringify({ username: "private-discord-bot" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("slack.com")) {
        return new Response(JSON.stringify({ ok: true, user: "private-slack-bot" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("matrix.example.org")) {
        return new Response(JSON.stringify({ user_id: "@private-matrix-bot:example.org" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("graph.facebook.com")) {
        return new Response(JSON.stringify({ id: "12345", display_phone_number: "+1 555 123 4567" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("api.line.me")) {
        return new Response(JSON.stringify({ displayName: "private-line-bot" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("webexapis.com")) {
        return new Response(JSON.stringify({ displayName: "private-webex-bot" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("private.zulipchat.com")) {
        return new Response(JSON.stringify({ result: "success", full_name: "private-zulip-bot" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("api.github.com")) {
        return new Response(JSON.stringify({ login: "private-github-user" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("api.todoist.com")) {
        return new Response(JSON.stringify([{ id: "private-todoist-project", name: "Private Todoist Project" }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("api.notion.com")) {
        return new Response(JSON.stringify({ name: "private-notion-bot" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("mastodon.example")) {
        return new Response(JSON.stringify({ username: "private-mastodon-user", acct: "private-mastodon-user@mastodon.example" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("127.0.0.1:8123/api/")) {
        return new Response(JSON.stringify({ message: "API running." }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    const report = await releaseEvidenceReport(config, {
      rootDir: REPO_ROOT,
      json: true,
      verifyOptions: { live: true, probeProviders: true }
    });
    const parsed = JSON.parse(report) as {
      verification: { proofChecks: Array<{ area: string; status: string; message: string }> };
      objectiveMatrix: Array<{ id: string; status: string; remaining: string[] }>;
    };

    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "telegram: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "discord: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "slack: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "matrix: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "signal: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "imessage: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "whatsapp: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "line: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "google-chat: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "webhook: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "home-assistant: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "teams: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "mattermost: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "synology-chat: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "rocket-chat: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "feishu: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "dingtalk: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "wecom: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "zalo: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "irc: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "twitch: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "ntfy: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "mastodon: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "nextcloud-talk: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "webex: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "zulip: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "email: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "github: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "todoist: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "notion: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "obsidian: live token accepted"));
    assert.deepEqual(parsed.objectiveMatrix.find((item) => item.id === "messenger")?.remaining, []);
    assert.doesNotMatch(report, /private_viser_bot/);
    assert.doesNotMatch(report, /private-discord-bot/);
    assert.doesNotMatch(report, /private-slack-bot/);
    assert.doesNotMatch(report, /private-matrix-bot/);
    assert.doesNotMatch(report, /private-webex-bot/);
    assert.doesNotMatch(report, /private-line-bot/);
    assert.doesNotMatch(report, /private-zulip-bot/);
    assert.doesNotMatch(report, /telegram-live-secret|discord-live-secret-token|slack-live-secret-token|matrix-live-secret-token|whatsapp-live-secret-token|whatsapp-live-verify-token|line-live-secret-token|line-live-channel-secret|google-chat-live-secret|google-chat-live-token|webhook-live-secret|home-assistant-live-secret-token|127\.0\.0\.1:8123|notify\.persistent_notification|teams-live-secret|mattermost-live-secret|synology-live-secret|rocket-chat-live-secret|feishu-live-secret|dingtalk-live-secret|wecom-live-secret|zalo-live-secret-token|zalo-live-user|private\.irc\.example\.com|private-irc-nick|irc-live-secret-password|#private-ops|twitch-live-secret-token|private_twitch_bot|privatechannel|private-ntfy|ntfy-live-secret-token|private-ntfy-topic|mastodon-live-secret-token|private-mastodon-user|mastodon\.example|private-nextcloud|nextcloud-live-app-password|privateroomtoken|webex-live-secret-token|zulip-live-secret-token|github-live-secret-token|private-github-user|private-owner\/private-repo|todoist-live-secret-token|private-todoist-project|notion-live-secret-token|private-notion-bot|11111111-1111-1111-1111-111111111111|private-obsidian-vault|private\/live-note\.md|private-zulip-bot@example\.com|private-viser@example\.com|private-operator@example\.com|private\.zulipchat|98765|12345|\+15551234567|private-chat\.db/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("releaseEvidence proves completion after implementation gates pass while keeping optional live proof redacted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-release-evidence-complete-"));
  const originalFetch = globalThis.fetch;
  try {
    const binDir = join(dir, "bin");
    await mkdir(binDir, { recursive: true });
    await writeProbeCli(binDir, "codex");
    await writeProbeCli(binDir, "gemini");
    await writeProbeCli(binDir, "claude");

    const config = testConfig(dir);
    config.providers.gpt = { ...config.providers.gpt, env: { PATH: binDir } };
    config.providers.gemini = { ...config.providers.gemini, env: { PATH: binDir } };
    config.providers.claude = { ...config.providers.claude, env: { PATH: binDir } };
    config.connectors.telegram = {
      ...config.connectors.telegram,
      enabled: true,
      botToken: "123456:telegram-live-secret",
      botTokenEnv: "TELEGRAM_BOT_TOKEN"
    };
    config.connectors.discord = {
      ...config.connectors.discord,
      enabled: true,
      botToken: "discord-live-secret-token",
      botTokenEnv: "DISCORD_BOT_TOKEN"
    };
    config.connectors.slack = {
      ...config.connectors.slack,
      enabled: true,
      botToken: "slack-live-secret-token",
      botTokenEnv: "SLACK_BOT_TOKEN"
    };
    config.connectors.matrix = {
      ...config.connectors.matrix,
      enabled: true,
      homeserverUrl: "https://matrix.example.org",
      accessToken: "matrix-live-secret-token",
      homeserverUrlEnv: "MATRIX_HOMESERVER_URL",
      accessTokenEnv: "MATRIX_ACCESS_TOKEN"
    };
    config.connectors.signal = {
      ...config.connectors.signal,
      enabled: true,
      command: "node",
      commandEnv: "SIGNAL_CLI_COMMAND",
      account: "+15551234567",
      accountEnv: "SIGNAL_CLI_ACCOUNT"
    };

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true, result: { username: "private_viser_bot" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("discord.com")) {
        return new Response(JSON.stringify({ username: "private-discord-bot" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("slack.com")) {
        return new Response(JSON.stringify({ ok: true, user: "private-slack-bot" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("matrix.example.org")) {
        return new Response(JSON.stringify({ user_id: "@private-matrix-bot:example.org" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    const result = await releaseEvidence(config, {
      rootDir: REPO_ROOT,
      verifyOptions: { live: true, probeAllProviders: true }
    });
    const report = await releaseEvidenceReport(config, {
      rootDir: REPO_ROOT,
      verifyOptions: { live: true, probeAllProviders: true }
    });

    assert.equal(result.ok, true);
    assert.equal(result.completion.status, "proven");
    assert.deepEqual(result.completion.blockers, []);
    assert.deepEqual(result.completion.remainingProof, []);
    assert.match(report, /status: PROVEN/);
    assert.doesNotMatch(report, /private_viser_bot|private-discord-bot|private-slack-bot|private-matrix-bot|telegram-live-secret|discord-live-secret-token|slack-live-secret-token|matrix-live-secret-token|\+15551234567/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

function testConfig(dir: string): ViserConfig {
  return {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, defaultProvider: "echo", fallbackProviders: [], workdir: dir },
    storage: { dir: join(dir, ".viser") },
    memory: { ...DEFAULT_CONFIG.memory, dir: join(dir, ".viser", "memory") },
    personalization: { ...DEFAULT_CONFIG.personalization, dir: join(dir, ".viser", "personalization") },
    skills: { ...DEFAULT_CONFIG.skills, dirs: [join(dir, "skills"), join(dir, ".viser", "skills")] },
    tools: { ...DEFAULT_CONFIG.tools, allowedReadRoots: [dir], shell: { ...DEFAULT_CONFIG.tools.shell } },
    scheduler: { ...DEFAULT_CONFIG.scheduler, dir: join(dir, ".viser", "scheduler") },
    jobs: { ...DEFAULT_CONFIG.jobs, dir: join(dir, ".viser", "jobs") },
    access: { ...DEFAULT_CONFIG.access, dir: join(dir, ".viser", "access") },
    actions: { ...DEFAULT_CONFIG.actions, dir: join(dir, ".viser", "actions"), allowedWriteRoots: [dir] },
    connectors: {
      telegram: { ...DEFAULT_CONFIG.connectors.telegram, allowedChatIds: [], defaultChatIds: [] },
      discord: { ...DEFAULT_CONFIG.connectors.discord, allowedChannelIds: [], defaultChannelIds: [] },
      slack: { ...DEFAULT_CONFIG.connectors.slack, allowedChannelIds: [], defaultChannelIds: [] },
      matrix: { ...DEFAULT_CONFIG.connectors.matrix, allowedRoomIds: [], defaultRoomIds: [] },
      signal: { ...DEFAULT_CONFIG.connectors.signal, allowedRecipientIds: [], defaultRecipientIds: [] },
      imessage: { ...DEFAULT_CONFIG.connectors.imessage, allowedHandleIds: [], defaultHandleIds: [] },
      whatsapp: { ...DEFAULT_CONFIG.connectors.whatsapp, allowedRecipientIds: [], defaultRecipientIds: [] },
      line: { ...DEFAULT_CONFIG.connectors.line, allowedPeerIds: [], defaultPeerIds: [] },
      kakaotalk: { ...DEFAULT_CONFIG.connectors.kakaotalk, allowedUserIds: [], defaultUserIds: [] },
      googleChat: { ...DEFAULT_CONFIG.connectors.googleChat, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      webhook: { ...DEFAULT_CONFIG.connectors.webhook, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      homeAssistant: { ...DEFAULT_CONFIG.connectors.homeAssistant, baseUrl: undefined, accessToken: undefined, service: undefined, services: {}, allowedServiceIds: [], defaultServiceIds: [] },
      teams: { ...DEFAULT_CONFIG.connectors.teams, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      mattermost: { ...DEFAULT_CONFIG.connectors.mattermost, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      synologyChat: { ...DEFAULT_CONFIG.connectors.synologyChat, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      rocketChat: { ...DEFAULT_CONFIG.connectors.rocketChat, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      feishu: { ...DEFAULT_CONFIG.connectors.feishu, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      dingtalk: { ...DEFAULT_CONFIG.connectors.dingtalk, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      wecom: { ...DEFAULT_CONFIG.connectors.wecom, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      zalo: { ...DEFAULT_CONFIG.connectors.zalo, accessToken: undefined, recipient: undefined, recipients: {}, allowedRecipientIds: [], defaultRecipientIds: [] },
      irc: { ...DEFAULT_CONFIG.connectors.irc, host: undefined, nick: undefined, password: undefined, channel: undefined, channels: {}, allowedChannelIds: [], defaultChannelIds: [] },
      twitch: { ...DEFAULT_CONFIG.connectors.twitch, enabled: false, accessToken: undefined, botUsername: undefined, channel: undefined, channels: {}, allowedChannelIds: [], defaultChannelIds: [] },
      ntfy: { ...DEFAULT_CONFIG.connectors.ntfy, enabled: false, token: undefined, topic: undefined, topics: {}, allowedTopicIds: [], defaultTopicIds: [] },
      mastodon: { ...DEFAULT_CONFIG.connectors.mastodon, enabled: false, baseUrl: undefined, accessToken: undefined, visibility: "private", targets: {}, allowedTargetIds: [], defaultTargetIds: [] },
      nextcloudTalk: { ...DEFAULT_CONFIG.connectors.nextcloudTalk, baseUrl: undefined, username: undefined, appPassword: undefined, roomToken: undefined, rooms: {}, allowedRoomIds: [], defaultRoomIds: [] },
      webex: { ...DEFAULT_CONFIG.connectors.webex, accessToken: undefined, allowedRoomIds: [], defaultRoomIds: [] },
      zulip: { ...DEFAULT_CONFIG.connectors.zulip, siteUrl: undefined, botEmail: undefined, apiKey: undefined, target: undefined, targets: {}, allowedTargetIds: [], defaultTargetIds: [] },
      email: { ...DEFAULT_CONFIG.connectors.email, enabled: false, from: undefined, recipient: undefined, recipients: {}, allowedRecipientIds: [], defaultRecipientIds: [] },
      github: { ...DEFAULT_CONFIG.connectors.github, enabled: false, token: undefined, target: undefined, targets: {}, allowedTargetIds: [], defaultTargetIds: [] },
      todoist: { ...DEFAULT_CONFIG.connectors.todoist, enabled: false, token: undefined, project: undefined, projects: {}, allowedProjectIds: [], defaultProjectIds: [] },
      notion: { ...DEFAULT_CONFIG.connectors.notion, enabled: false, token: undefined, page: undefined, pages: {}, allowedPageIds: [], defaultPageIds: [] },
      obsidian: { ...DEFAULT_CONFIG.connectors.obsidian, enabled: false, vaultDir: undefined, note: undefined, notes: {}, allowedNoteIds: [], defaultNoteIds: [] }
    },
    providers: {
      echo: {
        id: "echo",
        label: "Echo",
        command: process.execPath,
        args: ["-e", "console.log('VISER_OK')"],
        promptMode: "argument",
        timeoutMs: 5000
      },
      gpt: {
        id: "gpt",
        label: "GPT through Codex CLI",
        command: "codex",
        args: ["exec", "-"],
        promptMode: "stdin",
        timeoutMs: 5000
      },
      gemini: {
        id: "gemini",
        label: "Gemini CLI",
        command: "gemini",
        args: ["--prompt", "{prompt}"],
        promptMode: "template",
        timeoutMs: 5000
      },
      claude: {
        id: "claude",
        label: "Claude Code CLI",
        command: "claude",
        args: ["-p", "{prompt}"],
        promptMode: "template",
        timeoutMs: 5000
      }
    }
  };
}

async function writeProbeCli(binDir: string, name: string): Promise<void> {
  const path = join(binDir, name);
  await writeFile(path, "#!/bin/sh\nprintf '%s\\n' VISER_OK\n", "utf8");
  await chmod(path, 0o755);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
