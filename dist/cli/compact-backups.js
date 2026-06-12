// ================================================================
// Compact backup artifact inventory and cleanup
// ================================================================
// Session/memory compaction intentionally writes private .bak files before
// shrinking active state. These artifacts are excluded from ordinary exports,
// but operators still need a safe way to see and explicitly delete them.
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { assertNoSymlinkComponentsUnderRoot, PRIVATE_FILE_MODE, removePrivateFileIfExists } from "../utils/files.js";
export async function compactBackupReport(config, options = {}) {
    const artifacts = await listCompactBackups(config, { fixPermissions: Boolean(options.fixPermissions) });
    const totalBytes = artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0);
    const warnings = artifacts.filter((artifact) => artifact.warning);
    const fixedCount = artifacts.filter((artifact) => artifact.permissionsFixed).length;
    if (options.delete && !options.force) {
        return [
            `Viser compact backups: ${artifacts.length ? "FOUND" : "NONE"}`,
            `summary: ${artifacts.length} file${artifacts.length === 1 ? "" : "s"}, ${totalBytes} bytes, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`,
            fixedCount ? `permissions fixed: ${fixedCount}` : undefined,
            "",
            "delete mode: blocked",
            "Add `--force` to delete listed regular compact backup artifacts after reviewing them.",
            "",
            ...formatArtifacts(artifacts)
        ].filter(Boolean).join("\n");
    }
    if (options.delete && options.force) {
        const removable = artifacts.filter((artifact) => !artifact.deleteBlocked);
        const removed = await Promise.all(removable.map((artifact) => removePrivateFileIfExists(artifact.path, { dirs: [dirname(artifact.path)] })));
        return [
            "Viser compact backups: CLEANED",
            `removed: ${removed.filter(Boolean).length}`,
            warnings.length ? `skipped warnings: ${warnings.length}` : "skipped warnings: none",
            fixedCount ? `permissions fixed: ${fixedCount}` : undefined,
            "",
            ...formatArtifacts(warnings)
        ].filter(Boolean).join("\n");
    }
    return [
        `Viser compact backups: ${artifacts.length ? "FOUND" : "NONE"}`,
        `summary: ${artifacts.length} file${artifacts.length === 1 ? "" : "s"}, ${totalBytes} bytes, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`,
        fixedCount ? `permissions fixed: ${fixedCount}` : undefined,
        artifacts.length
            ? "delete: review the list, then run `viser compact-backups --delete --force` to remove regular compact backup artifacts."
            : "delete: nothing to remove.",
        artifacts.length && !options.fixPermissions
            ? "permissions: run `viser compact-backups --fix-permissions` to chmod broad regular compact backups to 600."
            : undefined,
        "",
        ...formatArtifacts(artifacts)
    ].filter(Boolean).join("\n");
}
async function listCompactBackups(config, options) {
    const storageDir = config.storage.dir;
    const root = config.assistant.workdir;
    const storageRootWarning = await inspectDirectory(storageDir, "storage", storageDir, root);
    if (storageRootWarning === "missing")
        return [];
    if (storageRootWarning !== "ok")
        return [storageRootWarning];
    const artifacts = [
        ...await collectArea(config.memory.dir, "memory", storageDir, root, isMemoryCompactBackup, options),
        ...await collectArea(join(config.storage.dir, "sessions"), "sessions", storageDir, root, isSessionCompactBackup, options)
    ];
    return artifacts.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
async function collectArea(dir, area, storageDir, root, isBackup, options) {
    const directoryWarning = await inspectDirectory(dir, area, storageDir, root);
    if (directoryWarning === "missing")
        return [];
    if (directoryWarning !== "ok")
        return [directoryWarning];
    const artifacts = [];
    const names = await readdir(dir);
    for (const name of names.filter(isBackup).sort()) {
        const path = join(dir, name);
        const relativePath = relative(storageDir, path);
        const info = await lstat(path);
        if (info.isSymbolicLink()) {
            artifacts.push({
                area,
                path,
                relativePath,
                bytes: 0,
                warning: "symlink compact backup artifact; refusing to delete automatically",
                deleteBlocked: true
            });
            continue;
        }
        if (!info.isFile()) {
            artifacts.push({
                area,
                path,
                relativePath,
                bytes: 0,
                warning: "non-file compact backup artifact; refusing to delete automatically",
                deleteBlocked: true
            });
            continue;
        }
        const mode = info.mode & 0o777;
        const isBroad = (mode & 0o077) !== 0;
        if (isBroad && options.fixPermissions)
            await chmodCompactBackupNoFollow(path);
        artifacts.push({
            area,
            path,
            relativePath,
            bytes: info.size,
            mode: isBroad && options.fixPermissions ? PRIVATE_FILE_MODE : mode,
            warning: isBroad && !options.fixPermissions
                ? "permissions are group/world accessible; run with --fix-permissions to chmod 600"
                : undefined,
            permissionsFixed: isBroad && options.fixPermissions
        });
    }
    return artifacts;
}
async function inspectDirectory(dir, area, storageDir, root) {
    try {
        const info = await lstat(dir);
        const relativePath = relative(storageDir, dir) || ".";
        if (info.isSymbolicLink()) {
            return {
                area,
                path: dir,
                relativePath,
                bytes: 0,
                warning: "compact backup directory is a symlink; refusing to inspect or delete outside storage",
                deleteBlocked: true
            };
        }
        await assertNoSymlinkComponentsUnderRoot(dir, root);
        if (!info.isDirectory()) {
            return {
                area,
                path: dir,
                relativePath,
                bytes: 0,
                warning: "compact backup path is not a directory; refusing to inspect or delete automatically",
                deleteBlocked: true
            };
        }
        return "ok";
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT")
            return "missing";
        return {
            area,
            path: dir,
            relativePath: relative(storageDir, dir) || ".",
            bytes: 0,
            warning: `could not inspect compact backup directory: ${error instanceof Error ? error.message : String(error)}`,
            deleteBlocked: true
        };
    }
}
async function chmodCompactBackupNoFollow(path) {
    let handle;
    try {
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        const info = await handle.stat();
        if (!info.isFile())
            throw new Error(`compact backup artifact is not a regular file: ${path}`);
        await handle.chmod(PRIVATE_FILE_MODE);
    }
    finally {
        await handle?.close().catch(() => undefined);
    }
}
function formatArtifacts(artifacts) {
    if (artifacts.length === 0)
        return [];
    return artifacts.map((artifact) => [
        `- [${artifact.area}] ${artifact.relativePath}`,
        `  bytes: ${artifact.bytes}`,
        artifact.mode !== undefined ? `  mode: ${artifact.mode.toString(8)}` : undefined,
        artifact.warning ? `  warning: ${artifact.warning}` : undefined
    ].filter(Boolean).join("\n"));
}
function isMemoryCompactBackup(name) {
    return /\.bak\.jsonl$/iu.test(name);
}
function isSessionCompactBackup(name) {
    return /\.bak(?:\.jsonl)?$/iu.test(name);
}
function isNodeError(error) {
    return typeof error === "object" && error !== null && "code" in error;
}
