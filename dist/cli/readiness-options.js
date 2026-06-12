// ================================================================
// Readiness option helpers
// ================================================================
// CLI commands intentionally share the same flag parsing rules so safe launch
// paths cannot drift: foreground launches always validate configured
// live connector tokens and prove provider runtime unless explicitly using a
// raw escape hatch.
import { flagBool } from "./args.js";
export function readinessOptionsFromFlags(flags, defaults = {}) {
    return {
        live: Boolean(defaults.live) || flagBool(flags, "live"),
        probeProviders: Boolean(defaults.probeProviders) || flagBool(flags, "probeProviders") || flagBool(flags, "probe"),
        probeAllProviders: Boolean(defaults.probeAllProviders) || flagBool(flags, "probeAllProviders") || flagBool(flags, "probeAll")
    };
}
export function liveLaunchReadinessOptions(flags) {
    return readinessOptionsFromFlags(flags, { live: true });
}
export function providerProofLaunchReadinessOptions(flags) {
    return readinessOptionsFromFlags(flags, { live: true, probeAllProviders: true });
}
