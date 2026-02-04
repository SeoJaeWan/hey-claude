import {useState, useEffect} from "react";
import {useSearchParams, useOutletContext} from "react-router-dom";
import PageHeader from "../../components/commons/pageHeader";
import GeneralSettings from "../../components/settings/general";
import AIProvidersSettings from "../../components/settings/aiProviders";
import SnippetsSettings from "../../components/settings/snippets";
import {cn} from "../../utils/cn";
import {useSettingsQuery} from "../../hooks/apis/queries/settings";
import {useTranslation} from "../../contexts/language";

type SettingsTab = "general" | "ai-providers" | "snippets";

const SettingsPage = () => {
    const [searchParams] = useSearchParams();
    const {onMenuClick} = useOutletContext<{onMenuClick: () => void}>();
    const initialTab = (searchParams.get("tab") as SettingsTab) || "general";
    const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
    const {t} = useTranslation();

    // 설정 조회
    const {data: config, isLoading, error} = useSettingsQuery();

    useEffect(() => {
        const tab = searchParams.get("tab") as SettingsTab;
        if (tab && ["general", "ai-providers", "snippets"].includes(tab)) {
            setActiveTab(tab);
        }
    }, [searchParams]);

    const tabs: {id: SettingsTab; label: string}[] = [
        {id: "general", label: t("settings.tabs.general")},
        {id: "ai-providers", label: t("settings.tabs.aiProviders")},
        {id: "snippets", label: t("settings.tabs.snippets")}
    ];

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <PageHeader title={t("settings.title")} onMenuClick={onMenuClick} />

            {/* Tabs Navigation */}
            <div className="px-6 py-4 border-b border-border-default">
                <div className="flex gap-1">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                                "px-4 py-2 rounded-md",
                                "text-sm font-medium",
                                "transition-all duration-normal",
                                activeTab === tab.id ? "text-text-primary bg-accent-subtle" : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
                            )}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Settings Content */}
            <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-3xl">
                    {isLoading && (
                        <div className="flex items-center justify-center py-12">
                            <div className="text-text-secondary">{t("common.loading")}</div>
                        </div>
                    )}

                    {error && (
                        <div className="flex items-center justify-center py-12">
                            <div className="text-error">{t("settings.loadError")}</div>
                        </div>
                    )}

                    {config && (
                        <>
                            {activeTab === "general" && <GeneralSettings config={config} />}
                            {activeTab === "ai-providers" && <AIProvidersSettings config={config} />}
                            {activeTab === "snippets" && <SnippetsSettings />}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SettingsPage;
