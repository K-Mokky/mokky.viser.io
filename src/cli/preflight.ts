// ================================================================
// Non-starting launch preflight
// ================================================================
// `gateway --strict` is a launch gate: if checks pass it starts long-running
// workers. `preflight` is intentionally no-start: run every safe local gate,
// optionally prove provider/login state, then exit with clear launch guidance.

import { verify, type VerifyOptions, type VerifyResult } from "./verify.ts";
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
        ? "- Safe local launch gate passed. To only preview gateway readiness: `node src/index.ts gateway --dry-run`."
        : "- Do not launch yet; fix blockers above, then rerun preflight.",
      providerProbeRequested
        ? "- Provider runtime was included in this preflight."
        : "- To prove provider login before launch, rerun: `node src/index.ts preflight --live --probe-all-providers`.",
      liveRequested
        ? "- Live connector token validation was included in this preflight."
        : "- To validate configured Telegram/Discord tokens before launch, rerun with `--live`.",
      "- For one final live launch verdict, run: `node src/index.ts launch-status`.",
      providerProbeRequested
        ? "- Start live provider-proof foreground gateway only when ready: `node src/index.ts gateway`."
        : "- Direct foreground gateway now adds provider proof by default: `node src/index.ts gateway`.",
      "- macOS service path: `node src/index.ts service write-plist`, inspect it, then `node src/index.ts service install`."
    ].join("\n")
  };
}

export async function preflightReport(config: ViserConfig, options: PreflightOptions = {}): Promise<string> {
  return (await preflight(config, options)).report;
}
