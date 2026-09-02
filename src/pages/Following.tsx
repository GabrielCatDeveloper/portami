import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTripShareStore } from '@/state/tripShare';
import { LeafletMap } from '@/components/LeafletMap';
import { ArrowLeft, Bus, Clock, Share, Navigation, X } from '@/components/icons';
import { useNavigate } from 'react-router-dom';
import type { SharedTrip } from '@/state/tripShare';

export default function FollowingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const sharedTrips = useTripShareStore((s) => s.sharedTrips);
  const setSharedTrip = useTripShareStore((s) => s.setSharedTrip);
  const hydrate = useTripShareStore((s) => s.hydrate);
  const trips = Object.values(sharedTrips);
  const activeTrips = trips.filter((t) => !t.endedAt);
  const endedTrips = trips.filter((t) => !!t.endedAt).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  const [selected, setSelected] = useState<SharedTrip | null>(null);

  // Hydrate the in-memory cache from IndexedDB on mount, so a page
  // refresh or cold boot doesn't lose the active shares.
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Auto-select: keep `selected` pointing at the first active trip
  // unless the user has explicitly chosen one. We depend only on
  // the active-trips key list (anonIds + endedAt) so this only
  // re-runs when the *set* of trips actually changes — not when a
  // single trip updates its lastLocation every minute.
  const activeKeys = activeTrips.map((t) => t.fromAnonId).join(',');
  useEffect(() => {
    if (!selected || !activeTrips.find((t) => t.fromAnonId === selected.fromAnonId)) {
      setSelected(activeTrips[0] ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKeys]);

  if (activeTrips.length === 0 && endedTrips.length === 0) {
    return (
      <div className="page">
        <header className="page-header">
          <button type="button" className="btn-icon btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
            <ArrowLeft />
          </button>
          <h1 style={{ flex: 1 }}>{t('following.title')}</h1>
        </header>
        <div className="empty">
          <div className="empty-illustration">
            <Share size={40} />
          </div>
          <h3>{t('following.emptyTitle')}</h3>
          <p className="text-sm text-muted">{t('following.emptyText')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="btn-icon btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <ArrowLeft />
        </button>
        <h1 style={{ flex: 1 }}>{t('following.title')}</h1>
        {activeTrips.length > 0 && (
          <span
            className="chip active"
            aria-label={t('following.active', { n: activeTrips.length, count: activeTrips.length })}
          >
            {activeTrips.length}
          </span>
        )}
      </header>

      {activeTrips.length > 1 && (
        <div className="row gap-2 mb-3" style={{ flexWrap: 'wrap' }}>
          {activeTrips.map((t) => (
            <button
              key={t.fromAnonId}
              type="button"
              className={`chip ${selected?.fromAnonId === t.fromAnonId ? 'active' : ''}`}
              onClick={() => setSelected(t)}
            >
              <Bus size={14} /> {t.fromAlias ?? `#${t.fromAnonId.slice(0, 6)}`}
            </button>
          ))}
        </div>
      )}

      {selected && selected.lastLocation && (
        <section className="card mb-3" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ height: 220, position: 'relative' }}>
            <LeafletMap
              userPosition={{ lat: selected.lastLocation.lat, lng: selected.lastLocation.lng }}
            />
          </div>
          <div style={{ padding: 12 }}>
            <div className="row gap-2" style={{ alignItems: 'center' }}>
              <Navigation size={20} style={{ color: 'var(--brand-600)' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>
                  {selected.fromAlias ?? `#${selected.fromAnonId.slice(0, 6)}`}
                  {' · '}
                  {selected.routeName ?? t('following.noRoute')}
                </div>
                <div className="text-xs text-muted">
                  {t('following.lastUpdate', { time: timeAgo(selected.lastLocation.ts, t) })}
                </div>
              </div>
            </div>
            {selected.nextStopName && selected.etaNextStopS != null && (
              <div className="row gap-2 mt-2" style={{ alignItems: 'center' }}>
                <Clock size={16} className="text-muted" />
                <div className="text-sm">
                  {t('following.endsIn', {
                    stop: selected.nextStopName,
                    min: Math.round(selected.etaNextStopS / 60),
                  })}
                </div>
              </div>
            )}
            {selected.plannedRoute && (
              <div className="mt-2">
                <div className="text-xs text-muted">{t('following.plannedRoute')}</div>
                <ol style={{ listStyle: 'none', padding: 0, margin: '4px 0 0', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--fs-sm)' }}>
                  {selected.plannedRoute.steps.map((s, i) => (
                    <li key={i}>
                      {i + 1}. {s.label}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </section>
      )}

      {endedTrips.length > 0 && (
        <>
          <h3 className="mb-2 text-muted text-sm">{t('following.endedTitle')}</h3>
          <div className="list">
            {endedTrips.map((trip) => (
              <div key={trip.fromAnonId} className="list-item">
                <div className="list-item-icon">
                  <Bus size={20} />
                </div>
                <div className="list-item-body">
                  <div className="list-item-title">
                    {trip.fromAlias ?? `#${trip.fromAnonId.slice(0, 6)}`} · {trip.routeName ?? t('following.noRoute')}
                  </div>
                  <div className="list-item-sub">
                    {t('following.endedTimeAgo', {
                      time: trip.endedAt ? timeAgo(trip.endedAt, t) : '?',
                      reason: trip.endReason,
                    })}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSharedTrip(trip.fromAnonId, null)}
                  aria-label={t('following.remove')}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function timeAgo(ts: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return t('following.timeAgo.sec', { n: sec });
  if (sec < 3600) return t('following.timeAgo.min', { n: Math.floor(sec / 60) });
  if (sec < 86400) return t('following.timeAgo.hour', { n: Math.floor(sec / 3600) });
  return t('following.timeAgo.day', { n: Math.floor(sec / 86400) });
}