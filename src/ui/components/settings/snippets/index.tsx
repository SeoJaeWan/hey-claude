import {useState} from "react";
import {Plus, Pencil, Trash2} from "lucide-react";
import {cn} from "../../../utils/cn";
import {useSnippetsQuery, useCreateSnippet, useUpdateSnippet, useDeleteSnippet, Snippet} from "../../../hooks/apis/queries/snippet";
import SnippetEditDialog from "../snippetEditDialog";
import {useTranslation} from "../../../contexts/language";

const SnippetsSettings = () => {
    const {t} = useTranslation();
    const {data: snippets = [], isLoading} = useSnippetsQuery();
    const createSnippet = useCreateSnippet();
    const updateSnippet = useUpdateSnippet();
    const deleteSnippet = useDeleteSnippet();

    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingSnippet, setEditingSnippet] = useState<Snippet | undefined>(undefined);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const handleAddClick = () => {
        setEditingSnippet(undefined);
        setIsDialogOpen(true);
    };

    const handleEditClick = (snippet: Snippet) => {
        setEditingSnippet(snippet);
        setIsDialogOpen(true);
    };

    const handleSave = (data: Omit<Snippet, "id">) => {
        if (editingSnippet) {
            updateSnippet.mutate({
                id: editingSnippet.id,
                ...data,
            });
        } else {
            createSnippet.mutate({
                ...data,
            });
        }
        setIsDialogOpen(false);
        setEditingSnippet(undefined);
    };

    const handleCancel = () => {
        setIsDialogOpen(false);
        setEditingSnippet(undefined);
    };

    const handleDelete = (id: string) => {
        if (deletingId === id) {
            deleteSnippet.mutate(id);
            setDeletingId(null);
        } else {
            setDeletingId(id);
            setTimeout(() => setDeletingId(null), 3000);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <p className="text-sm text-text-secondary">{t("common.loading")}</p>
            </div>
        );
    }

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-base font-semibold text-text-primary mb-1">{t("settings.snippets.title")}</h2>
                </div>
                <button
                    onClick={handleAddClick}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-text-inverse bg-accent-primary rounded-md hover:bg-accent-hover transition-colors"
                >
                    <Plus size={16} />
                    {t("settings.snippets.addSnippet")}
                </button>
            </div>

            {/* Snippets List */}
            <div className="space-y-3 mb-6">
                {snippets.map((snippet) => (
                    <div
                        key={snippet.id}
                        className="bg-bg-secondary border border-border-default rounded-lg p-4 hover:border-border-strong transition-colors"
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-3 mb-2">
                                    <code className="text-sm font-mono font-medium text-text-primary bg-bg-tertiary px-2 py-1 rounded">
                                        {snippet.trigger}
                                    </code>
                                    <span className="text-sm text-text-primary">{snippet.name}</span>
                                </div>
                                <div className="text-xs text-text-secondary font-mono bg-bg-primary border border-border-default rounded px-2 py-1 truncate">
                                    {snippet.value.length > 100 ? `${snippet.value.slice(0, 100)}...` : snippet.value}
                                </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                                <button
                                    onClick={() => handleEditClick(snippet)}
                                    className="p-2 text-text-secondary hover:bg-bg-tertiary hover:text-text-primary rounded-md transition-colors"
                                    title={t("common.edit")}
                                >
                                    <Pencil size={16} />
                                </button>
                                <button
                                    onClick={() => handleDelete(snippet.id)}
                                    className={cn(
                                        "p-2 rounded-md transition-colors",
                                        deletingId === snippet.id
                                            ? "bg-error text-white"
                                            : "text-text-secondary hover:bg-error/10 hover:text-error"
                                    )}
                                    title={deletingId === snippet.id ? t("common.clickToDelete") : t("common.delete")}
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    </div>
                ))}

                {snippets.length === 0 && (
                    <div className="text-center py-12 text-text-secondary">
                        <p className="text-sm">{t("settings.snippets.noSnippets")}</p>
                        <button onClick={handleAddClick} className="mt-2 text-sm text-accent-primary hover:underline">
                            {t("settings.snippets.addSnippet")}
                        </button>
                    </div>
                )}
            </div>

            {/* Edit Dialog */}
            <SnippetEditDialog
                isOpen={isDialogOpen}
                snippet={editingSnippet}
                existingTriggers={snippets.filter((s) => s.id !== editingSnippet?.id).map((s) => s.trigger)}
                onSave={handleSave}
                onCancel={handleCancel}
            />
        </div>
    );
};

export default SnippetsSettings;
