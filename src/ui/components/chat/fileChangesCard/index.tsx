import { FolderOpen } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { FileChange } from '@/types';
import { useTranslation } from '@/contexts/language';

interface FileChangesCardProps {
  changes: FileChange[];
  title?: string;
}

const FileChangesCard = (props: FileChangesCardProps) => {
  const { t } = useTranslation();
  const { changes, title } = props;
  const displayTitle = title || t('common.changedFiles');

  if (!changes || changes.length === 0) {
    return null;
  }

  const getChangePrefix = (type: FileChange['type']) => {
    switch (type) {
      case 'added':
        return '+';
      case 'modified':
        return 'M';
      case 'deleted':
        return '-';
    }
  };

  const getChangeColor = (type: FileChange['type']) => {
    switch (type) {
      case 'added':
        return 'text-success';
      case 'modified':
        return 'text-warning';
      case 'deleted':
        return 'text-error';
    }
  };

  return (
    <div className="bg-bg-secondary border border-border-default rounded-lg p-4 mt-3">
      <div className="flex items-center gap-2 mb-3">
        <FolderOpen size={16} className="text-text-secondary" />
        <h3 className="text-sm font-semibold text-text-primary">
          {displayTitle} ({changes.length})
        </h3>
      </div>

      <div className="space-y-1">
        {changes.map((change, index) => (
          <div
            key={`${change.path}-${index}`}
            className={cn(
              'font-mono text-sm py-1',
              getChangeColor(change.type)
            )}
          >
            <span className="inline-block w-4">{getChangePrefix(change.type)}</span>
            <span>{change.path}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FileChangesCard;
