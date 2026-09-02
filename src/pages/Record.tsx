import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { LeafletMap } from '@/components/LeafletMap';
import { Record as RecordIcon, Stop, Trash, Bus, Train, Tram } from '@/components/icons';
import { geoWatcher } from '@/geo/watcher';
import { getDB } from '@/storage/db';
import { randomUUID } from '@/crypto';
import { apiFetch } from '@/api/client';
import { useIdentityStore } from '@/state/identity';
import type { GPSSample, Route, Schedule, VehicleKind } from '@/api/types';

type Phase = 'idle' | 'recording' | 'review' | 'saving';

const VEHICLE_OPTIONS: Array<{ key: VehicleKind; label: string; icon: React.ReactNode }> = [
  { key: 'bus', label: 'Bus', icon: <Bus size={20} /> },
  { key: 'train', label: 'Tren', icon: <Train size={20} /> },
  { key: 'tram', label: 'Tram', icon: <Tram size={20} /> },
  { key: 'metro', label: 'Metro', icon: <Train size={20} /> },
  { key: 'other', label: 'Otro', icon: <Bus size={20} /> },
];

export default function RecordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('idle');
  const [samples, setSamples] = useState<GPSSample[]>([]);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [pendingCuts, setPendingCuts] = useState<Array<[number, number]>>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [vehicleKind, setVehicleKind] = useState<VehicleKind>('bus');
  const [direction, setDirection] = useState('');
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [activeDays, setActiveDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [intervalStart, setIntervalStart] = useState('08:00');
  const [saveResult, setSaveResult] = useState<'success' | 'offline' | null>(null);
  const [intervalEnd, setIntervalEnd] = useState('20:00');
  const recordingIdRef = useRef<string | null>(null);
  const listenerCleanupRef = useRef<(() => void) | null>(null);

  const DAY_KEYS = useMemo(() => [
    { key: 1, label: t('record.days.mon') },
    { key: 2, label: t('record.days.tue') },
    { key: 3, label: t('record.days.wed') },
    { key: 4, label: t('record.days.thu') },
    { key: 5, label: t('record.days.fri') },
    { key: 6, label: t('record.days.sat') },
    { key: 0, label: t('record.days.sun') },
  ], [t]);

  // Update trim end whenever samples change
  useEffect(() => {
    setTrimEnd(s => Math.max(s, samples.length - 1));
  }, [samples.length]);

  const startRecording = async () => {
    setError(null);
    let perm = await geoWatcher.checkPermission();
    if (perm !== 'granted') {
      perm = await geoWatcher.requestPermission();
    }
    if (perm !== 'granted') {
      if (perm === 'denied') {
        setError(
          t('record.permissionDenied'),
        );
      } else if (perm === 'error' || !('geolocation' in navigator)) {
        setError(t('record.geoNotSupported'));
      } else {
        setError(t('trip.permissionNeeded'));
      }
      return;
    }
    recordingIdRef.current = randomUUID();
    setSamples([]);
    setTrimStart(0);
    setTrimEnd(0);
    setPendingCuts([]);
    setPhase('recording');
    // De-register any previous listener to avoid duplicates on re-record
    listenerCleanupRef.current?.();
    listenerCleanupRef.current = geoWatcher.on((s) => {
      setSamples((prev) => [...prev, s]);
    });
    geoWatcher.start();
  };

  const stopRecording = () => {
    geoWatcher.stop();
    if (samples.length < 5) {
      setError(t('record.notEnoughSamples'));
      setPhase('idle');
      return;
    }
    setTrimStart(0);
    setTrimEnd(samples.length - 1);
    setPendingCuts([]);
    setPhase('review');
  };

  const effectiveSamples = (() => {
    const out: GPSSample[] = [];
    for (let i = trimStart; i <= trimEnd; i++) {
      if (pendingCuts.some(([a, b]) => i >= a && i <= b)) continue;
      const s = samples[i];
      if (s) out.push(s);
    }
    return out;
  })();

  const detectedStops = (() => {
    const stops: Array<{ id: string; idx: number; name: string; lat: number; lng: number }> = [];
    let clusterStart = 0;
    let clusterMinSpeed = Infinity;
    for (let i = 1; i < effectiveSamples.length; i++) {
      const s = effectiveSamples[i];
      if (!s) continue;
      const speed = s.speed ?? 0;
      if (speed < 1) {
        clusterMinSpeed = Math.min(clusterMinSpeed, speed);
        if (i - clusterStart > 6) {
          const midIdx = Math.floor((clusterStart + i) / 2);
          const mid = effectiveSamples[midIdx];
          if (!mid) continue;
            stops.push({
              id: `stop-${stops.length}`,
              idx: midIdx,
              name: t('record.autoStopName', { n: stops.length + 1 }),
              lat: mid.lat,
              lng: mid.lng,
            });
        }
      } else {
        clusterStart = i;
        clusterMinSpeed = Infinity;
      }
    }
    return stops;
  })();

  const cutAt = (idx: number) => {
    // Find nearest "stop" point (speed ≈ 0) or just any idx
    const newCuts: Array<[number, number]> = [...pendingCuts];
    // Merge with existing cuts if overlap
    const range: [number, number] = [Math.max(trimStart, idx - 1), Math.min(trimEnd, idx + 1)];
    newCuts.push(range);
    setPendingCuts(newCuts);
  };

  const save = async () => {
    if (effectiveSamples.length < 5) {
      setError(t('record.notEnoughAfterTrim'));
      return;
    }
    if (detectedStops.length < 3) {
      setError(t('record.minStops'));
      return;
    }
    if (!title.trim()) {
      setError(t('record.nameRequired'));
      return;
    }
    setPhase('saving');
    setError(null);

    // Persist recording locally
    const db = await getDB();
    const id = recordingIdRef.current!;
    await db.put('recordings', {
      id,
      samples,
      createdAt: Date.now(),
    });

    // Build route
    const polyline: Array<[number, number]> = effectiveSamples.map((s) => [s.lat, s.lng]);
    const route: Route = {
      id: randomUUID(),
      name: title,
      stops: detectedStops.map((s, i) => ({
        id: `s-${i}`,
        name: s.name,
        lat: s.lat,
        lng: s.lng,
      })),
      polyline,
      createdBy: '',
      version: 1,
      active: true,
      createdAt: Date.now(),
      vehicleKind: vehicleKind,
      direction: direction.trim() || undefined,
      schedules: schedules.length > 0 ? schedules : undefined,
    };

    try {
      const idStore = useIdentityStore.getState();
      if (!idStore.identity) throw new Error('Identity unavailable');
      route.createdBy = idStore.identity.pubKey;
      await apiFetch('/routes', { method: 'POST', body: route, signed: true });
      setSaveResult('success');
      navigate(`/routes/${route.id}`);
    } catch {
      setSaveResult('offline');
      navigate('/');
    } finally {
      setPhase('idle');
    }
  };

  const discard = () => {
    setSamples([]);
    setPendingCuts([]);
    setTitle('');
    setError(null);
    setPhase('idle');
  };

  if (phase === 'idle') {
    return (
      <div className="page">
        <header className="page-header">
          <h1>{t('record.start')}</h1>
        </header>

        <div className="empty">
          <div className="empty-illustration">
            <RecordIcon size={48} />
          </div>
          <h3>{t('record.start')}</h3>
          <p className="mb-4">
            {t('record.intro')}
          </p>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              maxWidth: 320,
              margin: '0 auto',
            }}
          >
            <button type="button" className="btn btn-primary btn-lg btn-block" onClick={startRecording}>
              <RecordIcon size={20} /> {t('record.start')}
            </button>
          </div>
          {error && (
            <div className="banner banner-danger mt-3" style={{ textAlign: 'left', maxWidth: 360, margin: '12px auto 0' }}>
              {error}
            </div>
          )}
          {saveResult && (
            <div
              className={`banner ${saveResult === 'success' ? 'banner-success' : 'banner-warning'} mt-3`}
              style={{ textAlign: 'left', maxWidth: 360, margin: '12px auto 0' }}
            >
              {saveResult === 'success' ? t('record.saveSuccess') : t('record.saveOffline')}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'recording') {
    const lastSample = samples[samples.length - 1];
    return (
      <div>
        <div style={{ height: '55vh', position: 'relative' }}>
          <LeafletMap
            routes={[
              {
                id: 'live',
                name: t('record.temporaryName'),
                stops: [],
                polyline: samples.map((s) => [s.lat, s.lng]),
                createdBy: '',
                version: 1,
                active: true,
              },
            ]}
            userPosition={lastSample ? { lat: lastSample.lat, lng: lastSample.lng } : null}
            followUser
          />
          {samples.length === 0 && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                background: 'var(--overlay-strong)',
                zIndex: 500,
                padding: 24,
                textAlign: 'center',
              }}
            >
              <div>
                <div className="empty-illustration" style={{ margin: '0 auto 12px' }}>
                  <RecordIcon size={32} />
                </div>
                <p style={{ fontWeight: 600 }}>{t('record.waitingGps')}</p>
                <p className="text-sm text-muted">
                  {t('record.gpsHint')}
                </p>
              </div>
            </div>
          )}
        </div>
        <div className="page">
          <div className="card" style={{ background: 'var(--danger)', color: 'white' }}>
            <div className="row">
              <RecordIcon size={20} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{t('record.recording')}</div>
                <div style={{ fontSize: 'var(--fs-sm)', opacity: 0.92 }}>
                  {t('record.pointsCount', { n: samples.length, count: samples.length })}
                  {lastSample?.speed != null && t('record.speedSuffix', { v: (lastSample.speed * 3.6).toFixed(0) })}
                </div>
              </div>
              <span className="trip-banner-pulse" aria-hidden />
            </div>
          </div>
          <button type="button" className="btn btn-danger btn-lg btn-block mt-3" onClick={stopRecording}>
            <Stop size={20} /> {t('record.stop')}
          </button>
        </div>
      </div>
    );
  }

  // Review / Save
  return (
    <div>
      <div style={{ height: '50vh' }}>
        <LeafletMap
          routes={[
            {
              id: 'preview',
              name: title || t('record.previewName'),
              stops: detectedStops,
              polyline: effectiveSamples.map((s) => [s.lat, s.lng]),
              createdBy: '',
              version: 1,
              active: true,
            },
          ]}
          showStops
          userPosition={
            effectiveSamples.length
              ? (() => {
                  const last = effectiveSamples[effectiveSamples.length - 1];
                  return last ? { lat: last.lat, lng: last.lng } : null;
                })()
              : null
          }
          onMapClick={(p) => {
            // Tap to cut at nearest sample
            let bestIdx = 0;
            let bestD = Infinity;
            for (let i = 0; i < effectiveSamples.length; i++) {
              const s = effectiveSamples[i];
              if (!s) continue;
              const d = (s.lat - p.lat) ** 2 + (s.lng - p.lng) ** 2;
              if (d < bestD) { bestD = d; bestIdx = i; }
            }
            cutAt(bestIdx);
          }}
        />
      </div>
      <div className="page">
        <h2 className="mb-3">{t('record.review')}</h2>
        <p className="text-sm text-muted mb-3">{t('record.trimTip')}</p>

        <div className="card mb-3">
          <div className="field">
            <label className="field-label">{t('record.title')}</label>
            <input
              className="input"
              placeholder={t('record.titlePlaceholder')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Vehicle kind selector */}
          <div className="field">
            <label className="field-label">{t('record.vehicleType')}</label>
            <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
              {VEHICLE_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`chip ${vehicleKind === opt.key ? 'active' : ''}`}
                  onClick={() => setVehicleKind(opt.key)}
                >
                  {opt.icon}
                  <span style={{ marginLeft: 4 }}>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Direction (optional) */}
          <div className="field">
            <label className="field-label">{t('record.direction')}</label>
            <input
              className="input"
              placeholder={t('record.directionPlaceholder')}
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
            />
          </div>

          {/* Schedule editor */}
          <div className="field">
            <label className="field-label">{t('record.schedule')}</label>
            <div className="row gap-1" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
              {DAY_KEYS.map((d) => {
                const active = activeDays.includes(d.key);
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => setActiveDays((cur) =>
                      cur.includes(d.key) ? cur.filter((x) => x !== d.key) : [...cur, d.key].sort()
                    )}
                    className={`chip ${active ? 'active' : ''}`}
                    style={{ minWidth: 36, justifyContent: 'center' }}
                    aria-pressed={active}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
            <div className="row gap-2" style={{ alignItems: 'center' }}>
              <input
                type="time"
                className="input"
                value={intervalStart}
                onChange={(e) => setIntervalStart(e.target.value)}
                style={{ flex: 1 }}
              />
              <span className="text-muted">–</span>
              <input
                type="time"
                className="input"
                value={intervalEnd}
                onChange={(e) => setIntervalEnd(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  if (!activeDays.length) return;
                  setSchedules((s) => [
                    ...s,
                    { daysOfWeek: activeDays, intervals: [{ start: intervalStart, end: intervalEnd }] },
                  ]);
                }}
              >
                {t('record.add')}
              </button>
            </div>
            {schedules.length > 0 && (
              <div className="mt-2" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {schedules.map((s, i) => (
                  <div key={i} className="row gap-2" style={{ fontSize: 'var(--fs-sm)' }}>
                    <span className="badge badge-info">
                      {s.daysOfWeek.map((d) => DAY_KEYS.find((x) => x.key === d)?.label).join('')} · {s.intervals[0]?.start}–{s.intervals[0]?.end}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ padding: 0, color: 'var(--danger)' }}
                      onClick={() => setSchedules((cur) => cur.filter((_, j) => j !== i))}
                    >
                      {t('record.remove')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="row gap-3 text-sm">
            <div style={{ flex: 1 }}>
              <div className="text-muted">{t('record.trimStart')}</div>
              <input
                type="range"
                min={0}
                max={Math.max(0, samples.length - 1)}
                value={trimStart}
                onChange={(e) => setTrimStart(parseInt(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div className="text-muted">{t('record.trimEnd')}</div>
              <input
                type="range"
                min={0}
                max={Math.max(0, samples.length - 1)}
                value={trimEnd}
                onChange={(e) => setTrimEnd(parseInt(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
          </div>

          <div className="text-sm text-muted mt-2">
            {t('record.recordingSummary', { samples: effectiveSamples.length, cuts: pendingCuts.length, stops: detectedStops.length })}
          </div>

          {pendingCuts.length > 0 && (
            <button
              type="button"
              className="btn btn-sm mt-2"
              onClick={() => setPendingCuts([])}
            >
              <Trash size={14} /> {t('record.clearCuts')}
            </button>
          )}
        </div>

        {error && <div className="banner banner-danger mb-3">{error}</div>}

        <div className="row gap-2">
          <button type="button" className="btn flex-1" onClick={discard}>
            {t('record.discard')}
          </button>
          <button type="button" className="btn btn-primary flex-1" onClick={save} disabled={phase === 'saving'}>
            {phase === 'saving' ? t('common.loading') : t('record.save')}
          </button>
        </div>
      </div>
    </div>
  );
}