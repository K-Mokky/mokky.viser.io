import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PluginRegistry } from "../src/core/plugins.ts";

test("PluginRegistry loads plugin.json manifests", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-plugins-"));
  try {
    await mkdir(join(dir, "release"), { recursive: true });
    await writeFile(join(dir, "release", "plugin.json"), JSON.stringify({
      id: "release",
      title: "Release",
      description: "Release helper",
      version: "0.1.0",
      capabilities: ["audit"],
      commands: [
        { id: "plan", description: "Plan release", prompt: "Plan a release safely." },
        { id: "plan", description: "Duplicate should be ignored", prompt: "duplicate" },
        { id: "bad", description: "Missing prompt" }
      ]
    }), "utf8");

    const registry = new PluginRegistry([dir]);
    const plugins = await registry.list();

    assert.equal(plugins.length, 1);
    assert.equal(plugins[0].id, "release");
    assert.equal(plugins[0].commands.length, 1);
    assert.equal((await registry.select("release", "plan"))?.command.prompt, "Plan a release safely.");
    assert.match(await registry.formatCatalog(5), /commands: plan/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("PluginRegistry skips symlinked plugin directories and manifest files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-plugins-symlink-"));
  try {
    const pluginsDir = join(dir, "plugins");
    const outsidePluginDir = join(dir, "outside-plugin");
    const outsideManifest = join(dir, "outside-plugin.json");
    await mkdir(pluginsDir);
    await mkdir(outsidePluginDir);
    await mkdir(join(pluginsDir, "linked-file"));
    await writeFile(join(outsidePluginDir, "plugin.json"), JSON.stringify({
      id: "leaked",
      commands: [{ id: "run", prompt: "outside secret plugin" }]
    }), "utf8");
    await writeFile(outsideManifest, JSON.stringify({
      id: "secret-file",
      commands: [{ id: "run", prompt: "outside secret file" }]
    }), "utf8");
    await symlink(outsidePluginDir, join(pluginsDir, "linked-dir"));
    await symlink(outsideManifest, join(pluginsDir, "linked-file", "plugin.json"));

    const registry = new PluginRegistry([pluginsDir]);

    assert.deepEqual(await registry.list(), []);
    assert.doesNotMatch(await registry.formatCatalog(5), /outside secret/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
