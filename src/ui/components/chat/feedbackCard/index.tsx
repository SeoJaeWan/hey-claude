import {MessageSquare, Lightbulb} from "lucide-react";

interface FeedbackCardProps {
    feedback: {
        id: string;
        originalPrompt: string;
        suggestedPrompt: string;
        reason?: string;
        provider?: string;
    };
    onIgnore: () => void;
    onEdit: (suggestedPrompt: string) => void;
}

const FeedbackCard = ({feedback, onIgnore, onEdit}: FeedbackCardProps) => {
    return (
        <div className="bg-bg-secondary border border-border-default rounded-lg p-4 mb-3">
            {/* 헤더 */}
            <div className="flex items-center gap-2 mb-3">
                <MessageSquare size={16} className="text-text-primary" />
                <span className="text-sm font-semibold text-text-primary">프롬프트 개선 제안</span>
                {feedback.provider && (
                    <span className="text-xs text-text-tertiary px-2 py-0.5 bg-bg-tertiary rounded">
                        {feedback.provider}
                    </span>
                )}
            </div>

            {/* 원본 프롬프트 */}
            <div className="mb-3">
                <p className="text-xs text-text-tertiary mb-1">원본:</p>
                <p className="text-sm text-text-secondary bg-bg-tertiary rounded-md p-2">{feedback.originalPrompt}</p>
            </div>

            {/* 제안된 프롬프트 */}
            <div className="mb-3">
                <p className="text-xs text-text-tertiary mb-1">제안:</p>
                <p className="text-sm text-text-primary bg-bg-primary border border-border-default rounded-md p-2">
                    {feedback.suggestedPrompt}
                </p>
            </div>

            {/* 제안 이유 (있을 경우) */}
            {feedback.reason && (
                <div className="flex items-start gap-2 text-xs text-text-secondary mb-3">
                    <Lightbulb size={14} className="text-warning flex-shrink-0 mt-0.5" />
                    <span>{feedback.reason}</span>
                </div>
            )}

            {/* 액션 버튼 */}
            <div className="flex gap-2 justify-end">
                <button
                    onClick={onIgnore}
                    className="px-3 py-2 text-sm font-medium text-text-secondary bg-transparent border border-border-default rounded-md hover:bg-bg-tertiary transition-colors"
                >
                    무시
                </button>
                <button
                    onClick={() => onEdit(feedback.suggestedPrompt)}
                    className="px-3 py-2 text-sm font-medium text-text-inverse bg-accent-primary rounded-md hover:bg-accent-hover transition-colors"
                >
                    수정
                </button>
            </div>
        </div>
    );
};

export default FeedbackCard;
