import { useTranslation } from '../../../contexts/language';

interface DeleteConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
}

const DeleteConfirmDialog = (props: DeleteConfirmDialogProps) => {
    const {
        isOpen = false,
        title = "",
        message = "",
        onConfirm = () => {},
        onCancel = () => {}
    } = props;

    const {t} = useTranslation();

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Overlay */}
            <div
                className="absolute inset-0 bg-black/50"
                onClick={onCancel}
                aria-hidden="true"
            />

            {/* Dialog */}
            <div className="relative z-10 bg-bg-primary border border-border-default rounded-lg shadow-xl max-w-xs w-full mx-4 p-6 animate-fadeIn">
                {/* Title */}
                <h3 className="text-lg font-semibold text-text-primary mb-2">
                    {title}
                </h3>

                {/* Message */}
                <p className="text-sm text-text-secondary mb-6 whitespace-pre-line">
                    {message}
                </p>

                {/* Actions */}
                <div className="flex gap-2 justify-end">
                    {/* Cancel Button */}
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 rounded-md text-sm font-medium bg-transparent text-text-secondary border border-border-default hover:bg-bg-tertiary transition-colors"
                    >
                        {t("common.cancel")}
                    </button>

                    {/* Confirm Button */}
                    <button
                        onClick={onConfirm}
                        className="px-4 py-2 rounded-md text-sm font-medium bg-error text-white hover:opacity-90 transition-opacity"
                    >
                        {t("common.delete")}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DeleteConfirmDialog;
