/**
 * 포트 자동 할당 유틸리티
 */

import { createServer } from "net";

const DEFAULT_PORT = 7777;
const MAX_PORT = 7877;

export const findAvailablePort = async (
    startPort: number = DEFAULT_PORT
): Promise<number> => {
    for (let port = startPort; port <= MAX_PORT; port++) {
        const available = await isPortAvailable(port);
        if (available) {
            return port;
        }
    }
    throw new Error(`No available ports in range ${DEFAULT_PORT}-${MAX_PORT}`);
};

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
