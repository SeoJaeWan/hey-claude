// 세션 타입
export type SessionType = "claude-code" | "quick-chat";
export type SessionSource = "terminal" | "web";
export type SessionStatus = "active" | "completed";

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
    messages?: Message[]; // 세션 조회 시 포함되는 메시지 목록 (optional)
}

// 메시지 타입
export type MessageRole = "user" | "assistant" | "system";

export interface QuestionOption {
    label: string;
    description: string;
}

export interface QuestionItem {
    question: string;
    header: string;
    multiSelect: boolean;
    options: QuestionOption[];
}

export interface QuestionData {
    tool_use_id: string;
    questions: QuestionItem[];
}

export interface QuestionAnswer {
    questionIndex: number;       // 질문 인덱스 (0부터 시작)
    question: string;            // 질문 텍스트 (원본)
    selectedOptions: string[];   // 선택된 옵션들 (label 배열)
}

export interface Message {
    id: string;
    sessionId: string;
    role: MessageRole;
    content: string;
    images?: string[];
    changes?: FileChanges;
    createdAt: string;
    isQuestion?: boolean; // 질문 여부 (type: "question"일 때 true)
    questionData?: QuestionData; // AskUserQuestion 구조화된 데이터
    questionSubmitted?: boolean; // 답변 제출 여부
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
export type FileChangeType = "added" | "modified" | "deleted";

export interface FileChange {
    path: string;
    type?: FileChangeType;
    additions?: number;
    deletions?: number;
}

export interface FileChanges {
    tracked: boolean;
    method: "clean" | "partial" | "none";
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
    type: "cli" | "api";
    installed?: boolean;
    version?: string;
    loggedIn?: boolean;
    apiKeySet?: boolean;
    description?: string;
}

// CLI 명령어
export interface CommandInfo {
    name: string;
    trigger: string;
    description: string;
    source: 'local' | 'builtin';
    allowedTools?: string[];
}

// 설정
export interface Config {
    version: number;
    server: {
        autoStart: boolean;
    };
    theme: "light" | "dark" | "system";
    language: "en" | "ko";
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
export type AIProvider = "groq" | "gemini" | "openai" | "claude";

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
