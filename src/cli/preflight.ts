// ================================================================
// Non-starting launch preflight
// ================================================================
// `gateway --strict` is a launch gate: if checks pass it starts long-running
// workers. `preflight` is intentionally no-start: run every safe local gate,
// optionally prove provider/login state, then exit with clear launch guidance.

import { verify, type VerifyOptions, type VerifyResult } from "./verify.ts";
import { formatRemoteOperatorGuidance } from "../utils/remote-access.ts";
import type { ViserConfig } from "../core/types.ts";

export interface PreflightOptions extends VerifyOptions {}

export interface PreflightResult {
  ok: boolean;
  report: string;
  verify: VerifyResult;
}

export async function preflight(config: ViserConfig, options: PreflightOptions = {}): Promise<PreflightResult> {
  const result = await verify(config, options);
  const providerProbeRequested = Boolean(options.probeProviders || options.probeAllProviders);
  const liveRequested = Boolean(options.live);
  const ok = result.ok;

  return {
    ok,
    verify: result,
    report: [
      `Viser preflight: ${ok ? "PASS" : "BLOCKED"}`,
      "mode: check-only (no gateway, scheduler, job worker, or connector process was started)",
      `live connector token proof: ${liveRequested ? "requested" : "not requested"}`,
      `provider runtime proof: ${providerProbeRequested ? "requested" : "not requested"}`,
      "",
      result.report,
      "",
      "Launch guidance:",
      ok
        ? "- Safe local launch gate passed. To only preview gateway readiness: `viser gateway --dry-run`."
        : "- Do not launch yet; fix blockers above, then rerun preflight.",
      providerProbeRequested
        ? "- Provider runtime was included in this preflight."
        : "- To prove provider login before launch, rerun: `viser preflight --live --probe-all-providers`.",
      liveRequested
        ? "- Live connector token validation was included in this preflight."
        : "- To validate configured Telegram/Discord tokens before launch, rerun with `--live`.",
      "- For one final live launch verdict, run: `viser launch-status`.",
      providerProbeRequested
        ? "- Start Viser only in a foreground terminal when ready: `viser`."
        : "- Direct foreground gateway now adds provider proof by default: `viser`.",
      "- Native always-on install uses `viser service install` after the live provider-proof gate. The process still stops if that service is uninstalled.",
      ...formatRemoteOperatorGuidance({ always: true, port: config.webDashboard.port }).split("\n").map((line) => `- ${line}`)
    ].join("\n")
  };
}

export async function preflightReport(config: ViserConfig, options: PreflightOptions = {}): Promise<string> {
  return (await preflight(config, options)).report;
}
