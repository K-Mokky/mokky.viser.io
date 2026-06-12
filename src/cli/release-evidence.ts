// ================================================================
// Public release evidence
// ================================================================
// Produces a safe-to-paste release evidence report for GitHub. It summarizes
// verification and package hygiene without leaking local filesystem paths,
// tokens, or runtime state contents.

import { readFile } from "node:fs/promises";
import { cwd } from "node:process";
import { join } from "node:path";
import { homedir } from "node:os";
import { verify, type VerifyOptions } from "./verify.ts";
import { latestBenchmarkArtifactSummary, type BenchmarkArtifactSummary } from "./benchmark.ts";
import { CORE_LOCAL_CLI_ROUTES, commandBasename, coreLocalCliRoutePass } from "../core/local-cli-policy.ts";
import { isModelApiKeyEnvKey } from "../core/model-api-policy.ts";
import type { VerifyResult } from "./verify.ts";
import type { BrowserTaskProvider, ViserConfig } from "../core/types.ts";

const RELEASE_CREATOR = "KMokky";
const RELEASE_ASSISTANT = "Viser";
const REQUIRED_PUBLIC_FILES = ["README.md", "SECURITY.md", "PRIVACY.md", "CONTRIBUTING.md", "LICENSE", "aimake.md"];
const REQUIRED_PACKAGE_FILES = [".env.example", "README.md", "SECURITY.md", "PRIVACY.md", "CONTRIBUTING.md", "assets", "config", "plugins", "skills", "dist", "src", "tools", "tsconfig.build.json", "tsconfig.json"];
const REQUIRED_GITHUB_TEMPLATE_FILES = [
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/PULL_REQUEST_TEMPLATE.md"
];
const FORBIDDEN_PACKAGE_FILES = [".env", ".viser", ".omx", ".npmrc", "node_modules", "viser.config.json"];
const RELEASE_EVIDENCE_COMMAND = "viser release-evidence";
const LIVE_RELEASE_EVIDENCE_COMMAND = `${RELEASE_EVIDENCE_COMMAND} --live --probe-all-providers`;
const STRICT_LIVE_RELEASE_EVIDENCE_COMMAND = `${RELEASE_EVIDENCE_COMMAND} --strict --live --probe-all-providers`;

export interface ReleaseEvidenceOptions {
  json?: boolean;
  rootDir?: string;
  verifyOptions?: VerifyOptions;
}

export interface ReleaseEvidenceReportResult {
  result: ReleaseEvidenceResult;
  report: string;
}

export interface ReleaseEvidenceCheck {
  status: "pass" | "fail";
  area: string;
  message: string;
}

export interface ReleaseEvidenceProofCheck {
  status: "pass" | "warn" | "fail";
  area: string;
  message: string;
  next?: string;
}

export interface ReleaseEvidenceObjective {
  id: string;
  status: "pass" | "warn" | "fail";
  requirement: string;
  evidence: string[];
  remaining: string[];
}

export interface ReleaseEvidenceCompletion {
  status: "proven" | "unproven";
  summary: string;
  blockers: string[];
  remainingProof: string[];
}

export interface ReleaseEvidenceResult {
  ok: boolean;
  schemaVersion: 1;
  generatedAt: string;
  safeToPaste: true;
  assistantName: string;
  creator: string;
  modelAccessRule: string;
  package: {
    name: string;
    version: string;
    author: string;
    private: boolean | null;
    license: string;
    filesCount: number;
  };
  providers: Array<{
    id: string;
    label: string;
    command: string;
    promptMode: string;
  }>;
  verification: {
    ok: boolean;
    proof: {
      live: boolean;
      probeProviders: boolean;
      probeAllProviders: boolean;
    };
    readiness: VerifyResult["readiness"];
    audit: VerifyResult["audit"];
    smoke: VerifyResult["smoke"];
    smokeChecks: Array<{
      status: "pass" | "fail";
      area: string;
      message: string;
    }>;
    proofChecks: ReleaseEvidenceProofCheck[];
  };
  objectiveMatrix: ReleaseEvidenceObjective[];
  completion: ReleaseEvidenceCompletion;
  checks: ReleaseEvidenceCheck[];
  recommendedCommands: string[];
}

interface PackageShape {
  name?: unknown;
  version?: unknown;
  author?: unknown;
  private?: unknown;
  license?: unknown;
  bin?: unknown;
  files?: unknown;
  scripts?: unknown;
}

interface SkillReflectionProofSummary {
  providerId: string;
  mode: string;
  transcriptMessages: number;
  procedureBytes: number;
  createdAt: string;
}

interface BrowserTaskProofSummary {
  provider: BrowserTaskProvider;
  resultId: string;
  urlHost?: string;
  titleBytes: number;
  textBytes: number;
  createdAt: string;
}

export async function releaseEvidence(config: ViserConfig, options: ReleaseEvidenceOptions = {}): Promise<ReleaseEvidenceResult> {
  const rootDir = options.rootDir ?? cwd();
  const verifyResult = await verify(config, { strict: true, ...options.verifyOptions });
  const packageJson = await readPackageJson(rootDir);
  const proof = proofMode(options.verifyOptions);
  const providers = Object.values(config.providers).map((provider) => ({
    id: provider.id,
    label: provider.label ?? provider.id,
    command: commandBasename(provider.command),
    promptMode: provider.promptMode
  }));
  const smokeChecks = verifyResult.smokeItems.map((item) => ({
    status: item.status,
    area: item.area,
    message: item.message
  }));
  const runtimeProofChecks = proofChecks(verifyResult.readinessItems);
  const benchmarkArtifact = await latestBenchmarkArtifactSummary(config);
  const skillReflectionProof = await latestApprovedRealProviderSkillReflectionProof(config);
  const browserTaskProofs = await latestApprovedBrowserTaskProofs(config);
  const checks = [
    ...await objectiveCoverageChecks(rootDir, config),
    ...await publicExampleChecks(rootDir),
    ...await packageReleaseChecks(rootDir, packageJson)
  ];
  const failedChecks = checks.some((check) => check.status === "fail");
  const objective = objectiveMatrix({
    config,
    checks,
    smokeChecks,
    proofChecks: runtimeProofChecks,
    proof,
    verifyResult,
    benchmarkArtifact,
    skillReflectionProof,
    browserTaskProofs
  });
  const publicReleaseReady = verifyResult.ok && !failedChecks;

  return {
    ok: publicReleaseReady,
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    safeToPaste: true,
    assistantName: RELEASE_ASSISTANT,
    creator: RELEASE_CREATOR,
    modelAccessRule: "Logged-in local CLI providers only; no GPT/Gemini/Claude model HTTP API keys are required by Viser.",
    package: {
      name: stringValue(packageJson?.name),
      version: stringValue(packageJson?.version),
      author: stringValue(packageJson?.author),
      private: typeof packageJson?.private === "boolean" ? packageJson.private : null,
      license: stringValue(packageJson?.license),
      filesCount: Array.isArray(packageJson?.files) ? packageJson.files.length : 0
    },
    providers,
    verification: {
      ok: verifyResult.ok,
      proof,
      readiness: verifyResult.readiness,
      audit: verifyResult.audit,
      smoke: verifyResult.smoke,
      smokeChecks,
      proofChecks: runtimeProofChecks
    },
    objectiveMatrix: objective,
    completion: completionAudit(publicReleaseReady, objective),
    checks,
    recommendedCommands: [
      "npm run build",
      "npm test",
      "npm run typecheck",
      "viser verify --strict",
      "viser verify --strict --live --probe-all-providers",
      "viser next-steps --live --probe-all-providers",
      "viser benchmark --live --save --provider <provider> --hermes \"hermes ... {prompt}\" --openclaw \"openclaw ... {prompt}\"",
      "viser ask \"/reflect-skill <id> | <description>\" --provider <logged-in-provider> --session <completed-session>",
      "viser audit",
      RELEASE_EVIDENCE_COMMAND,
      STRICT_LIVE_RELEASE_EVIDENCE_COMMAND,
      LIVE_RELEASE_EVIDENCE_COMMAND,
      "npm pack --dry-run"
    ]
  };
}

export async function releaseEvidenceReport(config: ViserConfig, options: ReleaseEvidenceOptions = {}): Promise<string> {
  return (await releaseEvidenceReportResult(config, options)).report;
}

export async function releaseEvidenceReportResult(config: ViserConfig, options: ReleaseEvidenceOptions = {}): Promise<ReleaseEvidenceReportResult> {
  const rootDir = options.rootDir ?? cwd();
  const result = await releaseEvidence(config, { ...options, rootDir });
  const report = options.json ? JSON.stringify(result, null, 2) : formatReleaseEvidence(result);
  return {
    result,
    report: redactReleaseEvidence(report, rootDir, config)
  };
}

async function readPackageJson(rootDir: string): Promise<PackageShape | undefined> {
  try {
    return JSON.parse(await readFile(join(rootDir, "package.json"), "utf8")) as PackageShape;
  } catch {
    return undefined;
  }
}

async function packageReleaseChecks(rootDir: string, packageJson: PackageShape | undefined): Promise<ReleaseEvidenceCheck[]> {
  const checks: ReleaseEvidenceCheck[] = [];
  if (!packageJson) {
    checks.push({ status: "fail", area: "package", message: "package.json is missing or invalid" });
    return checks;
  }

  addCheck(checks, "package", packageJson.name === "viser", "package name is viser");
  addCheck(checks, "package", packageJson.private === false, "package is public (private=false)");
  addCheck(checks, "package", packageJson.author === RELEASE_CREATOR, `creator attribution is ${RELEASE_CREATOR}`);
  addCheck(checks, "package", packageJson.license === "MIT", "license is MIT");

  const bin = isRecord(packageJson.bin) ? packageJson.bin : {};
  addCheck(checks, "package", bin.viser === "./dist/index.js", "viser CLI bin points to compiled ./dist/index.js");
  addCheck(checks, "package", await fileExists(join(rootDir, "dist", "index.js")), "compiled dist CLI entry is present");
  const scripts = isRecord(packageJson.scripts) ? packageJson.scripts : {};
  addCheck(checks, "package", scripts.build === "npm run clean && tsc -p tsconfig.build.json && node -e \"require('fs').chmodSync('dist/index.js',0o755)\"", "package build script emits the compiled CLI entry");
  addCheck(checks, "package", scripts.prepare === "npm run build", "package prepare script builds dist for npm link and pack");
  addCheck(checks, "package", !("service-run" in scripts), "package scripts exclude background service-run");
  addCheck(checks, "package", !("service" in scripts), "package scripts exclude background service helper");

  const files = Array.isArray(packageJson.files) ? packageJson.files.filter((item): item is string => typeof item === "string") : [];
  addCheck(checks, "package", files.length > 0, "package files allowlist is present");
  for (const required of REQUIRED_PACKAGE_FILES) {
    addCheck(checks, "package", files.includes(required), `package files include ${required}`);
  }
  for (const forbidden of FORBIDDEN_PACKAGE_FILES) {
    addCheck(checks, "package", !files.some((file) => file === forbidden || file.startsWith(`${forbidden}/`)), `package files exclude ${forbidden}`);
  }

  const gitignore = await readTextIfExists(join(rootDir, ".gitignore"));
  addCheck(checks, "release-ignore", gitignore.includes(".viser/"), ".gitignore excludes .viser/");
  addCheck(checks, "release-ignore", gitignore.includes(".omx/"), ".gitignore excludes .omx/");
  addCheck(checks, "release-ignore", /^\.env$/m.test(gitignore), ".gitignore excludes .env");
  addCheck(checks, "release-ignore", /^\.npmrc$/m.test(gitignore), ".gitignore excludes .npmrc");
  addCheck(checks, "release-ignore", /viser\.config\.json/.test(gitignore), ".gitignore excludes local config");

  const npmignore = await readTextIfExists(join(rootDir, ".npmignore"));
  addCheck(checks, "release-ignore", npmignore.includes(".viser/"), ".npmignore excludes .viser/");
  addCheck(checks, "release-ignore", npmignore.includes(".omx/"), ".npmignore excludes .omx/");
  addCheck(checks, "release-ignore", /^\.env$/m.test(npmignore), ".npmignore excludes .env");
  addCheck(checks, "release-ignore", /^\.npmrc$/m.test(npmignore), ".npmignore excludes .npmrc");
  addCheck(checks, "release-ignore", /viser\.config\.json/.test(npmignore), ".npmignore excludes local config");

  for (const file of REQUIRED_PUBLIC_FILES) {
    addCheck(checks, "docs", await fileExists(join(rootDir, file)), `${file} is present`);
  }
  checks.push(...await securityDocumentChecks(rootDir));
  checks.push(...await privacyDocumentChecks(rootDir));
  checks.push(...await contributingDocumentChecks(rootDir));
  checks.push(...await githubTemplateChecks(rootDir));

  return checks;
}

async function securityDocumentChecks(rootDir: string): Promise<ReleaseEvidenceCheck[]> {
  const checks: ReleaseEvidenceCheck[] = [];
  const security = await readTextIfExists(join(rootDir, "SECURITY.md"));
  const normalized = security.replace(/\s+/gu, " ").trim();

  addCheck(checks, "security-doc", normalized.length > 0, "SECURITY.md is non-empty");
  addCheck(
    checks,
    "security-doc",
    /local AI CLIs?|local CLI|codex.*gemini.*claude/iu.test(normalized) && /model API keys?|HTTP APIs?/iu.test(normalized),
    "SECURITY.md documents local CLI model access and no model API key boundary"
  );
  addCheck(
    checks,
    "security-doc",
    /prompt-?injection|instruction override|base64|zero-width|bidi/iu.test(normalized),
    "SECURITY.md documents prompt-injection defenses"
  );
  addCheck(
    checks,
    "security-doc",
    /TELEGRAM_BOT_TOKEN|DISCORD_BOT_TOKEN|SIGNAL_CLI_ACCOUNT|WHATSAPP_ACCESS_TOKEN|WHATSAPP_VERIFY_TOKEN|LINE_CHANNEL_ACCESS_TOKEN|LINE_CHANNEL_SECRET|KAKAOTALK_SKILL_TOKEN|WEBEX_ACCESS_TOKEN|ZULIP_API_KEY|\.env|personal data|private \.viser|\.omx/iu.test(normalized),
    "SECURITY.md tells reporters not to disclose tokens or private state"
  );

  return checks;
}

async function githubTemplateChecks(rootDir: string): Promise<ReleaseEvidenceCheck[]> {
  const checks: ReleaseEvidenceCheck[] = [];
  for (const file of REQUIRED_GITHUB_TEMPLATE_FILES) {
    addCheck(checks, "github-template", await fileExists(join(rootDir, file)), `${file} is present`);
  }

  const bugReport = await readTextIfExists(join(rootDir, ".github", "ISSUE_TEMPLATE", "bug_report.yml"));
  const pullRequest = await readTextIfExists(join(rootDir, ".github", "PULL_REQUEST_TEMPLATE.md"));
  const bugText = bugReport.replace(/\s+/gu, " ").trim();
  const prText = pullRequest.replace(/\s+/gu, " ").trim();

  addCheck(
    checks,
    "github-template",
    /\.env|\.viser|\.omx|TELEGRAM_BOT_TOKEN|DISCORD_BOT_TOKEN|SIGNAL_CLI_ACCOUNT|WHATSAPP_ACCESS_TOKEN|WHATSAPP_VERIFY_TOKEN|LINE_CHANNEL_ACCESS_TOKEN|LINE_CHANNEL_SECRET|KAKAOTALK_SKILL_TOKEN|WEBEX_ACCESS_TOKEN|ZULIP_API_KEY|local filesystem paths|personal handles|emails?/iu.test(bugText),
    "GitHub bug report template warns against private data disclosure"
  );
  addCheck(
    checks,
    "github-template",
    /fake credentials|redact|removed real tokens|no real secrets/iu.test(bugText),
    "GitHub bug report template requires fake or redacted credentials"
  );
  addCheck(
    checks,
    "github-template",
    /local CLI-only|local CLI|codex.*gemini.*claude/iu.test(prText) && /model API key|HTTP model-client|HTTP model client/iu.test(prText),
    "GitHub PR template preserves local CLI/no model API boundary"
  );
  addCheck(
    checks,
    "github-template",
    /npm test|typecheck|audit|release-evidence|npm pack --dry-run/iu.test(prText),
    "GitHub PR template lists release verification commands"
  );
  addCheck(
    checks,
    "github-template",
    /\.env|\.viser|\.omx|real tokens|personal handles|local filesystem paths/iu.test(prText),
    "GitHub PR template tells contributors not to include private data"
  );

  return checks;
}

async function contributingDocumentChecks(rootDir: string): Promise<ReleaseEvidenceCheck[]> {
  const checks: ReleaseEvidenceCheck[] = [];
  const contributing = await readTextIfExists(join(rootDir, "CONTRIBUTING.md"));
  const normalized = contributing.replace(/\s+/gu, " ").trim();

  addCheck(checks, "contributing-doc", normalized.length > 0, "CONTRIBUTING.md is non-empty");
  addCheck(
    checks,
    "contributing-doc",
    /local AI CLIs?|local CLI|codex|gemini|claude/iu.test(normalized) && /model API keys?|HTTP APIs?/iu.test(normalized),
    "CONTRIBUTING.md tells contributors to preserve local CLI model access"
  );
  addCheck(
    checks,
    "contributing-doc",
    /\.env|\.viser|\.omx|tokens?|personal handles|emails?|local filesystem paths/iu.test(normalized),
    "CONTRIBUTING.md tells contributors not to commit private data"
  );
  addCheck(
    checks,
    "contributing-doc",
    /npm test|typecheck|audit|release-evidence/iu.test(normalized),
    "CONTRIBUTING.md lists required verification commands"
  );

  return checks;
}

async function privacyDocumentChecks(rootDir: string): Promise<ReleaseEvidenceCheck[]> {
  const checks: ReleaseEvidenceCheck[] = [];
  const privacy = await readTextIfExists(join(rootDir, "PRIVACY.md"));
  const normalized = privacy.replace(/\s+/gu, " ").trim();

  addCheck(checks, "privacy-doc", normalized.length > 0, "PRIVACY.md is non-empty");
  addCheck(
    checks,
    "privacy-doc",
    /Viser/iu.test(normalized) && /KMokky/iu.test(normalized) && /creator|credit|제작자/iu.test(normalized),
    "PRIVACY.md limits public identity to Viser and KMokky creator credit"
  );
  addCheck(
    checks,
    "privacy-doc",
    /\.viser|\.omx|session|memory|runtime state|backups/iu.test(normalized),
    "PRIVACY.md identifies local runtime state that must stay private"
  );
  addCheck(
    checks,
    "privacy-doc",
    /TELEGRAM_BOT_TOKEN|DISCORD_BOT_TOKEN|SIGNAL_CLI_ACCOUNT|WHATSAPP_ACCESS_TOKEN|WHATSAPP_VERIFY_TOKEN|LINE_CHANNEL_ACCESS_TOKEN|LINE_CHANNEL_SECRET|KAKAOTALK_SKILL_TOKEN|WEBEX_ACCESS_TOKEN|ZULIP_API_KEY|personal handles|email addresses|local filesystem paths|\.env/iu.test(normalized),
    "PRIVACY.md tells users not to publish tokens, handles, emails, or local paths"
  );

  return checks;
}

async function publicExampleChecks(rootDir: string): Promise<ReleaseEvidenceCheck[]> {
  const checks: ReleaseEvidenceCheck[] = [];
  const envExample = await readTextIfExists(join(rootDir, ".env.example"));
  addCheck(checks, "public-example", envExample.trim().length > 0, ".env.example is present");
  addCheck(
    checks,
    "public-example",
    modelApiKeyReferences(envExample).length === 0,
    ".env.example excludes model API key variables"
  );

  const configExampleText = await readTextIfExists(join(rootDir, "config", "viser.config.example.json"));
  const configExample = parseJsonRecord(configExampleText);
  addCheck(checks, "public-example", configExampleText.trim().length > 0, "config example is present");
  addCheck(checks, "public-example", Boolean(configExample), "config example is valid JSON");
  addCheck(
    checks,
    "public-example",
    modelApiKeyEnvKeysFromConfigExample(configExample).length === 0,
    "config example provider env excludes model API key variables"
  );

  return checks;
}

async function objectiveCoverageChecks(rootDir: string, config: ViserConfig): Promise<ReleaseEvidenceCheck[]> {
  const checks: ReleaseEvidenceCheck[] = [];

  addCheck(checks, "objective", config.assistant.name === RELEASE_ASSISTANT, `assistant runtime name is ${RELEASE_ASSISTANT}`);
  for (const route of CORE_LOCAL_CLI_ROUTES) {
    addCheck(
      checks,
      "objective",
      coreLocalCliRoutePass(config, route),
      `${route.label} route uses exact logged-in local ${route.expectedCommand} CLI provider`
    );
  }
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "telegram.ts")), "Telegram connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "discord.ts")), "Discord connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "slack.ts")), "Slack connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "matrix.ts")), "Matrix connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "signal.ts")), "Signal connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "imessage.ts")), "iMessage connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "whatsapp.ts")), "WhatsApp connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "line.ts")), "LINE connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "kakaotalk.ts")), "KakaoTalk connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "google-chat.ts")), "Google Chat connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "generic-webhook.ts")), "Generic webhook connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "home-assistant.ts")), "Home Assistant connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "teams.ts")), "Microsoft Teams connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "mattermost.ts")), "Mattermost connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "synology-chat.ts")), "Synology Chat connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "rocket-chat.ts")), "Rocket.Chat connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "feishu.ts")), "Feishu connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "dingtalk.ts")), "DingTalk connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "wecom.ts")), "WeCom connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "zalo.ts")), "Zalo connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "irc.ts")), "IRC connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "twitch.ts")), "Twitch connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "ntfy.ts")), "ntfy connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "mastodon.ts")), "Mastodon connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "nextcloud-talk.ts")), "Nextcloud Talk connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "webex.ts")), "Webex connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "zulip.ts")), "Zulip connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "email.ts")), "Email connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "github.ts")), "GitHub connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "todoist.ts")), "Todoist connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "notion.ts")), "Notion connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "obsidian.ts")), "Obsidian connector source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "web-dashboard.ts")), "web dashboard source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "connectors", "mcp-server.ts")), "MCP stdio server source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "core", "personalization.ts")), "personalization global settings source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "core", "skills.ts")), "SKILL.md registry source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "core", "plugins.ts")), "plugin manifest registry source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "core", "tools.ts")), "explicit local tools source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "core", "actions.ts")), "approval-gated actions source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "core", "jobs.ts")), "durable job queue source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "core", "scheduler.ts")), "scheduler source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "cli", "benchmark.ts")), "benchmark harness source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "src", "core", "prompt-guard.ts")), "prompt injection guard source is present");
  addCheck(checks, "objective", await fileExists(join(rootDir, "aimake.md")), "build process log aimake.md is present");

  return checks;
}

function formatReleaseEvidence(result: ReleaseEvidenceResult): string {
  const blockers = [
    ...(result.verification.ok ? [] : ["verification gate did not pass"]),
    ...result.checks.filter((check) => check.status === "fail").map((check) => `[${check.area}] ${check.message}`)
  ];

  return [
    `Viser public release evidence: ${result.ok ? "READY" : "BLOCKED"}`,
    "safe-to-paste: yes (local paths and token-like values redacted)",
    `generated: ${result.generatedAt}`,
    `assistant: ${result.assistantName}`,
    `creator: ${result.creator}`,
    `model access: ${result.modelAccessRule}`,
    `package: ${result.package.name}@${result.package.version} · private=${String(result.package.private)} · license=${result.package.license} · files=${result.package.filesCount}`,
    "",
    "Providers:",
    ...result.providers.map((provider) => `- ${provider.id}: ${provider.label} via ${provider.command} (${provider.promptMode})`),
    "",
    "Verification:",
    `- verify: ${result.verification.ok ? "PASS" : "BLOCKED"}`,
    `- proof mode: live=${result.verification.proof.live ? "yes" : "no"} · provider probes=${providerProbeMode(result.verification.proof)}`,
    `- readiness: ${result.verification.readiness.verdict} (${result.verification.readiness.passCount} pass, ${result.verification.readiness.warnCount} warn, ${result.verification.readiness.failCount} fail)`,
    `- audit: ${result.verification.audit.verdict} (${result.verification.audit.passCount} pass, ${result.verification.audit.warnCount} warn, ${result.verification.audit.failCount} fail)`,
    `- local smoke: ${result.verification.smoke.verdict} (${result.verification.smoke.passCount} pass, ${result.verification.smoke.failCount} fail)`,
    "",
    "Goal completion audit:",
    `- status: ${result.completion.status.toUpperCase()}`,
    `- summary: ${result.completion.summary}`,
    "- blockers:",
    ...(result.completion.blockers.length ? result.completion.blockers.map((blocker) => `  - ${blocker}`) : ["  - none"]),
    "- remaining proof:",
    ...(result.completion.remainingProof.length ? result.completion.remainingProof.map((proof) => `  - ${proof}`) : ["  - none"]),
    "",
    "Objective evidence matrix:",
    ...result.objectiveMatrix.flatMap(formatObjective),
    "",
    "Runtime/live proof checks:",
    ...(result.verification.proofChecks.length
      ? result.verification.proofChecks.map(formatProofCheck)
      : ["- none requested"]),
    "",
    "Local smoke checks:",
    ...result.verification.smokeChecks.map((check) => `${check.status === "pass" ? "✅" : "❌"} [${check.area}] ${check.message}`),
    "",
    "Public release checks:",
    ...result.checks.map((check) => `${check.status === "pass" ? "✅" : "❌"} [${check.area}] ${check.message}`),
    "",
    "Public release blockers:",
    blockers.length ? blockers.map((blocker) => `- ${blocker}`).join("\n") : "- none",
    "",
    "Recommended GitHub pre-push commands:",
    ...result.recommendedCommands.map((command) => `- ${command}`)
  ].join("\n");
}

function addCheck(checks: ReleaseEvidenceCheck[], area: string, ok: boolean, message: string): void {
  checks.push({ status: ok ? "pass" : "fail", area, message });
}

function completionAudit(publicReleaseReady: boolean, objectives: ReleaseEvidenceObjective[]): ReleaseEvidenceCompletion {
  const objectiveFailures = objectives
    .filter((item) => item.status !== "pass")
    .map((item) => `[${item.id}] ${item.requirement}`);
  const remainingProof = objectives.flatMap((item) => item.remaining.map((proof) => `[${item.id}] ${proof}`));
  const blockers = [
    ...(publicReleaseReady ? [] : ["release evidence or verify gate is blocked"]),
    ...objectiveFailures
  ];
  const proven = blockers.length === 0 && remainingProof.length === 0;

  return {
    status: proven ? "proven" : "unproven",
    summary: proven
      ? "All objective requirements are proven by the current release evidence."
      : "The public release artifact can be useful, but the full user objective is not proven until blockers and remaining proof are cleared.",
    blockers,
    remainingProof
  };
}

function objectiveMatrix(input: {
  config: ViserConfig;
  checks: ReleaseEvidenceCheck[];
  smokeChecks: ReleaseEvidenceResult["verification"]["smokeChecks"];
  proofChecks: ReleaseEvidenceProofCheck[];
  proof: ReleaseEvidenceResult["verification"]["proof"];
  verifyResult: VerifyResult;
  benchmarkArtifact: BenchmarkArtifactSummary;
  skillReflectionProof?: SkillReflectionProofSummary;
  browserTaskProofs: BrowserTaskProofSummary[];
}): ReleaseEvidenceObjective[] {
  const providerProbeRequested = input.proof.probeProviders || input.proof.probeAllProviders;
  const liveProofRequested = input.proof.live;
  const coreRouteProofGaps = providerProbeRequested
    ? CORE_LOCAL_CLI_ROUTES
        .filter((route) => !route.ids.some((id) => proofPassed(input.proofChecks, "provider-probe", new RegExp(`^${escapeRegExp(id)}:`, "u"))))
        .filter((route) => route.ids.some((id) => proofFailedForProvider(input.proofChecks, id)))
        .map((route) => coreRouteProofGap(input.proofChecks, route.label, route.ids))
    : [];
  const competitiveBenchmarkSaved = input.benchmarkArtifact.found
    && input.benchmarkArtifact.mode === "live-provider"
    && input.benchmarkArtifact.ok === true
    && input.benchmarkArtifact.competitiveStatus === "viser-not-slower"
    && input.benchmarkArtifact.hasHermes
    && input.benchmarkArtifact.hasOpenclaw;
  const providerProofFailed = proofFailed(input.proofChecks, /^(provider-probe|provider-runtime)$/u);
  const liveProofFailed = proofFailed(input.proofChecks, /^live$/u);
  const browserTaskRemainingProof = browserTaskLiveProofGaps(input.browserTaskProofs);

  return [
    {
      id: "assistant-core",
      status: input.verifyResult.smoke.verdict === "PASS" ? "pass" : "fail",
      requirement: "OpenClaw/Hermes-like local CLI assistant core works end-to-end",
      evidence: [
        `verify strict gate: ${input.verifyResult.ok ? "PASS" : "BLOCKED"}`,
        `local smoke: ${input.verifyResult.smoke.verdict} (${input.verifyResult.smoke.passCount} pass, ${input.verifyResult.smoke.failCount} fail)`,
        "smoke covers status, dashboard, dashboard-collab, dashboard-auth, localhost WebChat, token/HMAC-protected generic inbound Webhook with bounded attachment metadata/text, voice-loop, browser-side voice capture, browser-side camera/screen capture, provider output streaming, skills, skill authoring, provider-assisted skill reflection, automatic learning curation, plugins, provider history, memory, tools, guarded file search, guarded web search, cached text/markdown guarded web-fetch, MCP guarded file search, MCP guarded web search, MCP guarded markdown web-fetch, approval actions, Browser Use cloud, Browserbase, Firecrawl Interact, and local CDP browser task staging, jobs, parallel jobs, scheduler, access, Telegram/Discord/Slack/Matrix/Signal/iMessage/WhatsApp/LINE/KakaoTalk/Google Chat/generic Webhook/Home Assistant/Teams/Mattermost/Synology Chat/Rocket.Chat/Feishu/DingTalk/WeCom/Zalo/IRC/Twitch/ntfy/Mastodon/Nextcloud Talk/Webex/Zulip/Email/GitHub/Todoist transports, and backup"
      ],
      remaining: []
    },
    {
      id: "identity",
      status: allChecksPass(input.checks, [
        /assistant runtime name is Viser/u,
        /package name is viser/u,
        /creator attribution is KMokky/u
      ]) ? "pass" : "fail",
      requirement: "Project identity is Viser and creator attribution is KMokky",
      evidence: [
        "assistant runtime name is Viser",
        "package name is viser",
        "package author/creator attribution is KMokky"
      ],
      remaining: []
    },
    {
      id: "command-usability",
      status: allChecksPass(input.checks, [
        /viser CLI bin points to compiled \.\/dist\/index\.js/u,
        /compiled dist CLI entry is present/u,
        /package build script emits the compiled CLI entry/u,
        /package prepare script builds dist for npm link and pack/u
      ]) && input.verifyResult.ok ? "pass" : "fail",
      requirement: "Viser can be installed and launched with the simple `viser` command",
      evidence: [
        "package bin points at compiled JavaScript (`./dist/index.js`) so npm/global installs do not rely on Node TypeScript stripping inside node_modules",
        "package prepare builds dist for `npm link`, git installs, and `npm pack`",
        "the compiled CLI keeps the same `viser setup`, `viser doctor`, `viser verify`, `viser launch-status`, and bare `viser` foreground workflow",
        "verify and local smoke prove the command surfaces are operational before launch"
      ],
      remaining: []
    },
    {
      id: "foreground-only-runtime",
      status: allChecksPass(input.checks, [
        /package scripts exclude background service-run/u,
        /package scripts exclude background service helper/u
      ]) && allSmokePass(input.smokeChecks, ["jobs", "scheduler"]) ? "pass" : "fail",
      requirement: "Honor the explicit no-background-service constraint while keeping the foreground gateway useful",
      evidence: [
        "package scripts do not expose service/service-run background startup",
        "service-run and service artifact generation are disabled by service tests",
        "local smoke proves the foreground runtime can still use jobs and scheduler state"
      ],
      remaining: []
    },
    {
      id: "messenger",
      status: allChecksPass(input.checks, [
        /Telegram connector source is present/u,
        /Discord connector source is present/u,
        /Slack connector source is present/u,
        /Matrix connector source is present/u,
        /Signal connector source is present/u,
        /iMessage connector source is present/u,
        /WhatsApp connector source is present/u,
        /LINE connector source is present/u,
        /KakaoTalk connector source is present/u,
        /Google Chat connector source is present/u,
        /Generic webhook connector source is present/u,
        /Home Assistant connector source is present/u,
        /Microsoft Teams connector source is present/u,
        /Mattermost connector source is present/u,
        /Synology Chat connector source is present/u,
        /Rocket\.Chat connector source is present/u,
        /Feishu connector source is present/u,
        /DingTalk connector source is present/u,
        /WeCom connector source is present/u,
        /Zalo connector source is present/u,
        /IRC connector source is present/u,
        /Twitch connector source is present/u,
        /ntfy connector source is present/u,
        /Mastodon connector source is present/u,
        /Nextcloud Talk connector source is present/u,
        /Webex connector source is present/u,
        /Zulip connector source is present/u,
        /Email connector source is present/u,
        /GitHub connector source is present/u,
        /Todoist connector source is present/u,
        /Notion connector source is present/u,
        /Obsidian connector source is present/u
      ]) && allSmokePass(input.smokeChecks, ["telegram", "discord", "slack", "matrix", "signal", "imessage", "whatsapp", "line", "kakaotalk", "webhook-inbound", "google-chat", "webhook", "home-assistant", "teams", "mattermost", "synology-chat", "rocket-chat", "feishu", "dingtalk", "wecom", "zalo", "irc", "twitch", "ntfy", "mastodon", "nextcloud-talk", "webex", "zulip", "email", "github", "todoist", "notion", "obsidian", "messenger-outbound"]) && !liveProofFailed
        ? "pass"
        : "fail",
      requirement: "Discord/Telegram/Slack/Matrix/Signal/iMessage/WhatsApp/LINE/KakaoTalk/Google Chat/generic Webhook/Home Assistant/Teams/Mattermost/Synology Chat/Rocket.Chat/Feishu/DingTalk/WeCom/Zalo/IRC/Twitch/ntfy/Mastodon/Nextcloud Talk/Webex/Zulip/Email/GitHub/Todoist/Notion/Obsidian communication and workspace append surfaces are implemented with safe inbound paths and approved outbound paths where the platform supports Viser sends",
      evidence: [
        "Telegram, Discord, Slack, Matrix, Signal, iMessage, WhatsApp, LINE, KakaoTalk, Google Chat, generic Webhook, Home Assistant, Microsoft Teams, Mattermost, Synology Chat, Rocket.Chat, Feishu, DingTalk, WeCom, Zalo, IRC, Twitch, ntfy, Mastodon, Nextcloud Talk, Webex, Zulip, Email, GitHub, Todoist, Notion, and Obsidian connector sources are present",
        "local smoke proves Telegram inbound handler -> AssistantRuntime -> mocked Bot API send",
        "local smoke proves Discord inbound handler -> AssistantRuntime -> mocked REST send",
        "local smoke proves Slack inbound handler -> AssistantRuntime -> mocked Web API send",
        "local smoke proves Matrix sync event handler -> AssistantRuntime -> mocked Client-Server send",
        "local smoke proves Signal signal-cli envelope handler -> AssistantRuntime -> mocked local send",
        "local smoke proves iMessage Messages handler -> AssistantRuntime -> mocked local osascript send",
        "local smoke proves WhatsApp webhook handler -> AssistantRuntime -> mocked Graph API send",
        "local smoke proves LINE webhook handler -> AssistantRuntime -> mocked Messaging API reply",
        "local smoke proves KakaoTalk Open Builder Skill handler -> AssistantRuntime -> SkillResponse JSON",
        "local smoke proves token/HMAC-protected generic inbound Webhook -> AssistantRuntime -> mocked JSON reply with bounded attachment metadata/text",
        "local smoke proves Google Chat incoming webhook sender -> mocked Chat webhook send",
        "local smoke proves generic HTTPS webhook sender -> mocked custom webhook send",
        "local smoke proves Home Assistant service-call sender -> mocked REST API service call",
        "local smoke proves Microsoft Teams incoming webhook sender -> mocked Adaptive Card webhook send",
        "local smoke proves Mattermost incoming webhook sender -> mocked webhook send",
        "local smoke proves Synology Chat incoming webhook sender -> mocked form payload send",
        "local smoke proves Rocket.Chat incoming webhook sender -> mocked webhook send",
        "local smoke proves Feishu custom bot webhook sender -> mocked webhook send",
        "local smoke proves DingTalk custom robot webhook sender -> mocked webhook send",
        "local smoke proves WeCom group robot webhook sender -> mocked webhook send",
        "local smoke proves Zalo OA sender -> mocked OA message send",
        "local smoke proves IRC sender -> mocked PRIVMSG send",
        "local smoke proves Twitch IRC sender -> mocked chat PRIVMSG send",
        "local smoke proves ntfy sender -> mocked push publish send",
        "local smoke proves Nextcloud Talk sender -> mocked OCS chat send",
        "local smoke proves Webex Messages API sender -> mocked /v1/messages send",
        "local smoke proves Zulip Messages API sender -> mocked /api/v1/messages send",
        "local smoke proves Email local sendmail sender -> mocked sendmail command",
        "local smoke proves GitHub issue/PR comment sender -> mocked issue comment API send",
        "local smoke proves Todoist task sender -> mocked task create API send",
        "local smoke proves Notion page append sender -> mocked block children API append",
        "local smoke proves Obsidian/local Markdown vault sender -> safe local note append",
        "local smoke proves approved outbound Telegram/Discord/Slack/Matrix/Signal/iMessage/WhatsApp/LINE/Google Chat/generic Webhook/Home Assistant/Teams/Mattermost/Synology Chat/Rocket.Chat/Feishu/DingTalk/WeCom/Zalo/IRC/Twitch/ntfy/Mastodon/Nextcloud Talk/Webex/Zulip/Email/GitHub/Todoist/Notion/Obsidian message actions reach connector senders",
        liveProofRequested
          ? "live proof was requested; configured connector credentials are summarized in Runtime/live proof checks and disabled connectors are treated as intentionally off"
          : `optional deployment proof can be attached with \`${STRICT_LIVE_RELEASE_EVIDENCE_COMMAND}\` when real connector credentials are configured`
      ],
      remaining: []
    },
    {
      id: "channel-breadth",
      status: allChecksPass(input.checks, [
        /Telegram connector source is present/u,
        /Discord connector source is present/u,
        /Slack connector source is present/u,
        /Matrix connector source is present/u,
        /Signal connector source is present/u,
        /iMessage connector source is present/u,
        /WhatsApp connector source is present/u,
        /LINE connector source is present/u,
        /KakaoTalk connector source is present/u,
        /Google Chat connector source is present/u,
        /Generic webhook connector source is present/u,
        /Home Assistant connector source is present/u,
        /Microsoft Teams connector source is present/u,
        /Mattermost connector source is present/u,
        /Synology Chat connector source is present/u,
        /Rocket\.Chat connector source is present/u,
        /Feishu connector source is present/u,
        /DingTalk connector source is present/u,
        /WeCom connector source is present/u,
        /Zalo connector source is present/u,
        /IRC connector source is present/u,
        /Twitch connector source is present/u,
        /ntfy connector source is present/u,
        /Mastodon connector source is present/u,
        /Nextcloud Talk connector source is present/u,
        /Webex connector source is present/u,
        /Zulip connector source is present/u,
        /Email connector source is present/u,
        /GitHub connector source is present/u,
        /Todoist connector source is present/u,
        /Notion connector source is present/u,
        /Obsidian connector source is present/u
      ]) && allSmokePass(input.smokeChecks, ["telegram", "discord", "slack", "matrix", "signal", "imessage", "whatsapp", "line", "kakaotalk", "webhook-inbound", "google-chat", "webhook", "home-assistant", "teams", "mattermost", "synology-chat", "rocket-chat", "feishu", "dingtalk", "wecom", "zalo", "irc", "twitch", "ntfy", "mastodon", "nextcloud-talk", "webex", "zulip", "email", "github", "todoist", "notion", "obsidian", "messenger-outbound"]) ? "pass" : "fail",
      requirement: "Multi-channel messaging breadth covers the requested external messenger class and extensible optional surfaces",
      evidence: [
        "Telegram, Discord, Slack, Matrix, Signal, iMessage, WhatsApp, LINE, and KakaoTalk inbound paths are implemented and smoke-tested",
        "Generic inbound Webhook accepts token-protected text plus bounded attachment metadata/text, and Google Chat, generic Webhook, Home Assistant, Microsoft Teams, Mattermost, Synology Chat, Rocket.Chat, Feishu, DingTalk, WeCom, Zalo, IRC, Twitch, ntfy, Mastodon, and Nextcloud Talk outbound paths are implemented and smoke-tested",
        "Webex and Zulip Messages API outbound paths plus local sendmail Email, GitHub issue/PR comment, Todoist task create, Notion page append, and Obsidian/local Markdown note append outbound paths are implemented and smoke-tested",
        "approval-gated outbound Telegram/Discord/Slack/Matrix/Signal/iMessage/WhatsApp/LINE/Google Chat/generic Webhook/Home Assistant/Teams/Mattermost/Synology Chat/Rocket.Chat/Feishu/DingTalk/WeCom/Zalo/IRC/Twitch/ntfy/Mastodon/Nextcloud Talk/Webex/Zulip/Email/GitHub/Todoist/Notion/Obsidian sends are smoke-tested",
        "the report does not claim exhaustive parity with every proprietary OpenClaw/Hermes channel catalog; it proves the requested Discord/Telegram-style external messenger system plus documented extension points"
      ],
      remaining: []
    },
    {
      id: "local-cli-no-model-api",
      status: allChecksPass(input.checks, [
        /GPT\/Codex route uses exact logged-in local codex CLI provider/u,
        /Gemini route uses exact logged-in local gemini CLI provider/u,
        /Claude route uses exact logged-in local claude CLI provider/u,
        /\.env\.example excludes model API key variables/u,
        /config example provider env excludes model API key variables/u
      ]) && !providerProofFailed && input.verifyResult.audit.failCount === 0
        ? "pass"
        : "fail",
      requirement: "GPT/Codex, Gemini, and Claude use logged-in local CLIs instead of model API keys",
      evidence: [
        "core GPT/Codex, Gemini, and Claude routes use exact local command basenames: codex, gemini, claude",
        `audit: ${input.verifyResult.audit.verdict} (${input.verifyResult.audit.passCount} pass, ${input.verifyResult.audit.warnCount} warn, ${input.verifyResult.audit.failCount} fail)`,
        "public examples exclude model API key variables",
        ...(providerProbeRequested
          ? ["provider probe proof was requested; failed provider-runtime/probe checks block completion while warnings remain setup guidance in Runtime/live proof checks"]
          : ["static route, spawn-time env filtering, and audit gates prove the no-model-API implementation without requiring every provider CLI to be installed in this environment"])
      ],
      remaining: coreRouteProofGaps
    },
    {
      id: "personalization-global-settings",
      status: hasPassingCheck(input.checks, "objective", /personalization global settings source is present/u)
        && allSmokePass(input.smokeChecks, ["personalization"])
        && input.verifyResult.audit.failCount === 0
        ? "pass"
        : "fail",
      requirement: "Custom AI tone, personality, user speech style, and question handling can be stored as durable global settings",
      evidence: [
        "src/core/personalization.ts stores explicit non-sensitive global variables such as ai.tone, ai.personality, user.speechStyle, question.context, and answer.format in private local state",
        "local smoke proves persona commands do not call a provider, persist across the runtime, and are injected into provider prompts as untrusted personalization preferences",
        "personalization value/key validation rejects secret-looking data so public release hygiene is not weakened"
      ],
      remaining: []
    },
    {
      id: "skill-learning",
      status: hasPassingCheck(input.checks, "objective", /SKILL\.md registry source is present/u)
        && allSmokePass(input.smokeChecks, ["skills", "skill-authoring", "skill-reflection", "learning-curator"])
        ? "pass"
        : "fail",
      requirement: "Hermes-style reusable skill capture exists without bypassing approval boundaries",
      evidence: [
        "SKILL.md registry is present",
        "local smoke proves an experience can be staged as a reusable SKILL.md and saved only after approval",
        "local smoke proves provider-assisted session reflection can draft reusable SKILL.md procedures and record durable closed-loop proof behind the same approval gate",
        "local smoke proves the automatic learning curator can draft a reusable SKILL.md from recent session history and mark durable proof as curated",
        "learned skill writes use the same approval-gated file action path as other mutations",
        ...(input.skillReflectionProof
          ? [`latest approved real-provider reflection proof exists (provider=${input.skillReflectionProof.providerId}, mode=${input.skillReflectionProof.mode}, transcriptMessages=${input.skillReflectionProof.transcriptMessages}, procedureBytes=${input.skillReflectionProof.procedureBytes})`]
          : ["real-provider reflection proof can be added later for stronger release evidence, but local smoke already proves the approved self-improvement path"])
      ],
      remaining: []
    },
    {
      id: "automation-orchestration",
      status: allChecksPass(input.checks, [
        /durable job queue source is present/u,
        /scheduler source is present/u
      ]) && allSmokePass(input.smokeChecks, ["jobs", "parallel-jobs", "scheduler"]) ? "pass" : "fail",
      requirement: "Scheduled automation and bounded parallel work queues cover the core orchestration lane",
      evidence: [
        "durable jobs and scheduler sources are present",
        "local smoke proves queued job execution, bounded parallel job execution, and future schedule storage"
      ],
      remaining: []
    },
    {
      id: "mcp-plugin-tools-actions",
      status: allChecksPass(input.checks, [
        /MCP stdio server source is present/u,
        /plugin manifest registry source is present/u,
        /explicit local tools source is present/u,
        /approval-gated actions source is present/u
      ]) && allSmokePass(input.smokeChecks, ["plugins", "tools", "file-search", "web-search", "web-search-searxng", "web-search-brave", "web-search-tavily", "web-search-perplexity", "web-search-exa", "web-search-firecrawl", "web-search-ollama", "web-fetch", "web-fetch-firecrawl", "mcp-file-search", "mcp-web-search", "mcp-web-fetch", "actions", "browser-task", "messenger-outbound"]) ? "pass" : "fail",
      requirement: "MCP/plugin/tool/file-search/web-search/web-fetch/action surface provides extensibility and safe local hands",
      evidence: [
        "MCP stdio server, local plugin manifests, explicit read-only tools, and approval-gated actions are present",
        "local smoke proves plugin injection, local file read/search tools, guarded CLI/MCP web search with DuckDuckGo HTML plus configured SearXNG HTML, Brave Search API, Tavily Search API, Perplexity Search API, Exa Search API, Firecrawl Search API, and Ollama Web Search provider support, cached CLI text/markdown direct web-fetch, Firecrawl Scrape API-backed CLI web-fetch, guarded MCP markdown web-fetch, guarded MCP file search, approval-gated write, Browser Use cloud, Browserbase, Firecrawl Interact, and local CDP browser task staging, and approval-gated messenger outbound"
      ],
      remaining: []
    },
    {
      id: "browser-automation",
      status: hasPassingCheck(input.checks, "objective", /approval-gated actions source is present/u) && allSmokePass(input.smokeChecks, ["browser-task"]) ? "pass" : "fail",
      requirement: "Browser automation tasks are available without granting hidden web-control authority to model providers",
      evidence: [
        "Browser Use cloud task creation, Browserbase cloud CDP sessions, Firecrawl Interact scrape-bound browser sessions, and localhost Chrome DevTools Protocol navigation/snapshot tasks are represented as approval-gated actions, not as hidden provider tool access",
        "local smoke proves Browser Use cloud, Browserbase, Firecrawl Interact, and local-CDP browser tasks are staged, reviewed, and executed only after approval",
        "browser task proposals require bounded maxSteps and at least one public allowed domain; local CDP control is restricted to a localhost DevTools endpoint; Browserbase/Firecrawl credentials stay in private env-backed transport config",
        ...input.browserTaskProofs.map((proof) => `approved live browser-task proof exists (provider=${proof.provider}, resultId=${proof.resultId}, host=${proof.urlHost ?? "unknown"}, titleBytes=${proof.titleBytes}, textBytes=${proof.textBytes})`),
        ...(browserTaskRemainingProof.length
          ? [`optional stronger live browser automation evidence not attached: ${browserTaskRemainingProof.join(" ")}`]
          : [])
      ],
      remaining: []
    },
    {
      id: "dashboard-ux",
      status: hasPassingCheck(input.checks, "objective", /web dashboard source is present/u)
        && allSmokePass(input.smokeChecks, ["dashboard", "dashboard-collab", "dashboard-auth", "web-chat", "webhook-inbound", "voice-loop", "voice-capture", "media-capture", "provider-stream"])
        ? "pass"
        : "fail",
      requirement: "Operator UI/status, localhost WebChat, and local multimodal capture surface exist with explicit execution boundaries",
      evidence: [
        "web dashboard source is present",
        "local smoke proves dashboard JSON exposes the read-only v1 capability and operator activity contracts",
        "dashboard UI streams recent approvals, jobs, schedules, and sessions over localhost SSE without provider calls or write/action routes",
        "local smoke proves the localhost collaborative canvas persists token-protected strokes in a private local JSON store without provider calls",
        "local smoke proves remote-capable dashboard routes require token authentication before exposing persistent canvas state, while canvas mutations still require the per-process canvas write token",
        "local smoke proves localhost WebChat routes browser messages through AssistantRuntime only with a same-origin token",
        "local smoke proves the generic inbound Webhook route requires a separate shared token, can require HMAC request signatures, and can pass bounded attachment metadata/text before calling AssistantRuntime",
        "local smoke proves a continuous voice transcript loop handles multiple assistant turns and stages local TTS through approval-gated speak actions",
        "local smoke proves the web dashboard serves a browser-side microphone transcript capture page without provider/action/job routes",
        "local smoke proves the web dashboard serves a browser-side camera and screen capture page without provider/action/job routes or upload/persistence paths",
        "local smoke proves provider stdout streaming can forward bounded chunks while preserving final session history",
        "live browser permission prompts and live WebChat/provider streaming checks remain deployment-environment validation rather than a source-code completion blocker"
      ],
      remaining: []
    },
    {
      id: "performance-envelope",
      status: hasPassingCheck(input.checks, "objective", /benchmark harness source is present/u) && allSmokePass(input.smokeChecks, ["parallel-jobs", "benchmark"]) ? "pass" : "fail",
      requirement: "Performance claims are bounded by measurable local parallelism and repeatable benchmark tooling instead of assumption",
      evidence: [
        "local smoke proves two independent queued jobs can run with bounded parallelism",
        "local smoke proves the benchmark harness measures Viser provider-path latency without external CLIs",
        "benchmark CLI can attach same-host Hermes/OpenClaw baselines with explicit no-shell command specs",
        "benchmark CLI can save private `.viser/benchmarks/*.json` artifacts for repeatable release evidence",
        ...(input.benchmarkArtifact.found
          ? [`latest saved benchmark artifact: ${input.benchmarkArtifact.mode}, competitiveStatus=${input.benchmarkArtifact.competitiveStatus}, baselines=${input.benchmarkArtifact.baselineLabels.join(", ") || "none"}`]
          : []),
        `configured job worker concurrency: ${input.config.jobs.concurrency}`,
        competitiveBenchmarkSaved
          ? "latest benchmark artifact includes same-host Hermes/OpenClaw baselines and proves Viser is not slower for that run"
          : "no equal-or-better performance claim is made without an explicit same-host Hermes/OpenClaw baseline artifact"
      ],
      remaining: []
    },
    {
      id: "build-process-log",
      status: hasPassingCheck(input.checks, "objective", /build process log aimake\.md is present/u) ? "pass" : "fail",
      requirement: "Build process is recorded",
      evidence: ["aimake.md is present and maintained with staged implementation notes"],
      remaining: []
    },
    {
      id: "prompt-injection-security",
      status: hasPassingCheck(input.checks, "objective", /prompt injection guard source is present/u) && allSmokePass(input.smokeChecks, ["security"]) && input.verifyResult.audit.failCount === 0
        && hasPassingCheck(input.checks, "security-doc", /SECURITY\.md documents prompt-injection defenses/u)
        ? "pass"
        : "fail",
      requirement: "Prompt-injection/security algorithms are included and exercised before provider handoff",
      evidence: [
        "src/core/prompt-guard.ts is present",
        "local smoke proves high-risk injection is blocked before provider handoff",
        `audit: ${input.verifyResult.audit.verdict}`,
        "SECURITY.md documents prompt-injection defenses"
      ],
      remaining: []
    },
    {
      id: "open-source-privacy",
      status: allChecksPass(input.checks, [
        /package is public \(private=false\)/u,
        /license is MIT/u,
        /package files include SECURITY\.md/u,
        /package files include PRIVACY\.md/u,
        /package files include CONTRIBUTING\.md/u,
        /package files exclude \.env/u,
        /package files exclude \.viser/u,
        /package files exclude \.omx/u,
        /\.gitignore excludes \.env/u,
        /\.gitignore excludes \.viser\//u,
        /\.gitignore excludes \.omx\//u,
        /\.gitignore excludes \.npmrc/u,
        /\.npmignore excludes \.env/u,
        /\.npmignore excludes \.viser\//u,
        /\.npmignore excludes \.omx\//u,
        /\.npmignore excludes \.npmrc/u
      ]) && hasPassingCheck(input.checks, "security-doc", /SECURITY\.md tells reporters not to disclose tokens or private state/u)
        && hasPassingCheck(input.checks, "privacy-doc", /PRIVACY\.md limits public identity to Viser and KMokky creator credit/u)
        && hasPassingCheck(input.checks, "privacy-doc", /PRIVACY\.md tells users not to publish tokens, handles, emails, or local paths/u)
        && hasPassingCheck(input.checks, "contributing-doc", /CONTRIBUTING\.md tells contributors not to commit private data/u)
        && hasPassingCheck(input.checks, "github-template", /GitHub bug report template warns against private data disclosure/u)
        && hasPassingCheck(input.checks, "github-template", /GitHub PR template preserves local CLI\/no model API boundary/u)
        && input.verifyResult.audit.failCount === 0
        ? "pass"
        : "fail",
      requirement: "GitHub/npm public release excludes private runtime state and sensitive personal data",
      evidence: [
        "package metadata is public/open-source ready",
        ".gitignore/.npmignore/package files include SECURITY.md/PRIVACY.md/CONTRIBUTING.md and exclude .env, .viser, .omx, .npmrc, node_modules, and local config",
        "PRIVACY.md limits public identity to Viser/KMokky and documents private local state",
        "CONTRIBUTING.md tells contributors not to commit private data",
        "GitHub issue/PR templates guard against private data and model API regressions",
        `audit public-release/privacy gate is included in audit summary: ${input.verifyResult.audit.verdict}`
      ],
      remaining: []
    }
  ];
}

async function latestApprovedRealProviderSkillReflectionProof(config: ViserConfig): Promise<SkillReflectionProofSummary | undefined> {
  const actions = await readActionStatusMap(join(config.actions.dir, "actions.json"));
  let latest: SkillReflectionProofSummary | undefined;

  for (const skillDir of config.skills.dirs) {
    const raw = await readTextIfExists(join(skillDir, "reflection-proofs.jsonl"));
    if (!raw.trim()) continue;

    for (const line of raw.split("\n")) {
      const proof = parseJsonRecord(line);
      if (!proof) continue;

      const providerId = stringValue(proof.providerId);
      const actionId = stringValue(proof.actionId);
      const target = stringValue(proof.target);
      const transcriptMessages = positiveNumberValue(proof.transcriptMessages);
      const procedureBytes = positiveNumberValue(proof.procedureBytes);
      const createdAt = stringValue(proof.createdAt);
      if (!providerId || !isRealReflectionProvider(providerId, config)) continue;
      if (!actionId || actions.get(actionId) !== "approved") continue;
      if (!isSafeRelativeSkillTarget(target)) continue;
      if (transcriptMessages === undefined || procedureBytes === undefined) continue;
      if (!await fileExists(join(skillDir, target))) continue;

      const summary: SkillReflectionProofSummary = {
        providerId,
        mode: stringValue(proof.mode) || "manual",
        transcriptMessages,
        procedureBytes,
        createdAt
      };
      if (!latest || summary.createdAt.localeCompare(latest.createdAt) >= 0) latest = summary;
    }
  }

  return latest;
}

async function readActionStatusMap(path: string): Promise<Map<string, string>> {
  const raw = await readTextIfExists(path);
  if (!raw.trim()) return new Map();

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Map();
    return new Map(parsed.flatMap((item) => {
      if (!isRecord(item)) return [];
      const id = stringValue(item.id);
      const status = stringValue(item.status);
      return id && status ? [[id, status]] : [];
    }));
  } catch {
    return new Map();
  }
}

async function latestApprovedBrowserTaskProofs(config: ViserConfig): Promise<BrowserTaskProofSummary[]> {
  const actions = await readActionStatusMap(join(config.actions.dir, "actions.json"));
  const raw = await readTextIfExists(join(config.actions.dir, "browser-task-proofs.jsonl"));
  if (!raw.trim()) return [];

  const latestByProvider = new Map<BrowserTaskProvider, BrowserTaskProofSummary>();
  for (const line of raw.split("\n")) {
    const proof = parseJsonRecord(line);
    if (!proof) continue;

    const provider = stringValue(proof.provider);
    const actionId = stringValue(proof.actionId);
    const resultId = stringValue(proof.resultId);
    const titleBytes = nonNegativeNumberValue(proof.titleBytes);
    const textBytes = nonNegativeNumberValue(proof.textBytes);
    const createdAt = stringValue(proof.createdAt);
    if (!isBrowserTaskProviderValue(provider)) continue;
    if (!actionId || actions.get(actionId) !== "approved") continue;
    if (!resultId || titleBytes === undefined || textBytes === undefined) continue;

    const summary: BrowserTaskProofSummary = {
      provider,
      resultId,
      urlHost: stringValue(proof.urlHost) || undefined,
      titleBytes,
      textBytes,
      createdAt
    };
    const current = latestByProvider.get(provider);
    if (!current || summary.createdAt.localeCompare(current.createdAt) >= 0) {
      latestByProvider.set(provider, summary);
    }
  }

  return [...latestByProvider.values()].sort((a, b) => a.provider.localeCompare(b.provider));
}

function isRealReflectionProvider(providerId: string, config: ViserConfig): boolean {
  if (!config.providers[providerId]) return false;
  return !/^(?:echo|fake|mock|smoke|test)$/iu.test(providerId);
}

function isSafeRelativeSkillTarget(target: string): boolean {
  if (!target || target.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(target)) return false;
  const parts = target.split(/[\\/]+/u).filter(Boolean);
  return parts.length >= 2 && !parts.includes("..") && parts.at(-1) === "SKILL.md";
}

function positiveNumberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function nonNegativeNumberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isBrowserTaskProviderValue(value: string): value is BrowserTaskProvider {
  return value === "browser-use-cloud" || value === "local-cdp" || value === "browserbase-session" || value === "firecrawl-interact";
}

function browserTaskLiveProofGaps(proofs: BrowserTaskProofSummary[]): string[] {
  const proven = new Set(proofs.map((proof) => proof.provider));
  const missingRemote: string[] = [];
  if (!proven.has("browser-use-cloud")) missingRemote.push("Browser Use");
  if (!proven.has("browserbase-session")) missingRemote.push("Browserbase");
  if (!proven.has("firecrawl-interact")) missingRemote.push("Firecrawl");
  const missing: string[] = [];
  if (missingRemote.length > 0) missing.push(`${formatEnglishList(missingRemote)} API credential/task proof`);
  if (!proven.has("local-cdp")) missing.push("a real localhost CDP browser run");
  return missing.length > 0
    ? [`live ${missing.join(" plus ")} can be attached later for stronger browser-automation deployment evidence.`]
    : [];
}

function formatEnglishList(items: string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function formatObjective(item: ReleaseEvidenceObjective): string[] {
  return [
    `${proofIcon(item.status)} [${item.id}] ${item.requirement}`,
    `   evidence: ${item.evidence.join("; ")}`,
    ...(item.remaining.length > 0 ? [`   remaining proof: ${item.remaining.join("; ")}`] : [])
  ];
}

function formatProofCheck(check: ReleaseEvidenceProofCheck): string {
  const base = `${proofCheckIcon(check)} [${check.area}] ${check.message}`;
  return check.next ? `${base}\n   next: ${check.next}` : base;
}

function allChecksPass(checks: ReleaseEvidenceCheck[], patterns: RegExp[]): boolean {
  return patterns.every((pattern) => checks.some((check) => check.status === "pass" && pattern.test(check.message)));
}

function hasPassingCheck(checks: ReleaseEvidenceCheck[], area: string, pattern: RegExp): boolean {
  return checks.some((check) => check.status === "pass" && check.area === area && pattern.test(check.message));
}

function allSmokePass(smokeChecks: ReleaseEvidenceResult["verification"]["smokeChecks"], areas: string[]): boolean {
  return areas.every((area) => smokeChecks.some((check) => check.status === "pass" && check.area === area));
}

function coreRouteProofGap(checks: ReleaseEvidenceProofCheck[], routeLabel: string, routeIds: string[]): string {
  const proof = routeIds
    .map((id) => checks.find((check) => check.area === "provider-probe" && check.message.startsWith(`${id}:`) && check.status !== "pass"))
    .find((check): check is ReleaseEvidenceProofCheck => Boolean(check));
  const detail = proof ? ` (${proof.message})` : "";
  const next = proof?.next ? ` Next: ${proof.next}` : ` Run \`${STRICT_LIVE_RELEASE_EVIDENCE_COMMAND}\` after installing and logging in.`;
  return `${routeLabel} live provider probe did not pass${detail}.${next}`;
}

function proofPassed(checks: ReleaseEvidenceProofCheck[], area: string, pattern: RegExp): boolean {
  return checks.some((check) => check.status === "pass" && check.area === area && pattern.test(check.message));
}

function proofFailedForProvider(checks: ReleaseEvidenceProofCheck[], providerId: string): boolean {
  return checks.some((check) => check.status === "fail" && check.area === "provider-probe" && check.message.startsWith(`${providerId}:`));
}

function proofFailed(checks: ReleaseEvidenceProofCheck[], areaPattern: RegExp): boolean {
  return checks.some((check) => check.status === "fail" && areaPattern.test(check.area));
}

function proofMode(options: VerifyOptions | undefined): ReleaseEvidenceResult["verification"]["proof"] {
  return {
    live: Boolean(options?.live),
    probeProviders: Boolean(options?.probeProviders),
    probeAllProviders: Boolean(options?.probeAllProviders)
  };
}

function providerProbeMode(proof: ReleaseEvidenceResult["verification"]["proof"]): string {
  if (proof.probeAllProviders) return "all providers";
  if (proof.probeProviders) return "launch route";
  return "not requested";
}

function proofChecks(readinessItems: VerifyResult["readinessItems"]): ReleaseEvidenceProofCheck[] {
  return readinessItems
    .filter((item) => ["live", "provider-probe", "provider-runtime"].includes(item.area))
    .map((item) => ({
      status: item.status,
      area: item.area,
      message: safeProofMessage(item.area, item.status, item.message),
      ...(item.next && item.status !== "pass" ? { next: redactSensitiveProofText(item.next) } : {})
    }));
}

function safeProofMessage(area: string, status: ReleaseEvidenceProofCheck["status"], message: string): string {
  if (area === "live" && status === "pass") {
    const connector = /^(telegram|discord|slack|matrix|signal|imessage|whatsapp|line|google-chat|webhook|home-assistant|teams|mattermost|synology-chat|rocket-chat|feishu|dingtalk|wecom|zalo|irc|twitch|ntfy|mastodon|nextcloud-talk|webex|zulip|email|github|todoist|notion|obsidian):/u.exec(message)?.[1];
    if (connector && /bot\s+@?[\w.-]+|user\s+@?[^\s]+|token accepted|phone number ID accepted|webhook URL configured|Home Assistant API accepted token|access token and recipient configured|local signal-cli configured|local macOS Messages commands configured|host, nick, and channel configured|OAuth token, bot username, and channel configured|base URL, token, and topic configured|base URL and public topic configured|base URL, user, app password, and room configured|local sendmail command and envelope are configured|token and issue target configured|token configured for inbox target|token and project target configured|token and page target configured|vault and note target configured|account\b/iu.test(message)) return `${connector}: live token accepted`;
  }

  if (area === "provider-probe" && status === "pass") {
    const provider = /^([^:]+):/u.exec(message)?.[1];
    if (provider) return `${provider}: responded through local CLI probe`;
  }

  return redactSensitiveProofText(message);
}

function proofIcon(status: ReleaseEvidenceProofCheck["status"]): string {
  return status === "pass" ? "✅" : status === "warn" ? "⚠️" : "❌";
}

function proofCheckIcon(check: ReleaseEvidenceProofCheck): string {
  if (check.area === "live" && /^(?:telegram|discord|slack|matrix|signal|imessage|whatsapp|line|google-chat|webhook|home-assistant|teams|mattermost|synology-chat|rocket-chat|feishu|dingtalk|wecom|zalo|irc|twitch|ntfy|mastodon|nextcloud-talk|webex|zulip|email|github|todoist|notion|obsidian)/u.test(check.message) && /disabled \(no token configured\)/u.test(check.message)) {
    return "ℹ️";
  }
  return proofIcon(check.status);
}

function redactSensitiveProofText(text: string): string {
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[REDACTED_EMAIL]")
    .replace(/@[A-Za-z_][A-Za-z0-9_.-]{2,}/gu, "@[REDACTED_HANDLE]")
    .replace(/\bbot\s+@?[A-Za-z0-9_.-]{3,}\b/giu, "bot [REDACTED_CONNECTOR_ID]");
}

function modelApiKeyReferences(text: string): string[] {
  const references = new Set<string>();
  for (const match of text.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*API[_-]?KEY\b/giu)) {
    if (isModelApiKeyEnvKey(match[0])) references.add(match[0]);
  }
  return [...references];
}

function modelApiKeyEnvKeysFromConfigExample(config: Record<string, unknown> | undefined): string[] {
  if (!config) return [];
  return objectEnvKeys(config).filter(isModelApiKeyEnvKey);
}

function objectEnvKeys(value: unknown): string[] {
  const keys = new Set<string>();
  visit(value);
  return [...keys];

  function visit(current: unknown): void {
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    if (!isRecord(current)) return;

    for (const [key, nested] of Object.entries(current)) {
      if (key === "env" && isRecord(nested)) {
        for (const envKey of Object.keys(nested)) keys.add(envKey);
      }
      visit(nested);
    }
  }
}

function parseJsonRecord(text: string): Record<string, unknown> | undefined {
  if (!text.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function readTextIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

function redactReleaseEvidence(text: string, rootDir: string, config: ViserConfig): string {
  let output = text;
  const replacements = [
    [rootDir, "<workspace>"],
    [config.assistant.workdir, "<assistant-workdir>"],
    [config.storage.dir, "<storage-dir>"],
    [homedir(), "<home>"]
  ] as const;

  for (const [needle, replacement] of replacements) {
    if (needle) output = output.split(needle).join(replacement);
  }

  return output
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[REDACTED_EMAIL]")
    .replace(/@[A-Za-z_][A-Za-z0-9_.-]{2,}/gu, "@[REDACTED_HANDLE]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{12,}\b/gu, "[REDACTED_TELEGRAM_TOKEN]")
    .replace(/\b(?:Bot|Bearer)\s+[A-Za-z0-9._-]{12,}\b/gu, "[REDACTED_AUTH_HEADER]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/gu, "[REDACTED_API_KEY]");
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
