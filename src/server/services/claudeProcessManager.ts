/**
 * Claude Process Manager - PTY 기반
 *
 * PTY (Pseudo-Terminal) 기반으로 Claude CLI 프로세스를 관리합니다.
 * - 세션당 1개의 PTY 프로세스 유지
 * - TUI 출력 그대로 프론트엔드에 전달
 * - stdin으로 사용자 입력 전달
 * - Hooks로 구조화된 데이터 수집
 */

import * as pty from "node-pty";
import type { IPty } from "node-pty";
import { EventEmitter } from "events";
import { execSync } from "child_process";

// Claude 실행 파일 경로 찾기 (Windows 환경 대응)
let claudePath: string | null = null;
try {
    claudePath = execSync("where claude", { encoding: "utf-8" }).trim().split("\n")[0];
    console.log("[PTY MANAGER] Claude path found:", claudePath);
} catch (error) {
    console.log("[PTY MANAGER] Could not find claude in PATH, using 'claude' directly");
    claudePath = "claude";
}

// 프로세스 상태
export type ProcessState = 'idle' | 'processing' | 'waiting_input';

// 관리되는 Claude PTY 프로세스 정보
export interface ClaudeProcess {
    pty: IPty;
    sessionId: string;
    claudeSessionId?: string;
    state: ProcessState;
    lastActivityAt: Date;
    eventEmitter: EventEmitter;
}

// 청크 콜백 타입 (TUI 출력)
export type OutputCallback = (data: string) => void;

class ClaudeProcessManager {
    private processes: Map<string, ClaudeProcess> = new Map();

    /**
     * 세션에 대한 PTY 프로세스 가져오기 또는 생성
     */
    async getOrCreateProcess(
        sessionId: string,
        claudeSessionId?: string,
        cwd?: string
    ): Promise<ClaudeProcess> {
        // 기존 프로세스 확인
        const existing = this.processes.get(sessionId);
        if (existing) {
            console.log(`[PTY MANAGER] Reusing existing process for session ${sessionId}`);
            return existing;
        }

        // 새 PTY 프로세스 생성
        console.log(`[PTY MANAGER] Creating new PTY process for session ${sessionId}`);

        // 인터랙티브 모드 - TUI로 실행
        // --resume: 기존 Claude 세션 재개
        // 새 세션: args 없이 실행 (Claude가 새 세션 생성)
        let args: string[];
        if (claudeSessionId) {
            args = ['--resume', claudeSessionId];
        } else {
            args = [];
        }

        console.log(`[PTY MANAGER] Spawning claude with args:`, args);

        // Windows에서는 cmd.exe 통해 실행
        const isWindows = process.platform === 'win32';
        const shell = isWindows ? 'cmd.exe' : '/bin/bash';
        const shellArgs = isWindows
            ? ['/c', `claude ${args.join(' ')}`]
            : ['-c', `claude ${args.join(' ')}`];

        const ptyProcess = pty.spawn(shell, shellArgs, {
            name: 'xterm-256color',
            cols: 120,
            rows: 30,
            cwd: cwd || process.cwd(),
            env: process.env as { [key: string]: string }
        });

        const claudeProcess: ClaudeProcess = {
            pty: ptyProcess,
            sessionId,
            claudeSessionId,
            state: 'idle',
            lastActivityAt: new Date(),
            eventEmitter: new EventEmitter()
        };

        // PTY 데이터 이벤트 (TUI 출력)
        ptyProcess.onData((data: string) => {
            claudeProcess.lastActivityAt = new Date();
            // 디버그: PTY 출력 로그 (ANSI 이스케이프 제거)
            const cleanData = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').trim();
            if (cleanData.length > 0) {
                const preview = cleanData.substring(0, 200);
                console.log(`[PTY OUTPUT] [${sessionId.substring(0, 8)}] ${preview}`);
            }
            claudeProcess.eventEmitter.emit('data', data);
        });

        // PTY 종료 이벤트
        ptyProcess.onExit(({ exitCode, signal }) => {
            console.log(`[PTY MANAGER] Process exited for session ${sessionId}:`, { exitCode, signal });
            claudeProcess.eventEmitter.emit('exit', exitCode, signal);
            this.processes.delete(sessionId);
        });

        this.processes.set(sessionId, claudeProcess);
        return claudeProcess;
    }

    /**
     * PTY stdin으로 입력 전송
     */
    write(sessionId: string, data: string): boolean {
        const cp = this.processes.get(sessionId);
        if (!cp) {
            console.log(`[PTY MANAGER] No process found for session ${sessionId}`);
            return false;
        }

        cp.lastActivityAt = new Date();
        cp.state = 'processing';
        console.log(`[PTY WRITE] [${sessionId.substring(0, 8)}] Writing ${data.length} chars: "${data.replace(/\r/g, '\\r').replace(/\n/g, '\\n').substring(0, 100)}"`);
        cp.pty.write(data);
        return true;
    }

    /**
     * PTY stdout 데이터 구독
     */
    onData(sessionId: string, callback: OutputCallback): () => void {
        const cp = this.processes.get(sessionId);
        if (!cp) {
            return () => {};
        }

        cp.eventEmitter.on('data', callback);
        return () => {
            cp.eventEmitter.off('data', callback);
        };
    }

    /**
     * PTY 종료 이벤트 구독
     */
    onExit(sessionId: string, callback: (code: number, signal?: number) => void): () => void {
        const cp = this.processes.get(sessionId);
        if (!cp) {
            return () => {};
        }

        cp.eventEmitter.on('exit', callback);
        return () => {
            cp.eventEmitter.off('exit', callback);
        };
    }

    /**
     * 세션의 활성 프로세스 가져오기
     */
    getProcess(sessionId: string): ClaudeProcess | undefined {
        return this.processes.get(sessionId);
    }

    /**
     * 프로세스 상태 확인
     */
    getProcessState(sessionId: string): ProcessState | null {
        const cp = this.processes.get(sessionId);
        return cp ? cp.state : null;
    }

    /**
     * 프로세스 상태 설정
     */
    setProcessState(sessionId: string, state: ProcessState): void {
        const cp = this.processes.get(sessionId);
        if (cp) {
            cp.state = state;
        }
    }

    /**
     * PTY 크기 조정
     */
    resize(sessionId: string, cols: number, rows: number): void {
        const cp = this.processes.get(sessionId);
        if (cp) {
            cp.pty.resize(cols, rows);
        }
    }

    /**
     * 세션의 프로세스 종료
     */
    terminateProcess(sessionId: string): void {
        const cp = this.processes.get(sessionId);
        if (cp) {
            console.log(`[PTY MANAGER] Terminating process for session ${sessionId}`);
            cp.pty.kill();
            this.processes.delete(sessionId);
        }
    }

    /**
     * 모든 프로세스 종료 (서버 종료 시)
     */
    cleanup(): void {
        console.log(`[PTY MANAGER] Cleaning up all processes...`);

        for (const [sessionId, cp] of this.processes) {
            console.log(`[PTY MANAGER] Terminating process for session ${sessionId}`);
            cp.pty.kill();
        }

        this.processes.clear();
        console.log(`[PTY MANAGER] Cleanup complete`);
    }

    /**
     * 활성 프로세스 수 반환
     */
    getActiveProcessCount(): number {
        return this.processes.size;
    }

    /**
     * 세션에 활성 프로세스가 있는지 확인
     */
    hasProcess(sessionId: string): boolean {
        return this.processes.has(sessionId);
    }

    /**
     * AskUserQuestion 답변을 PTY stdin으로 전송
     * 답변 텍스트 + Enter 전송
     */
    writeAnswer(sessionId: string, answer: string): boolean {
        const cp = this.processes.get(sessionId);
        if (!cp) {
            console.log(`[PTY MANAGER] No process found for answer: session ${sessionId}`);
            return false;
        }

        cp.lastActivityAt = new Date();
        cp.state = 'processing';

        // 답변 텍스트 전송 후 Enter
        cp.pty.write(answer + '\r');
        console.log(`[PTY MANAGER] Answer sent to PTY stdin for session ${sessionId}`);
        return true;
    }
}

// 싱글톤 인스턴스
const claudeProcessManager = new ClaudeProcessManager();

export default claudeProcessManager;
