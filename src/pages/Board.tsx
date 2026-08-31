import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Bus, Map as MapIcon, Plus, Check, AlertTriangle, ChevronRight, Navigation } from '@/components/icons';
import { apiFetch } from '@/api/client';
import type { Route, GPSSample } from '@/api/types';
import { geoWatcher } from '@/geo/watcher';
import { matchRoutesByProximity, type RouteMatch } from '@/geo/matchRoutes';

type Phase = 'idle' | 'locating' | 'searching' | 'suggestions' | 'starting' | 'error';

export default function BoardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState<GPSSample | null>(null);
  const [matches, setMatches] = useState<RouteMatch[]>([]);
  const [selected, setSelected] = useState<Route | null>(null);

  const beginBoarding = async () => {
    setError(null);
    setPhase('locating');
    setPos(null);
    setMatches([]);
    setSelected(null);

    // 1. Permission
    let perm = await geoWatcher.checkPermission();
    if (perm !== 'granted') perm = await geoWatcher.requestPermission();
    if (perm !== 'granted') {
      setError(
        perm === 'denied'
          ? 'Permiso de GPS denegado. Actívalo en los ajustes del navegador.'
          : 'Necesitamos acceso al GPS para saber qué ruta te puede corresponder.',
      );
      setPhase('error');
      return;
    }

    // 2. Get a fix
    const sample = await new Promise<GPSSample>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (p) =>
          resolve({
            ts: p.timestamp,
            lat: p.coords.latitude,
            lng: p.coords.longitude,
            acc: p.coords.accuracy,
            speed: p.coords.speed ?? undefined,
          }),
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
      );
    });
    setPos(sample);

    // 3. Fetch all routes and rank by proximity
    setPhase('searching');
    try {
      const res = await apiFetch<{ routes: Route[] }>('/routes');
      const m = matchRoutesByProximity(
        { lat: sample.lat, lng: sample.lng },
        res.routes,
        { topN: 5, maxRadiusM: 3000 },
      );
      setMatches(m);
      setPhase('suggestions');
    } catch (e) {
      setError(`Error buscando rutas: ${e}`);
      setPhase('error');
    }
  };

  // Auto-start boarding on mount if no permission prompts were triggered yet
  useEffect(() => {
    if (phase !== 'idle') return;
    void beginBoarding();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onConfirm = async (route: Route) => {
    setSelected(route);
    setPhase('starting');
    try {
      // Reuse the trip store to start the trip — it knows how to POST /trips/start
      const tripStore = (await import('@/state/trip')).useTripStore.getState();
      await tripStore.startTrip(route);
      navigate('/trip');
    } catch (e) {
      setError(`Error iniciando el viaje: ${e}`);
      setPhase('error');
    }
  };

  const onRecordNew = () => {
    // User wants to record a new route — go to Record page
    navigate('/record');
  };

  if (phase === 'error') {
    return (
      <div className="page">
        <header className="page-header">
          <h1>Subir a un bus/tren</h1>
        </header>
        <div className="empty">
          <div className="empty-illustration" style={{ background: 'var(--danger)', color: 'white' }}>
            <AlertTriangle size={40} />
          </div>
          <h3>No hemos podido iniciar</h3>
          <p>{error}</p>
          <button type="button" className="btn btn-primary btn-lg" onClick={beginBoarding}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Subir a un bus/tren</h1>
      </header>

      {(phase === 'idle' || phase === 'locating') && (
        <div className="empty">
          <div className="empty-illustration">
            <Navigation size={40} />
          </div>
          <h3>Detectando tu ubicación…</h3>
          <p className="text-sm text-muted">
            Necesitamos tu GPS para buscar rutas que pasen cerca.
          </p>
        </div>
      )}

      {phase === 'searching' && (
        <div className="empty">
          <div className="empty-illustration">
            <MapIcon size={40} />
          </div>
          <h3>Buscando rutas cercanas…</h3>
          <div className="skeleton" style={{ height: 60, marginTop: 16 }} />
          <div className="skeleton" style={{ height: 60, marginTop: 12 }} />
        </div>
      )}

      {phase === 'suggestions' && (
        <>
          <div className="card mb-3" style={{ background: 'var(--brand-50)' }}>
            <div className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
              Detectado cerca de
            </div>
            <div className="text-sm" style={{ fontFamily: 'var(--font-mono)', marginTop: 4 }}>
              {pos?.lat.toFixed(5)}, {pos?.lng.toFixed(5)}
            </div>
          </div>

          {matches.length === 0 ? (
            <div className="card mb-3">
              <div className="card-header">
                <div className="card-title">No hay rutas que coincidan</div>
              </div>
              <p className="text-sm text-muted mb-3">
                No hemos encontrado rutas registradas a menos de 3 km. ¿Es un trayecto nuevo?
              </p>
              <button type="button" className="btn btn-primary btn-block" onClick={onRecordNew}>
                <Plus size={18} /> Grabar esta ruta
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted mb-3">
                ¿Es alguna de estas rutas? Cuanto más cerca, más probable.
              </p>

              <div className="list">
                {matches.map((m) => (
                  <button
                    key={m.route.id}
                    type="button"
                    className="list-item"
                    style={{ textAlign: 'left', width: '100%' }}
                    onClick={() => void onConfirm(m.route)}
                  >
                    <div className="list-item-icon">
                      <Bus size={20} />
                    </div>
                    <div className="list-item-body">
                      <div className="list-item-title">{m.route.name}</div>
                      <div className="list-item-sub">
                        {m.distanceM < 100
                          ? `a ${Math.round(m.distanceM)} m`
                          : m.distanceM < 1000
                            ? `a ${Math.round(m.distanceM)} m`
                            : `a ${(m.distanceM / 1000).toFixed(1)} km`}{' '}
                        · {m.route.stops.length} paradas
                      </div>
                    </div>
                    <ChevronRight size={20} className="text-muted" />
                  </button>
                ))}
              </div>

              <div className="mt-3">
                <button type="button" className="btn btn-block" onClick={onRecordNew}>
                  <Plus size={18} /> Ninguna coincide — grabar nueva
                </button>
              </div>
            </>
          )}

          <div className="mt-3">
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-block"
              onClick={beginBoarding}
            >
              Buscar de nuevo
            </button>
          </div>
        </>
      )}

      {phase === 'starting' && selected && (
        <div className="empty">
          <div className="empty-illustration" style={{ background: 'var(--brand-600)', color: 'white' }}>
            <Check size={40} />
          </div>
          <h3>Subiendo a {selected.name}</h3>
          <p className="text-sm text-muted">Iniciando el viaje…</p>
        </div>
      )}
    </div>
  );
}