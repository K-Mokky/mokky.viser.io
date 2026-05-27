// ================================================================
// Local plugin registry
// ================================================================
// Plugins are declarative prompt/tooling extensions stored as `plugin.json`
// manifests. Viser treats plugin content as untrusted local data: users must
// explicitly select a plugin command, and no plugin gets hidden tool or shell
// privileges.

import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { listPrivateDirIfExists, readPrivateFileIfExists } from "../utils/files.ts";
import type { PluginCommandDefinition, PluginDefinition, PluginSelection } from "./types.ts";

interface PluginManifest {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  version?: unknown;
  capabilities?: unknown;
  commands?: unknown;
}

export class PluginRegistry {
  private dirs: string[];

  constructor(dirs: string[]) {
    this.dirs = dirs;
  }

  async list(): Promise<PluginDefinition[]> {
    const plugins: PluginDefinition[] = [];

    for (const dir of this.dirs) {
      const entries = await listPrivateDirIfExists(dir);
      if (!entries) continue;
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pluginDir = join(dir, entry.name);
        if (!await isRegularDirectory(pluginDir)) continue;
        const plugin = await loadPlugin(join(pluginDir, "plugin.json"), entry.name, pluginDir);
        if (plugin) plugins.push(plugin);
      }
    }

    return dedupePlugins(plugins).sort((a, b) => a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<PluginDefinition | undefined> {
    const normalized = normalizePluginId(id);
    return (await this.list()).find((plugin) => plugin.id === normalized);
  }

  async select(pluginId: string, commandId: string): Promise<PluginSelection | undefined> {
    const plugin = await this.get(pluginId);
    if (!plugin) return undefined;
    const command = plugin.commands.find((item) => item.id === normalizePluginId(commandId));
    return command ? { plugin, command } : undefined;
  }

  async formatCatalog(limit: number): Promise<string> {
    const plugins = (await this.list()).slice(0, limit);
    if (plugins.length === 0) return "(none)";
    return plugins.map((plugin) => {
      const commands = plugin.commands.map((command) => command.id).join(", ") || "no commands";
      return `- ${plugin.id}: ${plugin.description || plugin.title} (commands: ${commands})`;
    }).join("\n");
  }
}

async function loadPlugin(path: string, fallbackId: string, pluginDir: string): Promise<PluginDefinition | undefined> {
  const raw = await safeReadPlugin(path, pluginDir);
  if (raw === undefined) return undefined;

  let manifest: PluginManifest;
  try {
    manifest = JSON.parse(raw) as PluginManifest;
  } catch {
    return undefined;
  }

  const id = normalizePluginId(typeof manifest.id === "string" ? manifest.id : fallbackId);
  const commands = parseCommands(manifest.commands);
  if (!id || commands.length === 0) return undefined;

  const title = typeof manifest.title === "string" && manifest.title.trim() ? manifest.title.trim() : id;
  const description = typeof manifest.description === "string" && manifest.description.trim()
    ? manifest.description.trim()
    : title;
  const version = typeof manifest.version === "string" && manifest.version.trim() ? manifest.version.trim() : undefined;
  const capabilities = Array.isArray(manifest.capabilities)
    ? manifest.capabilities.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];

  return { id, title, description, version, capabilities, commands, path, dir: pluginDir };
}

function parseCommands(value: unknown): PluginCommandDefinition[] {
  if (!Array.isArray(value)) return [];
  const commands: PluginCommandDefinition[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const id = normalizePluginId(typeof item.id === "string" ? item.id : "");
    const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
    if (!id || !prompt) continue;
    const description = typeof item.description === "string" && item.description.trim()
      ? item.description.trim()
      : id;
    commands.push({ id, description, prompt });
  }
  return dedupeCommands(commands);
}

async function safeReadPlugin(path: string, pluginDir: string): Promise<string | undefined> {
  try {
    return await readPrivateFileIfExists(path, { dirs: [pluginDir] });
  } catch {
    return undefined;
  }
}

async function isRegularDirectory(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    return info.isDirectory() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}

function dedupePlugins(plugins: PluginDefinition[]): PluginDefinition[] {
  const seen = new Map<string, PluginDefinition>();
  for (const plugin of plugins) {
    if (!seen.has(plugin.id)) seen.set(plugin.id, plugin);
  }
  return [...seen.values()];
}

function dedupeCommands(commands: PluginCommandDefinition[]): PluginCommandDefinition[] {
  const seen = new Map<string, PluginCommandDefinition>();
  for (const command of commands) {
    if (!seen.has(command.id)) seen.set(command.id, command);
  }
  return [...seen.values()];
}

function normalizePluginId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function formatPluginDetail(plugin: PluginDefinition): string {
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

export function formatPluginSelection(selection: PluginSelection): string {
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
