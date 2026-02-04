import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../utils/api';

// 피드백 요청 (POST /api/ai/feedback)
export const useFeedbackMutation = () => {
  return useMutation({
    mutationFn: async (prompt: string) => {
      const res = await api.post<{ feedback: string }>('/ai/feedback', { prompt });

      if (res.error) {
        throw new Error(res.error.message);
      }

      return res.data?.feedback || '';
    },
  });
};

// 컨텍스트 요약 요청 (POST /api/ai/summary)
export const useSummaryMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await api.post<{ summary: string }>('/ai/summary', { sessionId });

      if (res.error) {
        throw new Error(res.error.message);
      }

      return res.data?.summary || '';
    },
    onSuccess: (_, sessionId) => {
      // 요약 후 해당 세션의 메시지와 세션 정보 갱신
      queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
    },
  });
};

// 모델 정보
interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  contextWindow?: number;
  maxOutput?: number;
}

interface ProviderModels {
  available: boolean;
  models: ModelInfo[];
}

interface AvailableModels {
  groq: ProviderModels;
  gemini: ProviderModels;
  openai: ProviderModels;
  claude: ProviderModels;
}

// 사용 가능한 모델 조회 (GET /api/ai/models)
export const useModelsQuery = () => {
  return useQuery({
    queryKey: ['ai', 'models'],
    queryFn: async () => {
      const res = await api.get<AvailableModels>('/ai/models');

      if (res.error) {
        throw new Error(res.error.message);
      }

      return res.data;
    },
    staleTime: 5 * 60 * 1000, // 5분간 캐시
  });
};
