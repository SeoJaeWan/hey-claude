import {HelpCircle, CheckCircle2, Circle} from 'lucide-react';
import {useState} from 'react';
import type {QuestionData, QuestionAnswer} from '../../../types';

interface QuestionCardProps {
    questionData: QuestionData;
    isSubmitted?: boolean;
    onSubmit?: (answers: QuestionAnswer[]) => void;
}

const QuestionCard = ({questionData, isSubmitted = false, onSubmit}: QuestionCardProps) => {
    const {questions} = questionData;

    // 각 질문별 선택 상태 관리
    const [selections, setSelections] = useState<Record<number, number[]>>(() => {
        const initial: Record<number, number[]> = {};
        questions.forEach((_, idx) => {
            initial[idx] = [];
        });
        return initial;
    });

    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleOptionClick = (questionIdx: number, optionIdx: number, multiSelect: boolean) => {
        setSelections(prev => {
            const current = prev[questionIdx] || [];

            if (multiSelect) {
                // 다중 선택: 토글
                if (current.includes(optionIdx)) {
                    return {...prev, [questionIdx]: current.filter(i => i !== optionIdx)};
                } else {
                    return {...prev, [questionIdx]: [...current, optionIdx]};
                }
            } else {
                // 단일 선택: 교체
                return {...prev, [questionIdx]: [optionIdx]};
            }
        });
    };

    const isSelected = (questionIdx: number, optionIdx: number) => {
        return selections[questionIdx]?.includes(optionIdx) || false;
    };

    // 유효성 검증: 모든 질문에 답변했는지
    const isValid = questions.every((_, idx) => {
        return selections[idx] && selections[idx].length > 0;
    });

    // 제출 핸들러
    const handleSubmit = () => {
        if (!isValid || isSubmitting || isSubmitted) return;

        setIsSubmitting(true);

        // selections → QuestionAnswer[] 변환
        const answers: QuestionAnswer[] = questions.map((q, idx) => ({
            questionIndex: idx,
            question: q.question,
            selectedOptions: selections[idx].map(optIdx => q.options[optIdx].label)
        }));

        onSubmit?.(answers);
        // isSubmitting 상태는 부모에서 관리 (Message 컴포넌트)
    };

    return (
        <div className="question-card bg-accent-primary/5 border border-accent-primary/20 rounded-lg p-4 my-2 space-y-4">
            {/* 안내 메시지 */}
            <div className="flex items-center gap-2 text-xs text-text-secondary">
                <HelpCircle className="w-4 h-4 text-accent-primary" />
                <span>선택지를 클릭하여 답변을 선택하세요</span>
            </div>

            {/* 각 질문 렌더링 */}
            {questions.map((q, qIdx) => (
                <div key={qIdx} className="space-y-2">
                    {/* 질문 헤더 */}
                    <div className="flex items-center gap-2">
                        <span className="inline-block px-2 py-0.5 text-xs font-medium bg-accent-primary/10 text-accent-primary rounded">
                            {q.header}
                        </span>
                        {q.multiSelect && (
                            <span className="text-xs text-text-secondary">(복수 선택 가능)</span>
                        )}
                    </div>

                    {/* 질문 텍스트 */}
                    <p className="text-sm font-medium text-text-primary">
                        {q.question}
                    </p>

                    {/* 선택지 목록 */}
                    <div className="space-y-2 ml-2">
                        {q.options.map((option, oIdx) => {
                            const selected = isSelected(qIdx, oIdx);
                            return (
                                <button
                                    key={oIdx}
                                    onClick={() => handleOptionClick(qIdx, oIdx, q.multiSelect)}
                                    className={`
                                        w-full text-left p-3 rounded-lg border transition-all
                                        ${selected
                                            ? 'bg-accent-primary/10 border-accent-primary/50 shadow-sm'
                                            : 'bg-background-secondary border-border-default hover:border-accent-primary/30 hover:bg-accent-primary/5'
                                        }
                                    `}
                                >
                                    <div className="flex items-start gap-3">
                                        {/* 선택 아이콘 */}
                                        <div className="mt-0.5 flex-shrink-0">
                                            {selected ? (
                                                <CheckCircle2 className="w-5 h-5 text-accent-primary" />
                                            ) : (
                                                <Circle className="w-5 h-5 text-text-tertiary" />
                                            )}
                                        </div>

                                        {/* 옵션 내용 */}
                                        <div className="flex-1 min-w-0">
                                            <div className={`text-sm font-medium ${selected ? 'text-accent-primary' : 'text-text-primary'}`}>
                                                {option.label}
                                            </div>
                                            <div className="text-xs text-text-secondary mt-1">
                                                {option.description}
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}

            {/* 제출 버튼 */}
            <div className="pt-2 border-t border-border-default">
                <button
                    onClick={handleSubmit}
                    disabled={!isValid || isSubmitting || isSubmitted}
                    className={`
                        w-full px-4 py-2 rounded-lg text-sm font-medium transition-all
                        ${isValid && !isSubmitting && !isSubmitted
                            ? 'bg-accent-primary hover:bg-accent-primary/90 text-white cursor-pointer'
                            : 'bg-accent-primary/30 text-text-secondary cursor-not-allowed'
                        }
                    `}
                >
                    {isSubmitting ? "제출 중..." : isSubmitted ? "제출 완료" : "답변 제출"}
                </button>
                {!isValid && !isSubmitted && (
                    <p className="text-xs text-text-tertiary text-center mt-2">
                        모든 질문에 답변해주세요
                    </p>
                )}
            </div>
        </div>
    );
};

export default QuestionCard;
