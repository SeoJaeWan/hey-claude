import {Terminal, MessageCircle, MoreHorizontal} from "lucide-react";
import {useState} from "react";
import SessionMenu from "../menu";
import {formatRelativeTime} from "../../../utils/timeFormat";
import {useTranslation} from "../../../contexts/language";
import type {Session} from "../../../types";

interface SessionCardProps {
    session: Session;
    isActive?: boolean;
    onClick?: () => void;
    onRename?: (sessionId: string, currentName: string) => void;
    onDelete?: (sessionId: string) => void;
    onOpenInNewTab?: () => void;
}

const SessionCard = ({
    session,
    isActive = false,
    onClick = () => {},
    onRename = () => {},
    onDelete = () => {},
    onOpenInNewTab = () => {}
}: SessionCardProps) => {
    const {t} = useTranslation();
    const typeIcon = session.type === "claude-code" ? <Terminal size={14} /> : <MessageCircle size={14} />;
    const [menuOpen, setMenuOpen] = useState(false);

    // Determine session state based on streamStatus
    const streamStatus = session.streamStatus || "idle";
    const isIdle = streamStatus === "idle";

    // Status indicator color
    const getStatusColor = () => {
        if (streamStatus === "background_tasks") return "bg-success"; // Green
        if (streamStatus === "streaming") return "bg-info"; // Blue
        return "bg-text-tertiary"; // Gray
    };

    // Status text
    const getStatusText = () => {
        if (streamStatus === "background_tasks") {
            return t("session.backgroundTasks", {count: session.backgroundTasksCount || 0});
        }
        if (streamStatus === "streaming") {
            return t("session.streaming");
        }
        return ""; // Don't show idle status
    };

    // Status text color
    const getStatusTextColor = () => {
        if (streamStatus === "background_tasks") return "text-success"; // Green
        if (streamStatus === "streaming") return "text-info"; // Blue
        return "text-text-secondary";
    };

    // Show ping animation for background tasks
    const shouldPing = streamStatus === "background_tasks";

    const handleMenuClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setMenuOpen(prev => !prev);
    };

    const handleRename = () => {
        onRename(session.id, session.name);
    };

    const handleDelete = () => {
        onDelete(session.id);
    };

    return (
        <button
            onClick={onClick}
            className={`
        relative w-full text-left p-3 rounded-md
        transition-all duration-normal
        cursor-pointer group
        ${isActive ? "bg-bg-tertiary" : "hover:bg-bg-tertiary"}
        ${menuOpen ? "z-10" : ""}
      `}
        >
            {/* Status Indicator */}
            {!isIdle && (
                <div className="absolute right-3 top-3">
                    <div className="relative flex items-center justify-center w-3 h-3">
                        {shouldPing && <span className={`absolute inline-flex h-full w-full rounded-full ${getStatusColor()} opacity-75 animate-ping`} />}
                        <span className={`relative inline-flex rounded-full h-3 w-3 ${getStatusColor()}`} />
                    </div>
                </div>
            )}

            <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5 text-text-primary">
                    <span className="flex-shrink-0">{typeIcon}</span>
                    <h3 className="text-sm font-medium truncate">{session.name || t("session.untitled")}</h3>
                </div>
            </div>

            {/* Status Text */}
            {getStatusText() && <div className={`text-xs ${getStatusTextColor()} mb-1 font-medium`}>{getStatusText()}</div>}

            <div className="text-xs text-text-tertiary">{formatRelativeTime(session.updatedAt, t)}</div>

            {/* Menu Button & Dropdown Container */}
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
                <button
                    onClick={handleMenuClick}
                    className="w-6 h-6 rounded-md bg-transparent text-text-tertiary opacity-0 group-hover:opacity-100 hover:bg-bg-tertiary hover:text-text-primary flex items-center justify-center transition-all"
                    aria-label={t("session.menu")}
                >
                    <MoreHorizontal size={16} />
                </button>

                {/* Session Menu - positioned below the button */}
                <SessionMenu
                    isOpen={menuOpen}
                    onClose={() => setMenuOpen(false)}
                    onRename={handleRename}
                    onDelete={handleDelete}
                    onOpenInNewTab={onOpenInNewTab}
                />
            </div>
        </button>
    );
};

export default SessionCard;
