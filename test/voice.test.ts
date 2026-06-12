import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runVoiceTranscriptLoop } from "../src/cli/voice.ts";
import { AssistantRuntime } from "../src/core/assistant.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { ModelProvider, ProviderRequest, ProviderResponse, ViserConfig } from "../src/core/types.ts";

class EchoProvider implements ModelProvider {
  id = "echo";
  label = "Echo";
  calls = 0;

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    this.calls += 1;
    return { text: `VOICE_OK ${request.prompt}`, providerId: request.providerId, elapsedMs: 1 };
  }
}

test("voice transcript loop processes continuous transcript input and stages TTS through approval", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-voice-loop-"));

  try {
    const provider = new EchoProvider();
    const config = testConfig(dir);
    const assistant = new AssistantRuntime(config, { echo: provider });
    const result = await runVoiceTranscriptLoop(config, {
      assistant,
      sessionId: "test:voice-loop",
      transcripts: ["hello voice", "next voice turn", "stop voice"],
      proposeSpeech: true
    });

    assert.equal(result.ok, true);
    assert.equal(result.turns.length, 2);
    assert.equal(result.stopped, true);
    assert.equal(provider.calls, 2);
    assert.match(result.turns[0].response, /VOICE_OK/);
    assert.match(result.turns[0].speechProposal ?? "", /Proposed action/);
    assert.match(result.report, /approval-gated local TTS proposal/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("voice transcript loop rejects unsafe transcript control characters before provider handoff", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-voice-loop-block-"));

  try {
    const provider = new EchoProvider();
    const config = testConfig(dir);
    const assistant = new AssistantRuntime(config, { echo: provider });

    await assert.rejects(
      runVoiceTranscriptLoop(config, {
        assistant,
        sessionId: "test:voice-loop-block",
        transcripts: ["bad\u0001voice"]
      }),
      /control characters/
    );
    assert.equal(provider.calls, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function testConfig(dir: string): ViserConfig {
  return {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, defaultProvider: "echo", fallbackProviders: [], workdir: dir },
    storage: { dir: join(dir, "storage") },
    memory: { ...DEFAULT_CONFIG.memory, dir: join(dir, "memory") },
    personalization: { ...DEFAULT_CONFIG.personalization, dir: join(dir, "personalization") },
    skills: { ...DEFAULT_CONFIG.skills, dirs: [join(dir, "skills")], promptLimit: 8 },
    plugins: { ...DEFAULT_CONFIG.plugins, dirs: [join(dir, "plugins")], promptLimit: 8 },
    tools: { ...DEFAULT_CONFIG.tools, allowedReadRoots: [dir] },
    scheduler: { ...DEFAULT_CONFIG.scheduler, dir: join(dir, "scheduler") },
    jobs: { ...DEFAULT_CONFIG.jobs, dir: join(dir, "jobs") },
    access: { ...DEFAULT_CONFIG.access, dir: join(dir, "access") },
    actions: { ...DEFAULT_CONFIG.actions, dir: join(dir, "actions"), allowedWriteRoots: [dir] },
    providers: {
      echo: {
        id: "echo",
        label: "Echo",
        command: "echo",
        args: ["{prompt}"],
        promptMode: "template",
        timeoutMs: 1000
      }
    }
  };
}
