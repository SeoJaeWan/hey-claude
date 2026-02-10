import { Router, type Router as RouterType } from "express";
import { getDatabase } from "../services/database.js";
import { randomUUID } from "crypto";

import sseManager from "../services/sseManager.js";
import { buildMessageFromToolUse } from "../services/messageBuilder.js";
import { getNewAssistantTexts } from "../services/transcriptParser.js";
import sessionStatusManager from "../services/sessionStatusManager.js";
import claudeProcessManager from "../services/claudeProcessManager.js";
import { homedir } from "os";
import { join } from "path";
import { existsSync } from "fs";

const router: RouterType = Router();

// 세션별 다음 sequence 번호 가져오기
const getNextSequence = (sessionId: string): number => {
    const db = getDatabase();
    const result = db.prepare(`
        SELECT COALESCE(MAX(sequence), 0) + 1 as next_seq
        FROM messages
        WHERE session_id = ?
    `).get(sessionId) as { next_seq: number };
    return result.next_seq;
};

// Session mapping cache: claudeSessionId → internalSessionId
const sessionMappingCache = new Map<string, string>();

// Permission request store: requestId → PendingPermission
export interface PendingPermission {
    requestId: string;
    sessionId: string;
    toolName: string;
    toolInput: any;
    decided: boolean;
    behavior?: "allow" | "deny";
    createdAt: number;
}
export const pendingPermissions = new Map<string, PendingPermission>();

type SessionSource = "terminal" | "web";

interface TerminalSessionController {
    claudeSessionId: string;
    controllerPid: number;
    updatedAt: number;
}

// 내부 세션 ID → CLI 프로세스 제어 정보
const terminalSessionControllers = new Map<string, TerminalSessionController>();

const parseHookSource = (value: unknown): SessionSource | null => {
    return value === "web" || value === "terminal" ? value : null;
};

const parseControllerPid = (value: unknown): number | undefined => {
    const pid = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(pid) || pid <= 0) return undefined;
    return Math.trunc(pid);
};

const registerTerminalController = (sessionId: string, claudeSessionId: string, controllerPid?: number): void => {
    if (!controllerPid) return;

    const now = Date.now();
    const staleMs = 24 * 60 * 60 * 1000;

    // 오래된 엔트리 정리
    for (const [sid, controller] of terminalSessionControllers.entries()) {
        if (now - controller.updatedAt > staleMs) {
            terminalSessionControllers.delete(sid);
        }
    }

    terminalSessionControllers.set(sessionId, {
        claudeSessionId,
        controllerPid,
        updatedAt: now,
    });
};

const resolveSessionSource = (
    explicitSource: SessionSource | null,
    fallbackSource?: string
): SessionSource => {
    if (explicitSource) return explicitSource;
    if (fallbackSource === "web" || fallbackSource === "terminal") return fallbackSource;
    return "terminal";
};

export const getTerminalControllerPid = (sessionId: string): number | undefined => {
    return terminalSessionControllers.get(sessionId)?.controllerPid;
};

interface SessionTranscriptCursorRow {
    last_processed_uuid?: string | null;
    last_read_offset?: number | null;
}

const getSessionTranscriptCursor = (sessionId: string): { lastUuid?: string; lastOffset: number } => {
    const memoryUuid = sessionStatusManager.getLastProcessedUuid(sessionId);
    const memoryOffset = sessionStatusManager.getLastReadOffset(sessionId);

    if (memoryUuid || memoryOffset > 0) {
        return {
            lastUuid: memoryUuid,
            lastOffset: memoryOffset,
        };
    }

    const db = getDatabase();
    const row = db.prepare(`
        SELECT last_processed_uuid, COALESCE(last_read_offset, 0) as last_read_offset
        FROM sessions
        WHERE id = ?
    `).get(sessionId) as SessionTranscriptCursorRow | undefined;

    return {
        lastUuid: row?.last_processed_uuid || undefined,
        lastOffset: typeof row?.last_read_offset === "number" ? row.last_read_offset : 0,
    };
};

const persistSessionTranscriptCursor = (
    sessionId: string,
    lastUuid: string | undefined,
    lastOffset: number
): void => {
    const db = getDatabase();
    db.prepare(`
        UPDATE sessions
        SET last_processed_uuid = ?, last_read_offset = ?
        WHERE id = ?
    `).run(lastUuid || null, lastOffset, sessionId);

    sessionStatusManager.setLastReadOffset(sessionId, lastOffset);
    if (lastUuid) {
        sessionStatusManager.setLastProcessedUuid(sessionId, lastUuid);
    }
};

/**
 * Claude transcript 파일 경로 구성
 * Claude는 ~/.claude/projects/{project-hash}/{session-id}.jsonl 에 transcript 저장
 * project-hash: 프로젝트 경로에서 : → -, / 또는 \ → - 로 변환
 */
const findTranscriptPath = (claudeSessionId: string): string | null => {
    const projectPath = process.cwd();

    // 프로젝트 경로를 Claude의 해시 형식으로 변환
    // C:\Users\sjw73\Desktop\dev\hey-claude → C--Users-sjw73-Desktop-dev-hey-claude
    const projectHash = projectPath.replace(/:/g, '-').replace(/[/\\]/g, '-');
    const transcriptPath = join(homedir(), '.claude', 'projects', projectHash, `${claudeSessionId}.jsonl`);

    if (existsSync(transcriptPath)) {
        console.log(`[HOOKS] Found transcript at: ${transcriptPath}`);
        return transcriptPath;
    }

    console.log(`[HOOKS] Transcript not found at: ${transcriptPath}`);
    return null;
};

/**
 * Claude 세션 ID → 내부 세션 ID 변환
 * 1. claude_session_id로 직접 조회
 * 2. 없으면 현재 streaming 상태이면서 claude_session_id가 NULL인 세션에 연결
 */
const resolveInternalSession = (claudeSessionId: string): { id: string } | undefined => {
    // 1. 캐시 확인
    const cached = sessionMappingCache.get(claudeSessionId);
    if (cached) {
        return { id: cached };
    }

    const db = getDatabase();

    // 2. DB에서 조회 (type과 status도 필터링)
    const direct = db.prepare(`
        SELECT id FROM sessions
        WHERE claude_session_id = ?
          AND type = 'claude-code'
          AND status = 'active'
        ORDER BY updated_at DESC
        LIMIT 1
    `).get(claudeSessionId) as { id: string } | undefined;
    if (direct) {
        sessionMappingCache.set(claudeSessionId, direct.id);
        return direct;
    }

    // 3. 미연결 세션 찾기
    const unlinked = db.prepare(`
        SELECT id FROM sessions
        WHERE claude_session_id IS NULL
          AND type = 'claude-code'
          AND status = 'active'
        ORDER BY created_at DESC
        LIMIT 1
    `).get() as { id: string } | undefined;

    if (unlinked) {
        db.prepare("UPDATE sessions SET claude_session_id = ?, updated_at = ? WHERE id = ?")
            .run(claudeSessionId, new Date().toISOString(), unlinked.id);
        sessionMappingCache.set(claudeSessionId, unlinked.id);
        console.log(`[HOOKS] Linked claude_session_id ${claudeSessionId} → internal ${unlinked.id}`);
        return unlinked;
    }

    return undefined;
};

/**
 * AskUserQuestion 응답 파싱: tool_input의 options와 tool_response 문자열 매칭
 */
const parseQuestionAnswers = (toolInput: any, toolResponse: any) => {
    const questions = toolInput?.questions || [];
    const responseText = typeof toolResponse === 'string'
        ? toolResponse
        : JSON.stringify(toolResponse || '');

    return questions.map((q: any, idx: number) => {
        const selectedOptions: string[] = [];

        for (const opt of (q.options || [])) {
            if (responseText.includes(opt.label)) {
                selectedOptions.push(opt.label);
            }
        }

        // 매칭 안 되면 전체 응답을 "Other" 답변으로 처리
        if (selectedOptions.length === 0 && responseText.trim()) {
            selectedOptions.push(responseText.trim());
        }

        return { questionIndex: idx, question: q.question, selectedOptions };
    });
};

// POST /api/hooks/session - SessionStart Hook
interface SessionHookRequest {
    sessionId: string;
    source: 'startup' | 'resume' | 'clear' | 'compact';
    model: string;
    origin?: SessionSource;
    controllerPid?: number;
}

router.post("/session", async (req, res) => {
    try {
        const { sessionId, source, model, origin, controllerPid } = req.body as SessionHookRequest;
        const explicitSource = parseHookSource(origin);
        const runtimeControllerPid = parseControllerPid(controllerPid);

        console.log("[HOOKS] SessionStart received:", { sessionId, source, model, origin, controllerPid: runtimeControllerPid });

        if (!sessionId) {
            return res.json({ success: true });
        }

        const db = getDatabase();

        // 세션이 이미 존재하는지 확인
        const existingSession = db.prepare("SELECT id FROM sessions WHERE claude_session_id = ?").get(sessionId);

        if (existingSession) {
            const existing = existingSession as { id: string };
            const sourceToSave = resolveSessionSource(explicitSource, source === "resume" ? "terminal" : "web");
            // 기존 세션 업데이트
            db.prepare(`
                UPDATE sessions
                SET updated_at = ?, source = ?
                WHERE claude_session_id = ?
            `).run(new Date().toISOString(), sourceToSave, sessionId);

            if (sourceToSave === "terminal") {
                registerTerminalController(existing.id, sessionId, runtimeControllerPid);
            }

            console.log(`[HOOKS] SessionStart: Updated existing session ${sessionId}`);
        } else {
            // 미연결 세션 찾기 (웹 UI에서 먼저 생성된 세션)
            const unlinked = db.prepare(`
                SELECT id FROM sessions
                WHERE claude_session_id IS NULL
                  AND type = 'claude-code'
                  AND status = 'active'
                ORDER BY created_at DESC
                LIMIT 1
            `).get() as { id: string } | undefined;

            if (unlinked) {
                // 기존 미연결 세션에 claude_session_id 연결
                const now = new Date().toISOString();
                const sourceToSave = resolveSessionSource(explicitSource, source === "resume" ? "terminal" : "web");
                db.prepare(`
                    UPDATE sessions
                    SET claude_session_id = ?, model = ?, source = ?, updated_at = ?
                    WHERE id = ?
                `).run(sessionId, model || null, sourceToSave, now, unlinked.id);

                // 캐시에도 저장
                sessionMappingCache.set(sessionId, unlinked.id);
                if (sourceToSave === "terminal") {
                    registerTerminalController(unlinked.id, sessionId, runtimeControllerPid);
                }
                console.log(`[HOOKS] SessionStart: Linked claude_session_id ${sessionId} → existing session ${unlinked.id}`);
            } else {
                // 미연결 세션 없음 → 터미널에서 직접 시작된 세션
                const newSessionId = randomUUID();
                const now = new Date().toISOString();
                const sourceToSave = resolveSessionSource(explicitSource, source === "resume" ? "terminal" : "web");

                db.prepare(`
                    INSERT INTO sessions (id, type, claude_session_id, model, source, status, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    newSessionId,
                    "claude-code",
                    sessionId,
                    model || null,
                    sourceToSave,
                    "active",
                    now,
                    now
                );

                sessionMappingCache.set(sessionId, newSessionId);
                if (sourceToSave === "terminal") {
                    registerTerminalController(newSessionId, sessionId, runtimeControllerPid);
                }
                console.log(`[HOOKS] SessionStart: Created new session ${newSessionId} for claude_session_id ${sessionId}`);
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error("[HOOKS] SessionStart error:", error);
        res.json({ success: true }); // 에러가 발생해도 Claude Code를 막으면 안 됨
    }
});

// POST /api/hooks/tool-use - PreToolUse/PostToolUse Hook
interface ToolUseHookRequest {
    type: 'pre' | 'post';
    sessionId?: string;
    toolUseId?: string;
    toolName: string;
    toolInput: any;
    toolOutput?: any;  // post only
    origin?: SessionSource;
    controllerPid?: number;
}

router.post("/tool-use", async (req, res) => {
    try {
        // PreToolUse와 PostToolUse 모두 처리
        const { type, sessionId, toolUseId, toolName, toolInput, toolOutput, origin, controllerPid } = req.body as ToolUseHookRequest;
        const explicitSource = parseHookSource(origin);
        const runtimeControllerPid = parseControllerPid(controllerPid);

        // 기존 PostToolUse hook 형식 (session_id, tool_name 등)도 지원
        const claudeSessionId = sessionId || req.body.session_id;
        const tool_use_id = toolUseId || req.body.tool_use_id;  // tool_use_id 필드도 지원
        const tool_name = toolName || req.body.tool_name;
        const tool_input = toolInput || req.body.tool_input;
        const tool_response = toolOutput || req.body.tool_response;

        console.log("[HOOKS] ToolUse received:", { type, claudeSessionId, toolName: tool_name, toolUseId });

        if (!claudeSessionId || !tool_name) {
            return res.json({
                continue: true,
                suppressOutput: true,
            });
        }

        const db = getDatabase();

        // 세션 조회 (자동 매핑 포함)
        let session = resolveInternalSession(claudeSessionId);
        let internalSessionId: string;
        let sessionSource: SessionSource = "terminal"; // 기본값

        if (!session) {
            // 터미널에서 생성된 세션 - 새로 등록
            internalSessionId = randomUUID();
            const now = new Date().toISOString();
            sessionSource = resolveSessionSource(explicitSource, "terminal");

            db.prepare(`
                INSERT INTO sessions (id, type, claude_session_id, source, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(internalSessionId, "claude-code", claudeSessionId, sessionSource, "active", now, now);
        } else {
            internalSessionId = session.id;
            // 세션 source 조회
            const sessionData = db.prepare("SELECT source FROM sessions WHERE id = ?").get(internalSessionId) as { source: string } | undefined;
            sessionSource = resolveSessionSource(explicitSource, sessionData?.source);

            // 명시적 source가 들어오면 세션 source를 최신화
            if (explicitSource && sessionData?.source !== explicitSource) {
                db.prepare("UPDATE sessions SET source = ?, updated_at = ? WHERE id = ?")
                    .run(explicitSource, new Date().toISOString(), internalSessionId);
            }
        }

        if (sessionSource === "terminal") {
            registerTerminalController(internalSessionId, claudeSessionId, runtimeControllerPid);
        }

        // PreToolUse: AskUserQuestion 감지 시 DB 저장 + SSE로 프론트엔드에 전달
        if (type === 'pre' && tool_name === 'AskUserQuestion' && tool_input?.questions) {
            console.log("[HOOKS] AskUserQuestion detected, saving to DB and broadcasting via SSE");

            const questionMsgId = `question-${tool_use_id}`;
            const questionNow = new Date().toISOString();
            const questionSeq = getNextSequence(internalSessionId);
            const questionDataJson = JSON.stringify({
                tool_use_id: toolUseId,
                questions: tool_input.questions,
                source: sessionSource
            });

            // DB에 저장
            db.prepare(`
                INSERT INTO messages (id, session_id, role, content, timestamp, sequence, question_data, question_submitted)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(questionMsgId, internalSessionId, "assistant", "", questionNow, questionSeq, questionDataJson, 0);

            console.log(`[HOOKS] AskUserQuestion saved to DB: ${questionMsgId}`);

            // SSE 전송
            sseManager.broadcastToSession(internalSessionId, {
                type: "ask_user_question",
                sessionId: internalSessionId,
                toolUseId: tool_use_id,
                questions: tool_input.questions,
                source: sessionSource,
                sequence: questionSeq,
                createdAt: questionNow
            });
        }

        // PostToolUse: AskUserQuestion 완료 → DB 업데이트 + question_answered SSE
        if ((type === 'post' || !type) && tool_name === 'AskUserQuestion') {
            console.log("[HOOKS] AskUserQuestion PostToolUse: Updating DB and broadcasting answer via SSE, tool_use_id:", tool_use_id);

            const answers = parseQuestionAnswers(tool_input, tool_response);
            const questionMsgId = `question-${tool_use_id}`;

            // DB 업데이트: question_submitted = 1, question_answers 저장
            const updateResult = db.prepare(`
                UPDATE messages
                SET question_submitted = 1, question_answers = ?
                WHERE id = ?
            `).run(JSON.stringify(answers), questionMsgId);

            console.log(`[HOOKS] AskUserQuestion marked as submitted: ${questionMsgId}, changes: ${updateResult.changes}`);

            sseManager.broadcastToSession(internalSessionId, {
                type: "question_answered",
                sessionId: internalSessionId,
                answers
            });

            return res.json({ continue: true, suppressOutput: true });
        }

        // PostToolUse: 도구 사용 내역 저장
        if (type === 'post' || !type) {
            const now = new Date().toISOString();
            db.prepare(`
                INSERT INTO tool_usages (session_id, tool_name, tool_input, tool_output, timestamp)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                internalSessionId,
                tool_name,
                JSON.stringify(tool_input || {}),
                JSON.stringify(tool_response || {}),
                now
            );

            // 세션 업데이트 시간 갱신
            db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, internalSessionId);

            console.log(`[HOOKS] Tool use saved: ${tool_name} in session ${internalSessionId}`);

            // Convert tool usage to message format
            const messageContent = buildMessageFromToolUse({
                sessionId: internalSessionId,
                toolName: tool_name,
                toolInput: tool_input || {},
                toolOutput: tool_response || {}
            });

            // Save message to database
            const messageId = randomUUID();
            const seq = getNextSequence(internalSessionId);
            db.prepare(`
                INSERT INTO messages (id, session_id, role, content, timestamp, sequence)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(
                messageId,
                internalSessionId,
                messageContent.role,
                messageContent.content,
                now,
                seq
            );

            console.log(`[HOOKS] Message created from tool use: ${messageId}`);

            // Broadcast to frontend via SSE
            sseManager.broadcastToSession(internalSessionId, {
                type: "tool_use_message",
                sessionId: internalSessionId,
                message: {
                    id: messageId,
                    sessionId: internalSessionId,
                    role: messageContent.role,
                    content: messageContent.content,
                    toolUsages: messageContent.toolUsages,
                    createdAt: now,
                    sequence: seq
                }
            });

            console.log(`[HOOKS] SSE broadcast: tool_use_message for session ${internalSessionId}`);

            // transcript에서 중간 assistant 텍스트 캡처 (도구 사용 전 텍스트)
            try {
                const transcriptPath = findTranscriptPath(claudeSessionId);
                if (transcriptPath) {
                    const cursor = getSessionTranscriptCursor(internalSessionId);
                    const { results: newTexts, newOffset } = await getNewAssistantTexts(
                        transcriptPath,
                        cursor.lastUuid,
                        cursor.lastOffset
                    );
                    let latestUuid = cursor.lastUuid;

                    for (const { uuid, text } of newTexts) {
                        const assistantMsgId = randomUUID();
                        const assistantSeq = getNextSequence(internalSessionId);
                        const insertResult = db.prepare(`
                            INSERT OR IGNORE INTO messages (id, session_id, role, content, timestamp, sequence, transcript_uuid)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        `).run(assistantMsgId, internalSessionId, "assistant", text, now, assistantSeq, uuid);

                        if (insertResult.changes > 0) {
                            sseManager.broadcastToSession(internalSessionId, {
                                type: "assistant_message",
                                sessionId: internalSessionId,
                                message: {
                                    id: assistantMsgId,
                                    sessionId: internalSessionId,
                                    role: "assistant",
                                    content: text,
                                    createdAt: now,
                                    sequence: assistantSeq
                                }
                            });
                            console.log(`[HOOKS] Intermediate assistant text sent: ${text.substring(0, 80)} (uuid: ${uuid.substring(0, 8)})`);
                        } else {
                            console.log(`[HOOKS] Intermediate assistant text skipped (duplicate uuid: ${uuid.substring(0, 8)})`);
                        }

                        latestUuid = uuid;
                    }

                    persistSessionTranscriptCursor(internalSessionId, latestUuid, newOffset);
                }
            } catch (error) {
                console.error("[HOOKS] Intermediate text extraction failed:", error);
            }

        }

        res.json({
            continue: true,
            suppressOutput: true,
        });
    } catch (error) {
        console.error("[HOOKS] Tool use hook error:", error);
        res.json({
            continue: true,
            suppressOutput: true,
        });
    }
});

// POST /api/hooks/user-prompt - UserPromptSubmit Hook
router.post("/user-prompt", async (req, res) => {
    try {
        const { sessionId: claudeSessionId, prompt, origin, controllerPid } = req.body;
        const explicitSource = parseHookSource(origin);
        const runtimeControllerPid = parseControllerPid(controllerPid);
        console.log("[HOOKS] UserPromptSubmit received:", { claudeSessionId, promptLength: prompt?.length, origin, controllerPid: runtimeControllerPid });

        if (!claudeSessionId || !prompt) {
            return res.json({ success: true });
        }

        const db = getDatabase();

        // 세션 매핑 (resolveInternalSession 재사용)
        let session = resolveInternalSession(claudeSessionId);
        let internalSessionId: string;

        let sessionSource: SessionSource = "terminal";
        if (!session) {
            // 터미널 직접 시작 — 새 세션 생성
            internalSessionId = randomUUID();
            const now = new Date().toISOString();
            sessionSource = resolveSessionSource(explicitSource, "terminal");
            db.prepare(`
                INSERT INTO sessions (id, type, claude_session_id, source, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(internalSessionId, "claude-code", claudeSessionId, sessionSource, "active", now, now);
            sessionMappingCache.set(claudeSessionId, internalSessionId);
            console.log(`[HOOKS] UserPromptSubmit: Created new session ${internalSessionId} for claude ${claudeSessionId}`);
        } else {
            internalSessionId = session.id;
            const sessionData = db.prepare("SELECT source FROM sessions WHERE id = ?").get(internalSessionId) as { source: string } | undefined;
            sessionSource = resolveSessionSource(explicitSource, sessionData?.source);

            if (explicitSource && sessionData?.source !== explicitSource) {
                db.prepare("UPDATE sessions SET source = ?, updated_at = ? WHERE id = ?")
                    .run(explicitSource, new Date().toISOString(), internalSessionId);
            }
        }

        if (sessionSource === "terminal") {
            registerTerminalController(internalSessionId, claudeSessionId, runtimeControllerPid);
        }

        // 사용자 메시지 DB 저장
        const messageId = randomUUID();
        const now = new Date().toISOString();
        const userSeq = getNextSequence(internalSessionId);
        db.prepare(`INSERT INTO messages (id, session_id, role, content, timestamp, sequence) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(messageId, internalSessionId, "user", prompt, now, userSeq);

        console.log(`[HOOKS] UserPromptSubmit: User message saved: ${messageId}`);

        // 세션 상태 → streaming
        sessionStatusManager.setStatus(internalSessionId, "streaming");

        // 세션 updated_at 갱신
        db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, internalSessionId);

        // SSE broadcast: user_message
        sseManager.broadcastToSession(internalSessionId, {
            type: "user_message",
            sessionId: internalSessionId,
            message: {
                id: messageId,
                sessionId: internalSessionId,
                role: "user",
                content: prompt,
                createdAt: now,
                sequence: userSeq
            }
        });

        // SSE broadcast: loading_start
        sseManager.broadcastToSession(internalSessionId, {
            type: "loading_start",
            sessionId: internalSessionId
        });

        console.log(`[HOOKS] UserPromptSubmit: SSE broadcast complete for session ${internalSessionId}`);

        res.json({ success: true });
    } catch (error) {
        console.error("[HOOKS] UserPromptSubmit error:", error);
        res.json({ success: true }); // Never block Claude
    }
});

// POST /api/hooks/permission-notify - PermissionRequest hook (알림 전용, CLI 다이얼로그는 그대로 표시)
router.post("/permission-notify", async (req, res) => {
    try {
        const { sessionId: claudeSessionId, toolName, toolInput, origin, controllerPid } = req.body;
        const explicitSource = parseHookSource(origin);
        const runtimeControllerPid = parseControllerPid(controllerPid);
        console.log("[HOOKS] PermissionNotify received:", { claudeSessionId, toolName, origin, controllerPid: runtimeControllerPid });

        if (!claudeSessionId || !toolName) {
            return res.json({ success: true }); // 에러여도 빈 응답
        }

        const db = getDatabase();

        // 세션 조회 (자동 매핑 포함)
        let session = resolveInternalSession(claudeSessionId);
        let internalSessionId: string;
        let sessionSource: SessionSource = "terminal"; // 기본값

        if (!session) {
            // 터미널에서 생성된 세션 - 새로 등록
            internalSessionId = randomUUID();
            const now = new Date().toISOString();
            sessionSource = resolveSessionSource(explicitSource, "terminal");
            db.prepare(`
                INSERT INTO sessions (id, type, claude_session_id, source, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(internalSessionId, "claude-code", claudeSessionId, sessionSource, "active", now, now);
            sessionMappingCache.set(claudeSessionId, internalSessionId);
        } else {
            internalSessionId = session.id;
            // 세션 source 조회
            const sessionData = db.prepare("SELECT source FROM sessions WHERE id = ?").get(internalSessionId) as { source: string } | undefined;
            sessionSource = resolveSessionSource(explicitSource, sessionData?.source);

            if (explicitSource && sessionData?.source !== explicitSource) {
                db.prepare("UPDATE sessions SET source = ?, updated_at = ? WHERE id = ?")
                    .run(explicitSource, new Date().toISOString(), internalSessionId);
            }
        }

        if (sessionSource === "terminal") {
            registerTerminalController(internalSessionId, claudeSessionId, runtimeControllerPid);
        }

        // DB에 permission 메시지 저장 (requestId 없이 notify용 ID 생성)
        const notifyId = `notify-${randomUUID()}`;
        const permMsgId = `permission-${notifyId}`;
        const permNow = new Date().toISOString();
        const permSeq = getNextSequence(internalSessionId);
        const permissionDataJson = JSON.stringify({
            requestId: notifyId,
            toolName,
            toolInput: toolInput || {},
            decided: false,
            source: sessionSource
        });

        db.prepare(`
            INSERT INTO messages (id, session_id, role, content, timestamp, sequence, permission_data)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(permMsgId, internalSessionId, "assistant", "", permNow, permSeq, permissionDataJson);

        // SSE로 프론트엔드에 알림 (source 정보 포함)
        sseManager.broadcastToSession(internalSessionId, {
            type: "permission_request",
            sessionId: internalSessionId,
            toolName,
            toolInput: toolInput || {},
            source: sessionSource // CLI vs Web 구분용
        });

        console.log(`[HOOKS] PermissionNotify: Saved and notified session ${internalSessionId} (source: ${sessionSource})`);

        res.json({ success: true });
    } catch (error) {
        console.error("[HOOKS] PermissionNotify error:", error);
        res.json({ success: true }); // 에러여도 빈 응답 (CLI 다이얼로그는 정상 표시)
    }
});

// POST /api/hooks/permission-request - PermissionRequest hook (권한 요청 등록) - Web 세션용
router.post("/permission-request", async (req, res) => {
    try {
        const { sessionId: claudeSessionId, toolName, toolInput, origin, controllerPid } = req.body;
        const explicitSource = parseHookSource(origin);
        const runtimeControllerPid = parseControllerPid(controllerPid);
        console.log("[HOOKS] PermissionRequest received:", { claudeSessionId, toolName, origin, controllerPid: runtimeControllerPid });

        if (!claudeSessionId || !toolName) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const db = getDatabase();
        // 세션 조회 (자동 매핑 포함)
        let session = resolveInternalSession(claudeSessionId);
        let internalSessionId: string;
        let sessionSource: SessionSource = "terminal";

        if (!session) {
            // 세션 매핑이 아직 없어도 권한 요청을 유실하지 않도록 즉시 생성
            internalSessionId = randomUUID();
            const now = new Date().toISOString();
            sessionSource = resolveSessionSource(explicitSource, "terminal");

            db.prepare(`
                INSERT INTO sessions (id, type, claude_session_id, source, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(internalSessionId, "claude-code", claudeSessionId, sessionSource, "active", now, now);
            sessionMappingCache.set(claudeSessionId, internalSessionId);
            console.log(`[HOOKS] PermissionRequest: Created session ${internalSessionId} for claude ${claudeSessionId}`);
        } else {
            internalSessionId = session.id;
            const sessionData = db.prepare("SELECT source FROM sessions WHERE id = ?").get(internalSessionId) as { source: string } | undefined;
            sessionSource = resolveSessionSource(explicitSource, sessionData?.source);

            if (explicitSource && sessionData?.source !== explicitSource) {
                db.prepare("UPDATE sessions SET source = ?, updated_at = ? WHERE id = ?")
                    .run(explicitSource, new Date().toISOString(), internalSessionId);
            }
        }

        if (sessionSource === "terminal") {
            registerTerminalController(internalSessionId, claudeSessionId, runtimeControllerPid);
        }

        // 오래된 요청 정리 (3분 이상 경과)
        const now = Date.now();
        const threeMinutes = 3 * 60 * 1000;
        for (const [reqId, pending] of pendingPermissions.entries()) {
            if (now - pending.createdAt > threeMinutes) {
                pendingPermissions.delete(reqId);
                console.log(`[HOOKS] PermissionRequest: Cleaned up expired request ${reqId}`);
            }
        }

        // 새 요청 등록
        const requestId = randomUUID();
        const pendingPermission: PendingPermission = {
            requestId,
            sessionId: internalSessionId,
            toolName,
            toolInput: toolInput || {},
            decided: false,
            createdAt: now,
        };

        pendingPermissions.set(requestId, pendingPermission);

        // DB에 permission 메시지 저장
        const permMsgId = `permission-${requestId}`;
        const permNow = new Date().toISOString();
        const permSeq = getNextSequence(internalSessionId);
        const permissionDataJson = JSON.stringify({
            requestId,
            toolName,
            toolInput: toolInput || {},
            decided: false,
            source: sessionSource
        });

        db.prepare(`
            INSERT INTO messages (id, session_id, role, content, timestamp, sequence, permission_data)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(permMsgId, internalSessionId, "assistant", "", permNow, permSeq, permissionDataJson);

        console.log(`[HOOKS] PermissionRequest: Saved permission message ${permMsgId}`);

        // 구독자 확인
        const hasSubscribers = sseManager.hasSessionSubscribers(internalSessionId);

        // SSE로 프론트엔드에 알림 (구독자가 있을 때만)
        if (hasSubscribers) {
            sseManager.broadcastToSession(internalSessionId, {
                type: "permission_request",
                sessionId: internalSessionId,
                requestId,
                toolName,
                toolInput: toolInput || {},
                source: sessionSource
            });
        } else {
            // Web 구독자가 없으면 자동 deny 상태로 마킹해 폴링이 즉시 종료되도록 처리
            pendingPermission.decided = true;
            pendingPermission.behavior = "deny";

            const existingMsg = db.prepare("SELECT permission_data FROM messages WHERE id = ?").get(permMsgId) as { permission_data: string } | undefined;
            if (existingMsg?.permission_data) {
                const permData = JSON.parse(existingMsg.permission_data);
                permData.decided = true;
                permData.behavior = "deny";
                db.prepare("UPDATE messages SET permission_data = ? WHERE id = ?").run(JSON.stringify(permData), permMsgId);
            }
        }

        console.log(`[HOOKS] PermissionRequest: Registered ${requestId} for session ${internalSessionId} (hasSubscribers: ${hasSubscribers})`);

        res.json({ requestId, hasSubscribers });
    } catch (error) {
        console.error("[HOOKS] PermissionRequest error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// GET /api/hooks/permission-poll - 권한 요청 폴링
router.get("/permission-poll", async (req, res) => {
    try {
        const requestId = req.query.requestId as string;

        if (!requestId) {
            return res.status(400).json({ error: "Missing requestId" });
        }

        const pending = pendingPermissions.get(requestId);

        if (!pending) {
            // 요청 없음 - deny로 처리
            return res.json({ decided: true, behavior: "deny" });
        }

        if (!pending.decided) {
            // 아직 결정 안 됨
            return res.json({ decided: false });
        }

        // 결정됨 - 반환 후 삭제
        const behavior = pending.behavior || "deny";
        pendingPermissions.delete(requestId);
        console.log(`[HOOKS] PermissionPoll: Returning decision ${behavior} for ${requestId}`);

        res.json({ decided: true, behavior });
    } catch (error) {
        console.error("[HOOKS] PermissionPoll error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// POST /api/hooks/permission-decide - 사용자 결정 처리
router.post("/permission-decide", async (req, res) => {
    try {
        const { requestId, behavior } = req.body;

        if (!requestId || !behavior) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        if (behavior !== "allow" && behavior !== "deny") {
            return res.status(400).json({ error: "Invalid behavior" });
        }

        const pending = pendingPermissions.get(requestId);

        if (!pending) {
            return res.status(404).json({ error: "Request not found" });
        }

        // 결정 저장 (in-memory for polling)
        pending.decided = true;
        pending.behavior = behavior;

        // DB 업데이트: permission_data의 decided/behavior 갱신
        const permMsgId = `permission-${requestId}`;
        const db = getDatabase();
        const existingMsg = db.prepare("SELECT permission_data FROM messages WHERE id = ?").get(permMsgId) as { permission_data: string } | undefined;
        if (existingMsg?.permission_data) {
            const permData = JSON.parse(existingMsg.permission_data);
            permData.decided = true;
            permData.behavior = behavior;
            db.prepare("UPDATE messages SET permission_data = ? WHERE id = ?").run(JSON.stringify(permData), permMsgId);
            console.log(`[HOOKS] PermissionDecide: Updated DB for ${permMsgId}`);
        }

        // SSE로 프론트엔드에 알림
        sseManager.broadcastToSession(pending.sessionId, {
            type: "permission_decided",
            sessionId: pending.sessionId,
            requestId,
            behavior
        });

        console.log(`[HOOKS] PermissionDecide: User decided ${behavior} for ${requestId}`);

        res.json({ success: true });
    } catch (error) {
        console.error("[HOOKS] PermissionDecide error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// POST /api/hooks/stop - Stop hook (transcript 파싱 + assistant 메시지 저장)
router.post("/stop", async (req, res) => {
    try {
        console.log("[HOOKS] Stop received:", { sessionId: req.body.sessionId || req.body.session_id });
        const { sessionId, session_id, transcript_path, origin, controllerPid } = req.body;
        const claudeSessionId = sessionId || session_id;
        const explicitSource = parseHookSource(origin);
        const runtimeControllerPid = parseControllerPid(controllerPid);

        if (!claudeSessionId) {
            return res.json({ status: "ok" });
        }

        const db = getDatabase();
        const now = new Date().toISOString();

        // 내부 세션 ID 조회 (자동 매핑 포함)
        const session = resolveInternalSession(claudeSessionId);

        if (!session) {
            console.log(`[HOOKS] Stop: No session found for claude_session_id ${claudeSessionId}`);
            return res.json({ status: "ok" });
        }

        const internalSessionId = session.id;

        if (resolveSessionSource(explicitSource) === "terminal") {
            registerTerminalController(internalSessionId, claudeSessionId, runtimeControllerPid);
        }

        // transcript_path 확인 (없으면 자동 탐색)
        const resolvedTranscriptPath = transcript_path || findTranscriptPath(claudeSessionId);

        // transcript에서 아직 보내지 않은 assistant 메시지 추출 (UUID 기반 중복 방지)
        if (resolvedTranscriptPath) {
            try {
                const cursor = getSessionTranscriptCursor(internalSessionId);
                const { results: newTexts, newOffset } = await getNewAssistantTexts(
                    resolvedTranscriptPath,
                    cursor.lastUuid,
                    cursor.lastOffset
                );
                let latestUuid = cursor.lastUuid;

                if (newTexts.length > 0) {
                    for (const { uuid, text } of newTexts) {
                        const assistantMessageId = randomUUID();
                        const stopSeq = getNextSequence(internalSessionId);
                        const insertResult = db.prepare(`
                            INSERT OR IGNORE INTO messages (id, session_id, role, content, timestamp, sequence, transcript_uuid)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        `).run(assistantMessageId, internalSessionId, "assistant", text, now, stopSeq, uuid);

                        if (insertResult.changes > 0) {
                            sseManager.broadcastToSession(internalSessionId, {
                                type: "assistant_message",
                                sessionId: internalSessionId,
                                message: {
                                    id: assistantMessageId,
                                    sessionId: internalSessionId,
                                    role: "assistant",
                                    content: text,
                                    createdAt: now,
                                    sequence: stopSeq
                                }
                            });
                            console.log(`[HOOKS] Stop: Assistant message saved: ${assistantMessageId} (${text.length} chars)`);
                        } else {
                            console.log(`[HOOKS] Stop: Assistant message skipped (duplicate uuid: ${uuid.substring(0, 8)})`);
                        }

                        latestUuid = uuid;
                    }
                } else {
                    console.log(`[HOOKS] Stop: No new assistant text found in transcript`);
                }

                persistSessionTranscriptCursor(internalSessionId, latestUuid, newOffset);
            } catch (error) {
                console.error(`[HOOKS] Stop: Failed to parse transcript:`, error);
            }
        } else {
            console.log(`[HOOKS] Stop: No transcript_path found (provided: ${transcript_path}, auto-detect failed)`);
        }

        // Clean up pending permissions for this session (in-memory + DB)
        for (const [reqId, pending] of pendingPermissions.entries()) {
            if (pending.sessionId === internalSessionId && !pending.decided) {
                pending.decided = true;
                // DB 업데이트: decided = true (expired)
                const permMsgId = `permission-${reqId}`;
                const existingPermMsg = db.prepare("SELECT permission_data FROM messages WHERE id = ?").get(permMsgId) as { permission_data: string } | undefined;
                if (existingPermMsg?.permission_data) {
                    const permData = JSON.parse(existingPermMsg.permission_data);
                    permData.decided = true;
                    db.prepare("UPDATE messages SET permission_data = ? WHERE id = ?").run(JSON.stringify(permData), permMsgId);
                }
                // No behavior set = expired state
                sseManager.broadcastToSession(internalSessionId, {
                    type: "permission_decided",
                    sessionId: internalSessionId,
                    requestId: reqId,
                    behavior: null
                });
                pendingPermissions.delete(reqId);
                console.log(`[HOOKS] Stop: Cleaned up expired permission request ${reqId}`);
            }
        }

        // DB에서 미결 question/permission 정리 (in-memory에 없는 것도 포함)
        db.prepare(`
            UPDATE messages SET question_submitted = 1
            WHERE session_id = ? AND question_data IS NOT NULL AND question_submitted = 0
        `).run(internalSessionId);

        db.prepare(`
            UPDATE messages SET permission_data = json_set(permission_data, '$.decided', json('true'))
            WHERE session_id = ? AND permission_data IS NOT NULL
              AND json_extract(permission_data, '$.decided') = json('false')
        `).run(internalSessionId);

        // SSE로 turn_complete 이벤트 broadcast (프론트엔드 로딩 해제)
        sseManager.broadcastToSession(internalSessionId, {
            type: "turn_complete",
            sessionId: internalSessionId
        });

        // 세션 상태를 idle로 변경
        sessionStatusManager.setStatus(internalSessionId, "idle");

        // 트리거 2: idle 전환 시 구독자가 없으면 PTY 종료
        if (!sseManager.hasSessionSubscribers(internalSessionId)) {
            if (claudeProcessManager.hasProcessForSession(internalSessionId)) {
                console.log(`[CLEANUP] Terminating PTY after turn complete for session ${internalSessionId} (no subscribers)`);
                claudeProcessManager.terminateProcess(internalSessionId);
            }
        }

        // 세션 updated_at 갱신
        db.prepare(`
            UPDATE sessions
            SET updated_at = ?
            WHERE id = ?
        `).run(now, internalSessionId);

        console.log(`[HOOKS] Stop: Session ${internalSessionId} turn completed`);

        res.json({ status: "ok" });
    } catch (error) {
        console.error("[HOOKS] Stop hook error:", error);
        res.json({ status: "error" });
    }
});

/**
 * CLI 프로세스 하트비트 체크
 * 터미널 세션의 controllerPid가 죽었는지 확인하고, 죽었으면 세션 정리
 */
export const checkTerminalSessionsHeartbeat = (): void => {
    const db = getDatabase();
    const now = new Date().toISOString();

    for (const [sessionId, controller] of terminalSessionControllers.entries()) {
        // 프로세스 생존 확인
        let isAlive = false;
        try {
            process.kill(controller.controllerPid, 0);
            isAlive = true;
        } catch {
            // 프로세스 죽음
        }

        if (!isAlive) {
            console.log(`[HEARTBEAT] CLI process ${controller.controllerPid} died for session ${sessionId}`);

            // 세션 상태가 streaming이면 정리
            const currentStatusData = sessionStatusManager.getStatus(sessionId);
            if (currentStatusData?.status === "streaming") {
                // 세션 상태를 idle로 변경
                sessionStatusManager.setStatus(sessionId, "idle");

                // SSE로 turn_complete 전송
                sseManager.broadcastToSession(sessionId, {
                    type: "turn_complete",
                    sessionId
                });

                // DB 업데이트
                db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, sessionId);

                console.log(`[HEARTBEAT] Session ${sessionId} cleaned up (turn_complete sent)`);
            }

            // terminalSessionControllers에서 제거
            terminalSessionControllers.delete(sessionId);
        }
    }
};

export default router;
