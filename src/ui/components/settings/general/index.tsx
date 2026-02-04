import {useState, useEffect} from "react";
import {useUpdateSettings, type Config} from "../../../hooks/apis/queries/settings";
import {useLanguage, type Language} from "../../../contexts/language";
import {useTranslation} from "../../../contexts/language";

interface GeneralSettingsProps {
    config: Config;
}

const GeneralSettings = ({config}: GeneralSettingsProps) => {
    const [selectedTheme, setSelectedTheme] = useState<"light" | "dark" | "system">(config.theme);
    const {language, setLanguage} = useLanguage();
    const {t} = useTranslation();
    const updateSettings = useUpdateSettings();

    // config가 변경되면 상태 동기화
    useEffect(() => {
        setSelectedTheme(config.theme);
    }, [config.theme]);

    // 테마 변경 핸들러
    const handleThemeChange = (newTheme: "light" | "dark" | "system") => {
        setSelectedTheme(newTheme);

        // 1. 즉시 적용 (DOM)
        if (newTheme === "system") {
            const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
            const actualTheme = prefersDark ? "dark" : "light";
            document.documentElement.setAttribute("data-theme", actualTheme);
        } else {
            document.documentElement.setAttribute("data-theme", newTheme);
        }

        // 2. 서버에 저장
        updateSettings.mutate({theme: newTheme});
    };

    // 언어 변경 핸들러
    const handleLanguageChange = (newLanguage: Language) => {
        // 1. 즉시 적용 (Context)
        setLanguage(newLanguage);

        // 2. 서버에 저장
        updateSettings.mutate({language: newLanguage});
    };

    return (
        <div className="space-y-6">
            {/* 테마 선택 */}
            <section className="settings-section">
                <h3 className="text-base font-semibold text-text-primary mb-3">{t("settings.general.theme")}</h3>
                <p className="text-sm text-text-secondary mb-3">{t("settings.general.themeDescription")}</p>

                <div className="flex gap-4">
                    {(["light", "dark", "system"] as const).map(themeOption => (
                        <label key={themeOption} className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="radio"
                                name="theme"
                                value={themeOption}
                                checked={selectedTheme === themeOption}
                                onChange={() => handleThemeChange(themeOption)}
                                className="w-4 h-4 accent-accent-primary cursor-pointer"
                            />
                            <span className="text-sm text-text-primary">
                                {themeOption === "light" ? t("settings.general.themeLight") : themeOption === "dark" ? t("settings.general.themeDark") : t("settings.general.themeSystem")}
                            </span>
                        </label>
                    ))}
                </div>
            </section>

            {/* 언어 선택 */}
            <section className="settings-section">
                <h3 className="text-base font-semibold text-text-primary mb-3">{t("settings.general.language")}</h3>
                <p className="text-sm text-text-secondary mb-3">{t("settings.general.languageDescription")}</p>

                <div className="relative">
                    <select
                        value={language}
                        onChange={e => handleLanguageChange(e.target.value as Language)}
                        className="w-full max-w-xs px-3 py-2 bg-bg-input border border-border-default rounded-md text-sm text-text-primary cursor-pointer hover:border-border-strong focus:outline-none focus:border-border-focus transition-colors"
                    >
                        <option value="en">English</option>
                        <option value="ko">한국어</option>
                    </select>
                </div>
            </section>

            {/* 자동 시작 설정 */}
            <section className="settings-section">
                <h3 className="text-base font-semibold text-text-primary mb-3">{t("settings.general.autoStart")}</h3>
                <p className="text-sm text-text-secondary mb-3">{t("settings.general.autoStartDescription")}</p>

                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={config.server.autoStart}
                        onChange={e =>
                            updateSettings.mutate({server: {...config.server, autoStart: e.target.checked}})
                        }
                        className="w-4 h-4 accent-accent-primary cursor-pointer"
                    />
                    <span className="text-sm text-text-primary">{t("common.enableAutoStart")}</span>
                </label>
            </section>
        </div>
    );
};

export default GeneralSettings;
