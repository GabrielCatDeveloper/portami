import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
          <div className="card-title">{t('stopAlerts.title')}</div>
          <div className="card-subtitle">
            {t('stopAlerts.subtitle')}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? <><X size={14} /> {t('stopAlerts.close')}</> : <><Plus size={14} /> {t('stopAlerts.add')}</>}
        </button>
      </div>

      {adding && (
        <div className="field">
          <label className="field-label">{t('stopAlerts.fieldStop')}</label>
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
          <label className="field-label">{t('stopAlerts.fieldMode')}</label>
          <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`chip ${mode === 'minutes' ? 'active' : ''}`}
              onClick={() => setMode('minutes')}
            >
              ⏱️ {t('stopAlerts.modeMinutes')}
            </button>
            <button
              type="button"
              className={`chip ${mode === 'meters' ? 'active' : ''}`}
              onClick={() => setMode('meters')}
            >
              📏 {t('stopAlerts.modeMeters')}
            </button>
          </div>
        </div>
      )}

      {adding && mode === 'minutes' && (
        <div className="field">
          <label className="field-label">{t('stopAlerts.fieldTrigger')}</label>
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
            <span className="text-sm text-muted">{t('stopAlerts.unitMinutes')}</span>
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
            {t('stopAlerts.adaptive')}
            {minutes <= 1 ? ' ' + t('stopAlerts.hint1') :
             minutes <= 3 ? ' ' + t('stopAlerts.hint2') :
             minutes <= 5 ? ' ' + t('stopAlerts.hint3') :
             ' ' + t('stopAlerts.hint4')}
          </div>
        </div>
      )}

      {adding && mode === 'meters' && (
        <div className="field">
          <label className="field-label">{t('stopAlerts.fieldDistance')}</label>
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
            <span className="text-sm text-muted">{t('stopAlerts.unitMeters')}</span>
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
            {t('stopAlerts.distanceHint')}
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
          {submitting ? t('stopAlerts.saving') : t('stopAlerts.save')}
        </button>
      )}

      {alerts.length === 0 && !adding && (
        <p className="text-sm text-muted mt-2">
          {t('stopAlerts.empty')}
        </p>
      )}

      {alerts.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {alerts.map((a) => {
            const minutes = a.triggerMinutes;
            const meters = a.triggerDistanceM;
            const triggerLabel = minutes != null
              ? t('stopAlerts.triggerMinutes', { n: minutes })
              : meters != null
                ? t('stopAlerts.triggerMeters', { n: meters })
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
                    {t('stopAlerts.notifies', { triggerLabel })}
                    {a.triggered ? t('stopAlerts.firedSuffix') : ''}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void remove(a.id!)}
                  aria-label={t('stopAlerts.delete')}
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