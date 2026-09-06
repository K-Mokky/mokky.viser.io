// ================================================================
// Config check report
// ================================================================
// Static shape validation for editable JSON config. Runtime commands call
// `loadConfig`, so malformed config already fails early; this report is the
// user-facing checklist for valid-but-risky config shapes.
import { configValidationItems } from "../config-validation.js";
export async function configCheckReport(config) {
    const items = configValidationItems(config);
    const failCount = items.filter((item) => item.severity === "fail").length;
    const warnCount = items.filter((item) => item.severity === "warn").length;
    const passCount = items.length - failCount - warnCount;
    const verdict = failCount > 0 ? "INVALID" : warnCount > 0 ? "VALID WITH WARNINGS" : "VALID";
    return [
        `Viser config: ${verdict}`,
        `summary: ${passCount} pass, ${warnCount} warn, ${failCount} fail`,
        "",
        ...items.map((item) => {
            const prefix = item.severity === "pass" ? "✅" : item.severity === "warn" ? "⚠️" : "❌";
            const next = item.next && item.severity !== "pass" ? `\n   next: ${item.next}` : "";
            return `${prefix} [${item.path}] ${item.message}${next}`;
        })
    ].join("\n");
}
