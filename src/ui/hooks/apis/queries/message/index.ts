import {useState, useCallback} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {useSessionQuery} from "../session";
import type {Message} from "../../../../types";

// snake_case → camelCase 변환
const convertMessage = (msg: any): Message => ({
    id: msg.id,
    sessionId: msg.session_id,
    role: msg.role,
    content: msg.content,
    images: msg.images ? JSON.parse(msg.images) : undefined,
    changes: msg.changes ? JSON.parse(msg.changes) : undefined,
    createdAt: msg.timestamp || msg.created_at,
    questionData: msg.question_data ? JSON.parse(msg.question_data) : undefined,
    questionSubmitted: msg.question_submitted === 1
});

// 이미지 파일을 Base64로 인코딩하는 유틸리티 함수
const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result as string;
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

// SSE 스트리밍 처리 공통 헬퍼 함수
const processSSEStream = async (
    response: Response,
    sessionId: string,
    tempAssistantMsgId: string,
    queryClient: any,
    callbacks: {
        onError?: (error: string) => void;
        onComplete?: () => void;
    }
): Promise<void> => {
    console.log("[processSSEStream] Starting SSE processing for session:", sessionId);

    const reader = response.body?.getReader();
    if (!reader) {
        console.error("[processSSEStream] ReadableStream not supported");
        throw new Error("ReadableStream not supported");
    }

    console.log("[processSSEStream] Reader obtained, starting to read...");

    const decoder = new TextDecoder();
    let buffer = "";
    let assistantContent = "";
    let chunkCount = 0;

    while (true) {
        const {done, value} = await reader.read();
        if (done) {
            console.log("[processSSEStream] Stream done, total chunks:", chunkCount);
            break;
        }

        const rawChunk = decoder.decode(value, {stream: true});
        console.log("[processSSEStream] Raw chunk received:", rawChunk.substring(0, 200));

        buffer += rawChunk;
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            if (line.startsWith("data: ")) {
                try {
                    const data = JSON.parse(line.slice(6));
                    chunkCount++;
                    console.log("[SSE] Received data #" + chunkCount + ":", data);

                    // chunk 처리
                    if (data.type === "chunk" || data.type === "question") {
                        assistantContent += data.content;

                        // React Query 캐시 업데이트
                        queryClient.setQueryData(["session", sessionId], (old: any) => {
                            if (!old) return old;

                            const messages = old.messages || [];
                            const lastMsg = messages[messages.length - 1];

                            // 마지막 메시지가 임시 assistant 메시지면 업데이트
                            if (lastMsg?.id === tempAssistantMsgId) {
                                return {
                                    ...old,
                                    messages: [...messages.slice(0, -1), {...lastMsg, content: assistantContent}]
                                };
                            } else {
                                // 아직 assistant 메시지가 없으면 추가
                                return {
                                    ...old,
                                    messages: [
                                        ...messages,
                                        {
                                            id: tempAssistantMsgId,
                                            session_id: sessionId,
                                            role: "assistant",
                                            content: assistantContent,
                                            timestamp: new Date().toISOString()
                                        }
                                    ]
                                };
                            }
                        });
                    }
                    // tool_use 처리
                    else if (data.type === "tool_use") {
                        console.log("[SSE] tool_use detected:", data);

                        if (data.tool_name === "AskUserQuestion") {
                            console.log("[SSE] AskUserQuestion detected, questions:", data.tool_input.questions);

                            const questionData = {
                                tool_use_id: data.tool_use_id,
                                questions: data.tool_input.questions
                            };

                            // React Query 캐시 업데이트
                            queryClient.setQueryData(["session", sessionId], (old: any) => {
                                if (!old) return old;

                                const messages = old.messages || [];
                                const lastMsg = messages[messages.length - 1];

                                if (lastMsg?.id === tempAssistantMsgId) {
                                    return {
                                        ...old,
                                        messages: [
                                            ...messages.slice(0, -1),
                                            {
                                                ...lastMsg,
                                                content: assistantContent,
                                                question_data: JSON.stringify(questionData),
                                                questionData
                                            }
                                        ]
                                    };
                                } else {
                                    return {
                                        ...old,
                                        messages: [
                                            ...messages,
                                            {
                                                id: tempAssistantMsgId,
                                                session_id: sessionId,
                                                role: "assistant",
                                                content: assistantContent,
                                                timestamp: new Date().toISOString(),
                                                question_data: JSON.stringify(questionData),
                                                questionData
                                            }
                                        ]
                                    };
                                }
                            });
                        }
                    }
                    // error
                    else if (data.type === "error") {
                        callbacks.onError?.(data.content || data.error);
                        console.error("[SSE] Error:", data.content || data.error);
                    }
                    // done
                    else if (data.type === "done") {
                        if (callbacks.onComplete) {
                            callbacks.onComplete();
                        } else {
                            queryClient.invalidateQueries({queryKey: ["session", sessionId]});
                        }
                    }
                } catch (e) {
                    console.error("Failed to parse SSE data:", e);
                }
            }
        }
    }
};

// 메시지 목록 조회 (기존 세션 API 재활용)
export const useMessagesQuery = (sessionId: string | undefined) => {
    const {data: sessionData, isLoading} = useSessionQuery(sessionId);

    const messages = sessionData?.messages ? (sessionData.messages as any[]).map(convertMessage) : [];

    return {
        data: messages,
        isLoading
    };
};

// 메시지 전송 (stream-json 스트리밍 기반)
export const useSendMessageStream = () => {
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const queryClient = useQueryClient();

    const sendMessage = useCallback(
        async (sessionId: string, prompt: string, images?: File[]) => {
            setIsSending(true);
            setError(null);

            // 임시 메시지 ID 생성
            const tempUserMsgId = `temp-user-${Date.now()}`;
            const tempAssistantMsgId = `temp-assistant-${Date.now()}`;

            try {
                // 이미지를 Base64로 인코딩
                let imageData: string[] | undefined;
                if (images && images.length > 0) {
                    imageData = await Promise.all(images.map(fileToBase64));
                }

                // Optimistic Update: 사용자 메시지 즉시 추가
                queryClient.setQueryData(["session", sessionId], (old: any) => {
                    if (!old) return old;

                    const userMessage = {
                        id: tempUserMsgId,
                        session_id: sessionId,
                        role: "user",
                        content: prompt,
                        images: imageData ? JSON.stringify(imageData) : null,
                        timestamp: new Date().toISOString()
                    };

                    return {
                        ...old,
                        messages: [...(old.messages || []), userMessage]
                    };
                });

                console.log("[useSendMessageStream] Sending via /api/chat/stream", {sessionId, promptLength: prompt.length});

                // /api/chat/stream 엔드포인트 사용 (stream-json 파싱)
                const response = await fetch("/api/chat/stream", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({sessionId, prompt, images: imageData})
                });

                console.log("[useSendMessageStream] Response status:", response.status, response.ok);

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error("[useSendMessageStream] Error response:", errorText);
                    throw new Error(`HTTP ${response.status}: ${errorText}`);
                }

                console.log("[useSendMessageStream] Starting SSE stream processing...");

                // SSE 스트리밍 처리
                await processSSEStream(response, sessionId, tempAssistantMsgId, queryClient, {
                    onError: (err) => {
                        setError(err);
                        setIsSending(false);
                    },
                    onComplete: () => {
                        setIsSending(false);
                    }
                });
            } catch (err) {
                console.error("[useSendMessageStream] Error:", err);
                setError(err instanceof Error ? err.message : "Unknown error");
                setIsSending(false);
                // 에러 시 optimistic update rollback
                queryClient.invalidateQueries({queryKey: ["session", sessionId]});
            }
        },
        [queryClient]
    );

    const reset = useCallback(() => {
        setError(null);
        setIsSending(false);
    }, []);

    return {isSending, error, sendMessage, reset};
};

// 답변 제출 Hook
export const useSubmitQuestionAnswer = () => {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const queryClient = useQueryClient();

    const submitAnswer = useCallback(
        async (sessionId: string, toolUseId: string, answers: {questionIndex: number; question: string; selectedOptions: string[]}[]) => {
            setIsSubmitting(true);
            setError(null);

            // 임시 메시지 ID 생성
            const tempAssistantMsgId = `temp-assistant-${Date.now()}`;

            try {
                // 1. POST 요청
                const response = await fetch("/api/chat/tool-result", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({sessionId, toolUseId, answers})
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                // 2. SSE 스트리밍 처리 (공통 헬퍼 사용)
                await processSSEStream(response, sessionId, tempAssistantMsgId, queryClient, {
                    onError: error => {
                        setError(error);
                        setIsSubmitting(false);
                    },
                    onComplete: () => {
                        setIsSubmitting(false);

                        // 모든 questionData를 가진 메시지를 questionSubmitted: true로 설정
                        queryClient.setQueryData(["session", sessionId], (old: any) => {
                            if (!old) return old;

                            const messages = old.messages || [];
                            const updatedMessages = messages.map((msg: any) => {
                                // questionData가 있고 아직 제출되지 않은 메시지를 찾아서 제출 완료로 설정
                                if (msg.questionData && !msg.questionSubmitted) {
                                    return {...msg, questionSubmitted: true};
                                }
                                return msg;
                            });

                            return {...old, messages: updatedMessages};
                        });

                        queryClient.invalidateQueries({queryKey: ["session", sessionId]});
                    }
                });
            } catch (err) {
                console.error("Submit error:", err);
                setError(err instanceof Error ? err.message : "Unknown error");
                setIsSubmitting(false);
            }
        },
        [queryClient]
    );

    return {submitAnswer, isSubmitting, error};
};
