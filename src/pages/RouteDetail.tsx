import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/api/client';
import { listProposals, voteOnProposal } from '@/api/proposals';
import { fetchActiveBusesOnRoute, type ActiveBus } from '@/api/activeBuses';
import { listIncidents, reportIncident, resolveIncident } from '@/api/incidents';
import { useTripStore } from '@/state/trip';
import { useIdentityStore } from '@/state/identity';
import type { Route, RouteEditProposal, Incident, IncidentKind } from '@/api/types';
import { LeafletMap, vehicleEmoji, vehicleColor } from '@/components/LeafletMap';
import { StopRequestSection } from '@/components/StopRequestSection';
import { Navigation, ChevronLeft, Edit, Map as MapIcon, Check, X, AlertTriangle, Bus, Clock, Train, Plus } from '@/components/icons';
import { formatDistance, polylineLength } from '@/geo/distance';
import { estimateStopEtas, formatEta } from '@/geo/eta';
import { isRouteActiveAt, summarizeSchedule, isIncidentVisible, incidentLabel } from '@/geo/schedule';
import { notify } from '@/notify';

function IncidentForm({
  routeId,
  anonId,
  onCreated,
}: {
  routeId: string;
  anonId: string;
  onCreated: (inc: Incident) => void;
}) {
  const [kind, setKind] = useState<IncidentKind>('delay');
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState<number>(30); // minutes
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (!reason.trim()) return;
    setSubmitting(true);
    try {
      const endsAt = Date.now() + duration * 60_000;
      const res = await reportIncident({
        routeId, kind, reason: reason.trim(), reportedBy: anonId, endsAt,
      });
      onCreated({
        id: res.id, routeId, kind, reason: reason.trim(), reportedBy: anonId,
        ts: Date.now(), endsAt, resolved: false,
      });
      setReason('');
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="mt-3" style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
        {(['cancellation', 'delay', 'diversion', 'other'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={`chip ${kind === k ? 'active' : ''}`}
            onClick={() => setKind(k)}
          >
            {k === 'cancellation' ? '🚫 Cancelado' :
             k === 'delay' ? '⏱️ Retraso' :
             k === 'diversion' ? '↪️ Desvío' : '⚠️ Otro'}
          </button>
        ))}
      </div>
      <input
        className="input"
        placeholder="Describe brevemente la incidencia…"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="row gap-2" style={{ alignItems: 'center' }}>
        <span className="text-sm text-muted">Duración estimada:</span>
        <input
          type="number"
          min={5}
          max={720}
          value={duration}
          onChange={(e) => setDuration(parseInt(e.target.value || '30', 10))}
          style={{ width: 80 }}
          className="input"
        />
        <span className="text-sm text-muted">min</span>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => void submit()}
          disabled={!reason.trim() || submitting}
          style={{ marginLeft: 'auto' }}
        >
          Reportar
        </button>
      </div>
    </div>
  );
}

export default function RouteDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [route, setRoute] = useState<Route | null>(null);
  const [tab, setTab] = useState<'info' | 'pending'>('info');
  const [pending, setPending] = useState<RouteEditProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState<string | null>(null);
  const [activeBuses, setActiveBuses] = useState<ActiveBus[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const startTrip = useTripStore((s) => s.startTrip);
  const anonId = useIdentityStore((s) => s.anonId);
  const myPubKey = useIdentityStore((s) => s.identity?.pubKey);

  // Track proposal status changes to notify the author
  const seenProposalsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      apiFetch<Route>(`/routes/${id}`),
      listProposals(id),
    ])
      .then(([r, p]) => {
        setRoute(r);
        setPending(p);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  // Poll active buses on this route every 15s while viewing
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      fetchActiveBusesOnRoute(id)
        .then((b) => !cancelled && setActiveBuses(b))
        .catch(() => {});
      listIncidents(id)
        .then((i) => !cancelled && setIncidents(i))
        .catch(() => {});
    };
    tick();
    const handle = window.setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [id]);

  // Notify the author when their proposal status changes (approved/rejected)
  useEffect(() => {
    if (!myPubKey) return;
    for (const p of pending) {
      if (p.author !== myPubKey) continue;
      const prev = seenProposalsRef.current.get(p.id);
      if (prev && prev !== p.status) {
        if (p.status === 'approved') {
          void notify({
            title: 'portami',
            body: t('proposal.applied'),
            tag: `proposal-approved-${p.id}`,
            url: `/routes/${id}`,
          });
        } else if (p.status === 'rejected') {
          void notify({
            title: 'portami',
            body: t('proposal.rejectedNotif'),
            tag: `proposal-rejected-${p.id}`,
          });
        }
      }
      seenProposalsRef.current.set(p.id, p.status);
    }
  }, [pending, myPubKey, id, t]);

  const onShareTrip = async () => {
    if (!route) return;
    await startTrip(route);
    navigate('/trip');
  };

  const onVote = async (proposalId: string, kind: 'approve' | 'reject') => {
    setVoting(proposalId);
    try {
      const res = await voteOnProposal(proposalId, kind);
      setPending((cur) =>
        cur.map((p) => (p.id === proposalId ? { ...p, approvals: res.approvals, rejections: res.rejections, status: res.status as any } : p)),
      );
    } catch {
      // ignore
    } finally {
      setVoting(null);
    }
  };

  if (loading || !route) {
    return (
      <div className="page">
        <div className="skeleton" style={{ height: 220, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 28, width: '70%', marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 14, width: '40%' }} />
      </div>
    );
  }

  const pendingCount = pending.filter((p) => p.status === 'pending').length;
  const visibleIncidents = incidents.filter((i) => isIncidentVisible(i));
  const isActiveNow = isRouteActiveAt(route);

  // Compute per-stop ETAs from the first active bus (most recent position)
  const primaryBus = activeBuses[0];
  const etas = primaryBus
    ? estimateStopEtas(route, primaryBus.position)
    : [];

  // Build map markers
  const busMarkers = activeBuses.map((b) => ({
    tripId: b.tripId,
    anonId: b.anonId,
    position: { lat: b.position.lat, lng: b.position.lng },
  }));

  return (
    <div>
      <div style={{ height: '50vh', position: 'relative' }}>
        <LeafletMap
          routes={[route]}
          showStops
          activeBuses={busMarkers}
        />
        <Link
          to="/"
          className="btn btn-icon"
          style={{ position: 'absolute', top: 12, left: 12, zIndex: 50, background: 'var(--overlay-strong)' }}
          aria-label={t('common.back')}
        >
          <ChevronLeft />
        </Link>
        {activeBuses.length > 0 && (
          <div
            className="banner banner-info"
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              zIndex: 50,
              padding: '8px 12px',
              borderRadius: 'var(--r-md)',
              background: 'var(--overlay-strong)',
              color: 'var(--text)',
            }}
          >
            <Bus size={16} />
            <span>{activeBuses.length} en ruta ahora</span>
          </div>
        )}
      </div>

      <div className="page" style={{ paddingTop: 16 }}>
        <div className="row mb-3">
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 'var(--fs-xl)' }}>
              {vehicleEmoji(route.vehicleKind)} {route.name}
            </h1>
            <div className="text-muted text-sm mt-2">
              {t('routes.stops', { n: route.stops.length })} · {formatDistance(polylineLength(route.polyline))} · v{route.version}
              {route.direction ? ` · ${route.direction}` : ''}
            </div>
            {route.schedules && route.schedules.length > 0 && (
              <div className="text-sm mt-2" style={{ color: isActiveNow ? 'var(--success)' : 'var(--text-muted)' }}>
                {isActiveNow ? '🟢 ' : '⚫ '}{summarizeSchedule(route)}
              </div>
            )}
          </div>
          <span
            className="badge"
            style={{ background: vehicleColor(route.vehicleKind), color: 'white' }}
          >
            {route.vehicleKind ?? 'bus'}
          </span>
        </div>

        {/* Incidents panel */}
        {(visibleIncidents.length > 0 || showIncidentForm) && (
          <section className="card mb-3" style={{ borderLeft: '4px solid #dc2626' }}>
            <div className="card-header">
              <div className="card-title">⚠️ Incidencias ({visibleIncidents.length})</div>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setShowIncidentForm((v) => !v)}
              >
                {showIncidentForm ? 'Cerrar' : <><Plus size={14} /> Reportar</>}
              </button>
            </div>
            {visibleIncidents.length > 0 && (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {visibleIncidents.map((i) => (
                  <li key={i.id} className="row gap-2" style={{ fontSize: 'var(--fs-sm)', alignItems: 'flex-start' }}>
                    <span>{i.kind === 'cancellation' ? '🚫' : i.kind === 'delay' ? '⏱️' : i.kind === 'diversion' ? '↪️' : '⚠️'}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{incidentLabel(i.kind)}</div>
                      <div className="text-xs text-muted">{i.reason}</div>
                      {i.endsAt && (
                        <div className="text-xs text-muted">
                          hasta {new Date(i.endsAt).toLocaleTimeString()}
                        </div>
                      )}
                    </div>
                    {myPubKey && myPubKey === i.reportedBy ? (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={async () => {
                          await resolveIncident(i.id!);
                          setIncidents((cur) => cur.filter((x) => x.id !== i.id));
                        }}
                      >
                        Resolver
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {showIncidentForm && (
              <IncidentForm
                routeId={route.id}
                anonId={anonId ?? 'unknown'}
                onCreated={(inc) => {
                  setIncidents((cur) => [...cur, inc]);
                  setShowIncidentForm(false);
                }}
              />
            )}
          </section>
        )}
        {!showIncidentForm && visibleIncidents.length === 0 && (
          <button
            type="button"
            className="btn btn-block mb-3"
            onClick={() => setShowIncidentForm(true)}
          >
            <Plus size={14} /> Reportar incidencia
          </button>
        )}

        {/* Stop request info + bus reports */}
        <StopRequestSection route={route} onRouteChange={setRoute} />

        {/* Live ETA panel */}
        {primaryBus && etas.length > 0 && (
          <section className="card mb-3">
            <div className="card-header">
              <div className="card-title">Tiempo estimado de llegada</div>
              <span className="badge badge-warning" title="Cálculo aproximado basado en la velocidad del bus">Estimación</span>
            </div>
            <p className="text-xs text-muted mb-2">
              Calculado desde la posición de #{primaryBus.anonId.slice(0, 6)}. Es una estimación — puede variar según tráfico, semáforos y paradas.
            </p>
            <div className="list">
              {etas.map((e, i) => (
                <div key={e.stopId} className="list-item">
                  <div className="list-item-icon" style={{ background: i === 0 ? 'var(--brand-600)' : 'var(--bg-subtle)', color: i === 0 ? 'white' : 'var(--text)' }}>
                    <Clock size={16} />
                  </div>
                  <div className="list-item-body">
                    <div className="list-item-title">
                      {i === 0 && <strong>Próxima: </strong>}
                      {e.stopName}
                    </div>
                    <div className="list-item-sub">
                      {formatDistance(e.distanceM)}
                    </div>
                  </div>
                  <div style={{ fontWeight: 700, color: 'var(--brand-700)', fontFamily: 'var(--font-mono)' }}>
                    {formatEta(e.etaMs)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Tabs */}
        <div className="row gap-2 mb-3">
          <button
            type="button"
            className={`chip ${tab === 'info' ? 'active' : ''}`}
            onClick={() => setTab('info')}
          >
            {t('routes.list')}
          </button>
          <button
            type="button"
            className={`chip ${tab === 'pending' ? 'active' : ''}`}
            onClick={() => setTab('pending')}
          >
            {t('routes.pending', { n: pendingCount })}
          </button>
        </div>

        {tab === 'info' && (
          <>
            <button type="button" className="btn btn-primary btn-lg btn-block mb-3" onClick={onShareTrip}>
              <Navigation size={20} />
              {t('routes.shareTrip')}
            </button>

            <button type="button" className="btn btn-block mb-4" onClick={() => alert('Próximamente: editor de propuestas')}>
              <Edit size={20} />
              {t('routes.proposeChange')}
            </button>

            <h3 className="mb-3">{t('routes.list')}</h3>
            <ol style={{ listStyle: 'none', padding: 0, margin: 0 }} className="list">
              {route.stops.map((s, i) => (
                <li key={s.id} className="list-item">
                  <div
                    className="list-item-icon"
                    style={{
                      background: i === 0 ? 'var(--brand-600)' : 'var(--bg-subtle)',
                      color: i === 0 ? 'white' : 'var(--text)',
                      fontWeight: 700,
                    }}
                  >
                    {i + 1}
                  </div>
                  <div className="list-item-body">
                    <div className="list-item-title">{s.name}</div>
                    <div className="list-item-sub">
                      {s.lat.toFixed(4)}, {s.lng.toFixed(4)}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}

        {tab === 'pending' && (
          <>
            {pending.length === 0 ? (
              <div className="empty">
                <div className="empty-illustration">
                  <MapIcon size={40} />
                </div>
                <h3>{t('routes.noPending')}</h3>
              </div>
            ) : (
              <div className="list">
                {pending.map((p) => {
                  const isAuthor = p.author === myPubKey;
                  const status = p.status;
                  return (
                    <div key={p.id} className="card">
                      <div className="card-header">
                        <div className="card-title">{p.title}</div>
                        <span className={`badge ${status === 'pending' ? 'badge-warning' : status === 'approved' ? 'badge-success' : status === 'expired' ? 'badge-info' : 'badge-danger'}`}>
                          {t(`proposal.${status}`)}
                        </span>
                      </div>
                      {p.rationale && (
                        <p className="text-sm text-muted mb-2">{p.rationale}</p>
                      )}
                      <div className="row gap-2 text-sm">
                        <span className="badge badge-success">✓ {p.approvals}/5</span>
                        <span className="badge badge-danger">✗ {p.rejections}/5</span>
                      </div>
                      {status === 'pending' && !isAuthor && (
                        <div className="row gap-2 mt-3">
                          <button
                            type="button"
                            className="btn btn-sm flex-1"
                            style={{ background: 'var(--success)', color: 'white', borderColor: 'transparent' }}
                            disabled={voting === p.id}
                            onClick={() => void onVote(p.id, 'approve')}
                          >
                            <Check size={16} /> {t('proposal.approve')}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm flex-1"
                            style={{ background: 'var(--danger)', color: 'white', borderColor: 'transparent' }}
                            disabled={voting === p.id}
                            onClick={() => void onVote(p.id, 'reject')}
                          >
                            <X size={16} /> {t('proposal.reject')}
                          </button>
                        </div>
                      )}
                      {isAuthor && status === 'pending' && (
                        <div className="banner banner-info mt-2 text-sm">
                          <AlertTriangle size={14} />
                          <span>{t('proposal.yourProposal')}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}