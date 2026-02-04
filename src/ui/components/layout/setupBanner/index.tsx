import {ReactNode, useState} from "react";
import {Copy, Check} from "lucide-react";
import {cn} from "../../../utils/cn";
import {useTranslation} from "../../../contexts/language";

interface SetupBannerAction {
    label: string;
    onClick: () => void;
}

interface SetupBannerProps {
    variant?: "info" | "warning";
    icon?: ReactNode;
    title: string;
    description: string;
    code?: string | string[];
    hint?: string;
    actions?: SetupBannerAction[];
}

const SetupBanner = ({
    variant = "info",
    icon = null,
    title = "",
    description = "",
    code = undefined,
    hint = undefined,
    actions = [],
}: SetupBannerProps) => {
    const {t} = useTranslation();
    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

    const handleCopyCode = async (codeText: string, index: number) => {
        try {
            await navigator.clipboard.writeText(codeText);
            setCopiedIndex(index);
            setTimeout(() => setCopiedIndex(null), 2000);
        } catch (err) {
            console.error("Failed to copy code:", err);
        }
    };

    const codeArray = Array.isArray(code) ? code : code ? [code] : [];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

            {/* Banner */}
            <div
                className={cn(
                    "relative z-10",
                    "rounded-lg p-6 border-l-4",
                    "max-w-lg w-full mx-4",
                    "shadow-xl",
                    variant === "info" && [
                        "bg-blue-50 border-blue-500",
                        "dark:bg-gray-900 dark:border-blue-400",
                    ],
                    variant === "warning" && [
                        "bg-yellow-50 border-yellow-500",
                        "dark:bg-gray-900 dark:border-yellow-400",
                    ]
                )}
            >
                <div className="flex items-start gap-4">
                    {/* Icon */}
                    {icon && (
                        <div
                            className={cn(
                                "flex-shrink-0 mt-0.5",
                                variant === "info" && "text-blue-800 dark:text-blue-300",
                                variant === "warning" && "text-yellow-800 dark:text-yellow-200"
                            )}
                        >
                            {icon}
                        </div>
                    )}

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                        {/* Title */}
                        <h3
                            className={cn(
                                "text-sm font-semibold mb-1",
                                variant === "info" && "text-blue-800 dark:text-blue-300",
                                variant === "warning" && "text-yellow-800 dark:text-yellow-200"
                            )}
                        >
                            {title}
                        </h3>

                        {/* Description */}
                        <p
                            className={cn(
                                "text-xs",
                                variant === "info" && "text-blue-900 dark:text-blue-200",
                                variant === "warning" && "text-yellow-900 dark:text-yellow-200"
                            )}
                        >
                            {description}
                        </p>

                        {/* Code blocks */}
                        {codeArray.length > 0 && (
                            <div className="mt-3 space-y-2">
                                {codeArray.map((codeText, index) => (
                                    <div
                                        key={index}
                                        className={cn(
                                            "flex items-center gap-2",
                                            "bg-bg-tertiary rounded-md",
                                            "px-3 py-2",
                                            "font-mono text-sm"
                                        )}
                                    >
                                        <code className="flex-1 text-text-primary break-all">
                                            {codeText}
                                        </code>
                                        <button
                                            onClick={() => handleCopyCode(codeText, index)}
                                            className={cn(
                                                "flex-shrink-0 p-1 rounded",
                                                "text-text-secondary hover:text-text-primary",
                                                "hover:bg-bg-secondary transition-colors"
                                            )}
                                            aria-label={t("common.copyCode")}
                                        >
                                            {copiedIndex === index ? (
                                                <Check size={14} className="text-success" />
                                            ) : (
                                                <Copy size={14} />
                                            )}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Hint */}
                        {hint && (
                            <p className="mt-2 text-xs text-text-tertiary">
                                {hint}
                            </p>
                        )}

                        {/* Actions */}
                        {actions.length > 0 && (
                            <div className="mt-4 flex gap-2">
                                {actions.map((action, index) => (
                                    <button
                                        key={index}
                                        onClick={action.onClick}
                                        className={cn(
                                            "px-4 py-2 rounded-lg",
                                            "text-sm font-medium",
                                            "transition-all",
                                            variant === "info" && [
                                                "bg-blue-600 text-white",
                                                "hover:bg-blue-700",
                                                "dark:bg-blue-500 dark:hover:bg-blue-600",
                                            ],
                                            variant === "warning" && [
                                                "bg-yellow-600 text-white",
                                                "hover:bg-yellow-700",
                                                "dark:bg-yellow-500 dark:hover:bg-yellow-600",
                                            ]
                                        )}
                                    >
                                        {action.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SetupBanner;
