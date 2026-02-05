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
    createdAt: msg.timestamp || msg.created_at
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

// 메시지 목록 조회 (기존 세션 API 재활용)
export const useMessagesQuery = (sessionId: string | undefined) => {
    const {data: sessionData, isLoading} = useSessionQuery(sessionId);

    const messages = sessionData?.messages ? (sessionData.messages as any[]).map(convertMessage) : [];

    return {
        data: messages,
        isLoading
    };
};

// SSE 스트리밍 메시지 전송 (Optimistic Update)
export const useSendMessageStream = () => {
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamContent, setStreamContent] = useState("");
    const [error, setError] = useState<string | null>(null);
    const queryClient = useQueryClient();

    const sendMessage = useCallback(
        async (sessionId: string, prompt: string, images?: File[]) => {
            setIsStreaming(true);
            setStreamContent("");
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
                queryClient.setQueryData(['session', sessionId], (old: any) => {
                    if (!old) return old;

                    const userMessage = {
                        id: tempUserMsgId,
                        session_id: sessionId,
                        role: 'user',
                        content: prompt,
                        images: imageData ? JSON.stringify(imageData) : null,
                        timestamp: new Date().toISOString()
                    };

                    return {
                        ...old,
                        messages: [...(old.messages || []), userMessage]
                    };
                });

                const response = await fetch("/api/chat/stream", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({sessionId, prompt, images: imageData})
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const reader = response.body?.getReader();
                if (!reader) {
                    throw new Error("ReadableStream not supported");
                }

                const decoder = new TextDecoder();
                let buffer = "";
                let assistantContent = "";
                let isQuestion = false; // 질문 여부 추적

                while (true) {
                    const {done, value} = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, {stream: true});
                    const lines = buffer.split("\n\n");

                    // 마지막 불완전한 라인은 버퍼에 남겨둠
                    buffer = lines.pop() || "";

                    for (const line of lines) {
                        if (line.startsWith("data: ")) {
                            try {
                                const data = JSON.parse(line.slice(6));

                                // chunk와 question 모두 동일하게 처리
                                if (data.type === "chunk" || data.type === "question") {
                                    // question 타입이면 플래그 설정
                                    if (data.type === "question") {
                                        isQuestion = true;
                                    }

                                    assistantContent += data.content;
                                    setStreamContent(assistantContent);

                                    // Optimistic Update: assistant 메시지 업데이트
                                    queryClient.setQueryData(['session', sessionId], (old: any) => {
                                        if (!old) return old;

                                        const messages = old.messages || [];
                                        const lastMsg = messages[messages.length - 1];

                                        // 마지막 메시지가 임시 assistant 메시지면 업데이트
                                        if (lastMsg?.id === tempAssistantMsgId) {
                                            return {
                                                ...old,
                                                messages: [
                                                    ...messages.slice(0, -1),
                                                    {...lastMsg, content: assistantContent, isQuestion}
                                                ]
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
                                                        role: 'assistant',
                                                        content: assistantContent,
                                                        timestamp: new Date().toISOString(),
                                                        isQuestion
                                                    }
                                                ]
                                            };
                                        }
                                    });
                                } else if (data.type === "tool_use") {
                                    // tool_use 이벤트 처리 및 UI 표시
                                    console.log("[SSE] tool_use detected:", data);

                                    // AskUserQuestion인 경우 특별 처리
                                    if (data.tool_name === "AskUserQuestion") {
                                        console.log("[SSE] AskUserQuestion detected, questions:", data.tool_input.questions);

                                        // 질문 안내 텍스트 추가
                                        const questionInfo = `\n❓ 질문이 있습니다. 아래 선택지 중 하나를 골라주세요.\n`;
                                        assistantContent += questionInfo;
                                        setStreamContent(assistantContent);

                                        // questionData 저장
                                        const questionData = {
                                            tool_use_id: data.tool_use_id,
                                            questions: data.tool_input.questions
                                        };

                                        // React Query 캐시 업데이트 (questionData 포함)
                                        queryClient.setQueryData(['session', sessionId], (old: any) => {
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
                                                            isQuestion: true,
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
                                                            role: 'assistant',
                                                            content: assistantContent,
                                                            timestamp: new Date().toISOString(),
                                                            isQuestion: true,
                                                            questionData
                                                        }
                                                    ]
                                                };
                                            }
                                        });
                                    } else {
                                        // 일반 tool_use는 기존 방식대로 처리
                                        const toolInfo = `\n🔧 [${data.tool_name}] 실행 중...\n`;
                                        assistantContent += toolInfo;
                                        setStreamContent(assistantContent);

                                        // React Query 캐시 업데이트
                                        queryClient.setQueryData(['session', sessionId], (old: any) => {
                                            if (!old) return old;

                                            const messages = old.messages || [];
                                            const lastMsg = messages[messages.length - 1];

                                            if (lastMsg?.id === tempAssistantMsgId) {
                                                return {
                                                    ...old,
                                                    messages: [
                                                        ...messages.slice(0, -1),
                                                        {...lastMsg, content: assistantContent}
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
                                                            role: 'assistant',
                                                            content: assistantContent,
                                                            timestamp: new Date().toISOString()
                                                        }
                                                    ]
                                                };
                                            }
                                        });
                                    }
                                } else if (data.type === "error") {
                                    setError(data.content || data.error);
                                    setIsStreaming(false);
                                    // 에러 시 optimistic update rollback
                                    queryClient.invalidateQueries({queryKey: ["session", sessionId]});
                                } else if (data.type === "done") {
                                    setIsStreaming(false);
                                    // done 시에도 refetch (서버에서 실제 ID 받기 위해)
                                    // 하지만 UI는 이미 optimistic update로 표시되어 있음
                                    queryClient.invalidateQueries({queryKey: ["session", sessionId]});
                                }
                            } catch (e) {
                                console.error("Failed to parse SSE data:", e);
                            }
                        }
                    }
                }
            } catch (err) {
                console.error("SSE streaming error:", err);
                setError(err instanceof Error ? err.message : "Unknown error");
                setIsStreaming(false);
                // 에러 시 optimistic update rollback
                queryClient.invalidateQueries({queryKey: ["session", sessionId]});
            }
        },
        [queryClient]
    );

    const reset = useCallback(() => {
        setStreamContent("");
        setError(null);
        setIsStreaming(false);
    }, []);

    return {isStreaming, streamContent, error, sendMessage, reset};
};

// 답변 제출 Hook
export const useSubmitQuestionAnswer = () => {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const queryClient = useQueryClient();

    const submitAnswer = useCallback(async (
        sessionId: string,
        toolUseId: string,
        answers: {questionIndex: number; question: string; selectedOptions: string[]}[]
    ) => {
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

            // 2. SSE 스트리밍 처리
            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error("ReadableStream not supported");
            }

            const decoder = new TextDecoder();
            let buffer = "";
            let assistantContent = "";

            while (true) {
                const {done, value} = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, {stream: true});
                const lines = buffer.split("\n\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        try {
                            const data = JSON.parse(line.slice(6));

                            // chunk 처리
                            if (data.type === "chunk" || data.type === "question") {
                                assistantContent += data.content;

                                // React Query 캐시 업데이트
                                queryClient.setQueryData(['session', sessionId], (old: any) => {
                                    if (!old) return old;

                                    const messages = old.messages || [];
                                    const lastMsg = messages[messages.length - 1];

                                    // 마지막 메시지가 임시 assistant 메시지면 업데이트
                                    if (lastMsg?.id === tempAssistantMsgId) {
                                        return {
                                            ...old,
                                            messages: [
                                                ...messages.slice(0, -1),
                                                {...lastMsg, content: assistantContent}
                                            ]
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
                                                    role: 'assistant',
                                                    content: assistantContent,
                                                    timestamp: new Date().toISOString()
                                                }
                                            ]
                                        };
                                    }
                                });
                            }
                            // tool_use 처리 (새 AskUserQuestion 감지)
                            else if (data.type === "tool_use") {
                                console.log("[SSE] tool_use detected:", data);

                                if (data.tool_name === "AskUserQuestion") {
                                    console.log("[SSE] AskUserQuestion detected, questions:", data.tool_input.questions);

                                    const questionInfo = `\n❓ 질문이 있습니다. 아래 선택지 중 하나를 골라주세요.\n`;
                                    assistantContent += questionInfo;

                                    const questionData = {
                                        tool_use_id: data.tool_use_id,
                                        questions: data.tool_input.questions
                                    };

                                    // React Query 캐시 업데이트
                                    queryClient.setQueryData(['session', sessionId], (old: any) => {
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
                                                        isQuestion: true,
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
                                                        role: 'assistant',
                                                        content: assistantContent,
                                                        timestamp: new Date().toISOString(),
                                                        isQuestion: true,
                                                        questionData
                                                    }
                                                ]
                                            };
                                        }
                                    });
                                } else {
                                    const toolInfo = `\n🔧 [${data.tool_name}] 실행 중...\n`;
                                    assistantContent += toolInfo;

                                    queryClient.setQueryData(['session', sessionId], (old: any) => {
                                        if (!old) return old;

                                        const messages = old.messages || [];
                                        const lastMsg = messages[messages.length - 1];

                                        if (lastMsg?.id === tempAssistantMsgId) {
                                            return {
                                                ...old,
                                                messages: [
                                                    ...messages.slice(0, -1),
                                                    {...lastMsg, content: assistantContent}
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
                                                        role: 'assistant',
                                                        content: assistantContent,
                                                        timestamp: new Date().toISOString()
                                                    }
                                                ]
                                            };
                                        }
                                    });
                                }
                            }
                            // error
                            else if (data.type === "error") {
                                setError(data.content || data.error);
                                setIsSubmitting(false);
                                console.error("[SSE] Error:", data.content || data.error);
                            }
                            // done
                            else if (data.type === "done") {
                                setIsSubmitting(false);
                                queryClient.invalidateQueries({queryKey: ["session", sessionId]});
                            }
                        } catch (e) {
                            console.error("Failed to parse SSE data:", e);
                        }
                    }
                }
            }

        } catch (err) {
            console.error("Submit error:", err);
            setError(err instanceof Error ? err.message : "Unknown error");
            setIsSubmitting(false);
        }
    }, [queryClient]);

    return {submitAnswer, isSubmitting, error};
};
