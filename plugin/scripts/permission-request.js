#!/usr/bin/env node

/**
 * PermissionRequest Hook
 *
 * - terminal origin: CLI 다이얼로그는 그대로 표시, Web에는 모니터링 이벤트만 전송
 * - web origin: Web UI의 허용/거부 결정을 폴링해 Claude PermissionRequest 결정으로 반환
 */

const fs = require("fs");
const path = require("path");
const http = require("http");

let inputData = "";

const isWebOrigin = process.env.HEY_CLAUDE_ORIGIN === "web";
const origin = isWebOrigin ? "web" : "terminal";
const controllerPid = process.ppid;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const outputPermissionDecision = (behavior, message) => {
    const decision = { behavior };
    if (message) {
        decision.message = message;
    }

    console.log(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: "PermissionRequest",
            decision,
        },
    }));
};

const requestJson = ({ port, reqPath, method = "GET", payload, timeoutMs = 10000 }) => {
    return new Promise((resolve, reject) => {
        const body = payload ? JSON.stringify(payload) : "";
        const req = http.request({
            hostname: "localhost",
            port,
            path: reqPath,
            method,
            headers: payload
                ? {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body),
                }
                : undefined,
        }, (res) => {
            let raw = "";
            res.on("data", (chunk) => {
                raw += chunk;
            });
            res.on("end", () => {
                let parsed = null;
                try {
                    parsed = raw ? JSON.parse(raw) : null;
                } catch {
                    // ignore parse failure
                }
                resolve({
                    statusCode: res.statusCode || 0,
                    body: parsed,
                    raw,
                });
            });
        });

        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error("request timeout"));
        });

        req.on("error", (error) => {
            reject(error);
        });

        if (payload) {
            req.write(body);
        }
        req.end();
    });
};

process.stdin.on("data", (chunk) => {
    inputData += chunk;
});

process.stdin.on("end", async () => {
    try {
        const hookData = JSON.parse(inputData);
        const { session_id, tool_name, tool_input, cwd } = hookData;

        const lockPath = path.join(cwd, ".hey-claude", "server.lock");
        if (!fs.existsSync(lockPath)) {
            process.exit(0);
            return;
        }

        let port;
        try {
            const lockData = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
            port = lockData.port;
            process.kill(lockData.pid, 0);
        } catch {
            process.exit(0);
            return;
        }

        const payload = {
            sessionId: session_id,
            toolName: tool_name,
            toolInput: tool_input || {},
            origin,
            controllerPid,
        };

        // CLI 세션: 모니터링 이벤트만 전송하고 Claude 기본 다이얼로그 유지
        if (!isWebOrigin) {
            try {
                await requestJson({
                    port,
                    reqPath: "/api/hooks/permission-notify",
                    method: "POST",
                    payload,
                    timeoutMs: 5000,
                });
            } catch {
                // CLI 다이얼로그를 막지 않기 위해 에러 무시
            }
            process.exit(0);
            return;
        }

        // Web 세션: 권한 요청 등록 후 결정 폴링
        let requestId = null;
        let hasSubscribers = false;
        try {
            const registerRes = await requestJson({
                port,
                reqPath: "/api/hooks/permission-request",
                method: "POST",
                payload,
                timeoutMs: 10000,
            });
            if (registerRes.statusCode >= 400) {
                outputPermissionDecision("deny", "Permission request registration failed.");
                process.exit(0);
                return;
            }

            requestId = registerRes.body?.requestId || null;
            hasSubscribers = !!registerRes.body?.hasSubscribers;
        } catch {
            outputPermissionDecision("deny", "Failed to contact hey-claude server.");
            process.exit(0);
            return;
        }

        if (!requestId) {
            outputPermissionDecision("deny", "Invalid permission request id.");
            process.exit(0);
            return;
        }

        if (!hasSubscribers) {
            outputPermissionDecision("deny", "No web subscriber available for permission approval.");
            process.exit(0);
            return;
        }

        const pollIntervalMs = 1000;
        const maxWaitMs = 3 * 60 * 1000; // 3분
        const startedAt = Date.now();

        while (Date.now() - startedAt < maxWaitMs) {
            try {
                const pollRes = await requestJson({
                    port,
                    reqPath: `/api/hooks/permission-poll?requestId=${encodeURIComponent(requestId)}`,
                    method: "GET",
                    timeoutMs: 10000,
                });

                if (pollRes.statusCode >= 400) {
                    outputPermissionDecision("deny", "Permission poll failed.");
                    process.exit(0);
                    return;
                }

                const pollBody = pollRes.body || {};
                if (pollBody.decided === true) {
                    if (pollBody.behavior === "allow") {
                        outputPermissionDecision("allow");
                    } else {
                        outputPermissionDecision("deny", "Denied in hey-claude web UI.");
                    }
                    process.exit(0);
                    return;
                }
            } catch {
                outputPermissionDecision("deny", "Permission poll request failed.");
                process.exit(0);
                return;
            }

            await delay(pollIntervalMs);
        }

        outputPermissionDecision("deny", "Permission request timed out.");
        process.exit(0);
    } catch {
        if (isWebOrigin) {
            outputPermissionDecision("deny", "Permission hook failed.");
        }
        process.exit(0);
    }
});
