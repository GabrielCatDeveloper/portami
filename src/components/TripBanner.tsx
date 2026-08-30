import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useTripStore } from '@/state/trip';
import { useIdentityStore } from '@/state/identity';
import { haversine, nearestStop, formatDistance } from '@/geo/distance';

type Props = { onEndClick: () => void };

export function TripBanner({ onEndClick }: Props) {
  const { t, i18n } = useTranslation();
  const activeTrip = useTripStore((s) => s.activeTrip);
  const lastSample = useTripStore((s) => s.lastSample);
  const route = useTripStore((s) => s.route);
  const endTrip = useTripStore((s) => s.endTrip);
  const anonId = useIdentityStore((s) => s.anonId);

  // Compute next stop + ETA
  const next = (() => {
    if (!route || !lastSample || !route.stops.length) return null;
    const ns = nearestStop({ lat: lastSample.lat, lng: lastSample.lng }, route.stops);
    if (!ns) return null;
    const etaMs = (ns.distance / Math.max(2, lastSample.speed ?? 6)) * 1000;
    return { stop: route.stops.find((s) => s.id === ns.stop.id)!, distance: ns.distance, etaMs };
  })();

  if (!activeTrip) return null;

  const mins = Math.max(0, Math.round(((next?.etaMs ?? 0) / 60_000) * 10) / 10);

  return (
    <div className="trip-banner" role="status" aria-live="polite">
      <span className="trip-banner-pulse" aria-hidden />
      <div className="trip-banner-info">
        <div className="trip-banner-route">
          {t('trip.onBoard')} · {route?.name ?? '…'}
        </div>
        <div className="trip-banner-eta">
          {next
            ? t('trip.eta', {
                stop: next.stop.name,
                minutes: mins.toFixed(mins < 1 ? 1 : 0),
              })
            : t('trip.liveSharing')}
          {' · '}#{anonId}
        </div>
      </div>
      <button
        type="button"
        className="btn btn-sm"
        onClick={(e) => {
          e.stopPropagation();
          if (confirm(t('trip.endConfirm'))) void endTrip('manual');
        }}
        style={{ background: 'white', color: 'var(--brand-800)' }}
      >
        {t('trip.endNow')}
      </button>
      <button type="button" className="btn btn-icon btn-ghost" onClick={onEndClick} aria-label={t('common.next')} style={{ color: 'white' }}>
        ›
      </button>
    </div>
  );
}