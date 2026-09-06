// ================================================================
// Minimal .env loader
// ================================================================
// No dependency is used. Existing process.env values win, so shell-provided
// secrets cannot be accidentally overwritten by a stale local file.
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { assertNoSymlinkComponentsUnderRoot } from "./files.js";
export async function loadEnvFile(path = ".env", baseDir = process.cwd(), options = {}) {
    const resolved = resolve(baseDir, path);
    const result = { path: resolved, loaded: [], skipped: [], required: options.required || undefined };
    await assertNoSymlinkComponentsUnderRoot(resolved, baseDir);
    const raw = await readEnvFileNoFollow(resolved);
    if (raw === undefined) {
        if (options.required)
            throw new Error(`Env file does not exist: ${resolved}`);
        return { ...result, missing: true };
    }
    for (const line of raw.split("\n")) {
        const parsed = parseEnvLine(line);
        if (!parsed)
            continue;
        const [key, value] = parsed;
        if (process.env[key] !== undefined) {
            result.skipped.push(key);
            continue;
        }
        process.env[key] = value;
        result.loaded.push(key);
    }
    return result;
}
export async function readEnvFileNoFollow(path) {
    let handle;
    try {
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        const info = await handle.stat();
        if (!info.isFile())
            throw new Error(`Env path is not a regular file: ${path}`);
        return await handle.readFile("utf8");
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT")
            return undefined;
        if (isNodeError(error) && ["ELOOP", "EMLINK"].includes(error.code ?? "")) {
            throw new Error(`Env file is a symlink; refusing to load it: ${path}`);
        }
        throw error;
    }
    finally {
        await handle?.close().catch(() => undefined);
    }
}
export function parseEnvLine(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#"))
        return undefined;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(trimmed);
    if (!match)
        return undefined;
    const key = match[1];
    let value = match[2].trim();
    if (value.startsWith('"') || value.startsWith("'")) {
        value = readQuotedValue(value);
    }
    else {
        value = value.replace(/\s+#.*$/u, "").trim();
    }
    return [key, value.replace(/\\n/gu, "\n")];
}
function readQuotedValue(value) {
    const quote = value[0];
    for (let index = 1; index < value.length; index += 1) {
        if (value[index] === quote && value[index - 1] !== "\\")
            return value.slice(1, index);
    }
    return value.slice(1);
}
function isNodeError(error) {
    return typeof error === "object" && error !== null && "code" in error;
}
