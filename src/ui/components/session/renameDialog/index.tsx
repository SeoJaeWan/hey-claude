import { useState, useEffect } from 'react';
import { useTranslation } from '../../../contexts/language';

interface RenameDialogProps {
  isOpen: boolean;
  sessionName: string;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}

const RenameDialog = (props: RenameDialogProps) => {
  const { isOpen = false, sessionName = '', onConfirm = () => {}, onCancel = () => {} } = props;

  const {t} = useTranslation();
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    if (isOpen) {
      setInputValue(sessionName);
    }
  }, [isOpen, sessionName]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    const trimmed = inputValue.trim();
    if (trimmed) {
      onConfirm(trimmed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleConfirm();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} aria-hidden="true" />

      {/* Dialog */}
      <div className="relative z-10 bg-bg-primary border border-border-default rounded-lg shadow-xl max-w-xs w-full mx-4 p-6 animate-fadeIn">
        {/* Title */}
        <h3 className="text-lg font-semibold text-text-primary mb-4">{t("session.renameDialogTitle")}</h3>

        {/* Input */}
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full px-3 py-2 bg-bg-input border border-border-default rounded-md text-sm text-text-primary focus:outline-none focus:border-border-focus transition-colors mb-4"
          autoFocus
          placeholder={t("session.renamePlaceholder")}
        />

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
            onClick={handleConfirm}
            disabled={!inputValue.trim()}
            className="px-4 py-2 rounded-md text-sm font-medium bg-accent-primary text-text-inverse hover:bg-accent-hover transition-colors disabled:bg-bg-tertiary disabled:text-text-tertiary disabled:cursor-not-allowed"
          >
            {t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RenameDialog;
