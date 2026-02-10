import { useState, useCallback } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { Message } from "../../../../types";
import { api } from "../../../../utils/api";

// snake_case → camelCase 변환 (DB format + SSE format 둘 다 처리)
const convertMessage = (msg: any): Message => ({
  id: msg.id,
  sessionId: msg.session_id || msg.sessionId,
  role: msg.role,
  content: msg.content,
  images: msg.images
    ? typeof msg.images === "string"
      ? JSON.parse(msg.images)
      : msg.images
    : undefined,
  changes: msg.changes
    ? typeof msg.changes === "string"
      ? JSON.parse(msg.changes)
      : msg.changes
    : undefined,
  createdAt: msg.timestamp || msg.created_at || msg.createdAt,
  sequence: msg.sequence,
  isQuestion: msg.isQuestion || msg.is_question || !!msg.question_data || false,
  questionData:
    msg.questionData ||
    (msg.question_data
      ? typeof msg.question_data === "string"
        ? JSON.parse(msg.question_data)
        : msg.question_data
      : undefined),
  questionSubmitted: msg.questionSubmitted || msg.question_submitted === 1,
  questionAnswers:
    msg.questionAnswers ||
    (msg.question_answers
      ? typeof msg.question_answers === "string"
        ? JSON.parse(msg.question_answers)
        : msg.question_answers
      : undefined),
  permissionData: msg.permission_data
    ? (() => {
        const pd =
          typeof msg.permission_data === "string"
            ? JSON.parse(msg.permission_data)
            : msg.permission_data;
        return {
          requestId: pd.requestId,
          toolName: pd.toolName,
          toolInput: pd.toolInput,
          decided: pd.decided,
          behavior: pd.behavior,
          source: pd.source,
        };
      })()
    : undefined,
  toolUsages:
    msg.toolUsages ||
    (msg.tool_usages
      ? typeof msg.tool_usages === "string"
        ? JSON.parse(msg.tool_usages)
        : msg.tool_usages
      : undefined),
});

// 이미지 파일을 Base64로 인코딩
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

// 메시지 목록 조회 (페이지네이션 API 사용)
export const useMessagesQuery = (sessionId?: string) => {
  const data = useInfiniteQuery({
    queryKey: ["messages", sessionId],
    queryFn: async ({ pageParam }: { pageParam: number | undefined }) => {
      const params = new URLSearchParams({ limit: "100" });
      if (typeof pageParam === "number") {
        params.set("beforeSequence", String(pageParam));
      }
      const res = await api.get<any[]>(
        `/sessions/${sessionId}/messages?${params}`,
      );
      if (res.error) throw new Error(res.error.message);
      return {
        data: res.data ?? [],
        hasMore: (res as any).hasMore ?? false,
      };
    },
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore || !lastPage.data.length) return undefined;
      // 첫 번째 메시지 = 현재 페이지에서 가장 오래된 메시지
      const oldest = lastPage.data[0];
      const seq =
        typeof oldest.sequence === "number"
          ? oldest.sequence
          : Number(oldest.sequence);
      return Number.isFinite(seq) ? seq : undefined;
    },
    enabled: !!sessionId,
    staleTime: 0,
    refetchOnMount: "always",
    select: (data) => ({
      messages: [...data.pages]
        .reverse()
        .flatMap((p) => p.data.map(convertMessage))
        .sort((a, b) => {
          // sequence를 기본 정렬 기준으로 사용 (동일 시각 fallback 포함)
          if (a.sequence != null && b.sequence != null && a.sequence !== b.sequence) {
            return a.sequence - b.sequence;
          }
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        }),
      hasMore: data.pages[data.pages.length - 1]?.hasMore ?? false,
    }),
  });

  return data;
};

// 메시지 전송 (PTY 기반 fire-and-forget)
export const useSendMessage = () => {
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(
    async (sessionId: string, clientId: string, prompt: string, images?: File[]) => {
      setIsSending(true);
      setError(null);

      try {
        // 이미지를 Base64로 인코딩
        let imageData: string[] | undefined;
        if (images && images.length > 0) {
          imageData = await Promise.all(images.map(fileToBase64));
        }

        // POST /api/chat/send (fire-and-forget)
        const response = await fetch("/api/chat/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            clientId,
            message: prompt,
            images: imageData,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        // isSending은 SSE turn_complete 이벤트에서 해제됨
        // 여기서는 HTTP 요청 성공만 확인
      } catch (err) {
        console.error("[useSendMessage] Error:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
        setIsSending(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setError(null);
    setIsSending(false);
  }, []);

  const stopSending = useCallback(() => {
    setIsSending(false);
  }, []);

  return { isSending, error, sendMessage, reset, stopSending };
};

// 답변 제출 Hook (PTY 기반 fire-and-forget)
export const useSubmitQuestionAnswer = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitAnswer = useCallback(
    async (
      sessionId: string,
      clientId: string,
      toolUseId: string,
      answers: {
        questionIndex: number;
        question: string;
        selectedOptions: string[];
      }[],
    ) => {
      setIsSubmitting(true);
      setError(null);

      try {
        const response = await fetch("/api/chat/tool-result", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, clientId, toolUseId, answers }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        // isSubmitting은 SSE question_answered 또는 turn_complete에서 해제됨
      } catch (err) {
        console.error("Submit error:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
        setIsSubmitting(false);
      }
    },
    [],
  );

  const stopSubmitting = useCallback(() => {
    setIsSubmitting(false);
  }, []);

  return { submitAnswer, isSubmitting, error, stopSubmitting };
};

// 작업 중단 Hook
export const useStopMessage = () => {
  const [isStopping, setIsStopping] = useState(false);

  const stopMessage = useCallback(async (sessionId: string, clientId?: string | null) => {
    setIsStopping(true);
    try {
      await fetch("/api/chat/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, clientId: clientId ?? undefined }),
      });
    } catch (err) {
      console.error("[useStopMessage] Error:", err);
    } finally {
      setIsStopping(false);
    }
  }, []);

  return { stopMessage, isStopping };
};
