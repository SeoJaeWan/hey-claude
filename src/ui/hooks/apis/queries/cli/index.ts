import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../utils/api';
import type { CliProvider, CommandInfo } from '../../../../types';

// CLI 도구 상태 조회
export const useCliStatusQuery = () => {
  return useQuery({
    queryKey: ['cli', 'status'],
    queryFn: async () => {
      const res = await api.get<CliProvider[]>('/cli/status');

      if (res.error) {
        throw new Error(res.error.message);
      }

      return res.data;
    },
    // 수동 리프레시만 가능하도록 설정 (사용자가 버튼 클릭시만 새로고침)
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // 초기 로드 시에는 자동으로 조회
    staleTime: Infinity,
  });
};

// 명령어 목록 조회
export const useCommandsQuery = () => {
  return useQuery({
    queryKey: ["cli", "commands"],
    queryFn: async () => {
      const res = await api.get<CommandInfo[]>("/cli/commands");
      if (res.error) throw new Error(res.error.message);
      return res.data || [];
    },
    staleTime: 1000 * 60 * 30, // 30분 캐시
    gcTime: 1000 * 60 * 60, // 1시간 유지 (cacheTime -> gcTime으로 변경)
  });
};
