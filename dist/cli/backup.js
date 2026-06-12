// ================================================================
// State backup/export
// ================================================================
// Viser stores valuable operational state in inspectable JSON/JSONL files.
// This module exports that state into a single redacted JSON artifact so a
// user can keep recoverable snapshots before service changes or upgrades.
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { assertNoSymlinkComponentsUnderRoot, ensurePrivateDir, writePrivateFile } from "../utils/files.js";
import { nowIso } from "../utils/text.js";
const DEFAULT_MAX_FILE_BYTES = 1_000_000;
const REDACTED = "[REDACTED]";
export async function createBackupReport(config, options = {}) {
    const result = await createBackup(config, options);
    return [
        "Viser backup created",
        `- path: ${result.path}`,
        `- files: ${result.artifact.files.length}`,
        `- storage: ${result.artifact.storageDir}`,
        `- config: ${result.artifact.configPath ?? "defaults only"}`,
        result.truncatedFiles.length ? `- truncated: ${result.truncatedFiles.join(", ")}` : "- truncated: none",
        result.redactedFiles.length ? `- redacted files: ${result.redactedFiles.join(", ")}` : "- redacted files: none",
        "",
        "Restore note: this is a redacted export artifact. Review it manually before copying files back into `.viser`."
    ].join("\n");
}
export async function createBackup(config, options = {}) {
    const outputPath = resolveOutputPath(config, options.outputPath);
    await assertSafeBackupOutputTarget(outputPath, Boolean(options.force));
    const maxFileBytes = Math.max(1, options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES);
    const artifact = {
        format: "viser.backup.v1",
        createdAt: nowIso(),
        configPath: config.configPath,
        storageDir: config.storage.dir,
        config: sanitizeConfig(config),
        files: await collectStorageFiles(config.storage.dir, config.assistant.workdir, outputPath, maxFileBytes)
    };
    await ensurePrivateDir(dirname(outputPath));
    await writePrivateFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
    return {
        path: outputPath,
        artifact,
        truncatedFiles: artifact.files.filter((file) => file.truncated).map((file) => file.path),
        redactedFiles: artifact.files.filter((file) => file.redacted).map((file) => file.path)
    };
}
function resolveOutputPath(config, outputPath) {
    if (outputPath)
        return isAbsolute(outputPath) ? resolve(outputPath) : resolve(process.cwd(), outputPath);
    return join(config.storage.dir, "backups", `viser-backup-${fileSafeTimestamp(nowIso())}.json`);
}
async function assertSafeBackupOutputTarget(path, force) {
    try {
        const info = await lstat(path);
        if (info.isSymbolicLink()) {
            if (force)
                return;
            throw new Error(`Backup output path is a symlink; use --force to replace the symlink itself: ${path}`);
        }
        if (!info.isFile()) {
            throw new Error(`Backup output path exists and is not a regular file: ${path}`);
        }
        if (!force)
            throw new Error(`Backup already exists: ${path}. Use --force to overwrite.`);
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT")
            return;
        throw error;
    }
}
async function collectStorageFiles(storageDir, root, outputPath, maxFileBytes) {
    if (!await isSafeStorageRoot(storageDir, root))
        return [];
    const files = [];
    const outputRoot = resolve(dirname(outputPath));
    await walk(storageDir, async (path) => {
        const resolved = resolve(path);
        const relativePath = relative(storageDir, path);
        if (isExcludedStoragePath(relativePath))
            return;
        if (resolved === resolve(outputPath))
            return;
        if (isInside(resolved, outputRoot) && basename(outputRoot) === "backups")
            return;
        const info = await lstat(path);
        if (info.isSymbolicLink())
            return;
        if (!info.isFile())
            return;
        const raw = await readBackupFileNoFollow(path);
        if (!raw)
            return;
        const truncated = raw.length > maxFileBytes;
        const redacted = redactContent(raw.subarray(0, maxFileBytes).toString("utf8"));
        files.push({
            path: relativePath,
            bytes: raw.length,
            truncated,
            redacted: redacted.redacted,
            content: redacted.content
        });
    }, (path) => !isExcludedStoragePath(relative(storageDir, path)));
    return files.sort((a, b) => a.path.localeCompare(b.path));
}
export async function readBackupFileNoFollow(path) {
    let handle;
    try {
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        const info = await handle.stat();
        if (!info.isFile())
            return undefined;
        return await handle.readFile();
    }
    catch (error) {
        if (isNodeError(error) && ["ENOENT", "ELOOP", "EMLINK"].includes(error.code ?? ""))
            return undefined;
        throw error;
    }
    finally {
        await handle?.close().catch(() => undefined);
    }
}
async function isSafeStorageRoot(storageDir, root) {
    try {
        const info = await lstat(storageDir);
        if (info.isSymbolicLink()) {
            throw new Error(`Backup storage path is a symlink; refusing to export outside storage: ${storageDir}`);
        }
        await assertNoSymlinkComponentsUnderRoot(storageDir, root);
        if (!info.isDirectory()) {
            throw new Error(`Backup storage path is not a directory: ${storageDir}`);
        }
        return true;
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT")
            return false;
        throw error;
    }
}
function isExcludedStoragePath(path) {
    const parts = path.split(/[\\/]/u);
    const [top, child] = parts;
    const leaf = parts.at(-1) ?? path;
    return top === "backups"
        || top === "logs"
        || top === "npm-cache"
        || top === "repairs"
        || (top === "actions" && child === "backups")
        || isCompactBackupArtifact(top, leaf)
        || isAtomicTempFileName(leaf);
}
function isCompactBackupArtifact(top, leaf) {
    if (top === "memory")
        return /\.bak\.jsonl$/iu.test(leaf);
    if (top === "sessions")
        return /\.bak(?:\.jsonl)?$/iu.test(leaf);
    return false;
}
function isAtomicTempFileName(name) {
    return /^\..+\.\d+\.[0-9a-f-]+\.tmp$/iu.test(name);
}
async function walk(root, visit, shouldDescend) {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
        const path = join(root, entry.name);
        const info = await lstat(path);
        if (info.isSymbolicLink())
            continue;
        if (info.isDirectory()) {
            if (shouldDescend(path))
                await walk(path, visit, shouldDescend);
            continue;
        }
        await visit(path);
    }
}
function sanitizeConfig(config) {
    return sanitizeValue({
        ...config,
        configPath: config.configPath
    });
}
function sanitizeValue(value, key = "", secretContext = false) {
    const isSecret = secretContext || looksSecretLike(key);
    if (Array.isArray(value))
        return value.map((item) => sanitizeValue(item, key, isSecret));
    if (typeof value !== "object" || value === null) {
        return isSecret && value ? REDACTED : value;
    }
    const output = {};
    for (const [childKey, childValue] of Object.entries(value)) {
        output[childKey] = sanitizeValue(childValue, childKey, isSecret);
    }
    return output;
}
function looksSecretLike(key) {
    return /token|secret|password|credential|account|chatDbPath|phoneNumberId|webhookUrl|api[_-]?key|siteUrl|baseUrl|botEmail|username|vaultDir|^note$|^notes$|^room$|^rooms$|^target$|^targets$|^channel$|^channels$|^nick$|^from$|^recipient$|^recipients$/i.test(key);
}
function redactContent(content) {
    let output = content;
    output = output.replace(/("(?:(?:[^"\\]|\\.)*?(?:token|secret|password|credential|account|chatDbPath|phoneNumberId|webhookUrl|api[_-]?key|siteUrl|baseUrl|botEmail|username|vaultDir|room|rooms|target|targets|topic|topics|channel|channels|nick|from|recipient|recipients)(?:[^"\\]|\\.)*?)"\s*:\s*)"(?:(?:[^"\\]|\\.)*)"/giu, `$1"${REDACTED}"`);
    output = output.replace(/(\b[A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|ACCOUNT|WEBHOOKS?|WEBHOOK_URL|API[_-]?KEY)[A-Za-z0-9_]*\b\s*[:=]\s*["'])([^"'\r\n]*)/giu, `$1${REDACTED}`);
    output = output.replace(/(\b[A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|ACCOUNT|WEBHOOKS?|WEBHOOK_URL|API[_-]?KEY)[A-Za-z0-9_]*\b\s*[:=]\s*)([^"'\s,}\]]+)/giu, `$1${REDACTED}`);
    output = output.replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/gu, REDACTED);
    output = output.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/gu, REDACTED);
    output = output.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/giu, `$1${REDACTED}`);
    output = output.replace(/\b(Bot\s+)[A-Za-z0-9._-]{20,}/gu, `$1${REDACTED}`);
    output = output.replace(/("code"\s*:\s*")([A-F0-9]{8})(")/giu, `$1${REDACTED}$3`);
    output = output.replace(/\bpair:[A-F0-9]{8}\b/giu, `pair:${REDACTED}`);
    return { content: output, redacted: output !== content };
}
function isInside(child, parent) {
    const rel = relative(parent, child);
    return Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel);
}
function fileSafeTimestamp(value) {
    return value.replace(/[:.]/g, "-");
}
function isNodeError(error) {
    return typeof error === "object" && error !== null && "code" in error;
}
