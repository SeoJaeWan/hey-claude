/**
 * 컨텍스트 조회 및 생성 서비스
 */

import { getDatabase } from "./database.js";

interface ContextOptions {
    sessionId?: string;
}

export const getRecentContext = async (
    options: ContextOptions = {}
): Promise<string | null> => {
    try {
        const db = getDatabase();
        const projectPath = process.cwd();

        // 최근 세션의 압축된 도구 사용 내역 조회
        const toolUsages = db
            .prepare(
                `
            SELECT compressed_type, compressed_title, compressed_content
            FROM tool_usages
            WHERE session_id IN (
                SELECT id FROM sessions
                WHERE project_path = ?
                AND status = 'completed'
                ORDER BY updated_at DESC
                LIMIT 3
            )
            AND compressed_content IS NOT NULL
            ORDER BY timestamp DESC
            LIMIT 20
        `
            )
            .all(projectPath);

        if (toolUsages.length === 0) {
            return null;
        }

        // 컨텍스트 형식으로 변환
        const context = toolUsages
            .map((usage: any) => {
                const icon = getIconByType(usage.compressed_type);
                return `- ${icon} ${usage.compressed_title}`;
            })
            .join("\n");

        return `## 최근 작업 내역\n\n${context}`;
    } catch (error) {
        console.error("Failed to get recent context:", error);
        return null;
    }
};

const getIconByType = (
    type: "gotcha" | "problem-solution" | "info" | "decision"
): string => {
    const icons = {
        gotcha: "🔴",
        "problem-solution": "🟡",
        info: "🔵",
        decision: "🟤",
    };
    return icons[type] || "🔵";
};
