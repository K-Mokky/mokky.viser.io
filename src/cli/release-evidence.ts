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
import { CORE_LOCAL_CLI_ROUTES, commandBasename, coreLocalCliRoutePass } from "../core/local-cli-policy.ts";
import { isModelApiKeyEnvKey } from "../core/model-api-policy.ts";
import type { VerifyResult } from "./verify.ts";
import type { ViserConfig } from "../core/types.ts";

const RELEASE_CREATOR = "KMokky";
const RELEASE_ASSISTANT = "Viser";
const REQUIRED_PUBLIC_FILES = ["README.md", "SECURITY.md", "PRIVACY.md", "CONTRIBUTING.md", "LICENSE", "aimake.md"];
const REQUIRED_PACKAGE_FILES = [".env.example", "README.md", "SECURITY.md", "PRIVACY.md", "CONTRIBUTING.md", "assets", "config", "plugins", "skills", "src", "tools", "tsconfig.json"];
const REQUIRED_GITHUB_TEMPLATE_FILES = [
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/PULL_REQUEST_TEMPLATE.md"
];
const FORBIDDEN_PACKAGE_FILES = [".env", ".viser", ".omx", ".npmrc", "node_modules", "viser.config.json"];
const RELEASE_EVIDENCE_COMMAND = "node src/index.ts release-evidence";
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
    verifyResult
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
      "npm test",
      "npm run typecheck",
      "node src/index.ts verify --strict",
      "node src/index.ts verify --strict --live --probe-all-providers",
      "node src/index.ts next-steps --live --probe-all-providers",
      "node src/index.ts audit",
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
  addCheck(checks, "package", bin.viser === "./src/index.ts", "viser CLI bin points to ./src/index.ts");

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
    /TELEGRAM_BOT_TOKEN|DISCORD_BOT_TOKEN|\.env|personal data|private \.viser|\.omx/iu.test(normalized),
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
    /\.env|\.viser|\.omx|TELEGRAM_BOT_TOKEN|DISCORD_BOT_TOKEN|local filesystem paths|personal handles|emails?/iu.test(bugText),
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
    /TELEGRAM_BOT_TOKEN|DISCORD_BOT_TOKEN|personal handles|email addresses|local filesystem paths|\.env/iu.test(normalized),
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
}): ReleaseEvidenceObjective[] {
  const providerProbeRequested = input.proof.probeProviders || input.proof.probeAllProviders;
  const liveProofRequested = input.proof.live;
  const requiredLiveConnectors = ["telegram", "discord"];
  const missingAcceptedLiveConnectors = liveProofRequested
    ? requiredLiveConnectors.filter((connector) => !proofPassed(input.proofChecks, "live", new RegExp(`^${connector}: live token accepted$`, "u")))
    : requiredLiveConnectors;
  const coreRouteProofGaps = providerProbeRequested
    ? CORE_LOCAL_CLI_ROUTES
        .filter((route) => !route.ids.some((id) => proofPassed(input.proofChecks, "provider-probe", new RegExp(`^${escapeRegExp(id)}:`, "u"))))
        .map((route) => coreRouteProofGap(input.proofChecks, route.label, route.ids))
    : [];
  const providerProofFailed = proofFailed(input.proofChecks, /^(provider-probe|provider-runtime)$/u);
  const liveProofFailed = proofFailed(input.proofChecks, /^live$/u);

  return [
    {
      id: "assistant-core",
      status: input.verifyResult.smoke.verdict === "PASS" ? "pass" : "fail",
      requirement: "OpenClaw/Hermes-like local CLI assistant core works end-to-end",
      evidence: [
        `verify strict gate: ${input.verifyResult.ok ? "PASS" : "BLOCKED"}`,
        `local smoke: ${input.verifyResult.smoke.verdict} (${input.verifyResult.smoke.passCount} pass, ${input.verifyResult.smoke.failCount} fail)`,
        "smoke covers status, skills, plugins, provider history, memory, tools, approval actions, jobs, scheduler, access, and backup"
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
      id: "messenger",
      status: allChecksPass(input.checks, [
        /Telegram connector source is present/u,
        /Discord connector source is present/u
      ]) && allSmokePass(input.smokeChecks, ["telegram", "discord", "messenger-outbound"]) && !liveProofFailed
        ? "pass"
        : "fail",
      requirement: "Discord/Telegram messenger communication is implemented with safe inbound and approved outbound paths",
      evidence: [
        "Telegram and Discord connector sources are present",
        "local smoke proves Telegram inbound handler -> AssistantRuntime -> mocked Bot API send",
        "local smoke proves Discord inbound handler -> AssistantRuntime -> mocked REST send",
        "local smoke proves approved outbound Telegram/Discord message actions reach connector senders"
      ],
      remaining: liveProofRequested
        ? missingAcceptedLiveConnectors.map((connector) => connectorLiveProofGap(input.config, input.proofChecks, connector))
        : [`Run \`${STRICT_LIVE_RELEASE_EVIDENCE_COMMAND}\` to attach real connector token validation when tokens are configured and fail until it is proven.`]
    },
    {
      id: "local-cli-no-model-api",
      status: allChecksPass(input.checks, [
        /GPT\/Codex route uses exact logged-in local codex CLI provider/u,
        /Gemini route uses exact logged-in local gemini CLI provider/u,
        /Claude route uses exact logged-in local claude CLI provider/u,
        /\.env\.example excludes model API key variables/u,
        /config example provider env excludes model API key variables/u
      ]) && coreRouteProofGaps.length === 0 && !providerProofFailed && input.verifyResult.audit.failCount === 0
        ? "pass"
        : "fail",
      requirement: "GPT/Codex, Gemini, and Claude use logged-in local CLIs instead of model API keys",
      evidence: [
        "core GPT/Codex, Gemini, and Claude routes use exact local command basenames: codex, gemini, claude",
        `audit: ${input.verifyResult.audit.verdict} (${input.verifyResult.audit.passCount} pass, ${input.verifyResult.audit.warnCount} warn, ${input.verifyResult.audit.failCount} fail)`,
        "public examples exclude model API key variables",
        ...(providerProbeRequested ? ["provider probe proof was requested and summarized in Runtime/live proof checks"] : [])
      ],
      remaining: [
        ...(providerProbeRequested ? [] : [`Run \`${STRICT_LIVE_RELEASE_EVIDENCE_COMMAND}\` to attach current logged-in CLI runtime proof and fail until it is proven.`]),
        ...coreRouteProofGaps
      ]
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

function connectorLiveProofGap(config: ViserConfig, checks: ReleaseEvidenceProofCheck[], connector: string): string {
  const proof = checks.find((check) => check.area === "live" && check.message.startsWith(`${connector}:`));
  const envName = connector === "telegram"
    ? config.connectors.telegram.botTokenEnv
    : connector === "discord"
      ? config.connectors.discord.botTokenEnv
      : `${connector.toUpperCase()}_TOKEN`;
  const detail = proof ? ` (${proof.message})` : "";
  const next = proof?.next
    ? ` Next: ${proof.next}`
    : ` Set ${envName}, authorize the target with \`node src/index.ts pair-code ${connector} <label>\`, then run the gateway dry-run.`;
  return `${connector} live token was not accepted in this evidence run${detail}; configure a real token and rerun \`${STRICT_LIVE_RELEASE_EVIDENCE_COMMAND}\`.${next}`;
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
    const connector = /^(telegram|discord):/u.exec(message)?.[1];
    if (connector && /bot\s+@?[\w.-]+|token accepted/iu.test(message)) return `${connector}: live token accepted`;
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
  if (check.area === "live" && /^telegram|^discord/u.test(check.message) && /disabled \(no token configured\)/u.test(check.message)) {
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
