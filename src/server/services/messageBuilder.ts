/**
 * MessageBuilder Service
 *
 * Converts Hooks data (tool usage) into Message format for frontend display.
 * Each tool usage is converted into a user-friendly message with structured metadata.
 */

interface HookToolUseData {
    sessionId: string;
    toolName: string;
    toolInput: any;
    toolOutput?: any;
}

interface MessageContent {
    role: 'assistant';
    content: string;
    toolUsages?: Array<{
        name: string;
        input: any;
        output: any;
    }>;
}

/**
 * Convert PostToolUse hook data to Message format
 */
export const buildMessageFromToolUse = (data: HookToolUseData): MessageContent => {
    const { toolName, toolInput, toolOutput } = data;

    let content = '';

    // Generate user-friendly message based on tool type
    switch (toolName) {
        case 'Write':
            content = `파일을 작성했습니다: ${toolInput.file_path || '알 수 없는 파일'}`;
            break;

        case 'Edit':
            content = `파일을 수정했습니다: ${toolInput.file_path || '알 수 없는 파일'}`;
            break;

        case 'Bash':
            content = `명령을 실행했습니다: ${toolInput.command || '알 수 없는 명령'}`;
            break;

        case 'Read':
            content = `파일을 읽었습니다: ${toolInput.file_path || '알 수 없는 파일'}`;
            break;

        case 'Grep':
            content = `검색했습니다: "${toolInput.pattern || '알 수 없는 패턴'}"`;
            break;

        case 'Glob':
            content = `파일을 찾았습니다: "${toolInput.pattern || '알 수 없는 패턴'}"`;
            break;

        case 'AskUserQuestion':
            // AskUserQuestion은 PreToolUse에서 처리되므로 여기서는 단순 표시
            content = `질문을 표시했습니다`;
            break;

        default:
            // Generic fallback for unknown tools
            content = `${toolName} 도구를 사용했습니다`;
            break;
    }

    return {
        role: 'assistant',
        content,
        toolUsages: [{
            name: toolName,
            input: toolInput || {},
            output: toolOutput || {}
        }]
    };
};

/**
 * Convert text response to Message format
 */
export const buildMessageFromText = (text: string): MessageContent => {
    return {
        role: 'assistant',
        content: text
    };
};

/**
 * Batch convert multiple tool usages into a single message
 * (for cases where multiple tools are used in sequence)
 */
export const buildMessageFromMultipleToolUses = (toolUses: HookToolUseData[]): MessageContent => {
    if (toolUses.length === 0) {
        return {
            role: 'assistant',
            content: '작업을 완료했습니다'
        };
    }

    if (toolUses.length === 1) {
        return buildMessageFromToolUse(toolUses[0]);
    }

    // Multiple tools: create summary
    const toolNames = toolUses.map(t => t.toolName);
    const uniqueTools = [...new Set(toolNames)];

    const content = `${uniqueTools.length}개의 도구를 사용했습니다: ${uniqueTools.join(', ')}`;

    return {
        role: 'assistant',
        content,
        toolUsages: toolUses.map(t => ({
            name: t.toolName,
            input: t.toolInput || {},
            output: t.toolOutput || {}
        }))
    };
};
