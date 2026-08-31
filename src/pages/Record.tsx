import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { LeafletMap } from '@/components/LeafletMap';
import { Record as RecordIcon, Stop, Trash } from '@/components/icons';
import { geoWatcher } from '@/geo/watcher';
import { getDB } from '@/storage/db';
import { randomUUID } from '@/crypto';
import { apiFetch } from '@/api/client';
import { useIdentityStore } from '@/state/identity';
import type { GPSSample, Route } from '@/api/types';

type Phase = 'idle' | 'recording' | 'review' | 'saving';

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
  const recordingIdRef = useRef<string | null>(null);
  const listenerCleanupRef = useRef<(() => void) | null>(null);
  const demoTimerRef = useRef<number | null>(null);

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
          'Permiso de GPS denegado. Actívalo en los ajustes del navegador y vuelve a intentarlo.',
        );
      } else if (perm === 'error' || !('geolocation' in navigator)) {
        setError('Tu navegador no soporta geolocalización. Usa un navegador moderno o prueba el modo demo.');
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

  const startDemoRecording = () => {
    setError(null);
    recordingIdRef.current = randomUUID();
    setSamples([]);
    setTrimStart(0);
    setTrimEnd(0);
    setPendingCuts([]);
    setPhase('recording');
    // Simulate ~80 samples walking from Puerta del Sol to Atocha (Madrid)
    // over a fake 4-minute trip, with a couple of stops.
    const stops: Array<[number, number, number]> = [
      // [lat, lng, duration in samples]
      [40.4170, -3.7035, 6], // Plaza Mayor — stop 1
      [40.4120, -3.6940, 12], // moving
      [40.4080, -3.6910, 8], // Atocha area — stop 2
    ];
    let i = 0;
    const base = Date.now();
    const totalSamples = 80;
    demoTimerRef.current = window.setInterval(() => {
      if (i >= totalSamples) {
        if (demoTimerRef.current) window.clearInterval(demoTimerRef.current);
        demoTimerRef.current = null;
        return;
      }
      // Interpolate along a noisy path
      const phase = i / totalSamples;
      const lat = 40.4170 + (40.4080 - 40.4170) * phase + (Math.random() - 0.5) * 0.0005;
      const lng = -3.7035 + (-3.6910 - -3.7035) * phase + (Math.random() - 0.5) * 0.0005;
      // Add a "stop" every 12 samples
      const speed = i % 12 < 6 ? 0.2 : 4.5;
      const sample: GPSSample = {
        ts: base + i * 3000,
        lat,
        lng,
        acc: 8 + Math.random() * 5,
        speed,
      };
      setSamples((prev) => [...prev, sample]);
      i++;
    }, 200);
  };

  const stopRecording = () => {
    geoWatcher.stop();
    if (demoTimerRef.current) {
      window.clearInterval(demoTimerRef.current);
      demoTimerRef.current = null;
    }
    if (samples.length < 5) {
      setError('Necesitamos más muestras para formar una ruta');
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
      out.push(samples[i]);
    }
    return out;
  })();

  const detectedStops = (() => {
    const stops: Array<{ id: string; idx: number; name: string; lat: number; lng: number }> = [];
    let clusterStart = 0;
    let clusterMinSpeed = Infinity;
    for (let i = 1; i < effectiveSamples.length; i++) {
      const s = effectiveSamples[i];
      const speed = s.speed ?? 0;
      if (speed < 1) {
        clusterMinSpeed = Math.min(clusterMinSpeed, speed);
        if (i - clusterStart > 6) {
          const mid = effectiveSamples[Math.floor((clusterStart + i) / 2)];
          stops.push({
            id: `stop-${stops.length}`,
            idx: Math.floor((clusterStart + i) / 2),
            name: `Parada ${stops.length + 1}`,
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
      setError('Muy pocos puntos después de recortar');
      return;
    }
    if (detectedStops.length < 3) {
      setError(t('record.minStops'));
      return;
    }
    if (!title.trim()) {
      setError('Introduce un nombre para la ruta');
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
    };

    try {
      const idStore = useIdentityStore.getState();
      route.createdBy = idStore.identity!.pubKey;
      await apiFetch('/routes', { method: 'POST', body: route, signed: true });
      alert(t('record.saveSuccess'));
      navigate(`/routes/${route.id}`);
    } catch {
      alert(t('record.saveOffline'));
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
            Graba un trayecto real en bus o tren. Al finalizar podrás revisar la ruta, eliminar tramos y nombrarla antes de guardarla.
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
            <button
              type="button"
              className="btn btn-block"
              onClick={startDemoRecording}
              title="Genera una grabación de prueba sin usar el GPS real"
            >
              Modo demo (sin GPS)
            </button>
          </div>
          {error && (
            <div className="banner banner-danger mt-3" style={{ textAlign: 'left', maxWidth: 360, margin: '12px auto 0' }}>
              {error}
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
                name: 'Grabación',
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
                <p style={{ fontWeight: 600 }}>Esperando GPS…</p>
                <p className="text-sm text-muted">
                  Sal a la calle o acércate a una ventana. La primera señal puede tardar unos segundos.
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
                <div style={{ fontWeight: 600 }}>Grabando</div>
                <div style={{ fontSize: 'var(--fs-sm)', opacity: 0.92 }}>
                  {samples.length} puntos
                  {lastSample?.speed != null && ` · ${(lastSample.speed * 3.6).toFixed(0)} km/h`}
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
              name: title || 'Vista previa',
              stops: detectedStops,
              polyline: effectiveSamples.map((s) => [s.lat, s.lng]),
              createdBy: '',
              version: 1,
              active: true,
            },
          ]}
          showStops
          userPosition={effectiveSamples.length ? { lat: effectiveSamples[effectiveSamples.length - 1].lat, lng: effectiveSamples[effectiveSamples.length - 1].lng } : null}
          onMapClick={(p) => {
            // Tap to cut at nearest sample
            let bestIdx = 0;
            let bestD = Infinity;
            for (let i = 0; i < effectiveSamples.length; i++) {
              const d = (effectiveSamples[i].lat - p.lat) ** 2 + (effectiveSamples[i].lng - p.lng) ** 2;
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

          <div className="row gap-3 text-sm">
            <div style={{ flex: 1 }}>
              <div className="text-muted">Inicio</div>
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
              <div className="text-muted">Fin</div>
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
            {effectiveSamples.length} puntos efectivos · {pendingCuts.length} cortes · {detectedStops.length} paradas detectadas
          </div>

          {pendingCuts.length > 0 && (
            <button
              type="button"
              className="btn btn-sm mt-2"
              onClick={() => setPendingCuts([])}
            >
              <Trash size={14} /> Limpiar cortes
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