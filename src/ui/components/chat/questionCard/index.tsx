import {HelpCircle} from 'lucide-react';
import {cn} from '../../../utils/cn';

interface QuestionCardProps {
    content: string; // "어느 브랜치에 커밋하시겠습니까?\n1. main 브랜치\n2. 새 브랜치"
}

interface Option {
    number: string;
    text: string;
}

const QuestionCard = ({content}: QuestionCardProps) => {
    const lines = content.split('\n');

    // 질문 텍스트 찾기 (물음표 포함)
    const questionLines: string[] = [];
    const optionLines: string[] = [];

    lines.forEach(line => {
        if (/^\s*\d+\.\s+/.test(line)) {
            optionLines.push(line);
        } else if (line.trim()) {
            questionLines.push(line);
        }
    });

    // 옵션 파싱
    const options: Option[] = optionLines
        .map(line => {
            const match = line.match(/^\s*(\d+)\.\s+(.+)/);
            return match
                ? {
                      number: match[1],
                      text: match[2].trim()
                  }
                : null;
        })
        .filter((opt): opt is Option => opt !== null);

    if (options.length === 0) {
        return <div className="whitespace-pre-wrap text-text-secondary">{content}</div>;
    }

    return (
        <div className="question-card bg-accent-primary/5 border border-accent-primary/20 rounded-lg p-4 my-2">
            {/* 질문 텍스트 */}
            {questionLines.length > 0 && (
                <div className="mb-3">
                    {questionLines.map((line, idx) => (
                        <p key={idx} className="text-sm font-medium text-text-primary">
                            {line}
                        </p>
                    ))}
                </div>
            )}

            {/* 선택 안내 */}
            <div className="flex items-center gap-2 mb-3 text-xs text-text-secondary">
                <HelpCircle className="w-4 h-4 text-accent-primary" />
                <span>숫자를 입력하여 선택하세요</span>
            </div>

            {/* 옵션 목록 */}
            <div className="space-y-2">
                {options.map(opt => (
                    <div
                        key={opt.number}
                        className={cn(
                            "flex items-start gap-3 text-sm",
                            "bg-bg-secondary rounded-md p-2.5",
                            "hover:bg-bg-tertiary transition-colors"
                        )}
                    >
                        <span className="font-mono text-accent-primary font-semibold text-base shrink-0">
                            {opt.number}
                        </span>
                        <span className="text-text-secondary">{opt.text}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default QuestionCard;
