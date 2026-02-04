const API_BASE = '/api';

interface ApiError {
  code: string;
  message: string;
}

interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
  total?: number;
}

export const api = {
  async get<T>(path: string): Promise<ApiResponse<T>> {
    const res = await fetch(`${API_BASE}${path}`);
    return res.json();
  },

  async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  },

  async patch<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  },

  async delete<T>(path: string): Promise<ApiResponse<T>> {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'DELETE',
    });
    return res.json();
  },
};

export type { ApiError, ApiResponse };
