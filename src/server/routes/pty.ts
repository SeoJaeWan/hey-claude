/**
 * PTY Routes - PTY 프로세스와 실시간 통신
 *
 * - SSE로 TUI 출력 스트리밍
 * - REST로 사용자 입력 전달
 * - Hooks로 구조화된 데이터 수집 (별도 채널)
 */

import { Router, type Router as RouterType, Request, Response } from "express";
import claudeProcessManager from "../services/claudeProcessManager.js";
import { getDatabase } from "../services/database.js";
import { randomUUID } from "crypto";

const router: RouterType = Router();

// 활성 SSE 연결 관리
const activeConnections: Map<string, Response[]> = new Map();

/**
 * POST /api/pty/create
 * PTY 세션 생성
 */
router.post("/create", async (req, res) => {
    try {
        const { sessionId, claudeSessionId, cwd } = req.body;

        // 내부 세션 ID 생성 (없으면)
        const internalSessionId = sessionId || randomUUID();

        // PTY 프로세스 생성
        const cp = await claudeProcessManager.getOrCreateProcess(
            internalSessionId,
            claudeSessionId,
            cwd || process.cwd()
        );

        // DB에 세션 등록 (아직 없으면)
        const db = getDatabase();
        const existing = db.prepare("SELECT id FROM sessions WHERE id = ?").get(internalSessionId);

        if (!existing) {
            const now = new Date().toISOString();
            db.prepare(`
                INSERT INTO sessions (id, type, claude_session_id, project_path, source, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                internalSessionId,
                "claude-code",
                claudeSessionId || null,
                cwd || process.cwd(),
                "web",
                "active",
                now,
                now
            );
        }

        res.json({
            success: true,
            sessionId: internalSessionId,
            claudeSessionId: cp.claudeSessionId
        });
    } catch (error) {
        console.error("[PTY] Create error:", error);
        res.status(500).json({
            success: false,
            error: (error as Error).message
        });
    }
});

/**
 * GET /api/pty/stream/:sessionId
 * SSE로 PTY 출력 스트리밍
 */
router.get("/stream/:sessionId", async (req: Request, res: Response) => {
    const sessionId = req.params.sessionId as string;

    console.log(`[PTY] SSE connection request for session ${sessionId}`);

    // SSE 헤더 설정
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // 연결 등록
    if (!activeConnections.has(sessionId)) {
        activeConnections.set(sessionId, []);
    }
    activeConnections.get(sessionId)!.push(res);

    console.log(`[PTY] SSE connected for session ${sessionId}, total connections: ${activeConnections.get(sessionId)!.length}`);

    // 초기 연결 확인 메시지
    res.write(`event: connected\ndata: ${JSON.stringify({ sessionId })}\n\n`);

    // PTY 프로세스 가져오기 또는 생성
    const cp = claudeProcessManager.getProcess(sessionId);

    if (cp) {
        // PTY 출력 구독
        const unsubData = claudeProcessManager.onData(sessionId, (data: string) => {
            // ANSI escape codes 포함한 원본 데이터 전송
            const chunk = JSON.stringify({ type: "output", data });
            res.write(`event: output\ndata: ${chunk}\n\n`);
        });

        // PTY 종료 구독
        const unsubExit = claudeProcessManager.onExit(sessionId, (code: number) => {
            const chunk = JSON.stringify({ type: "exit", code });
            res.write(`event: exit\ndata: ${chunk}\n\n`);
            res.end();
        });

        // 연결 종료 시 정리
        req.on("close", () => {
            console.log(`[PTY] SSE disconnected for session ${sessionId}`);
            unsubData();
            unsubExit();

            // 연결 목록에서 제거
            const connections = activeConnections.get(sessionId);
            if (connections) {
                const idx = connections.indexOf(res);
                if (idx > -1) {
                    connections.splice(idx, 1);
                }
                if (connections.length === 0) {
                    activeConnections.delete(sessionId);
                }
            }
        });
    } else {
        // 프로세스 없음 - 에러 전송
        res.write(`event: error\ndata: ${JSON.stringify({ error: "No active process" })}\n\n`);
        res.end();
    }
});

/**
 * POST /api/pty/input/:sessionId
 * PTY stdin으로 입력 전송
 */
router.post("/input/:sessionId", (req, res) => {
    const sessionId = req.params.sessionId as string;
    const { input } = req.body;

    if (!input && input !== "") {
        return res.status(400).json({
            success: false,
            error: "Input is required"
        });
    }

    const success = claudeProcessManager.write(sessionId, input);

    if (success) {
        res.json({ success: true });
    } else {
        res.status(404).json({
            success: false,
            error: "No active process for this session"
        });
    }
});

/**
 * POST /api/pty/resize/:sessionId
 * PTY 크기 조정
 */
router.post("/resize/:sessionId", (req, res) => {
    const sessionId = req.params.sessionId as string;
    const { cols, rows } = req.body;

    if (!cols || !rows) {
        return res.status(400).json({
            success: false,
            error: "cols and rows are required"
        });
    }

    claudeProcessManager.resize(sessionId, cols, rows);
    res.json({ success: true });
});

/**
 * DELETE /api/pty/:sessionId
 * PTY 세션 종료
 */
router.delete("/:sessionId", (req, res) => {
    const sessionId = req.params.sessionId as string;

    claudeProcessManager.terminateProcess(sessionId);

    // 활성 SSE 연결 종료
    const connections = activeConnections.get(sessionId);
    if (connections) {
        connections.forEach(conn => {
            conn.write(`event: exit\ndata: ${JSON.stringify({ type: "exit", code: 0 })}\n\n`);
            conn.end();
        });
        activeConnections.delete(sessionId);
    }

    res.json({ success: true });
});

/**
 * GET /api/pty/status/:sessionId
 * PTY 세션 상태 조회
 */
router.get("/status/:sessionId", (req, res) => {
    const sessionId = req.params.sessionId as string;

    const process = claudeProcessManager.getProcess(sessionId);
    const state = claudeProcessManager.getProcessState(sessionId);

    res.json({
        exists: !!process,
        state,
        sessionId: process?.sessionId,
        claudeSessionId: process?.claudeSessionId,
        lastActivityAt: process?.lastActivityAt?.toISOString()
    });
});

export default router;
