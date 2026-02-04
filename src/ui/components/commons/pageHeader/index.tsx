import {Menu} from "lucide-react";
import {cn} from "../../../utils/cn";
import {useTranslation} from "../../../contexts/language";

interface PageHeaderProps {
    title: string;
    onMenuClick: () => void;
}

const PageHeader = (props: PageHeaderProps) => {
    const {title, onMenuClick} = props;
    const {t} = useTranslation();

    return (
        <header className="px-6 py-4 border-b border-border-default flex items-center justify-between">
            {/* 타이틀 */}
            <h1 className="text-xl font-semibold text-text-primary truncate">{title}</h1>

            {/* 햄버거 버튼 - 900px 이상에서 숨김 */}
            <button
                onClick={onMenuClick}
                className={cn(
                    "p-2 rounded-md flex-shrink-0",
                    "bg-bg-secondary border border-border-default",
                    "hover:bg-bg-tertiary transition-colors",
                    "lg:hidden"
                )}
                aria-label={t("common.openMenu")}
            >
                <Menu size={20} />
            </button>
        </header>
    );
};

export default PageHeader;
