import { useTranslation } from 'react-i18next';
import { useServerHealth } from '@/state/health';
import { Wifi, WifiOff, AlertTriangle, Clock } from '@/components/icons';

/**
 * Small badge that shows the current server status.
 * Shown at the top of most pages.
 *
 * Historically this badge also displayed a route count pulled from
 * `/health` (e.g. "En línea · 6 rutas"). That number is the **total**
 * routes the server knows about — not the routes the user can
 * actually act on in their area, which is what the Home / Explore
 * lists show (filtered by GPS proximity). Displaying two unrelated
 * counts in close proximity confused users ("it says 6 but I only
 * see 2"). The badge is now purely a status indicator; the route
 * count is no longer surfaced here. If you need the total, query
 * `get_server_health` from the WebMCP surface.
 */
export function ServerStatusBadge() {
  const { t } = useTranslation();
  const health = useServerHealth();
  const { status } = health;

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
        aria-label={t('server.onlineAria')}
      >
        <Wifi size={14} />
        <span>{t('server.online')}</span>
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