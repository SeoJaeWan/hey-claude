import {HelpCircle} from 'lucide-react';

interface QuestionCardProps {
    content: string;
}

const QuestionCard = ({content}: QuestionCardProps) => {
    return (
        <div className="question-card bg-accent-primary/5 border border-accent-primary/20 rounded-lg p-4 my-2">
            {/* 선택 안내 */}
            <div className="flex items-center gap-2 mb-3 text-xs text-text-secondary">
                <HelpCircle className="w-4 h-4 text-accent-primary" />
                <span>숫자를 입력하여 선택하세요</span>
            </div>

            {/* 질문 텍스트 그대로 표시 (파싱 불필요) */}
            <div className="whitespace-pre-wrap text-sm text-text-primary">
                {content}
            </div>
        </div>
    );
};

export default QuestionCard;
