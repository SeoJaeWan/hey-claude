import {useState, useCallback} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {useSessionQuery} from "../session";
import type {Message} from "../../../../types";

// snake_case → camelCase 변환
const convertMessage = (msg: any): Message => ({
    id: msg.id,
    sessionId: msg.session_id,
    role: msg.role,
    content: msg.content,
    images: msg.images ? JSON.parse(msg.images) : undefined,
    changes: msg.changes ? JSON.parse(msg.changes) : undefined,
    createdAt: msg.timestamp || msg.created_at
});

// 이미지 파일을 Base64로 인코딩하는 유틸리티 함수
const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result as string;
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

// 메시지 목록 조회 (기존 세션 API 재활용)
export const useMessagesQuery = (sessionId: string | undefined) => {
    const {data: sessionData, isLoading} = useSessionQuery(sessionId);

    const messages = sessionData?.messages ? (sessionData.messages as any[]).map(convertMessage) : [];

    return {
        data: messages,
        isLoading
    };
};

// SSE 스트리밍 메시지 전송
export const useSendMessageStream = () => {
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamContent, setStreamContent] = useState("");
    const [error, setError] = useState<string | null>(null);
    const queryClient = useQueryClient();

    const sendMessage = useCallback(
        async (sessionId: string, prompt: string, images?: File[]) => {
            setIsStreaming(true);
            setStreamContent("");
            setError(null);

            try {
                // 이미지를 Base64로 인코딩
                let imageData: string[] | undefined;
                if (images && images.length > 0) {
                    imageData = await Promise.all(images.map(fileToBase64));
                }
                const response = await fetch("/api/chat/stream", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({sessionId, prompt, images: imageData})
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const reader = response.body?.getReader();
                if (!reader) {
                    throw new Error("ReadableStream not supported");
                }

                const decoder = new TextDecoder();
                let buffer = "";

                while (true) {
                    const {done, value} = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, {stream: true});
                    const lines = buffer.split("\n\n");

                    // 마지막 불완전한 라인은 버퍼에 남겨둠
                    buffer = lines.pop() || "";

                    for (const line of lines) {
                        if (line.startsWith("data: ")) {
                            try {
                                const data = JSON.parse(line.slice(6));

                                if (data.type === "chunk") {
                                    setStreamContent(prev => prev + data.content);
                                } else if (data.type === "error") {
                                    setError(data.content || data.error);
                                    setIsStreaming(false);
                                } else if (data.type === "done") {
                                    setIsStreaming(false);
                                    // 세션 정보 갱신 (메시지 포함)
                                    queryClient.invalidateQueries({queryKey: ["session", sessionId]});
                                }
                            } catch (e) {
                                console.error("Failed to parse SSE data:", e);
                            }
                        }
                    }
                }
            } catch (err) {
                console.error("SSE streaming error:", err);
                setError(err instanceof Error ? err.message : "Unknown error");
                setIsStreaming(false);
            }
        },
        [queryClient]
    );

    const reset = useCallback(() => {
        setStreamContent("");
        setError(null);
        setIsStreaming(false);
    }, []);

    return {isStreaming, streamContent, error, sendMessage, reset};
};
