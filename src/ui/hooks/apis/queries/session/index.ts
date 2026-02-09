import {useQuery, useMutation, useQueryClient} from "@tanstack/react-query";
import {useEffect, useRef} from "react";
import {api} from "../../../../utils/api";
import type {Session, SessionStreamStatus} from "../../../../types";
import {useSSEContext} from "../../../../contexts/sse";

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
    updatedAt: raw.updated_at
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
export const useSessionsQuery = () => {
    return useQuery({
        queryKey: ["sessions"],
        queryFn: async () => {
            const res = await api.get<any[]>("/sessions");

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
        mutationFn: async (data: {type: "claude-code" | "quick-chat"; name?: string; model?: string}) => {
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

// 세션 존재 여부 확인 후 없으면 목록 갱신
const ensureSessionInCache = (queryClient: ReturnType<typeof useQueryClient>, sessionId: string): boolean => {
    const sessions = queryClient.getQueryData<Session[]>(["sessions"]);
    const exists = sessions?.some(s => s.id === sessionId) ?? false;

    if (!exists) {
        console.log("[Global SSE] Session not in cache, refreshing list:", sessionId);
        queryClient.invalidateQueries({queryKey: ["sessions"]});
    }

    return exists;
};

// 전역 SSE 연결 (세션 상태 업데이트)
export const useGlobalSSE = () => {
    const queryClient = useQueryClient();
    const {addEventHandler} = useSSEContext();

    useEffect(() => {
        const handler = (data: any) => {
            // session_data_updated: 다른 세션의 데이터가 변경됨 (세션 SSE 끊긴 동안)
            if (data.type === "session_data_updated") {
                const {sessionId: updatedSessionId, eventType} = data;
                console.log("[Global SSE] session_data_updated:", {updatedSessionId, eventType});

                // 해당 세션의 캐시 무효화 → 돌아갔을 때 자동 refetch
                queryClient.invalidateQueries({queryKey: ["session", updatedSessionId]});

                // 세션이 캐시에 없으면 목록 갱신
                const exists = ensureSessionInCache(queryClient, updatedSessionId);

                // turn_complete이면 세션 목록도 갱신 (이미 갱신 안했다면)
                if (eventType === "turn_complete" && exists) {
                    queryClient.invalidateQueries({queryKey: ["sessions"]});
                }
            }
            // session_status 타입 처리
            else if (data.type === "session_status") {
                const {sessionId, status, backgroundTasksCount} = data.data;

                console.log("[Global SSE] Received session_status:", {sessionId, status, backgroundTasksCount});

                // 세션이 캐시에 없으면 목록 갱신 후 리턴
                if (!ensureSessionInCache(queryClient, sessionId)) {
                    return;
                }

                // React Query 캐시 업데이트
                queryClient.setQueryData(["sessions"], (old: Session[] | undefined) => {
                    if (!old) return old;

                    const updated = old.map(session => {
                        if (session.id === sessionId) {
                            return {
                                ...session,
                                streamStatus: status as SessionStreamStatus,
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
                        streamStatus: status as SessionStreamStatus,
                        backgroundTasksCount
                    };
                });
            }
        };

        // Register handler and get cleanup function
        const cleanup = addEventHandler(handler);

        // Return cleanup on unmount
        return cleanup;
    }, [queryClient, addEventHandler]);
};

// 세션별 SSE 연결 (Hooks 이벤트 수신)
export const useSSEConnection = (
    sessionId: string | undefined,
    callbacks?: {
        onTurnComplete?: () => void;
        onLoadingStart?: () => void;
    }
) => {
    const queryClient = useQueryClient();
    const {clientId, subscribe, unsubscribe, addEventHandler} = useSSEContext();

    // callbacks를 ref로 관리하여 의존성 배열에서 제거
    const callbacksRef = useRef(callbacks);
    callbacksRef.current = callbacks;

    useEffect(() => {
        if (!sessionId) return;

        // Subscribe to session
        subscribe(sessionId);

        // 메시지 캐시 무효화 헬퍼
        const invalidateMessages = () => {
            queryClient.invalidateQueries({queryKey: ["messages", sessionId]});
        };

        // Create stable handler
        const handler = (data: any) => {
            // 메시지 데이터 이벤트 → DB에서 refetch
            if (
                data.type === "tool_use_message" ||
                data.type === "ask_user_question" ||
                data.type === "assistant_message" ||
                data.type === "user_message" ||
                data.type === "permission_request" ||
                data.type === "permission_decided" ||
                data.type === "question_answered"
            ) {
                console.log(`[SSE] ${data.type}: invalidating messages`);
                invalidateMessages();
            }
            // turn_complete 처리 (Stop Hook → 로딩 해제 + DB refetch)
            else if (data.type === "turn_complete") {
                console.log("[SSE] turn_complete");
                callbacksRef.current?.onTurnComplete?.();
                invalidateMessages();
            }
            // loading_start 처리 (메시지 전송 시)
            else if (data.type === "loading_start") {
                console.log("[SSE] loading_start");
                callbacksRef.current?.onLoadingStart?.();
            }
            // session_status 처리 (SSE 재연결 시 초기 동기화)
            else if (data.type === "session_status") {
                const statusData = data.data || data;
                const {status, backgroundTasksCount} = statusData;

                // 다른 세션의 status 이벤트는 무시 (global broadcast로 전달될 수 있음)
                if (statusData.sessionId && statusData.sessionId !== sessionId) {
                    return;
                }

                console.log("[SSE] session_status:", status);

                queryClient.setQueryData(["session", sessionId], (old: any) => {
                    if (!old) return old;
                    return {
                        ...old,
                        streamStatus: status,
                        backgroundTasksCount: backgroundTasksCount || 0
                    };
                });
            }
            // error 처리
            else if (data.type === "error") {
                console.error("[SSE] Error:", data.content || data.error);
                queryClient.invalidateQueries({queryKey: ["session", sessionId]});
            }
        };

        // Register handler and get cleanup function
        const cleanupHandler = addEventHandler(handler);

        // Cleanup: unsubscribe and remove handler
        return () => {
            unsubscribe();
            cleanupHandler();
        };
    }, [sessionId, subscribe, unsubscribe, addEventHandler]);

    return {clientId};
};
