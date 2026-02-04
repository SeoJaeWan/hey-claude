import {Plus, Settings, Sun, Moon, X} from "lucide-react";
import Button from "../../commons/button";
import SessionList from "../../session/list";
import {cn} from "../../../utils/cn";
import {useTranslation} from "../../../contexts/language";

interface Session {
    id: string;
    name: string;
    type: "claude-code" | "quick-chat";
    source: "web" | "terminal";
    updatedAt: string;
}

interface SidebarProps {
    sessions?: Session[];
    activeSessionId?: string;
    onSessionClick?: (id: string) => void;
    onSessionRename?: (id: string, currentName: string) => void;
    onSessionDelete?: (id: string) => void;
    onNewSession?: () => void;
    currentPage?: "chat" | "settings";
    theme?: "light" | "dark";
    onThemeToggle?: () => void;
    onSettingsClick?: () => void;
    isOpen?: boolean;
    onClose?: () => void;
}

const Sidebar = (props: SidebarProps) => {
    const {
        sessions = [],
        activeSessionId = "",
        onSessionClick = () => {},
        onSessionRename = () => {},
        onSessionDelete = () => {},
        onNewSession = () => {},
        currentPage = "chat",
        theme = "light",
        onThemeToggle = () => {},
        onSettingsClick = () => {},
        isOpen = false,
        onClose = () => {}
    } = props;

    const {t} = useTranslation();

    return (
        <aside
            className={cn(
                "h-full bg-bg-secondary border-r border-border-default flex flex-col",
                "transition-all duration-300",
                // 기본 너비
                "w-[280px]",
                // 1200px 이하: 240px
                "xl:w-[280px]",
                // 900px 미만: 모바일 모드 (fixed, left-0, top-0, z-50)
                "max-lg:fixed max-lg:left-0 max-lg:top-0 max-lg:z-50",
                // 900px 미만에서 닫혔을 때: -translate-x-full
                !isOpen && "max-lg:-translate-x-full",
                // 900px 이상: 항상 보이기 (relative, translate-x-0)
                "lg:relative lg:translate-x-0"
            )}
        >
            {/* Logo */}
            <div className="p-4 border-b border-border-default flex items-center justify-between">
                <h1 className="text-lg font-bold font-mono text-text-primary">hey-claude</h1>
                {/* 닫기 버튼 (900px 미만에서만) */}
                <button
                    onClick={onClose}
                    className="p-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors lg:hidden"
                    aria-label={t("session.closeMenu")}
                >
                    <X size={20} />
                </button>
            </div>

            {/* New Session Button */}
            <div className="p-4 border-b border-border-default">
                <Button className="w-full gap-2" onClick={onNewSession}>
                    <Plus size={16} />{t("sidebar.newSession")}
                </Button>
            </div>

            {/* Session List */}
            <div className="flex-1 overflow-y-auto p-4">
                <SessionList
                    sessions={sessions}
                    activeSessionId={activeSessionId}
                    onSessionClick={onSessionClick}
                    onSessionRename={onSessionRename}
                    onSessionDelete={onSessionDelete}
                />
            </div>

            {/* Settings & Theme */}
            <div className="p-4 border-t border-border-default flex items-center justify-between">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onSettingsClick}
                    className={cn(currentPage === "settings" && "bg-bg-tertiary text-text-primary")}
                >
                    <Settings size={18} />
                </Button>
                <Button variant="ghost" size="sm" onClick={onThemeToggle}>
                    {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
                </Button>
            </div>
        </aside>
    );
};

export default Sidebar;
