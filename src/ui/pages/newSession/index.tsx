import {useState, useEffect, useMemo} from "react";
import {useNavigate, useOutletContext} from "react-router-dom";
import {Terminal, MessageCircle, Menu} from "lucide-react";
import {cn} from "../../utils/cn";
import ChatInput from "../../components/chat/input";
import {getProviderModels, DEFAULT_PROVIDER, DEFAULT_CLAUDE_MODEL, DEFAULT_QUICK_CHAT_MODEL} from "../../data/models";
import {useCreateSession} from "../../hooks/apis/queries/session";
import {useProjectPath} from "../../hooks/apis/queries/project";
import {useSendMessage} from "../../hooks/apis/queries/message";
import {useTranslation} from "../../contexts/language";

type SessionType = "claude-code" | "quick-chat";

const NewSessionPage = () => {
    const navigate = useNavigate();
    const {onMenuClick} = useOutletContext<{onMenuClick: () => void}>();
    const {t} = useTranslation();
    const providerModels = useMemo(() => getProviderModels(t), [t]);
    const [sessionType, setSessionType] = useState<SessionType>("claude-code");
    const [selectedProvider, setSelectedProvider] = useState(DEFAULT_PROVIDER);
    const [claudeModel, setClaudeModel] = useState(DEFAULT_CLAUDE_MODEL);
    const [quickChatModel, setQuickChatModel] = useState(DEFAULT_QUICK_CHAT_MODEL);

    // API 훅
    const {data: projectPath = ""} = useProjectPath();
    const createSessionMutation = useCreateSession();
    const {sendMessage} = useSendMessage();

    // 드래그 앤 드롭 이미지 상태
    const [images, setImages] = useState<{id: string; src: string; file: File}[]>([]);
    const [isDragging, setIsDragging] = useState(false);

    // 제공자 변경 시 기본 모델로 리셋
    const handleProviderChange = (providerId: string) => {
        setSelectedProvider(providerId);
        const firstModel = providerModels[providerId]?.[0];
        if (firstModel) {
            setQuickChatModel(firstModel.id);
        }
    };

    // 파일 처리 함수
    const handleFiles = (files: FileList) => {
        const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
        const newImages = imageFiles.map((file) => ({
            id: crypto.randomUUID(),
            src: URL.createObjectURL(file),
            file
        }));
        setImages((prev) => [...prev, ...newImages]);
    };

    // 이미지 제거
    const handleRemoveImage = (id: string) => {
        setImages((prev) => {
            const imageToRemove = prev.find((img) => img.id === id);
            if (imageToRemove) {
                URL.revokeObjectURL(imageToRemove.src);
            }
            return prev.filter((img) => img.id !== id);
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
        if (!projectPath) {
            console.error("Project path not available");
            return;
        }

        // inputImages는 ChatInput에서 전달받은 파일들 (클립보드, 파일선택)
        // images는 NewSessionPage에서 관리하는 드래그앤드롭 이미지들
        const allImages = [...(inputImages || []), ...images.map((img) => img.file)];

        try {
            // 1. 새 세션 생성
            const selectedModel = sessionType === "claude-code" ? claudeModel : quickChatModel;
            const session = await createSessionMutation.mutateAsync({
                type: sessionType,
                projectPath,
                model: selectedModel,
                // name은 첫 메시지 내용으로 자동 생성되도록 서버에서 처리
            });

            console.log("New session created:", {id: session.id, type: sessionType, content, imageCount: allImages.length});

            // 전송 후 이미지 정리
            images.forEach((img) => URL.revokeObjectURL(img.src));
            setImages([]);

            // 2. 채팅 페이지로 먼저 이동 (스트리밍 UI를 보여주기 위해)
            navigate(`/chat/${session.id}`);

            // 3. 첫 메시지 전송 (이미지 포함, 비동기로 백그라운드에서 실행)
            sendMessage(session.id, content, allImages.length > 0 ? allImages : undefined);
        } catch (error) {
            console.error("Failed to create session or send message:", error);
            // TODO: 에러 토스트 표시
        }
    };

    // Cleanup blob URLs on unmount
    useEffect(() => {
        return () => {
            images.forEach((img) => URL.revokeObjectURL(img.src));
        };
    }, []);

    return (
        <div
            className="relative flex-1 flex flex-col"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* 햄버거 버튼 (900px 미만에서만) */}
            <button
                onClick={onMenuClick}
                className={cn(
                    "fixed top-4 left-4 z-10",
                    "p-2 rounded-md",
                    "bg-bg-secondary border border-border-default",
                    "hover:bg-bg-tertiary transition-colors",
                    "lg:hidden"
                )}
                aria-label={t("session.openMenu")}
            >
                <Menu size={20} />
            </button>

            {/* Hero Section */}
            <div className="flex-1 flex flex-col items-center justify-center p-6">
                <h1 className="font-mono text-2xl font-bold text-text-primary mb-4">{t("newSession.title")}</h1>
                <p className="text-lg text-text-secondary mb-8">{t("newSession.subtitle")}</p>

                {/* Session Type Tabs */}
                <div className="flex gap-2 mb-8">
                    <button
                        onClick={() => setSessionType("claude-code")}
                        className={cn(
                            "flex items-center gap-2 px-6 py-3 rounded-lg",
                            "font-medium border transition-all",
                            sessionType === "claude-code"
                                ? "bg-accent-subtle border-accent-primary text-text-primary"
                                : "bg-bg-secondary border-border-default text-text-secondary hover:border-border-strong hover:text-text-primary"
                        )}
                    >
                        <Terminal size={18} />
                        {t("newSession.claudeCode")}
                    </button>
                    <button
                        onClick={() => setSessionType("quick-chat")}
                        className={cn(
                            "flex items-center gap-2 px-6 py-3 rounded-lg",
                            "font-medium border transition-all",
                            sessionType === "quick-chat"
                                ? "bg-accent-subtle border-accent-primary text-text-primary"
                                : "bg-bg-secondary border-border-default text-text-secondary hover:border-border-strong hover:text-text-primary"
                        )}
                    >
                        <MessageCircle size={18} />
                        {t("newSession.quickChat")}
                    </button>
                </div>
            </div>

            {/* Input Area */}
            <ChatInput
                onSend={handleSend}
                mode={sessionType}
                showSummaryButton={sessionType === "claude-code"}
                showFeedbackToggle={sessionType === "claude-code"}
                selectedModel={sessionType === "claude-code" ? claudeModel : quickChatModel}
                onModelChange={sessionType === "claude-code" ? setClaudeModel : setQuickChatModel}
                selectedProvider={selectedProvider}
                onProviderChange={handleProviderChange}
                images={images}
                onRemoveImage={handleRemoveImage}
                disabled={createSessionMutation.isPending}
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

export default NewSessionPage;
