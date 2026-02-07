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

// 이미지 파일을 Base64로 인코딩
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

// 메시지 전송 (PTY 기반 fire-and-forget)
export const useSendMessage = () => {
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const queryClient = useQueryClient();

    const sendMessage = useCallback(
        async (sessionId: string, prompt: string, images?: File[]) => {
            setIsSending(true);
            setError(null);

            // 임시 메시지 ID 생성
            const tempUserMsgId = `temp-user-${Date.now()}`;

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

                // POST /api/chat/send (fire-and-forget)
                const response = await fetch("/api/chat/send", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({sessionId, message: prompt, images: imageData})
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP ${response.status}: ${errorText}`);
                }

                // isSending은 SSE turn_complete 이벤트에서 해제됨
                // 여기서는 HTTP 요청 성공만 확인

            } catch (err) {
                console.error("[useSendMessage] Error:", err);
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

    const stopSending = useCallback(() => {
        setIsSending(false);
    }, []);

    return {isSending, error, sendMessage, reset, stopSending};
};

// 답변 제출 Hook (PTY 기반 fire-and-forget)
export const useSubmitQuestionAnswer = () => {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const queryClient = useQueryClient();

    const submitAnswer = useCallback(
        async (sessionId: string, toolUseId: string, answers: {questionIndex: number; question: string; selectedOptions: string[]}[]) => {
            setIsSubmitting(true);
            setError(null);

            try {
                // POST /api/chat/tool-result (fire-and-forget)
                const response = await fetch("/api/chat/tool-result", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({sessionId, toolUseId, answers})
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                // 질문 제출 완료로 표시
                queryClient.setQueryData(["session", sessionId], (old: any) => {
                    if (!old) return old;

                    const messages = old.messages || [];
                    const updatedMessages = messages.map((msg: any) => {
                        if (msg.questionData && !msg.questionSubmitted) {
                            return {...msg, questionSubmitted: true};
                        }
                        return msg;
                    });

                    return {...old, messages: updatedMessages};
                });

                // isSubmitting은 SSE turn_complete에서 해제됨

            } catch (err) {
                console.error("Submit error:", err);
                setError(err instanceof Error ? err.message : "Unknown error");
                setIsSubmitting(false);
            }
        },
        [queryClient]
    );

    const stopSubmitting = useCallback(() => {
        setIsSubmitting(false);
    }, []);

    return {submitAnswer, isSubmitting, error, stopSubmitting};
};
