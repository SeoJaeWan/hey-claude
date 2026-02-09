import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname } from "path";
import fs from "fs/promises";
import path from "path";

// Import routes
import setupRouter, { initSetupCache } from "./routes/setup.js";
import hooksRouter from "./routes/hooks.js";
import sessionsRouter from "./routes/sessions.js";
import chatRouter from "./routes/chat.js";
import aiRouter from "./routes/ai.js";
import snippetsRouter from "./routes/snippets.js";
import projectRouter from "./routes/project.js";
import settingsRouter from "./routes/settings.js";
import cliRouter from "./routes/cli.js";
import sseRouter from "./routes/sse.js";
import ptyRouter from "./routes/pty.js";

// Import services
import { initDatabase } from "./services/database.js";
import { getAllCommands, loadCommandsFromDB, saveCommandsToDB, type CommandInfo } from "./services/claude-commands-detector.js";
import { initCliToolsCache } from "./services/cli-detector.js";
import { readConfig } from "./services/config.js";
import sessionStatusManager from "./services/sessionStatusManager.js";
import sseManager from "./services/sseManager.js";
import claudeProcessManager from "./services/claudeProcessManager.js";

const __filename = fileURLToPath(import.meta.url);
dirname(__filename); // used for fileURLToPath compatibility

// Commands cache (future use: 프론트엔드 자동완성에서 사용 예정)
export let commandsCache: CommandInfo[] = [];

const DEFAULT_PORT = 7777;
const MAX_PORT = 7877;

interface ServerLock {
    port: number;
    pid: number;
    startedAt: string;
}

/**
 * server.lock 파일 경로
 */
const getLockFilePath = (projectPath: string): string => {
    return path.join(projectPath, ".hey-claude", "server.lock");
};

/**
 * server.lock 파일 생성
 */
const createLockFile = async (
    projectPath: string,
    port: number
): Promise<void> => {
    const lockPath = getLockFilePath(projectPath);
    const lock: ServerLock = {
        port,
        pid: process.pid,
        startedAt: new Date().toISOString(),
    };

    const dir = path.dirname(lockPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(lockPath, JSON.stringify(lock, null, 4), "utf-8");
    console.log(`Created lock file: ${lockPath}`);
};

/**
 * server.lock 파일 삭제
 */
const removeLockFile = async (projectPath: string): Promise<void> => {
    const lockPath = getLockFilePath(projectPath);
    try {
        await fs.unlink(lockPath);
        console.log(`Removed lock file: ${lockPath}`);
    } catch (error) {
        // 파일이 없으면 무시
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            console.error("Failed to remove lock file:", error);
        }
    }
};

/**
 * 프로세스 종료 시 cleanup
 */
const setupCleanup = (projectPath: string): void => {
    const cleanup = async () => {
        console.log("\nShutting down server...");

        // Claude 프로세스 정리
        claudeProcessManager.cleanup();

        await removeLockFile(projectPath);
        process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
};

/**
 * 명령어 캐시 갱신 (DB에서 먼저 로드, 백그라운드에서 최신 데이터 갱신)
 */
const refreshCommandsCache = async (): Promise<void> => {
    // 1. DB에서 먼저 로드 (즉시 사용 가능)
    const dbCommands = loadCommandsFromDB();
    if (dbCommands.length > 0) {
        commandsCache = dbCommands;
        console.log(`[COMMANDS] Loaded ${dbCommands.length} commands from DB (instant)`);
    }

    // 2. 백그라운드에서 최신 데이터 갱신
    try {
        console.log("[COMMANDS] Refreshing from filesystem/CLI (background)...");
        const freshCommands = await getAllCommands(process.cwd());
        commandsCache = freshCommands;

        // 3. DB 업데이트
        saveCommandsToDB(freshCommands);

        const localCount = freshCommands.filter((cmd) => cmd.source === "local").length;
        const builtinCount = freshCommands.filter((cmd) => cmd.source === "builtin").length;
        console.log(
            `[COMMANDS] Cache refreshed: ${localCount} local, ${builtinCount} builtin (total: ${freshCommands.length})`
        );
    } catch (error) {
        console.error("[COMMANDS] Failed to refresh from filesystem/CLI:", error);
        // DB에서 로드한 데이터가 있으면 그대로 사용
    }
};

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Health check
app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// API Routes
app.use("/api/setup", setupRouter);
app.use("/api/hooks", hooksRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/chat", chatRouter);
app.use("/api/ai", aiRouter);
app.use("/api/snippets", snippetsRouter);
app.use("/api/project", projectRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/cli", cliRouter);
app.use("/api/sse", sseRouter);
app.use("/api/pty", ptyRouter);

// Error handler
app.use(
    (
        err: Error,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
    ) => {
        console.error("Error:", err);
        res.status(500).json({
            error: {
                code: "INTERNAL_ERROR",
                message: err.message || "Internal server error",
            },
        });
    }
);

// Start server with port auto-increment
const startServer = async (
    projectPath: string,
    port: number
): Promise<void> => {
    return new Promise((resolve, reject) => {
        const server = app
            .listen(port)
            .on("listening", async () => {
                console.log(`Server is running on http://localhost:${port}`);
                await createLockFile(projectPath, port);
                resolve();
            })
            .on("error", (err: NodeJS.ErrnoException) => {
                if (err.code === "EADDRINUSE") {
                    if (port < MAX_PORT) {
                        console.log(`Port ${port} is in use, trying ${port + 1}...`);
                        server.close();
                        startServer(projectPath, port + 1)
                            .then(resolve)
                            .catch(reject);
                    } else {
                        reject(
                            new Error(
                                `No available ports in range ${DEFAULT_PORT}-${MAX_PORT}`
                            )
                        );
                    }
                } else {
                    reject(err);
                }
            });
    });
};

// Main
(async () => {
    try {
        const projectPath = process.cwd();

        // 1. Database 초기화
        console.log("Initializing database...");
        initDatabase(projectPath);

        // 2. Config 캐시 워밍업
        console.log("Warming up config cache...");
        const config = await readConfig(projectPath);

        // 3. Setup 캐시 초기화 (동기, 1회만)
        console.log("Initializing setup cache...");
        initSetupCache();

        // 4. CLI 도구 캐시 초기화 (비동기, config에서 apiKeys 필요)
        console.log("Initializing CLI tools cache...");
        await initCliToolsCache(config.apiKeys || {});

        // 5. SessionStatusManager와 SSEManager 연결
        console.log("Initializing session status manager...");
        sessionStatusManager.setBroadcastCallback((data) => {
            sseManager.broadcastGlobal(data);
        });

        // 6. SSE 구독자 0 + idle 상태 → PTY 종료
        sseManager.setOnSessionEmpty((sessionId) => {
            const status = sessionStatusManager.getStatus(sessionId);
            if (!status || status.status === "idle") {
                if (claudeProcessManager.hasProcess(sessionId)) {
                    console.log(`[CLEANUP] Terminating idle PTY for session ${sessionId} (no subscribers + idle)`);
                    claudeProcessManager.terminateProcess(sessionId);
                }
            }
            // streaming/background_tasks 상태면 PTY 유지 (hooks.ts stop에서 처리)
        });

        // 7. SSE 클라이언트 연결 해제 시 PTY 종료
        console.log("Setting up SSE client disconnect handler...");
        sseManager.setOnClientDisconnected((clientId) => {
            console.log(`[SERVER] SSE client disconnected, terminating PTY for ${clientId.substring(0, 8)}`);
            claudeProcessManager.terminateForClient(clientId);
        });

        // 8. Cleanup 핸들러 설정
        setupCleanup(projectPath);

        // 9. 서버 시작
        await startServer(projectPath, DEFAULT_PORT);

        // 10. 명령어 캐시 갱신 (백그라운드, 서버 시작 차단 안 함)
        refreshCommandsCache();
    } catch (err) {
        console.error("Failed to start server:", err);
        process.exit(1);
    }
})();
