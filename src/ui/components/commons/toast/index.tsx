import {useEffect} from "react";
import {X, CheckCircle, AlertCircle, AlertTriangle, Info} from "lucide-react";
import {cn} from "../../../utils/cn";
import {Toast as ToastType} from "../../../contexts/toast";
import {useTranslation} from "../../../contexts/language";

interface ToastProps {
    toast: ToastType;
    onRemove: (id: string) => void;
}

const Toast = ({toast, onRemove}: ToastProps) => {
    const {t} = useTranslation();
    const {id, message, type, duration} = toast;

    useEffect(() => {
        if (duration && duration > 0) {
            const timer = setTimeout(() => {
                onRemove(id);
            }, duration);
            return () => clearTimeout(timer);
        }
    }, [id, duration, onRemove]);

    const getIcon = () => {
        switch (type) {
            case "success":
                return <CheckCircle size={18} className="flex-shrink-0" />;
            case "error":
                return <AlertCircle size={18} className="flex-shrink-0" />;
            case "warning":
                return <AlertTriangle size={18} className="flex-shrink-0" />;
            case "info":
                return <Info size={18} className="flex-shrink-0" />;
        }
    };

    const getStyles = () => {
        switch (type) {
            case "success":
                return "bg-bg-primary border-success text-success";
            case "error":
                return "bg-bg-primary border-error text-error";
            case "warning":
                return "bg-bg-primary border-warning text-warning";
            case "info":
                return "bg-bg-primary border-border-strong text-text-secondary";
        }
    };

    return (
        <div
            className={cn(
                "flex items-start gap-3 p-4",
                "border-l-4 rounded-lg shadow-md",
                "min-w-[320px] max-w-[480px]",
                "animate-fadeIn",
                getStyles()
            )}
        >
            {getIcon()}
            <p className="flex-1 text-sm font-medium leading-relaxed text-text-primary">{message}</p>
            <button
                onClick={() => onRemove(id)}
                className={cn("flex-shrink-0 p-0.5 rounded", "text-text-tertiary hover:text-text-primary", "transition-colors")}
                aria-label={t("common.close")}
            >
                <X size={16} />
            </button>
        </div>
    );
};

export default Toast;
