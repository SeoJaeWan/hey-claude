/**
 * SessionStatusManager
 *
 * Tracks and broadcasts session status changes in real-time.
 * Manages session states: idle, streaming, background_tasks
 */

export type SessionStatus = "idle" | "streaming" | "background_tasks";

export interface SessionStatusData {
    sessionId: string;
    status: SessionStatus;
    backgroundTasksCount: number;
    updatedAt: string;
}

class SessionStatusManager {
    private statuses: Map<string, SessionStatusData> = new Map();
    private broadcastCallback: ((data: SessionStatusData) => void) | null = null;

    /**
     * Register broadcast callback (called by SSEManager)
     */
    public setBroadcastCallback(callback: (data: SessionStatusData) => void): void {
        this.broadcastCallback = callback;
        console.log("[SESSION STATUS] Broadcast callback registered");
    }

    /**
     * Set session status and broadcast
     */
    public setStatus(sessionId: string, status: SessionStatus): void {
        const currentData = this.statuses.get(sessionId);
        const backgroundTasksCount = currentData?.backgroundTasksCount || 0;

        const statusData: SessionStatusData = {
            sessionId,
            status,
            backgroundTasksCount,
            updatedAt: new Date().toISOString()
        };

        this.statuses.set(sessionId, statusData);
        console.log(`[SESSION STATUS] Session ${sessionId} status changed to: ${status}`);

        // Broadcast to all clients
        if (this.broadcastCallback) {
            this.broadcastCallback(statusData);
        }
    }

    /**
     * Increment background tasks count (when Task tool is detected)
     */
    public incrementBackgroundTasks(sessionId: string): void {
        const currentData = this.statuses.get(sessionId);
        const currentCount = currentData?.backgroundTasksCount || 0;

        const statusData: SessionStatusData = {
            sessionId,
            status: "background_tasks",
            backgroundTasksCount: currentCount + 1,
            updatedAt: new Date().toISOString()
        };

        this.statuses.set(sessionId, statusData);
        console.log(`[SESSION STATUS] Session ${sessionId} background tasks count: ${statusData.backgroundTasksCount}`);

        // Broadcast to all clients
        if (this.broadcastCallback) {
            this.broadcastCallback(statusData);
        }
    }

    /**
     * Decrement background tasks count (when SubagentStop is detected)
     */
    public decrementBackgroundTasks(sessionId: string): void {
        const currentData = this.statuses.get(sessionId);
        if (!currentData) {
            console.log(`[SESSION STATUS] No status data found for session ${sessionId}`);
            return;
        }

        const newCount = Math.max(0, currentData.backgroundTasksCount - 1);
        const newStatus: SessionStatus = newCount > 0 ? "background_tasks" : "idle";

        const statusData: SessionStatusData = {
            sessionId,
            status: newStatus,
            backgroundTasksCount: newCount,
            updatedAt: new Date().toISOString()
        };

        this.statuses.set(sessionId, statusData);
        console.log(`[SESSION STATUS] Session ${sessionId} background tasks decreased to: ${newCount}, status: ${newStatus}`);

        // Broadcast to all clients
        if (this.broadcastCallback) {
            this.broadcastCallback(statusData);
        }
    }

    /**
     * Get status for a specific session
     */
    public getStatus(sessionId: string): SessionStatusData | undefined {
        return this.statuses.get(sessionId);
    }

    /**
     * Get all session statuses (for initial sync)
     */
    public getAllStatuses(): SessionStatusData[] {
        return Array.from(this.statuses.values());
    }

    /**
     * Remove session status (cleanup)
     */
    public removeSession(sessionId: string): void {
        this.statuses.delete(sessionId);
        console.log(`[SESSION STATUS] Removed session ${sessionId}`);
    }
}

// Singleton instance
const sessionStatusManager = new SessionStatusManager();

export default sessionStatusManager;
