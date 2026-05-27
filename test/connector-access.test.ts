import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createConnectorMessageSender } from "../src/connectors/notifier.ts";
import { pairingRequiredMessage, pairedMessage } from "../src/connectors/telegram.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { ViserConfig } from "../src/core/types.ts";

test("pairing messages explain how to authorize a chat", () => {
  assert.match(pairingRequiredMessage("telegram"), /pair-code telegram/);
  assert.match(pairingRequiredMessage("discord"), /\/pair CODE/);
  assert.match(pairedMessage("telegram"), /Paired/);
});

test("connector message sender refuses unpaired outbound targets before token use", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-connector-message-deny-"));
  try {
    const config = testConfig(dir);
    const send = createConnectorMessageSender(config);

    await assert.rejects(
      () => send({ connector: "telegram", targetId: "123456", text: "hello" }),
      /not allowed/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("connector message sender reaches token check only for configured targets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-connector-message-allow-"));
  try {
    const config = testConfig(dir);
    config.connectors.discord.allowedChannelIds = ["1234567890"];
    const send = createConnectorMessageSender(config);

    await assert.rejects(
      () => send({ connector: "discord", targetId: "1234567890", text: "hello" }),
      /Discord token is missing/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function testConfig(dir: string): ViserConfig {
  const config = structuredClone(DEFAULT_CONFIG) as ViserConfig;
  config.access.dir = join(dir, "access");
  config.access.enabled = true;
  config.access.defaultPolicy = "pairing";
  config.connectors.telegram = { ...config.connectors.telegram, botToken: undefined, allowedChatIds: [], defaultChatIds: [] };
  config.connectors.discord = { ...config.connectors.discord, botToken: undefined, allowedChannelIds: [], defaultChannelIds: [] };
  return config;
}
