// ================================================================
// Filesystem helpers
// ================================================================
import { chmod, lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
export const PRIVATE_FILE_MODE = 0o600;
export const PRIVATE_DIR_MODE = 0o700;
export async function readJsonFile(path) {
    const raw = await readRegularFileNoFollow(path, "JSON");
    return JSON.parse(raw);
}
export async function readRegularFileNoFollow(path, label = "File") {
    let handle;
    try {
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        const info = await handle.stat();
        if (!info.isFile())
            throw new Error(`${label} path is not a regular file: ${path}`);
        return await handle.readFile("utf8");
    }
    catch (error) {
        if (isNodeError(error) && ["ELOOP", "EMLINK"].includes(error.code ?? "")) {
            throw new Error(`${label} file is a symlink; refusing to read it: ${path}`);
        }
        throw error;
    }
    finally {
        await handle?.close().catch(() => undefined);
    }
}
export async function readPrivateFileIfExists(path, options = {}) {
    for (const dir of options.dirs ?? [dirname(path)]) {
        if (!await regularPrivateDirExists(dir))
            return undefined;
    }
    let handle;
    try {
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        const info = await handle.stat();
        if (!info.isFile())
            throw new Error(`Private state path is not a regular file: ${path}`);
        return await handle.readFile("utf8");
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT")
            return undefined;
        if (isNodeError(error) && ["ELOOP", "EMLINK"].includes(error.code ?? "")) {
            throw new Error(`Private state file is a symlink: ${path}`);
        }
        throw error;
    }
    finally {
        await handle?.close().catch(() => undefined);
    }
}
export async function privateFileStatIfExists(path, options = {}) {
    for (const dir of options.dirs ?? [dirname(path)]) {
        if (!await regularPrivateDirExists(dir))
            return undefined;
    }
    try {
        const info = await lstat(path);
        if (info.isSymbolicLink())
            throw new Error(`Private state file is a symlink: ${path}`);
        if (!info.isFile())
            throw new Error(`Private state path is not a regular file: ${path}`);
        return info;
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT")
            return undefined;
        throw error;
    }
}
export async function removePrivateFileIfExists(path, options = {}) {
    const info = await privateFileStatIfExists(path, options);
    if (!info)
        return false;
    await rm(path, { force: true });
    return true;
}
export async function listPrivateDirIfExists(path, options = {}) {
    for (const dir of options.dirs ?? []) {
        if (!await regularPrivateDirExists(dir))
            return undefined;
    }
    if (!await regularPrivateDirExists(path))
        return undefined;
    return await readdir(path, { withFileTypes: true });
}
export async function writeJsonFile(path, value) {
    await ensurePrivateDir(dirname(path));
    await writePrivateFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
export async function ensureDir(path) {
    await mkdir(path, { recursive: true });
}
export async function ensurePrivateDir(path) {
    await assertNoSymlinkComponentsUnderCwd(path);
    await mkdir(path, { recursive: true, mode: PRIVATE_DIR_MODE });
    await assertNoSymlinkComponentsUnderCwd(path);
    const info = await lstat(path);
    if (info.isSymbolicLink())
        throw new Error(`Private directory path is a symlink: ${path}`);
    if (!info.isDirectory())
        throw new Error(`Private directory path is not a directory: ${path}`);
    await chmod(path, PRIVATE_DIR_MODE);
}
export async function assertNoSymlinkComponentsUnderRoot(path, root) {
    const absolutePath = resolve(path);
    const absoluteRoot = resolve(root);
    const rel = relative(absoluteRoot, absolutePath);
    if (!rel || rel.startsWith("..") || isAbsolute(rel))
        return;
    let current = absoluteRoot;
    for (const part of rel.split(/[\\/]/u).filter(Boolean)) {
        current = join(current, part);
        try {
            const info = await lstat(current);
            if (info.isSymbolicLink())
                throw new Error(`Path component is a symlink: ${current}`);
        }
        catch (error) {
            if (isNodeError(error) && error.code === "ENOENT")
                return;
            throw error;
        }
    }
}
async function regularPrivateDirExists(path) {
    try {
        await assertNoSymlinkComponentsUnderCwd(path);
        const info = await lstat(path);
        if (info.isSymbolicLink())
            throw new Error(`Private state directory is a symlink: ${path}`);
        if (!info.isDirectory())
            throw new Error(`Private state path is not a directory: ${path}`);
        return true;
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT")
            return false;
        throw error;
    }
}
export function fileExists(path) {
    return existsSync(path);
}
export async function writePrivateFile(path, content) {
    const dir = dirname(path);
    await ensurePrivateDir(dir);
    const tempPath = join(dir, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
    try {
        await writePrivateTempFileNoFollow(tempPath, content);
        await rename(tempPath, path);
    }
    catch (error) {
        await rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
    }
}
async function writePrivateTempFileNoFollow(path, content) {
    const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, PRIVATE_FILE_MODE);
    try {
        await handle.writeFile(content, typeof content === "string" ? "utf8" : undefined);
        await handle.chmod(PRIVATE_FILE_MODE);
    }
    finally {
        await handle.close();
    }
}
async function assertNoSymlinkComponentsUnderCwd(path) {
    await assertNoSymlinkComponentsUnderRoot(path, process.cwd());
}
function isNodeError(error) {
    return typeof error === "object" && error !== null && "code" in error;
}
export async function appendPrivateFile(path, content) {
    await ensurePrivateDir(dirname(path));
    const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, PRIVATE_FILE_MODE);
    try {
        await handle.writeFile(content, typeof content === "string" ? "utf8" : undefined);
        await handle.chmod(PRIVATE_FILE_MODE);
    }
    finally {
        await handle.close();
    }
}
