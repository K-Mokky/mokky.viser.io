// ================================================================
// SSH / headless loopback access
// ================================================================
// Viser binds the dashboard to 127.0.0.1 on purpose. That URL only opens on
// the machine that is listening. When the operator is on a laptop SSHed into
// a CLI server, print a local port-forward they can run on the laptop instead
// of telling them to bind 0.0.0.0.
//
// Optional env overrides (print-only; never executed by Viser):
//   VISER_SSH=1                 treat this process as an SSH session
//   VISER_SSH_DESTINATION=user@host
//   VISER_SSH_HOST=hostname     used when destination is not set
import { hostname } from "node:os";
const DEFAULT_LOOPBACK_PORT = 8787;
const SAFE_USER = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/u;
const SAFE_HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/u;
const SAFE_IPV6 = /^[0-9A-Fa-f:]+$/u;
export function inspectRemoteSession(env = process.env) {
    const connection = parseSshConnection(env.SSH_CONNECTION);
    const viaSsh = Boolean(connection
        || env.SSH_CLIENT?.trim()
        || env.SSH_TTY?.trim()
        || truthy(env.VISER_SSH));
    const user = sanitizeToken(env.USER || env.LOGNAME, "USER");
    const destination = resolveDestination(env, user, connection?.serverAddress);
    return {
        viaSsh,
        user,
        destination,
        clientAddress: connection?.clientAddress,
        serverAddress: connection?.serverAddress
    };
}
export function sshLocalForwardCommand(port, destination) {
    const safePort = Number.isInteger(port) && port > 0 && port <= 65_535 ? port : DEFAULT_LOOPBACK_PORT;
    return `ssh -N -L ${safePort}:127.0.0.1:${safePort} -- ${sanitizeDestination(destination)}`;
}
export function loopbackOpenUrl(port, path = "/") {
    const safePort = Number.isInteger(port) && port > 0 && port <= 65_535 ? port : DEFAULT_LOOPBACK_PORT;
    const suffix = path.startsWith("/") ? path : `/${path}`;
    return `http://127.0.0.1:${safePort}${suffix}`;
}
export function remoteLoopbackAccessLines(options = {}) {
    const env = options.env ?? process.env;
    const session = inspectRemoteSession(env);
    if (!session.viaSsh && !options.always)
        return [];
    const port = options.port ?? DEFAULT_LOOPBACK_PORT;
    const forward = sshLocalForwardCommand(port, session.destination);
    const dashboardUrl = loopbackOpenUrl(port, "/");
    const chatUrl = loopbackOpenUrl(port, "/chat.html");
    return [
        session.viaSsh
            ? "SSH session detected: http://127.0.0.1 URLs on this server are not reachable from your laptop browser."
            : "If you reached this machine over SSH, http://127.0.0.1 URLs only open on the server, not on your laptop.",
        "Keep Viser bound to loopback. On the laptop you SSHed from, start a local port-forward:",
        `  ${forward}`,
        `Then open ${dashboardUrl} (dashboard) or ${chatUrl} (WebChat) in that laptop browser.`,
        "Do not bind the dashboard to 0.0.0.0 just to reach it from SSH; the tunnel keeps WebChat localhost-only."
    ];
}
export function remoteProviderLoginLines(env = process.env, always = false) {
    const session = inspectRemoteSession(env);
    if (!session.viaSsh && !always)
        return [];
    const dest = sanitizeDestination(session.destination);
    return [
        session.viaSsh
            ? "SSH session detected: provider CLI login pages that open http://127.0.0.1:<port> only work on this server."
            : "If a provider CLI prints a localhost login URL while you are on SSH, that URL only works on the server.",
        "On your laptop, forward the printed port, then open the URL in the laptop browser:",
        `  ssh -N -L <port>:127.0.0.1:<port> -- ${dest}`
    ];
}
export function remoteAlwaysOnServiceLines(options = {}) {
    const platform = options.platform ?? process.platform;
    const port = options.port ?? DEFAULT_LOOPBACK_PORT;
    const session = inspectRemoteSession(options.env ?? process.env);
    const lines = [
        "For 24h use on a CLI server, install the native service after the live provider-proof gate:",
        "  viser service check",
        "  viser service install"
    ];
    if (platform === "linux") {
        lines.push("On Linux, enable linger so the systemd --user unit survives SSH logout:");
        lines.push("  loginctl enable-linger \"$USER\"");
    }
    lines.push("Dashboard/WebChat stay on loopback. Reach them from your laptop with:");
    lines.push(`  ${sshLocalForwardCommand(port, session.destination)}`);
    lines.push(`  open ${loopbackOpenUrl(port, "/")}`);
    return lines;
}
export function formatDashboardListenerNotice(url, port, env = process.env) {
    const parsedPort = port ?? portFromLoopbackTarget(url);
    return [
        `Viser web dashboard is running. url=${url} mode=read-only`,
        ...remoteLoopbackAccessLines({ port: parsedPort, env, always: true })
    ].join("\n");
}
export function formatRemoteOperatorGuidance(options = {}) {
    return uniqueLines([
        ...remoteLoopbackAccessLines(options),
        ...remoteProviderLoginLines(options.env ?? process.env, options.always),
        ...remoteAlwaysOnServiceLines({ env: options.env, platform: options.platform, port: options.port })
    ]).join("\n");
}
export function portFromLoopbackTarget(target) {
    try {
        const url = new URL(target.includes("://") ? target : `http://${target}`);
        const parsed = Number.parseInt(url.port, 10);
        if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535)
            return parsed;
    }
    catch {
        // fall through
    }
    return DEFAULT_LOOPBACK_PORT;
}
function resolveDestination(env, user, serverAddress) {
    const explicit = sanitizeDestination(env.VISER_SSH_DESTINATION, "");
    if (explicit)
        return explicit;
    const host = sanitizeHost(env.VISER_SSH_HOST) || sanitizeHost(serverAddress) || sanitizeHost(hostname()) || "HOST";
    return `${user}@${host}`;
}
function parseSshConnection(value) {
    const parts = value?.trim().split(/\s+/u) ?? [];
    if (parts.length < 4)
        return undefined;
    const clientAddress = parts[0];
    const serverAddress = parts[2];
    if (!clientAddress || !serverAddress)
        return undefined;
    return { clientAddress, serverAddress };
}
function sanitizeDestination(value, fallback = "USER@HOST") {
    const trimmed = value?.trim() ?? "";
    if (!trimmed)
        return fallback;
    const separator = trimmed.lastIndexOf("@");
    if (separator <= 0)
        return fallback;
    const user = trimmed.slice(0, separator);
    const host = trimmed.slice(separator + 1).replace(/^\[/u, "").replace(/\]$/u, "");
    if (!SAFE_USER.test(user))
        return fallback;
    if (!sanitizeHost(host))
        return fallback;
    return `${user}@${host}`;
}
function sanitizeToken(value, fallback) {
    const trimmed = value?.trim() ?? "";
    return trimmed && SAFE_USER.test(trimmed) ? trimmed : fallback;
}
function sanitizeHost(value) {
    const trimmed = value?.trim() ?? "";
    if (!trimmed || trimmed === "localhost" || trimmed === "127.0.0.1" || trimmed === "::1" || trimmed === "0.0.0.0") {
        return undefined;
    }
    if (trimmed.startsWith("-"))
        return undefined;
    if (SAFE_HOST.test(trimmed) || SAFE_IPV6.test(trimmed))
        return trimmed;
    return undefined;
}
function truthy(value) {
    if (!value)
        return false;
    return /^(1|true|yes|on)$/iu.test(value.trim());
}
function uniqueLines(lines) {
    const seen = new Set();
    const result = [];
    for (const line of lines) {
        if (seen.has(line))
            continue;
        seen.add(line);
        result.push(line);
    }
    return result;
}
