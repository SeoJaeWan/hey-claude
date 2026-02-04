/**
 * Claude CLI 호출 서비스
 */

import { spawn, ChildProcess } from "child_process";

interface ClaudeOptions {
    prompt: string;
    sessionId?: string;
    cwd?: string;
}

export const callClaude = (options: ClaudeOptions): ChildProcess => {
    const { prompt, sessionId, cwd } = options;

    const args = sessionId
        ? ["--resume", sessionId, "-p", prompt, "--output-format", "stream-json"]
        : ["-p", prompt, "--output-format", "stream-json"];

    const claude = spawn("claude", args, {
        cwd: cwd || process.cwd(),
    });

    return claude;
};
