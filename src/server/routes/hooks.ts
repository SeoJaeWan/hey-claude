import { Router, type Router as RouterType } from "express";
import { getDatabase } from "../services/database.js";
import { randomUUID } from "crypto";
import { compressToolUsage } from "../services/compression.js";
import sseManager from "../services/sseManager.js";
import { buildMessageFromToolUse } from "../services/messageBuilder.js";
import { getNewAssistantTexts } from "../services/transcriptParser.js";
import sessionStatusManager from "../services/sessionStatusManager.js";
import { homedir } from "os";
import { join } from "path";
import { existsSync } from "fs";

const router: RouterType = Router();

// Session mapping cache: claudeSessionId → internalSessionId
const sessionMappingCache = new Map<string, string>();

/**
 * Claude transcript 파일 경로 구성
 * Claude는 ~/.claude/projects/{project-hash}/{session-id}.jsonl 에 transcript 저장
 * project-hash: 프로젝트 경로에서 : → -, / 또는 \ → - 로 변환
 */
const findTranscriptPath = (claudeSessionId: string, projectPath?: string): string | null => {
    if (!projectPath) return null;

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

    // 2. DB에서 조회
    const direct = db.prepare("SELECT id FROM sessions WHERE claude_session_id = ?").get(claudeSessionId) as { id: string } | undefined;
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

// POST /api/hooks/session - SessionStart Hook
interface SessionHookRequest {
    sessionId: string;
    projectPath: string;
    source: 'startup' | 'resume' | 'clear' | 'compact';
    model: string;
}

router.post("/session", async (req, res) => {
    try {
        const { sessionId, projectPath, source, model } = req.body as SessionHookRequest;

        console.log("[HOOKS] SessionStart received:", { sessionId, projectPath, source, model });

        if (!sessionId || !projectPath) {
            return res.json({ success: true });
        }

        const db = getDatabase();

        // 세션이 이미 존재하는지 확인
        const existingSession = db.prepare("SELECT id FROM sessions WHERE claude_session_id = ?").get(sessionId);

        if (existingSession) {
            // 기존 세션 업데이트
            db.prepare(`
                UPDATE sessions
                SET updated_at = ?, source = ?
                WHERE claude_session_id = ?
            `).run(new Date().toISOString(), source === 'resume' ? 'terminal' : 'web', sessionId);

            console.log(`[HOOKS] SessionStart: Updated existing session ${sessionId}`);
        } else {
            // 새 세션 생성
            const newSessionId = randomUUID();
            const now = new Date().toISOString();

            db.prepare(`
                INSERT INTO sessions (id, type, claude_session_id, model, project_path, source, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                newSessionId,
                "claude-code",
                sessionId,
                model || null,
                projectPath,
                source === 'resume' ? 'terminal' : 'web',
                "active",
                now,
                now
            );

            console.log(`[HOOKS] SessionStart: Created new session ${newSessionId} for claude_session_id ${sessionId}`);
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
    projectPath?: string;
    toolUseId?: string;
    toolName: string;
    toolInput: any;
    toolOutput?: any;  // post only
}

router.post("/tool-use", async (req, res) => {
    try {
        // PreToolUse와 PostToolUse 모두 처리
        const { type, sessionId, projectPath, toolUseId, toolName, toolInput, toolOutput } = req.body as ToolUseHookRequest;

        // 기존 PostToolUse hook 형식 (session_id, cwd, tool_name 등)도 지원
        const claudeSessionId = sessionId || req.body.session_id;
        const cwd = projectPath || req.body.cwd;
        const tool_name = toolName || req.body.tool_name;
        const tool_input = toolInput || req.body.tool_input;
        const tool_response = toolOutput || req.body.tool_response;

        console.log("[HOOKS] ToolUse received:", { type, claudeSessionId, toolName: tool_name, toolUseId });

        if (!claudeSessionId || !cwd || !tool_name) {
            return res.json({
                continue: true,
                suppressOutput: true,
            });
        }

        const db = getDatabase();

        // 세션 조회 (자동 매핑 포함)
        let session = resolveInternalSession(claudeSessionId);
        let internalSessionId: string;

        if (!session) {
            // 터미널에서 생성된 세션 - 새로 등록
            internalSessionId = randomUUID();
            const now = new Date().toISOString();

            db.prepare(`
                INSERT INTO sessions (id, type, claude_session_id, project_path, source, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(internalSessionId, "claude-code", claudeSessionId, cwd, "terminal", "active", now, now);
        } else {
            internalSessionId = session.id;
        }

        // PreToolUse: AskUserQuestion 감지 시 SSE로 프론트엔드에 전달
        if (type === 'pre' && tool_name === 'AskUserQuestion' && tool_input?.questions) {
            console.log("[HOOKS] AskUserQuestion detected, broadcasting to frontend via SSE");

            sseManager.broadcastToSession(internalSessionId, {
                type: "ask_user_question",
                sessionId: internalSessionId,
                toolUseId: toolUseId,
                questions: tool_input.questions
            });
        }

        // PostToolUse: 도구 사용 내역 저장
        if (type === 'post' || !type) {
            const now = new Date().toISOString();
            const result = db.prepare(`
                INSERT INTO tool_usages (session_id, tool_name, tool_input, tool_output, timestamp)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                internalSessionId,
                tool_name,
                JSON.stringify(tool_input || {}),
                JSON.stringify(tool_response || {}),
                now
            );

            const toolUsageId = result.lastInsertRowid;

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
            db.prepare(`
                INSERT INTO messages (id, session_id, role, content, timestamp)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                messageId,
                internalSessionId,
                messageContent.role,
                messageContent.content,
                now
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
                    createdAt: now
                }
            });

            console.log(`[HOOKS] SSE broadcast: tool_use_message for session ${internalSessionId}`);

            // transcript에서 중간 assistant 텍스트 캡처 (도구 사용 전 텍스트)
            try {
                const transcriptPath = findTranscriptPath(claudeSessionId, cwd);
                if (transcriptPath) {
                    const lastUuid = sessionStatusManager.getLastProcessedUuid(internalSessionId);
                    const lastOffset = sessionStatusManager.getLastReadOffset(internalSessionId);
                    const { results: newTexts, newOffset } = await getNewAssistantTexts(transcriptPath, lastUuid, lastOffset);
                    sessionStatusManager.setLastReadOffset(internalSessionId, newOffset);

                    for (const { uuid, text } of newTexts) {
                        const assistantMsgId = randomUUID();
                        db.prepare(`
                            INSERT INTO messages (id, session_id, role, content, timestamp)
                            VALUES (?, ?, ?, ?, ?)
                        `).run(assistantMsgId, internalSessionId, "assistant", text, now);

                        sseManager.broadcastToSession(internalSessionId, {
                            type: "assistant_message",
                            sessionId: internalSessionId,
                            message: {
                                id: assistantMsgId,
                                sessionId: internalSessionId,
                                role: "assistant",
                                content: text,
                                createdAt: now
                            }
                        });

                        sessionStatusManager.setLastProcessedUuid(internalSessionId, uuid);
                        console.log(`[HOOKS] Intermediate assistant text sent: ${text.substring(0, 80)} (uuid: ${uuid.substring(0, 8)})`);
                    }
                }
            } catch (error) {
                console.error("[HOOKS] Intermediate text extraction failed:", error);
            }

            // 비동기로 압축 수행 (응답 지연 방지)
            compressToolUsage(cwd, {
                toolName: tool_name,
                toolInput: tool_input || {},
                toolOutput: tool_response || {},
            })
                .then((compression) => {
                    if (compression) {
                        db.prepare(`
                            UPDATE tool_usages
                            SET compressed_type = ?, compressed_title = ?, compressed_content = ?, compressed_at = ?
                            WHERE id = ?
                        `).run(
                            compression.type,
                            compression.title,
                            compression.content,
                            new Date().toISOString(),
                            toolUsageId
                        );
                        console.log(`[HOOKS] Compression saved for tool usage ${toolUsageId}`);
                    }
                })
                .catch((error) => {
                    console.error("[HOOKS] Compression failed:", error);
                });
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

// POST /api/hooks/stop - Stop hook (transcript 파싱 + assistant 메시지 저장)
router.post("/stop", async (req, res) => {
    try {
        console.log("[HOOKS] Stop received:", { sessionId: req.body.sessionId || req.body.session_id });
        const { sessionId, session_id, projectPath, transcript_path } = req.body;
        const claudeSessionId = sessionId || session_id;

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

        // transcript_path 확인 (없으면 자동 탐색)
        const resolvedTranscriptPath = transcript_path || findTranscriptPath(claudeSessionId, projectPath || req.body.cwd);

        // transcript에서 아직 보내지 않은 assistant 메시지 추출 (UUID 기반 중복 방지)
        if (resolvedTranscriptPath) {
            try {
                const lastUuid = sessionStatusManager.getLastProcessedUuid(internalSessionId);
                const lastOffset = sessionStatusManager.getLastReadOffset(internalSessionId);
                const { results: newTexts, newOffset } = await getNewAssistantTexts(resolvedTranscriptPath, lastUuid, lastOffset);
                sessionStatusManager.setLastReadOffset(internalSessionId, newOffset);

                if (newTexts.length > 0) {
                    for (const { uuid, text } of newTexts) {
                        const assistantMessageId = randomUUID();
                        db.prepare(`
                            INSERT INTO messages (id, session_id, role, content, timestamp)
                            VALUES (?, ?, ?, ?, ?)
                        `).run(assistantMessageId, internalSessionId, "assistant", text, now);

                        sseManager.broadcastToSession(internalSessionId, {
                            type: "assistant_message",
                            sessionId: internalSessionId,
                            message: {
                                id: assistantMessageId,
                                sessionId: internalSessionId,
                                role: "assistant",
                                content: text,
                                createdAt: now
                            }
                        });

                        sessionStatusManager.setLastProcessedUuid(internalSessionId, uuid);
                        console.log(`[HOOKS] Stop: Assistant message saved: ${assistantMessageId} (${text.length} chars)`);
                    }
                } else {
                    console.log(`[HOOKS] Stop: No new assistant text found in transcript`);
                }
            } catch (error) {
                console.error(`[HOOKS] Stop: Failed to parse transcript:`, error);
            }
        } else {
            console.log(`[HOOKS] Stop: No transcript_path found (provided: ${transcript_path}, auto-detect failed)`);
        }

        // SSE로 turn_complete 이벤트 broadcast (프론트엔드 로딩 해제)
        sseManager.broadcastToSession(internalSessionId, {
            type: "turn_complete",
            sessionId: internalSessionId
        });

        // 세션 상태를 idle로 변경
        sessionStatusManager.setStatus(internalSessionId, "idle");

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

export default router;
