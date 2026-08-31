import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/api/client';
import type { Route } from '@/api/types';
import { useIdentityStore } from '@/state/identity';
import { useTripStore } from '@/state/trip';
import { ChevronRight, Map, Record as RecordIcon, AlertTriangle, Navigation, Plus, Bus, Route as RouteIcon } from '@/components/icons';
import { formatDistance, polylineLength } from '@/geo/distance';
import { ServerStatusBadge } from '@/components/ServerStatusBadge';

export default function HomePage() {
  const { t } = useTranslation();
  const anonId = useIdentityStore((s) => s.anonId);
  const activeTrip = useTripStore((s) => s.activeTrip);
  const route = useTripStore((s) => s.route);
  const [nearby, setNearby] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Default to Madrid center if we don't have GPS yet
    apiFetch<{ routes: Route[] }>('/routes/nearby?lat=40.42&lng=-3.69')
      .then((res) => {
        if (!cancelled) setNearby(res.routes);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page">
      <header className="page-header">
        <div style={{ flex: 1 }}>
          <div className="text-sm text-muted">{t('home.greeting')}</div>
          <h1>
            #{anonId}
          </h1>
        </div>
        <Link to="/settings" className="btn-icon btn btn-ghost" aria-label={t('home.openSettings')}>
          ⚙
        </Link>
      </header>

      <p className="text-muted mb-4">{t('app.tagline')}</p>

      <div className="mb-3">
        <ServerStatusBadge />
      </div>

      {/* Active trip callout */}
      <section className="card mb-4" style={{ background: activeTrip ? 'var(--brand-50)' : 'transparent' }}>
        <div className="card-header">
          <div className="list-item-icon" style={{ background: activeTrip ? 'var(--brand-600)' : 'var(--bg-subtle)', color: activeTrip ? 'white' : 'var(--text-muted)' }}>
            {activeTrip ? <Navigation size={20} /> : <Plus size={20} />}
          </div>
          <div style={{ flex: 1 }}>
            <div className="card-title">{activeTrip ? t('trip.onBoard') : t('home.noActiveTrip')}</div>
            {activeTrip && route && (
              <div className="card-subtitle">{route.name}</div>
            )}
          </div>
          {activeTrip && (
            <Link to="/trip" className="btn btn-sm btn-primary">
              {t('common.next')}
            </Link>
          )}
        </div>
      </section>

        {/* Quick actions */}
      <section className="mb-4">
        {/* Primary CTA: "I'm on a bus/train" — opens Board flow */}
        <Link
          to="/board"
          className="btn btn-primary btn-lg btn-block mb-3"
          style={{
            background: 'linear-gradient(135deg, var(--brand-600), var(--brand-700))',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <Bus size={22} /> He subido a un bus/tren
        </Link>

        {/* Secondary CTA: Plan a trip A → B */}
        <Link
          to="/journey"
          className="btn btn-block mb-3"
        >
          <RouteIcon size={20} /> Planear un viaje (origen → destino)
        </Link>

        <h3 className="mb-3 text-muted text-sm">{t('home.quickActions')}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          <Link to="/record" className="card card-interactive text-center" style={{ padding: 16 }}>
            <div className="list-item-icon" style={{ margin: '0 auto 8px', background: 'var(--accent-500)', color: 'white' }}>
              <RecordIcon size={20} />
            </div>
            <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{t('home.recordRoute')}</div>
          </Link>
          <Link to="/explore" className="card card-interactive text-center" style={{ padding: 16 }}>
            <div className="list-item-icon" style={{ margin: '0 auto 8px' }}>
              <Map size={20} />
            </div>
            <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{t('home.exploreMap')}</div>
          </Link>
        </div>
      </section>

      {/* Nearby routes */}
      <section>
        <div className="row mb-3">
          <h3 className="flex-1">{t('home.nearby')}</h3>
          <Link to="/explore" className="text-sm" style={{ color: 'var(--brand-700)' }}>
            {t('home.seeAll')} →
          </Link>
        </div>
        {loading ? (
          <div className="list">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="card">
                <div className="skeleton" style={{ height: 20, width: '60%', marginBottom: 8 }} />
                <div className="skeleton" style={{ height: 14, width: '40%' }} />
              </div>
            ))}
          </div>
        ) : nearby.length === 0 ? (
          <div className="empty">
            <div className="empty-illustration">
              <AlertTriangle size={40} />
            </div>
            <h3>{t('home.noNearby')}</h3>
            <Link to="/explore" className="btn btn-primary">
              {t('home.exploreMap')}
            </Link>
          </div>
        ) : (
          <div className="list">
            {nearby.slice(0, 4).map((r) => (
              <Link key={r.id} to={`/routes/${r.id}`} className="card card-interactive list-item" style={{ textDecoration: 'none' }}>
                <div className="list-item-icon" style={{ background: r.vehicleKind === 'train' ? 'var(--info)' : 'var(--brand-600)', color: 'white' }}>
                  {r.vehicleKind === 'train' ? '🚆' : '🚌'}
                </div>
                <div className="list-item-body">
                  <div className="list-item-title">{r.name}</div>
                  <div className="list-item-sub">
                    {t('routes.stops', { n: r.stops.length })} · {formatDistance(polylineLength(r.polyline))}
                  </div>
                </div>
                <ChevronRight size={20} className="text-muted" />
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}