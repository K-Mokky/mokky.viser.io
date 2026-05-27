import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SkillRegistry } from "../src/core/skills.ts";

test("SkillRegistry loads SKILL.md folders", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-skills-"));
  try {
    await mkdir(join(dir, "brief"));
    await writeFile(join(dir, "brief", "SKILL.md"), "# Brief\nDescription: Make a concise brief.\n\nSteps", "utf8");
    const registry = new SkillRegistry([dir]);
    const skills = await registry.list();
    assert.equal(skills.length, 1);
    assert.equal(skills[0].id, "brief");
    assert.match(await registry.formatCatalog(5), /Make a concise brief/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SkillRegistry skips symlinked skill directories and SKILL.md files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-skills-symlink-"));
  try {
    const outsideSkillDir = join(dir, "outside-skill");
    const outsideSecret = join(dir, "outside-secret.md");
    await mkdir(join(dir, "skills"));
    await mkdir(outsideSkillDir);
    await mkdir(join(dir, "skills", "linked-file"));
    await writeFile(join(outsideSkillDir, "SKILL.md"), "# Leaked\nDescription: outside secret skill\n", "utf8");
    await writeFile(outsideSecret, "# Secret\nDescription: outside secret body\n", "utf8");
    await symlink(outsideSkillDir, join(dir, "skills", "linked-dir"));
    await symlink(outsideSecret, join(dir, "skills", "linked-file", "SKILL.md"));

    const registry = new SkillRegistry([join(dir, "skills")]);
    const skills = await registry.list();

    assert.deepEqual(skills, []);
    assert.doesNotMatch(await registry.formatCatalog(5), /outside secret/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
