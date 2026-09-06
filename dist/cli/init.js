// ================================================================
// Project initializer
// ================================================================
// `viser init` writes a local editable config in the current working directory.
// It does not write secrets; messenger tokens stay in environment variables.
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { DEFAULT_CONFIG } from "../config.js";
import { writePrivateFile } from "../utils/files.js";
export async function writeExampleConfig(force = false) {
    const target = resolve(process.cwd(), "viser.config.json");
    const existing = await inspectConfigTarget(target);
    if (existing && !force) {
        if (existing === "symlink")
            throw new Error(`viser.config.json is a symlink; refusing to treat it as an existing safe config: ${target}`);
        if (existing === "non-file")
            throw new Error(`viser.config.json exists and is not a regular file: ${target}`);
        return `viser.config.json already exists. Use --force to overwrite: ${target}`;
    }
    const { configPath: _unused, ...config } = DEFAULT_CONFIG;
    await writePrivateFile(target, `${JSON.stringify(config, null, 2)}\n`);
    return `Created ${target}`;
}
async function inspectConfigTarget(target) {
    try {
        const info = await lstat(target);
        if (info.isSymbolicLink())
            return "symlink";
        if (!info.isFile())
            return "non-file";
        return "file";
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT")
            return undefined;
        throw error;
    }
}
function isNodeError(error) {
    return typeof error === "object" && error !== null && "code" in error;
}
