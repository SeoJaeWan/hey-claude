import FileChangesCard from "../fileChangesCard";
import type {Message as MessageType} from "../../../types";

interface MessageProps {
    message: MessageType;
    isStreaming?: boolean;
}

const Message = ({message, isStreaming = false}: MessageProps) => {
    const isUser = message.role === "user";
    const showCursor = !isUser && isStreaming;

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
                    <p className={`text-base leading-relaxed whitespace-pre-wrap break-words ${showCursor ? "streaming-cursor" : ""}`}>
                        {message.content}
                    </p>
                </div>

                {/* 파일 변경사항 (assistant 메시지에만 표시) */}
                {!isUser && message.changes && (
                    <FileChangesCard changes={[
                        ...message.changes.modified,
                        ...message.changes.added.map(path => ({path, type: 'added' as const})),
                        ...message.changes.deleted.map(path => ({path, type: 'deleted' as const})),
                    ]} />
                )}
            </div>
        </div>
    );
};

export default Message;
