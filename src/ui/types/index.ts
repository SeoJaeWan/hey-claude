// 세션 타입
export type SessionType = 'claude-code' | 'quick-chat';
export type SessionSource = 'terminal' | 'web';
export type SessionStatus = 'active' | 'completed';

export interface Session {
  id: string;
  name: string;
  type: SessionType;
  source: SessionSource;
  status: SessionStatus;
  claudeSessionId?: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
  projectPath: string;
  messages?: any[];  // 세션 조회 시 포함되는 메시지 목록 (optional)
}

// 메시지 타입
export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  images?: string[];
  changes?: FileChanges;
  createdAt: string;
}

// 도구 사용 내역
export interface ToolUsage {
  id: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResponse: Record<string, unknown>;
  compressedSummary?: string;
  createdAt: string;
}

// 파일 변경사항
export type FileChangeType = 'added' | 'modified' | 'deleted';

export interface FileChange {
  path: string;
  type?: FileChangeType;
  additions?: number;
  deletions?: number;
}

export interface FileChanges {
  tracked: boolean;
  method: 'clean' | 'partial' | 'none';
  modified: FileChange[];
  added: string[];
  deleted: string[];
  diff?: string;
  summary?: string;
  warning?: string;
}

// 스니펫
export interface Snippet {
  id: string;
  trigger: string;
  name: string;
  content: string;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

// CLI 제공자
export interface CliProvider {
  id: string;
  name: string;
  type: 'cli' | 'api';
  installed?: boolean;
  version?: string;
  loggedIn?: boolean;
  apiKeySet?: boolean;
  description?: string;
}

// 설정
export interface Config {
  version: number;
  server: {
    autoStart: boolean;
  };
  theme: 'light' | 'dark' | 'system';
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

// AI 프로바이더
export type AIProvider = 'groq' | 'gemini' | 'openai' | 'claude';

export interface AIModel {
  id: string;
  name: string;
  provider: AIProvider;
}

// API 응답
export interface APIResponse<T> {
  data: T;
}

export interface APIError {
  error: {
    code: string;
    message: string;
  };
}
