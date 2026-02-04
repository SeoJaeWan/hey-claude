import {useState, useEffect} from "react";
import {X} from "lucide-react";
import {cn} from "../../../utils/cn";
import {Snippet} from "../../../hooks/apis/queries/snippet";
import {useTranslation} from "../../../contexts/language";

interface SnippetEditDialogProps {
    isOpen: boolean;
    snippet?: Snippet; // 수정 시 기존 데이터, 추가 시 undefined
    existingTriggers: string[]; // 중복 체크용
    onSave: (data: Omit<Snippet, "id">) => void;
    onCancel: () => void;
}

const SnippetEditDialog = ({isOpen, snippet, existingTriggers, onSave, onCancel}: SnippetEditDialogProps) => {
    const {t} = useTranslation();
    const [trigger, setTrigger] = useState("");
    const [name, setName] = useState("");
    const [value, setValue] = useState("");
    const [errors, setErrors] = useState<{trigger?: string; name?: string; value?: string}>({});

    useEffect(() => {
        if (snippet) {
            setTrigger(snippet.trigger);
            setName(snippet.name);
            setValue(snippet.value);
        } else {
            setTrigger("@");
            setName("");
            setValue("");
        }
        setErrors({});
    }, [snippet, isOpen]);

    const validate = () => {
        const newErrors: {trigger?: string; name?: string; value?: string} = {};

        // 트리거 검증
        if (!trigger.startsWith("@")) {
            newErrors.trigger = t("settings.snippets.validation.triggerStartWith");
        } else if (trigger.includes(" ")) {
            newErrors.trigger = t("settings.snippets.validation.triggerNoSpaces");
        } else if (trigger.length < 2) {
            newErrors.trigger = t("settings.snippets.validation.triggerRequired");
        } else if (existingTriggers.includes(trigger) && trigger !== snippet?.trigger) {
            newErrors.trigger = t("settings.snippets.validation.triggerExists");
        }

        // 이름 검증
        if (!name.trim()) {
            newErrors.name = t("settings.snippets.validation.nameRequired");
        }

        // 내용 검증
        if (!value.trim()) {
            newErrors.value = t("settings.snippets.validation.contentRequired");
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSave = () => {
        if (validate()) {
            onSave({trigger: trigger.trim(), name: name.trim(), value: value.trim()});
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
            <div
                className="bg-bg-primary border border-border-default rounded-lg shadow-xl max-w-2xl w-full mx-4 p-6"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-text-primary">
                        {snippet ? t("settings.snippets.editSnippet") : t("settings.snippets.addSnippet")}
                    </h2>
                    <button onClick={onCancel} className="p-1 rounded-md text-text-secondary hover:bg-bg-tertiary hover:text-text-primary">
                        <X size={20} />
                    </button>
                </div>

                {/* Form */}
                <div className="space-y-4">
                    {/* 트리거 */}
                    <div>
                        <label className="block text-sm font-medium text-text-primary mb-2">{t("settings.snippets.trigger")}</label>
                        <input
                            type="text"
                            value={trigger}
                            onChange={(e) => setTrigger(e.target.value)}
                            placeholder={t("settings.snippets.triggerPlaceholder")}
                            className={cn(
                                "w-full px-3 py-2 bg-bg-input border rounded-md",
                                "text-base text-text-primary placeholder:text-text-tertiary",
                                "focus:outline-none focus:border-border-focus",
                                errors.trigger ? "border-error" : "border-border-default"
                            )}
                        />
                        {errors.trigger && <p className="text-xs text-error mt-1">{errors.trigger}</p>}
                    </div>

                    {/* 이름 */}
                    <div>
                        <label className="block text-sm font-medium text-text-primary mb-2">{t("settings.snippets.name")}</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder={t("settings.snippets.namePlaceholder")}
                            className={cn(
                                "w-full px-3 py-2 bg-bg-input border rounded-md",
                                "text-base text-text-primary placeholder:text-text-tertiary",
                                "focus:outline-none focus:border-border-focus",
                                errors.name ? "border-error" : "border-border-default"
                            )}
                        />
                        {errors.name && <p className="text-xs text-error mt-1">{errors.name}</p>}
                    </div>

                    {/* 내용 */}
                    <div>
                        <label className="block text-sm font-medium text-text-primary mb-2">{t("settings.snippets.content")}</label>
                        <textarea
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            placeholder={t("settings.snippets.contentPlaceholder")}
                            rows={8}
                            className={cn(
                                "w-full px-3 py-2 bg-bg-input border rounded-md",
                                "text-base text-text-primary placeholder:text-text-tertiary",
                                "focus:outline-none focus:border-border-focus resize-y",
                                errors.value ? "border-error" : "border-border-default"
                            )}
                        />
                        {errors.value && <p className="text-xs text-error mt-1">{errors.value}</p>}
                    </div>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-2 mt-6">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-sm font-medium text-text-secondary border border-border-default rounded-md hover:bg-bg-tertiary transition-colors"
                    >
                        {t("common.cancel")}
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 text-sm font-medium text-text-inverse bg-accent-primary rounded-md hover:bg-accent-hover transition-colors"
                    >
                        {t("common.save")}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SnippetEditDialog;
