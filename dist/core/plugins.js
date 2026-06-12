// ================================================================
// Local plugin registry
// ================================================================
// Plugins are declarative prompt/tooling extensions stored as `plugin.json`
// manifests. Viser treats plugin content as untrusted local data: users must
// explicitly select a plugin command, and no plugin gets hidden tool or shell
// privileges.
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { listPrivateDirIfExists, readPrivateFileIfExists } from "../utils/files.js";
export class PluginRegistry {
    dirs;
    constructor(dirs) {
        this.dirs = dirs;
    }
    async list() {
        const plugins = [];
        for (const dir of this.dirs) {
            const entries = await listPrivateDirIfExists(dir);
            if (!entries)
                continue;
            for (const entry of entries) {
                if (!entry.isDirectory())
                    continue;
                const pluginDir = join(dir, entry.name);
                if (!await isRegularDirectory(pluginDir))
                    continue;
                const plugin = await loadPlugin(join(pluginDir, "plugin.json"), entry.name, pluginDir);
                if (plugin)
                    plugins.push(plugin);
            }
        }
        return dedupePlugins(plugins).sort((a, b) => a.id.localeCompare(b.id));
    }
    async get(id) {
        const normalized = normalizePluginId(id);
        return (await this.list()).find((plugin) => plugin.id === normalized);
    }
    async select(pluginId, commandId) {
        const plugin = await this.get(pluginId);
        if (!plugin)
            return undefined;
        const command = plugin.commands.find((item) => item.id === normalizePluginId(commandId));
        return command ? { plugin, command } : undefined;
    }
    async formatCatalog(limit) {
        const plugins = (await this.list()).slice(0, limit);
        if (plugins.length === 0)
            return "(none)";
        return plugins.map((plugin) => {
            const commands = plugin.commands.map((command) => command.id).join(", ") || "no commands";
            return `- ${plugin.id}: ${plugin.description || plugin.title} (commands: ${commands})`;
        }).join("\n");
    }
}
async function loadPlugin(path, fallbackId, pluginDir) {
    const raw = await safeReadPlugin(path, pluginDir);
    if (raw === undefined)
        return undefined;
    let manifest;
    try {
        manifest = JSON.parse(raw);
    }
    catch {
        return undefined;
    }
    const id = normalizePluginId(typeof manifest.id === "string" ? manifest.id : fallbackId);
    const commands = parseCommands(manifest.commands);
    if (!id || commands.length === 0)
        return undefined;
    const title = typeof manifest.title === "string" && manifest.title.trim() ? manifest.title.trim() : id;
    const description = typeof manifest.description === "string" && manifest.description.trim()
        ? manifest.description.trim()
        : title;
    const version = typeof manifest.version === "string" && manifest.version.trim() ? manifest.version.trim() : undefined;
    const capabilities = Array.isArray(manifest.capabilities)
        ? manifest.capabilities.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean)
        : [];
    return { id, title, description, version, capabilities, commands, path, dir: pluginDir };
}
function parseCommands(value) {
    if (!Array.isArray(value))
        return [];
    const commands = [];
    for (const item of value) {
        if (!isPlainObject(item))
            continue;
        const id = normalizePluginId(typeof item.id === "string" ? item.id : "");
        const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
        if (!id || !prompt)
            continue;
        const description = typeof item.description === "string" && item.description.trim()
            ? item.description.trim()
            : id;
        commands.push({ id, description, prompt });
    }
    return dedupeCommands(commands);
}
async function safeReadPlugin(path, pluginDir) {
    try {
        return await readPrivateFileIfExists(path, { dirs: [pluginDir] });
    }
    catch {
        return undefined;
    }
}
async function isRegularDirectory(path) {
    try {
        const info = await lstat(path);
        return info.isDirectory() && !info.isSymbolicLink();
    }
    catch {
        return false;
    }
}
function dedupePlugins(plugins) {
    const seen = new Map();
    for (const plugin of plugins) {
        if (!seen.has(plugin.id))
            seen.set(plugin.id, plugin);
    }
    return [...seen.values()];
}
function dedupeCommands(commands) {
    const seen = new Map();
    for (const command of commands) {
        if (!seen.has(command.id))
            seen.set(command.id, command);
    }
    return [...seen.values()];
}
function normalizePluginId(value) {
    return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function formatPluginDetail(plugin) {
    return [
        `${plugin.title} (${plugin.id})`,
        plugin.version ? `version: ${plugin.version}` : undefined,
        `description: ${plugin.description}`,
        `path: ${plugin.path}`,
        `capabilities: ${plugin.capabilities.join(", ") || "none"}`,
        "commands:",
        ...plugin.commands.map((command) => `- ${command.id}: ${command.description}`)
    ].filter(Boolean).join("\n");
}
export function formatPluginSelection(selection) {
    return JSON.stringify({
        plugin: {
            id: selection.plugin.id,
            title: selection.plugin.title,
            description: selection.plugin.description,
            version: selection.plugin.version,
            capabilities: selection.plugin.capabilities
        },
        command: selection.command
    }, null, 2);
}
