import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Route, Stop } from '@/api/types';
import { Bell, BellOff, Plus, Trash, X } from '@/components/icons';
import {
  addAlert,
  deleteAlert,
  listAlertsForRoute,
  type StopAlert,
} from '@/storage/stopAlerts';

type Props = {
  route: Route;
  /** Live list of alerts (reactive). */
  alerts: StopAlert[];
  /** Force a reload from IndexedDB (e.g. after delete). */
  onChange: () => void;
};

const DEFAULT_DISTANCE_M = 300;

/**
 * Card that lets the user configure per-stop proximity alerts for a
 * route. Stored locally in IndexedDB; never synced to the server.
 */
export function StopAlertsCard({ route, alerts, onChange }: Props) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [stopId, setStopId] = useState<string>(route.stops[0]?.id ?? '');
  const [distance, setDistance] = useState<number>(DEFAULT_DISTANCE_M);
  const [submitting, setSubmitting] = useState(false);

  if (route.stops.length === 0) return null;

  const add = async () => {
    if (!stopId) return;
    const stop = route.stops.find((s) => s.id === stopId);
    if (!stop) return;
    setSubmitting(true);
    try {
      await addAlert({
        tripRouteId: route.id,
        stopId,
        stopName: stop.name,
        triggerDistanceM: distance,
      });
      onChange();
      setAdding(false);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: number) => {
    await deleteAlert(id);
    onChange();
  };

  return (
    <section className="card mb-3">
      <div className="card-header">
        <div className="list-item-icon" style={{ background: 'var(--accent-500)', color: 'white' }}>
          <Bell size={20} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="card-title">Alertas de parada</div>
          <div className="card-subtitle">Te avisaremos fuerte (vibración + sonido) cuando estés cerca.</div>
        </div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? <><X size={14} /> Cerrar</> : <><Plus size={14} /> Añadir</>}
        </button>
      </div>

      {adding && (
        <div className="field">
          <label className="field-label">Parada</label>
          <select
            className="select"
            value={stopId}
            onChange={(e) => setStopId(e.target.value)}
          >
            {route.stops.map((s, i) => (
              <option key={s.id} value={s.id}>
                {i + 1}. {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {adding && (
        <div className="field">
          <label className="field-label">Avísame cuando esté a</label>
          <div className="row gap-2" style={{ alignItems: 'center' }}>
            <input
              type="number"
              min={50}
              max={2000}
              step={50}
              value={distance}
              onChange={(e) => setDistance(parseInt(e.target.value || '300', 10))}
              className="input"
              style={{ flex: 1 }}
            />
            <span className="text-sm text-muted">m</span>
            <input
              type="range"
              min={50}
              max={2000}
              step={50}
              value={distance}
              onChange={(e) => setDistance(parseInt(e.target.value, 10))}
              style={{ flex: 2 }}
            />
          </div>
          <div className="field-hint">
            {distance < 200 ? 'Muy pronto — para paradas muy próximas o conducción lenta' :
             distance < 500 ? 'Recomendado para bus/tren' :
             distance < 1000 ? 'Para no perderte la parada aunque vayas atento al móvil' :
             'Te avisa con bastante antelación'}
          </div>
        </div>
      )}

      {adding && (
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => void add()}
          disabled={submitting || !stopId}
        >
          {submitting ? 'Guardando…' : 'Guardar alerta'}
        </button>
      )}

      {alerts.length === 0 && !adding && (
        <p className="text-sm text-muted mt-2">
          Ninguna alerta configurada. Añade una para que te avisemos al acercarte a una parada.
        </p>
      )}

      {alerts.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {alerts.map((a) => (
            <li
              key={a.id}
              className="row gap-2"
              style={{
                padding: '8px 10px',
                background: a.triggered ? 'var(--brand-50)' : 'var(--bg-subtle)',
                borderRadius: 'var(--r-md)',
                alignItems: 'center',
                opacity: a.triggered ? 0.7 : 1,
              }}
            >
              <Bell size={16} className={a.triggered ? 'text-muted' : ''} style={{ color: a.triggered ? 'var(--text-muted)' : 'var(--brand-600)' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{a.stopName}</div>
                <div className="text-xs text-muted">
                  Avisa a {a.triggerDistanceM} m
                  {a.triggered ? ' · Disparada ✓' : ''}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void remove(a.id!)}
                aria-label="Eliminar alerta"
                style={{ padding: 0 }}
              >
                <Trash size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}