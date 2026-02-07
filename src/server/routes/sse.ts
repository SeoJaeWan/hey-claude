/**
 * SSE Routes
 *
 * Server-Sent Events endpoints for real-time session status updates.
 * Uses a unified connection that receives both global and session-specific events.
 */

import {Router, type Router as RouterType} from "express";
import sseManager from "../services/sseManager.js";
import sessionStatusManager from "../services/sessionStatusManager.js";

const router: RouterType = Router();

/**
 * GET /api/sse
 * Unified SSE connection - receives both global and session-specific events
 */
router.get("/", (req, res) => {
    console.log("[SSE] Unified SSE connection established");

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
    res.flushHeaders();

    // Register client and get unique ID
    const clientId = sseManager.addClient(res);

    // Send initial connection event with clientId
    res.write(`data: ${JSON.stringify({type: "connected", clientId})}\n\n`);

    // Send all current session statuses (initial sync)
    const allStatuses = sessionStatusManager.getAllStatuses();
    if (allStatuses.length > 0) {
        for (const status of allStatuses) {
            res.write(`data: ${JSON.stringify({type: "session_status", data: status})}\n\n`);
        }
        console.log(`[SSE] Sent ${allStatuses.length} initial session statuses to client ${clientId}`);
    }

    // Keep connection alive with heartbeat
    const heartbeatInterval = setInterval(() => {
        try {
            res.write(`: heartbeat\n\n`);
        } catch (error) {
            console.log(`[SSE] Heartbeat failed for client ${clientId}, cleaning up`);
            clearInterval(heartbeatInterval);
        }
    }, 30000); // 30 seconds

    // Cleanup on connection close
    req.on("close", () => {
        console.log(`[SSE] Unified SSE connection closed for client ${clientId}`);
        clearInterval(heartbeatInterval);
    });
});

/**
 * POST /api/sse/subscribe
 * Subscribe client to a session's events
 */
router.post("/subscribe", (req, res) => {
    const {clientId, sessionId} = req.body;

    if (!clientId || !sessionId) {
        return res.status(400).json({error: "clientId and sessionId required"});
    }

    sseManager.subscribeToSession(clientId, sessionId);

    // Send current session status to the client via SSE
    const status = sessionStatusManager.getStatus(sessionId);
    if (status) {
        sseManager.sendToClient(clientId, {type: "session_status", data: status});
    }

    res.json({ok: true});
});

/**
 * POST /api/sse/unsubscribe
 * Unsubscribe client from its current session
 */
router.post("/unsubscribe", (req, res) => {
    const {clientId} = req.body;

    if (!clientId) {
        return res.status(400).json({error: "clientId required"});
    }

    sseManager.unsubscribeFromSession(clientId);

    res.json({ok: true});
});

export default router;
