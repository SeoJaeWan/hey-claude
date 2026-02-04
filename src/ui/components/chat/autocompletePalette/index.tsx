import {useEffect, useRef} from "react";
import {Terminal, Code, Settings} from "lucide-react";
import {cn} from "../../../utils/cn";
import {AutocompleteItem} from "../../../data/autocomplete";

interface AutocompletePaletteProps {
    items: AutocompleteItem[];
    isOpen: boolean;
    highlightedIndex: number;
    onSelect: (item: AutocompleteItem) => void;
    onClose: () => void;
    type?: "command" | "snippet";
    onManageSnippets?: () => void;
}

const AutocompletePalette = ({items, isOpen, highlightedIndex, onSelect, onClose, type = "command", onManageSnippets}: AutocompletePaletteProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const highlightedItemRef = useRef<HTMLDivElement>(null);

    // 외부 클릭 감지
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isOpen, onClose]);

    // 하이라이트된 아이템이 보이도록 스크롤
    useEffect(() => {
        if (highlightedItemRef.current) {
            highlightedItemRef.current.scrollIntoView({
                block: "nearest",
                behavior: "smooth"
            });
        }
    }, [highlightedIndex]);

    if (!isOpen || items.length === 0) {
        return null;
    }

    return (
        <div
            ref={containerRef}
            className={cn(
                "absolute bottom-full left-0 right-0 mb-2",
                "bg-bg-primary border border-border-default rounded-lg shadow-lg",
                "max-h-[300px] overflow-y-auto",
                "animate-slideUp"
            )}
        >
            {items.map((item, index) => {
                const isHighlighted = index === highlightedIndex;
                const icon = item.type === "command" ? <Terminal size={16} /> : <Code size={16} />;

                return (
                    <div
                        key={item.id}
                        ref={isHighlighted ? highlightedItemRef : null}
                        className={cn(
                            "py-3 px-4 cursor-pointer flex items-center gap-3",
                            "transition-colors duration-fast",
                            isHighlighted ? "bg-bg-tertiary" : "hover:bg-bg-tertiary"
                        )}
                        onClick={() => onSelect(item)}
                    >
                        <span className="text-text-secondary flex-shrink-0">{icon}</span>
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                            <span className="font-mono text-sm font-medium text-text-primary flex-shrink-0">
                                {item.trigger}
                            </span>
                            <span className="text-sm text-text-secondary truncate">{item.name}</span>
                        </div>
                    </div>
                );
            })}

            {/* 스니펫 관리 버튼 (스니펫일 때만 표시) */}
            {type === "snippet" && onManageSnippets && (
                <div className="border-t border-border-default p-2">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onManageSnippets();
                        }}
                        className="w-full flex items-center justify-center gap-2 py-2 px-3 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-md transition-colors"
                    >
                        <Settings size={14} />
                        <span>스니펫 관리</span>
                    </button>
                </div>
            )}
        </div>
    );
};

export default AutocompletePalette;
