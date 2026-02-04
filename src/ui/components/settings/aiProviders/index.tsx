import {useState, useEffect} from "react";
import {Terminal, Check, X, AlertCircle, RefreshCw, Eye, EyeOff, Key} from "lucide-react";
import {cn} from "../../../utils/cn";
import {useUpdateSettings, type Config} from "../../../hooks/apis/queries/settings";
import {useCliStatusQuery} from "../../../hooks/apis/queries/cli";
import {useTranslation} from "../../../contexts/language";

interface AIProvidersSettingsProps {
    config: Config;
}

const AIProvidersSettings = ({config}: AIProvidersSettingsProps) => {
    const {t} = useTranslation();
    const updateSettings = useUpdateSettings();
    const {data: providers = [], isLoading, refetch, isFetching} = useCliStatusQuery();

    const [selectedProvider, setSelectedProvider] = useState(config.multiAI.quickChatModel);
    const [apiKey, setApiKey] = useState(config.apiKeys.groq || "");
    const [showApiKey, setShowApiKey] = useState(false);

    // config가 변경되면 상태 동기화
    useEffect(() => {
        setSelectedProvider(config.multiAI.quickChatModel);
        setApiKey(config.apiKeys.groq || "");
    }, [config.multiAI.quickChatModel, config.apiKeys.groq]);

    const claudeCode = providers.find(p => p.id === "claude-code");
    const generalProviders = providers.filter(p => p.id !== "claude-code");

    const handleProviderChange = (providerId: string) => {
        setSelectedProvider(providerId);
        updateSettings.mutate({
            multiAI: {
                ...config.multiAI,
                quickChatModel: providerId,
            },
        });
    };

    const handleApiKeySave = () => {
        updateSettings.mutate({
            apiKeys: {
                ...config.apiKeys,
                groq: apiKey,
            },
        });
    };

    const handleRefresh = () => {
        refetch();
    };

    // 초기 로딩 상태
    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="text-text-secondary">{t("common.loading")}</div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-base font-semibold text-text-primary mb-2">{t("settings.aiProviders.title")}</h3>
                </div>
                <button
                    onClick={handleRefresh}
                    disabled={isFetching}
                    className={cn(
                        "p-2 rounded-md text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors",
                        isFetching && "animate-spin"
                    )}
                    title={t("settings.aiProviders.refresh")}
                >
                    <RefreshCw size={18} />
                </button>
            </div>

            {/* Claude Code Section (별도 박스, 라디오 없음) */}
            {claudeCode && (
                <div>
                    <p className="text-sm font-medium text-text-secondary mb-3">{t("settings.aiProviders.claudeCodeSection")}</p>
                    <div
                        className={cn(
                            "flex items-center justify-between",
                            "p-4 bg-bg-secondary border border-border-default rounded-lg"
                        )}
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-md bg-bg-tertiary flex items-center justify-center">
                                <Terminal size={20} className="text-text-secondary" />
                            </div>
                            <div className="flex flex-col gap-1">
                                <div className="font-medium text-base text-text-primary">{claudeCode.name}</div>
                                <div className="flex items-center gap-3 text-sm">
                                    <div
                                        className={cn(
                                            "flex items-center gap-1",
                                            claudeCode.installed ? "text-success" : "text-text-tertiary"
                                        )}
                                    >
                                        {claudeCode.installed ? <Check size={14} /> : <X size={14} />}
                                        <span>{claudeCode.installed ? `v${claudeCode.version}` : t("common.notInstalled")}</span>
                                    </div>
                                    {claudeCode.description && (
                                        <span className="text-text-tertiary">{claudeCode.description}</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Divider */}
            <div className="border-t border-border-default my-6" />

            {/* General Question Providers Section */}
            <div>
                <p className="text-sm font-medium text-text-secondary mb-3">{t("settings.aiProviders.quickChatSection")}</p>
                <div className="space-y-3">
                    {generalProviders.map(provider => {
                        const isSelected = selectedProvider === provider.id;
                        const isAvailable =
                            provider.type === "cli" ? provider.installed : provider.apiKeySet || apiKey.length > 0;

                        return (
                            <div
                                key={provider.id}
                                className={cn(
                                    "p-4 bg-bg-secondary border rounded-lg",
                                    "transition-all",
                                    isSelected ? "border-accent-primary ring-2 ring-accent-primary" : "border-border-default"
                                )}
                            >
                                <label className="flex items-start gap-3 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="default-provider"
                                        value={provider.id}
                                        checked={isSelected}
                                        onChange={() => handleProviderChange(provider.id)}
                                        disabled={!isAvailable && provider.type === "cli"}
                                        className="mt-1 w-4 h-4 accent-accent-primary cursor-pointer"
                                    />
                                    <div className="flex-1">
                                        <div className="flex items-center gap-3 mb-1">
                                            <div className="w-10 h-10 rounded-md bg-bg-tertiary flex items-center justify-center">
                                                {provider.type === "cli" ? (
                                                    <Terminal size={20} className="text-text-secondary" />
                                                ) : (
                                                    <Key size={20} className="text-text-secondary" />
                                                )}
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <div className="font-medium text-base text-text-primary">
                                                    {provider.name}
                                                </div>
                                                {provider.type === "cli" && (
                                                    <div className="flex items-center gap-3 text-sm">
                                                        <div
                                                            className={cn(
                                                                "flex items-center gap-1",
                                                                provider.installed ? "text-success" : "text-text-tertiary"
                                                            )}
                                                        >
                                                            {provider.installed ? <Check size={14} /> : <X size={14} />}
                                                            <span>
                                                                {provider.installed ? `v${provider.version}` : t("common.notInstalled")}
                                                            </span>
                                                        </div>
                                                        {provider.installed && provider.loggedIn !== undefined && (
                                                            <div
                                                                className={cn(
                                                                    "flex items-center gap-1",
                                                                    provider.loggedIn ? "text-success" : "text-warning"
                                                                )}
                                                            >
                                                                <AlertCircle size={14} />
                                                                <span>{provider.loggedIn ? t("common.loggedIn") : t("common.loginRequired")}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                                {provider.description && (
                                                    <span className="text-sm text-text-tertiary">{provider.description}</span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Groq API Key Input (인라인) */}
                                        {provider.type === "api" && provider.id === "groq" && (
                                            <div className="mt-3 flex items-center gap-2">
                                                <input
                                                    type={showApiKey ? "text" : "password"}
                                                    value={apiKey}
                                                    onChange={e => setApiKey(e.target.value)}
                                                    placeholder="gsk_..."
                                                    className={cn(
                                                        "flex-1 bg-bg-input border border-border-default rounded-md px-3 py-2",
                                                        "text-sm font-mono text-text-primary",
                                                        "focus:outline-none focus:border-border-focus",
                                                        showApiKey ? "" : "tracking-wider"
                                                    )}
                                                />
                                                <button
                                                    onClick={() => setShowApiKey(!showApiKey)}
                                                    className="p-2 rounded-md text-text-secondary hover:bg-bg-tertiary transition-colors"
                                                >
                                                    {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
                                                </button>
                                                <button
                                                    onClick={handleApiKeySave}
                                                    disabled={apiKey === (config.apiKeys.groq || "")}
                                                    className={cn(
                                                        "px-3 py-2 rounded-md text-sm font-medium transition-colors",
                                                        apiKey !== (config.apiKeys.groq || "")
                                                            ? "bg-accent-primary text-text-inverse hover:bg-accent-hover"
                                                            : "bg-bg-tertiary text-text-tertiary cursor-not-allowed"
                                                    )}
                                                >
                                                    {t("common.save")}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </label>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default AIProvidersSettings;
