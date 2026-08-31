import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { planJourney } from '@/api/journey';
import { useTripStore } from '@/state/trip';
import { geoWatcher } from '@/geo/watcher';
import { LeafletMap } from '@/components/LeafletMap';
import {
  Map as MapIcon,
  AlertTriangle,
  Check,
  Clock,
  PersonStanding,
  Bus,
  Plus,
  Play,
} from '@/components/icons';
import { formatDistance } from '@/geo/distance';
import type { Journey, JourneyStep, LatLng, VehicleKind, Route } from '@/api/types';

type Phase = 'idle' | 'locating' | 'planning' | 'results' | 'error';

const VEHICLE_FILTERS: Array<{ key: VehicleKind | 'all'; label: string; emoji: string }> = [
  { key: 'all', label: 'Todo', emoji: '🚌' },
  { key: 'bus', label: 'Bus', emoji: '🚌' },
  { key: 'train', label: 'Tren', emoji: '🚆' },
  { key: 'tram', label: 'Tram', emoji: '🚊' },
  { key: 'metro', label: 'Metro', emoji: '🚇' },
];

export default function JourneyPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('idle');
  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [destination, setDestination] = useState<LatLng | null>(null);
  const [results, setResults] = useState<Journey[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [vehicleFilter, setVehicleFilter] = useState<VehicleKind | 'all'>('all');
  const [avoidRunning, setAvoidRunning] = useState(true);
  const [maxBoardings, setMaxBoardings] = useState(3);

  const locateMe = async () => {
    setPhase('locating');
    setError(null);
    try {
      const sample = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10_000,
        });
      });
      setOrigin({ lat: sample.coords.latitude, lng: sample.coords.longitude });
    } catch (e) {
      setError('No hemos podido obtener tu ubicación. Configúrala manualmente.');
    } finally {
      setPhase('idle');
    }
  };

  const plan = async () => {
    if (!origin || !destination) return;
    setPhase('planning');
    setError(null);
    try {
      const res = await planJourney({
        from: origin,
        to: destination,
        maxWalkSpeedMs: avoidRunning ? 1.4 : 3.0,
        maxBoardings,
        vehicleKinds: vehicleFilter === 'all' ? undefined : [vehicleFilter],
      });
      setResults(res.journeys);
      setPhase('results');
    } catch (e) {
      setError(`Error: ${e instanceof Error ? e.message : e}`);
      setPhase('error');
    }
  };

  if (phase === 'locating' || phase === 'planning') {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty-illustration">
            <MapIcon size={40} />
          </div>
          <h3>{phase === 'locating' ? 'Detectando ubicación…' : 'Calculando rutas…'}</h3>
          <p className="text-sm text-muted">Esto puede tardar unos segundos.</p>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty-illustration" style={{ background: 'var(--danger)', color: 'white' }}>
            <AlertTriangle size={40} />
          </div>
          <h3>Error</h3>
          <p>{error}</p>
          <button type="button" className="btn btn-primary" onClick={() => setPhase('idle')}>
            Volver
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'results' && results.length === 0) {
    return (
      <div className="page">
        <header className="page-header">
          <h1>Cómo llegar</h1>
        </header>
        <div className="empty">
          <div className="empty-illustration">
            <AlertTriangle size={40} />
          </div>
          <h3>No hemos encontrado rutas</h3>
          <p>No hay combinaciones de bus/tren que conecten tu origen con tu destino en este horario.</p>
          <button type="button" className="btn btn-primary" onClick={() => setPhase('idle')}>
            Probar de nuevo
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'results' && results.length > 0) {
    return (
      <div className="page">
        <header className="page-header">
          <h1>Cómo llegar</h1>
          <button type="button" className="btn btn-sm" onClick={() => setPhase('idle')}>
            Nueva búsqueda
          </button>
        </header>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {results.map((j, i) => <JourneyCard key={i} journey={j} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Cómo llegar</h1>
      </header>

      <p className="text-muted mb-4">
        Te diremos cómo ir de un punto a otro combinando bus y tren, ordenado por transbordos.
      </p>

      <section className="card mb-3">
        <div className="card-title mb-2">Origen</div>
        <div className="row gap-2" style={{ alignItems: 'center' }}>
          <button type="button" className="btn" onClick={() => void locateMe()}>
            <MapIcon size={14} /> Usar mi ubicación
          </button>
          <span className="text-xs text-muted">o</span>
          <input
            className="input"
            placeholder="lat, lng (ej: 40.417, -3.703)"
            onChange={(e) => {
              const [lat, lng] = e.target.value.split(',').map((s) => parseFloat(s.trim()));
              if (!isNaN(lat) && !isNaN(lng)) setOrigin({ lat, lng });
            }}
          />
        </div>
        {origin && (
          <div className="text-xs text-muted mt-2">
            Origen: {origin.lat.toFixed(4)}, {origin.lng.toFixed(4)}
          </div>
        )}
      </section>

      <section className="card mb-3">
        <div className="card-title mb-2">Destino</div>
        <input
          className="input"
          placeholder="lat, lng (ej: 40.493, -3.567)"
          onChange={(e) => {
            const [lat, lng] = e.target.value.split(',').map((s) => parseFloat(s.trim()));
            if (!isNaN(lat) && !isNaN(lng)) setDestination({ lat, lng });
          }}
        />
        {destination && (
          <div className="text-xs text-muted mt-2">
            Destino: {destination.lat.toFixed(4)}, {destination.lng.toFixed(4)}
          </div>
        )}
      </section>

      <section className="card mb-3">
        <div className="card-title mb-2">Filtros</div>
        <div className="row gap-2" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
          {VEHICLE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`chip ${vehicleFilter === f.key ? 'active' : ''}`}
              onClick={() => setVehicleFilter(f.key as any)}
            >
              <span style={{ marginRight: 4 }}>{f.emoji}</span>
              {f.label}
            </button>
          ))}
        </div>
        <label className="row gap-2" style={{ alignItems: 'center', fontSize: 'var(--fs-sm)' }}>
          <input
            type="checkbox"
            checked={avoidRunning}
            onChange={(e) => setAvoidRunning(e.target.checked)}
          />
          <span>Evitar que tenga que correr entre transbordos</span>
        </label>
        <div className="row gap-2" style={{ alignItems: 'center', fontSize: 'var(--fs-sm)', marginTop: 8 }}>
          <span>Máx. transbordos:</span>
          <input
            type="number"
            min={1}
            max={5}
            value={maxBoardings}
            onChange={(e) => setMaxBoardings(parseInt(e.target.value || '3', 10))}
            className="input"
            style={{ width: 80 }}
          />
        </div>
      </section>

      <button
        type="button"
        className="btn btn-primary btn-lg btn-block"
        disabled={!origin || !destination}
        onClick={() => void plan()}
      >
        <Check size={18} /> Buscar ruta
      </button>
    </div>
  );
}

function JourneyCard({ journey }: { journey: Journey }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const startTrip = useTripStore((s) => s.startTrip);
  const minutes = Math.round(journey.totalDurationS / 60);
  const transfers = Math.max(0, journey.boardings - 1);
  const walkSpeed = journey.maxRequiredWalkSpeedMs;
  const walkKind = walkSpeed <= 1.5 ? 'stroll' : walkSpeed <= 2.4 ? 'brisk' : 'running';
  const walkLabel = walkKind === 'stroll' ? '🥾 Tranquilo' :
                   walkKind === 'brisk' ? '🚶 Rápido' :
                   '🏃 ¡A correr!';

  // First ride step defines the route the user will start on
  const firstRide = journey.steps.find((s) => s.kind === 'ride') as Extract<JourneyStep, { kind: 'ride' }> | undefined;

  const handleStart = async () => {
    if (!firstRide) return;
    const syntheticRoute: Route = {
      id: firstRide.routeId,
      name: firstRide.routeName,
      stops: journey.steps
        .filter((s) => s.kind === 'ride')
        .flatMap((s) => (s.kind === 'ride' ? [s.fromStopId, s.toStopId] : []))
        .map((id) => ({ id, name: id, lat: 0, lng: 0 })),
      polyline: [],
      createdBy: 'journey-planner',
      version: 1,
      active: true,
    };
    await startTrip(syntheticRoute, { plannedRoute: journey });
    navigate('/trip');
  };

  return (
    <article className="card">
      <div className="row gap-2 mb-2" style={{ alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700 }}>{minutes} min</div>
          <div className="text-sm text-muted">
            {journey.boardings} viaje{journey.boardings > 1 ? 's' : ''} · {transfers === 0 ? 'sin transbordos' : `${transfers} transbordo${transfers > 1 ? 's' : ''}`} · {formatDistance(journey.totalWalkM)} andando
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">Llega a las</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
            {new Date(journey.arriveByUtc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>

      {walkKind !== 'stroll' && (
        <div className={`banner ${walkKind === 'running' ? 'banner-danger' : 'banner-warning'} mb-2 text-sm`}>
          <PersonStanding size={16} />
          <span>Vas a tener que {walkKind === 'running' ? 'correr' : 'caminar rápido'}: {walkLabel}</span>
        </div>
      )}

      <button
        type="button"
        className="btn btn-block"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? 'Ocultar pasos' : 'Ver pasos'}
      </button>

      {firstRide && (
        <button
          type="button"
          className="btn btn-primary btn-block mt-2"
          onClick={() => void handleStart()}
        >
          <Play size={16} /> Iniciar este viaje
        </button>
      )}

      {expanded && (
        <ol style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {journey.steps.map((s, i) => <StepRow key={i} step={s} />)}
        </ol>
      )}
    </article>
  );
}

function StepRow({ step }: { step: JourneyStep }) {
  if (step.kind === 'walk') {
    return (
      <li className="row gap-2" style={{ alignItems: 'center' }}>
        <div className="list-item-icon" style={{ background: 'var(--bg-subtle)' }}>
          <PersonStanding size={16} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="text-sm">Camina {formatDistance(step.distanceM)}</div>
          <div className="text-xs text-muted">≈ {Math.round(step.durationS / 60)} min</div>
        </div>
      </li>
    );
  }
  return (
    <li className="row gap-2" style={{ alignItems: 'center' }}>
      <div className="list-item-icon" style={{ background: 'var(--brand-600)', color: 'white' }}>
        <Bus size={16} />
      </div>
      <div style={{ flex: 1 }}>
        <div className="text-sm" style={{ fontWeight: 600 }}>{step.routeName}</div>
        <div className="text-xs text-muted">
          {step.fromStopName} → {step.toStopName} · {formatDistance(step.rideDistanceM)}
        </div>
      </div>
    </li>
  );
}