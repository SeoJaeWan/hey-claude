import {memo, useState} from "react";
import {useTranslation} from "../../../contexts/language";
import type {PermissionRequestData} from "../../../types";

interface PermissionCardProps {
    permissionData: PermissionRequestData;
}

const getToolInputDisplay = (toolName: string, toolInput: any): string => {
    if (!toolInput) return "";
    switch (toolName) {
        case "Write":
        case "Edit":
        case "Read":
            return toolInput.file_path || toolInput.path || "";
        case "Bash":
            return toolInput.command || toolInput.cmd || "";
        case "Grep":
            return toolInput.pattern || "";
        case "Glob":
            return toolInput.pattern || "";
        default:
            return JSON.stringify(toolInput, null, 2);
    }
};

const PermissionCard = ({permissionData}: PermissionCardProps) => {
    const {t} = useTranslation();
    const {toolName, toolInput, decided, behavior, requestId} = permissionData;
    const [isExpanded, setIsExpanded] = useState(false);

    const displayContent = getToolInputDisplay(toolName, toolInput);
    const shouldCollapse = displayContent.split("\n").length > 3;

    const handleAllow = async () => {
        if (decided) return;
        try {
            await fetch("/api/chat/permission-decide", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({requestId, behavior: "allow"})
            });
        } catch (err) {
            console.error("Permission decide error:", err);
        }
    };

    const handleDeny = async () => {
        if (decided) return;
        try {
            await fetch("/api/chat/permission-decide", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({requestId, behavior: "deny"})
            });
        } catch (err) {
            console.error("Permission decide error:", err);
        }
    };

    return (
        <div
            className={`
                permission-card
                bg-background-primary border border-amber-500/50 rounded-lg p-4 my-2 space-y-3
                ${decided ? "opacity-75" : ""}
            `}
        >
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-text-primary">{t("permission.title")}</span>
                    <span className="inline-block px-2 py-0.5 text-xs font-mono bg-bg-code text-text-primary rounded">
                        {toolName}
                    </span>
                </div>
            </div>

            {/* Tool Input Display */}
            <div className="space-y-2">
                <div
                    className={`
                        bg-bg-block font-mono text-sm text-text-primary p-3 rounded
                        ${shouldCollapse && !isExpanded ? "line-clamp-3" : ""}
                    `}
                >
                    <pre className="whitespace-pre-wrap break-all">{displayContent}</pre>
                </div>

                {shouldCollapse && (
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="text-xs text-text-secondary hover:text-text-primary transition-colors"
                    >
                        {isExpanded ? t("permission.showLess") : t("permission.showMore")}
                    </button>
                )}
            </div>

            {/* Action Buttons or Decision Result */}
            {decided ? (
                <div className="flex items-center gap-2 text-sm">
                    {behavior === "allow" ? (
                        <>
                            <span className="text-green-600 dark:text-green-400">✓</span>
                            <span className="text-green-600 dark:text-green-400 font-medium">
                                {t("permission.allowed")}
                            </span>
                        </>
                    ) : behavior === "deny" ? (
                        <>
                            <span className="text-red-600 dark:text-red-400">✕</span>
                            <span className="text-red-600 dark:text-red-400 font-medium">
                                {t("permission.denied")}
                            </span>
                        </>
                    ) : (
                        <>
                            <span className="text-text-tertiary">—</span>
                            <span className="text-text-tertiary font-medium">
                                {t("permission.expired")}
                            </span>
                        </>
                    )}
                </div>
            ) : (
                <div className="space-y-2">
                    <div className="flex items-center justify-end gap-2">
                        <button
                            onClick={handleDeny}
                            className="
                                px-4 py-2 rounded-lg text-sm font-medium transition-all
                                bg-red-600 hover:bg-red-700 text-white
                            "
                        >
                            {t("permission.deny")}
                        </button>
                        <button
                            onClick={handleAllow}
                            className="
                                px-4 py-2 rounded-lg text-sm font-medium transition-all
                                bg-green-600 hover:bg-green-700 text-white
                            "
                        >
                            {t("permission.allow")}
                        </button>
                    </div>
                    <p className="text-xs text-text-tertiary text-right">{t("permission.waiting")}</p>
                </div>
            )}
        </div>
    );
};

export default memo(PermissionCard);
