import {useQuery, useMutation, useQueryClient} from "@tanstack/react-query";
import {api} from "../../../../utils/api";
import type {Session} from "../../../../types";

// snake_case → camelCase 변환 함수
const mapSession = (raw: any): Session => ({
    id: raw.id,
    name: raw.name,
    type: raw.type,
    source: raw.source,
    status: raw.status,
    claudeSessionId: raw.claude_session_id,
    model: raw.model,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    projectPath: raw.project_path,
    messages: raw.messages
});

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

            return (res.data || []).map(mapSession);
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
