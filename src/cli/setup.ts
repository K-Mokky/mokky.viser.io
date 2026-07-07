// ================================================================
// First-run setup helper
// ================================================================
// This is non-interactive on purpose: it creates an editable config if missing,
// installs bundled starter skills into the user's workspace, then prints the
// exact login/token steps still needed.

import { lstat, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.ts";
import { doctorReport } from "./doctor.ts";
import { writeEnvTemplate } from "./env-check.ts";
import { writeExampleConfig } from "./init.ts";
import { ensurePrivateDir, fileExists, readRegularFileNoFollow, writePrivateFile } from "../utils/files.ts";

export async function setupReport(force = false): Promise<string> {
  const initResult = await writeExampleConfig(force);
  const skillsResult = await installBundledSkills(force);
  const config = await loadConfig();
  const envResult = await writeEnvTemplate(config);
  const npmrcResult = await ensureLocalNpmrc();
  return [
    "Viser setup",
    initResult,
    envResult,
    npmrcResult,
    skillsResult,
    "",
    doctorReport(config),
    "",
    "Next steps:",
    "1. Run `codex login`, `gemini`, and/or `claude` in a normal terminal to complete local CLI account login.",
    "2. Put TELEGRAM_BOT_TOKEN and DISCORD_BOT_TOKEN in `.env`, your shell, or a `VISER_ENV` file if you want messaging.",
    "3. Confirm env/token loading without leaking secrets: `node src/index.ts env-check`.",
    "4. Verify provider runtime and live connector tokens with `node src/index.ts provider-guide --probe` or `node src/index.ts verify --live --probe-all-providers`.",
    "5. Prove local non-provider features with `node src/index.ts smoke`.",
    "6. Run `node src/index.ts config-check`, `node src/index.ts state-check`, and `node src/index.ts audit` before leaving gateway/service running.",
    "7. Run `node src/index.ts gateway --dry-run --strict --live --probe-all-providers` for a no-start live provider-proof launch rehearsal.",
    "8. Run `node src/index.ts launch-status` anytime for one single live launch verdict.",
    "9. Start safe foreground gateway with `node src/index.ts gateway` only after the rehearsal passes; direct gateway now validates live connector tokens and runs the live provider-proof gate by default.",
    "10. For launchd, use `node src/index.ts service plist` / `service install`; the generated service runs `service-run --live --probe-all-providers` and avoids restart loops when preflight is blocked.",
    "11. For CLI-only use now, run `node src/index.ts chat` or `node src/index.ts ask \"질문\"`.",
    "12. Store durable preferences with `/remember ... #tag` before expecting long-term personalization.",
    "13. Run `node src/index.ts next-steps --live --probe-all-providers` anytime for an actionable recovery/launch checklist."
  ].join("\n");
}

export async function ensureLocalNpmrc(): Promise<string> {
  const target = resolve(process.cwd(), ".npmrc");
  if (fileExists(target)) return "Local .npmrc already present; left unchanged.";
  await writePrivateFile(target, "cache=.viser/npm-cache\n");
  return "Local .npmrc created (npm cache pinned to .viser/npm-cache).";
}

export async function installBundledSkills(force: boolean): Promise<string> {
  const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills");
  const targetRoot = resolve(process.cwd(), ".viser", "skills");
  if (!fileExists(sourceRoot)) return "Bundled skills were not found; skipping starter skill install.";

  await ensurePrivateDir(targetRoot);
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  const installed: string[] = [];
  const skipped: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
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

async function assertSafeSkillInstallTarget(target: string): Promise<void> {
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw new Error(`Starter skill target is a symlink: ${target}`);
    if (!info.isDirectory()) throw new Error(`Starter skill target exists and is not a directory: ${target}`);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
}

async function copyBundledSkillDirectory(source: string, target: string): Promise<void> {
  const sourceInfo = await lstat(source);
  if (sourceInfo.isSymbolicLink()) throw new Error(`Bundled starter skill source is a symlink: ${source}`);
  if (!sourceInfo.isDirectory()) throw new Error(`Bundled starter skill source is not a directory: ${source}`);

  await ensurePrivateDir(target);
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    const info = await lstat(sourcePath);
    if (info.isSymbolicLink()) throw new Error(`Bundled starter skill source contains a symlink: ${sourcePath}`);
    if (info.isDirectory()) {
      await assertNoSymlinkTree(targetPath, "Starter skill target");
      await copyBundledSkillDirectory(sourcePath, targetPath);
      continue;
    }
    if (!info.isFile()) throw new Error(`Bundled starter skill source is not a regular file: ${sourcePath}`);
    await writePrivateFile(targetPath, await readRegularFileNoFollow(sourcePath, "Bundled starter skill"));
  }
}

async function assertNoSymlinkTree(path: string, label: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`${label} contains a symlink: ${path}`);
    if (!info.isDirectory()) return;
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) await assertNoSymlinkTree(resolve(path, entry.name), label);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
