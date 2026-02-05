import Message from "../message";
import type {Message as MessageType, QuestionAnswer} from "../../../types";

interface MessageListProps {
    messages: MessageType[];
    isStreaming?: boolean;
    isSubmitting?: boolean;
    onQuestionSubmit?: (sessionId: string, toolUseId: string, answers: QuestionAnswer[]) => void;
}

const MessageList = ({messages, isStreaming = false, isSubmitting = false, onQuestionSubmit}: MessageListProps) => {
    return (
        <div className="flex-1 overflow-y-auto px-6 py-6 pb-36">
            <div className="max-w-3xl mx-auto flex flex-col gap-6">
                {messages.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                            <p className="text-text-secondary text-sm">메시지가 없습니다</p>
                            <p className="text-text-tertiary text-xs mt-1">아래 입력창에서 대화를 시작하세요</p>
                        </div>
                    </div>
                ) : (
                    messages.map((message, index) => {
                        // 마지막 assistant 메시지에만 isStreaming 전달
                        const isLastAssistant = index === messages.length - 1 && message.role === "assistant";
                        const showStreaming = isLastAssistant && isStreaming;

                        return <Message
                            key={message.id}
                            message={message}
                            isStreaming={showStreaming}
                            isSubmitting={isSubmitting}
                            onQuestionSubmit={onQuestionSubmit}
                        />;
                    })
                )}
            </div>
        </div>
    );
};

export default MessageList;
