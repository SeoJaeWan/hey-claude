import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import FileChangesCard from "../fileChangesCard";
import QuestionCard from "../questionCard";
import type { Message as MessageType, QuestionAnswer } from "../../../types";

interface MessageProps {
  message: MessageType;
  isStreaming?: boolean;
  isSubmitting?: boolean;
  onQuestionSubmit?: (
    sessionId: string,
    toolUseId: string,
    answers: QuestionAnswer[],
  ) => void;
}

// Markdown 커스텀 컴포넌트 정의
const markdownComponents = {
  code({ inline, className, children, ...props }: any) {
    console.log(children, inline);
    return inline ? (
      <code
        className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-sm font-mono"
        {...props}
      >
        {children}
      </code>
    ) : (
      <pre className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg overflow-x-auto my-2">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    );
  },
  h1: ({ children }: any) => (
    <h1 className="font-bold mt-4 mb-2">{children}</h1>
  ),
  h2: ({ children }: any) => (
    <h2 className="font-bold mt-3 mb-2">{children}</h2>
  ),
  h3: ({ children }: any) => (
    <h3 className="font-semibold mt-2 mb-1">{children}</h3>
  ),
  p: ({ children }: any) => <p className="mb-2">{children}</p>,
  ul: ({ children }: any) => (
    <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>
  ),
  ol: ({ children }: any) => (
    <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>
  ),
  a: ({ href, children }: any) => (
    <a
      href={href}
      className="text-blue-500 hover:underline"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
};

const Message = ({
  message,
  isStreaming = false,
  isSubmitting = false,
  onQuestionSubmit,
}: MessageProps) => {
  const isUser = message.role === "user";
  const showCursor = !isUser && isStreaming;

  const handleQuestionSubmit = (answers: QuestionAnswer[]) => {
    if (!message.questionData || !onQuestionSubmit) return;

    onQuestionSubmit(
      message.sessionId,
      message.questionData.tool_use_id,
      answers,
    );
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
                <div className="text-base leading-relaxed break-words mb-3 markdown-content">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                    components={markdownComponents}
                  >
                    {message.content}
                  </ReactMarkdown>
                </div>
              )}
              <QuestionCard
                questionData={message.questionData}
                isSubmitted={message.questionSubmitted}
                isSubmitting={isSubmitting}
                onSubmit={handleQuestionSubmit}
              />
            </>
          ) : (
            <div
              className={`text-base leading-relaxed break-words markdown-content ${showCursor ? "streaming-cursor" : ""}`}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={markdownComponents}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* 파일 변경사항 (assistant 메시지에만 표시) */}
        {!isUser && message.changes && (
          <FileChangesCard
            changes={[
              ...message.changes.modified,
              ...message.changes.added.map((path) => ({
                path,
                type: "added" as const,
              })),
              ...message.changes.deleted.map((path) => ({
                path,
                type: "deleted" as const,
              })),
            ]}
          />
        )}
      </div>
    </div>
  );
};

export default Message;
