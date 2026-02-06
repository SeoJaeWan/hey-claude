import SessionCard from '../card';
import { useTranslation } from '../../../contexts/language';
import type {Session} from '../../../types';

interface SessionListProps {
  sessions: Session[];
  activeSessionId?: string;
  onSessionClick?: (sessionId: string) => void;
  onSessionRename?: (sessionId: string, currentName: string) => void;
  onSessionDelete?: (sessionId: string) => void;
  onOpenInNewTab?: (sessionId: string) => void;
}

const SessionList = ({
  sessions,
  activeSessionId = '',
  onSessionClick = () => {},
  onSessionRename = () => {},
  onSessionDelete = () => {},
  onOpenInNewTab = () => {},
}: SessionListProps) => {
  const {t} = useTranslation();

  // Group sessions by running state based on streamStatus
  const activeSessions = sessions.filter(
    (s) => s.streamStatus === "streaming" || s.streamStatus === "background_tasks"
  );
  const idleSessions = sessions.filter((s) => !s.streamStatus || s.streamStatus === "idle");

  return (
    <div className="flex flex-col gap-6">
      {/* Running Sessions */}
      {activeSessions.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2 px-2">
            {t("sidebar.runningSessions", {count: activeSessions.length})}
          </h3>
          <div className="flex flex-col gap-1">
            {activeSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                isActive={activeSessionId === session.id}
                onClick={() => onSessionClick(session.id)}
                onRename={onSessionRename}
                onDelete={onSessionDelete}
                onOpenInNewTab={() => onOpenInNewTab(session.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Recent Sessions */}
      {idleSessions.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2 px-2">
            {t("sidebar.recentSessions", {count: idleSessions.length})}
          </h3>
          <div className="flex flex-col gap-1">
            {idleSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                isActive={activeSessionId === session.id}
                onClick={() => onSessionClick(session.id)}
                onRename={onSessionRename}
                onDelete={onSessionDelete}
                onOpenInNewTab={() => onOpenInNewTab(session.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SessionList;
