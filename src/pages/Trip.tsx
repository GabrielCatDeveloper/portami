import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTripStore } from '@/state/trip';
import { geoWatcher, type GeoPermission } from '@/geo/watcher';
import { TripDetector, type DetectorEvent } from '@/geo/tripDetector';
import { LeafletMap } from '@/components/LeafletMap';
import { nearestStop, formatDistance } from '@/geo/distance';
import { useStopAlertWatcher } from '@/geo/useStopAlertWatcher';
import { resetTriggered } from '@/storage/stopAlerts';
import { StopAlertsCard } from '@/components/StopAlertsCard';
import { useTripShareBridge } from '@/sync/tripShare';
import { useTripShareStore } from '@/state/tripShare';
import { useIdentityStore } from '@/state/identity';
import { InviteModal } from '@/components/InviteModal';
import { RecipientList } from '@/components/RecipientList';
import { Stop, AlertTriangle, Info, Share, ShareOff } from '@/components/icons';

export default function TripPage() {
  const { t } = useTranslation();
  const activeTrip = useTripStore((s) => s.activeTrip);
  const route = useTripStore((s) => s.route);
  const lastSample = useTripStore((s) => s.lastSample);
  const setLastSample = useTripStore((s) => s.setLastSample);
  const endTrip = useTripStore((s) => s.endTrip);
  type TripPermission = 'unknown' | 'granted' | 'denied' | 'prompt';

/**
 * Narrow `GeoPermission` (which includes an `error` state for
 * browsers that don't support the Permissions API) down to the
 * four UI-meaningful states.
 */
function toTripPermission(p: GeoPermission): TripPermission {
  if (p === 'granted' || p === 'denied' || p === 'prompt') return p;
  return 'unknown';
}

const detectorRef = useRef<TripDetector | null>(null);
// GeoPermission from the watcher is the wider set; we collapse
// 'error' → 'unknown' because the UI distinguishes only the
// three "user-actionable" states.
const [permission, setPermission] = useState<TripPermission>('unknown');
const [arrivalStopId, setArrivalStopId] = useState<string | null>(null);
const [autoEndedReason, setAutoEndedReason] = useState<string | null>(null);

  // Init detector
  useEffect(() => {
    if (!route) return;
    detectorRef.current = new TripDetector();
    return () => detectorRef.current?.reset();
    // The detector is reset and rebuilt only when the route changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.id]);

  // Permission + watcher setup
  useEffect(() => {
    if (!activeTrip) return;
    let off: (() => void) | null = null;

    void (async () => {
      const p = await geoWatcher.checkPermission();
      setPermission(toTripPermission(p));
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
            // Privacy: stop sharing first so the auto-end never
            // leaves the recipient's screen showing a stale position
            // for more than one tick.
            if (sharing) shareBridge.stopSharing('heuristic');
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
    // The watcher lifecycle is tied to the active trip id only;
    // re-running on every state change would churn the GPS watcher.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrip?.id]);

  // Reset all alerts' "triggered" flag when a new trip starts so that
  // the same alert can fire again on the next ride.
  useEffect(() => {
    if (route) void resetTriggered(route.id);
    // intentional: only on route change (i.e. start of new trip)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrip?.id]);

  // Watch for stop-alert triggers
  const { alerts: stopAlerts, reload: reloadAlerts } = useStopAlertWatcher({
    route,
    sample: lastSample,
    enabled: !!activeTrip,
  });

  // Trip sharing via WebRTC. plannedRoute is read from the trip store
  // automatically (set by /journey → start trip) so the friend knows
  // where you're going even if the GPS drops out.
  const identity = useIdentityStore();
  const outgoing = useTripShareStore((s) => s.outgoing);
  const shareBridge = useTripShareBridge({
    tripId: activeTrip?.id,
    routeId: route?.id,
    routeName: route?.name,
    lastSample: lastSample ? { lat: lastSample.lat, lng: lastSample.lng, speed: lastSample.speed, ts: lastSample.ts } : null,
  });
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [inviteFor, setInviteFor] = useState<{ deviceId: string; alias?: string } | null>(null);

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
          <p className="mb-4">{t('trip.gpsNeeded')}</p>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={async () => {
              const p = await geoWatcher.requestPermission();
setPermission(toTripPermission(p));
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

        <StopAlertsCard
          route={route}
          alerts={stopAlerts}
          onChange={reloadAlerts}
        />

        {/* Privacy details: a collapsed <details> block so the
            privacy story doesn't clutter the screen but is always
            one tap away. Documents exactly what goes to the server
            and what stays device-to-device. */}
        <details className="card mb-3 text-sm">
          <summary
            style={{
              cursor: 'pointer',
              padding: '12px 14px',
              fontWeight: 600,
              listStyle: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Info size={16} />
            <span>{t('trip.privacyDetailsTitle', { defaultValue: '¿Quién puede ver dónde estoy?' })}</span>
          </summary>
          <div style={{ padding: '0 14px 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <strong>{t('trip.peerToPeer')}</strong>
              <p className="text-xs text-muted" style={{ margin: '2px 0 0' }}>
                {t('trip.peerToPeerLong')}
              </p>
            </div>
            <div>
              <strong>{t('trip.serverSync')}</strong>
              <p className="text-xs text-muted" style={{ margin: '2px 0 0' }}>
                {t('trip.serverSyncLong')}
              </p>
            </div>
            <div
              style={{
                background: 'var(--bg-subtle)',
                borderRadius: 'var(--r-md)',
                padding: '6px 10px',
                fontSize: 'var(--fs-xs)',
              }}
            >
              {t('trip.serverSyncNoPublic')}
            </div>
          </div>
        </details>

        <section className="card mb-3">
          <div className="card-header">
            <div className="list-item-icon" style={{ background: sharing ? 'var(--success)' : 'var(--bg-subtle)' }}>
              {sharing ? <Share size={20} /> : <ShareOff size={20} />}
            </div>
            <div style={{ flex: 1 }}>
              <div className="card-title">{t('trip.shareTitle')}</div>
              <div className="card-subtitle">
                {sharing ? t('trip.sharingFrequency') : t('trip.privateHint')}
              </div>
            </div>
          </div>

          {/* Privacy banner: always visible, but tone changes
              depending on whether sharing is active. The "P2P, not
              through our server" line is the single most important
              trust signal in this whole card — the user must
              understand that even if they share, the server never
              sees their location. */}
          {sharing ? (
            <>
              <div
                className="banner banner-success mb-2 text-sm"
                role="status"
                aria-live="polite"
              >
                <Share size={16} />
                <span>{t('trip.liveSharing')} · {t('trip.stopSharingHint')}</span>
              </div>
              <div
                className="banner banner-info mb-3 text-sm"
                role="status"
              >
                <Share size={16} />
                <span>
                  <strong>{t('trip.peerToPeer')}</strong>
                  {' — '}
                  {t('trip.peerToPeerLong')}
                </span>
              </div>
            </>
          ) : (
            <div
              className="banner banner-info mb-3 text-sm"
              role="status"
              aria-live="polite"
            >
              <ShareOff size={16} />
              <span>
                <strong>{t('trip.private')}</strong>
                {' — '}
                {t('trip.privateHint')}
                {' '}
                <strong>{t('trip.peerToPeer')}</strong>
              </span>
            </div>
          )}

          {sharing && shareBridge.isSharing && (
            <RecipientList
              outgoing={useTripShareStore.getState().outgoing}
              onRetry={(id) => void shareBridge.retryRecipient(id)}
              onInvite={(deviceId, alias) => setInviteFor({ deviceId, alias })}
            />
          )}

          {sharing ? (
            <button
              type="button"
              className="btn btn-block btn-danger"
              onClick={() => {
                shareBridge.stopSharing('manual');
                setSharing(false);
              }}
            >
              <ShareOff size={18} /> {t('trip.stopSharingButton')}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-block btn-primary"
              onClick={async () => {
                setBusy(true);
                try {
                  const res = await shareBridge.startSharing(null);
                  if (res) setSharing(true);
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
            >
              <Share size={18} /> {t('trip.shareTrip')}
            </button>
          )}
        </section>

        <button
          type="button"
          className="btn btn-danger btn-lg btn-block"
          onClick={() => {
            if (sharing) shareBridge.stopSharing('trip-ended');
            void endTrip('manual');
          }}
        >
          {t('trip.endNow')}
        </button>
      </div>

      {inviteFor && outgoing && (
        <InviteModal
          recipientDeviceId={inviteFor.deviceId}
          recipientAlias={inviteFor.alias}
          tripShareId={outgoing.id}
          emitterAnonId={identity.anonId ?? ''}
          onClose={() => setInviteFor(null)}
        />
      )}
    </div>
  );
}

