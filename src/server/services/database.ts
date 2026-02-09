import Database from "better-sqlite3";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, renameSync } from "fs";

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

    // 기존 snippets.json 마이그레이션
    migrateSnippetsFromJson(db, projectPath);

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
            source TEXT DEFAULT 'web',
            status TEXT DEFAULT 'active',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_updated
            ON sessions(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sessions_claude_session
            ON sessions(claude_session_id);
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

    // sequence 컬럼 추가 (마이그레이션) - 메시지 순서 보장용
    try {
        database.exec(`ALTER TABLE messages ADD COLUMN sequence INTEGER`);
        console.log("[DATABASE] Added sequence column to messages table");

        // 기존 메시지에 sequence 값 부여 (timestamp 순서대로)
        database.exec(`
            UPDATE messages
            SET sequence = (
                SELECT COUNT(*)
                FROM messages m2
                WHERE m2.session_id = messages.session_id
                AND (m2.timestamp < messages.timestamp
                     OR (m2.timestamp = messages.timestamp AND m2.id < messages.id))
            ) + 1
        `);
        console.log("[DATABASE] Assigned sequence values to existing messages");
    } catch (error) {
        // 컬럼이 이미 존재하면 오류 무시
        if (!(error instanceof Error && error.message.includes("duplicate column name"))) {
            console.error("[DATABASE] Error adding sequence column:", error);
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

    // snippets 테이블
    database.exec(`
        CREATE TABLE IF NOT EXISTS snippets (
            id TEXT PRIMARY KEY,
            trigger TEXT NOT NULL,
            name TEXT NOT NULL,
            content TEXT NOT NULL,
            category TEXT DEFAULT 'general',
            usage_count INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_snippets_trigger
            ON snippets(trigger);
    `);

    // commands 테이블
    database.exec(`
        CREATE TABLE IF NOT EXISTS commands (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            trigger TEXT NOT NULL,
            description TEXT,
            source TEXT NOT NULL,
            allowed_tools TEXT,
            updated_at TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_commands_name
            ON commands(name);
    `);
};

const migrateSnippetsFromJson = (database: Database.Database, projectPath: string): void => {
    const snippetsJsonPath = join(projectPath, ".hey-claude", "snippets.json");
    const snippetsBackupPath = join(projectPath, ".hey-claude", ".snippets.json.bak");

    // snippets.json 파일이 없으면 스킵
    if (!existsSync(snippetsJsonPath)) {
        return;
    }

    try {
        // 이미 마이그레이션된 적이 있는지 확인 (DB에 레코드가 있는지)
        const existingCount = database.prepare("SELECT COUNT(*) as count FROM snippets").get() as { count: number };

        if (existingCount.count > 0) {
            // 이미 마이그레이션됨 - 파일만 백업으로 이동
            if (!existsSync(snippetsBackupPath)) {
                renameSync(snippetsJsonPath, snippetsBackupPath);
                console.log("[DATABASE] Existing snippets.json backed up to .snippets.json.bak");
            }
            return;
        }

        // JSON 파일 읽기
        const fileContent = readFileSync(snippetsJsonPath, "utf-8");
        const data = JSON.parse(fileContent) as { version?: number; snippets?: Array<{
            id: string;
            trigger: string;
            name: string;
            content: string;
            category?: string;
            usageCount?: number;
            createdAt: string;
            updatedAt: string;
        }> };

        const snippets = data.snippets || [];

        if (snippets.length === 0) {
            // 빈 파일이면 백업만 하고 종료
            renameSync(snippetsJsonPath, snippetsBackupPath);
            console.log("[DATABASE] Empty snippets.json backed up");
            return;
        }

        // DB에 삽입
        const insertStmt = database.prepare(`
            INSERT INTO snippets (id, trigger, name, content, category, usage_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertMany = database.transaction((snippetsToInsert: typeof snippets) => {
            for (const snippet of snippetsToInsert) {
                insertStmt.run(
                    snippet.id,
                    snippet.trigger,
                    snippet.name,
                    snippet.content,
                    snippet.category || "general",
                    snippet.usageCount || 0,
                    snippet.createdAt,
                    snippet.updatedAt
                );
            }
        });

        insertMany(snippets);

        // 마이그레이션 성공 - 파일을 백업으로 이동
        renameSync(snippetsJsonPath, snippetsBackupPath);
        console.log(`[DATABASE] Migrated ${snippets.length} snippets from snippets.json to database`);
    } catch (error) {
        console.error("[DATABASE] Failed to migrate snippets.json:", error);
        // 마이그레이션 실패 시 원본 파일 유지
    }
};

export const closeDatabase = (): void => {
    if (db) {
        db.close();
        db = null;
    }
};
