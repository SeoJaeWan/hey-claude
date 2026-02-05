/**
 * Claude CLI 호출 서비스
 */

import { spawn, ChildProcess, execSync } from "child_process";

interface ClaudeOptions {
    prompt: string;
    sessionId?: string;
    cwd?: string;
}

// Claude 실행 파일 경로 찾기 (Windows 환경 대응)
let claudePath: string | null = null;
try {
    claudePath = execSync("where claude", { encoding: "utf-8" }).trim().split("\n")[0];
    console.log("[CLAUDE SERVICE] Claude path found:", claudePath);
} catch (error) {
    console.log("[CLAUDE SERVICE] Could not find claude in PATH, using 'claude' directly");
    claudePath = "claude";
}

export const callClaude = (options: ClaudeOptions): ChildProcess => {
    const { prompt, sessionId, cwd } = options;

    const args = sessionId
        ? ["--resume", sessionId, "-p", prompt, "--output-format", "stream-json", "--verbose"]
        : ["-p", prompt, "--output-format", "stream-json", "--verbose"];

    console.log("[CLAUDE SERVICE] Spawning claude with args:", JSON.stringify(args));
    console.log("[CLAUDE SERVICE] Prompt length:", prompt.length, "Prompt:", prompt);

    // shell: false로 직접 실행 (Windows .exe 파일 직접 호출)
    const claude = spawn(claudePath!, args, {
        cwd: cwd || process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'], // stdin을 pipe로 설정 (양방향 통신)
        shell: false, // shell 없이 직접 실행
        windowsHide: false, // 디버깅을 위해 일단 표시
    });

    // 프로세스 spawn 직후 이벤트 리스너 등록 확인
    console.log("[CLAUDE SERVICE] Process spawned, PID:", claude.pid);
    console.log("[CLAUDE SERVICE] stdout exists:", !!claude.stdout);
    console.log("[CLAUDE SERVICE] stderr exists:", !!claude.stderr);

    // 즉시 close/error 이벤트 등록 (디버깅용)
    claude.on("spawn", () => {
        console.log("[CLAUDE SERVICE] ✓ Process spawn event triggered");
    });

    claude.on("error", (error) => {
        console.log("[CLAUDE SERVICE] ✗ Process error event:", error.message);
    });

    claude.on("close", (code, signal) => {
        console.log("[CLAUDE SERVICE] ✓ Process close event:", { code, signal });
    });

    claude.on("exit", (code, signal) => {
        console.log("[CLAUDE SERVICE] ✓ Process exit event:", { code, signal });
    });

    // 디버그: stdout 설정 확인
    if (claude.stdout) {
        console.log("[CLAUDE SERVICE] stdout is readable:", claude.stdout.readable);

        // 버퍼링 비활성화 시도
        if ('setNoDelay' in claude.stdout && typeof claude.stdout.setNoDelay === 'function') {
            (claude.stdout as any).setNoDelay(true);
        }

        claude.stdout.setEncoding('utf8');

        // 즉시 data 이벤트 리스너 등록하여 테스트
        claude.stdout.on("data", (data) => {
            console.log("[CLAUDE SERVICE] !!! stdout data received, length:", data.length);
            console.log("[CLAUDE SERVICE] First 100 chars:", data.substring(0, 100));
        });

        // readable 이벤트 리스너 제거 - data 이벤트와 충돌함!
        // claude.stdout.on("readable", () => { ... });

        claude.stdout.on("end", () => {
            console.log("[CLAUDE SERVICE] stdout end event triggered");
        });
    }

    if (claude.stderr) {
        console.log("[CLAUDE SERVICE] stderr is readable:", claude.stderr.readable);
        claude.stderr.setEncoding('utf8');

        // 즉시 data 이벤트 리스너 등록하여 테스트
        claude.stderr.on("data", (data) => {
            console.log("[CLAUDE SERVICE] !!! stderr data received:", data);
        });
    }

    return claude;
};
