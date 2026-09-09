import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  formatDashboardListenerNotice,
  formatRemoteOperatorGuidance,
  inspectRemoteSession,
  loopbackOpenUrl,
  portFromLoopbackTarget,
  remoteAlwaysOnServiceLines,
  remoteLoopbackAccessLines,
  remoteProviderLoginLines,
  sshLocalForwardCommand
} from "../src/utils/remote-access.ts";
import { onboardReport } from "../src/cli/onboard.ts";
import { providerGuideReport } from "../src/providers/guide.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { ViserConfig } from "../src/core/types.ts";

const sshEnv: NodeJS.Dict<string> = {
  SSH_CONNECTION: "203.0.113.10 51234 198.51.100.20 22",
  USER: "ubuntu",
  VISER_SSH_DESTINATION: "ubuntu@cli.example"
};

test("inspectRemoteSession detects SSH_CONNECTION and builds a destination", () => {
  const session = inspectRemoteSession(sshEnv);
  assert.equal(session.viaSsh, true);
  assert.equal(session.destination, "ubuntu@cli.example");
  assert.equal(session.clientAddress, "203.0.113.10");
  assert.equal(session.serverAddress, "198.51.100.20");
});

test("inspectRemoteSession ignores a local-only environment", () => {
  const session = inspectRemoteSession({ USER: "me", HOME: "/home/me" });
  assert.equal(session.viaSsh, false);
});

test("sshLocalForwardCommand prints a laptop-side loopback tunnel", () => {
  assert.equal(
    sshLocalForwardCommand(8787, "ubuntu@cli.example"),
    "ssh -N -L 8787:127.0.0.1:8787 -- ubuntu@cli.example"
  );
  assert.equal(loopbackOpenUrl(8787, "/chat.html"), "http://127.0.0.1:8787/chat.html");
  assert.equal(portFromLoopbackTarget("http://127.0.0.1:8790/"), 8790);
});

test("remoteLoopbackAccessLines stay silent without SSH unless always is set", () => {
  assert.deepEqual(remoteLoopbackAccessLines({ env: { USER: "me" } }), []);
  const always = remoteLoopbackAccessLines({ env: { USER: "me", VISER_SSH_DESTINATION: "me@box" }, always: true, port: 8787 });
  assert.match(always.join("\n"), /ssh -N -L 8787:127\.0\.0\.1:8787 -- me@box/);
  assert.match(always.join("\n"), /http:\/\/127\.0\.0\.1:8787\//);
  assert.match(always.join("\n"), /Do not bind the dashboard to 0\.0\.0\.0/);
});

test("SSH session guidance tells the laptop to tunnel instead of opening the server URL", () => {
  const lines = remoteLoopbackAccessLines({ env: sshEnv, port: 8787 });
  const text = lines.join("\n");
  assert.match(text, /SSH session detected/);
  assert.match(text, /not reachable from your laptop browser/);
  assert.match(text, /ssh -N -L 8787:127\.0\.0\.1:8787 -- ubuntu@cli\.example/);
  assert.match(text, /http:\/\/127\.0\.0\.1:8787\/chat\.html/);
  assert.match(text, /Do not bind the dashboard to 0\.0\.0\.0/);
});

test("provider login guidance forwards the printed localhost port", () => {
  const text = remoteProviderLoginLines(sshEnv).join("\n");
  assert.match(text, /provider CLI login pages/);
  assert.match(text, /ssh -N -L <port>:127\.0\.0\.1:<port> -- ubuntu@cli\.example/);
});

test("always-on Linux guidance includes linger and a laptop tunnel", () => {
  const text = remoteAlwaysOnServiceLines({ env: sshEnv, platform: "linux", port: 8787 }).join("\n");
  assert.match(text, /viser service install/);
  assert.match(text, /loginctl enable-linger/);
  assert.match(text, /ssh -N -L 8787:127\.0\.0\.1:8787 -- ubuntu@cli\.example/);
});

test("dashboard listener notice always includes the SSH tunnel recipe", () => {
  const text = formatDashboardListenerNotice("http://127.0.0.1:8787/", 8787, { USER: "me", VISER_SSH_DESTINATION: "me@box" });
  assert.match(text, /Viser web dashboard is running\. url=http:\/\/127\.0\.0\.1:8787\//);
  assert.match(text, /ssh -N -L 8787:127\.0\.0\.1:8787 -- me@box/);
});

test("onboard always prints SSH login and 24h service guidance", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-onboard-ssh-"));
  try {
    const report = await onboardReport(onboardConfig(dir), { apply: false });
    assert.match(report, /ssh -N -L/);
    assert.match(report, /viser service install/);
    assert.match(report, /loginctl enable-linger/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("provider login guide always prints SSH localhost-forward help and 24h service path", async () => {
  const report = await providerGuideReport(onboardConfig("/tmp/viser-login-ssh"));
  assert.match(report, /Viser provider login guide/);
  assert.match(report, /ssh -N -L <port>:127\.0\.0\.1:<port> -- /);
  assert.match(report, /viser service install/);
  assert.match(report, /loginctl enable-linger/);
});

test("formatRemoteOperatorGuidance covers tunnel plus always-on install", () => {
  const text = formatRemoteOperatorGuidance({ always: true, env: sshEnv, platform: "linux", port: 8787 });
  assert.match(text, /ssh -N -L 8787:127\.0\.0\.1:8787 -- ubuntu@cli\.example/);
  assert.match(text, /viser service install/);
  assert.match(text, /loginctl enable-linger/);
});

test("unsafe SSH destination strings are not interpolated into the printed command", () => {
  assert.equal(
    sshLocalForwardCommand(8787, "ubuntu@cli.example; rm -rf /"),
    "ssh -N -L 8787:127.0.0.1:8787 -- USER@HOST"
  );
  assert.equal(
    sshLocalForwardCommand(8787, "-Levil@host"),
    "ssh -N -L 8787:127.0.0.1:8787 -- USER@HOST"
  );
  const poisoned = inspectRemoteSession({
    SSH_CONNECTION: "203.0.113.10 1 198.51.100.20 22",
    USER: "-evil",
    VISER_SSH_DESTINATION: "ubuntu@cli.example; echo pwned"
  });
  assert.equal(poisoned.user, "USER");
  assert.equal(poisoned.destination, "USER@198.51.100.20");
  assert.doesNotMatch(sshLocalForwardCommand(8787, poisoned.destination), /pwned|;| -Levil/);
});

function onboardConfig(dir: string): ViserConfig {
  return {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, workdir: dir },
    storage: { dir: join(dir, ".viser") },
    webDashboard: { ...DEFAULT_CONFIG.webDashboard, port: 8787 }
  };
}
