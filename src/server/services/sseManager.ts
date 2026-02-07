/**
 * SSEManager
 *
 * Manages Server-Sent Events (SSE) connections for real-time updates.
 * Supports both global broadcast and session-specific messaging.
 */

import type {Response} from "express";
import type {SessionStatusData} from "./sessionStatusManager.js";

interface SSEClient {
    res: Response;
    sessionId?: string;
}

class SSEManager {
    private globalClients: Set<SSEClient> = new Set();
    private sessionClients: Map<string, Set<SSEClient>> = new Map();
    private onSessionEmptyCallback: ((sessionId: string) => void) | null = null;

    /**
     * Add global SSE client (receives all session updates)
     */
    public addGlobalClient(res: Response): void {
        const client: SSEClient = {res};
        this.globalClients.add(client);
        console.log(`[SSE MANAGER] Global client connected (total: ${this.globalClients.size})`);

        // Setup connection cleanup
        res.on("close", () => {
            this.removeGlobalClient(client);
        });
    }

    /**
     * Remove global SSE client
     */
    public removeGlobalClient(client: SSEClient): void {
        this.globalClients.delete(client);
        console.log(`[SSE MANAGER] Global client disconnected (total: ${this.globalClients.size})`);
    }

    /**
     * Add session-specific SSE client
     */
    public addSessionClient(sessionId: string, res: Response): void {
        const client: SSEClient = {res, sessionId};

        if (!this.sessionClients.has(sessionId)) {
            this.sessionClients.set(sessionId, new Set());
        }

        this.sessionClients.get(sessionId)!.add(client);
        console.log(`[SSE MANAGER] Session client connected for ${sessionId} (total: ${this.sessionClients.get(sessionId)!.size})`);

        // Setup connection cleanup
        res.on("close", () => {
            this.removeSessionClient(sessionId, client);
        });
    }

    /**
     * Remove session-specific SSE client
     */
    public removeSessionClient(sessionId: string, client: SSEClient): void {
        const clients = this.sessionClients.get(sessionId);
        if (clients) {
            clients.delete(client);
            console.log(`[SSE MANAGER] Session client disconnected for ${sessionId} (total: ${clients.size})`);

            // Cleanup empty sets
            if (clients.size === 0) {
                this.sessionClients.delete(sessionId);
                // 세션 클라이언트가 0이 되면 콜백 호출
                if (this.onSessionEmptyCallback) {
                    this.onSessionEmptyCallback(sessionId);
                }
            }
        }
    }

    /**
     * 세션 클라이언트가 0이 될 때 호출되는 콜백 등록
     */
    public setOnSessionEmpty(callback: (sessionId: string) => void): void {
        this.onSessionEmptyCallback = callback;
    }

    /**
     * Broadcast to all global clients
     */
    public broadcastGlobal(data: SessionStatusData): void {
        const message = `data: ${JSON.stringify({type: "session_status", data})}\n\n`;

        for (const client of this.globalClients) {
            try {
                client.res.write(message);
            } catch (error) {
                console.error("[SSE MANAGER] Failed to write to global client:", error);
                this.removeGlobalClient(client);
            }
        }

        console.log(`[SSE MANAGER] Broadcasted session status to ${this.globalClients.size} global clients`);
    }

    /**
     * Broadcast to session-specific clients
     * 클라이언트가 없으면 주요 이벤트를 Global SSE로 포워딩 (캐시 무효화용)
     */
    public broadcastToSession(sessionId: string, data: SessionStatusData | any): void {
        const clients = this.sessionClients.get(sessionId);
        if (!clients || clients.size === 0) {
            // 주요 이벤트를 Global SSE로 포워딩
            const eventType = data?.type;
            if (eventType === "assistant_message" || eventType === "tool_use_message" || eventType === "turn_complete") {
                const notification = `data: ${JSON.stringify({
                    type: "session_data_updated",
                    sessionId,
                    eventType
                })}\n\n`;

                for (const client of this.globalClients) {
                    try {
                        client.res.write(notification);
                    } catch (error) {
                        this.removeGlobalClient(client);
                    }
                }
                console.log(`[SSE MANAGER] No session clients for ${sessionId}, forwarded ${eventType} to ${this.globalClients.size} global clients`);
            }
            return;
        }

        // If data has a 'type' field, use it directly; otherwise wrap it as session_status
        const eventData = data.type ? data : {type: "session_status", data};
        const message = `data: ${JSON.stringify(eventData)}\n\n`;

        for (const client of clients) {
            try {
                client.res.write(message);
            } catch (error) {
                console.error(`[SSE MANAGER] Failed to write to session ${sessionId} client:`, error);
                this.removeSessionClient(sessionId, client);
            }
        }

        console.log(`[SSE MANAGER] Broadcasted to ${clients.size} session clients (type: ${eventData.type || 'session_status'})`);
    }

    /**
     * Get connection stats
     */
    public getStats(): {globalClients: number; sessionClients: number} {
        let sessionClientsTotal = 0;
        for (const clients of this.sessionClients.values()) {
            sessionClientsTotal += clients.size;
        }

        return {
            globalClients: this.globalClients.size,
            sessionClients: sessionClientsTotal
        };
    }
}

// Singleton instance
const sseManager = new SSEManager();

export default sseManager;
