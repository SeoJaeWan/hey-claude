import SessionCard from '../card';
import { useTranslation } from '../../../contexts/language';

interface Session {
  id: string;
  name: string;
  type: 'claude-code' | 'quick-chat';
  source: 'terminal' | 'web';
  updatedAt: string;
}

interface SessionListProps {
  sessions: Session[];
  activeSessionId?: string;
  onSessionClick?: (sessionId: string) => void;
  onSessionRename?: (sessionId: string, currentName: string) => void;
  onSessionDelete?: (sessionId: string) => void;
}

const SessionList = ({
  sessions,
  activeSessionId = '',
  onSessionClick = () => {},
  onSessionRename = () => {},
  onSessionDelete = () => {},
}: SessionListProps) => {
  const {t} = useTranslation();
  const claudeCodeSessions = sessions.filter((s) => s.type === 'claude-code');
  const quickChatSessions = sessions.filter((s) => s.type === 'quick-chat');

  return (
    <div className="flex flex-col gap-6">
      {/* Claude Code Sessions */}
      {claudeCodeSessions.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2 px-2">
            {t("sidebar.claudeCodeSessions")}
          </h3>
          <div className="flex flex-col gap-1">
            {claudeCodeSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                isActive={activeSessionId === session.id}
                onClick={() => onSessionClick(session.id)}
                onRename={onSessionRename}
                onDelete={onSessionDelete}
              />
            ))}
          </div>
        </div>
      )}

      {/* Quick Chat Sessions */}
      {quickChatSessions.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-2 px-2">
            {t("sidebar.quickChatSessions")}
          </h3>
          <div className="flex flex-col gap-1">
            {quickChatSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                isActive={activeSessionId === session.id}
                onClick={() => onSessionClick(session.id)}
                onRename={onSessionRename}
                onDelete={onSessionDelete}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SessionList;
