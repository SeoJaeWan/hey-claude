import {useQuery, useMutation, useQueryClient} from "@tanstack/react-query";
import {useEffect, useRef} from "react";
import {api} from "../../../../utils/api";
import type {Session, SessionStreamStatus} from "../../../../types";
import {useSSEContext} from "../../../../contexts/sse";

// 메시지를 타임스탬프 + sequence 기준으로 정렬된 위치에 삽입하는 헬퍼
const insertMessageSorted = (pages: any[], newMsg: any): any[] => {
    // 마지막 페이지에서 올바른 위치를 찾아 삽입
    const lastPageIndex = pages.length - 1;
    const newMsgTime = new Date(newMsg.timestamp).getTime();
    const newMsgSeq = newMsg.sequence ?? Number.MAX_SAFE_INTEGER;

    return pages.map((page, i) => {
        if (i !== lastPageIndex) return page;

        // 마지막 페이지의 메시지들에서 올바른 삽입 위치 찾기
        const data = [...page.data];
        let insertIndex = data.length; // 기본: 맨 끝

        // 역순으로 탐색하여 새 메시지보다 이전인 첫 메시지를 찾음
        for (let j = data.length - 1; j >= 0; j--) {
            const msgTime = new Date(data[j].timestamp).getTime();
            const msgSeq = data[j].sequence ?? 0;

            // timestamp가 같으면 sequence로 비교
            if (msgTime < newMsgTime || (msgTime === newMsgTime && msgSeq <= newMsgSeq)) {
                insertIndex = j + 1;
                break;
            }
            if (j === 0) {
                insertIndex = 0; // 모든 메시지보다 이전
            }
        }

        // 삽입
        data.splice(insertIndex, 0, newMsg);

        return {...page, data};
    });
};

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
    const {subscribe, unsubscribe, addEventHandler} = useSSEContext();

    // callbacks를 ref로 관리하여 의존성 배열에서 제거
    const callbacksRef = useRef(callbacks);
    callbacksRef.current = callbacks;

    useEffect(() => {
        if (!sessionId) return;

        // Subscribe to session
        subscribe(sessionId);

        // Create stable handler
        const handler = (data: any) => {
            // tool_use_message 처리 (PostToolUse Hook)
            if (data.type === "tool_use_message") {
                const message = data.message;
                console.log("[SSE] tool_use_message:", message.id);

                queryClient.setQueryData(["messages", sessionId], (old: any) => {
                    if (!old) return old;
                    const rawMsg = {
                        id: message.id,
                        session_id: message.sessionId,
                        role: message.role,
                        content: message.content,
                        toolUsages: message.toolUsages,
                        timestamp: message.createdAt,
                        sequence: message.sequence
                    };

                    // 중복 체크
                    const isDuplicate = old.pages.some((page: any) => page.data.some((m: any) => m.id === rawMsg.id));
                    if (isDuplicate) return old;

                    return {
                        ...old,
                        pages: insertMessageSorted(old.pages, rawMsg)
                    };
                });
            }
            // ask_user_question 처리 (PreToolUse Hook)
            else if (data.type === "ask_user_question") {
                console.log("[SSE] ask_user_question:", data.toolUseId, "source:", data.source);

                const questionData = {
                    tool_use_id: data.toolUseId,
                    questions: data.questions,
                    source: data.source || "web" // CLI vs Web 구분
                };
                const questionMsgId = `question-${data.toolUseId}`;

                queryClient.setQueryData(["messages", sessionId], (old: any) => {
                    if (!old) return old;
                    const rawMsg = {
                        id: questionMsgId,
                        session_id: sessionId,
                        role: "assistant",
                        content: "",
                        timestamp: data.createdAt || new Date().toISOString(),
                        sequence: data.sequence,
                        isQuestion: true,
                        questionData
                    };

                    // 중복 체크
                    const isDuplicate = old.pages.some((page: any) => page.data.some((m: any) => m.id === questionMsgId));
                    if (isDuplicate) return old;

                    return {
                        ...old,
                        pages: insertMessageSorted(old.pages, rawMsg)
                    };
                });
            }
            // assistant_message 처리 (Stop Hook → transcript 파싱 결과)
            else if (data.type === "assistant_message") {
                const message = data.message;
                console.log("[SSE] assistant_message:", message.id, `(${message.content?.length} chars)`);

                queryClient.setQueryData(["messages", sessionId], (old: any) => {
                    if (!old) return old;
                    const rawMsg = {
                        id: message.id,
                        session_id: message.sessionId,
                        role: "assistant",
                        content: message.content,
                        timestamp: message.createdAt,
                        sequence: message.sequence
                    };

                    // 중복 체크
                    const isDuplicate = old.pages.some((page: any) => page.data.some((m: any) => m.id === rawMsg.id));
                    if (isDuplicate) return old;

                    return {
                        ...old,
                        pages: insertMessageSorted(old.pages, rawMsg)
                    };
                });
            }
            // user_message 처리 (UserPromptSubmit Hook)
            else if (data.type === "user_message") {
                const message = data.message;
                console.log("[SSE] user_message:", message.id);

                queryClient.setQueryData(["messages", sessionId], (old: any) => {
                    if (!old) return old;
                    const rawMsg = {
                        id: message.id,
                        session_id: message.sessionId,
                        role: "user",
                        content: message.content,
                        timestamp: message.createdAt,
                        sequence: message.sequence
                    };

                    // 중복 체크
                    const isDuplicate = old.pages.some((page: any) => page.data.some((m: any) => m.id === rawMsg.id));
                    if (isDuplicate) return old;

                    return {
                        ...old,
                        pages: insertMessageSorted(old.pages, rawMsg)
                    };
                });
            }
            // permission_request 처리 (PermissionRequest Hook)
            else if (data.type === "permission_request") {
                // requestId가 없으면 timestamp 기반 ID 생성 (CLI notify용)
                const requestId = data.requestId || `notify-${Date.now()}`;
                const permMsgId = `permission-${requestId}`;
                console.log("[SSE] permission_request:", requestId, "source:", data.source);

                queryClient.setQueryData(["messages", sessionId], (old: any) => {
                    if (!old) return old;
                    const rawMsg = {
                        id: permMsgId,
                        session_id: sessionId,
                        role: "assistant",
                        content: "",
                        timestamp: new Date().toISOString(),
                        permission_data: {
                            requestId: requestId,
                            toolName: data.toolName,
                            toolInput: data.toolInput,
                            decided: false,
                            source: data.source || "web" // CLI vs Web 구분
                        }
                    };

                    const isDuplicate = old.pages.some((page: any) => page.data.some((m: any) => m.id === permMsgId));
                    if (isDuplicate) return old;

                    return {
                        ...old,
                        pages: insertMessageSorted(old.pages, rawMsg)
                    };
                });
            }
            // permission_decided 처리 (사용자 결정 또는 만료)
            else if (data.type === "permission_decided") {
                const permMsgId = `permission-${data.requestId}`;
                console.log("[SSE] permission_decided:", data.requestId, data.behavior);

                queryClient.setQueryData(["messages", sessionId], (old: any) => {
                    if (!old) return old;
                    return {
                        ...old,
                        pages: old.pages.map((page: any) => ({
                            ...page,
                            data: page.data.map((msg: any) => {
                                if (msg.id === permMsgId && msg.permission_data) {
                                    return {
                                        ...msg,
                                        permission_data: {
                                            ...msg.permission_data,
                                            decided: true,
                                            behavior: data.behavior || null
                                        }
                                    };
                                }
                                return msg;
                            })
                        }))
                    };
                });
            }
            // question_answered 처리 (PostToolUse AskUserQuestion → 답변 결과)
            else if (data.type === "question_answered") {
                console.log("[SSE] question_answered");

                queryClient.setQueryData(["messages", sessionId], (old: any) => {
                    if (!old) return old;
                    return {
                        ...old,
                        pages: old.pages.map((page: any) => ({
                            ...page,
                            data: page.data.map((msg: any) => {
                                // 세션 기반 매칭: pending question 찾기
                                if (msg.isQuestion && msg.questionData && !msg.questionSubmitted) {
                                    return {
                                        ...msg,
                                        questionSubmitted: true,
                                        questionAnswers: data.answers
                                    };
                                }
                                return msg;
                            })
                        }))
                    };
                });
            }
            // turn_complete 처리 (Stop Hook → 로딩 해제)
            else if (data.type === "turn_complete") {
                console.log("[SSE] turn_complete");
                callbacksRef.current?.onTurnComplete?.();

                // Stale UI cleanup: mark pending questions as submitted and pending permissions as expired
                queryClient.setQueryData(["messages", sessionId], (old: any) => {
                    if (!old) return old;
                    let hasChanges = false;
                    const updated = {
                        ...old,
                        pages: old.pages.map((page: any) => ({
                            ...page,
                            data: page.data.map((msg: any) => {
                                // Pending question → submitted
                                if (msg.isQuestion && msg.questionData && !msg.questionSubmitted) {
                                    hasChanges = true;
                                    return {...msg, questionSubmitted: true};
                                }
                                // Pending permission → expired
                                if (msg.permission_data && !msg.permission_data.decided) {
                                    hasChanges = true;
                                    return {
                                        ...msg,
                                        permission_data: {...msg.permission_data, decided: true}
                                    };
                                }
                                return msg;
                            })
                        }))
                    };
                    return hasChanges ? updated : old;
                });
            }
            // loading_start 처리 (메시지 전송 시)
            else if (data.type === "loading_start") {
                console.log("[SSE] loading_start");
                callbacksRef.current?.onLoadingStart?.();
            }
            // session_status 처리 (SSE 재연결 시 초기 동기화)
            else if (data.type === "session_status") {
                const {status, backgroundTasksCount} = data.data || data;
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
};
