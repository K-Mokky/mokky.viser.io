// ================================================================
// First-run setup helper
// ================================================================
// This is non-interactive on purpose: it creates an editable config if missing,
// installs bundled starter skills into the user's workspace, then prints the
// exact login/token steps still needed.
import { lstat, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { doctorReport } from "./doctor.js";
import { writeEnvTemplate } from "./env-check.js";
import { writeExampleConfig } from "./init.js";
import { ensurePrivateDir, fileExists, readRegularFileNoFollow, writePrivateFile } from "../utils/files.js";
export async function setupReport(force = false) {
    const initResult = await writeExampleConfig(force);
    const skillsResult = await installBundledSkills(force);
    const config = await loadConfig();
    const envResult = await writeEnvTemplate(config);
    return [
        "Viser setup",
        initResult,
        envResult,
        skillsResult,
        "",
        doctorReport(config),
        "",
        "Next steps:",
        "1. Run `codex login`, `gemini`, and/or `claude` in a normal terminal to complete local CLI account login.",
        "2. Put TELEGRAM_BOT_TOKEN and DISCORD_BOT_TOKEN in `.env`, your shell, or a `VISER_ENV` file if you want messaging.",
        "3. Confirm env/token loading without leaking secrets: `viser env-check`.",
        "4. Verify provider runtime and live connector tokens with `viser provider-guide --probe` or `viser verify --live --probe-all-providers`.",
        "5. Prove local non-provider features with `viser smoke`.",
        "6. Run `viser config-check`, `viser state-check`, and `viser audit` before starting the foreground runtime.",
        "7. Run `viser gateway --dry-run --strict --live --probe-all-providers` for a no-start live provider-proof launch rehearsal.",
        "8. Run `viser launch-status` anytime for one single live launch verdict.",
        "9. Start Viser with `viser` in a foreground terminal window only after the rehearsal passes; the process stops when that terminal exits.",
        "10. Background service install/start/service-run and artifact generation are disabled. If an old service exists, remove it with `viser service uninstall`.",
        "11. For CLI-only use now, run `viser chat` or `viser ask \"질문\"`.",
        "12. Store durable global style/personality settings with `viser persona tone \"...\"`; store discovered facts with `/remember ... #tag`.",
        "13. Run `viser next-steps --live --probe-all-providers` anytime for an actionable recovery/launch checklist."
    ].join("\n");
}
async function installBundledSkills(force) {
    const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills");
    const targetRoot = resolve(process.cwd(), ".viser", "skills");
    if (!fileExists(sourceRoot))
        return "Bundled skills were not found; skipping starter skill install.";
    await ensurePrivateDir(targetRoot);
    const entries = await readdir(sourceRoot, { withFileTypes: true });
    const installed = [];
    const skipped = [];
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        const source = resolve(sourceRoot, entry.name);
        const target = resolve(targetRoot, entry.name);
        await assertSafeSkillInstallTarget(target);
        await assertNoSymlinkTree(target, "Starter skill target");
        if (fileExists(target) && !force) {
            skipped.push(entry.name);
            continue;
        }
        await copyBundledSkillDirectory(source, target);
        installed.push(entry.name);
    }
    return `Starter skills installed: ${installed.length ? installed.join(", ") : "none"}${skipped.length ? `; skipped existing: ${skipped.join(", ")}` : ""}`;
}
async function assertSafeSkillInstallTarget(target) {
    try {
        const info = await lstat(target);
        if (info.isSymbolicLink())
            throw new Error(`Starter skill target is a symlink: ${target}`);
        if (!info.isDirectory())
            throw new Error(`Starter skill target exists and is not a directory: ${target}`);
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT")
            return;
        throw error;
    }
}
async function copyBundledSkillDirectory(source, target) {
    const sourceInfo = await lstat(source);
    if (sourceInfo.isSymbolicLink())
        throw new Error(`Bundled starter skill source is a symlink: ${source}`);
    if (!sourceInfo.isDirectory())
        throw new Error(`Bundled starter skill source is not a directory: ${source}`);
    await ensurePrivateDir(target);
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries) {
        const sourcePath = join(source, entry.name);
        const targetPath = join(target, entry.name);
        const info = await lstat(sourcePath);
        if (info.isSymbolicLink())
            throw new Error(`Bundled starter skill source contains a symlink: ${sourcePath}`);
        if (info.isDirectory()) {
            await assertNoSymlinkTree(targetPath, "Starter skill target");
            await copyBundledSkillDirectory(sourcePath, targetPath);
            continue;
        }
        if (!info.isFile())
            throw new Error(`Bundled starter skill source is not a regular file: ${sourcePath}`);
        await writePrivateFile(targetPath, await readRegularFileNoFollow(sourcePath, "Bundled starter skill"));
    }
}
async function assertNoSymlinkTree(path, label) {
    try {
        const info = await lstat(path);
        if (info.isSymbolicLink())
            throw new Error(`${label} contains a symlink: ${path}`);
        if (!info.isDirectory())
            return;
        const entries = await readdir(path, { withFileTypes: true });
        for (const entry of entries)
            await assertNoSymlinkTree(resolve(path, entry.name), label);
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT")
            return;
        throw error;
    }
}
function isNodeError(error) {
    return typeof error === "object" && error !== null && "code" in error;
}
