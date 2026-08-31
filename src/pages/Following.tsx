import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTripShareStore } from '@/state/tripShare';
import { LeafletMap } from '@/components/LeafletMap';
import { ArrowLeft, Bus, Clock, Share, Trash, Navigation, X, AlertTriangle } from '@/components/icons';
import { useNavigate } from 'react-router-dom';
import { formatDistance } from '@/geo/distance';
import type { SharedTrip } from '@/state/tripShare';

export default function FollowingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const sharedTrips = useTripShareStore((s) => s.sharedTrips);
  const setSharedTrip = useTripShareStore((s) => s.setSharedTrip);
  const trips = Object.values(sharedTrips);
  const activeTrips = trips.filter((t) => !t.endedAt);
  const endedTrips = trips.filter((t) => !!t.endedAt).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  const [selected, setSelected] = useState<SharedTrip | null>(null);

  useEffect(() => {
    if (!selected && activeTrips[0]) setSelected(activeTrips[0]);
    if (selected && activeTrips.find((t) => t.fromAnonId === selected.fromAnonId)) {
      setSelected(activeTrips.find((t) => t.fromAnonId === selected.fromAnonId)!);
    }
  }, [sharedTrips]);

  if (activeTrips.length === 0 && endedTrips.length === 0) {
    return (
      <div className="page">
        <header className="page-header">
          <button type="button" className="btn-icon btn" onClick={() => navigate(-1)} aria-label="Volver">
            <ArrowLeft />
          </button>
          <h1 style={{ flex: 1 }}>Siguiendo</h1>
        </header>
        <div className="empty">
          <div className="empty-illustration">
            <Share size={40} />
          </div>
          <h3>Nadie está compartiendo viaje</h3>
          <p className="text-sm text-muted">
            Cuando alguien emparejado contigo empiece un viaje, aparecerá aquí.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="btn-icon btn" onClick={() => navigate(-1)} aria-label="Volver">
          <ArrowLeft />
        </button>
        <h1 style={{ flex: 1 }}>Siguiendo</h1>
      </header>

      {activeTrips.length > 1 && (
        <div className="row gap-2 mb-3" style={{ flexWrap: 'wrap' }}>
          {activeTrips.map((t) => (
            <button
              key={t.fromAnonId}
              type="button"
              className={`chip ${selected?.fromAnonId === t.fromAnonId ? 'active' : ''}`}
              onClick={() => setSelected(t)}
            >
              <Bus size={14} /> {t.fromAlias ?? `#${t.fromAnonId.slice(0, 6)}`}
            </button>
          ))}
        </div>
      )}

      {selected && selected.lastLocation && (
        <section className="card mb-3" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ height: 220, position: 'relative' }}>
            <LeafletMap
              userPosition={{ lat: selected.lastLocation.lat, lng: selected.lastLocation.lng }}
            />
          </div>
          <div style={{ padding: 12 }}>
            <div className="row gap-2" style={{ alignItems: 'center' }}>
              <Navigation size={20} style={{ color: 'var(--brand-600)' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>
                  {selected.fromAlias ?? `#${selected.fromAnonId.slice(0, 6)}`}
                  {' · '}
                  {selected.routeName ?? 'Sin ruta'}
                </div>
                <div className="text-xs text-muted">
                  Última actualización: hace {timeAgo(selected.lastLocation.ts)}
                </div>
              </div>
            </div>
            {selected.nextStopName && selected.etaNextStopS != null && (
              <div className="row gap-2 mt-2" style={{ alignItems: 'center' }}>
                <Clock size={16} className="text-muted" />
                <div className="text-sm">
                  Llega a <strong>{selected.nextStopName}</strong> en{' '}
                  <strong>{Math.round(selected.etaNextStopS / 60)} min</strong>
                </div>
              </div>
            )}
            {selected.plannedRoute && (
              <div className="mt-2">
                <div className="text-xs text-muted">Ruta planeada</div>
                <ol style={{ listStyle: 'none', padding: 0, margin: '4px 0 0', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--fs-sm)' }}>
                  {selected.plannedRoute.steps.map((s, i) => (
                    <li key={i}>
                      {i + 1}. {s.label}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </section>
      )}

      {endedTrips.length > 0 && (
        <>
          <h3 className="mb-2 text-muted text-sm">Viajes terminados</h3>
          <div className="list">
            {endedTrips.map((t) => (
              <div key={t.fromAnonId} className="list-item">
                <div className="list-item-icon">
                  <Bus size={20} />
                </div>
                <div className="list-item-body">
                  <div className="list-item-title">
                    {t.fromAlias ?? `#${t.fromAnonId.slice(0, 6)}`} · {t.routeName ?? 'Sin ruta'}
                  </div>
                  <div className="list-item-sub">
                    terminado hace {t.endedAt ? timeAgo(t.endedAt) : '?'} ({t.endReason})
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSharedTrip(t.fromAnonId, null)}
                  aria-label="Quitar"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec} s`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h`;
  return `${Math.floor(sec / 86400)} d`;
}

void formatDistance;
void AlertTriangle;
void Trash;