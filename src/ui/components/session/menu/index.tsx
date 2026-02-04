import { Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from '../../../contexts/language';

interface SessionMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
  position?: { top: number; left: number };
}

const SessionMenu = (props: SessionMenuProps) => {
  const { isOpen = false, onClose = () => {}, onRename = () => {}, onDelete = () => {}, position } = props;

  const {t} = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleRename = () => {
    onRename();
    onClose();
  };

  const handleDelete = () => {
    onDelete();
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="absolute top-full right-0 mt-1 z-50 bg-bg-primary border border-border-default rounded-md shadow-md min-w-[120px] overflow-hidden"
      style={position ? { top: position.top, left: position.left } : undefined}
    >
      {/* 이름 변경 */}
      <button
        onClick={handleRename}
        className="w-full flex items-center gap-2 py-2 px-3 text-sm text-text-primary hover:bg-bg-tertiary transition-colors"
      >
        <Pencil size={14} />
        <span>{t("session.rename")}</span>
      </button>

      {/* 삭제 */}
      <button
        onClick={handleDelete}
        className="w-full flex items-center gap-2 py-2 px-3 text-sm text-error hover:bg-[rgba(239,68,68,0.1)] transition-colors"
      >
        <Trash2 size={14} />
        <span>{t("session.delete")}</span>
      </button>
    </div>
  );
};

export default SessionMenu;
