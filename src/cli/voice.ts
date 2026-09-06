// ================================================================
// Continuous voice transcript loop
// ================================================================
// Voice input is intentionally modeled as a transcript stream. This keeps the
// core loop dependency-free and lets operators connect local STT tools
// (Whisper, OS dictation wrappers, browser speech APIs, etc.) without giving
// Viser microphone or shell privileges. Speech output remains approval-gated by
// staging ordinary `/propose speak` actions.

import { createInterface } from "node:readline";
import { stdin as processStdin } from "node:process";
import { AssistantRuntime } from "../core/assistant.ts";
import { normalizeSpeechText } from "../core/actions.ts";
import type { ViserConfig } from "../core/types.ts";

export interface VoiceLoopOptions {
  assistant?: AssistantRuntime;
  transcripts?: AsyncIterable<string> | Iterable<string>;
  sessionId: string;
  providerId?: string;
  proposeSpeech?: boolean;
  json?: boolean;
  maxTurns?: number;
}

export interface VoiceTurn {
  index: number;
  transcript: string;
  response: string;
  speechProposal?: string;
}

export interface VoiceLoopResult {
  ok: boolean;
  turns: VoiceTurn[];
  skipped: number;
  stopped: boolean;
  report: string;
}

const DEFAULT_MAX_VOICE_TURNS = 50;
const MAX_TRANSCRIPT_CHARS = 4_000;
const STOP_PHRASES = new Set(["/exit", "/quit", "exit", "quit", "stop voice", "stop listening"]);

export async function voiceLoopReport(config: ViserConfig, options: VoiceLoopOptions): Promise<string> {
  return (await runVoiceTranscriptLoop(config, options)).report;
}

export async function runVoiceTranscriptLoop(config: ViserConfig, options: VoiceLoopOptions): Promise<VoiceLoopResult> {
  const assistant = options.assistant ?? new AssistantRuntime(config);
  const transcripts = options.transcripts ?? stdinLines();
  const maxTurns = Math.max(1, Math.min(500, options.maxTurns ?? DEFAULT_MAX_VOICE_TURNS));
  const turns: VoiceTurn[] = [];
  let skipped = 0;
  let stopped = false;

  for await (const raw of transcripts) {
    const transcript = normalizeTranscript(raw);
    if (!transcript) {
      skipped += 1;
      continue;
    }
    if (STOP_PHRASES.has(transcript.toLowerCase())) {
      stopped = true;
      break;
    }
    if (turns.length >= maxTurns) {
      stopped = true;
      break;
    }

    const response = await assistant.handle(transcript, options.sessionId, {
      source: "voice",
      providerId: options.providerId
    });
    const turn: VoiceTurn = {
      index: turns.length + 1,
      transcript,
      response
    };

    if (options.proposeSpeech) {
      const speechText = voiceSpeechText(response);
      turn.speechProposal = await assistant.handle(`/propose speak ${speechText}`, options.sessionId, {
        source: "voice"
      });
    }

    turns.push(turn);
  }

  const result: VoiceLoopResult = {
    ok: turns.length > 0,
    turns,
    skipped,
    stopped,
    report: ""
  };
  result.report = options.json ? JSON.stringify(result, null, 2) : formatVoiceLoopReport(result, options);
  return result;
}

function normalizeTranscript(raw: string): string {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(raw)) {
    throw new Error("Voice transcript contains control characters.");
  }
  const transcript = raw.trim().replace(/\s+/gu, " ");
  if (transcript.length > MAX_TRANSCRIPT_CHARS) throw new Error("Voice transcript is too long.");
  return transcript;
}

function voiceSpeechText(response: string): string {
  const compact = response
    .replace(/```[\s\S]*?```/gu, "code block omitted.")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 500);
  return normalizeSpeechText(compact || "Viser response is empty.");
}

function formatVoiceLoopReport(result: VoiceLoopResult, options: VoiceLoopOptions): string {
  return [
    `Viser voice transcript loop: ${result.ok ? "PASS" : "NO INPUT"}`,
    "mode: continuous transcript input -> AssistantRuntime -> optional approval-gated local TTS proposal",
    `summary: ${result.turns.length} turn(s), ${result.skipped} skipped, stopped=${result.stopped ? "yes" : "no"}, speech=${options.proposeSpeech ? "approval-gated proposals" : "off"}`,
    "",
    ...result.turns.flatMap((turn) => [
      `🎙️ [${turn.index}] ${turn.transcript}`,
      `🤖 ${turn.response}`,
      ...(turn.speechProposal ? [`🔊 ${turn.speechProposal}`] : [])
    ])
  ].join("\n");
}

async function* stdinLines(): AsyncIterable<string> {
  const rl = createInterface({ input: processStdin, crlfDelay: Infinity });
  try {
    for await (const line of rl) yield line;
  } finally {
    rl.close();
  }
}
