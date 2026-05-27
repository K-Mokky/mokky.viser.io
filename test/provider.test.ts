import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CliModelProvider, preparePrompt } from "../src/providers/cli-provider.ts";
import type { CliProviderConfig } from "../src/core/types.ts";

const baseConfig: CliProviderConfig = {
  id: "test",
  command: "echo",
  args: [],
  promptMode: "argument",
  timeoutMs: 1000
};

test("preparePrompt sends stdin for stdin providers", () => {
  const prepared = preparePrompt({ ...baseConfig, promptMode: "stdin", args: ["-"] }, "hello");
  assert.deepEqual(prepared.args, ["-"]);
  assert.equal(prepared.stdin, "hello");
});

test("preparePrompt replaces template placeholders", () => {
  const prepared = preparePrompt({ ...baseConfig, promptMode: "template", args: ["-p", "{prompt}"] }, "hello");
  assert.deepEqual(prepared.args, ["-p", "hello"]);
  assert.equal(prepared.stdin, undefined);
});

test("CliModelProvider redacts configured provider env secrets from failures", async () => {
  const provider = new CliModelProvider({
    id: "secret",
    command: "node",
    args: ["-e", "console.error(`provider failed with ${process.env.PROVIDER_SECRET}`); process.exit(1)"],
    promptMode: "argument",
    timeoutMs: 5000,
    env: {
      PROVIDER_SECRET: "provider-secret-value-1234567890"
    }
  });

  await assert.rejects(
    () => provider.generate({ providerId: "secret", sessionId: "test", prompt: "hello" }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[REDACTED]/);
      assert.doesNotMatch(error.message, /provider-secret-value/);
      return true;
    }
  );
});

test("CliModelProvider refuses explicit model API key env before spawning", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".viser-provider-api-key-env-"));
  try {
    const marker = join(dir, "spawned.txt");
    const provider = new CliModelProvider({
      id: "api-key-env",
      command: "node",
      args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'spawned')`],
      promptMode: "argument",
      timeoutMs: 5000,
      env: {
        OPENAI_API_KEY: "sk-test-secret-value-1234567890"
      }
    });

    await assert.rejects(
      () => provider.generate({ providerId: "api-key-env", sessionId: "test", prompt: "hello" }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /provider\.env contains model API key variables \(OPENAI_API_KEY\)/);
        assert.doesNotMatch(error.message, /sk-test-secret-value/);
        return true;
      }
    );
    await assert.rejects(() => readFile(marker, "utf8"), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CliModelProvider redacts shell-provided secret env values from failures", async () => {
  const oldValue = process.env.VISER_TEST_PROVIDER_API_KEY;
  process.env.VISER_TEST_PROVIDER_API_KEY = "shell-secret-value-1234567890";
  try {
    const provider = new CliModelProvider({
      id: "shell-secret",
      command: "node",
      args: ["-e", "console.error(`provider failed with ${process.env.VISER_TEST_PROVIDER_API_KEY}`); process.exit(1)"],
      promptMode: "argument",
      timeoutMs: 5000
    });

    await assert.rejects(
      () => provider.generate({ providerId: "shell-secret", sessionId: "test", prompt: "hello" }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /provider failed with undefined/);
        assert.doesNotMatch(error.message, /shell-secret-value/);
        return true;
      }
    );
  } finally {
    if (oldValue === undefined) delete process.env.VISER_TEST_PROVIDER_API_KEY;
    else process.env.VISER_TEST_PROVIDER_API_KEY = oldValue;
  }
});

test("CliModelProvider redacts shell-provided secret env values from successful output", async () => {
  const oldValue = process.env.VISER_TEST_PROVIDER_TOKEN;
  process.env.VISER_TEST_PROVIDER_TOKEN = "successful-secret-token-1234567890";
  try {
    const provider = new CliModelProvider({
      id: "shell-secret-success",
      command: "node",
      args: ["-e", "console.log(`answer ${process.env.VISER_TEST_PROVIDER_TOKEN}`)"],
      promptMode: "argument",
      timeoutMs: 5000
    });

    const response = await provider.generate({ providerId: "shell-secret-success", sessionId: "test", prompt: "hello" });

    assert.match(response.text, /answer undefined/);
    assert.doesNotMatch(response.text, /successful-secret-token/);
  } finally {
    if (oldValue === undefined) delete process.env.VISER_TEST_PROVIDER_TOKEN;
    else process.env.VISER_TEST_PROVIDER_TOKEN = oldValue;
  }
});

test("CliModelProvider does not inherit shell secret env values by default", async () => {
  const oldValue = process.env.VISER_TEST_PROVIDER_TOKEN;
  process.env.VISER_TEST_PROVIDER_TOKEN = "inherited-secret-token-1234567890";
  try {
    const provider = new CliModelProvider({
      id: "secret-env-strip",
      command: "node",
      args: ["-e", "console.log(process.env.VISER_TEST_PROVIDER_TOKEN || 'missing')"],
      promptMode: "argument",
      timeoutMs: 5000
    });

    const response = await provider.generate({ providerId: "secret-env-strip", sessionId: "test", prompt: "hello" });

    assert.equal(response.text, "missing");
  } finally {
    if (oldValue === undefined) delete process.env.VISER_TEST_PROVIDER_TOKEN;
    else process.env.VISER_TEST_PROVIDER_TOKEN = oldValue;
  }
});

test("CliModelProvider preserves explicit provider env values", async () => {
  const oldValue = process.env.VISER_TEST_PROVIDER_VISIBLE;
  process.env.VISER_TEST_PROVIDER_VISIBLE = "from-shell";
  try {
    const provider = new CliModelProvider({
      id: "explicit-env",
      command: "node",
      args: ["-e", "console.log(process.env.VISER_TEST_PROVIDER_VISIBLE || 'missing')"],
      promptMode: "argument",
      timeoutMs: 5000,
      env: {
        VISER_TEST_PROVIDER_VISIBLE: "from-provider"
      }
    });

    const response = await provider.generate({ providerId: "explicit-env", sessionId: "test", prompt: "hello" });

    assert.equal(response.text, "from-provider");
  } finally {
    if (oldValue === undefined) delete process.env.VISER_TEST_PROVIDER_VISIBLE;
    else process.env.VISER_TEST_PROVIDER_VISIBLE = oldValue;
  }
});

test("CliModelProvider resolves PATH commands from explicit provider env before spawn", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".viser-provider-path-command-"));
  try {
    const binDir = join(dir, "bin");
    const commandPath = join(binDir, "provider-ok");
    await mkdir(binDir, { recursive: true });
    await writeFile(commandPath, "#!/bin/sh\nprintf 'VISER_OK\\n'\n", "utf8");
    await chmod(commandPath, 0o700);

    const provider = new CliModelProvider({
      id: "path-command",
      command: "provider-ok",
      args: [],
      promptMode: "argument",
      timeoutMs: 5000,
      env: {
        PATH: binDir
      }
    });

    const response = await provider.generate({ providerId: "path-command", sessionId: "test", prompt: "hello" });

    assert.equal(response.text, "VISER_OK");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CliModelProvider refuses PATH commands reached through workspace symlink components", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".viser-provider-path-command-nofollow-"));
  try {
    const outsideRoot = join(dir, "outside-root");
    const outsideBin = join(outsideRoot, "bin");
    const outsideTouched = join(outsideRoot, "touched.txt");
    const commandPath = join(outsideBin, "provider-ok");
    const rootLink = join(dir, "root-link");
    await mkdir(outsideBin, { recursive: true });
    await writeFile(commandPath, `#!/bin/sh\nprintf ran > ${JSON.stringify(outsideTouched)}\nprintf 'VISER_OK\\n'\n`, "utf8");
    await chmod(commandPath, 0o700);
    await symlink(outsideRoot, rootLink);

    const provider = new CliModelProvider({
      id: "path-command-symlink",
      command: "provider-ok",
      args: [],
      promptMode: "argument",
      timeoutMs: 5000,
      env: {
        PATH: join(rootLink, "bin")
      }
    });

    await assert.rejects(
      () => provider.generate({ providerId: "path-command-symlink", sessionId: "test", prompt: "hello" }),
      /Provider 'path-command-symlink' failed:.*symlink/is
    );
    await assert.rejects(() => readFile(outsideTouched, "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CliModelProvider marks truncated successful provider output", async () => {
  const provider = new CliModelProvider({
    id: "truncated",
    command: "node",
    args: ["-e", "process.stdout.write('abcdefghijklmnop')"],
    promptMode: "argument",
    timeoutMs: 5000,
    maxOutputBytes: 5
  });

  const response = await provider.generate({ providerId: "truncated", sessionId: "test", prompt: "hello" });

  assert.match(response.text, /^abcde/);
  assert.match(response.text, /stdout truncated at 5 bytes/);
  assert.doesNotMatch(response.text, /fgh/);
});

test("CliModelProvider refuses cwd reached through workspace symlink components", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".viser-provider-cwd-nofollow-"));
  try {
    const outsideRoot = join(dir, "outside-root");
    const outsideCwd = join(outsideRoot, "provider-cwd");
    const rootLink = join(dir, "root-link");
    await mkdir(outsideCwd, { recursive: true });
    await symlink(outsideRoot, rootLink);

    const provider = new CliModelProvider({
      id: "cwd-symlink",
      command: "node",
      args: ["-e", "require('node:fs').writeFileSync('touched.txt', 'ran')"],
      promptMode: "argument",
      timeoutMs: 5000,
      cwd: join(rootLink, "provider-cwd")
    });

    await assert.rejects(
      () => provider.generate({ providerId: "cwd-symlink", sessionId: "test", prompt: "hello" }),
      /Provider 'cwd-symlink' failed:.*symlink/is
    );
    await assert.rejects(() => readFile(join(outsideCwd, "touched.txt"), "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CliModelProvider refuses command paths reached through workspace symlink components", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".viser-provider-command-nofollow-"));
  try {
    const outsideRoot = join(dir, "outside-root");
    const outsideBin = join(outsideRoot, "bin");
    const outsideTouched = join(outsideRoot, "touched.txt");
    const commandPath = join(outsideBin, "provider-ok");
    const rootLink = join(dir, "root-link");
    await mkdir(outsideBin, { recursive: true });
    await writeFile(commandPath, `#!/bin/sh\nprintf ran > ${JSON.stringify(outsideTouched)}\nprintf 'VISER_OK\\n'\n`, "utf8");
    await chmod(commandPath, 0o700);
    await symlink(outsideRoot, rootLink);

    const provider = new CliModelProvider({
      id: "command-symlink",
      command: join(rootLink, "bin", "provider-ok"),
      args: [],
      promptMode: "argument",
      timeoutMs: 5000
    });

    await assert.rejects(
      () => provider.generate({ providerId: "command-symlink", sessionId: "test", prompt: "hello" }),
      /Provider 'command-symlink' failed:.*symlink/is
    );
    await assert.rejects(() => readFile(outsideTouched, "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
