// ================================================================
// Skill registry
// ================================================================
// Skills are plain folders containing SKILL.md. They are copied neither into
// prompts nor execution blindly: the user can list them and opt into one with
// `/skill <id> <task>`, or Viser can show their names as available procedures.
import { lstat } from "node:fs/promises";
import { basename, join } from "node:path";
import { listPrivateDirIfExists, readPrivateFileIfExists } from "../utils/files.js";
export class SkillRegistry {
    dirs;
    constructor(dirs) {
        this.dirs = dirs;
    }
    async list() {
        const skills = [];
        for (const dir of this.dirs) {
            const entries = await listPrivateDirIfExists(dir);
            if (!entries)
                continue;
            for (const entry of entries) {
                if (!entry.isDirectory())
                    continue;
                const skillDir = join(dir, entry.name);
                if (!await isRegularDirectory(skillDir))
                    continue;
                const skillPath = join(skillDir, "SKILL.md");
                const skill = await loadSkill(skillPath, entry.name, skillDir);
                if (skill)
                    skills.push(skill);
            }
        }
        return dedupeSkills(skills).sort((a, b) => a.id.localeCompare(b.id));
    }
    async get(id) {
        const normalized = normalizeSkillId(id);
        return (await this.list()).find((skill) => skill.id === normalized);
    }
    async formatCatalog(limit) {
        const skills = (await this.list()).slice(0, limit);
        if (skills.length === 0)
            return "(none)";
        return skills.map((skill) => `- ${skill.id}: ${skill.description || skill.title}`).join("\n");
    }
}
async function loadSkill(path, fallbackId, skillDir) {
    const body = await safeReadSkill(path, skillDir);
    if (body === undefined)
        return undefined;
    const lines = body.split("\n");
    const title = lines.find((line) => line.startsWith("# "))?.replace(/^#\s+/, "").trim() || fallbackId;
    const description = lines.find((line) => /^description:/i.test(line))?.replace(/^description:\s*/i, "").trim() ||
        lines.find((line) => line.trim() && !line.startsWith("#"))?.trim() ||
        title;
    return {
        id: normalizeSkillId(basename(path.replace(/\/SKILL\.md$/u, "")) || fallbackId),
        title,
        description,
        body,
        path
    };
}
async function safeReadSkill(path, skillDir) {
    try {
        return await readPrivateFileIfExists(path, { dirs: [skillDir] });
    }
    catch {
        return undefined;
    }
}
async function isRegularDirectory(path) {
    try {
        const info = await lstat(path);
        return info.isDirectory() && !info.isSymbolicLink();
    }
    catch {
        return false;
    }
}
function dedupeSkills(skills) {
    const seen = new Map();
    for (const skill of skills) {
        if (!seen.has(skill.id))
            seen.set(skill.id, skill);
    }
    return [...seen.values()];
}
function normalizeSkillId(value) {
    return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}
