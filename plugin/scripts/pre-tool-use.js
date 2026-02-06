#!/usr/bin/env node

/**
 * PreToolUse Hook - AskUserQuestion 감지 및 전송
 * AskUserQuestion 도구 사용 전에 hey-claude 서버로 질문 정보 전송
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

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
        const child = spawn('npx', ['hey-claude', '--no-open'], {
            cwd,
            detached: true,
            stdio: 'ignore',
            shell: true,
        });

        child.unref();

        const lockPath = path.join(cwd, '.hey-claude', 'server.lock');
        const maxWait = 10000;
        const pollInterval = 100;
        let waited = 0;

        while (waited < maxWait) {
            await new Promise((resolve) => setTimeout(resolve, pollInterval));
            waited += pollInterval;

            if (fs.existsSync(lockPath)) {
                try {
                    const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
                    process.kill(lockData.pid, 0);
                    return true;
                } catch {
                    continue;
                }
            }
        }

        return false;
    } catch (error) {
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

    if (fs.existsSync(lockPath)) {
        try {
            const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));

            try {
                process.kill(lockData.pid, 0);
                return lockData.port;
            } catch {
                const started = await tryAutoStart(cwd);
                if (started) {
                    const newLock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
                    return newLock.port;
                }
                return null;
            }
        } catch {
            return null;
        }
    }

    const started = await tryAutoStart(cwd);
    if (started) {
        const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
        return lockData.port;
    }

    return null;
}

/**
 * config.json 확인 후 서버 자동 시작 시도
 */
async function tryAutoStart(cwd) {
    const configPath = path.join(cwd, '.hey-claude', 'config.json');

    if (!fs.existsSync(configPath)) {
        return false;
    }

    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

        if (config.server && config.server.autoStart === false) {
            return false;
        }

        return await startServer(cwd);
    } catch {
        return false;
    }
}

function outputSuccess() {
    console.log(
        JSON.stringify({
            continue: true,
            suppressOutput: false,
        })
    );
}

process.stdin.on('end', async () => {
    try {
        const hookData = JSON.parse(inputData);
        const { session_id, cwd, tool_name, tool_input, tool_use_id } = hookData;

        // AskUserQuestion만 처리
        if (tool_name !== 'AskUserQuestion') {
            outputSuccess();
            return;
        }

        if (!cwd) {
            outputSuccess();
            return;
        }

        const port = await getServerPort(cwd);

        if (!port) {
            outputSuccess();
            return;
        }

        const payload = JSON.stringify({
            type: 'pre',
            sessionId: session_id,
            projectPath: cwd,
            toolUseId: tool_use_id,
            toolName: tool_name,
            toolInput: tool_input,
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

        const req = http.request(options, () => {
            outputSuccess();
        });

        req.on('error', () => {
            outputSuccess();
        });

        req.write(payload);
        req.end();
    } catch (error) {
        outputSuccess();
    }
});
