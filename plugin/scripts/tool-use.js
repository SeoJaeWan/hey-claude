#!/usr/bin/env node

/**
 * PostToolUse Hook - 도구 사용 내역 수집
 * Claude Code에서 도구 사용 시 hey-claude 서버로 전송
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

// stdin으로 받은 JSON 데이터 읽기
let inputData = '';

process.stdin.on('data', (chunk) => {
    inputData += chunk;
});

/**
 * hey-claude 서버 자동 시작
 * @param {string} cwd - 프로젝트 경로
 * @returns {Promise<boolean>} - 서버 시작 성공 여부
 */
async function startServer(cwd) {
    try {
        // hey-claude CLI 실행 (백그라운드)
        const child = spawn('npx', ['hey-claude', '--no-open'], {
            cwd,
            detached: true,
            stdio: 'ignore',
            shell: true, // Windows 호환성
        });

        // 부모 프로세스와 분리 (백그라운드 실행)
        child.unref();

        // lock 파일 생성 대기 (최대 10초)
        const lockPath = path.join(cwd, '.hey-claude', 'server.lock');
        const maxWait = 10000; // 10초
        const pollInterval = 100; // 100ms
        let waited = 0;

        while (waited < maxWait) {
            await new Promise((resolve) => setTimeout(resolve, pollInterval));
            waited += pollInterval;

            if (fs.existsSync(lockPath)) {
                // lock 파일 생성됨 - PID 검증
                try {
                    const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
                    process.kill(lockData.pid, 0);
                    console.log('[hey-claude] Server started successfully');
                    return true;
                } catch {
                    // PID 검증 실패 - 계속 대기
                    continue;
                }
            }
        }

        console.error('[hey-claude] Server start timeout');
        return false;
    } catch (error) {
        console.error('[hey-claude] Failed to start server:', error.message);
        return false;
    }
}

/**
 * 서버 포트 가져오기 (서버 시작 포함)
 * @param {string} cwd - 프로젝트 경로
 * @returns {Promise<number|null>} - 포트 번호 (실패시 null)
 */
async function getServerPort(cwd) {
    const lockPath = path.join(cwd, '.hey-claude', 'server.lock');

    // 1. lock 파일 존재
    if (fs.existsSync(lockPath)) {
        try {
            const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));

            // PID 검증 (프로세스가 살아있는지)
            try {
                process.kill(lockData.pid, 0);
                return lockData.port; // 서버 실행 중
            } catch {
                // 프로세스 죽음 - 자동 시작 시도
                const started = await tryAutoStart(cwd);
                if (started) {
                    const newLock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
                    return newLock.port;
                }
                return null;
            }
        } catch {
            // lock 파일 파싱 실패
            return null;
        }
    }

    // 2. lock 파일 없음 - 자동 시작 시도
    const started = await tryAutoStart(cwd);
    if (started) {
        const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
        return lockData.port;
    }

    return null;
}

/**
 * config.json 확인 후 서버 자동 시작 시도
 * @param {string} cwd - 프로젝트 경로
 * @returns {Promise<boolean>} - 시작 성공 여부
 */
async function tryAutoStart(cwd) {
    const configPath = path.join(cwd, '.hey-claude', 'config.json');

    if (!fs.existsSync(configPath)) {
        return false;
    }

    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

        // autoStart 설정 확인 (기본값: true)
        if (config.server && config.server.autoStart === false) {
            return false;
        }

        return await startServer(cwd);
    } catch {
        return false;
    }
}

process.stdin.on('end', async () => {
    try {
        const hookData = JSON.parse(inputData);
        const { session_id, cwd, tool_name, tool_input, tool_response } = hookData;

        // 서버 포트 확인 (필요시 자동 시작)
        const port = await getServerPort(cwd);

        if (!port) {
            // 서버 시작 실패 - 무시하고 종료
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
