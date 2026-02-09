import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../utils/api';

// 서버 Snippet 타입
interface ServerSnippet {
  id: string;
  trigger: string;
  name: string;
  content: string;
  category: string;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

// 클라이언트 Snippet 타입
export interface Snippet {
  id: string;
  trigger: string;
  name: string;
  value: string;
  category?: string;
  usageCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

// 서버 → 클라이언트 변환
const mapSnippet = (raw: ServerSnippet): Snippet => ({
  id: raw.id,
  trigger: raw.trigger,
  name: raw.name,
  value: raw.content, // content → value
  category: raw.category,
  usageCount: raw.usageCount,
  createdAt: raw.createdAt,
  updatedAt: raw.updatedAt,
});

// 스니펫 목록 조회
export const useSnippetsQuery = () => {
  return useQuery({
    queryKey: ['snippets'],
    queryFn: async () => {
      const res = await api.get<ServerSnippet[]>('/snippets');

      if (res.error) {
        throw new Error(res.error.message);
      }

      return (res.data || []).map(mapSnippet);
    },
  });
};

// 스니펫 생성
export const useCreateSnippet = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      trigger: string;
      name: string;
      value: string;
      category?: string;
    }) => {
      const res = await api.post<ServerSnippet>('/snippets', {
        trigger: data.trigger,
        name: data.name,
        content: data.value, // value → content
        category: data.category || 'general',
      });

      if (res.error) {
        throw new Error(res.error.message);
      }

      return mapSnippet(res.data!);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snippets'] });
    },
  });
};

// 스니펫 수정
export const useUpdateSnippet = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      id: string;
      trigger?: string;
      name?: string;
      value?: string;
      category?: string;
    }) => {
      const { id, value, ...rest } = data;
      const res = await api.patch<ServerSnippet>(`/snippets/${id}`, {
        ...rest,
        content: value, // value → content
      });

      if (res.error) {
        throw new Error(res.error.message);
      }

      return mapSnippet(res.data!);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snippets'] });
    },
  });
};

// 스니펫 삭제
export const useDeleteSnippet = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete(`/snippets/${id}`);

      if (res.error) {
        throw new Error(res.error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snippets'] });
    },
  });
};
