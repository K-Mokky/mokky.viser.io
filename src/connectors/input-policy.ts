// ================================================================
// Public connector input policy
// ================================================================
// Messenger transports are public-facing. Bound inbound text before it reaches
// prompt construction so one chat/channel cannot push oversized provider input.

export function connectorInputTooLong(input: string, maxInputChars: number): boolean {
  return countInputChars(input) > maxInputChars;
}

export function connectorInputLimitMessage(maxInputChars: number): string {
  return `Viser input limit: messages from this connector must be ${maxInputChars} characters or fewer. Please shorten the message and try again.`;
}

function countInputChars(input: string): number {
  return Array.from(input).length;
}
