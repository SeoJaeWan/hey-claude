/**
 * PTY Routes - PTY 프로세스 관리 (보조)
 *
 * 주요 통신은 chat.ts에서 관리.
 * 여기서는 resize, status 엔드포인트만 유지.
 */

import { Router, type Router as RouterType } from "express";
import claudeProcessManager from "../services/claudeProcessManager.js";

const router: RouterType = Router();

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
