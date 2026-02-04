import {useState, useRef, useEffect} from "react";
import {ChevronDown, Check} from "lucide-react";
import {cn} from "../../../utils/cn";
import {useTranslation} from "../../../contexts/language";

export interface Model {
    id: string;
    name: string;
    provider: string;
    description?: string;
}

interface ModelSelectProps {
    models: Model[];
    selectedModelId: string;
    onModelChange: (modelId: string) => void;
    disabled?: boolean;
}

const ModelSelect = ({models, selectedModelId, onModelChange, disabled = false}: ModelSelectProps) => {
    const {t} = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const selectedModel = models.find(m => m.id === selectedModelId);

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

    return (
        <div className="relative" ref={dropdownRef}>
            {/* Trigger - 가벼운 스타일 */}
            <button
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
                className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded-lg",
                    "text-sm text-text-secondary",
                    "hover:text-text-primary hover:bg-bg-tertiary transition-all",
                    isOpen && "text-text-primary bg-bg-tertiary",
                    disabled && "opacity-50 cursor-not-allowed"
                )}
            >
                <span>{selectedModel?.name || t("common.selectModel")}</span>
                <ChevronDown
                    size={14}
                    className={cn("transition-transform", isOpen && "rotate-180")}
                />
            </button>

            {/* Dropdown - 위로 열림 */}
            {isOpen && (
                <div
                    className={cn(
                        "absolute bottom-full left-0 mb-1 z-50",
                        "min-w-[180px] py-1",
                        "bg-bg-primary border border-border-default rounded-lg",
                        "shadow-lg"
                    )}
                >
                    {models.map(model => (
                        <button
                            key={model.id}
                            onClick={() => {
                                onModelChange(model.id);
                                setIsOpen(false);
                            }}
                            className={cn(
                                "w-full px-3 py-1.5 text-left text-sm",
                                "hover:bg-bg-tertiary transition-all",
                                "flex items-center justify-between gap-2",
                                model.id === selectedModelId ? "text-text-primary font-medium" : "text-text-secondary"
                            )}
                        >
                            <span>{model.name}</span>
                            {model.id === selectedModelId && <Check size={14} className="text-accent-primary flex-shrink-0" />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ModelSelect;
