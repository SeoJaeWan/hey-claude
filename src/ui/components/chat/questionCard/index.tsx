import {HelpCircle, CheckCircle2, Circle} from 'lucide-react';
import {useState} from 'react';
import type {QuestionData, QuestionAnswer} from '../../../types';
import {useTranslation} from '../../../contexts/language';
import {useSubmitQuestionAnswer} from '../../../hooks/apis/queries/message';

interface QuestionCardProps {
    sessionId: string;
    questionData: QuestionData;
    isSubmitted?: boolean;
    questionAnswers?: QuestionAnswer[];
}

const QuestionCard = ({sessionId, questionData, isSubmitted = false, questionAnswers}: QuestionCardProps) => {
    const {questions, source} = questionData;
    const {t} = useTranslation();
    const {submitAnswer, isSubmitting} = useSubmitQuestionAnswer();
    const isCliSession = source === "terminal";

    // 각 질문별 선택 상태 관리
    const [selections, setSelections] = useState<Record<number, number[]>>(() => {
        const initial: Record<number, number[]> = {};
        questions.forEach((_, idx) => {
            initial[idx] = [];
        });
        return initial;
    });

    // "Other" 선택 및 입력 상태
    const [otherSelected, setOtherSelected] = useState<Record<number, boolean>>({});
    const [otherText, setOtherText] = useState<Record<number, string>>({});


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

        // 일반 옵션 선택 시 Other 선택 해제 (단일 선택 모드만)
        if (!multiSelect && otherSelected[questionIdx]) {
            setOtherSelected(prev => ({...prev, [questionIdx]: false}));
        }
    };

    const handleOtherClick = (questionIdx: number, multiSelect: boolean) => {
        setOtherSelected(prev => {
            const newSelected = !prev[questionIdx];

            // 단일 선택 모드: Other 선택 시 기존 선택 해제
            if (!multiSelect && newSelected) {
                setSelections(prevSel => ({...prevSel, [questionIdx]: []}));
            }

            return {...prev, [questionIdx]: newSelected};
        });
    };

    const isSelected = (questionIdx: number, optionIdx: number) => {
        return selections[questionIdx]?.includes(optionIdx) || false;
    };

    // 유효성 검증: 모든 질문에 답변했는지
    const isValid = questions.every((_, idx) => {
        const hasSelection = selections[idx] && selections[idx].length > 0;
        const hasOtherWithText = otherSelected[idx] && otherText[idx]?.trim();
        return hasSelection || hasOtherWithText;
    });

    // 제출 핸들러
    const handleSubmit = () => {
        if (!isValid || isSubmitting || isSubmitted) return;

        // selections → QuestionAnswer[] 변환 (Other 입력 포함, selectedIndices 추가)
        const answers: QuestionAnswer[] = questions.map((q, idx) => {
            const selectedIndices = selections[idx] || [];
            const selectedLabels = selectedIndices.map(optIdx => q.options[optIdx].label);
            const isOther = otherSelected[idx] && otherText[idx]?.trim();

            // Other 선택 시 텍스트 추가
            if (isOther) {
                selectedLabels.push(otherText[idx].trim());
            }

            return {
                questionIndex: idx,
                question: q.question,
                selectedOptions: selectedLabels,
                selectedIndices: selectedIndices,  // 서버에서 방향키 시퀀스 생성용
                isOther: !!isOther                 // Other 텍스트 입력 여부
            };
        });

        submitAnswer(sessionId, questionData.tool_use_id, answers);
    };

    return (
        <div className="question-card bg-accent-primary/5 border border-accent-primary/20 rounded-lg p-4 my-2 space-y-4">
            {/* 상태 헤더 */}
            {isSubmitted ? (
                <div className="flex items-center gap-2 text-xs text-text-secondary">
                    <CheckCircle2 className="w-4 h-4 text-accent-primary" />
                    <span>{questionAnswers ? t('question.submitted') : t('question.answeredElsewhere')}</span>
                </div>
            ) : (
                <div className="flex items-center gap-2 text-xs text-text-secondary">
                    <HelpCircle className="w-4 h-4 text-accent-primary" />
                    <span>{t('question.selectPrompt')}</span>
                </div>
            )}

            {/* 각 질문 렌더링 (항상 표시) */}
            {questions.map((q, qIdx) => {
                // 이 질문에 대한 제출된 답변 찾기
                const submittedAnswer = questionAnswers?.find(a => a.questionIndex === qIdx);
                const submittedLabels = submittedAnswer?.selectedOptions || [];

                return (
                    <div key={qIdx} className="space-y-2">
                        {/* 질문 헤더 */}
                        <div className="flex items-center gap-2">
                            <span className="inline-block px-2 py-0.5 text-xs font-medium bg-accent-primary/10 text-accent-primary rounded">
                                {q.header}
                            </span>
                            {!isSubmitted && q.multiSelect && (
                                <span className="text-xs text-text-secondary">{t('question.multiSelect')}</span>
                            )}
                        </div>

                        {/* 질문 텍스트 */}
                        <p className={`text-sm font-medium ${isSubmitted ? 'text-text-secondary' : 'text-text-primary'}`}>
                            {q.question}
                        </p>

                        {/* 선택지 목록 */}
                        <div className="space-y-2 ml-2">
                            {q.options.map((option, oIdx) => {
                                const selected = isSubmitted
                                    ? submittedLabels.includes(option.label)
                                    : isSelected(qIdx, oIdx);
                                return (
                                    <button
                                        key={oIdx}
                                        onClick={isSubmitted ? undefined : () => handleOptionClick(qIdx, oIdx, q.multiSelect)}
                                        disabled={isSubmitted}
                                        className={`
                                            w-full text-left p-3 rounded-lg border transition-all
                                            ${isSubmitted
                                                ? selected
                                                    ? 'bg-accent-primary/10 border-accent-primary/50'
                                                    : 'bg-background-secondary border-border-default opacity-50'
                                                : selected
                                                    ? 'bg-accent-primary/10 border-accent-primary/50 shadow-sm'
                                                    : 'bg-background-secondary border-border-default hover:border-accent-primary/30 hover:bg-accent-primary/5'
                                            }
                                            ${isSubmitted ? 'cursor-default' : ''}
                                        `}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="mt-0.5 flex-shrink-0">
                                                {selected ? (
                                                    <CheckCircle2 className={`w-5 h-5 ${isSubmitted ? 'text-accent-primary' : 'text-accent-primary'}`} />
                                                ) : (
                                                    <Circle className={`w-5 h-5 ${isSubmitted ? 'text-text-tertiary/50' : 'text-text-tertiary'}`} />
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className={`text-sm font-medium ${
                                                    isSubmitted
                                                        ? selected ? 'text-accent-primary' : 'text-text-tertiary'
                                                        : selected ? 'text-accent-primary' : 'text-text-primary'
                                                }`}>
                                                    {option.label}
                                                </div>
                                                <div className={`text-xs mt-1 ${isSubmitted ? 'text-text-tertiary' : 'text-text-secondary'}`}>
                                                    {option.description}
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}

                            {/* "Other" 옵션 */}
                            {!isSubmitted ? (
                                <>
                                    <button
                                        onClick={() => handleOtherClick(qIdx, q.multiSelect)}
                                        className={`
                                            w-full text-left p-3 rounded-lg border transition-all
                                            ${otherSelected[qIdx]
                                                ? 'bg-accent-primary/10 border-accent-primary/50 shadow-sm'
                                                : 'bg-background-secondary border-border-default hover:border-accent-primary/30 hover:bg-accent-primary/5'
                                            }
                                        `}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="mt-0.5 flex-shrink-0">
                                                {otherSelected[qIdx] ? (
                                                    <CheckCircle2 className="w-5 h-5 text-accent-primary" />
                                                ) : (
                                                    <Circle className="w-5 h-5 text-text-tertiary" />
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className={`text-sm font-medium ${otherSelected[qIdx] ? 'text-accent-primary' : 'text-text-primary'}`}>
                                                    {t('question.other')}
                                                </div>
                                            </div>
                                        </div>
                                    </button>

                                    {/* Other 텍스트 입력 */}
                                    {otherSelected[qIdx] && (
                                        <textarea
                                            value={otherText[qIdx] || ''}
                                            onChange={(e) => setOtherText(prev => ({...prev, [qIdx]: e.target.value}))}
                                            placeholder={t('question.otherPlaceholder')}
                                            className="w-full mt-2 p-2 text-sm rounded-lg border border-border-default bg-background-secondary text-text-primary placeholder-text-tertiary resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary/50"
                                            rows={3}
                                        />
                                    )}
                                </>
                            ) : (
                                /* Submitted: Other 답변이 있으면 표시 (기존 옵션에 없는 것) */
                                submittedLabels
                                    .filter(label => !q.options.some(o => o.label === label))
                                    .map((otherLabel, idx) => (
                                        <div
                                            key={`other-${idx}`}
                                            className="w-full text-left p-3 rounded-lg border bg-accent-primary/10 border-accent-primary/50"
                                        >
                                            <div className="flex items-start gap-3">
                                                <div className="mt-0.5 flex-shrink-0">
                                                    <CheckCircle2 className="w-5 h-5 text-accent-primary" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-medium text-accent-primary">
                                                        {otherLabel}
                                                    </div>
                                                    <div className="text-xs mt-1 text-text-tertiary">
                                                        {t('question.other')}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                            )}
                        </div>
                    </div>
                );
            })}

            {/* 제출 버튼 (미제출 상태에서만) */}
            {!isSubmitted && !isCliSession && (
                <div className="pt-2 border-t border-border-default">
                    <button
                        onClick={handleSubmit}
                        disabled={!isValid || isSubmitting}
                        className={`
                            w-full px-4 py-2 rounded-lg text-sm font-medium transition-all
                            ${isValid && !isSubmitting
                                ? 'bg-accent-primary hover:bg-accent-primary/90 text-white cursor-pointer'
                                : 'bg-accent-primary/30 text-text-secondary cursor-not-allowed'
                            }
                        `}
                    >
                        {isSubmitting ? t('question.submitting') : t('question.submit')}
                    </button>
                    {!isValid && (
                        <p className="text-xs text-text-tertiary text-center mt-2">
                            {t('question.allRequired')}
                        </p>
                    )}
                </div>
            )}

            {/* CLI 세션: 터미널에서 응답하라는 안내 메시지 */}
            {!isSubmitted && isCliSession && (
                <div className="pt-2 border-t border-border-default">
                    <div className="flex items-center justify-center gap-2 py-2 text-sm text-amber-600 dark:text-amber-400">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span className="font-medium">{t('question.cliSession')}</span>
                        <span className="text-text-secondary">—</span>
                        <span>{t('question.respondInCli')}</span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default QuestionCard;
