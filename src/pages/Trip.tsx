import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTripStore } from '@/state/trip';
import { geoWatcher } from '@/geo/watcher';
import { TripDetector, type DetectorEvent } from '@/geo/tripDetector';
import { LeafletMap } from '@/components/LeafletMap';
import { haversine, nearestStop, formatDistance } from '@/geo/distance';
import { Stop, AlertTriangle, Info } from '@/components/icons';

export default function TripPage() {
  const { t } = useTranslation();
  const activeTrip = useTripStore((s) => s.activeTrip);
  const route = useTripStore((s) => s.route);
  const lastSample = useTripStore((s) => s.lastSample);
  const setLastSample = useTripStore((s) => s.setLastSample);
  const endTrip = useTripStore((s) => s.endTrip);
  const detectorRef = useRef<TripDetector | null>(null);
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied' | 'prompt'>('unknown');
  const [arrivalStopId, setArrivalStopId] = useState<string | null>(null);
  const [autoEndedReason, setAutoEndedReason] = useState<string | null>(null);

  // Init detector
  useEffect(() => {
    if (!route) return;
    detectorRef.current = new TripDetector();
    return () => detectorRef.current?.reset();
  }, [route?.id]);

  // Permission + watcher setup
  useEffect(() => {
    if (!activeTrip) return;
    let off: (() => void) | null = null;

    void (async () => {
      const p = await geoWatcher.checkPermission();
      setPermission(p as any);
      if (p !== 'granted') return;
      geoWatcher.attachTrip(activeTrip.id);
      geoWatcher.start();
      off = geoWatcher.on((s) => {
        setLastSample(s);
        const det = detectorRef.current;
        if (!det || !route) return;
        const events: DetectorEvent[] = det.observe(s, route, (e) => {
          if (e.kind === 'arrived-at-stop') {
            setArrivalStopId(e.stopId);
          }
          if (e.kind === 'trip-should-end') {
            void endTrip('heuristic').then(() => setAutoEndedReason(e.reason));
          }
        });
        if (!events.some((e) => e.kind === 'trip-should-end')) {
          // continue
        }
      });
    })();

    return () => {
      if (off) off();
      geoWatcher.detachTrip();
      geoWatcher.stop();
    };
  }, [activeTrip?.id]);

  if (!activeTrip || !route) {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty-illustration">
            <Info size={40} />
          </div>
          <h3>{t('trip.permissionNeeded')}</h3>
          <p>{t('home.noActiveTrip')}</p>
        </div>
      </div>
    );
  }

  if (permission === 'denied') {
    return (
      <div className="page">
        <div className="banner banner-danger">
          <AlertTriangle size={20} />
          <span>{t('trip.permissionNeeded')}</span>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-lg btn-block mt-3"
          onClick={() => void geoWatcher.requestPermission()}
        >
          {t('trip.grantPermission')}
        </button>
      </div>
    );
  }

  if (permission === 'prompt' || permission === 'unknown') {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty-illustration">
            <Info size={40} />
          </div>
          <h3>{t('trip.permissionNeeded')}</h3>
          <p className="mb-4">portami necesita tu GPS para mostrar a otros usuarios dónde estás y calcular tu hora de llegada.</p>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={async () => {
              const p = await geoWatcher.requestPermission();
              setPermission(p as any);
            }}
          >
            {t('trip.grantPermission')}
          </button>
        </div>
      </div>
    );
  }

  // Active
  const next = (() => {
    if (!lastSample || !route.stops.length) return null;
    const ns = nearestStop({ lat: lastSample.lat, lng: lastSample.lng }, route.stops);
    if (!ns) return null;
    return { stop: route.stops.find((s) => s.id === ns.stop.id)!, distance: ns.distance };
  })();

  return (
    <div>
      <div style={{ height: '55vh', position: 'relative' }}>
        <LeafletMap
          routes={[route]}
          showStops
          centerOn={lastSample ? { lat: lastSample.lat, lng: lastSample.lng } : undefined}
          userPosition={lastSample ? { lat: lastSample.lat, lng: lastSample.lng } : null}
          followUser
        />
      </div>

      <div className="page">
        <div className="card mb-3" style={{ background: 'var(--brand-50)', border: '1px solid var(--brand-200)' }}>
          <div className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {t('trip.liveSharing')}
          </div>
          <div className="row mt-2">
            <div className="list-item-icon" style={{ background: 'var(--brand-600)', color: 'white' }}>
              <Stop size={20} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{next?.stop.name ?? '—'}</div>
              <div className="text-sm text-muted">
                {next ? `${formatDistance(next.distance)} · ${t('stop.arrival')}` : t('stop.current')}
              </div>
            </div>
          </div>
        </div>

        {arrivalStopId && (
          <div className="banner banner-info mb-3">
            <Info size={18} />
            <span style={{ flex: 1 }}>{t('trip.arriving', { stop: route.stops.find((s) => s.id === arrivalStopId)?.name ?? '' })}</span>
            <button type="button" className="btn btn-sm" onClick={() => setArrivalStopId(null)}>
              {t('stop.alightHere')}
            </button>
          </div>
        )}

        {autoEndedReason && (
          <div className="banner banner-warning mb-3">
            <Info size={18} />
            <span>{t('trip.endedAuto')}</span>
          </div>
        )}

        <button
          type="button"
          className="btn btn-danger btn-lg btn-block"
          onClick={() => {
            if (confirm(t('trip.endConfirm'))) void endTrip('manual');
          }}
        >
          {t('trip.endNow')}
        </button>
      </div>
    </div>
  );
}