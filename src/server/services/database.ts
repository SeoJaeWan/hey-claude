import Database from "better-sqlite3";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

let db: Database.Database | null = null;

export const initDatabase = (projectPath: string): Database.Database => {
    const heyClaudePath = join(projectPath, ".hey-claude");

    // .hey-claude 폴더 생성
    if (!existsSync(heyClaudePath)) {
        mkdirSync(heyClaudePath, { recursive: true });
    }

    const dbPath = join(heyClaudePath, "data.db");
    db = new Database(dbPath);

    // WAL 모드 활성화 (성능 및 안정성)
    db.pragma("journal_mode = WAL");

    // 테이블 생성
    createTables(db);

    return db;
};

export const getDatabase = (): Database.Database => {
    if (!db) {
        throw new Error("Database not initialized. Call initDatabase first.");
    }
    return db;
};

const createTables = (database: Database.Database): void => {
    // sessions 테이블
    database.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            claude_session_id TEXT,
            model TEXT,
            name TEXT,
            project_path TEXT,
            source TEXT DEFAULT 'web',
            status TEXT DEFAULT 'active',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_project
            ON sessions(project_path);
        CREATE INDEX IF NOT EXISTS idx_sessions_updated
            ON sessions(updated_at DESC);
    `);

    // messages 테이블
    database.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            images TEXT,
            changes TEXT,
            timestamp TEXT NOT NULL,
            question_submitted INTEGER DEFAULT 0,
            question_data TEXT,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_messages_session
            ON messages(session_id);
    `);

    // 기존 테이블에 question_submitted 컬럼 추가 (마이그레이션)
    try {
        database.exec(`ALTER TABLE messages ADD COLUMN question_submitted INTEGER DEFAULT 0`);
        console.log("[DATABASE] Added question_submitted column to messages table");
    } catch (error) {
        // 컬럼이 이미 존재하면 오류 무시
        if (!(error instanceof Error && error.message.includes("duplicate column name"))) {
            console.error("[DATABASE] Error adding question_submitted column:", error);
        }
    }

    // question_data 컬럼 추가 (마이그레이션)
    try {
        database.exec(`ALTER TABLE messages ADD COLUMN question_data TEXT`);
        console.log("[DATABASE] Added question_data column to messages table");
    } catch (error) {
        // 컬럼이 이미 존재하면 오류 무시
        if (!(error instanceof Error && error.message.includes("duplicate column name"))) {
            console.error("[DATABASE] Error adding question_data column:", error);
        }
    }

    // tool_usages 테이블
    database.exec(`
        CREATE TABLE IF NOT EXISTS tool_usages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            tool_name TEXT NOT NULL,
            tool_input TEXT,
            tool_output TEXT,
            compressed_type TEXT,
            compressed_title TEXT,
            compressed_content TEXT,
            compressed_at TEXT,
            timestamp TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_tool_usages_session
            ON tool_usages(session_id);
        CREATE INDEX IF NOT EXISTS idx_tool_usages_timestamp
            ON tool_usages(timestamp DESC);
    `);

    // context_summaries 테이블
    database.exec(`
        CREATE TABLE IF NOT EXISTS context_summaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL UNIQUE,
            content TEXT NOT NULL,
            last_message_id TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
    `);

    // commands 테이블 (명령어 캐시)
    database.exec(`
        CREATE TABLE IF NOT EXISTS commands (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_path TEXT NOT NULL,
            name TEXT NOT NULL,
            trigger TEXT NOT NULL,
            description TEXT,
            source TEXT NOT NULL,
            allowed_tools TEXT,
            updated_at TEXT NOT NULL,
            UNIQUE(project_path, name)
        );

        CREATE INDEX IF NOT EXISTS idx_commands_project
            ON commands(project_path);
    `);
};

export const closeDatabase = (): void => {
    if (db) {
        db.close();
        db = null;
    }
};
