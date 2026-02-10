/**
 * Transcript Parser Service - Claude Code transcript JSONL 파싱
 */

import fs from "fs/promises";
import { existsSync } from "fs";

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
 * 증분 읽기: offset부터 파일 끝까지 읽어 새 엔트리와 새 offset 반환
 */
export const parseTranscriptIncremental = async (
    filePath: string,
    fromOffset: number = 0
): Promise<{ entries: TranscriptEntry[]; newOffset: number }> => {
    // 1. 파일 크기 확인
    const stat = await fs.stat(filePath);

    // 파일이 truncate된 경우 (offset이 파일 크기보다 큼) → 처음부터
    const startOffset = fromOffset > stat.size ? 0 : fromOffset;

    if (startOffset >= stat.size) {
        return { entries: [], newOffset: startOffset };
    }

    // 2. offset부터 끝까지 읽기
    const fileHandle = await fs.open(filePath, 'r');
    try {
        const readSize = stat.size - startOffset;
        const buffer = Buffer.alloc(readSize);
        await fileHandle.read(buffer, 0, readSize, startOffset);
        const content = buffer.toString('utf-8');

        // 3. 라인 분할 + 불완전 라인 처리
        const lines = content.split('\n');
        let newOffset = stat.size;

        // 마지막 줄이 줄바꿈 없이 끝난 경우:
        // - JSON 파싱 성공하면 완전한 라인으로 간주해 처리
        // - 실패하면 불완전 라인으로 보고 offset을 되돌려 다음 읽기에서 재시도
        let trailingLine: string | null = null;
        if (lines[lines.length - 1] === '') {
            lines.pop(); // 빈 마지막 요소 제거
        } else {
            trailingLine = lines.pop() ?? null;
        }

        // 4. JSON 파싱
        const entries: TranscriptEntry[] = [];
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                entries.push(JSON.parse(trimmed) as TranscriptEntry);
            } catch {
                console.warn(`Failed to parse transcript line: ${trimmed.substring(0, 100)}...`);
            }
        }

        if (trailingLine !== null) {
            const trimmedTrailing = trailingLine.trim();
            if (trimmedTrailing) {
                try {
                    entries.push(JSON.parse(trimmedTrailing) as TranscriptEntry);
                } catch {
                    // 마지막 줄이 아직 쓰기 중이면 다음 읽기에서 재시도
                    newOffset = stat.size - Buffer.byteLength(trailingLine, 'utf-8');
                }
            }
        }

        return { entries, newOffset };
    } finally {
        await fileHandle.close();
    }
};

/**
 * JSONL 파일 전체를 파싱하여 엔트리 배열 반환 (async 버전)
 */
export const parseTranscript = async (filePath: string): Promise<TranscriptEntry[]> => {
    // 파일 존재 여부 확인
    if (!existsSync(filePath)) {
        throw new Error(`Transcript file not found: ${filePath}`);
    }

    const { entries } = await parseTranscriptIncremental(filePath, 0);
    return entries;
};

/**
 * 파일을 뒤에서부터 읽어 마지막 assistant 응답 텍스트 반환 (async 버전)
 */
export const getLastAssistantText = async (filePath: string): Promise<string | null> => {
    const entries = await parseTranscript(filePath);

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
 * 특정 UUID 이후의 엔트리들만 반환 (중복 처리 방지용, async 버전)
 */
export const getEntriesSince = async (
    filePath: string,
    afterUuid: string
): Promise<TranscriptEntry[]> => {
    const entries = await parseTranscript(filePath);

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
 * 특정 UUID 이후의 새 assistant text 엔트리들을 반환 (증분 읽기 버전)
 * thinking, tool_use 타입은 제외하고 text만 추출
 * 각 엔트리의 uuid와 텍스트를 반환
 */
export const getNewAssistantTexts = async (
    filePath: string,
    afterUuid?: string,
    fromOffset?: number
): Promise<{ results: Array<{ uuid: string; text: string }>; newOffset: number }> => {
    const { entries, newOffset } = await parseTranscriptIncremental(filePath, fromOffset || 0);

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

    return { results, newOffset };
};
