// ================================================================
// Signal bridge
// ================================================================
// Signal has no simple bot token API, so Viser integrates through the local
// `signal-cli` command. This preserves the local-first/foreground-only model:
// inbound polling and outbound sends run only while the user keeps Viser open.

import { AccessStore } from "../core/access.ts";
import { runCommand, type RunCommandOptions, type RunCommandResult } from "../utils/exec.ts";
import { chunkText } from "../utils/text.ts";
import { pairedMessage, pairingRequiredMessage } from "./telegram.ts";
import { connectorInputLimitMessage, connectorInputTooLong } from "./input-policy.ts";
import { ConnectorRateLimiter, connectorRateLimitMessage } from "./rate-limit.ts";
import type { AssistantRuntime } from "../core/assistant.ts";
import type { SignalConnectorConfig } from "../core/types.ts";

const SIGNAL_CHUNK_SIZE = 1900;

export interface SignalDataMessage {
  message?: string;
}

export interface SignalEnvelope {
  envelope?: {
    source?: string;
    sourceNumber?: string;
    dataMessage?: SignalDataMessage;
  };
  source?: string;
  sourceNumber?: string;
  dataMessage?: SignalDataMessage;
}

export interface SignalRunOptions {
  runner?: (options: RunCommandOptions) => Promise<RunCommandResult>;
}

export async function runSignalBridge(
  config: SignalConnectorConfig,
  assistant: AssistantRuntime,
  access?: AccessStore
): Promise<void> {
  if (!config.account) throw new Error(`Signal account is missing. Set ${config.accountEnv}.`);
  const rateLimiter = new ConnectorRateLimiter(config.maxMessagesPerMinute);
  let stopped = false;

  process.once("SIGINT", () => {
    stopped = true;
  });
  process.once("SIGTERM", () => {
    stopped = true;
  });

  console.log("Signal bridge is running through signal-cli. Press Ctrl+C to stop.");

  while (!stopped) {
    try {
      await pollSignalReceive(config, assistant, access, rateLimiter);
    } catch (error) {
      if (stopped) break;
      console.error(`Signal receive failed; retrying: ${error instanceof Error ? error.message : String(error)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
}

export async function pollSignalReceive(
  config: SignalConnectorConfig,
  assistant: AssistantRuntime,
  access?: AccessStore,
  rateLimiter?: ConnectorRateLimiter,
  options: SignalRunOptions = {}
): Promise<number> {
  if (!config.account) throw new Error(`Signal account is missing. Set ${config.accountEnv}.`);
  const runner = options.runner ?? runCommand;
  const result = await runner({
    command: config.command,
    args: ["-a", config.account, "--output", "json", "receive"],
    timeoutMs: config.receiveTimeoutMs,
    maxOutputBytes: 250_000,
    env: signalCliEnv(),
    inheritEnv: false
  });
  if (result.exitCode !== 0 || result.signal) {
    throw new Error(redactSignalDetail(`signal-cli receive failed: ${result.stderr || result.stdout || result.signal || result.exitCode}`, config));
  }

  const envelopes = parseSignalEnvelopes(result.stdout);
  for (const envelope of envelopes) {
    await handleSignalEnvelope(config, assistant, envelope, access, rateLimiter, options);
  }
  return envelopes.length;
}

export async function handleSignalEnvelope(
  config: SignalConnectorConfig,
  assistant: AssistantRuntime,
  envelope: SignalEnvelope,
  access?: AccessStore,
  rateLimiter?: ConnectorRateLimiter,
  options: SignalRunOptions = {}
): Promise<void> {
  if (!config.account) throw new Error(`Signal account is missing. Set ${config.accountEnv}.`);
  const sender = normalizeSignalAddress(envelope.envelope?.sourceNumber ?? envelope.envelope?.source ?? envelope.sourceNumber ?? envelope.source);
  const body = envelope.envelope?.dataMessage?.message ?? envelope.dataMessage?.message;
  if (!sender || !body) return;
  if (sender === config.account) return;

  const staticAllowlist = [...config.allowedRecipientIds, ...config.defaultRecipientIds];
  if (config.allowedRecipientIds.length > 0 && !staticAllowlist.includes(sender)) return;

  const normalized = normalizeSignalInput(body);
  if (!normalized) return;

  if (access && !(await access.isAllowed("signal", sender, staticAllowlist))) {
    const paired = await access.tryPairCommand(normalized, "signal", sender, `signal:${sender}`);
    await sendSignalMessage(config, sender, paired ? pairedMessage("signal") : pairingRequiredMessage("signal"), options);
    return;
  }

  if (connectorInputTooLong(normalized, config.maxInputChars)) {
    await sendSignalMessage(config, sender, connectorInputLimitMessage(config.maxInputChars), options);
    return;
  }

  const rate = rateLimiter?.check(`signal:${sender}`);
  if (rate && !rate.allowed) {
    await sendSignalMessage(config, sender, connectorRateLimitMessage(rate.retryAfterMs), options);
    return;
  }

  try {
    const answer = await assistant.handle(normalized, `signal:${sender}`, { source: "signal" });
    await sendSignalMessage(config, sender, answer, options);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await sendSignalMessage(config, sender, `Viser error:\n${detail}`, options);
  }
}

export function normalizeSignalInput(content: string): string | undefined {
  const trimmed = content.trim();
  return trimmed || undefined;
}

export async function sendSignalMessage(
  config: SignalConnectorConfig,
  recipientId: string,
  text: string,
  options: SignalRunOptions = {}
): Promise<void> {
  if (!config.account) throw new Error(`Signal account is missing. Set ${config.accountEnv}.`);
  const recipient = normalizeSignalAddress(recipientId);
  if (!recipient) throw new Error("Signal recipient id is required.");
  const runner = options.runner ?? runCommand;

  for (const chunk of chunkText(text, SIGNAL_CHUNK_SIZE)) {
    const result = await runner({
      command: config.command,
      args: ["-a", config.account, "send", "-m", chunk, recipient],
      timeoutMs: config.sendTimeoutMs,
      maxOutputBytes: 20_000,
      env: signalCliEnv(),
      inheritEnv: false
    });
    if (result.exitCode !== 0 || result.signal) {
      throw new Error(redactSignalDetail(`signal-cli send failed: ${result.stderr || result.stdout || result.signal || result.exitCode}`, config, recipient, chunk));
    }
  }
}

export function parseSignalEnvelopes(output: string): SignalEnvelope[] {
  const trimmed = output.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed.filter(isSignalEnvelope);
    if (isSignalEnvelope(parsed)) return [parsed];
  } catch {
    // signal-cli commonly emits newline-delimited JSON; fall through.
  }

  const envelopes: SignalEnvelope[] = [];
  for (const line of trimmed.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isSignalEnvelope(parsed)) envelopes.push(parsed);
    } catch {
      // Ignore non-JSON progress lines to keep polling robust.
    }
  }
  return envelopes;
}

export function normalizeSignalAddress(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (/^\+[1-9]\d{4,19}$/u.test(trimmed)) return trimmed;
  if (/^[1-9]\d{4,19}$/u.test(trimmed)) return `+${trimmed}`;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(trimmed)) return trimmed.toLowerCase();
  return undefined;
}

function isSignalEnvelope(value: unknown): value is SignalEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return Boolean(record.envelope || record.dataMessage || record.source || record.sourceNumber);
}

function redactSignalDetail(detail: string, config: SignalConnectorConfig, recipient?: string, text?: string): string {
  let output = detail;
  for (const secret of [config.account, recipient, text]) {
    if (secret) output = output.split(secret).join("[REDACTED]");
  }
  return output;
}

function signalCliEnv(): Record<string, string | undefined> {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME
  };
}
