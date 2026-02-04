import { useQuery } from '@tanstack/react-query';

interface HealthResponse {
  status: string;
  timestamp: string;
}

export const useHealthQuery = () => {
  return useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch('/health');
      return res.json() as Promise<HealthResponse>;
    },
  });
};
