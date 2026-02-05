import FileChangesCard from "../fileChangesCard";
import QuestionCard from "../questionCard";
import {useSubmitQuestionAnswer} from "../../../hooks/apis/queries/message";
import {useQueryClient} from "@tanstack/react-query";
import type {Message as MessageType, QuestionAnswer} from "../../../types";

interface MessageProps {
    message: MessageType;
    isStreaming?: boolean;
}

const Message = ({message, isStreaming = false}: MessageProps) => {
    const isUser = message.role === "user";
    const showCursor = !isUser && isStreaming;

    const {submitAnswer} = useSubmitQuestionAnswer();
    const queryClient = useQueryClient();

    const handleQuestionSubmit = (answers: QuestionAnswer[]) => {
        if (!message.questionData) return;

        submitAnswer(
            message.sessionId,
            message.questionData.tool_use_id,
            answers
        );

        // 제출 상태를 메시지에 반영 (React Query 캐시 업데이트)
        queryClient.setQueryData(['session', message.sessionId], (old: any) => {
            if (!old) return old;

            const messages = old.messages || [];
            const updatedMessages = messages.map((msg: any) =>
                msg.id === message.id
                    ? {...msg, questionSubmitted: true}
                    : msg
            );
            return {...old, messages: updatedMessages};
        });
    };

    return (
        <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
            <div className="max-w-[85%]">
                <div
                    className={`
                        px-4 py-3 rounded-2xl
                        ${
                            isUser
                                ? "bg-bubble-user text-text-primary"
                                : "bg-bubble-assistant text-text-primary border border-border-default"
                        }
                    `}
                >
                    {/* assistant 메시지이면서 questionData가 있으면 QuestionCard */}
                    {!isUser && message.questionData ? (
                        <>
                            {/* 질문 전 텍스트가 있으면 표시 */}
                            {message.content && (
                                <p className="text-base leading-relaxed whitespace-pre-wrap break-words mb-3">
                                    {message.content}
                                </p>
                            )}
                            <QuestionCard
                                questionData={message.questionData}
                                isSubmitted={message.questionSubmitted}
                                onSubmit={handleQuestionSubmit}
                            />
                        </>
                    ) : (
                        <p className={`text-base leading-relaxed whitespace-pre-wrap break-words ${showCursor ? "streaming-cursor" : ""}`}>
                            {message.content}
                        </p>
                    )}
                </div>

                {/* 파일 변경사항 (assistant 메시지에만 표시) */}
                {!isUser && message.changes && (
                    <FileChangesCard
                        changes={[
                            ...message.changes.modified,
                            ...message.changes.added.map(path => ({path, type: "added" as const})),
                            ...message.changes.deleted.map(path => ({path, type: "deleted" as const}))
                        ]}
                    />
                )}
            </div>
        </div>
    );
};

export default Message;
