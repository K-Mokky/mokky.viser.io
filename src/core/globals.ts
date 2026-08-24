// ================================================================
// Operator globals / persona store
// ================================================================
// These settings are operator-controlled (CLI slash commands), not inferred
// chat memories. They persist across sessions and inject into every provider
// prompt as trusted runtime policy after the safety contract. High-risk
// prompt-injection content is refused at write time and omitted at read time.

import { join } from "node:path";
import { ensurePrivateDir, readPrivateFileIfExists, writePrivateFile } from "../utils/files.ts";
import { nowIso } from "../utils/text.ts";
import { promptGuardDecision } from "./prompt-guard.ts";
import type { GlobalSetting, GlobalsState } from "./types.ts";

export const GLOBALS_SCHEMA_VERSION = 1;
export const DEFAULT_GLOBAL_MAX_VALUE_CHARS = 1000;
export const DEFAULT_GLOBAL_MAX_KEYS = 24;
export const RESERVED_GLOBAL_KEYS = ["tone", "personality", "style", "user", "facts"] as const;
export type ReservedGlobalKey = (typeof RESERVED_GLOBAL_KEYS)[number];

const KEY_ALIASES: Record<string, ReservedGlobalKey> = {
  tone: "tone",
  voice: "tone",
  speech: "style",
  style: "style",
  personality: "personality",
  persona: "personality",
  character: "personality",
  user: "user",
  "about-user": "user",
  "user-info": "user",
  facts: "facts",
  "user-facts": "facts"
};

const KEY_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u;

export class GlobalsStore {
  private dir: string;
  private maxValueChars: number;
  private maxKeys: number;

  constructor(dir: string, options: { maxValueChars?: number; maxKeys?: number } = {}) {
    this.dir = dir;
    this.maxValueChars = Math.max(1, Math.floor(options.maxValueChars ?? DEFAULT_GLOBAL_MAX_VALUE_CHARS));
    this.maxKeys = Math.max(1, Math.floor(options.maxKeys ?? DEFAULT_GLOBAL_MAX_KEYS));
  }

  async list(): Promise<GlobalSetting[]> {
    const state = await this.readState();
    return Object.values(state.settings).sort((a, b) => a.key.localeCompare(b.key));
  }

  async get(key: string): Promise<GlobalSetting | undefined> {
    const normalized = normalizeGlobalKey(key);
    if (!normalized) return undefined;
    const state = await this.readState();
    return state.settings[normalized];
  }

  async set(key: string, value: string, source: string): Promise<GlobalSetting> {
    const normalized = requireGlobalKey(key);
    const text = normalizeGlobalValue(value, this.maxValueChars);
    assertSafeGlobalValue(normalized, text);
    const state = await this.readState();
    if (!state.settings[normalized] && Object.keys(state.settings).length >= this.maxKeys) {
      throw new Error(`Cannot store more than ${this.maxKeys} globals. Clear an unused key first.`);
    }
    const setting: GlobalSetting = {
      key: normalized,
      value: text,
      source,
      updatedAt: nowIso()
    };
    state.settings[normalized] = setting;
    await this.writeState(state);
    return setting;
  }

  async clear(key: string): Promise<boolean> {
    const normalized = requireGlobalKey(key);
    const state = await this.readState();
    if (!state.settings[normalized]) return false;
    delete state.settings[normalized];
    await this.writeState(state);
    return true;
  }

  async formatForPrompt(): Promise<string> {
    const settings = await this.list();
    if (settings.length === 0) return "(none)";

    const lines: string[] = [];
    for (const setting of settings) {
      if (isUnsafeGlobalValue(setting.value)) {
        lines.push(`${setting.key}: (omitted: stored value is not allowed as trusted runtime policy)`);
        continue;
      }
      lines.push(`${setting.key}: ${setting.value}`);
    }
    return lines.join("\n");
  }

  async count(): Promise<number> {
    return (await this.list()).length;
  }

  private filePath(): string {
    return join(this.dir, "globals.json");
  }

  private async readState(): Promise<GlobalsState> {
    const raw = await readPrivateFileIfExists(this.filePath(), { dirs: [this.dir] });
    if (raw === undefined) return emptyGlobalsState();
    try {
      const parsed = JSON.parse(raw) as unknown;
      return normalizeGlobalsState(parsed);
    } catch (error) {
      throw new Error(`Globals state is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async writeState(state: GlobalsState): Promise<void> {
    await ensurePrivateDir(this.dir);
    await writePrivateFile(this.filePath(), `${JSON.stringify(state, null, 2)}\n`);
  }
}

export function parseGlobalSetInput(input: string): { key: string; value: string } | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/^(\S+)\s+([\s\S]+)$/u);
  if (!match) return undefined;
  return { key: match[1], value: match[2] };
}

export function normalizeGlobalKey(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (KEY_ALIASES[trimmed]) return KEY_ALIASES[trimmed];
  if (!KEY_PATTERN.test(trimmed)) return undefined;
  return trimmed;
}

export function requireGlobalKey(value: string): string {
  const normalized = normalizeGlobalKey(value);
  if (!normalized) {
    throw new Error(
      `Invalid global key '${value}'. Use ${RESERVED_GLOBAL_KEYS.join(", ")}, or a lowercase key matching ${KEY_PATTERN}.`
    );
  }
  return normalized;
}

export function normalizeGlobalValue(value: string, maxValueChars: number): string {
  const text = value.replace(/\s+/gu, " ").trim();
  if (!text) throw new Error("Cannot store an empty global value.");
  if (Array.from(text).length > maxValueChars) {
    throw new Error(`Global value must be at most ${maxValueChars} characters.`);
  }
  return text;
}

export function isUnsafeGlobalValue(value: string): boolean {
  const guard = promptGuardDecision(value);
  const ids = new Set(guard.signals.map((signal) => signal.id));
  return guard.action === "block" || ids.has("instruction-override") || ids.has("api-key-misuse");
}

export function assertSafeGlobalValue(key: string, value: string): void {
  if (!isUnsafeGlobalValue(value)) return;
  const guard = promptGuardDecision(value);
  const ids = new Set(guard.signals.map((signal) => signal.id));
  const reason = guard.reason
    ?? (ids.has("api-key-misuse")
      ? "model API key instructions are not allowed in trusted operator globals"
      : "instruction-override is not allowed in trusted operator globals");
  const signals = [...ids].join(", ") || "unknown";
  throw new Error(`Refusing to store global '${key}': ${reason} (${signals}).`);
}

export function emptyGlobalsState(): GlobalsState {
  return { schemaVersion: GLOBALS_SCHEMA_VERSION, settings: {} };
}

export function normalizeGlobalsState(value: unknown): GlobalsState {
  if (!isPlainObject(value)) throw new Error("expected globals state object");
  if (value.schemaVersion !== GLOBALS_SCHEMA_VERSION) throw new Error("unsupported globals schemaVersion");
  if (!isPlainObject(value.settings)) throw new Error("settings must be an object");

  const settings: Record<string, GlobalSetting> = {};
  for (const [key, item] of Object.entries(value.settings)) {
    const setting = asGlobalSetting(key, item);
    settings[setting.key] = setting;
  }
  return { schemaVersion: GLOBALS_SCHEMA_VERSION, settings };
}

export function validateGlobalsState(value: unknown): { ok: true } | { ok: false; reason: string } {
  try {
    normalizeGlobalsState(value);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function asGlobalSetting(key: string, value: unknown): GlobalSetting {
  if (!isPlainObject(value)) throw new Error(`global '${key}' must be an object`);
  const normalizedKey = normalizeGlobalKey(typeof value.key === "string" ? value.key : key);
  if (!normalizedKey) throw new Error(`global '${key}' has an invalid key`);
  if (normalizedKey !== key) throw new Error(`global key '${key}' does not match stored key '${normalizedKey}'`);
  if (typeof value.value !== "string" || !value.value.trim()) throw new Error(`global '${key}' value must be a non-empty string`);
  if (typeof value.updatedAt !== "string" || !value.updatedAt.trim()) throw new Error(`global '${key}' updatedAt must be a string`);
  if (typeof value.source !== "string" || !value.source.trim()) throw new Error(`global '${key}' source must be a string`);
  return {
    key: normalizedKey,
    value: value.value,
    updatedAt: value.updatedAt,
    source: value.source
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
