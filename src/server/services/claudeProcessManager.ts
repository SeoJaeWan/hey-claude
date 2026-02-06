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
import { execSync, spawn } from "child_process";

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

// stream-json 청크 콜백 타입
export type ChunkCallback = (chunk: any) => void;


// 유휴 타임아웃 (5분)
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

// 타임아웃 체크 간격 (1분)
const CLEANUP_INTERVAL_MS = 60 * 1000;

class ClaudeProcessManager {
    private processes: Map<string, ClaudeProcess> = new Map();
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor() {
        // 주기적 정리 시작
        this.startCleanupInterval();
    }

    /**
     * 주기적으로 유휴 프로세스 정리
     */
    private startCleanupInterval(): void {
        this.cleanupInterval = setInterval(() => {
            this.cleanupIdleProcesses();
        }, CLEANUP_INTERVAL_MS);
    }

    /**
     * 유휴 타임아웃 초과한 프로세스 종료
     */
    private cleanupIdleProcesses(): void {
        const now = Date.now();

        for (const [sessionId, cp] of this.processes) {
            const idleTime = now - cp.lastActivityAt.getTime();

            if (cp.state === 'idle' && idleTime > IDLE_TIMEOUT_MS) {
                console.log(`[PTY MANAGER] Terminating idle process for session ${sessionId} (idle for ${Math.round(idleTime / 1000)}s)`);
                this.terminateProcess(sessionId);
            }
        }
    }

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

        // 인터랙티브 모드 - TUI 출력 그대로 전달
        // --session-id: 서버가 세션 ID 관리
        // --resume: 기존 세션 재개
        let args: string[];
        if (claudeSessionId) {
            args = ['--resume', claudeSessionId];
        } else {
            args = ['--session-id', sessionId];
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

        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

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

    // ============================================================
    // Stream-JSON 모드 메서드 (chat.ts 호환용)
    // PTY 전환 완료 후 제거 예정
    // ============================================================

    /**
     * stream-json 모드로 메시지 전송 (chat.ts 호환용)
     * 별도 프로세스로 실행하여 JSON 출력 파싱
     */
    async sendMessage(
        sessionId: string,
        text: string,
        claudeSessionId?: string,
        cwd?: string,
        onChunk?: ChunkCallback
    ): Promise<{ claudeSessionId?: string; response: string }> {
        return new Promise((resolve, reject) => {
            const args = [
                '-p', text,
                '--output-format', 'stream-json',
                '--verbose'
            ];

            if (claudeSessionId) {
                args.unshift('--resume', claudeSessionId);
            }

            console.log(`[PROCESS MANAGER] Spawning stream-json process for session ${sessionId}`);
            console.log(`[PROCESS MANAGER] Claude path: ${claudePath}`);
            console.log(`[PROCESS MANAGER] Args (first 200 chars of prompt):`, [...args.slice(0, 1), args[1]?.substring(0, 200) + '...', ...args.slice(2)]);

            const proc = spawn(claudePath!, args, {
                cwd: cwd || process.cwd(),
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: true,  // Windows에서 인자 처리를 위해 shell: true 사용
                windowsHide: false
            });

            console.log(`[PROCESS MANAGER] Process spawned with PID: ${proc.pid}`);

            let response = '';
            let buffer = '';
            let resolvedClaudeSessionId = claudeSessionId;
            let chunkCount = 0;

            proc.stdout?.setEncoding('utf8');
            proc.stdout?.on('data', (data: string) => {
                chunkCount++;
                console.log(`[PROCESS MANAGER] stdout chunk #${chunkCount}, length: ${data.length}`);
                buffer += data;

                // JSONL 파싱
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;

                    try {
                        const parsed = JSON.parse(line);

                        // Claude 세션 ID 추출
                        if (parsed.session_id) {
                            resolvedClaudeSessionId = parsed.session_id;
                        }

                        // 콜백 호출
                        if (onChunk) {
                            onChunk(parsed);
                        }

                        // 응답 텍스트 누적
                        if (parsed.type === 'assistant' && parsed.message?.content) {
                            for (const block of parsed.message.content) {
                                if (block.type === 'text' && block.text) {
                                    response += block.text;
                                }
                            }
                        }
                    } catch {
                        // JSON 파싱 실패 무시
                    }
                }
            });

            proc.stderr?.setEncoding('utf8');
            proc.stderr?.on('data', (data: string) => {
                console.log(`[PROCESS MANAGER] stderr:`, data);
            });

            proc.on('error', (error) => {
                reject(error);
            });

            proc.on('close', (code) => {
                console.log(`[PROCESS MANAGER] Process closed with code: ${code}, total chunks: ${chunkCount}, response length: ${response.length}`);
                if (code === 0 || code === null) {
                    resolve({ claudeSessionId: resolvedClaudeSessionId, response });
                } else {
                    reject(new Error(`Process exited with code ${code}`));
                }
            });
        });
    }
}

// 싱글톤 인스턴스
const claudeProcessManager = new ClaudeProcessManager();

export default claudeProcessManager;
