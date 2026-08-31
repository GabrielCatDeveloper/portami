import { useEffect, useRef, useState } from 'react';
import type { Route, StopRequestInfo, BusReport } from '@/api/types';
import { Bell, Plus, Camera, Edit, X, Check } from '@/components/icons';
import { updateStopRequest } from '@/api/stopRequest';
import { listBusReports, addBusReport } from '@/api/busReports';
import { useIdentityStore } from '@/state/identity';

type Props = {
  route: Route;
  onRouteChange: (r: Route) => void;
};

const STOP_TYPES: Array<{ key: StopRequestInfo['type']; label: string; emoji: string; hint: string }> = [
  { key: 'button', label: 'Botón', emoji: '🔘', hint: 'El bus tiene un botón para pedir parada' },
  { key: 'shout', label: 'Voz', emoji: '🗣️', hint: 'Hay que decirle al conductor' },
  { key: 'app', label: 'App', emoji: '📱', hint: 'El operador tiene una app para pedir parada' },
  { key: 'unknown', label: 'No sé', emoji: '❓', hint: 'No estoy seguro, todavía no he cogido este bus' },
];

/**
 * Stop-request info + bus reports for one route.
 * Renders two stacked sections inside the RouteDetail page.
 */
export function StopRequestSection({ route, onRouteChange }: Props) {
  const anonId = useIdentityStore((s) => s.anonId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<StopRequestInfo | null>(null);
  const [busReports, setBusReports] = useState<BusReport[]>([]);
  const [showAddReport, setShowAddReport] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!route) return;
    let cancelled = false;
    void listBusReports(route.id, 10).then((r) => {
      if (!cancelled) setBusReports(r);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
    // We intentionally depend on route.id only — re-fetching when
    // other route fields change would be wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.id]);

  const startEdit = () => {
    setDraft(route.stopRequest ?? { type: 'unknown' });
    setEditing(true);
  };

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f || !draft) return;
    const reader = new FileReader();
    reader.onload = () => {
      setDraft({ ...draft, buttonPhotoUrl: reader.result as string });
    };
    reader.readAsDataURL(f);
  };

  const save = async () => {
    if (!draft) return;
    const updated = await updateStopRequest(route.id, draft);
    setEditing(false);
    if (updated) {
      onRouteChange({ ...route, stopRequest: updated });
    }
  };

  const submitReport = async (report: Omit<BusReport, 'id' | 'observedAt'>) => {
    await addBusReport(report);
    setShowAddReport(false);
    const list = await listBusReports(route.id, 10);
    setBusReports(list);
  };

  return (
    <>
      {/* ====== Stop request section ====== */}
      <section className="card mb-3">
        <div className="card-header">
          <div className="list-item-icon"><Bell size={20} /></div>
          <div style={{ flex: 1 }}>
            <div className="card-title">Cómo pedir parada</div>
            <div className="card-subtitle">
              {(() => {
                if (!route.stopRequest) return 'Aún no hay info. Si coges este bus, cuéntanos cómo se pide parada.';
                const sr = route.stopRequest;
                const label = STOP_TYPES.find((t) => t.key === sr.type)?.label ?? sr.type;
                return <>Actualizado hace tiempo · {label}</>;
              })()}
            </div>
          </div>
          <button type="button" className="btn btn-sm" onClick={startEdit}>
            <Edit size={14} /> Editar
          </button>
        </div>

        {route.stopRequest && !editing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="row gap-2" style={{ alignItems: 'center' }}>
              <span style={{ fontSize: 28 }}>{STOP_TYPES.find((t) => t.key === route.stopRequest!.type)?.emoji}</span>
              <div>
                <div style={{ fontWeight: 600 }}>{STOP_TYPES.find((t) => t.key === route.stopRequest!.type)?.label}</div>
                <div className="text-xs text-muted">{STOP_TYPES.find((t) => t.key === route.stopRequest!.type)?.hint}</div>
              </div>
            </div>
            {route.stopRequest.notes && (
              <p className="text-sm" style={{ background: 'var(--bg-subtle)', padding: 8, borderRadius: 8 }}>
                {route.stopRequest.notes}
              </p>
            )}
            {route.stopRequest.buttonPhotoUrl && (
              <img
                src={route.stopRequest.buttonPhotoUrl}
                alt="Botón de parada"
                style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 8 }}
              />
            )}
            {route.stopRequest.confirmations != null && route.stopRequest.confirmations > 0 && (
              <div className="text-xs text-muted">
                <Check size={12} /> Confirmado por {route.stopRequest.confirmations} persona(s)
              </div>
            )}
          </div>
        )}

        {editing && draft && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="field">
              <label className="field-label">Tipo</label>
              <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
                {STOP_TYPES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={`chip ${draft.type === t.key ? 'active' : ''}`}
                    onClick={() => setDraft({ ...draft, type: t.key })}
                  >
                    <span style={{ marginRight: 4 }}>{t.emoji}</span>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label className="field-label">Notas (opcional)</label>
              <textarea
                className="textarea"
                placeholder='Ej: "El botón está junto a la puerta trasera, marcado en rojo"'
                value={draft.notes ?? ''}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field-label">Foto del botón (opcional)</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhoto}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                className="btn"
                onClick={() => fileInputRef.current?.click()}
              >
                <Camera size={14} /> {draft.buttonPhotoUrl ? 'Cambiar foto' : 'Añadir foto'}
              </button>
              {draft.buttonPhotoUrl && (
                <img
                  src={draft.buttonPhotoUrl}
                  alt="Previsualización"
                  style={{ maxWidth: 120, maxHeight: 120, borderRadius: 8, marginTop: 8 }}
                />
              )}
            </div>
            <div className="row gap-2">
              <button type="button" className="btn btn-primary flex-1" onClick={() => void save()}>
                Guardar
              </button>
              <button type="button" className="btn" onClick={() => setEditing(false)}>
                <X size={14} /> Cancelar
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ====== Bus reports section ====== */}
      <section className="card mb-3">
        <div className="card-header">
          <div className="card-title">🚌 Buses vistos en esta ruta</div>
          <button type="button" className="btn btn-sm" onClick={() => setShowAddReport((v) => !v)}>
            {showAddReport ? <><X size={14} /> Cancelar</> : <><Plus size={14} /> Reportar</>}
          </button>
        </div>
        <div className="text-sm text-muted mb-2">
          Los buses cambian con frecuencia. Si coges uno, anota la matrícula — ayuda al siguiente viajero.
        </div>

        {showAddReport && (
          <NewBusReportForm
            routeId={route.id}
            anonId={anonId ?? 'unknown'}
            onSubmit={submitReport}
            onCancel={() => setShowAddReport(false)}
          />
        )}

        {busReports.length === 0 && !showAddReport && (
          <p className="text-sm text-muted">Sin reportes aún.</p>
        )}

        {busReports.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {busReports.map((r) => (
              <li
                key={r.id}
                className="row gap-2"
                style={{
                  padding: '8px 10px',
                  background: 'var(--bg-subtle)',
                  borderRadius: 'var(--r-md)',
                  alignItems: 'flex-start',
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    {r.plate}
                    {r.hasStopButton === true && <span className="badge badge-success" style={{ marginLeft: 8 }}>con botón</span>}
                    {r.hasStopButton === false && <span className="badge badge-warning" style={{ marginLeft: 8 }}>sin botón</span>}
                  </div>
                  <div className="text-xs text-muted">
                    Hace {timeAgo(r.observedAt)} · por #{r.reportedBy.slice(0, 6)}
                  </div>
                  {r.notes && <div className="text-sm mt-1">{r.notes}</div>}
                </div>
                {r.buttonPhotoUrl && (
                  <img
                    src={r.buttonPhotoUrl}
                    alt="Botón"
                    style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6 }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h`;
  return `${Math.floor(sec / 86400)} d`;
}

function NewBusReportForm({
  routeId,
  anonId,
  onSubmit,
  onCancel,
}: {
  routeId: string;
  anonId: string;
  onSubmit: (r: Omit<BusReport, 'id' | 'observedAt'>) => Promise<void>;
  onCancel: () => void;
}) {
  const [plate, setPlate] = useState('');
  const [hasButton, setHasButton] = useState<'yes' | 'no' | 'unknown'>('unknown');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result as string);
    reader.readAsDataURL(f);
  };

  const submit = async () => {
    if (!plate.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        routeId,
        plate: plate.trim(),
        hasStopButton: hasButton === 'yes' ? true : hasButton === 'no' ? false : undefined,
        buttonPhotoUrl: photo ?? undefined,
        notes: notes.trim() || undefined,
        reportedBy: anonId,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card mb-2" style={{ background: 'var(--brand-50)', border: '1px solid var(--brand-200)' }}>
      <div className="field">
        <label className="field-label">Matrícula o número de flota</label>
        <input
          className="input"
          placeholder="Ej: 1234-ABC"
          value={plate}
          onChange={(e) => setPlate(e.target.value.toUpperCase())}
        />
      </div>
      <div className="field">
        <label className="field-label">¿Tenía botón de parada?</label>
        <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
          <button type="button" className={`chip ${hasButton === 'yes' ? 'active' : ''}`} onClick={() => setHasButton('yes')}>
            ✅ Sí
          </button>
          <button type="button" className={`chip ${hasButton === 'no' ? 'active' : ''}`} onClick={() => setHasButton('no')}>
            ❌ No
          </button>
          <button type="button" className={`chip ${hasButton === 'unknown' ? 'active' : ''}`} onClick={() => setHasButton('unknown')}>
            ❓ No sé
          </button>
        </div>
      </div>
      <div className="field">
        <label className="field-label">Notas (opcional)</label>
        <textarea
          className="textarea"
          placeholder='Ej: "Botón junto a la puerta trasera"'
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label">Foto del botón (opcional)</label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handlePhoto}
          style={{ display: 'none' }}
        />
        <button type="button" className="btn" onClick={() => fileInputRef.current?.click()}>
          <Camera size={14} /> {photo ? 'Cambiar foto' : 'Añadir foto'}
        </button>
        {photo && (
          <img
            src={photo}
            alt="Previsualización"
            style={{ maxWidth: 120, maxHeight: 120, borderRadius: 8, marginTop: 8 }}
          />
        )}
      </div>
      <div className="row gap-2">
        <button type="button" className="btn btn-primary flex-1" onClick={() => void submit()} disabled={!plate.trim() || submitting}>
          {submitting ? 'Enviando…' : 'Reportar bus'}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          <X size={14} /> Cancelar
        </button>
      </div>
    </div>
  );
}
