#!/usr/bin/env node

/**
 * Stop Hook - 세션 완료 처리
 * Claude Code 세션 종료 시 hey-claude 서버로 전송
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
        const { session_id, cwd } = hookData;

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
                // 서버 죽음 - 무시
                process.exit(0);
                return;
            }
        } else {
            // lock 파일 없음 - 서버 없음
            process.exit(0);
            return;
        }

        // hey-claude 서버로 전송
        const payload = JSON.stringify({
            sessionId: session_id,
            projectPath: cwd,
        });

        const options = {
            hostname: 'localhost',
            port: port,
            path: '/api/hooks/stop',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
        };

        const req = http.request(options, (res) => {
            process.exit(0);
        });

        req.on('error', () => {
            process.exit(0);
        });

        req.write(payload);
        req.end();
    } catch (error) {
        process.exit(0);
    }
});
