import {useState, useCallback} from "react";
import {useQueryClient, useInfiniteQuery} from "@tanstack/react-query";
import type {Message} from "../../../../types";
import {api} from "../../../../utils/api";

// snake_case → camelCase 변환 (DB format + SSE format 둘 다 처리)
const convertMessage = (msg: any): Message => ({
    id: msg.id,
    sessionId: msg.session_id || msg.sessionId,
    role: msg.role,
    content: msg.content,
    images: msg.images ? (typeof msg.images === 'string' ? JSON.parse(msg.images) : msg.images) : undefined,
    changes: msg.changes ? (typeof msg.changes === 'string' ? JSON.parse(msg.changes) : msg.changes) : undefined,
    createdAt: msg.timestamp || msg.created_at || msg.createdAt,
    isQuestion: msg.isQuestion || msg.is_question || false,
    questionData: msg.questionData || (msg.question_data ? (typeof msg.question_data === 'string' ? JSON.parse(msg.question_data) : msg.question_data) : undefined),
    questionSubmitted: msg.questionSubmitted || msg.question_submitted === 1,
    toolUsages: msg.toolUsages || (msg.tool_usages ? (typeof msg.tool_usages === 'string' ? JSON.parse(msg.tool_usages) : msg.tool_usages) : undefined),
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

// 메시지 목록 조회 (페이지네이션 API 사용)
export const useMessagesQuery = (sessionId?: string) => {
    return useInfiniteQuery({
        queryKey: ["messages", sessionId],
        queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
            const params = new URLSearchParams({ limit: "100" });
            if (pageParam) params.set("before", pageParam);
            const res = await api.get<{data: any[], hasMore: boolean}>(`/sessions/${sessionId}/messages?${params}`);
            if (res.error) throw new Error(res.error.message);
            return res.data!;
        },
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage) => {
            if (!lastPage.hasMore || !lastPage.data.length) return undefined;
            // 첫 번째 메시지의 timestamp = 가장 오래된 메시지 (ASC 정렬)
            return lastPage.data[0].timestamp;
        },
        enabled: !!sessionId,
        select: (data) => ({
            messages: data.pages.flatMap(p => p.data.map(convertMessage)),
            hasMore: data.pages[data.pages.length - 1]?.hasMore ?? false,
        }),
    });
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
                queryClient.setQueryData(["messages", sessionId], (old: any) => {
                    if (!old) return old;

                    const userMessage = {
                        id: tempUserMsgId,
                        session_id: sessionId,
                        role: "user",
                        content: prompt,
                        images: imageData ? JSON.stringify(imageData) : null,
                        timestamp: new Date().toISOString()
                    };

                    const lastPageIndex = old.pages.length - 1;
                    return {
                        ...old,
                        pages: old.pages.map((page: any, i: number) =>
                            i === lastPageIndex
                                ? { ...page, data: [...page.data, userMessage] }
                                : page
                        ),
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
                queryClient.invalidateQueries({queryKey: ["messages", sessionId]});
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
                queryClient.setQueryData(["messages", sessionId], (old: any) => {
                    if (!old) return old;

                    return {
                        ...old,
                        pages: old.pages.map((page: any) => ({
                            ...page,
                            data: page.data.map((msg: any) => {
                                if (msg.questionData && !msg.questionSubmitted) {
                                    return {...msg, questionSubmitted: true};
                                }
                                return msg;
                            })
                        }))
                    };
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
