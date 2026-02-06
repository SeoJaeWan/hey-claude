import {useState, useEffect} from "react";
import {useParams, useOutletContext} from "react-router-dom";
import PageHeader from "../../components/commons/pageHeader";
import MessageList from "../../components/chat/messageList";
import ChatInput from "../../components/chat/input";
import {DEFAULT_CLAUDE_MODEL, DEFAULT_PROVIDER} from "../../data/models";
import {useSessionQuery, useSSEConnection} from "../../hooks/apis/queries/session";
import {useMessagesQuery, useSendMessageStream, useSubmitQuestionAnswer} from "../../hooks/apis/queries/message";
import type {QuestionAnswer} from "../../types";
import {useTranslation} from "../../contexts/language";

const ChatPage = () => {
    const {sessionId} = useParams<{sessionId: string}>();
    const {onMenuClick} = useOutletContext<{onMenuClick: () => void}>();
    const {t} = useTranslation();

    // 세션 정보 조회
    const {data: session} = useSessionQuery(sessionId);
    const sessionName = session?.name || `Session ${sessionId}`;

    // SSE 연결 (메시지 스트리밍 수신)
    useSSEConnection(sessionId);

    // 메시지 목록 조회
    const {data: messages} = useMessagesQuery(sessionId);

    // 메시지 전송
    const {isSending, sendMessage} = useSendMessageStream();

    // 답변 제출
    const {submitAnswer, isSubmitting} = useSubmitQuestionAnswer();

    // 스트리밍 상태 확인 (백그라운드 작업 포함)
    const isStreaming =
        session?.streamStatus === "streaming" ||
        session?.streamStatus === "background_tasks" ||
        isSending;

    // 미답변 질문 체크
    const hasUnansweredQuestion = messages?.some(msg => msg.questionData && !msg.questionSubmitted) || false;

    // 드래그 앤 드롭 이미지 상태
    const [images, setImages] = useState<{id: string; src: string; file: File}[]>([]);
    const [isDragging, setIsDragging] = useState(false);

    // 파일 처리 함수
    const handleFiles = (files: FileList) => {
        const imageFiles = Array.from(files).filter(f => f.type.startsWith("image/"));
        const newImages = imageFiles.map(file => ({
            id: crypto.randomUUID(),
            src: URL.createObjectURL(file),
            file
        }));
        setImages(prev => [...prev, ...newImages]);
    };

    // 이미지 제거
    const handleRemoveImage = (id: string) => {
        setImages(prev => {
            const imageToRemove = prev.find(img => img.id === id);
            if (imageToRemove) {
                URL.revokeObjectURL(imageToRemove.src);
            }
            return prev.filter(img => img.id !== id);
        });
    };

    // 드래그 이벤트 핸들러
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // 자식 요소로 이동할 때는 무시
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFiles(files);
        }
    };

    const handleSend = async (content: string, inputImages?: File[]) => {
        if (!sessionId) return;

        // inputImages는 ChatInput에서 전달받은 파일들 (클립보드, 파일선택)
        // images는 ChatPage에서 관리하는 드래그앤드롭 이미지들
        const allImages = [...(inputImages || []), ...images.map(img => img.file)];

        // 메시지 전송 (SSE 스트리밍) - 이미지 포함
        // Optimistic update로 메시지가 즉시 표시됨
        // isSending 상태는 useSendMessageStream 훅에서 자동 관리됨
        await sendMessage(sessionId, content, allImages.length > 0 ? allImages : undefined);

        // 전송 후 이미지 정리
        images.forEach(img => URL.revokeObjectURL(img.src));
        setImages([]);
    };

    const handleQuestionSubmit = (sessionId: string, toolUseId: string, answers: QuestionAnswer[]) => {
        submitAnswer(sessionId, toolUseId, answers);
    };

    // Cleanup blob URLs on unmount
    useEffect(() => {
        return () => {
            images.forEach(img => URL.revokeObjectURL(img.src));
        };
    }, []);

    return (
        <div className="relative flex-1 flex flex-col overflow-hidden" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
            {/* Header with Session Name */}
            <PageHeader title={sessionName} onMenuClick={onMenuClick} />

            {/* Messages - Optimistic update로 메시지가 React Query 캐시에서 자동 관리됨 */}
            <MessageList
                messages={messages}
                isStreaming={isStreaming}
                isSubmitting={isSubmitting}
                onQuestionSubmit={handleQuestionSubmit}
            />

            {/* Input - 임시로 claude-code 모드로 고정 */}
            <ChatInput
                mode="claude-code"
                sessionId={sessionId}
                onSend={handleSend}
                disabled={isSending || isStreaming || hasUnansweredQuestion}
                showSummaryButton={true}
                showFeedbackToggle={true}
                selectedModel={DEFAULT_CLAUDE_MODEL}
                onModelChange={() => {}}
                selectedProvider={DEFAULT_PROVIDER}
                onProviderChange={() => {}}
                images={images}
                onRemoveImage={handleRemoveImage}
            />

            {/* 드래그 오버레이 */}
            {isDragging && (
                <div className="absolute inset-0 bg-accent-primary/10 border-2 border-dashed border-accent-primary rounded-lg flex items-center justify-center z-50 pointer-events-none">
                    <div className="bg-bg-primary px-6 py-4 rounded-lg shadow-lg text-center">
                        <p className="text-lg font-medium text-text-primary">{t("chat.dropImageHere")}</p>
                        <p className="text-sm text-text-secondary mt-1">{t("chat.dropImageDescription")}</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ChatPage;
