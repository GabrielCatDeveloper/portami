import { useState } from 'react';
import type { Route } from '@/api/types';
import { Bell, Plus, Trash, X } from '@/components/icons';
import {
  addAlert,
  deleteAlert,
  type StopAlert,
} from '@/storage/stopAlerts';

type Props = {
  route: Route;
  /** Live list of alerts (reactive). */
  alerts: StopAlert[];
  /** Force a reload from IndexedDB (e.g. after delete). */
  onChange: () => void;
};

type Mode = 'minutes' | 'meters';

const DEFAULT_MINUTES = 1;
const DEFAULT_METERS = 300;

/**
 * Card that lets the user configure per-stop proximity alerts.
 * Two trigger modes:
 *   - "Avísame X minutos antes" (default, time-based, adapts to traffic)
 *   - "Avísame a X metros" (distance-based, useful when speed is unknown)
 *
 * Stored locally in IndexedDB. Never synced to the server.
 */
export function StopAlertsCard({ route, alerts, onChange }: Props) {
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<Mode>('minutes');
  const [stopId, setStopId] = useState<string>(route.stops[0]?.id ?? '');
  const [minutes, setMinutes] = useState<number>(DEFAULT_MINUTES);
  const [meters, setMeters] = useState<number>(DEFAULT_METERS);
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
        ...(mode === 'minutes' ? { triggerMinutes: minutes } : { triggerDistanceM: meters }),
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

  // Compute the current distance for the hint (only when the trip is active)
  // (no live GPS here — we'd need to pass the last sample in. We just
  // show the slider with semantic hints.)

  return (
    <section className="card mb-3">
      <div className="card-header">
        <div className="list-item-icon" style={{ background: 'var(--accent-500)', color: 'white' }}>
          <Bell size={20} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="card-title">Alertas de parada</div>
          <div className="card-subtitle">
            Vibración + sonido fuerte cuando estés cerca. Se adapta al tráfico.
          </div>
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
          <label className="field-label">Modo de aviso</label>
          <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`chip ${mode === 'minutes' ? 'active' : ''}`}
              onClick={() => setMode('minutes')}
            >
              ⏱️ Minutos antes
            </button>
            <button
              type="button"
              className={`chip ${mode === 'meters' ? 'active' : ''}`}
              onClick={() => setMode('meters')}
            >
              📏 A X metros
            </button>
          </div>
        </div>
      )}

      {adding && mode === 'minutes' && (
        <div className="field">
          <label className="field-label">Avísame con</label>
          <div className="row gap-2" style={{ alignItems: 'center' }}>
            <input
              type="number"
              min={1}
              max={30}
              step={0.5}
              value={minutes}
              onChange={(e) => setMinutes(parseFloat(e.target.value || '1'))}
              className="input"
              style={{ flex: 1 }}
            />
            <span className="text-sm text-muted">min de anticipación</span>
            <input
              type="range"
              min={0.5}
              max={10}
              step={0.5}
              value={minutes}
              onChange={(e) => setMinutes(parseFloat(e.target.value))}
              style={{ flex: 2 }}
            />
          </div>
          <div className="field-hint">
            Se adapta a la velocidad: con atasco suena más cerca; rápido, antes.
            {minutes <= 1 ? ' Aviso casi al llegar (≈ 100–300 m en bus urbano).' :
             minutes <= 3 ? ' Recomendado para trayectos cortos.' :
             minutes <= 5 ? ' Útil si vas despistado o leyendo.' :
             ' Mucha antelación — puede que ya te hayas enterado antes.'}
          </div>
        </div>
      )}

      {adding && mode === 'meters' && (
        <div className="field">
          <label className="field-label">Avísame a</label>
          <div className="row gap-2" style={{ alignItems: 'center' }}>
            <input
              type="number"
              min={50}
              max={2000}
              step={50}
              value={meters}
              onChange={(e) => setMeters(parseInt(e.target.value || '300', 10))}
              className="input"
              style={{ flex: 1 }}
            />
            <span className="text-sm text-muted">m</span>
            <input
              type="range"
              min={50}
              max={2000}
              step={50}
              value={meters}
              onChange={(e) => setMeters(parseInt(e.target.value, 10))}
              style={{ flex: 2 }}
            />
          </div>
          <div className="field-hint">
            Distancia fija. Útil si la app no recibe tu velocidad (GPS parado).
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
          {alerts.map((a) => {
            const minutes = a.triggerMinutes;
            const meters = a.triggerDistanceM;
            const triggerLabel = minutes != null
              ? `${minutes} min antes`
              : meters != null
                ? `a ${meters} m`
                : '?';
            return (
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
                <Bell size={16} style={{ color: a.triggered ? 'var(--text-muted)' : 'var(--brand-600)' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{a.stopName}</div>
                  <div className="text-xs text-muted">
                    Avisa {triggerLabel}
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
            );
          })}
        </ul>
      )}
    </section>
  );
}