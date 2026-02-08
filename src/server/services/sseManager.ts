/**
 * SSEManager
 *
 * Manages Server-Sent Events (SSE) connections for real-time updates.
 * Uses a single unified connection per client instead of separate global + session connections.
 */

import type {Response} from "express";
import {randomUUID} from "crypto";
import type {SessionStatusData} from "./sessionStatusManager.js";

interface SSEClient {
    id: string;
    res: Response;
    subscribedSessionId?: string;
}

class SSEManager {
    private clients: Map<string, SSEClient> = new Map();
    private onSessionEmptyCallback: ((sessionId: string) => void) | null = null;

    /**
     * Add a new SSE client and return its unique ID
     */
    public addClient(res: Response): string {
        const id = randomUUID();
        const client: SSEClient = {id, res};
        this.clients.set(id, client);
        console.log(`[SSE MANAGER] Client connected: ${id} (total: ${this.clients.size})`);

        res.on("close", () => {
            this.removeClient(id);
        });

        return id;
    }

    /**
     * Remove a client
     */
    public removeClient(id: string): void {
        const client = this.clients.get(id);
        if (!client) return;

        const prevSessionId = client.subscribedSessionId;
        this.clients.delete(id);
        console.log(`[SSE MANAGER] Client disconnected: ${id} (total: ${this.clients.size})`);

        if (prevSessionId) {
            this.checkSessionEmpty(prevSessionId);
        }
    }

    /**
     * Subscribe a client to a specific session's events
     */
    public subscribeToSession(clientId: string, sessionId: string): void {
        const client = this.clients.get(clientId);
        if (!client) return;

        const prevSessionId = client.subscribedSessionId;
        client.subscribedSessionId = sessionId;
        console.log(`[SSE MANAGER] Client ${clientId} subscribed to session ${sessionId}`);

        if (prevSessionId && prevSessionId !== sessionId) {
            this.checkSessionEmpty(prevSessionId);
        }
    }

    /**
     * Unsubscribe a client from its current session
     */
    public unsubscribeFromSession(clientId: string): void {
        const client = this.clients.get(clientId);
        if (!client) return;

        const prevSessionId = client.subscribedSessionId;
        client.subscribedSessionId = undefined;
        console.log(`[SSE MANAGER] Client ${clientId} unsubscribed`);

        if (prevSessionId) {
            this.checkSessionEmpty(prevSessionId);
        }
    }

    /**
     * Check if a session has no subscribers and trigger callback
     */
    private checkSessionEmpty(sessionId: string): void {
        const hasSubscribers = Array.from(this.clients.values()).some(
            (c) => c.subscribedSessionId === sessionId
        );
        if (!hasSubscribers && this.onSessionEmptyCallback) {
            this.onSessionEmptyCallback(sessionId);
        }
    }

    /**
     * Set callback for when a session loses all subscribers
     */
    public setOnSessionEmpty(callback: (sessionId: string) => void): void {
        this.onSessionEmptyCallback = callback;
    }

    /**
     * Check if a session has any subscribers
     */
    public hasSessionSubscribers(sessionId: string): boolean {
        return Array.from(this.clients.values()).some(
            (c) => c.subscribedSessionId === sessionId
        );
    }

    /**
     * Broadcast to all connected clients (global events like session_status)
     */
    public broadcastGlobal(data: SessionStatusData): void {
        const message = `data: ${JSON.stringify({type: "session_status", data})}\n\n`;

        for (const client of this.clients.values()) {
            try {
                client.res.write(message);
            } catch (error) {
                console.error("[SSE MANAGER] Failed to write to client:", error);
                this.removeClient(client.id);
            }
        }

        console.log(`[SSE MANAGER] Broadcasted session status to ${this.clients.size} clients`);
    }

    /**
     * Broadcast to session-subscribed clients.
     * If no clients are subscribed, forward key events as lightweight notifications to all clients.
     */
    public broadcastToSession(sessionId: string, data: any): void {
        const subscribedClients = Array.from(this.clients.values()).filter(
            (c) => c.subscribedSessionId === sessionId
        );

        if (subscribedClients.length === 0) {
            // Forward key events to all clients as lightweight notification
            const eventType = data?.type;
            if (eventType === "assistant_message" || eventType === "tool_use_message" || eventType === "turn_complete" || eventType === "ask_user_question" || eventType === "loading_start" || eventType === "user_message") {
                const notification = `data: ${JSON.stringify({
                    type: "session_data_updated",
                    sessionId,
                    eventType
                })}\n\n`;

                for (const client of this.clients.values()) {
                    try {
                        client.res.write(notification);
                    } catch (error) {
                        this.removeClient(client.id);
                    }
                }
                console.log(`[SSE MANAGER] No subscribers for ${sessionId}, forwarded ${eventType} to ${this.clients.size} clients`);
            }
            return;
        }

        const eventData = data.type ? data : {type: "session_status", data};
        const message = `data: ${JSON.stringify(eventData)}\n\n`;

        for (const client of subscribedClients) {
            try {
                client.res.write(message);
            } catch (error) {
                console.error(`[SSE MANAGER] Failed to write to client ${client.id}:`, error);
                this.removeClient(client.id);
            }
        }

        console.log(`[SSE MANAGER] Broadcasted to ${subscribedClients.length} subscribers (type: ${eventData.type || 'session_status'})`);
    }

    /**
     * Send event to a specific client
     */
    public sendToClient(clientId: string, data: any): void {
        const client = this.clients.get(clientId);
        if (!client) return;

        const message = `data: ${JSON.stringify(data)}\n\n`;
        try {
            client.res.write(message);
        } catch (error) {
            this.removeClient(clientId);
        }
    }

    /**
     * Get connection stats
     */
    public getStats(): {totalClients: number; subscribedClients: number} {
        let subscribedCount = 0;
        for (const client of this.clients.values()) {
            if (client.subscribedSessionId) subscribedCount++;
        }

        return {
            totalClients: this.clients.size,
            subscribedClients: subscribedCount
        };
    }
}

// Singleton instance
const sseManager = new SSEManager();

export default sseManager;
