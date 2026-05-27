// ================================================================
// Provider health probes
// ================================================================
// Optional readiness probe. It intentionally goes through the same logged-in
// local CLI path as normal provider calls, so it can catch missing login/session
// state that command existence alone cannot prove.

import { CliModelProvider } from "./cli-provider.ts";
import type { CliProviderConfig } from "../core/types.ts";

export interface ProviderProbeResult {
  ok: boolean;
  detail: string;
  elapsedMs: number;
}

const DEFAULT_PROBE_SENTINEL = "VISER_OK";

export async function probeCliProvider(
  config: CliProviderConfig,
  options: { prompt?: string; timeoutMs?: number; expectedText?: string } = {}
): Promise<ProviderProbeResult> {
  const timeoutMs = Math.min(options.timeoutMs ?? 30_000, config.timeoutMs);
  const provider = new CliModelProvider({ ...config, timeoutMs });
  const started = Date.now();
  const expectedText = options.expectedText ?? DEFAULT_PROBE_SENTINEL;

  try {
    const response = await provider.generate({
      providerId: config.id,
      sessionId: "readiness:probe",
      prompt: options.prompt ?? `Reply with exactly: ${expectedText}`
    });
    const preview = compactPreview(response.text);
    const interactive = looksLikeInteractiveAuth(response.text);
    const matched = response.text.includes(expectedText);
    return {
      ok: matched && !interactive,
      detail: interactive
        ? `interactive authentication required: ${preview}`
        : matched
          ? sentinelProofPreview(response.text, expectedText)
          : preview
            ? `unexpected probe response, expected ${expectedText}: ${preview}`
            : "empty response",
      elapsedMs: response.elapsedMs
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - started
    };
  }
}

function looksLikeInteractiveAuth(text: string): boolean {
  return /opening authentication page|do you want to continue|press enter|browser login|authenticate/i.test(text);
}

function compactPreview(text: string, maxLength = 160): string {
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sentinelProofPreview(text: string, expectedText: string, contextLength = 60): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const index = normalized.indexOf(expectedText);
  if (index < 0) return compactPreview(text);

  const start = Math.max(0, index - contextLength);
  const end = Math.min(normalized.length, index + expectedText.length + contextLength);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < normalized.length ? "…" : "";
  return `${prefix}${normalized.slice(start, end)}${suffix}`;
}
