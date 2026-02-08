#!/usr/bin/env node

/**
 * PermissionRequest Hook - 권한 요청 처리
 * Claude Code가 권한 요청 프롬프트를 표시할 때 hey-claude 서버로 전달하고 사용자 결정을 대기
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

let inputData = '';

process.stdin.on('data', (chunk) => {
    inputData += chunk;
});

process.stdin.on('end', async () => {
    try {
        const hookData = JSON.parse(inputData);
        const { session_id, tool_name, tool_input, cwd } = hookData;

        // server.lock 파일에서 포트 확인
        const lockPath = path.join(cwd, '.hey-claude', 'server.lock');
        let port = 7777;

        if (fs.existsSync(lockPath)) {
            const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
            port = lockData.port;

            // PID 검증
            try {
                process.kill(lockData.pid, 0);
            } catch {
                // 서버 죽음 - deny로 처리
                outputDecision('deny');
                return;
            }
        } else {
            // lock 파일 없음 - deny로 처리
            outputDecision('deny');
            return;
        }

        // 1. 권한 요청 등록
        const registerPayload = JSON.stringify({
            sessionId: session_id,
            toolName: tool_name,
            toolInput: tool_input || {},
        });

        let requestId;
        try {
            requestId = await makeRequest(port, '/api/hooks/permission-request', 'POST', registerPayload);
        } catch (error) {
            // 등록 실패 - deny로 처리
            outputDecision('deny');
            return;
        }

        // 2. 폴링 루프 (120초 타임아웃)
        const startTime = Date.now();
        const timeout = 120000; // 120 seconds
        const pollInterval = 200; // 200ms

        while (Date.now() - startTime < timeout) {
            try {
                const result = await makeRequest(port, `/api/hooks/permission-poll?requestId=${requestId}`, 'GET');

                if (result.decided) {
                    // 사용자가 결정함
                    outputDecision(result.behavior || 'deny');
                    return;
                }

                // 아직 결정 안 됨 - 대기
                await sleep(pollInterval);
            } catch (error) {
                // 폴링 실패 - deny로 처리
                outputDecision('deny');
                return;
            }
        }

        // 타임아웃 - deny로 처리
        outputDecision('deny');
    } catch (error) {
        outputDecision('deny');
    }
});

/**
 * HTTP 요청 헬퍼
 */
function makeRequest(port, path, method, body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: port,
            path: path,
            method: method,
            headers: body ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            } : {},
        };

        const req = http.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed);
                } catch {
                    reject(new Error('Invalid JSON response'));
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        if (body) {
            req.write(body);
        }
        req.end();
    });
}

/**
 * Sleep 헬퍼
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 결정 출력 및 종료
 */
function outputDecision(behavior) {
    const output = JSON.stringify({
        hookSpecificOutput: {
            hookEventName: "PermissionRequest",
            decision: {
                behavior: behavior
            }
        }
    });
    console.log(output);
    process.exit(0);
}
