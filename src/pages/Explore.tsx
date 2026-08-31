import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/api/client';
import type { Route } from '@/api/types';
import { LeafletMap } from '@/components/LeafletMap';
import { geoWatcher } from '@/geo/watcher';

export default function ExplorePage() {
  const { t } = useTranslation();
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [center, setCenter] = useState<{ lat: number; lng: number } | undefined>(undefined);
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    apiFetch<{ routes: Route[] }>('/routes/nearby?lat=40.42&lng=-3.69')
      .then((res) => setRoutes(res.routes))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let mounted = true;
    void geoWatcher.checkPermission().then((p) => {
      if (p === 'granted') {
        geoWatcher.start();
        const off = geoWatcher.on((s) => {
          if (!mounted) return;
          setUserPos({ lat: s.lat, lng: s.lng });
          setCenter({ lat: s.lat, lng: s.lng });
        });
        return () => off();
      }
    });
    return () => {
      mounted = false;
      geoWatcher.stop();
    };
  }, []);

  return (
    <div className="map-container">
      <LeafletMap
        routes={routes}
        showStops
        centerOn={center}
        userPosition={userPos}
        followUser
      />
      {loading && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            right: 12,
            background: 'var(--overlay-strong)',
            borderRadius: 'var(--r-md)',
            padding: '12px 14px',
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div className="skeleton" style={{ width: 16, height: 16, borderRadius: '50%' }} />
          <span className="text-sm">{t('common.loading')}</span>
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          bottom: 'calc(var(--bottom-nav-h) + var(--safe-bottom) + 12px)',
          left: 12,
          right: 12,
          background: 'var(--overlay-strong)',
          borderRadius: 'var(--r-md)',
          padding: '10px 14px',
          zIndex: 50,
          textAlign: 'center',
          fontSize: 'var(--fs-sm)',
          color: 'var(--text-muted)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        {routes.length} {t('routes.list').toLowerCase()}
      </div>
    </div>
  );
}