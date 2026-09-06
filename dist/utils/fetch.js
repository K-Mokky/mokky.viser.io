// ================================================================
// Bounded fetch helper
// ================================================================
// Node fetch has no default timeout. Connector token checks and messenger REST
// calls must fail fast enough that launch gates and gateway loops do not hang
// forever on a stalled network path.
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
export async function fetchWithTimeout(fetchImpl, input, init = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
    const timeoutMsSafe = Math.max(1, timeoutMs);
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(new Error(`fetch timed out after ${timeoutMsSafe}ms`));
        }, timeoutMsSafe);
    });
    try {
        return await Promise.race([
            fetchImpl(input, { ...init, signal: controller.signal }),
            timeoutPromise
        ]);
    }
    catch (error) {
        if (timedOut)
            throw new Error(`fetch timed out after ${timeoutMsSafe}ms`);
        throw error;
    }
    finally {
        if (timeoutId)
            clearTimeout(timeoutId);
    }
}
