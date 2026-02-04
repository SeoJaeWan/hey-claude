import {useState, useRef, useEffect} from "react";
import {ChevronDown, Check} from "lucide-react";
import {cn} from "../../../utils/cn";
import {Provider} from "../../../data/models";
import {useTranslation} from "../../../contexts/language";

interface ProviderSelectProps {
    providers: Provider[];
    selectedProviderId: string;
    onProviderChange: (providerId: string) => void;
    disabled?: boolean;
}

const ProviderSelect = ({providers, selectedProviderId, onProviderChange, disabled = false}: ProviderSelectProps) => {
    const {t} = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const selectedProvider = providers.find(p => p.id === selectedProviderId);

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
                <span>{selectedProvider?.name || t("common.selectProvider")}</span>
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
                        "min-w-[140px] py-1",
                        "bg-bg-primary border border-border-default rounded-lg",
                        "shadow-lg"
                    )}
                >
                    {providers.map(provider => (
                        <button
                            key={provider.id}
                            onClick={() => {
                                onProviderChange(provider.id);
                                setIsOpen(false);
                            }}
                            className={cn(
                                "w-full px-3 py-1.5 text-left text-sm",
                                "hover:bg-bg-tertiary transition-all",
                                "flex items-center justify-between gap-2",
                                provider.id === selectedProviderId ? "text-text-primary font-medium" : "text-text-secondary"
                            )}
                        >
                            <span>{provider.name}</span>
                            {provider.id === selectedProviderId && <Check size={14} className="text-accent-primary flex-shrink-0" />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ProviderSelect;
