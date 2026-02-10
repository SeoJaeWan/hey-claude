import {
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import Message from "../message";
import type { Message as MessageType } from "../../../types";

export interface MessageListHandle {
  scrollToBottom: () => void;
}

interface MessageListProps {
  messages: MessageType[];
  clientId?: string | null;
  isStreaming?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  onAtBottomStateChange?: (atBottom: boolean) => void;
}

const MessageList = forwardRef<MessageListHandle, MessageListProps>(
  (
    {
      messages,
      clientId,
      isStreaming = false,
      hasMore = false,
      onLoadMore,
      isLoadingMore = false,
      onAtBottomStateChange,
    },
    ref,
  ) => {
    const virtuosoRef = useRef<VirtuosoHandle>(null);

    useImperativeHandle(ref, () => ({
      scrollToBottom: () => {
        virtuosoRef.current?.scrollToIndex({
          index: messages.length - 1,
          behavior: "smooth",
        });
      },
    }));

    // sequence를 virtual index로 사용해 prepend/append 모두 안정적으로 처리
    const firstItemIndex = messages[0]?.sequence ?? 0;

    // 상단 도달 시 이전 메시지 로드
    const handleStartReached = useCallback(() => {
      if (hasMore && !isLoadingMore && onLoadMore) {
        onLoadMore();
      }
    }, [hasMore, isLoadingMore, onLoadMore]);

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
            computeItemKey={(_, message: MessageType) =>
              message.sequence ?? message.id
            }
            startReached={handleStartReached}
            atBottomStateChange={onAtBottomStateChange}
            followOutput="smooth"
            itemContent={(_, message: MessageType) => (
              <div className="max-w-3xl mx-auto py-1.5">
                <Message key={message.id} message={message} clientId={clientId} />
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
  },
);

MessageList.displayName = "MessageList";

export default MessageList;
