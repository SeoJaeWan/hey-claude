#!/usr/bin/env node

/**
 * hey-claude CLI 진입점
 *
 * Usage:
 *   hey-claude              # 서버 시작 + 브라우저 열기
 *   hey-claude --no-open    # 서버만 시작 (브라우저 안 열기)
 *   hey-claude --help       # 도움말
 *   hey-claude --version    # 버전 정보
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { platform } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const noOpen = args.includes('--no-open');
const showHelp = args.includes('--help') || args.includes('-h');
const showVersion = args.includes('--version') || args.includes('-v');

const DEFAULT_PORT = 7777;
const LOCK_FILE = join(process.cwd(), '.hey-claude', 'server.lock');

// 도움말
if (showHelp) {
    console.log(`
hey-claude - Claude Code를 위한 웹 기반 프롬프트 관리 도구

Usage:
  hey-claude              서버 시작 + 브라우저 열기
  hey-claude --no-open    서버만 시작 (브라우저 안 열기)
  hey-claude --help       도움말 표시
  hey-claude --version    버전 정보 표시

Options:
  --no-open               브라우저 자동 열기 비활성화
  -h, --help              도움말 표시
  -v, --version           버전 정보 표시
    `);
    process.exit(0);
}

// 버전 정보
if (showVersion) {
    const packageJson = JSON.parse(
        readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
    );
    console.log(`v${packageJson.version}`);
    process.exit(0);
}

// Lock 파일 확인
const checkLockFile = () => {
    if (!existsSync(LOCK_FILE)) {
        return null;
    }

    try {
        const lock = JSON.parse(readFileSync(LOCK_FILE, 'utf-8'));

        // PID가 살아있는지 확인
        try {
            process.kill(lock.pid, 0);
            return lock; // 살아있음
        } catch (err) {
            // 죽어있음 - lock 파일 삭제
            unlinkSync(LOCK_FILE);
            return null;
        }
    } catch (err) {
        // 파일 읽기 실패 - 삭제
        unlinkSync(LOCK_FILE);
        return null;
    }
};

// 브라우저 열기
const openBrowser = (port) => {
    const url = `http://localhost:${port}`;
    const cmd = platform() === 'win32' ? 'start' :
                platform() === 'darwin' ? 'open' : 'xdg-open';

    spawn(cmd, [url], { stdio: 'ignore', detached: true });
    console.log(`Browser opened at ${url}`);
};

// 메인 실행
const main = () => {
    // Lock 파일 확인
    const existingLock = checkLockFile();

    if (existingLock) {
        console.log(`Server is already running on port ${existingLock.port} (PID: ${existingLock.pid})`);

        if (!noOpen) {
            openBrowser(existingLock.port);
        } else {
            console.log(`Access at http://localhost:${existingLock.port}`);
        }

        process.exit(0);
    }

    // 서버 시작
    console.log('Starting hey-claude server...');

    const serverPath = join(__dirname, '..', 'dist', 'server', 'index.js');

    if (!existsSync(serverPath)) {
        console.error('Error: Server build not found. Please run "npm run build" first.');
        process.exit(1);
    }

    const server = spawn('node', [serverPath], {
        stdio: 'inherit',
        env: {
            ...process.env,
            HEY_CLAUDE_NO_OPEN: noOpen ? '1' : '0',
        },
    });

    server.on('error', (err) => {
        console.error('Failed to start server:', err);
        process.exit(1);
    });

    server.on('exit', (code) => {
        console.log(`Server exited with code ${code}`);
        process.exit(code);
    });

    // 종료 시 정리
    process.on('SIGINT', () => {
        console.log('\nShutting down server...');
        server.kill('SIGINT');
    });

    process.on('SIGTERM', () => {
        server.kill('SIGTERM');
    });
};

main();
