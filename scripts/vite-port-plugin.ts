/**
 * Vite 플러그인: 동적 포트 할당 및 client.lock 파일 관리
 */

import { Plugin, ViteDevServer } from "vite";
import fs from "fs/promises";
import path from "path";
import { createServer } from "net";

const DEFAULT_PORT = 17777;
const MAX_PORT = 17877;

interface ClientLock {
    port: number;
    pid: number;
    startedAt: string;
}

interface ServerLock {
    port: number;
    pid: number;
    startedAt: string;
}

/**
 * client.lock 파일 경로
 */
const getClientLockPath = (): string => {
    return path.join(process.cwd(), ".hey-claude", "client.lock");
};

/**
 * server.lock 파일 경로
 */
const getServerLockPath = (): string => {
    return path.join(process.cwd(), ".hey-claude", "server.lock");
};

/**
 * server.lock 파일에서 서버 포트 읽기
 */
const readServerPort = async (): Promise<number | null> => {
    try {
        const lockPath = getServerLockPath();
        const content = await fs.readFile(lockPath, "utf-8");
        const lock: ServerLock = JSON.parse(content);
        return lock.port;
    } catch (error) {
        // 파일이 없거나 파싱 실패시 기본 포트 사용
        return null;
    }
};

/**
 * client.lock 파일 생성
 */
const createClientLock = async (port: number): Promise<void> => {
    const lockPath = getClientLockPath();
    const lock: ClientLock = {
        port,
        pid: process.pid,
        startedAt: new Date().toISOString(),
    };

    const dir = path.dirname(lockPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(lockPath, JSON.stringify(lock, null, 4), "utf-8");
    console.log(`Created client.lock: ${lockPath}`);
};

/**
 * client.lock 파일 삭제
 */
const removeClientLock = async (): Promise<void> => {
    const lockPath = getClientLockPath();
    try {
        await fs.unlink(lockPath);
        console.log(`Removed client.lock: ${lockPath}`);
    } catch (error) {
        // 파일이 없으면 무시
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            console.error("Failed to remove client.lock:", error);
        }
    }
};

/**
 * 포트 사용 가능 여부 확인
 */
const isPortAvailable = (port: number): Promise<boolean> => {
    return new Promise((resolve) => {
        const server = createServer();

        server.once("error", (err: NodeJS.ErrnoException) => {
            if (err.code === "EADDRINUSE") {
                resolve(false);
            } else {
                resolve(false);
            }
        });

        server.once("listening", () => {
            server.close();
            resolve(true);
        });

        server.listen(port);
    });
};

/**
 * 사용 가능한 포트 찾기
 */
const findAvailablePort = async (
    startPort: number = DEFAULT_PORT
): Promise<number> => {
    for (let port = startPort; port <= MAX_PORT; port++) {
        const available = await isPortAvailable(port);
        if (available) {
            return port;
        }
    }
    throw new Error(
        `No available ports in range ${DEFAULT_PORT}-${MAX_PORT}`
    );
};

/**
 * cleanup 핸들러 설정
 */
const setupCleanup = (): void => {
    const cleanup = async () => {
        console.log("\nShutting down Vite dev server...");
        await removeClientLock();
        process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
};

/**
 * Vite 플러그인: 동적 포트 할당
 */
export const dynamicPortPlugin = (): Plugin => {
    let resolvedPort: number | null = null;
    let serverPortForProxy: number | null = null;

    return {
        name: "vite-dynamic-port",
        async configResolved(config) {
            // server.lock 파일에서 서버 포트 읽기 (proxy 설정용)
            serverPortForProxy = await readServerPort();
            if (serverPortForProxy) {
                console.log(
                    `Server port detected from server.lock: ${serverPortForProxy}`
                );
            }
        },
        configureServer(server: ViteDevServer) {
            // cleanup 핸들러 설정
            setupCleanup();

            // 서버 시작 후 포트 할당 및 lock 파일 생성
            const originalListen = server.listen.bind(server);
            server.listen = async function (
                port?: number,
                ...args: unknown[]
            ) {
                try {
                    // 사용 가능한 포트 찾기
                    resolvedPort = await findAvailablePort(DEFAULT_PORT);

                    console.log(
                        `Vite dev server starting on port ${resolvedPort}...`
                    );

                    // lock 파일 생성
                    await createClientLock(resolvedPort);

                    // Vite 서버 시작
                    return originalListen(resolvedPort, ...args);
                } catch (error) {
                    console.error("Failed to start Vite dev server:", error);
                    throw error;
                }
            } as typeof server.listen;

            // proxy 설정 동적 업데이트
            if (serverPortForProxy && server.config.server.proxy) {
                const proxyConfig = server.config.server.proxy;
                if (typeof proxyConfig === "object" && "/api" in proxyConfig) {
                    const apiProxy = proxyConfig["/api"];
                    if (typeof apiProxy === "object" && "target" in apiProxy) {
                        apiProxy.target = `http://localhost:${serverPortForProxy}`;
                        console.log(
                            `Proxy target updated to: ${apiProxy.target}`
                        );
                    }
                }
            }
        },
    };
};
