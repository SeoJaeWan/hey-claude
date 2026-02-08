import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUp, Paperclip, FileText } from "lucide-react";
import { cn } from "../../../utils/cn";
import ModelSelect from "../../commons/modelSelect";
import ProviderSelect from "../../commons/providerSelect";
import ImagePreviewList from "../imagePreviewList";
import AutocompletePalette from "../autocompletePalette";
import FeedbackCard from "../feedbackCard";
import FeedbackProviderSelect from "../feedbackProviderSelect";
import {
  getProviderModels,
  PROVIDERS,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_PROVIDER,
  DEFAULT_QUICK_CHAT_MODEL,
} from "../../../data/models";
import { getCommands, AutocompleteItem } from "../../../data/autocomplete";
import { useProjectPath } from "../../../hooks/apis/queries/project";
import { useSnippetsQuery } from "../../../hooks/apis/queries/snippet";
import { useCommandsQuery } from "../../../hooks/apis/queries/cli";
import {
  useFeedbackMutation,
  useSummaryMutation,
} from "../../../hooks/apis/queries/ai";
import { useTranslation } from "../../../contexts/language";

interface ChatInputProps {
  onSend?: (content: string, images?: File[]) => void;
  placeholder?: string;
  disabled?: boolean;

  // Claude Code 탭용
  mode?: "claude-code" | "quick-chat";
  showSummaryButton?: boolean;
  showFeedbackToggle?: boolean;
  sessionId?: string; // 요약 기능을 위한 세션 ID

  // 모델 선택
  selectedModel?: string;
  onModelChange?: (modelId: string) => void;

  // 일반 질문 탭용 (제공자 선택)
  selectedProvider?: string;
  onProviderChange?: (providerId: string) => void;

  // 이미지 관련 (외부에서 관리)
  images?: { id: string; src: string; file: File }[];
  onRemoveImage?: (id: string) => void;
}

const ChatInput = ({
  onSend = () => {},
  placeholder,
  disabled = false,
  mode = "claude-code",
  showSummaryButton = false,
  showFeedbackToggle = false,
  sessionId,
  selectedModel,
  onModelChange = () => {},
  selectedProvider,
  onProviderChange = () => {},
  images = [],
  onRemoveImage = () => {},
}: ChatInputProps) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const providerModels = useMemo(() => getProviderModels(t), [t]);
  const { data: projectPath } = useProjectPath();
  const { data: snippets = [] } = useSnippetsQuery(projectPath);
  const { data: apiCommands } = useCommandsQuery();
  const feedbackMutation = useFeedbackMutation();
  const summaryMutation = useSummaryMutation();
  const [content, setContent] = useState("");
  const [feedbackEnabled, setFeedbackEnabled] = useState(false);
  const [feedbackProvider, setFeedbackProvider] = useState<string>("gemini");
  const [localImages, setLocalImages] = useState<
    { id: string; src: string; file: File }[]
  >([]);
  const [pendingFeedback, setPendingFeedback] = useState<{
    id: string;
    originalPrompt: string;
    suggestedPrompt: string;
    reason?: string;
    provider?: string;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 자동완성 관련 상태
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteItems, setAutocompleteItems] = useState<
    AutocompleteItem[]
  >([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [triggerChar, setTriggerChar] = useState<"/" | "@" | null>(null);
  const [triggerStartPos, setTriggerStartPos] = useState(0);

  // Commands 메모이제이션 (API 데이터 우선, 없으면 fallback)
  const commands = useMemo(() => getCommands(t, apiCommands), [t, apiCommands]);

  // 모든 이미지 합치기 (외부 images + 내부 localImages)
  const allImages = [...images, ...localImages];

  const handleSend = () => {
    if (!content.trim() && allImages.length === 0) return;
    if (disabled) return;

    // 피드백 모드가 활성화되어 있고, 아직 피드백을 받지 않은 경우
    if (feedbackEnabled && !pendingFeedback && mode === "claude-code") {
      // 실제 피드백 API 호출
      feedbackMutation.mutate(content, {
        onSuccess: (feedback) => {
          setPendingFeedback({
            id: crypto.randomUUID(),
            originalPrompt: content,
            suggestedPrompt: feedback,
            provider: feedbackProvider,
          });
        },
        onError: (error) => {
          console.error("Feedback request failed:", error);
          // 피드백 실패 시 그냥 전송 진행
          const imageFiles = localImages.map((img) => img.file);
          onSend(content, imageFiles);
          setContent("");
          localImages.forEach((img) => URL.revokeObjectURL(img.src));
          setLocalImages([]);
          setShowAutocomplete(false);
          setTriggerChar(null);
        },
      });
      return;
    }

    // 실제 전송
    const imageFiles = localImages.map((img) => img.file);
    onSend(content, imageFiles);
    setContent("");
    setPendingFeedback(null);
    // Cleanup local blob URLs
    localImages.forEach((img) => URL.revokeObjectURL(img.src));
    setLocalImages([]);
    // 자동완성 상태 초기화
    setShowAutocomplete(false);
    setTriggerChar(null);
  };

  // 피드백 무시 핸들러
  const handleFeedbackIgnore = () => {
    const imageFiles = localImages.map((img) => img.file);
    onSend(content, imageFiles);
    setContent("");
    setPendingFeedback(null);
    localImages.forEach((img) => URL.revokeObjectURL(img.src));
    setLocalImages([]);
  };

  // 피드백 수정 핸들러
  const handleFeedbackEdit = (suggestedPrompt: string) => {
    setContent(suggestedPrompt);
    setPendingFeedback(null);
    textareaRef.current?.focus();
  };

  // 요약 핸들러
  const handleSummary = () => {
    if (!sessionId) {
      console.error("Session ID is required for summary");
      return;
    }

    summaryMutation.mutate(sessionId, {
      onSuccess: (summary) => {
        // TODO: 토스트 시스템 구현 후 대체
        alert(`요약 완료:\n\n${summary}`);
      },
      onError: (error) => {
        console.error("Summary request failed:", error);
        alert(`요약 실패: ${error.message}`);
      },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showAutocomplete) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < autocompleteItems.length - 1 ? prev + 1 : 0,
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : autocompleteItems.length - 1,
        );
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (autocompleteItems[highlightedIndex]) {
          handleAutocompleteSelect(autocompleteItems[highlightedIndex]);
        }
        return;
      } else if (e.key === "Escape") {
        e.preventDefault();
        setShowAutocomplete(false);
        return;
      } else if (e.key === "Tab") {
        e.preventDefault();
        if (autocompleteItems[highlightedIndex]) {
          handleAutocompleteSelect(autocompleteItems[highlightedIndex]);
        }
        return;
      }
    } else if (e.key === "Enter" && !e.shiftKey) {
      // 자동완성이 열려있지 않을 때만 Enter로 전송
      e.preventDefault();
      handleSend();
    }
    // Shift+Enter: 기본 동작 (줄바꿈) - 별도 처리 불필요
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setContent(value);

    // 커서 위치 기준으로 현재 단어 추출
    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPos);

    // 마지막 공백 이후의 텍스트
    const lastSpaceIndex = textBeforeCursor.lastIndexOf(" ");
    const lastNewlineIndex = textBeforeCursor.lastIndexOf("\n");
    const lastBreakIndex = Math.max(lastSpaceIndex, lastNewlineIndex);
    const currentWord = textBeforeCursor.slice(lastBreakIndex + 1);

    if (currentWord.startsWith("/")) {
      setTriggerChar("/");
      setTriggerStartPos(lastBreakIndex + 1);
      const filtered = commands.filter((cmd) =>
        cmd.trigger.toLowerCase().includes(currentWord.toLowerCase()),
      );
      setAutocompleteItems(filtered);
      setShowAutocomplete(filtered.length > 0);
      setHighlightedIndex(0);
    } else if (currentWord.startsWith("@")) {
      setTriggerChar("@");
      setTriggerStartPos(lastBreakIndex + 1);
      const filtered = snippets
        .filter((snip) =>
          snip.trigger.toLowerCase().includes(currentWord.toLowerCase()),
        )
        .map((snip) => ({
          id: snip.id,
          trigger: snip.trigger,
          name: snip.name,
          type: "snippet" as const,
          value: snip.value,
        }));
      setAutocompleteItems(filtered);
      setShowAutocomplete(filtered.length > 0);
      setHighlightedIndex(0);
    } else {
      setShowAutocomplete(false);
      setTriggerChar(null);
    }
  };

  const handleAutocompleteSelect = (item: AutocompleteItem) => {
    if (!textareaRef.current) return;

    // 현재 커서 위치
    const cursorPos = textareaRef.current.selectionStart;

    // 트리거 문자부터 현재까지를 선택된 값으로 대체
    const beforeTrigger = content.slice(0, triggerStartPos);
    const afterCursor = content.slice(cursorPos);

    const newContent = beforeTrigger + item.value + " " + afterCursor;
    setContent(newContent);
    setShowAutocomplete(false);
    setTriggerChar(null);

    // 커서를 삽입된 텍스트 끝으로 이동
    setTimeout(() => {
      const newCursorPos = beforeTrigger.length + item.value.length + 1;
      textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos);
      textareaRef.current?.focus();
    }, 0);
  };

  const handleManageSnippets = () => {
    setShowAutocomplete(false);
    navigate("/settings?tab=snippets");
  };

  // 로컬 파일 처리 (파일 선택, 붙여넣기)
  const handleLocalFiles = (files: FileList) => {
    const imageFiles = Array.from(files).filter((f) =>
      f.type.startsWith("image/"),
    );
    const newImages = imageFiles.map((file) => ({
      id: crypto.randomUUID(),
      src: URL.createObjectURL(file),
      file,
    }));
    setLocalImages((prev) => [...prev, ...newImages]);
  };

  // 파일 입력 변경
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleLocalFiles(e.target.files);
    }
    // 같은 파일 재선택 허용
    e.target.value = "";
  };

  // 로컬 이미지 제거
  const handleRemoveLocalImage = (id: string) => {
    setLocalImages((prev) => {
      const image = prev.find((img) => img.id === id);
      if (image) {
        URL.revokeObjectURL(image.src);
      }
      return prev.filter((img) => img.id !== id);
    });
  };

  // 붙여넣기
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      const dataTransfer = new DataTransfer();
      files.forEach((file) => dataTransfer.items.add(file));
      handleLocalFiles(dataTransfer.files);
    }
  };

  // Textarea 높이 자동 조절
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = Math.min(scrollHeight, 300) + "px";
    }
  }, [content]);

  // Cleanup local blob URLs on unmount
  useEffect(() => {
    return () => {
      localImages.forEach((img) => URL.revokeObjectURL(img.src));
    };
  }, []);

  return (
    <div className="absolute bottom-4 left-0 right-0 pl-6 pr-[35px] py-4">
      <div className="max-w-3xl mx-auto">
        {/* 피드백 카드 */}
        {pendingFeedback && (
          <FeedbackCard
            feedback={pendingFeedback}
            onIgnore={handleFeedbackIgnore}
            onEdit={handleFeedbackEdit}
          />
        )}

        {/* Input Container */}
        <div className="relative">
          {/* Autocomplete Palette */}
          {showAutocomplete && (
            <AutocompletePalette
              items={autocompleteItems}
              isOpen={showAutocomplete}
              highlightedIndex={highlightedIndex}
              onSelect={handleAutocompleteSelect}
              onClose={() => setShowAutocomplete(false)}
              type={triggerChar === "/" ? "command" : "snippet"}
              onManageSnippets={
                triggerChar === "@" ? handleManageSnippets : undefined
              }
            />
          )}

          <div
            className={cn(
              "bg-bg-input border rounded-2xl px-4 py-3",
              "focus-within:border-border-strong focus-within:shadow-sm",
              "border-border-default",
              disabled && "opacity-50 cursor-not-allowed",
            )}
          >
            {/* 이미지 프리뷰 */}
            {allImages.length > 0 && (
              <ImagePreviewList
                images={allImages.map((img) => ({ id: img.id, src: img.src }))}
                onRemove={(id) => {
                  // 먼저 외부 images에서 찾기
                  if (images.some((img) => img.id === id)) {
                    onRemoveImage(id);
                  } else {
                    // localImages에서 제거
                    handleRemoveLocalImage(id);
                  }
                }}
              />
            )}

            {/* 입력창 (항상 멀티라인) */}
            <textarea
              ref={textareaRef}
              rows={1}
              value={content}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={placeholder || t("chat.inputPlaceholder")}
              disabled={disabled}
              className={cn(
                "w-full bg-transparent border-none outline-none resize-none",
                "text-base text-text-primary placeholder:text-text-tertiary",
                "overflow-y-auto scrollbar-thin",
              )}
            />

            {/* 하단 액션 바 */}
            <div className="flex items-center justify-between mt-2">
              {/* 왼쪽: 모델/제공자 선택 + 피드백 토글 */}
              <div className="flex items-center gap-3">
                {mode === "claude-code" ? (
                  <>
                    {/* Claude 모델 선택 */}
                    <ModelSelect
                      models={providerModels["claude-code"]}
                      selectedModelId={selectedModel || DEFAULT_CLAUDE_MODEL}
                      onModelChange={onModelChange}
                      disabled={disabled}
                    />

                    {/* 프롬프트 피드백 토글 */}
                    {showFeedbackToggle && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setFeedbackEnabled(!feedbackEnabled)}
                          disabled={disabled}
                          className={cn(
                            "relative w-9 h-5 rounded-full transition-all",
                            feedbackEnabled
                              ? "bg-accent-primary"
                              : "bg-bg-tertiary",
                            disabled && "opacity-50 cursor-not-allowed",
                          )}
                        >
                          <span
                            className={cn(
                              "absolute top-0.5 left-0.5 w-4 h-4 rounded-full",
                              "transition-transform duration-normal",
                              feedbackEnabled
                                ? "translate-x-4 bg-text-inverse"
                                : "translate-x-0 bg-white",
                            )}
                          />
                        </button>
                        <span className="text-sm text-text-secondary">
                          {t("chat.feedback")}
                        </span>

                        {/* 피드백 제공자 선택 - 피드백 활성화 시만 표시 */}
                        {feedbackEnabled && (
                          <FeedbackProviderSelect
                            selectedProvider={feedbackProvider}
                            onProviderChange={setFeedbackProvider}
                            disabled={disabled}
                          />
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* 제공자 선택 */}
                    <ProviderSelect
                      providers={PROVIDERS}
                      selectedProviderId={selectedProvider || DEFAULT_PROVIDER}
                      onProviderChange={onProviderChange}
                      disabled={disabled}
                    />

                    {/* 해당 제공자의 모델 선택 */}
                    <ModelSelect
                      models={
                        providerModels[selectedProvider || DEFAULT_PROVIDER] ||
                        []
                      }
                      selectedModelId={
                        selectedModel || DEFAULT_QUICK_CHAT_MODEL
                      }
                      onModelChange={onModelChange}
                      disabled={disabled}
                    />
                  </>
                )}
              </div>

              {/* 오른쪽: 버튼들 */}
              <div className="flex items-center gap-2">
                {/* 컨텍스트 요약 (Claude Code only) */}
                {mode === "claude-code" && showSummaryButton && (
                  <button
                    onClick={handleSummary}
                    className={cn(
                      "p-2 rounded-md text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-all",
                      // 요약이 없을 때 (요약 권장 상태) pulse 애니메이션 적용
                      showSummaryButton &&
                        "animate-pulse text-warning hover:text-warning",
                      (disabled || summaryMutation.isPending) &&
                        "opacity-50 cursor-not-allowed",
                    )}
                    title={
                      summaryMutation.isPending
                        ? t("chat.summarizing")
                        : t("chat.contextSummary")
                    }
                    disabled={disabled || summaryMutation.isPending}
                  >
                    <FileText size={18} />
                  </button>
                )}

                {/* 이미지 첨부 */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 rounded-md text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-all"
                  title={t("chat.attachImage")}
                  disabled={disabled}
                >
                  <Paperclip size={18} />
                </button>
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileInputChange}
                  className="hidden"
                />

                {/* 전송 */}
                <button
                  onClick={handleSend}
                  disabled={
                    (!content.trim() && allImages.length === 0) ||
                    disabled ||
                    feedbackMutation.isPending
                  }
                  className={cn(
                    "p-2 rounded-md transition-all",
                    (content.trim() || allImages.length > 0) &&
                      !disabled &&
                      !feedbackMutation.isPending
                      ? "bg-accent-primary text-text-inverse hover:bg-accent-hover"
                      : "bg-bg-tertiary text-text-secondary cursor-not-allowed",
                  )}
                  title={
                    feedbackMutation.isPending
                      ? t("chat.requestingFeedback")
                      : t("chat.send")
                  }
                >
                  <ArrowUp size={18} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatInput;
