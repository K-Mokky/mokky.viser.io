// ================================================================
// Inbound messenger progress
// ================================================================
// Push-capable bridges ACK immediately after pairing/allowlist/rate/input
// checks, then send the final answer or error. Request/response surfaces
// (KakaoTalk Skill, generic inbound webhooks) cannot push a separate ACK.
// ACK is best-effort so a failed progress ping cannot drop the real reply.

export const INBOUND_WORK_ACK = "Viser received your request and is working on it now.";

export async function runInboundAssistantTurn(
  send: (text: string) => Promise<void>,
  work: () => Promise<string>,
  ack: (text: string) => Promise<void> = send
): Promise<void> {
  try {
    await ack(INBOUND_WORK_ACK);
  } catch {
    // Keep processing even if the progress ping cannot be delivered.
  }
  try {
    await send(await work());
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await send(`Viser error:\n${detail}`);
  }
}
