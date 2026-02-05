import {Router, type Router as RouterType} from "express";
import {randomUUID} from "crypto";
import {type ChildProcess} from "child_process";
import {callClaude} from "../services/claude.js";
import {getRecentContext} from "../services/context.js";
import {getDatabase} from "../services/database.js";

const router: RouterType = Router();

// 세션별 활성 스트리밍 프로세스 관리
const activeStreams = new Map<string, ChildProcess>();

// 타입 정의: POST /api/chat/tool-result
interface ToolResultRequest {
    sessionId: string;
    toolUseId: string;
    answers: QuestionAnswer[];
}

interface QuestionAnswer {
    questionIndex: number;
    question: string;
    selectedOptions: string[];
}

// 유틸리티: 사용자 답변을 자연어 프롬프트로 변환
const formatAnswersAsPrompt = (answers: QuestionAnswer[], toolUseId: string): string => {
    const formattedAnswers = answers
        .map(a => {
            const selections = a.selectedOptions.join(", ");
            return `${a.questionIndex + 1}. ${a.question}\n   답변: ${selections}`;
        })
        .join("\n\n");

    return `[Tool Result: AskUserQuestion]
Tool Use ID: ${toolUseId}

이전 질문에 대한 답변입니다:

${formattedAnswers}

이 정보를 바탕으로 작업을 계속 진행해주세요.`;
};

// POST /api/chat/stream - SSE 스트리밍
router.post("/stream", async (req, res) => {
    try {
        const {sessionId, prompt, images} = req.body;
        console.log("[CHAT STREAM] Request received:", {sessionId, prompt: prompt?.substring(0, 50)});

        if (!sessionId || !prompt) {
            res.status(400).json({
                error: {
                    code: "MISSING_PARAMETERS",
                    message: "sessionId and prompt are required"
                }
            });
            return;
        }

        // TODO: 질문 응답 기능 재설계 필요
        // stdin을 ignore로 설정했으므로 현재는 동작하지 않음
        // 향후 질문 감지 시 별도 프로세스로 처리하는 방식으로 재구현
        /*
        const activeProcess = activeStreams.get(sessionId);
        if (activeProcess && activeProcess.stdin && !activeProcess.killed) {
            console.log("[CHAT STREAM] Writing to stdin:", prompt);
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
            try {
                activeProcess.stdin.write(prompt + "\n", "utf-8");
                res.write(`data: ${JSON.stringify({ type: "input_sent" })}\n\n`);
                res.end();
                return;
            } catch (error) {
                console.log("[CHAT STREAM] Failed to write to stdin:", error);
                res.write(`data: ${JSON.stringify({ type: "error", error: "Failed to send input" })}\n\n`);
                res.end();
                return;
            }
        }
        */

        // SSE 헤더 설정
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        console.log("[CHAT STREAM] SSE headers set");

        const db = getDatabase();
        const projectPath = process.cwd();

        // 세션 조회
        const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as any;

        if (!session) {
            console.log("[CHAT STREAM] Session not found:", sessionId);
            res.write(`data: ${JSON.stringify({type: "error", error: "Session not found"})}\n\n`);
            res.end();
            return;
        }

        console.log("[CHAT STREAM] Session found:", {
            type: session.type,
            model: session.model,
            claude_session_id: session.claude_session_id
        });

        // 사용자 메시지 저장 (이미지 포함)
        const userMessageId = randomUUID();
        const imagesJson = images ? JSON.stringify(images) : null;
        db.prepare(
            `INSERT INTO messages (id, session_id, role, content, images, timestamp)
             VALUES (?, ?, ?, ?, ?, ?)`
        ).run(userMessageId, sessionId, "user", prompt, imagesJson, new Date().toISOString());

        // 컨텍스트 주입
        const context = await getRecentContext({projectPath, sessionId});
        const finalPrompt = context ? `${context}\n\n${prompt}` : prompt;
        console.log("[CHAT STREAM] Context prepared, final prompt length:", finalPrompt.length);

        // Claude CLI 호출
        console.log("[CHAT STREAM] Calling Claude CLI with:", {
            sessionId: session.claude_session_id,
            cwd: projectPath
        });
        const claude = callClaude({
            prompt: finalPrompt,
            sessionId: session.claude_session_id,
            cwd: projectPath
        });

        // 활성 프로세스 등록
        activeStreams.set(sessionId, claude);
        console.log("[CHAT STREAM] Process registered for session:", sessionId);

        let assistantResponse = "";
        let claudeSessionId = session.claude_session_id;
        let buffer = "";
        let questionData: any = null; // AskUserQuestion 데이터 저장

        // stdout 스트리밍
        claude.stdout?.on("data", data => {
            const chunk = data.toString();
            console.log("[CHAT STREAM] stdout chunk received, length:", chunk.length);

            buffer += chunk;
            const lines = buffer.split("\n");

            // 마지막 불완전한 라인은 버퍼에 남겨둠
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    const parsed = JSON.parse(line);

                    // Claude Code 세션 ID 추출
                    if (parsed.session_id) {
                        claudeSessionId = parsed.session_id;
                        console.log("[CHAT STREAM] Claude session ID extracted:", claudeSessionId);
                    }

                    // type: "assistant" 메시지에서 실제 텍스트 및 tool_use 추출
                    if (parsed.type === "assistant" && parsed.message?.content) {
                        for (const contentBlock of parsed.message.content) {
                            // 텍스트 블록 처리
                            if (contentBlock.type === "text" && contentBlock.text) {
                                const text = contentBlock.text;
                                assistantResponse += text;

                                // 질문 패턴 감지: 숫자 목록 (1. 2. 3. 등)
                                const hasNumberedOptions = /^\s*\d+\.\s+.+/m.test(text);

                                if (hasNumberedOptions) {
                                    // 질문으로 표시
                                    res.write(`data: ${JSON.stringify({type: "question", content: text})}\n\n`);
                                    console.log("[CHAT STREAM] Question detected, length:", text.length);
                                } else {
                                    // 일반 텍스트
                                    res.write(`data: ${JSON.stringify({type: "chunk", content: text})}\n\n`);
                                    console.log("[CHAT STREAM] Extracted text, length:", text.length);
                                }
                            }

                            // tool_use 블록 처리 (Phase 1: 감지 및 전송)
                            if (contentBlock.type === "tool_use") {
                                const toolUseData = {
                                    type: "tool_use",
                                    tool_use_id: contentBlock.id,
                                    tool_name: contentBlock.name,
                                    tool_input: contentBlock.input
                                };

                                // SSE로 tool_use 정보 전송
                                res.write(`data: ${JSON.stringify(toolUseData)}\n\n`);
                                console.log("[CHAT STREAM] tool_use detected:", {
                                    id: contentBlock.id,
                                    name: contentBlock.name,
                                    input: contentBlock.input
                                });

                                // AskUserQuestion 데이터 저장 (DB에 함께 저장하기 위함)
                                if (contentBlock.name === "AskUserQuestion") {
                                    questionData = {
                                        tool_use_id: contentBlock.id,
                                        questions: contentBlock.input.questions
                                    };
                                    console.log("[CHAT STREAM] AskUserQuestion saved for DB storage");
                                }
                            }
                        }
                    }

                    // type: "result"에서 최종 응답 추출 (fallback)
                    else if (parsed.type === "result" && parsed.result && !assistantResponse) {
                        assistantResponse = parsed.result;
                        res.write(`data: ${JSON.stringify({type: "chunk", content: parsed.result})}\n\n`);
                        console.log("[CHAT STREAM] Extracted result text, length:", parsed.result.length);
                    }
                } catch (e) {
                    console.log("[CHAT STREAM] Failed to parse JSON line:", line.substring(0, 100));
                }
            }
        });

        // stderr 스트리밍
        claude.stderr?.on("data", data => {
            const error = data.toString();
            console.log("[CHAT STREAM] stderr received:", error);
            res.write(`data: ${JSON.stringify({type: "error", content: error})}\n\n`);
        });

        // 종료 시 assistant 메시지 저장
        claude.on("close", code => {
            console.log("[CHAT STREAM] Claude process closed with code:", code);
            console.log("[CHAT STREAM] Response length:", assistantResponse.length);

            // 프로세스 정리
            activeStreams.delete(sessionId);
            console.log("[CHAT STREAM] Process removed from active streams");

            if (code === 0 && assistantResponse) {
                const assistantMessageId = randomUUID();
                const questionDataJson = questionData ? JSON.stringify(questionData) : null;

                db.prepare(
                    `INSERT INTO messages (id, session_id, role, content, timestamp, question_data)
                     VALUES (?, ?, ?, ?, ?, ?)`
                ).run(assistantMessageId, sessionId, "assistant", assistantResponse, new Date().toISOString(), questionDataJson);

                if (questionDataJson) {
                    console.log("[CHAT STREAM] Saved message with questionData to DB");
                }

                // Claude 세션 ID 업데이트
                if (claudeSessionId && claudeSessionId !== session.claude_session_id) {
                    console.log("[CHAT STREAM] Updating session with new claude_session_id:", claudeSessionId);
                    db.prepare("UPDATE sessions SET claude_session_id = ?, updated_at = ? WHERE id = ?").run(
                        claudeSessionId,
                        new Date().toISOString(),
                        sessionId
                    );
                }
            }

            res.write(`data: ${JSON.stringify({type: "done", code})}\n\n`);
            res.end();
        });

        // 에러 핸들링
        claude.on("error", error => {
            console.log("[CHAT STREAM] Claude process error:", error);
            res.write(`data: ${JSON.stringify({type: "error", error: error.message})}\n\n`);
            res.end();
        });

        // 클라이언트 연결 종료 시
        req.on("close", () => {
            console.log("[CHAT STREAM] Client connection closed, killing claude process");
            claude.kill();
        });
    } catch (error) {
        console.log("[CHAT STREAM] Exception caught:", error);
        res.write(
            `data: ${JSON.stringify({
                type: "error",
                error: error instanceof Error ? error.message : "Unknown error"
            })}\n\n`
        );
        res.end();
    }
});

// POST /api/chat/tool-result - AskUserQuestion 답변 제출
router.post("/tool-result", async (req, res) => {
    try {
        const {sessionId, toolUseId, answers} = req.body as ToolResultRequest;
        console.log("[TOOL RESULT] Request received:", {
            sessionId,
            toolUseId,
            answersCount: answers?.length
        });

        // 1. 입력 검증
        if (!sessionId || !answers || !Array.isArray(answers) || answers.length === 0) {
            console.log("[TOOL RESULT] Invalid request:", {sessionId, answers});
            res.status(400).json({
                error: {
                    code: "INVALID_REQUEST",
                    message: "sessionId and answers are required"
                }
            });
            return;
        }

        // 2. 세션 조회
        const db = getDatabase();
        const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as any;

        if (!session) {
            console.log("[TOOL RESULT] Session not found:", sessionId);
            res.status(404).json({
                error: {
                    code: "SESSION_NOT_FOUND",
                    message: "Session not found"
                }
            });
            return;
        }

        console.log("[TOOL RESULT] Session found:", {
            type: session.type,
            model: session.model,
            claude_session_id: session.claude_session_id
        });

        // 3. 답변 포맷팅
        const answerPrompt = formatAnswersAsPrompt(answers, toolUseId);
        console.log("[TOOL RESULT] Formatted answer prompt:", answerPrompt.substring(0, 200));

        // 4. SSE 헤더 설정
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        console.log("[TOOL RESULT] SSE headers set");

        // 5. Claude CLI 호출 (--resume)
        const projectPath = process.cwd();
        console.log("[TOOL RESULT] Calling Claude CLI with:", {
            sessionId: session.claude_session_id,
            cwd: projectPath
        });

        const claude = callClaude({
            prompt: answerPrompt,
            sessionId: session.claude_session_id,
            cwd: projectPath
        });

        // 활성 프로세스 등록
        activeStreams.set(sessionId, claude);
        console.log("[TOOL RESULT] Process registered for session:", sessionId);

        let assistantResponse = "";
        let claudeSessionId = session.claude_session_id;
        let buffer = "";

        // 6. stdout 스트리밍 (기존 /stream 로직 재사용)
        claude.stdout?.on("data", data => {
            const chunk = data.toString();
            console.log("[TOOL RESULT] stdout chunk received, length:", chunk.length);

            buffer += chunk;
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    const parsed = JSON.parse(line);

                    // Claude Code 세션 ID 추출
                    if (parsed.session_id) {
                        claudeSessionId = parsed.session_id;
                        console.log("[TOOL RESULT] Claude session ID extracted:", claudeSessionId);
                    }

                    // type: "assistant" 메시지에서 실제 텍스트 및 tool_use 추출
                    if (parsed.type === "assistant" && parsed.message?.content) {
                        for (const contentBlock of parsed.message.content) {
                            // 텍스트 블록 처리
                            if (contentBlock.type === "text" && contentBlock.text) {
                                const text = contentBlock.text;
                                assistantResponse += text;

                                // 질문 패턴 감지
                                const hasNumberedOptions = /^\s*\d+\.\s+.+/m.test(text);

                                if (hasNumberedOptions) {
                                    res.write(`data: ${JSON.stringify({type: "question", content: text})}\n\n`);
                                    console.log("[TOOL RESULT] Question detected, length:", text.length);
                                } else {
                                    res.write(`data: ${JSON.stringify({type: "chunk", content: text})}\n\n`);
                                    console.log("[TOOL RESULT] Extracted text, length:", text.length);
                                }
                            }

                            // tool_use 블록 처리
                            if (contentBlock.type === "tool_use") {
                                const toolUseData = {
                                    type: "tool_use",
                                    tool_use_id: contentBlock.id,
                                    tool_name: contentBlock.name,
                                    tool_input: contentBlock.input
                                };

                                res.write(`data: ${JSON.stringify(toolUseData)}\n\n`);
                                console.log("[TOOL RESULT] tool_use detected:", {
                                    id: contentBlock.id,
                                    name: contentBlock.name,
                                    input: contentBlock.input
                                });
                            }
                        }
                    }

                    // type: "result"에서 최종 응답 추출 (fallback)
                    else if (parsed.type === "result" && parsed.result && !assistantResponse) {
                        assistantResponse = parsed.result;
                        res.write(`data: ${JSON.stringify({type: "chunk", content: parsed.result})}\n\n`);
                        console.log("[TOOL RESULT] Extracted result text, length:", parsed.result.length);
                    }
                } catch (e) {
                    console.log("[TOOL RESULT] Failed to parse JSON line:", line.substring(0, 100));
                }
            }
        });

        // 7. stderr 스트리밍
        claude.stderr?.on("data", data => {
            const error = data.toString();
            console.log("[TOOL RESULT] stderr received:", error);
            res.write(`data: ${JSON.stringify({type: "error", content: error})}\n\n`);
        });

        // 8. 종료 시 assistant 메시지 저장
        claude.on("close", code => {
            console.log("[TOOL RESULT] Claude process closed with code:", code);
            console.log("[TOOL RESULT] Response length:", assistantResponse.length);

            // 프로세스 정리
            activeStreams.delete(sessionId);
            console.log("[TOOL RESULT] Process removed from active streams");

            if (code === 0 && assistantResponse) {
                const assistantMessageId = randomUUID();
                db.prepare(
                    `INSERT INTO messages (id, session_id, role, content, timestamp)
                     VALUES (?, ?, ?, ?, ?)`
                ).run(assistantMessageId, sessionId, "assistant", assistantResponse, new Date().toISOString());

                // Claude 세션 ID 업데이트
                if (claudeSessionId && claudeSessionId !== session.claude_session_id) {
                    console.log("[TOOL RESULT] Updating session with new claude_session_id:", claudeSessionId);
                    db.prepare("UPDATE sessions SET claude_session_id = ?, updated_at = ? WHERE id = ?").run(
                        claudeSessionId,
                        new Date().toISOString(),
                        sessionId
                    );
                }
            }

            res.write(`data: ${JSON.stringify({type: "done", code})}\n\n`);
            res.end();
        });

        // 9. 에러 핸들링
        claude.on("error", error => {
            console.log("[TOOL RESULT] Claude process error:", error);
            res.write(`data: ${JSON.stringify({type: "error", error: error.message})}\n\n`);
            res.end();
        });

        // 10. 클라이언트 연결 종료 시
        // FIXME: req.on("close")가 즉시 발생하는 문제로 임시 비활성화
        // req.on("close", () => {
        //     console.log("[TOOL RESULT] Client connection closed, killing claude process");
        //     claude.kill();
        // });
    } catch (error) {
        console.log("[TOOL RESULT] Exception caught:", error);
        res.status(500).json({
            error: {
                code: "TOOL_RESULT_FAILED",
                message: error instanceof Error ? error.message : "Unknown error"
            }
        });
    }
});

// POST /api/chat/send - fallback (non-streaming)
router.post("/send", async (req, res) => {
    try {
        const {sessionId, prompt, images} = req.body;

        if (!sessionId || !prompt) {
            res.status(400).json({
                error: {
                    code: "MISSING_PARAMETERS",
                    message: "sessionId and prompt are required"
                }
            });
            return;
        }

        const db = getDatabase();
        const projectPath = process.cwd();

        // 세션 조회
        const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as any;

        if (!session) {
            res.status(404).json({
                error: {
                    code: "SESSION_NOT_FOUND",
                    message: "Session not found"
                }
            });
            return;
        }

        // 사용자 메시지 저장 (이미지 포함)
        const userMessageId = randomUUID();
        const imagesJson = images ? JSON.stringify(images) : null;
        db.prepare(
            `INSERT INTO messages (id, session_id, role, content, images, timestamp)
             VALUES (?, ?, ?, ?, ?, ?)`
        ).run(userMessageId, sessionId, "user", prompt, imagesJson, new Date().toISOString());

        // 컨텍스트 주입
        const context = await getRecentContext({projectPath, sessionId});
        const finalPrompt = context ? `${context}\n\n${prompt}` : prompt;

        // Claude CLI 호출
        const claude = callClaude({
            prompt: finalPrompt,
            sessionId: session.claude_session_id,
            cwd: projectPath
        });

        let assistantResponse = "";
        let claudeSessionId = session.claude_session_id;

        claude.stdout?.on("data", data => {
            const chunk = data.toString();
            assistantResponse += chunk;

            const sessionMatch = chunk.match(/session_id['"]\s*:\s*['"]([^'"]+)['"]/);
            if (sessionMatch) {
                claudeSessionId = sessionMatch[1];
            }
        });

        claude.on("close", code => {
            if (code === 0 && assistantResponse) {
                const assistantMessageId = randomUUID();
                db.prepare(
                    `INSERT INTO messages (id, session_id, role, content, timestamp)
                     VALUES (?, ?, ?, ?, ?)`
                ).run(assistantMessageId, sessionId, "assistant", assistantResponse, new Date().toISOString());

                if (claudeSessionId && claudeSessionId !== session.claude_session_id) {
                    db.prepare("UPDATE sessions SET claude_session_id = ?, updated_at = ? WHERE id = ?").run(
                        claudeSessionId,
                        new Date().toISOString(),
                        sessionId
                    );
                }

                res.json({
                    data: {
                        response: assistantResponse
                    }
                });
            } else {
                res.status(500).json({
                    error: {
                        code: "CLAUDE_CLI_FAILED",
                        message: `Claude CLI exited with code ${code}`
                    }
                });
            }
        });
    } catch (error) {
        res.status(500).json({
            error: {
                code: "CHAT_SEND_FAILED",
                message: error instanceof Error ? error.message : "Unknown error"
            }
        });
    }
});

export default router;
