// ================================================================
// Local provider CLI route policy
// ================================================================
// Viser's core model routes are intentionally local logged-in CLIs, not model
// HTTP/API wrappers. Keep the command-name policy shared between audit and
// public release evidence so both gates prove the same boundary.
export const CORE_LOCAL_CLI_ROUTES = [
    { label: "GPT/Codex", ids: ["codex", "gpt"], expectedCommand: "codex" },
    { label: "Gemini", ids: ["gemini"], expectedCommand: "gemini" },
    { label: "Claude", ids: ["claude"], expectedCommand: "claude" }
];
export function commandBasename(command) {
    const parts = command.split(/[\\/]/u).filter(Boolean);
    return parts.at(-1) ?? command;
}
export function configuredCoreRouteProviders(config, route) {
    return route.ids
        .map((id) => config.providers[id])
        .filter((provider) => Boolean(provider));
}
export function coreLocalCliRoutePass(config, route) {
    const providers = configuredCoreRouteProviders(config, route);
    return providers.length > 0 && providers.every((provider) => commandBasename(provider.command) === route.expectedCommand);
}
