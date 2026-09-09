// ================================================================
// Beginner-friendly onboarding
// ================================================================
// `setup` is the operator-oriented first-run helper with a long verification
// checklist. `onboard` is the plain-language path for someone using a terminal
// for the first time: it prepares the same first-run files, reports the current
// state in simple terms, and leaves exactly three things to do.
import { writeEnvTemplate } from "./env-check.js";
import { writeExampleConfig } from "./init.js";
import { ensureLocalNpmrc, installBundledSkills } from "./setup.js";
import { commandExists } from "../utils/exec.js";
import { isNodeVersionSupported, nodeVersionLabel } from "../utils/node-version.js";
import { CORE_LOCAL_CLI_ROUTES } from "../core/local-cli-policy.js";
import { formatRemoteOperatorGuidance } from "../utils/remote-access.js";
export async function onboardReport(config, options = {}) {
    const apply = options.apply ?? true;
    const lines = [];
    lines.push("Viser 시작하기 — 컴퓨터가 처음이어도 그대로 따라 하면 돼요");
    lines.push("");
    if (apply) {
        const prepared = [
            await writeExampleConfig(false),
            await ensureLocalNpmrc(),
            await installBundledSkills(false),
            await writeEnvTemplate(config)
        ];
        lines.push("1단계 — 기본 파일 준비 (이미 있으면 그대로 둬요)");
        for (const item of prepared)
            lines.push(`  · ${item}`);
        lines.push("");
    }
    const nodeOk = isNodeVersionSupported(process.versions.node);
    const choices = providerChoices();
    const installed = choices.filter((choice) => choice.installed);
    lines.push("지금 상태");
    lines.push(`  · Node.js: ${nodeOk ? `OK (v${process.versions.node})` : `버전이 낮아요 — ${nodeVersionLabel()}`}`);
    lines.push(installed.length > 0
        ? `  · 로그인할 수 있는 AI: ${installed.map((choice) => choice.command).join(", ")} 가 설치되어 보여요`
        : "  · AI CLI가 아직 안 보여요 (codex / gemini / claude / grok / cursor-agent 중 하나만 있으면 충분해요)");
    lines.push("");
    const recommended = installed[0] ?? choices[0];
    lines.push("이제 딱 3가지만 하면 끝나요");
    lines.push("");
    lines.push("  1) AI 하나에 로그인하세요 (전부 필요 없어요, 아무거나 하나면 충분해요)");
    for (const choice of choices) {
        const mark = choice.installed ? "설치됨" : "미설치";
        lines.push(`       - ${choice.login}    (${choice.label}, ${mark})`);
    }
    lines.push(`     추천: \`${recommended.login}\` 부터 해 보세요.`);
    lines.push("");
    lines.push("  2) 준비됐는지 확인:  node src/index.ts verify");
    lines.push("");
    lines.push("  3) 바로 대화 시작:   node src/index.ts chat");
    lines.push("");
    lines.push("막히거나 더 하고 싶으면");
    lines.push("  · 무엇이 문제인지 진단:        node src/index.ts doctor");
    lines.push("  · 다음에 뭘 할지 안내:         node src/index.ts next-steps");
    lines.push("  · 텔레그램/디스코드로 쓰기:    node src/index.ts env-init 로 토큰을 넣어요.");
    lines.push("    (남에게 중계하면 구독 약관·계정 벤 위험이 있어요. SECURITY.md를 먼저 읽어요.)");
    lines.push("  · SSH 서버에서 24시간 쓰기:   viser service install");
    lines.push("    (Linux면 `loginctl enable-linger \"$USER\"` 후, 본체 브라우저에서는 SSH 터널로 127.0.0.1을 여세요.)");
    for (const line of formatRemoteOperatorGuidance({ always: true, port: config.webDashboard.port }).split("\n")) {
        lines.push(`    ${line}`);
    }
    return lines.join("\n");
}
function providerChoices() {
    const labels = {
        codex: { login: "codex login", label: "OpenAI Codex" },
        gemini: { login: "gemini", label: "Google Gemini" },
        claude: { login: "claude", label: "Anthropic Claude" },
        grok: { login: "grok", label: "xAI Grok" },
        "cursor-agent": { login: "cursor-agent", label: "Cursor Agent" }
    };
    return CORE_LOCAL_CLI_ROUTES.map((route) => route.expectedCommand)
        .filter((command, index, all) => all.indexOf(command) === index)
        .map((command) => ({
        command,
        login: labels[command]?.login ?? command,
        label: labels[command]?.label ?? command,
        installed: commandExists(command)
    }));
}
