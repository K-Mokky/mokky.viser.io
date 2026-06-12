// ================================================================
// Bounded fetch helper
// ================================================================
// Node fetch has no default timeout. Connector token checks and messenger REST
// calls must fail fast enough that launch gates and gateway loops do not hang
// forever on a stalled network path.

export type FetchLike = typeof fetch;

export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

export async function fetchWithTimeout(
  fetchImpl: FetchLike,
  input: Parameters<FetchLike>[0],
  init: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, timeoutMs));
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new Error(`fetch timed out after ${Math.max(1, timeoutMs)}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
