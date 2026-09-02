import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Bus, Map as MapIcon, Plus, Check, AlertTriangle, ChevronRight, Navigation } from '@/components/icons';
import { apiFetch } from '@/api/client';
import type { Route, GPSSample } from '@/api/types';
import { geoWatcher } from '@/geo/watcher';
import { matchRoutesByProximity, type RouteMatch } from '@/geo/matchRoutes';
import { useTripStore } from '@/state/trip';

type Phase = 'idle' | 'locating' | 'searching' | 'suggestions' | 'starting' | 'error';

export default function BoardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState<GPSSample | null>(null);
  const [matches, setMatches] = useState<RouteMatch[]>([]);
  const [selected, setSelected] = useState<Route | null>(null);

  const beginBoarding = async () => {
    setError(null);
    setPhase('locating');
    setPos(null);
    setMatches([]);
    setSelected(null);

    // 1. Permission
    let perm = await geoWatcher.checkPermission();
    if (perm !== 'granted') perm = await geoWatcher.requestPermission();
    if (perm !== 'granted') {
      setError(
        perm === 'denied'
          ? t('board.permissionDenied')
          : t('board.gpsNeeded'),
      );
      setPhase('error');
      return;
    }

    // 2. Get a fix
    const sample = await new Promise<GPSSample>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (p) =>
          resolve({
            ts: p.timestamp,
            lat: p.coords.latitude,
            lng: p.coords.longitude,
            acc: p.coords.accuracy,
            speed: p.coords.speed ?? undefined,
          }),
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
      );
    });
    setPos(sample);

    // 3. Fetch all routes and rank by proximity
    setPhase('searching');
    try {
      const res = await apiFetch<{ routes: Route[] }>('/routes');
      const m = matchRoutesByProximity(
        { lat: sample.lat, lng: sample.lng },
        res.routes,
        { topN: 5, maxRadiusM: 3000 },
      );
      setMatches(m);
      setPhase('suggestions');
    } catch (e) {
      setError(t('board.errorStarting', { err: String(e) }));
      setPhase('error');
    }
  };

  // Auto-start boarding on mount if no permission prompts were triggered yet
  useEffect(() => {
    if (phase !== 'idle') return;
    void beginBoarding();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onConfirm = async (route: Route) => {
    setSelected(route);
    setPhase('starting');
    try {
      // Reuse the trip store to start the trip — it knows how to POST /trips/start
      await useTripStore.getState().startTrip(route);
      navigate('/trip');
    } catch (e) {
      setError(t('board.errorStarting', { err: String(e) }));
      setPhase('error');
    }
  };

  const onRecordNew = () => {
    navigate('/record');
  };

  if (phase === 'error') {
    return (
      <div className="page">
        <header className="page-header">
          <h1>{t('board.header')}</h1>
        </header>
        <div className="empty">
          <div className="empty-illustration" style={{ background: 'var(--danger)', color: 'white' }}>
            <AlertTriangle size={40} />
          </div>
          <h3>{t('board.errorTitle')}</h3>
          <p>{error}</p>
          <button type="button" className="btn btn-primary btn-lg" onClick={beginBoarding}>
            {t('common.retry')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>{t('board.header')}</h1>
      </header>

      {(phase === 'idle' || phase === 'locating') && (
        <div className="empty">
          <div className="empty-illustration">
            <Navigation size={40} />
          </div>
          <h3>{t('board.locatingTitle')}</h3>
          <p className="text-sm text-muted">{t('board.locatingHint')}</p>
        </div>
      )}

      {phase === 'searching' && (
        <div className="empty">
          <div className="empty-illustration">
            <MapIcon size={40} />
          </div>
          <h3>{t('board.searchingTitle')}</h3>
          <div className="skeleton" style={{ height: 60, marginTop: 16 }} />
          <div className="skeleton" style={{ height: 60, marginTop: 12 }} />
        </div>
      )}

      {phase === 'suggestions' && (
        <>
          <div className="card mb-3" style={{ background: 'var(--brand-50)' }}>
            <div className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
              {t('board.nearbyLabel')}
            </div>
            <div className="text-sm" style={{ fontFamily: 'var(--font-mono)', marginTop: 4 }}>
              {pos?.lat.toFixed(5)}, {pos?.lng.toFixed(5)}
            </div>
          </div>

          {matches.length === 0 ? (
            <div className="card mb-3">
              <div className="card-header">
                <div className="card-title">{t('board.noMatchTitle')}</div>
              </div>
              <p className="text-sm text-muted mb-3">{t('board.noMatchHint')}</p>
              <button type="button" className="btn btn-primary btn-block" onClick={onRecordNew}>
                <Plus size={18} /> {t('board.recordThisRoute')}
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted mb-3">{t('board.suggestionPrompt')}</p>

              <div className="list">
                {matches.map((m) => (
                  <button
                    key={m.route.id}
                    type="button"
                    className="list-item"
                    style={{ textAlign: 'left', width: '100%' }}
                    onClick={() => void onConfirm(m.route)}
                  >
                    <div className="list-item-icon">
                      <Bus size={20} />
                    </div>
                    <div className="list-item-body">
                      <div className="list-item-title">{m.route.name}</div>
                      <div className="list-item-sub">
                        {m.distanceM < 1000
                          ? t('board.distMeters', { n: Math.round(m.distanceM) })
                          : t('board.distKm', { km: (m.distanceM / 1000).toFixed(1) })}{' '}
                        · {t('board.stops', { n: m.route.stops.length })}
                      </div>
                    </div>
                    <ChevronRight size={20} className="text-muted" />
                  </button>
                ))}
              </div>

              <div className="mt-3">
                <button type="button" className="btn btn-block" onClick={onRecordNew}>
                  <Plus size={18} /> {t('board.noMatchNew')}
                </button>
              </div>
            </>
          )}

          <div className="mt-3">
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-block"
              onClick={beginBoarding}
            >
              {t('board.searchAgain')}
            </button>
          </div>
        </>
      )}

      {phase === 'starting' && selected && (
        <div className="empty">
          <div className="empty-illustration" style={{ background: 'var(--brand-600)', color: 'white' }}>
            <Check size={40} />
          </div>
          <h3>{t('board.startingTitle', { name: selected.name })}</h3>
          <p className="text-sm text-muted">{t('board.startingHint')}</p>
        </div>
      )}
    </div>
  );
}