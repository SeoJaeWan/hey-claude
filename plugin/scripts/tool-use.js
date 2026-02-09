#!/usr/bin/env node

/**
 * PostToolUse Hook - 도구 사용 내역 수집
 * Claude Code에서 도구 사용 시 hey-claude 서버로 전송
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// stdin으로 받은 JSON 데이터 읽기
let inputData = '';

process.stdin.on('data', (chunk) => {
    inputData += chunk;
});

/**
 * server.lock 파일에서 포트 읽기
 * SessionStart hook이 서버 자동시작을 담당하므로 여기서는 단순히 포트만 확인
 * @param {string} cwd - 프로젝트 경로
 * @returns {number|null} - 포트 번호 (실패시 null)
 */
function getServerPort(cwd) {
    const lockPath = path.join(cwd, '.hey-claude', 'server.lock');

    if (!fs.existsSync(lockPath)) {
        return null;
    }

    try {
        const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));

        // PID 검증 (프로세스가 살아있는지)
        try {
            process.kill(lockData.pid, 0);
            return lockData.port;
        } catch {
            // 프로세스가 죽었으면 null 반환
            return null;
        }
    } catch {
        // lock 파일 파싱 실패
        return null;
    }
}

process.stdin.on('end', () => {
    try {
        const hookData = JSON.parse(inputData);
        const { session_id, cwd, tool_name, tool_input, tool_response } = hookData;

        // 서버 포트 확인 (SessionStart hook이 서버 시작을 담당)
        const port = getServerPort(cwd);

        if (!port) {
            // 서버가 실행 중이지 않음 - 조용히 종료
            outputSuccess();
            return;
        }

        // hey-claude 서버로 전송
        const payload = JSON.stringify({
            sessionId: session_id,
            projectPath: cwd,
            toolName: tool_name,
            toolInput: tool_input,
            toolOutput: tool_response,
        });

        const options = {
            hostname: 'localhost',
            port: port,
            path: '/api/hooks/tool-use',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
        };

        const req = http.request(options, (res) => {
            // 응답 무시, 성공으로 처리
            outputSuccess();
        });

        req.on('error', () => {
            // 에러 무시, Hook이 Claude Code 실행을 막지 않도록
            outputSuccess();
        });

        req.write(payload);
        req.end();
    } catch (error) {
        // 에러 발생해도 성공 처리 (Hook 차단 방지)
        outputSuccess();
    }
});

function outputSuccess() {
    console.log(
        JSON.stringify({
            continue: true,
            suppressOutput: true,
        })
    );
}
