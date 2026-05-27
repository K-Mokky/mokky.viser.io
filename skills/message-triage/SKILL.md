# Message Triage
Description: Classify incoming Discord/Telegram messages and decide whether to answer, remember, or create follow-up work.

## When to use
Use this for chat-driven assistant workflows and inbox-like message streams.

## Procedure
1. Determine intent: question, command, reminder, preference, or noise.
2. If it is a stable preference or fact, suggest `/remember`.
3. If it requires action, state the next safe action and any required permission.
4. Keep replies short unless the user asks for detail.
