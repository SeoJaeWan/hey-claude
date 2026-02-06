import {Terminal, MessageCircle, MoreHorizontal} from "lucide-react";
import {useState} from "react";
import SessionMenu from "../menu";
import {formatRelativeTime} from "../../../utils/timeFormat";
import {useTranslation} from "../../../contexts/language";

interface SessionCardProps {
    session: {
        id: string;
        name: string;
        type: "claude-code" | "quick-chat";
        source: "terminal" | "web";
        updatedAt: string;
    };
    isActive?: boolean;
    onClick?: () => void;
    onRename?: (sessionId: string, currentName: string) => void;
    onDelete?: (sessionId: string) => void;
}

const SessionCard = ({session, isActive = false, onClick = () => {}, onRename = () => {}, onDelete = () => {}}: SessionCardProps) => {
    const {t} = useTranslation();
    const typeIcon = session.type === "claude-code" ? <Terminal size={14} /> : <MessageCircle size={14} />;
    const [menuOpen, setMenuOpen] = useState(false);

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
            <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5 text-text-primary">
                    <span className="flex-shrink-0">{typeIcon}</span>
                    <h3 className="text-sm font-medium truncate">{session.name || t("session.untitled")}</h3>
                </div>
            </div>
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
                <SessionMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} onRename={handleRename} onDelete={handleDelete} />
            </div>
        </button>
    );
};

export default SessionCard;
