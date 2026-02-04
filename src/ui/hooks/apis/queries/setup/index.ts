import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../utils/api';

interface SetupStatus {
  claudeCode: {
    installed: boolean;
    version?: string;
  };
  plugin: {
    installed: boolean;
    version?: string;
  };
}

// Setup 설치 상태 조회
export const useSetupStatusQuery = () => {
  return useQuery({
    queryKey: ['setup', 'status'],
    queryFn: async () => {
      const res = await api.get<SetupStatus>('/setup/status');

      if (res.error) {
        throw new Error(res.error.message);
      }

      return res.data;
    },
    // 5분마다 자동으로 재조회
    refetchInterval: 5 * 60 * 1000,
    // 윈도우 포커스시 재조회
    refetchOnWindowFocus: true,
  });
};
