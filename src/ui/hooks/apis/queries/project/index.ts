import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../utils/api';

interface ProjectPathResponse {
  path: string;
}

// 현재 프로젝트 경로 조회
export const useProjectPath = () => {
  return useQuery({
    queryKey: ['project', 'path'],
    queryFn: async () => {
      const res = await api.get<ProjectPathResponse>('/project/path');

      if (res.error) {
        throw new Error(res.error.message);
      }

      return res.data?.path || '';
    },
    staleTime: Infinity, // 프로젝트 경로는 변경되지 않음
  });
};
