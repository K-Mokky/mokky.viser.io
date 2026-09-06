// ================================================================
// MCP client configuration snippets
// ================================================================
// Generates local stdio MCP client config JSON for connecting external MCP
// clients to Viser's provider-free MCP server surface.
import { fileURLToPath } from "node:url";
export const MCP_CLIENT_TARGETS = ["generic", "claude-desktop", "codex"];
const CURRENT_MODULE_PATH = fileURLToPath(import.meta.url);
const ENTRYPOINT_EXTENSION = CURRENT_MODULE_PATH.endsWith(".ts") ? ".ts" : ".js";
const INDEX_ENTRYPOINT = fileURLToPath(new URL(`../index${ENTRYPOINT_EXTENSION}`, import.meta.url));
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const TARGET_LABELS = {
    generic: "generic MCP stdio client",
    "claude-desktop": "Claude Desktop-style MCP client",
    codex: "Codex-style MCP client"
};
export function mcpClientConfigData(config, options = {}) {
    const target = normalizeMcpClientTarget(options.target);
    if (!target) {
        throw new Error(`Unknown MCP client target '${options.target}'. Supported targets: ${MCP_CLIENT_TARGETS.join(", ")}.`);
    }
    const serverName = normalizeMcpServerName(options.serverName);
    const server = {
        command: process.execPath,
        args: [INDEX_ENTRYPOINT, "mcp-server"],
        cwd: config.assistant.workdir
    };
    if (config.configPath)
        server.env = { VISER_CONFIG: config.configPath };
    return {
        target,
        clientLabel: TARGET_LABELS[target],
        serverName,
        clientConfig: {
            mcpServers: {
                [serverName]: server
            }
        },
        notes: [
            "Uses local stdio transport only; no public network listener is opened.",
            "MCP tools expose read-only state and approval-gated proposals, not direct provider calls or /approve execution.",
            "If your client does not support the cwd field, launch it from that directory or wrap this command in a small script."
        ]
    };
}
export function mcpClientConfigReport(config, options = {}) {
    try {
        const result = mcpClientConfigData(config, options);
        if (options.json)
            return JSON.stringify(result, null, 2);
        return [
            `Viser MCP client config: ${result.clientLabel}`,
            `- target: ${result.target}`,
            `- server name: ${result.serverName}`,
            "- transport: stdio",
            "- safety: provider calls and approval execution are not exposed over MCP.",
            "",
            "Paste this JSON object into an MCP client configuration that accepts `mcpServers`:",
            JSON.stringify(result.clientConfig, null, 2),
            "",
            "Notes:",
            ...result.notes.map((note) => `- ${note}`)
        ].join("\n");
    }
    catch (error) {
        return [
            mcpClientConfigUsage(),
            "",
            `Error: ${error instanceof Error ? error.message : String(error)}`
        ].join("\n");
    }
}
export function mcpClientConfigUsage() {
    return [
        "Usage: viser mcp-client-config [generic|claude-desktop|codex] [--name viser] [--json]",
        "",
        "Outputs a local stdio MCP client snippet for Viser's `mcp-server` command."
    ].join("\n");
}
function normalizeMcpClientTarget(target) {
    const normalized = (target || "generic").trim().toLowerCase();
    if (!normalized)
        return "generic";
    if (normalized === "claude" || normalized === "claude_desktop")
        return "claude-desktop";
    if (normalized === "openai-codex" || normalized === "codex-cli")
        return "codex";
    return MCP_CLIENT_TARGETS.includes(normalized) ? normalized : undefined;
}
function normalizeMcpServerName(serverName) {
    const normalized = (serverName || "viser").trim();
    if (!SERVER_NAME_PATTERN.test(normalized)) {
        throw new Error("MCP server name must be 1-64 characters and contain only letters, numbers, dot, underscore, or dash.");
    }
    return normalized;
}
