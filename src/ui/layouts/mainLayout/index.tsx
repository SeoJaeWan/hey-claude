import {Outlet, useParams, useLocation, useNavigate} from "react-router-dom";
import {useState, useEffect} from "react";
import Sidebar from "../../components/layout/sidebar";
import DeleteConfirmDialog from "../../components/commons/deleteConfirmDialog";
import RenameDialog from "../../components/session/renameDialog";
import SetupStatusBanner from "../../components/layout/setupStatusBanner";
import {useSessionsQuery, useUpdateSession, useDeleteSession} from "../../hooks/apis/queries/session";
import {useProjectPath} from "../../hooks/apis/queries/project";
import {useSetupStatusQuery} from "../../hooks/apis/queries/setup";
import {useTranslation} from "../../contexts/language";

const MainLayout = () => {
    const {t} = useTranslation();
    const {sessionId} = useParams<{sessionId?: string}>();
    const location = useLocation();
    const navigate = useNavigate();
    const [theme, setTheme] = useState<"light" | "dark">("light");
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
    const [renameDialogOpen, setRenameDialogOpen] = useState(false);
    const [sessionToRename, setSessionToRename] = useState<{id: string; name: string} | null>(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // API 훅
    const {data: projectPath = ""} = useProjectPath();
    const {data: sessions = []} = useSessionsQuery(projectPath);
    const {data: setupStatus, isLoading: isLoadingSetup} = useSetupStatusQuery();
    const updateSessionMutation = useUpdateSession();
    const deleteSessionMutation = useDeleteSession();

    // Setup 배너 타입 결정 (우선순위: claude-code > plugin)
    const getBannerType = (): "claude-code" | "plugin" | null => {
        if (isLoadingSetup) return null;
        if (!setupStatus?.claudeCode?.installed) return "claude-code";
        if (!setupStatus?.plugin?.installed) return "plugin";
        return null;
    };

    const bannerType = getBannerType();

    const isSettings = location.pathname.startsWith("/settings");
    const currentPage = isSettings ? "settings" : "chat";

    // 페이지 이동 시 사이드바 닫기 (모바일)
    useEffect(() => {
        setSidebarOpen(false);
    }, [location.pathname]);

    const toggleTheme = () => {
        const newTheme = theme === "light" ? "dark" : "light";
        setTheme(newTheme);
        document.documentElement.setAttribute("data-theme", newTheme);
    };

    const handleSessionClick = (id: string) => {
        navigate(`/chat/${id}`);
    };

    const handleNewSession = () => {
        navigate("/");
    };

    const handleSettingsClick = () => {
        if (isSettings) {
            navigate("/");
        } else {
            navigate("/settings");
        }
    };

    const handleSessionRename = (id: string, currentName: string) => {
        setSessionToRename({id, name: currentName});
        setRenameDialogOpen(true);
    };

    const handleRenameConfirm = async (newName: string) => {
        if (sessionToRename) {
            try {
                await updateSessionMutation.mutateAsync({
                    id: sessionToRename.id,
                    name: newName,
                });
            } catch (error) {
                console.error("Failed to rename session:", error);
                // TODO: 에러 토스트 표시
            }
        }
        setRenameDialogOpen(false);
        setSessionToRename(null);
    };

    const handleRenameCancel = () => {
        setRenameDialogOpen(false);
        setSessionToRename(null);
    };

    const handleSessionDelete = (id: string) => {
        setSessionToDelete(id);
        setDeleteDialogOpen(true);
    };

    const handleDeleteConfirm = async () => {
        if (sessionToDelete) {
            try {
                await deleteSessionMutation.mutateAsync(sessionToDelete);
                // 현재 보고 있던 세션을 삭제하면 메인으로 이동
                if (sessionId === sessionToDelete) {
                    navigate("/");
                }
            } catch (error) {
                console.error("Failed to delete session:", error);
                // TODO: 에러 토스트 표시
            }
        }
        setDeleteDialogOpen(false);
        setSessionToDelete(null);
    };

    const handleDeleteCancel = () => {
        setDeleteDialogOpen(false);
        setSessionToDelete(null);
    };

    return (
        <div className="flex h-screen w-screen bg-bg-primary">
            {/* 오버레이 (900px 미만에서 사이드바 열렸을 때만 표시) */}
            {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-40 max-lg:block hidden" onClick={() => setSidebarOpen(false)} />}

            <Sidebar
                sessions={sessions}
                activeSessionId={sessionId}
                currentPage={currentPage}
                theme={theme}
                isOpen={sidebarOpen}
                onSessionClick={handleSessionClick}
                onSessionRename={handleSessionRename}
                onSessionDelete={handleSessionDelete}
                onNewSession={handleNewSession}
                onSettingsClick={handleSettingsClick}
                onThemeToggle={toggleTheme}
                onClose={() => setSidebarOpen(false)}
            />
            <main className="flex-1 flex flex-col relative">
                {/* Setup 미완료 시 배너만 표시, Outlet 렌더링 차단 */}
                {bannerType ? (
                    <SetupStatusBanner type={bannerType} />
                ) : (
                    <Outlet context={{onMenuClick: () => setSidebarOpen(true)}} />
                )}
            </main>

            {/* Rename Dialog */}
            <RenameDialog isOpen={renameDialogOpen} sessionName={sessionToRename?.name || ""} onConfirm={handleRenameConfirm} onCancel={handleRenameCancel} />

            {/* Delete Confirm Dialog */}
            <DeleteConfirmDialog
                isOpen={deleteDialogOpen}
                title={t("session.deleteConfirmTitle")}
                message={`${t("session.deleteConfirmMessage")}\n${t("session.deleteConfirmDetail")}`}
                onConfirm={handleDeleteConfirm}
                onCancel={handleDeleteCancel}
            />
        </div>
    );
};

export default MainLayout;
