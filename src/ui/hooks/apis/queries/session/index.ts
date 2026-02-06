import {useQuery, useMutation, useQueryClient} from "@tanstack/react-query";
import {useEffect} from "react";
import {api} from "../../../../utils/api";
import type {Session, SessionStreamStatus} from "../../../../types";

// snake_case → camelCase 변환 함수
const mapSession = (raw: any): Session => ({
    id: raw.id,
    name: raw.name,
    type: raw.type,
    source: raw.source,
    status: raw.status,
    streamStatus: (raw.currentStatus || raw.stream_status) as SessionStreamStatus | undefined,
    backgroundTasksCount: raw.backgroundTasksCount || raw.background_tasks_count || 0,
    claudeSessionId: raw.claude_session_id,
    model: raw.model,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    projectPath: raw.project_path,
    messages: raw.messages
});

// 세션 정렬 함수
// 우선순위: background_tasks > streaming > updated_at (최신순)
export const sortSessions = (sessions: Session[]): Session[] => {
    return [...sessions].sort((a, b) => {
        // 1. background_tasks 우선
        const aIsBg = a.streamStatus === "background_tasks";
        const bIsBg = b.streamStatus === "background_tasks";
        if (aIsBg && !bIsBg) return -1;
        if (!aIsBg && bIsBg) return 1;

        // 2. streaming 우선
        const aIsStreaming = a.streamStatus === "streaming";
        const bIsStreaming = b.streamStatus === "streaming";
        if (aIsStreaming && !bIsStreaming) return -1;
        if (!aIsStreaming && bIsStreaming) return 1;

        // 3. updated_at 최신순
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
};

// 세션 목록 조회
export const useSessionsQuery = (projectPath?: string) => {
    return useQuery({
        queryKey: ["sessions", projectPath],
        queryFn: async () => {
            const query = projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : "";
            const res = await api.get<any[]>(`/sessions${query}`);

            if (res.error) {
                throw new Error(res.error.message);
            }

            const sessions = (res.data || []).map(mapSession);
            return sortSessions(sessions);
        }
    });
};

// 세션 상세 조회
export const useSessionQuery = (sessionId?: string) => {
    return useQuery({
        queryKey: ["session", sessionId],
        queryFn: async () => {
            if (!sessionId) return null;

            const res = await api.get<any>(`/sessions/${sessionId}`);

            if (res.error) {
                throw new Error(res.error.message);
            }

            return res.data ? mapSession(res.data) : null;
        },
        enabled: !!sessionId
    });
};

// 세션 생성
export const useCreateSession = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (data: {type: "claude-code" | "quick-chat"; name?: string; projectPath: string; model?: string}) => {
            const res = await api.post<any>("/sessions", data);

            if (res.error) {
                throw new Error(res.error.message);
            }

            return mapSession(res.data);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({queryKey: ["sessions"]});
        }
    });
};

// 세션 수정 (이름 변경 등)
export const useUpdateSession = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({id, ...data}: {id: string; name?: string; status?: string}) => {
            const res = await api.patch<any>(`/sessions/${id}`, data);

            if (res.error) {
                throw new Error(res.error.message);
            }

            return mapSession(res.data);
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({queryKey: ["sessions"]});
            queryClient.invalidateQueries({queryKey: ["session", variables.id]});
        }
    });
};

// 세션 삭제
export const useDeleteSession = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (sessionId: string) => {
            const res = await api.delete(`/sessions/${sessionId}`);

            if (res.error) {
                throw new Error(res.error.message);
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({queryKey: ["sessions"]});
        }
    });
};

// 전역 SSE 연결 (세션 상태 업데이트)
export const useGlobalSSE = (projectPath?: string) => {
    const queryClient = useQueryClient();

    useEffect(() => {
        // EventSource 연결
        const eventSource = new EventSource("/api/sse/global");

        eventSource.addEventListener("session_status_update", (event) => {
            try {
                const data = JSON.parse(event.data);
                const {sessionId, streamStatus, backgroundTasksCount} = data;

                // React Query 캐시 업데이트
                queryClient.setQueryData(["sessions", projectPath], (old: Session[] | undefined) => {
                    if (!old) return old;

                    const updated = old.map((session) => {
                        if (session.id === sessionId) {
                            return {
                                ...session,
                                streamStatus: streamStatus as SessionStreamStatus,
                                backgroundTasksCount
                            };
                        }
                        return session;
                    });

                    // 정렬 적용
                    return sortSessions(updated);
                });

                // 세션 상세 캐시도 업데이트
                queryClient.setQueryData(["session", sessionId], (old: Session | undefined) => {
                    if (!old) return old;
                    return {
                        ...old,
                        streamStatus: streamStatus as SessionStreamStatus,
                        backgroundTasksCount
                    };
                });
            } catch (error) {
                console.error("Failed to parse session_status_update:", error);
            }
        });

        eventSource.addEventListener("error", (error) => {
            console.error("Global SSE error:", error);
        });

        // 컴포넌트 unmount 시 연결 해제
        return () => {
            eventSource.close();
        };
    }, [queryClient, projectPath]);
};

// 세션별 SSE 연결 (메시지 스트리밍)
export const useSSEConnection = (sessionId: string | undefined) => {
    const queryClient = useQueryClient();

    useEffect(() => {
        if (!sessionId) return;

        // EventSource 연결
        const eventSource = new EventSource(`/api/sse/${sessionId}`);

        const tempAssistantMsgId = `temp-assistant-${Date.now()}`;
        let assistantContent = "";
        let isQuestion = false;

        eventSource.addEventListener("message", (event) => {
            try {
                const data = JSON.parse(event.data);

                // chunk 또는 question 처리
                if (data.type === "chunk" || data.type === "question") {
                    if (data.type === "question") {
                        isQuestion = true;
                    }

                    assistantContent += data.content;

                    // React Query 캐시 업데이트
                    queryClient.setQueryData(["session", sessionId], (old: any) => {
                        if (!old) return old;

                        const messages = old.messages || [];
                        const lastMsg = messages[messages.length - 1];

                        if (lastMsg?.id === tempAssistantMsgId) {
                            return {
                                ...old,
                                messages: [...messages.slice(0, -1), {...lastMsg, content: assistantContent, isQuestion}]
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
                                        isQuestion
                                    }
                                ]
                            };
                        }
                    });
                }
                // tool_use 처리
                else if (data.type === "tool_use") {
                    if (data.tool_name === "AskUserQuestion") {
                        const questionData = {
                            tool_use_id: data.tool_use_id,
                            questions: data.tool_input.questions
                        };

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
                                            role: "assistant",
                                            content: assistantContent,
                                            timestamp: new Date().toISOString(),
                                            isQuestion: true,
                                            questionData
                                        }
                                    ]
                                };
                            }
                        });
                    }
                }
                // done 처리
                else if (data.type === "done") {
                    // 서버 데이터 동기화
                    queryClient.invalidateQueries({queryKey: ["session", sessionId]});

                    // 상태 초기화
                    assistantContent = "";
                    isQuestion = false;
                }
                // error 처리
                else if (data.type === "error") {
                    console.error("[SSE] Error:", data.content || data.error);
                    queryClient.invalidateQueries({queryKey: ["session", sessionId]});
                }
            } catch (error) {
                console.error("Failed to parse SSE message:", error);
            }
        });

        eventSource.addEventListener("error", (error) => {
            console.error("Session SSE error:", error);
        });

        // 컴포넌트 unmount 시 연결 해제
        return () => {
            eventSource.close();
        };
    }, [sessionId, queryClient]);
};
