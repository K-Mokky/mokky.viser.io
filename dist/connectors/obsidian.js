// ================================================================
// Obsidian/local Markdown vault append sender
// ================================================================
// Obsidian is local-first workspace automation, so Viser treats it like other
// outbound connector actions: only short aliases such as obsidian:ops-notes are
// accepted by actions/scheduler state, and the final local Markdown append is
// still approval-gated before it touches the user's vault.
import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { dirname, isAbsolute, normalize, relative, resolve } from "node:path";
import { assertNoSymlinkComponentsUnderRoot } from "../utils/files.js";
export async function appendObsidianNoteMessage(config, noteId, text, options = {}) {
    const target = resolveObsidianNoteTarget(config, noteId);
    const body = formatObsidianAppend(normalizeObsidianMessage(text, config.maxMessageChars), options.now ?? new Date());
    try {
        await assertSafeObsidianVaultRoot(target.vaultDir);
        await assertNoSymlinkComponentsUnderRoot(dirname(target.absolutePath), target.vaultDir);
        await mkdir(dirname(target.absolutePath), { recursive: true, mode: 0o700 });
        await assertNoSymlinkComponentsUnderRoot(target.absolutePath, target.vaultDir);
        const handle = await open(target.absolutePath, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
        try {
            await handle.writeFile(body, "utf8");
        }
        finally {
            await handle.close();
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(redactObsidianDetail(`Obsidian note append failed: ${message}`, config, noteId, target, text));
    }
}
export function resolveObsidianNoteTarget(config, noteId) {
    const alias = normalizeObsidianTargetAlias(noteId);
    const vaultDir = normalizeObsidianVaultDir(config.vaultDir);
    const note = config.notes[alias] ?? (alias === "default" ? config.note : undefined);
    if (!note) {
        throw new Error(`Obsidian note alias '${alias}' is not configured. Set ${config.noteEnv} or ${config.notesEnv}.`);
    }
    const notePath = normalizeObsidianNotePath(note);
    const absolutePath = resolve(vaultDir, notePath);
    assertPathInsideObsidianVault(vaultDir, absolutePath);
    return { vaultDir, notePath, absolutePath };
}
export function hasObsidianNoteTarget(config) {
    return Boolean(config.vaultDir && (config.note || Object.keys(config.notes).length > 0));
}
export function normalizeObsidianVaultDir(value) {
    const trimmed = value?.trim();
    if (!trimmed)
        throw new Error("Obsidian vault directory is required.");
    if (/[\u0000-\u001f\u007f]/u.test(trimmed))
        throw new Error("Obsidian vault directory must not contain control characters.");
    return resolve(trimmed);
}
export function normalizeObsidianTargetAlias(value) {
    const trimmed = value?.trim();
    if (!trimmed || trimmed.length > 80 || !/^[A-Za-z0-9._-]+$/u.test(trimmed)) {
        throw new Error("Obsidian note alias must be a short alias such as default, ops, or meeting-notes.");
    }
    return trimmed.toLowerCase();
}
export function normalizeObsidianNotePath(value) {
    const trimmed = value.trim();
    if (!trimmed)
        throw new Error("Obsidian note path is required.");
    if (trimmed.length > 512)
        throw new Error("Obsidian note path must be 512 characters or fewer.");
    if (isAbsolute(trimmed) || /^[A-Za-z]:[\\/]/u.test(trimmed))
        throw new Error("Obsidian note path must be relative to the vault.");
    if (trimmed.includes("\\") || /[\u0000-\u001f\u007f]/u.test(trimmed)) {
        throw new Error("Obsidian note path must use forward slashes and contain no control characters.");
    }
    const normalized = normalize(trimmed).replace(/^\.\//u, "");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
        throw new Error("Obsidian note path must not contain traversal segments.");
    }
    if (parts.some((part) => part.startsWith("."))) {
        throw new Error("Obsidian note path must not target hidden/private files.");
    }
    if (!/\.md$/iu.test(normalized))
        throw new Error("Obsidian note path must end with .md.");
    return parts.join("/");
}
export function parseObsidianNoteMap(value) {
    const raw = value?.trim();
    if (!raw)
        return {};
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            const output = {};
            for (const [key, target] of Object.entries(parsed)) {
                if (typeof target !== "string" || !target.trim())
                    continue;
                output[normalizeObsidianTargetAlias(key)] = normalizeObsidianNotePath(target);
            }
            return output;
        }
    }
    catch {
        // Fall through to a shell-friendly alias=note/path.md list.
    }
    const output = {};
    for (const part of raw.split(/[,\n;]/u)) {
        const separator = part.indexOf("=");
        if (separator <= 0)
            continue;
        const alias = normalizeObsidianTargetAlias(part.slice(0, separator));
        const target = part.slice(separator + 1).trim();
        if (alias && target)
            output[alias] = normalizeObsidianNotePath(target);
    }
    return output;
}
export function formatObsidianNoteTarget(target) {
    return target.notePath;
}
export function redactObsidianDetail(detail, config, alias, target, text) {
    let output = detail;
    for (const secret of [
        config.vaultDir,
        config.note,
        ...Object.values(config.notes),
        alias,
        target?.vaultDir,
        target?.notePath,
        target?.absolutePath,
        text
    ]) {
        if (secret)
            output = output.split(secret).join("[REDACTED]");
    }
    return output;
}
function formatObsidianAppend(text, now) {
    return `\n\n## Viser — ${now.toISOString()}\n\n${text}\n`;
}
function normalizeObsidianMessage(text, maxMessageChars) {
    const normalized = text.replace(/\r\n?/gu, "\n").trim();
    if (!normalized)
        throw new Error("Obsidian note message body is required.");
    if (normalized.length > maxMessageChars)
        throw new Error(`Obsidian note message body must be ${maxMessageChars} characters or fewer.`);
    return normalized;
}
async function assertSafeObsidianVaultRoot(vaultDir) {
    const info = await lstat(vaultDir);
    if (info.isSymbolicLink())
        throw new Error("Obsidian vault directory must not be a symlink.");
    if (!info.isDirectory())
        throw new Error("Obsidian vault path must be a directory.");
}
function assertPathInsideObsidianVault(vaultDir, absolutePath) {
    const rel = relative(vaultDir, absolutePath);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
        throw new Error("Obsidian note path must stay inside the configured vault.");
    }
}
