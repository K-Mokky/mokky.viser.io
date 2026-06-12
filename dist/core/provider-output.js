// ================================================================
// Provider output classification
// ================================================================
// AssistantRuntime returns a plain-text failure report when every local CLI
// provider candidate fails. Durable automation surfaces must treat that text as
// a failed provider attempt rather than successful assistant content.
export const PROVIDER_FAILURE_PREFIX = "All provider attempts failed.";
export function isProviderFailureOutput(output) {
    return output.trimStart().startsWith(PROVIDER_FAILURE_PREFIX);
}
