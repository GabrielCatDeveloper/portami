import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { planJourney } from '@/api/journey';
import { useTripStore } from '@/state/trip';
import {
  Map as MapIcon,
  AlertTriangle,
  Check,
  PersonStanding,
  Bus,
  Play,
} from '@/components/icons';
import { formatDistance } from '@/geo/distance';
import type { Journey, JourneyStep, LatLng, VehicleKind, Route } from '@/api/types';

type Phase = 'idle' | 'locating' | 'planning' | 'results' | 'error';

type VehicleFilterKey = VehicleKind | 'all';

const VEHICLE_FILTER_KEYS: VehicleFilterKey[] = ['all', 'bus', 'train', 'tram', 'metro'];

export default function JourneyPage() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('idle');
  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [destination, setDestination] = useState<LatLng | null>(null);
  const [results, setResults] = useState<Journey[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [vehicleFilter, setVehicleFilter] = useState<VehicleFilterKey>('all');
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
    } catch {
      setError(t('journey.errorTitle'));
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
    } catch (err) {
      setError(t('journey.errorTitle'));
      // Keep the raw error in the console for debugging.
      console.error(err);
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
          <h3>{phase === 'locating' ? t('journey.locating') : t('journey.planning')}</h3>
          <p className="text-sm text-muted">{t('journey.mayTakeSeconds')}</p>
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
          <h3>{t('journey.errorTitle')}</h3>
          <p>{error}</p>
          <button type="button" className="btn btn-primary" onClick={() => setPhase('idle')}>
            {t('journey.back')}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'results' && results.length === 0) {
    return (
      <div className="page">
        <header className="page-header">
          <h1>{t('journey.title')}</h1>
        </header>
        <div className="empty">
          <div className="empty-illustration">
            <AlertTriangle size={40} />
          </div>
          <h3>{t('journey.noResults')}</h3>
          <p>{t('journey.noResultsHint')}</p>
          <button type="button" className="btn btn-primary" onClick={() => setPhase('idle')}>
            {t('journey.retry')}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'results' && results.length > 0) {
    return (
      <div className="page">
        <header className="page-header">
          <h1>{t('journey.title')}</h1>
          <button type="button" className="btn btn-sm" onClick={() => setPhase('idle')}>
            {t('journey.newSearch')}
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
        <h1>{t('journey.title')}</h1>
      </header>

      <p className="text-muted mb-4">{t('journey.intro')}</p>

      <section className="card mb-3">
        <div className="card-title mb-2">{t('journey.origin')}</div>
        <div className="row gap-2" style={{ alignItems: 'center' }}>
          <button type="button" className="btn" onClick={() => void locateMe()}>
            <MapIcon size={14} /> {t('journey.useMyLocation')}
          </button>
          <span className="text-xs text-muted">{t('journey.or')}</span>
          <input
            className="input"
            placeholder={t('journey.latLngPlaceholder')}
            onChange={(e) => {
              const [lat, lng] = e.target.value.split(',').map((s) => parseFloat(s.trim()));
              if (lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng)) {
                setOrigin({ lat, lng });
              }
            }}
          />
        </div>
        {origin && (
          <div className="text-xs text-muted mt-2">
            {t('journey.originCoords', { lat: origin.lat.toFixed(4), lng: origin.lng.toFixed(4) })}
          </div>
        )}
      </section>

      <section className="card mb-3">
        <div className="card-title mb-2">{t('journey.destination')}</div>
        <input
          className="input"
          placeholder={t('journey.latLngPlaceholder')}
          onChange={(e) => {
            const [lat, lng] = e.target.value.split(',').map((s) => parseFloat(s.trim()));
            if (lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng)) {
              setDestination({ lat, lng });
            }
          }}
        />
        {destination && (
          <div className="text-xs text-muted mt-2">
            {t('journey.destinationCoords', { lat: destination.lat.toFixed(4), lng: destination.lng.toFixed(4) })}
          </div>
        )}
      </section>

      <section className="card mb-3">
        <div className="card-title mb-2">{t('journey.filters')}</div>
        <div className="row gap-2" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
          {VEHICLE_FILTER_KEYS.map((k) => {
            // The "all" pseudo-key and each real VehicleKind get their
            // own i18n string. We deliberately don't hardcode English
            // fallbacks — the `t()` call below requires the keys to
            // exist in every locale.
            const labelKey = k === 'all' ? 'home.exploreMap' : `vehicle.${k}`;
            const emoji = k === 'all' ? '🚌'
              : k === 'bus' ? '🚌'
              : k === 'train' ? '🚆'
              : k === 'tram' ? '🚊'
              : '🚇';
            return (
              <button
                key={k}
                type="button"
                className={`chip ${vehicleFilter === k ? 'active' : ''}`}
                onClick={() => setVehicleFilter(k)}
              >
                <span style={{ marginRight: 4 }}>{emoji}</span>
                {t(labelKey)}
              </button>
            );
          })}
        </div>
        <label className="row gap-2" style={{ alignItems: 'center', fontSize: 'var(--fs-sm)' }}>
          <input
            type="checkbox"
            checked={avoidRunning}
            onChange={(e) => setAvoidRunning(e.target.checked)}
          />
          <span>{t('journey.avoidRunning')}</span>
        </label>
        <div className="row gap-2" style={{ alignItems: 'center', fontSize: 'var(--fs-sm)', marginTop: 8 }}>
          <span>{t('journey.maxTransfers')}</span>
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
        <Check size={18} /> {t('journey.search')}
      </button>
    </div>
  );
}

function JourneyCard({ journey }: { journey: Journey }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const startTrip = useTripStore((s) => s.startTrip);
  const minutes = Math.round(journey.totalDurationS / 60);
  const transfers = Math.max(0, journey.boardings - 1);
  const walkSpeed = journey.maxRequiredWalkSpeedMs;
  const walkKind: 'stroll' | 'brisk' | 'running' = walkSpeed <= 1.5 ? 'stroll' : walkSpeed <= 2.4 ? 'brisk' : 'running';
  const walkLabelKey = walkKind === 'stroll' ? 'journey.walkStroll'
    : walkKind === 'brisk' ? 'journey.walkBrisk'
    : 'journey.walkRunning';
  const walkSpeedKey = walkKind === 'stroll' ? 'journey.walkBriskSpeed'
    : walkKind === 'brisk' ? 'journey.walkBriskSpeed'
    : 'journey.walkRunningSpeed';

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
            {t('journey.rides', { n: journey.boardings })}
            {' · '}
            {transfers === 0
              ? t('journey.noTransfers')
              : t('journey.transfers', { n: transfers })}
            {' · '}
            {formatDistance(journey.totalWalkM)} {t('journey.walking')}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">{t('journey.arrivesAt')}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
            {new Date(journey.arriveByUtc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>

      {walkKind !== 'stroll' && (
        <div className={`banner ${walkKind === 'running' ? 'banner-danger' : 'banner-warning'} mb-2 text-sm`}>
          <PersonStanding size={16} />
          <span>{t('journey.walkHint', { speed: t(walkSpeedKey), label: t(walkLabelKey) })}</span>
        </div>
      )}

      <button
        type="button"
        className="btn btn-block"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? t('journey.hideSteps') : t('journey.showSteps')}
      </button>

      {firstRide && (
        <button
          type="button"
          className="btn btn-primary btn-block mt-2"
          onClick={() => void handleStart()}
        >
          <Play size={16} /> {t('journey.startTrip')}
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
  const { t } = useTranslation();
  if (step.kind === 'walk') {
    return (
      <li className="row gap-2" style={{ alignItems: 'center' }}>
        <div className="list-item-icon" style={{ background: 'var(--bg-subtle)' }}>
          <PersonStanding size={16} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="text-sm">{t('journey.walkStep', { dist: formatDistance(step.distanceM) })}</div>
          <div className="text-xs text-muted">{t('journey.approxMinutes', { n: Math.round(step.durationS / 60) })}</div>
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