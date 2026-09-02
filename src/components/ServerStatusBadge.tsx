import { useTranslation } from 'react-i18next';
import { useServerHealth } from '@/state/health';
import { Wifi, WifiOff, AlertTriangle, Clock } from '@/components/icons';

/**
 * Small badge that shows the current server status.
 * Shown at the top of most pages.
 */
export function ServerStatusBadge() {
  const { t } = useTranslation();
  const health = useServerHealth();
  const { status, routes } = health;

  if (status === 'normal') {
    return (
      <div
        className="banner banner-success"
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          padding: '6px 10px',
          fontSize: 'var(--fs-xs)',
          borderRadius: 'var(--r-pill)',
          width: 'fit-content',
        }}
        aria-label={t('server.onlineAria', { n: routes })}
      >
        <Wifi size={14} />
        <span>{t('server.online', { n: routes })}</span>
      </div>
    );
  }

  if (status === 'saturated') {
    return (
      <div
        className="banner banner-warning"
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          padding: '6px 10px',
          fontSize: 'var(--fs-xs)',
          borderRadius: 'var(--r-pill)',
          width: 'fit-content',
        }}
      >
        <Clock size={14} />
        <span>{t('server.saturated')}</span>
      </div>
    );
  }

  if (status === 'stopped') {
    return (
      <div
        className="banner banner-warning"
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          padding: '6px 10px',
          fontSize: 'var(--fs-xs)',
          borderRadius: 'var(--r-pill)',
          width: 'fit-content',
        }}
      >
        <AlertTriangle size={14} />
        <span>{t('server.stopped')}</span>
      </div>
    );
  }

  // offline
  return (
    <div
      className="banner banner-danger"
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        padding: '6px 10px',
        fontSize: 'var(--fs-xs)',
        borderRadius: 'var(--r-pill)',
        width: 'fit-content',
      }}
    >
      <WifiOff size={14} />
      <span>{t('server.offline')}</span>
    </div>
  );
}