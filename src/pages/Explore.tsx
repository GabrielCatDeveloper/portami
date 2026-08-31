import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/api/client';
import { fetchAllActiveBuses, type ActiveBusOnRoute } from '@/api/activeBuses';
import type { Route } from '@/api/types';
import { LeafletMap } from '@/components/LeafletMap';
import { geoWatcher } from '@/geo/watcher';

export default function ExplorePage() {
  const { t } = useTranslation();
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [center, setCenter] = useState<{ lat: number; lng: number } | undefined>(undefined);
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [activeBuses, setActiveBuses] = useState<ActiveBusOnRoute[]>([]);

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

  // Poll active buses every 15s
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      fetchAllActiveBuses()
        .then((b) => !cancelled && setActiveBuses(b))
        .catch(() => {});
    };
    tick();
    const handle = window.setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, []);

  const busMarkers = activeBuses.map((b) => ({
    tripId: b.tripId,
    anonId: b.anonId,
    position: { lat: b.position.lat, lng: b.position.lng },
  }));

  return (
    <div className="map-container">
      <LeafletMap
        routes={routes}
        showStops
        centerOn={center}
        userPosition={userPos}
        followUser
        activeBuses={busMarkers}
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
          display: 'flex',
          justifyContent: 'center',
          gap: 12,
        }}
      >
        <span>{routes.length} {t('routes.list').toLowerCase()}</span>
        {busMarkers.length > 0 && (
          <span style={{ color: 'var(--brand-700)', fontWeight: 600 }}>
            · 🚌 {busMarkers.length} en ruta
          </span>
        )}
      </div>
    </div>
  );
}