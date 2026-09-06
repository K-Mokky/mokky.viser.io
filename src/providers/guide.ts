// ================================================================
// Provider login and smoke-test guide
// ================================================================
// Command existence is not enough for a local-CLI-backed assistant. This
// guide turns provider configuration into exact next steps: install/login,
// manual smoke test, and optional live probe through the same adapter Viser
// uses for normal answers.

import { probeCliProvider, type ProviderProbeResult } from "./health.ts";
import { commandExists } from "../utils/exec.ts";
import type { CliProviderConfig, ViserConfig } from "../core/types.ts";

export interface ProviderGuideOptions {
  providerId?: string;
  probe?: boolean;
  timeoutMs?: number;
}

export async function providerGuideReport(
  config: ViserConfig,
  options: ProviderGuideOptions = {}
): Promise<string> {
  const providers = selectProviders(config, options.providerId);
  if (providers.length === 0) {
    return `Unknown provider '${options.providerId}'. Available providers: ${Object.keys(config.providers).join(", ")}`;
  }

  const blocks: string[] = [];
  for (const provider of providers) {
    blocks.push(await providerGuideBlock(provider, options));
  }
  return [
    "Viser provider login guide",
    "Model access rule: Viser uses already logged-in local CLIs, not LLM HTTP API keys.",
    "",
    ...blocks
  ].join("\n");
}

export function providerSmokeCommand(
  provider: CliProviderConfig,
  prompt = "Reply with exactly: VISER_OK"
): string {
  const command = shellQuote(provider.command);
  const args = provider.args.map((arg) => shellQuote(arg.replaceAll("{prompt}", prompt)));
  let invocation: string;

  if (provider.promptMode === "stdin") {
    invocation = `printf '%s\\n' ${shellQuote(prompt)} | ${[command, ...args].join(" ")}`;
  } else if (provider.promptMode === "argument") {
    invocation = [command, ...args, shellQuote(prompt)].join(" ");
  } else {
    invocation = [command, ...args].join(" ");
  }

  return provider.cwd ? `(cd ${shellQuote(provider.cwd)} && ${invocation})` : invocation;
}

export function providerIssueAdvice(provider: CliProviderConfig | undefined, detail: string): string[] {
  const id = provider?.id ?? "provider";
  const guideCommand = provider
    ? `viser provider-guide ${provider.id} --probe`
    : "viser provider-guide --probe";
  const smokeCommand = provider ? `manual smoke test: ${providerSmokeCommand(provider)}` : undefined;
  const retryCommand = "retry: viser verify --live --probe-all-providers";
  const launchCommand = "final launch verdict: viser launch-status";
  const text = `${id}\n${detail}`;

  if (/Operation not permitted|sandbox|permission denied/i.test(text)) {
    return [
      "detected issue: sandbox/permission failure",
      "action: run the manual smoke test in your normal terminal, not from a sandboxed agent.",
      ...(smokeCommand ? [smokeCommand] : []),
      retryCommand,
      launchCommand
    ];
  }

  if (/interactive input|required interactive|opening authentication page|do you want to continue|browser login|authenticate/i.test(text)) {
    return [
      "detected issue: interactive login required",
      `action: run \`${provider?.command ?? id}\` in your normal terminal and complete the browser/account login flow.`,
      ...(smokeCommand ? [smokeCommand] : []),
      retryCommand,
      launchCommand
    ];
  }

  if (/ENOENT|not found|no such file|command is missing|command not found/i.test(text)) {
    return [
      "detected issue: provider command missing",
      `action: install the CLI or fix the configured command, then run \`${guideCommand}\`.`,
      retryCommand,
      launchCommand
    ];
  }

  if (/SIGTERM|SIGKILL|timed? out|timeout/i.test(text)) {
    return [
      "detected issue: provider probe timed out or was terminated",
      "action: run the manual smoke test directly and increase provider.timeoutMs if the CLI is just slow.",
      ...(smokeCommand ? [smokeCommand] : []),
      retryCommand,
      launchCommand
    ];
  }

  if (/empty response/i.test(text)) {
    return [
      "detected issue: provider returned empty output",
      "action: verify promptMode/args and run the manual smoke test; Viser needs non-empty stdout/stderr.",
      ...(smokeCommand ? [smokeCommand] : []),
      retryCommand,
      launchCommand
    ];
  }

  if (/unexpected probe response/i.test(text)) {
    return [
      "detected issue: provider did not return the expected VISER_OK probe sentinel",
      "action: run the manual smoke test and verify the CLI is sending the prompt to a logged-in model, not returning wrapper/help text.",
      ...(smokeCommand ? [smokeCommand] : []),
      retryCommand,
      launchCommand
    ];
  }

  return [
    "detected issue: provider probe failed",
    `action: run \`${guideCommand}\` and the manual smoke test in a normal terminal.`,
    ...(smokeCommand ? [smokeCommand] : []),
    retryCommand,
    launchCommand
  ];
}

async function providerGuideBlock(provider: CliProviderConfig, options: ProviderGuideOptions): Promise<string> {
  const installed = commandExists(provider.command, providerCommandLookupOptions(provider));
  const probe = options.probe && installed
    ? await probeCliProvider(provider, { timeoutMs: options.timeoutMs ?? 15_000 })
    : undefined;

  return [
    `## ${provider.id}: ${provider.label ?? provider.id}`,
    `- command: ${provider.command}`,
    `- installed: ${installed ? "yes" : "no"}`,
    `- prompt mode: ${provider.promptMode}`,
    `- login/install: ${provider.loginHint ?? `Run ${provider.command} and complete login.`}`,
    `- manual smoke test: ${providerSmokeCommand(provider)}`,
    `- Viser probe: ${formatProbe(provider, installed, options.probe, probe)}`,
    ...providerTroubleshooting(provider, installed, probe).map((line) => `- note: ${line}`),
    ""
  ].join("\n");
}

function providerCommandLookupOptions(provider: CliProviderConfig): { cwd?: string; pathValue?: string } {
  return { cwd: provider.cwd, pathValue: provider.env?.PATH };
}

function selectProviders(config: ViserConfig, providerId?: string): CliProviderConfig[] {
  if (providerId) return config.providers[providerId] ? [config.providers[providerId]] : [];
  return Object.values(config.providers);
}

function formatProbe(
  provider: CliProviderConfig,
  installed: boolean,
  requested?: boolean,
  probe?: ProviderProbeResult
): string {
  if (!requested) return `skipped (run \`viser provider-guide ${provider.id} --probe\`)`;
  if (!installed) return "skipped because command is missing";
  if (!probe) return "not run";
  return `${probe.ok ? "pass" : "fail"} in ${probe.elapsedMs}ms — ${probe.detail}`;
}

function providerTroubleshooting(
  provider: CliProviderConfig,
  installed: boolean,
  probe?: ProviderProbeResult
): string[] {
  const notes: string[] = [];

  if (!installed) {
    notes.push("Install the CLI first; command lookup must pass before Viser can use this provider.");
    return notes;
  }

  notes.push("Command lookup passed, but account login is proven only by a successful probe or real `ask` call.");

  if (provider.promptMode === "stdin") {
    notes.push("This provider receives prompts on stdin; keep the trailing `-` argument when configuring Codex-style CLIs.");
  }

  if (provider.command === "codex") {
    notes.push("If a probe fails with `Operation not permitted` inside a sandboxed agent, retry the manual smoke test in your normal terminal.");
  }

  if (probe && !probe.ok) notes.push(...providerIssueAdvice(provider, probe.detail));

  return notes;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
