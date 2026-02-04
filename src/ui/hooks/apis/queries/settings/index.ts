import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../utils/api';

// 서버 Config 타입 (src/server/services/config.ts와 동일)
export interface Config {
  version: number;
  server: {
    autoStart: boolean;
  };
  theme: 'system' | 'dark' | 'light';
  language: 'en' | 'ko';
  apiKeys: {
    groq?: string;
    gemini?: string;
    openai?: string;
    claude?: string;
  };
  multiAI: {
    feedbackEnabled: boolean;
    feedbackModel: string;
    quickChatModel: string;
    compressionModel: string;
  };
  compression: {
    enabled: boolean;
    excludeTools: string[];
  };
}

// 설정 조회
export const useSettingsQuery = () => {
  return useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const res = await api.get<Config>('/settings');

      if (res.error) {
        throw new Error(res.error.message);
      }

      return res.data!;
    },
  });
};

// 설정 업데이트
export const useUpdateSettings = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: Partial<Config>) => {
      const res = await api.patch<Config>('/settings', updates);

      if (res.error) {
        throw new Error(res.error.message);
      }

      return res.data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
};
