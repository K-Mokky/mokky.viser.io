// ================================================================
// Local provider CLI route policy
// ================================================================
// Viser's core model routes are intentionally local logged-in CLIs, not model
// HTTP/API wrappers. Keep the command-name policy shared between audit and
// public release evidence so both gates prove the same boundary.

import type { CliProviderConfig, ViserConfig } from "./types.ts";

export interface CoreLocalCliRoute {
  label: string;
  ids: string[];
  expectedCommand: string;
}

export const CORE_LOCAL_CLI_ROUTES: CoreLocalCliRoute[] = [
  { label: "GPT/Codex", ids: ["codex", "gpt"], expectedCommand: "codex" },
  { label: "Gemini", ids: ["gemini"], expectedCommand: "gemini" },
  { label: "Claude", ids: ["claude"], expectedCommand: "claude" }
];

export function commandBasename(command: string): string {
  const parts = command.split(/[\\/]/u).filter(Boolean);
  return parts.at(-1) ?? command;
}

export function configuredCoreRouteProviders(config: ViserConfig, route: CoreLocalCliRoute): CliProviderConfig[] {
  return route.ids
    .map((id) => config.providers[id])
    .filter((provider): provider is CliProviderConfig => Boolean(provider));
}

export function coreLocalCliRoutePass(config: ViserConfig, route: CoreLocalCliRoute): boolean {
  const providers = configuredCoreRouteProviders(config, route);
  return providers.length > 0 && providers.every((provider) => commandBasename(provider.command) === route.expectedCommand);
}
