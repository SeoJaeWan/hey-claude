import { useMemo, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import FileChangesCard from "../fileChangesCard";
import QuestionCard from "../questionCard";
import PermissionCard from "../permissionCard";
import type {
  Message as MessageType,
  FileChangeType,
} from "../../../types";

const formatTime = (dateStr: string): string => {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

// IDE가 주입하는 메타데이터 태그 제거
const stripIdeTags = (content: string): string =>
  content
    .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, "")
    .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, "")
    .trim();

interface MessageProps {
  message: MessageType;
  clientId?: string | null;
}

// Markdown 커스텀 컴포넌트 정의
const markdownComponents = {
  pre: ({ children, ...props }: any) => (
    <pre className="bg-bg-block p-4 rounded-lg overflow-x-auto my-2" {...props}>
      {children}
    </pre>
  ),
  code({ className, children, ...props }: any) {
    const isBlock = /^(language-|hljs)/.test(className || "");
    if (isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="bg-bg-code px-0.5 py-0.5 rounded-sm text-sm font-mono"
        {...props}
      >
        {children}
      </code>
    );
  },
  h1: ({ children }: any) => <h1 className="font-bold">{children}</h1>,
  h2: ({ children }: any) => <h2 className="font-bold">{children}</h2>,
  h3: ({ children }: any) => <h3 className="font-semibold">{children}</h3>,
  p: ({ children }: any) => <p>{children}</p>,
  ul: ({ children }: any) => (
    <ul className="list-disc list-inside space-y-1">{children}</ul>
  ),
  ol: ({ children }: any) => (
    <ol className="list-decimal list-inside space-y-1">{children}</ol>
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

const Message = memo(
  ({ message, clientId }: MessageProps) => {
    const isUser = message.role === "user";

    // toolUsages에서 파일 변경사항 추출
    const toolFileChanges = useMemo(() => {
      if (!message.toolUsages) return [];
      return message.toolUsages
        .filter(
          (t: any) => ["Write", "Edit"].includes(t.name) && t.input?.file_path,
        )
        .map((t: any) => ({
          path: t.input.file_path,
          type: (t.name === "Write" ? "added" : "modified") as FileChangeType,
        }));
    }, [message.toolUsages]);

    return (
      <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
        <div className="max-w-[85%] bg-code-bg">
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
            {/* assistant 메시지: questionData, permissionData, 일반 텍스트 중 하나만 배타적으로 표시 */}
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
                      {stripIdeTags(message.content)}
                    </ReactMarkdown>
                  </div>
                )}
                <QuestionCard
                  sessionId={message.sessionId}
                  clientId={clientId ?? null}
                  questionData={message.questionData}
                  isSubmitted={message.questionSubmitted}
                  questionAnswers={message.questionAnswers}
                />
              </>
            ) : !isUser && message.permissionData ? (
              <PermissionCard
                permissionData={message.permissionData}
              />
            ) : (
              <div
                className={`text-base leading-relaxed break-words markdown-content`}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={markdownComponents}
                >
                  {stripIdeTags(message.content)}
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

          {/* 도구 사용에 의한 파일 변경사항 (toolUsages에서 추출) */}
          {!isUser && toolFileChanges.length > 0 && !message.changes && (
            <FileChangesCard changes={toolFileChanges} />
          )}

          {/* 메시지 시간 */}
          {message.createdAt && (
            <p
              className={`text-xs text-text-tertiary mt-1 px-1 ${isUser ? "text-right" : "text-left"}`}
            >
              {formatTime(message.createdAt)}
            </p>
          )}
        </div>
      </div>
    );
  },
);

Message.displayName = "Message";

export default Message;
