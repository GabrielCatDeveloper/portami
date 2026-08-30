import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/api/client';
import { listProposals, voteOnProposal } from '@/api/proposals';
import { useTripStore } from '@/state/trip';
import { useIdentityStore } from '@/state/identity';
import type { Route, RouteEditProposal } from '@/api/types';
import { LeafletMap } from '@/components/LeafletMap';
import { Navigation, ChevronLeft, Edit, Map as MapIcon, Check, X, AlertTriangle } from '@/components/icons';
import { formatDistance, polylineLength } from '@/geo/distance';
import { notify } from '@/notify';

export default function RouteDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [route, setRoute] = useState<Route | null>(null);
  const [tab, setTab] = useState<'info' | 'pending'>('info');
  const [pending, setPending] = useState<RouteEditProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState<string | null>(null);
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

  return (
    <div>
      <div style={{ height: '50vh', position: 'relative' }}>
        <LeafletMap routes={[route]} showStops />
        <Link
          to="/"
          className="btn btn-icon"
          style={{ position: 'absolute', top: 12, left: 12, zIndex: 1000, background: 'var(--overlay-strong)' }}
          aria-label={t('common.back')}
        >
          <ChevronLeft />
        </Link>
      </div>

      <div className="page" style={{ paddingTop: 16 }}>
        <div className="row mb-3">
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 'var(--fs-xl)' }}>{route.name}</h1>
            <div className="text-muted text-sm mt-2">
              {t('routes.stops', { n: route.stops.length })} · {formatDistance(polylineLength(route.polyline))} · v{route.version}
            </div>
          </div>
          <span className="badge badge-brand">{route.vehicleKind ?? 'bus'}</span>
        </div>

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
                      background: 'var(--bg-subtle)',
                      color: 'var(--text)',
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