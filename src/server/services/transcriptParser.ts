/**
 * Transcript Parser Service - Claude Code transcript JSONL 파싱
 */

import fs from "fs";

export interface TranscriptEntry {
    type: "user" | "assistant" | "system" | "progress" | "file-history-snapshot";
    uuid?: string;
    message?: {
        role?: string;
        content?: string | Array<{ type: string; text?: string }>;
        model?: string;
        usage?: Record<string, any>;
    };
    data?: Record<string, any>;
    subtype?: string;
    timestamp?: string;
    sessionId?: string;
}

/**
 * JSONL 파일 전체를 파싱하여 엔트리 배열 반환
 */
export const parseTranscript = (filePath: string): TranscriptEntry[] => {
    // 파일 존재 여부 확인
    if (!fs.existsSync(filePath)) {
        throw new Error(`Transcript file not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim() !== "");

    const entries: TranscriptEntry[] = [];

    for (const line of lines) {
        try {
            const entry = JSON.parse(line) as TranscriptEntry;
            entries.push(entry);
        } catch (error) {
            // 파싱 실패한 줄은 skip (로그만)
            console.warn(`Failed to parse transcript line: ${line.substring(0, 100)}...`);
        }
    }

    return entries;
};

/**
 * 파일을 뒤에서부터 읽어 마지막 assistant 응답 텍스트 반환
 */
export const getLastAssistantText = (filePath: string): string | null => {
    const entries = parseTranscript(filePath);

    // 뒤에서부터 검색
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];

        if (entry.type === "assistant" && entry.message?.content) {
            // content가 배열인 경우 (일반적인 경우)
            if (Array.isArray(entry.message.content)) {
                const textParts = entry.message.content
                    .filter((item) => item.type === "text" && item.text)
                    .map((item) => item.text || "");

                if (textParts.length > 0) {
                    return textParts.join("");
                }
            }

            // content가 문자열인 경우 (혹시 모를 경우)
            if (typeof entry.message.content === "string") {
                return entry.message.content;
            }
        }
    }

    return null;
};

/**
 * 특정 UUID 이후의 엔트리들만 반환 (중복 처리 방지용)
 */
export const getEntriesSince = (
    filePath: string,
    afterUuid: string
): TranscriptEntry[] => {
    const entries = parseTranscript(filePath);

    // afterUuid를 찾기
    const startIndex = entries.findIndex((entry) => entry.uuid === afterUuid);

    // 못 찾으면 전체 반환
    if (startIndex === -1) {
        return entries;
    }

    // afterUuid 이후의 엔트리들만 반환 (afterUuid 제외)
    return entries.slice(startIndex + 1);
};

/**
 * 특정 UUID 이후의 새 assistant text 엔트리들을 반환
 * thinking, tool_use 타입은 제외하고 text만 추출
 * 각 엔트리의 uuid와 텍스트를 반환
 */
export const getNewAssistantTexts = (
    filePath: string,
    afterUuid?: string
): Array<{ uuid: string; text: string }> => {
    const entries = parseTranscript(filePath);

    // afterUuid 이후의 엔트리만 필터링
    let startIndex = 0;
    if (afterUuid) {
        const idx = entries.findIndex((entry) => entry.uuid === afterUuid);
        if (idx !== -1) {
            startIndex = idx + 1;
        }
    }

    const results: Array<{ uuid: string; text: string }> = [];

    for (let i = startIndex; i < entries.length; i++) {
        const entry = entries[i];
        if (entry.type !== "assistant" || !entry.uuid || !entry.message?.content) continue;

        if (Array.isArray(entry.message.content)) {
            // text 타입만 추출 (thinking, tool_use 제외)
            const textParts = entry.message.content
                .filter((item) => item.type === "text" && item.text?.trim())
                .map((item) => item.text || "");

            if (textParts.length > 0) {
                results.push({ uuid: entry.uuid, text: textParts.join("") });
            }
        } else if (typeof entry.message.content === "string" && entry.message.content.trim()) {
            results.push({ uuid: entry.uuid, text: entry.message.content });
        }
    }

    return results;
};
