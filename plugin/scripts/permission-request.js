#!/usr/bin/env node

/**
 * PermissionRequest Hook - 권한 요청 알림
 * Claude Code가 권한 요청 프롬프트를 표시할 때 hey-claude 서버로 전달
 * CLI 다이얼로그는 그대로 표시되고, Web UI에서는 모니터링만 가능
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

        if (!fs.existsSync(lockPath)) {
            // 서버 없음 - 빈 응답 (CLI가 자체 다이얼로그 표시)
            process.exit(0);
        }

        let port;
        try {
            const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
            port = lockData.port;

            // PID 검증
            process.kill(lockData.pid, 0);
        } catch {
            // 서버 죽음 - 빈 응답 (CLI가 자체 다이얼로그 표시)
            process.exit(0);
        }

        // 서버에 권한 요청 알림 (fire-and-forget, 응답 기다리지 않음)
        const payload = JSON.stringify({
            sessionId: session_id,
            toolName: tool_name,
            toolInput: tool_input || {},
        });

        const req = http.request({
            hostname: 'localhost',
            port: port,
            path: '/api/hooks/permission-notify',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
        });

        req.on('error', () => {
            // 에러 무시 - CLI 다이얼로그는 정상 표시
        });

        req.write(payload);
        req.end();

        // 빈 응답으로 종료 → CLI가 자체 다이얼로그 표시
        process.exit(0);
    } catch (error) {
        // 에러 발생해도 빈 응답 → CLI 다이얼로그 표시
        process.exit(0);
    }
});
