import { useRef, useCallback, useState, useEffect } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import Message from "../message";
import type { Message as MessageType, QuestionAnswer } from "../../../types";

interface MessageListProps {
  messages: MessageType[];
  isStreaming?: boolean;
  isSubmitting?: boolean;
  onQuestionSubmit?: (
    sessionId: string,
    toolUseId: string,
    answers: QuestionAnswer[],
  ) => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
}

const MessageList = ({
  messages,
  isStreaming = false,
  isSubmitting = false,
  onQuestionSubmit,
  hasMore = false,
  onLoadMore,
  isLoadingMore = false,
}: MessageListProps) => {
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // firstItemIndex: 이전 메시지 prepend 시 스크롤 유지를 위해 사용
  // 초기값을 큰 수로 설정하고, 메시지가 prepend될수록 감소
  const START_INDEX = 100000;
  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX);

  // 메시지 수 변경 추적 (prepend 감지)
  const prevCountRef = useRef(messages.length);
  useEffect(() => {
    const prevCount = prevCountRef.current;
    const newCount = messages.length;
    if (newCount > prevCount) {
      const added = newCount - prevCount;
      setFirstItemIndex((prev) => prev - added);
    }
    prevCountRef.current = newCount;
  }, [messages.length]);

  // 상단 도달 시 이전 메시지 로드
  const handleStartReached = useCallback(() => {
    if (hasMore && !isLoadingMore && onLoadMore) {
      onLoadMore();
    }
  }, [hasMore, isLoadingMore, onLoadMore]);

  console.log(
    isStreaming,
    messages.length > 0,
    messages[messages.length - 1],
    messages[messages.length - 1].role !== "assistant",
  );

  return (
    <div className="flex-1 overflow-hidden">
      {messages.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <p className="text-text-secondary text-sm">메시지가 없습니다</p>
            <p className="text-text-tertiary text-xs mt-1">
              아래 입력창에서 대화를 시작하세요
            </p>
          </div>
        </div>
      ) : (
        <Virtuoso
          ref={virtuosoRef}
          firstItemIndex={firstItemIndex}
          initialTopMostItemIndex={messages.length - 1}
          data={messages}
          startReached={handleStartReached}
          followOutput="smooth"
          itemContent={(_, message: MessageType) => (
            <div className="max-w-3xl mx-auto py-1.5">
              <Message
                key={message.id}
                message={message}
                isSubmitting={isSubmitting}
                onQuestionSubmit={onQuestionSubmit}
              />
            </div>
          )}
          components={{
            Header: () =>
              isLoadingMore ? (
                <div className="max-w-3xl mx-auto px-6 text-center py-2">
                  <span className="text-text-tertiary text-sm">
                    이전 메시지 로딩 중...
                  </span>
                </div>
              ) : null,
            Footer: () =>
              isStreaming ? (
                <div className="max-w-3xl mx-auto py-3 pb-36">
                  <div className="flex justify-start">
                    <div className="max-w-[85%]">
                      <div className="px-4 py-3 rounded-2xl bg-bubble-assistant text-text-primary border border-border-default">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 bg-text-tertiary rounded-full animate-bounce [animation-delay:0ms]" />
                          <span className="w-2 h-2 bg-text-tertiary rounded-full animate-bounce [animation-delay:150ms]" />
                          <span className="w-2 h-2 bg-text-tertiary rounded-full animate-bounce [animation-delay:300ms]" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="pb-36" />
              ),
          }}
        />
      )}
    </div>
  );
};

export default MessageList;
