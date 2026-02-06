/**
 * SSE Routes
 *
 * Server-Sent Events endpoints for real-time session status updates.
 */

import {Router, type Router as RouterType} from "express";
import sseManager from "../services/sseManager.js";
import sessionStatusManager from "../services/sessionStatusManager.js";

const router: RouterType = Router();

/**
 * GET /api/sse/global
 *
 * Global SSE connection - receives status updates for all sessions
 */
router.get("/global", (req, res) => {
    console.log("[SSE] Global SSE connection established");

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering

    // Send initial connection event
    res.write(`data: ${JSON.stringify({type: "connected"})}\n\n`);

    // Send all current session statuses (initial sync)
    const allStatuses = sessionStatusManager.getAllStatuses();
    if (allStatuses.length > 0) {
        for (const status of allStatuses) {
            res.write(`data: ${JSON.stringify({type: "session_status", data: status})}\n\n`);
        }
        console.log(`[SSE] Sent ${allStatuses.length} initial session statuses to global client`);
    }

    // Register client
    sseManager.addGlobalClient(res);

    // Keep connection alive with heartbeat
    const heartbeatInterval = setInterval(() => {
        try {
            res.write(`: heartbeat\n\n`);
        } catch (error) {
            console.log("[SSE] Heartbeat failed, cleaning up");
            clearInterval(heartbeatInterval);
        }
    }, 30000); // 30 seconds

    // Cleanup on connection close
    req.on("close", () => {
        console.log("[SSE] Global SSE connection closed");
        clearInterval(heartbeatInterval);
    });
});

/**
 * GET /api/sse/:sessionId
 *
 * Session-specific SSE connection - receives status updates for a specific session
 */
router.get("/:sessionId", (req, res) => {
    const {sessionId} = req.params;
    console.log(`[SSE] Session-specific SSE connection established for: ${sessionId}`);

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    // Send initial connection event
    res.write(`data: ${JSON.stringify({type: "connected", sessionId})}\n\n`);

    // Send current session status (initial sync)
    const currentStatus = sessionStatusManager.getStatus(sessionId);
    if (currentStatus) {
        res.write(`data: ${JSON.stringify({type: "session_status", data: currentStatus})}\n\n`);
        console.log(`[SSE] Sent initial session status for ${sessionId}`);
    }

    // Register client
    sseManager.addSessionClient(sessionId, res);

    // Keep connection alive with heartbeat
    const heartbeatInterval = setInterval(() => {
        try {
            res.write(`: heartbeat\n\n`);
        } catch (error) {
            console.log(`[SSE] Heartbeat failed for session ${sessionId}, cleaning up`);
            clearInterval(heartbeatInterval);
        }
    }, 30000); // 30 seconds

    // Cleanup on connection close
    req.on("close", () => {
        console.log(`[SSE] Session-specific SSE connection closed for: ${sessionId}`);
        clearInterval(heartbeatInterval);
    });
});

export default router;
