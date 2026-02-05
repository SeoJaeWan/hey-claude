import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname } from "path";
import fs from "fs/promises";
import path from "path";

// Import routes
import setupRouter from "./routes/setup.js";
import hooksRouter from "./routes/hooks.js";
import sessionsRouter from "./routes/sessions.js";
import chatRouter from "./routes/chat.js";
import aiRouter from "./routes/ai.js";
import snippetsRouter from "./routes/snippets.js";
import projectRouter from "./routes/project.js";
import settingsRouter from "./routes/settings.js";
import cliRouter from "./routes/cli.js";

// Import services
import { initDatabase } from "./services/database.js";
import { getAllCommands, type CommandInfo } from "./services/claude-commands-detector.js";

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
        await removeLockFile(projectPath);
        process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
};

/**
 * 명령어 캐시 갱신 (백그라운드)
 */
const refreshCommandsCache = async (projectPath: string): Promise<void> => {
    try {
        console.log("Refreshing commands cache...");
        const commands = await getAllCommands(projectPath);
        commandsCache = commands;

        const localCount = commands.filter((cmd) => cmd.source === "local").length;
        const builtinCount = commands.filter((cmd) => cmd.source === "builtin").length;

        console.log(
            `Commands cache refreshed: ${localCount} local, ${builtinCount} builtin (total: ${commands.length})`
        );
    } catch (error) {
        console.error("Failed to refresh commands cache:", error);
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

        // 2. Cleanup 핸들러 설정
        setupCleanup(projectPath);

        // 3. 서버 시작
        await startServer(projectPath, DEFAULT_PORT);

        // 4. 명령어 캐시 갱신 (백그라운드, 서버 시작 차단 안 함)
        refreshCommandsCache(projectPath);
    } catch (err) {
        console.error("Failed to start server:", err);
        process.exit(1);
    }
})();
