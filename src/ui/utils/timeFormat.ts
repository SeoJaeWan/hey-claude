type TranslationFunction = (key: string, params?: Record<string, string | number>) => string;

export const formatRelativeTime = (dateString: string, t: TranslationFunction): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return t('time.justNow');
  if (diffMins < 60) return t('time.minutesAgo', { count: diffMins });
  if (diffHours < 24) return t('time.hoursAgo', { count: diffHours });
  if (diffDays === 1) return t('time.yesterday');
  if (diffDays < 7) return t('time.daysAgo', { count: diffDays });
  if (diffDays < 30) return t('time.weeksAgo', { count: Math.floor(diffDays / 7) });
  if (diffDays < 365) return t('time.monthsAgo', { count: Math.floor(diffDays / 30) });
  return t('time.yearsAgo', { count: Math.floor(diffDays / 365) });
};
