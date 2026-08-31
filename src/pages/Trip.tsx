import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTripStore } from '@/state/trip';
import { geoWatcher } from '@/geo/watcher';
import { TripDetector, type DetectorEvent } from '@/geo/tripDetector';
import { LeafletMap } from '@/components/LeafletMap';
import { haversine, nearestStop, formatDistance } from '@/geo/distance';
import { useStopAlertWatcher } from '@/geo/useStopAlertWatcher';
import { resetTriggered } from '@/storage/stopAlerts';
import { StopAlertsCard } from '@/components/StopAlertsCard';
import { useTripShareBridge, nextStopInfo } from '@/sync/tripShare';
import { useTripShareStore, recipientChip } from '@/state/tripShare';
import { useIdentityStore } from '@/state/identity';
import { InviteModal } from '@/components/InviteModal';
import { Stop, AlertTriangle, Info, Share, ShareOff, Sync as SyncIcon, ArrowUpRight } from '@/components/icons';

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

        <StopAlertsCard
          route={route}
          alerts={stopAlerts}
          onChange={reloadAlerts}
        />

        <section className="card mb-3">
          <div className="card-header">
            <div className="list-item-icon" style={{ background: sharing ? 'var(--success)' : 'var(--bg-subtle)' }}>
              {sharing ? <Share size={20} /> : <ShareOff size={20} />}
            </div>
            <div style={{ flex: 1 }}>
              <div className="card-title">Compartir viaje</div>
              <div className="card-subtitle">
                {sharing
                  ? 'Tu ubicación se envía cada minuto a cada amigo emparejado.'
                  : 'Para que un amigo te encuentre si pierdes el bus o se te acaba la batería.'}
              </div>
            </div>
          </div>

          {sharing && shareBridge.isSharing && (
            <RecipientList
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
              <ShareOff size={18} /> Dejar de compartir
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
              <Share size={18} /> Compartir con mis amigos emparejados
            </button>
          )}
        </section>

        <button
          type="button"
          className="btn btn-danger btn-lg btn-block"
          onClick={() => {
            if (confirm(t('trip.endConfirm'))) {
              if (sharing) shareBridge.stopSharing('trip-ended');
              void endTrip('manual');
            }
          }}
        >
          {t('trip.endNow')}
        </button>

        <button
          type="button"
          className="btn btn-danger btn-lg btn-block"
          onClick={() => {
            if (confirm(t('trip.endConfirm'))) {
              if (sharing) shareBridge.stopSharing('trip-ended');
              void endTrip('manual');
            }
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

// ============================================================
// RecipientList — live status of each paired friend for the active
// outgoing share. Subscribes to the trip-share store so it
// re-renders on ack / status changes.
// ============================================================
function RecipientList({
  onRetry,
  onInvite,
}: {
  onRetry: (deviceId: string) => void;
  onInvite: (deviceId: string, alias?: string) => void;
}) {
  const outgoing = useTripShareStore((s) => s.outgoing);
  if (!outgoing) return null;
  const recipients = Object.values(outgoing.recipients);
  if (recipients.length === 0) {
    return (
      <p className="text-sm text-muted mb-3">
        No tienes amigos emparejados todavía. Empareja uno desde Settings → Sincronizar.
      </p>
    );
  }
  const delivered = recipients.filter((r) => r.status === 'delivered').length;
  return (
    <div className="mb-3" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="text-xs text-muted">
        Compartido con {delivered} de {recipients.length} amigo{recipients.length === 1 ? '' : 's'}
      </div>
      {recipients.map((r) => {
        const chip = recipientChip(r.status);
        const canRetry = r.status === 'failed' || r.status === 'unreachable';
        return (
          <div
            key={r.deviceId}
            className="row gap-2"
            style={{
              alignItems: 'center',
              padding: '8px 10px',
              background: 'var(--bg-subtle)',
              borderRadius: 'var(--r-md)',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                minWidth: 24,
                color:
                  chip.variant === 'success'
                    ? 'var(--success)'
                    : chip.variant === 'danger'
                    ? 'var(--danger)'
                    : chip.variant === 'warning'
                    ? 'var(--warning)'
                    : 'var(--muted)',
              }}
              aria-hidden
            >
              {chip.icon}
            </span>
            <div style={{ flex: 1, fontSize: 'var(--fs-sm)' }}>
              <div style={{ fontWeight: 600 }}>{r.alias ?? r.deviceId.slice(0, 8)}</div>
              <div className="text-xs text-muted">{chip.label}</div>
            </div>
            {canRetry && (
              <>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => onRetry(r.deviceId)}
                  aria-label="Reintentar"
                  title="Reintentar"
                >
                  <SyncIcon size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => onInvite(r.deviceId, r.alias)}
                  aria-label="Invitar por otra app"
                  title="Invitar por WhatsApp / Telegram / SMS"
                >
                  <ArrowUpRight size={14} />
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}