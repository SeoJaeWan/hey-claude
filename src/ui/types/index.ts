// 세션 타입
export type SessionType = "claude-code" | "quick-chat";
export type SessionSource = "terminal" | "web";
export type SessionStatus = "active" | "completed";
export type SessionStreamStatus = "idle" | "streaming" | "background_tasks";

export interface Session {
    id: string;
    name: string;
    type: SessionType;
    source: SessionSource;
    status: SessionStatus;
    streamStatus?: SessionStreamStatus; // SSE 스트리밍 상태
    backgroundTasksCount?: number; // 백그라운드 작업 수
    claudeSessionId?: string;
    model?: string;
    createdAt: string;
    updatedAt: string;
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
    source?: "terminal" | "web"; // CLI vs Web 세션 구분
}

export interface QuestionAnswer {
    questionIndex: number;       // 질문 인덱스 (0부터 시작)
    question: string;            // 질문 텍스트 (원본)
    selectedOptions: string[];   // 선택된 옵션들 (label 배열)
}

export interface PermissionRequestData {
    requestId: string;
    toolName: string;
    toolInput: any;
    decided?: boolean;
    behavior?: "allow" | "deny";
    source?: "terminal" | "web"; // CLI vs Web 세션 구분
}

export interface Message {
    id: string;
    sessionId: string;
    role: MessageRole;
    content: string;
    images?: string[];
    changes?: FileChanges;
    createdAt: string;
    sequence?: number; // 메시지 순서 보장용
    isQuestion?: boolean; // 질문 여부 (type: "question"일 때 true)
    questionData?: QuestionData; // AskUserQuestion 구조화된 데이터
    questionSubmitted?: boolean; // 답변 제출 여부
    questionAnswers?: QuestionAnswer[]; // 제출된 답변 (선택 결과 유지용)
    permissionData?: PermissionRequestData; // 권한 요청 데이터
    toolUsages?: Array<{
        name: string;
        input: any;
        output: any;
    }>; // 도구 사용 메타데이터 (Hooks 데이터 기반)
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

// SSE 이벤트 타입
export interface AssistantMessageEvent {
    type: "assistant_message";
    sessionId: string;
    message: {
        id: string;
        sessionId: string;
        role: "assistant";
        content: string;
        createdAt: string;
    };
}

export interface TurnCompleteEvent {
    type: "turn_complete";
    sessionId: string;
}

export interface LoadingStartEvent {
    type: "loading_start";
    sessionId: string;
}
