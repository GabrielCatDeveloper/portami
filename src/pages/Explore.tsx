import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch, ServerOfflineError } from '@/api/client';
import { fetchAllActiveBuses, type ActiveBusOnRoute } from '@/api/activeBuses';
import { listIncidents } from '@/api/incidents';
import type { Route, Incident, VehicleKind } from '@/api/types';
import { LeafletMap, vehicleEmoji } from '@/components/LeafletMap';
import { geoWatcher } from '@/geo/watcher';
import { isRouteActiveAt, isIncidentVisible } from '@/geo/schedule';
import { useInterval } from '@/hooks/useInterval';

type VehicleFilter = 'all' | VehicleKind;

export default function ExplorePage() {
  const { t } = useTranslation();
  const [allRoutes, setAllRoutes] = useState<Route[]>([]);
  const [activeBuses, setActiveBuses] = useState<ActiveBusOnRoute[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [center, setCenter] = useState<{ lat: number; lng: number } | undefined>(undefined);
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [vehicleFilter, setVehicleFilter] = useState<VehicleFilter>('all');
  const [onlyActiveNow, setOnlyActiveNow] = useState(true);
  const [hideIncidents, setHideIncidents] = useState(true);

  useEffect(() => {
    apiFetch<{ routes: Route[] }>('/routes/nearby?lat=40.42&lng=-3.69')
      .then((res) => setAllRoutes(res.routes))
      .catch((e) => {
        if (!(e instanceof ServerOfflineError)) console.error(e);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let mounted = true;
    let off: (() => void) | null = null;
    let leaseId: string | null = null;
    void geoWatcher.checkPermission().then((p) => {
      if (!mounted) return;
      if (p !== 'granted') return;
      leaseId = geoWatcher.start();
      off = geoWatcher.on((s) => {
        if (!mounted) return;
        setUserPos({ lat: s.lat, lng: s.lng });
        setCenter({ lat: s.lat, lng: s.lng });
      });
    });
    return () => {
      mounted = false;
      off?.();
      if (leaseId) geoWatcher.stop(leaseId);
    };
  }, []);

  // Poll active buses + incidents every 15s. The `cancelled` ref
  // guards the in-flight fetch callbacks so a slow network
  // doesn't setState on an unmounted component.
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);
  useInterval(() => {
    fetchAllActiveBuses()
      .then((b) => !cancelled.current && setActiveBuses(b))
      .catch(() => {});
    listIncidents()
      .then((i) => !cancelled.current && setIncidents(i))
      .catch(() => {});
  }, 15_000);

  // Build a quick lookup of routeId -> vehicleKind
  const routeKindById = useMemo(() => {
    const map = new Map<string, VehicleKind>();
    for (const r of allRoutes) if (r.vehicleKind) map.set(r.id, r.vehicleKind);
    return map;
  }, [allRoutes]);

  // Apply filters: vehicle + active-now + exclude routes with active incidents if requested
  const visibleRoutes = useMemo(() => {
    const now = new Date();
    return allRoutes.filter((r) => {
      if (vehicleFilter !== 'all' && r.vehicleKind !== vehicleFilter) return false;
      if (onlyActiveNow && !isRouteActiveAt(r, now)) return false;
      return true;
    });
  }, [allRoutes, vehicleFilter, onlyActiveNow]);

  const visibleIncidents = useMemo(
    () => incidents.filter((i) => isIncidentVisible(i)),
    [incidents],
  );

  // Map active buses to markers, looking up vehicleKind from the route
  const busMarkers = useMemo(() => activeBuses.map((b) => ({
    tripId: b.tripId,
    anonId: b.anonId,
    position: { lat: b.position.lat, lng: b.position.lng },
    vehicleKind: b.vehicleKind ?? (b.routeId ? routeKindById.get(b.routeId) : undefined),
  })), [activeBuses, routeKindById]);

  return (
    <div className="map-container">
      <LeafletMap
        routes={visibleRoutes}
        showStops
        centerOn={center}
        userPosition={userPos}
        followUser
        activeBuses={busMarkers}
      />

      {/* Top filter bar — z-index 1000 so it sits above Leaflet's
          tile-pane (200), marker-pane (600), popup-pane (700) and
          control-pane (800). Anything below 800 gets covered by the
          map tiles, which was the original bug. */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          right: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          zIndex: 1000,
        }}
      >
        {/* Vehicle filter chips */}
        <div
          style={{
            display: 'flex',
            gap: 6,
            background: 'var(--overlay-strong)',
            padding: 6,
            borderRadius: 'var(--r-pill)',
            boxShadow: 'var(--shadow-sm)',
            overflowX: 'auto',
          }}
        >
          {(['all', 'bus', 'train', 'tram', 'metro'] as VehicleFilter[]).map((k) => {
            const labelKey = k === 'all' ? 'explore.all' : `vehicle.${k}`;
            const emoji = k === 'all' ? '🚌'
              : k === 'bus' ? '🚌'
              : k === 'train' ? '🚆'
              : k === 'tram' ? '🚊'
              : '🚇';
            return (
              <button
                key={k}
                type="button"
                className={`chip ${vehicleFilter === k ? 'active' : ''}`}
                onClick={() => setVehicleFilter(k)}
                style={{ whiteSpace: 'nowrap' }}
              >
                <span style={{ marginRight: 4 }}>{emoji}</span>
                {t(labelKey)}
              </button>
            );
          })}
        </div>

        {/* Active-now toggle */}
        <div
          style={{
            display: 'flex',
            gap: 6,
            background: 'var(--overlay-strong)',
            padding: '6px 10px',
            borderRadius: 'var(--r-pill)',
            alignItems: 'center',
            boxShadow: 'var(--shadow-sm)',
            fontSize: 'var(--fs-sm)',
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={onlyActiveNow}
              onChange={(e) => setOnlyActiveNow(e.target.checked)}
            />
            <span>{t('explore.onlyActive')}</span>
          </label>
        </div>

        {/* Incidents banner (if any visible) */}
        {!hideIncidents && visibleIncidents.length > 0 && (
          <div
            style={{
              background: 'rgba(254, 226, 226, 0.95)',
              borderRadius: 'var(--r-md)',
              padding: '8px 12px',
              fontSize: 'var(--fs-sm)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <strong>{t('explore.incidentsActive', { n: visibleIncidents.length })}</strong>
            <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
              {visibleIncidents.slice(0, 3).map((i) => (
                <li key={i.id}>
                  {i.kind === 'cancellation' ? '🚫' : i.kind === 'delay' ? '⏱️' : '↪️'} {i.reason}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setHideIncidents(true)}
              style={{ marginTop: 4, padding: 0 }}
            >
              {t('explore.hide')}
            </button>
          </div>
        )}
        {hideIncidents && visibleIncidents.length > 0 && (
          <button
            type="button"
            className="btn btn-sm"
            style={{ alignSelf: 'flex-start', background: 'var(--overlay-strong)' }}
            onClick={() => setHideIncidents(false)}
          >
            {t('explore.incidentsShow', { n: visibleIncidents.length })}
          </button>
        )}
      </div>

      {loading && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(var(--bottom-nav-h) + var(--safe-bottom) + 12px)',
            left: 12,
            right: 12,
            background: 'var(--overlay-strong)',
            borderRadius: 'var(--r-md)',
            padding: '12px 14px',
            zIndex: 1000,
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
          zIndex: 1000,
          textAlign: 'center',
          fontSize: 'var(--fs-sm)',
          color: 'var(--text-muted)',
          boxShadow: 'var(--shadow-sm)',
          display: 'flex',
          justifyContent: 'center',
          gap: 12,
        }}
      >
        <span>{visibleRoutes.length} {t('routes.list').toLowerCase()}</span>
        {busMarkers.length > 0 && (
          <span style={{ color: 'var(--brand-700)', fontWeight: 600 }}>
            · {busMarkers.map((b) => vehicleEmoji(b.vehicleKind)).join('')} {t('explore.onRoute', { n: busMarkers.length })}
          </span>
        )}
      </div>
    </div>
  );
}