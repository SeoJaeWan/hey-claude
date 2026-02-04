import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose?: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const Modal = ({
  isOpen,
  onClose = () => {},
  title = '',
  children,
  size = 'md',
}: ModalProps) => {
  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className={`relative bg-bg-primary border border-border-default rounded-lg shadow-xl ${sizeClasses[size]} w-full mx-4 max-h-[90vh] flex flex-col`}
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between p-6 border-b border-border-default">
            <h2 className="text-xl font-semibold text-text-primary">{title}</h2>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-all"
            >
              <X size={20} />
            </button>
          </div>
        )}

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1">
          {children}
        </div>
      </div>
    </div>
  );
};

export default Modal;
