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
            }
        }
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
     */
    public broadcastToSession(sessionId: string, data: SessionStatusData): void {
        const clients = this.sessionClients.get(sessionId);
        if (!clients || clients.size === 0) {
            return;
        }

        const message = `data: ${JSON.stringify({type: "session_status", data})}\n\n`;

        for (const client of clients) {
            try {
                client.res.write(message);
            } catch (error) {
                console.error(`[SSE MANAGER] Failed to write to session ${sessionId} client:`, error);
                this.removeSessionClient(sessionId, client);
            }
        }

        console.log(`[SSE MANAGER] Broadcasted session status to ${clients.size} session clients`);
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
