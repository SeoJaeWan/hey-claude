import {Terminal, Plug} from "lucide-react";
import SetupBanner from "../setupBanner";
import {useTranslation} from "../../../contexts/language";

type SetupStatusType = "claude-code" | "plugin";

interface SetupStatusBannerProps {
    type: SetupStatusType;
}

const SetupStatusBanner = ({type}: SetupStatusBannerProps) => {
    const {t} = useTranslation();

    const getBannerData = () => {
        switch (type) {
            case "claude-code":
                return {
                    variant: "warning" as const,
                    icon: <Terminal size={20} />,
                    title: t("setup.claudeCode.title"),
                    description: t("setup.claudeCode.description"),
                    code: "npm install -g @anthropic-ai/claude-code",
                    hint: t("setup.refreshHint")
                };
            case "plugin":
                return {
                    variant: "info" as const,
                    icon: <Plug size={20} />,
                    title: t("setup.plugin.title"),
                    description: t("setup.plugin.description"),
                    code: [
                        "/plugin marketplace add SeoJaeWan/hey-claude",
                        "/plugin install hey-claude"
                    ],
                    hint: t("setup.plugin.hint")
                };
        }
    };

    const data = getBannerData();

    const handleRefresh = () => {
        window.location.reload();
    };

    return (
        <SetupBanner
            variant={data.variant}
            icon={data.icon}
            title={data.title}
            description={data.description}
            code={data.code}
            hint={data.hint}
            actions={[
                {
                    label: t("setup.refresh"),
                    onClick: handleRefresh
                }
            ]}
        />
    );
};

export default SetupStatusBanner;
