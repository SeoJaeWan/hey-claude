/**
 * Claude Process Manager - PTY 기반 (Client-Centric)
 *
 * PTY (Pseudo-Terminal) 기반으로 Claude CLI 프로세스를 관리합니다.
 * - 클라이언트(SSE 연결)당 1개의 PTY 프로세스 유지
 * - 각 클라이언트는 독립된 PTY로 세션 제어
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
    clientId: string;           // 클라이언트 고유 ID (SSE 연결 기반)
    currentSessionId?: string;  // 현재 활성 세션 ID
    claudeSessionId?: string;   // Claude CLI 세션 ID
    state: ProcessState;
    lastActivityAt: Date;
    eventEmitter: EventEmitter;
}

// 청크 콜백 타입 (TUI 출력)
export type OutputCallback = (data: string) => void;

class ClaudeProcessManager {
    private processes: Map<string, ClaudeProcess> = new Map(); // key: clientId

    /**
     * 클라이언트용 PTY 프로세스 생성
     */
    async createForClient(
        clientId: string,
        sessionId: string,
        claudeSessionId?: string,
        cwd?: string
    ): Promise<ClaudeProcess> {
        // 기존 프로세스 확인
        const existing = this.processes.get(clientId);
        if (existing) {
            console.log(`[PTY MANAGER] Client ${clientId.substring(0, 8)} already has PTY for session ${sessionId.substring(0, 8)}`);
            return existing;
        }

        // 새 PTY 프로세스 생성
        console.log(`[PTY MANAGER] Creating PTY for client ${clientId.substring(0, 8)}, session ${sessionId.substring(0, 8)}`);

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
            clientId,
            currentSessionId: sessionId,
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
                console.log(`[PTY OUTPUT] [Client: ${clientId.substring(0, 8)}] [Session: ${sessionId.substring(0, 8)}] ${preview}`);
            }
            claudeProcess.eventEmitter.emit('data', data);
        });

        // PTY 종료 이벤트
        ptyProcess.onExit(({ exitCode, signal }) => {
            console.log(`[PTY MANAGER] Process exited for client ${clientId.substring(0, 8)}:`, { exitCode, signal });
            claudeProcess.eventEmitter.emit('exit', exitCode, signal);
            this.processes.delete(clientId);
        });

        this.processes.set(clientId, claudeProcess);
        return claudeProcess;
    }

    /**
     * 세션 전환 (PTY 재생성)
     */
    async switchSession(
        clientId: string,
        newSessionId: string,
        newClaudeSessionId?: string,
        cwd?: string
    ): Promise<ClaudeProcess> {
        const existing = this.processes.get(clientId);

        if (!existing) {
            console.log(`[PTY MANAGER] No existing PTY for client ${clientId.substring(0, 8)}, creating new one`);
            return this.createForClient(clientId, newSessionId, newClaudeSessionId, cwd);
        }

        console.log(`[PTY MANAGER] Switching session for client ${clientId.substring(0, 8)}: ${existing.currentSessionId?.substring(0, 8)} → ${newSessionId.substring(0, 8)}`);

        // 실행 중이면 Ctrl+C로 중단
        if (existing.state === 'processing') {
            console.log(`[PTY MANAGER] Sending SIGTERM (Ctrl+C) to stop current process`);
            existing.pty.write('\x03'); // Ctrl+C
            // 딜레이 후 전환
            await new Promise(r => setTimeout(r, 1000));
        }

        // 기존 PTY 종료
        existing.pty.kill();
        this.processes.delete(clientId);

        // 새 PTY 생성
        return this.createForClient(clientId, newSessionId, newClaudeSessionId, cwd);
    }

    /**
     * 클라이언트 PTY 종료 (SIGTERM → timeout → SIGKILL)
     */
    terminateForClient(clientId: string, timeout: number = 5000): void {
        const process = this.processes.get(clientId);
        if (!process) {
            console.log(`[PTY MANAGER] No process to terminate for client ${clientId.substring(0, 8)}`);
            return;
        }

        console.log(`[PTY MANAGER] Terminating PTY for client ${clientId.substring(0, 8)} with ${timeout}ms timeout`);

        // 1. SIGTERM (Ctrl+C) 시도
        process.pty.write('\x03');

        // 2. timeout 후 강제 종료
        setTimeout(() => {
            if (this.processes.has(clientId)) {
                console.log(`[PTY MANAGER] Force killing PTY for client ${clientId.substring(0, 8)} after timeout`);
                process.pty.kill();
                this.processes.delete(clientId);
            }
        }, timeout);
    }

    /**
     * 세션에 대한 PTY 프로세스 가져오기 또는 생성 (호환성 유지)
     * @deprecated Use createForClient() instead
     */
    async getOrCreateProcess(
        sessionId: string,
        claudeSessionId?: string,
        cwd?: string
    ): Promise<ClaudeProcess> {
        // 호환성을 위해 sessionId를 clientId처럼 사용
        console.log(`[PTY MANAGER] getOrCreateProcess (deprecated) called for session ${sessionId.substring(0, 8)}`);
        return this.createForClient(sessionId, sessionId, claudeSessionId, cwd);
    }

    /**
     * PTY stdin으로 입력 전송
     */
    write(clientId: string, data: string): boolean {
        const cp = this.processes.get(clientId);
        if (!cp) {
            console.log(`[PTY MANAGER] No process found for client ${clientId.substring(0, 8)}`);
            return false;
        }

        cp.lastActivityAt = new Date();
        cp.state = 'processing';
        console.log(`[PTY WRITE] [Client: ${clientId.substring(0, 8)}] Writing ${data.length} chars: "${data.replace(/\r/g, '\\r').replace(/\n/g, '\\n').substring(0, 100)}"`);
        cp.pty.write(data);
        return true;
    }

    /**
     * PTY stdout 데이터 구독
     */
    onData(clientId: string, callback: OutputCallback): () => void {
        const cp = this.processes.get(clientId);
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
    onExit(clientId: string, callback: (code: number, signal?: number) => void): () => void {
        const cp = this.processes.get(clientId);
        if (!cp) {
            return () => {};
        }

        cp.eventEmitter.on('exit', callback);
        return () => {
            cp.eventEmitter.off('exit', callback);
        };
    }

    /**
     * 클라이언트의 활성 프로세스 가져오기
     */
    getProcess(clientId: string): ClaudeProcess | undefined {
        return this.processes.get(clientId);
    }

    /**
     * 프로세스 상태 확인
     */
    getProcessState(clientId: string): ProcessState | null {
        const cp = this.processes.get(clientId);
        return cp ? cp.state : null;
    }

    /**
     * 프로세스 상태 설정
     */
    setProcessState(clientId: string, state: ProcessState): void {
        const cp = this.processes.get(clientId);
        if (cp) {
            cp.state = state;
        }
    }

    /**
     * PTY 크기 조정
     */
    resize(clientId: string, cols: number, rows: number): void {
        const cp = this.processes.get(clientId);
        if (cp) {
            cp.pty.resize(cols, rows);
        }
    }

    /**
     * 세션의 프로세스 종료
     * @deprecated Use terminateForClient() instead
     */
    terminateProcess(sessionId: string): void {
        const cp = this.processes.get(sessionId);
        if (cp) {
            console.log(`[PTY MANAGER] Terminating process for session ${sessionId.substring(0, 8)}`);
            cp.pty.kill();
            this.processes.delete(sessionId);
        }
    }

    /**
     * 모든 프로세스 종료 (서버 종료 시)
     */
    cleanup(): void {
        console.log(`[PTY MANAGER] Cleaning up all processes...`);

        for (const [clientId, cp] of this.processes) {
            console.log(`[PTY MANAGER] Terminating process for client ${clientId.substring(0, 8)}`);
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
     * 클라이언트에 활성 프로세스가 있는지 확인
     */
    hasProcess(clientId: string): boolean {
        return this.processes.has(clientId);
    }

    /**
     * AskUserQuestion 답변을 PTY stdin으로 전송
     * 각 줄마다 Enter 전송 (복수 질문 지원, 딜레이 포함)
     */
    async writeAnswerAsync(clientId: string, answer: string): Promise<boolean> {
        const cp = this.processes.get(clientId);
        if (!cp) {
            console.log(`[PTY MANAGER] No process found for answer: client ${clientId.substring(0, 8)}`);
            return false;
        }

        cp.lastActivityAt = new Date();
        cp.state = 'processing';

        // 복수 질문인 경우 각 줄마다 Enter 전송 (딜레이 포함)
        const lines = answer.split('\n');
        console.log(`[PTY MANAGER] Sending ${lines.length} answer line(s) for client ${clientId.substring(0, 8)}`);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line) {
                // 각 줄 전송 후 Enter
                cp.pty.write(line + '\r');
                console.log(`[PTY MANAGER] Line ${i + 1}: "${line}"`);

                // 다음 줄 전에 딜레이 (TUI가 다음 질문을 렌더링할 시간)
                if (i < lines.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        }

        return true;
    }

    /**
     * AskUserQuestion 답변을 PTY stdin으로 전송 (동기 버전 - 단일 답변용)
     */
    writeAnswer(clientId: string, answer: string): boolean {
        const cp = this.processes.get(clientId);
        if (!cp) {
            console.log(`[PTY MANAGER] No process found for answer: client ${clientId.substring(0, 8)}`);
            return false;
        }

        cp.lastActivityAt = new Date();
        cp.state = 'processing';

        // 단일 답변: 텍스트 + Enter
        cp.pty.write(answer + '\r');
        console.log(`[PTY MANAGER] Answer sent to PTY stdin for client ${clientId.substring(0, 8)}`);
        return true;
    }
}

// 싱글톤 인스턴스
const claudeProcessManager = new ClaudeProcessManager();

export default claudeProcessManager;
