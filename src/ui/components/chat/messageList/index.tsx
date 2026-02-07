import { useRef, useState, useEffect } from "react";
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
}

const MessageList = ({
  messages,
  isStreaming = false,
  isSubmitting = false,
  onQuestionSubmit,
}: MessageListProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const userScrollTimeoutRef = useRef<NodeJS.Timeout>();

  // 스크롤 이벤트 핸들러
  const handleScroll = () => {
    const container = scrollRef.current;
    if (!container) return;

    // 하단 근처인지 확인 (100px 임계값)
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      100;

    if (!isNearBottom) {
      setIsUserScrolling(true);
      clearTimeout(userScrollTimeoutRef.current);
    } else {
      setIsUserScrolling(false);
    }
  };

  // 메시지 변경 시 자동 스크롤
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || isUserScrolling) return;

    container.scrollTop = container.scrollHeight;
  }, [messages, isStreaming, isUserScrolling]);

  // cleanup: 컴포넌트 unmount 시 timeout clear
  useEffect(() => {
    return () => {
      clearTimeout(userScrollTimeoutRef.current);
    };
  }, []);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto px-6 py-6 pb-36"
      onScroll={handleScroll}
    >
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
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
          <>
            {messages.map((message, index) => {
              // 마지막 assistant 메시지에만 isStreaming 전달
              const isLastAssistant =
                index === messages.length - 1 && message.role === "assistant";
              const showStreaming = isLastAssistant && isStreaming;

              return (
                <Message
                  key={message.id}
                  message={message}
                  isStreaming={showStreaming}
                  isSubmitting={isSubmitting}
                  onQuestionSubmit={onQuestionSubmit}
                />
              );
            })}
            {/* thinking indicator: assistant 응답 대기 중 */}
            {isStreaming && messages.length > 0 && messages[messages.length - 1].role !== "assistant" && (
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
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default MessageList;
