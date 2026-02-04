import {useState, useRef, useEffect} from "react";
import {ChevronDown} from "lucide-react";
import {cn} from "../../../utils/cn";
import {useTranslation} from "../../../contexts/language";

interface FeedbackProviderSelectProps {
    selectedProvider: string;
    onProviderChange: (providerId: string) => void;
    disabled?: boolean;
}

const FeedbackProviderSelect = ({selectedProvider, onProviderChange, disabled = false}: FeedbackProviderSelectProps) => {
    const {t} = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const FEEDBACK_PROVIDERS = [
        {id: "gemini", name: t("providers.gemini.name"), description: t("providers.gemini.description")},
        {id: "groq", name: t("providers.groq.name"), description: t("providers.groq.description")},
        {id: "codex", name: t("providers.codex.name"), description: t("providers.codex.description")}
    ];

    const selectedProviderName = FEEDBACK_PROVIDERS.find((p) => p.id === selectedProvider)?.name || "Gemini";

    // 외부 클릭 시 닫기
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isOpen]);

    // Escape 키로 닫기
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape" && isOpen) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener("keydown", handleEscape);
        }

        return () => {
            document.removeEventListener("keydown", handleEscape);
        };
    }, [isOpen]);

    const handleSelect = (providerId: string) => {
        onProviderChange(providerId);
        setIsOpen(false);
    };

    return (
        <div className="relative" ref={dropdownRef}>
            {/* Trigger - 작은 스타일 */}
            <button
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
                className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded-lg",
                    "text-xs text-text-secondary",
                    "hover:text-text-primary hover:bg-bg-tertiary transition-all",
                    isOpen && "text-text-primary bg-bg-tertiary",
                    disabled && "opacity-50 cursor-not-allowed"
                )}
            >
                <span>{selectedProviderName}</span>
                <ChevronDown size={12} className={cn("transition-transform", isOpen && "rotate-180")} />
            </button>

            {/* Dropdown - 위로 열림 */}
            {isOpen && (
                <div
                    className={cn(
                        "absolute bottom-full right-0 mb-1 z-50",
                        "min-w-[120px]",
                        "bg-bg-primary border border-border-default rounded-lg",
                        "shadow-md overflow-hidden"
                    )}
                >
                    {FEEDBACK_PROVIDERS.map((provider) => (
                        <button
                            key={provider.id}
                            onClick={() => handleSelect(provider.id)}
                            className={cn(
                                "w-full text-left px-3 py-2 text-xs transition-colors",
                                "hover:bg-bg-tertiary",
                                selectedProvider === provider.id && "bg-bg-tertiary font-medium"
                            )}
                        >
                            <div className="text-text-primary">{provider.name}</div>
                            <div className="text-text-tertiary text-[10px]">{provider.description}</div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default FeedbackProviderSelect;
