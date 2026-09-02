// ============================================================
// PickLocationModal — full-screen map for picking an origin or
// destination point for the journey planner.
//
// UX rationale (vs. typing lat/lng by hand):
//   - Users planning a trip 15 days from now can't rely on GPS.
//   - Tapping the map is faster than remembering coordinates.
//   - The pin is **draggable**: tap roughly, fine-tune by dragging.
//   - "Use my location" button on the map provides a one-tap GPS
//     fallback for trips happening right now.
//
// Flow:
//   - Opens with an optional initial position (e.g. previously
//     picked origin) or centered on the user's current location.
//   - Every click / drag updates the picked position live.
//   - "Confirmar" returns the LatLng; "Cancelar" / backdrop dismiss
//     discards the change.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import type { LatLng } from '@/api/types';
import { Check, Navigation, X } from '@/components/icons';

// We share the same Leaflet icon-fix dance with LeafletMap. Without
// this the default markers throw a runtime error in Vite bundlers
// because `_getIconUrl` is marked private on the prototype.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Default fallback if we have no GPS, no initial position and the
// browser can't locate us — Madrid centre keeps Leaflet happy.
const DEFAULT_CENTER: LatLng = { lat: 40.4194, lng: -3.6931 };

export type PickLocationModalProps = {
  /** Title shown in the header: e.g. t('journey.origin'). */
  title: string;
  /** Optional hint text shown under the title. */
  hint?: string;
  /** Initial position (if user is editing a previously picked point). */
  initialPosition?: LatLng | null;
  /** Called when the user confirms the picked position. */
  onConfirm: (point: LatLng) => void;
  /** Called when the user cancels (backdrop tap, X button). */
  onClose: () => void;
};

export function PickLocationModal({
  title,
  hint,
  initialPosition,
  onConfirm,
  onClose,
}: PickLocationModalProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [picked, setPicked] = useState<LatLng | null>(initialPosition ?? null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState(false);

  // Escape closes the modal — matches the X button and feels
  // natural on desktop keyboard users. We listen on the document
  // because focus might be inside Leaflet's tile <img> elements.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Lock body scroll while the modal is open. Without this, the
  // page underneath keeps scrolling when the user drags the map
  // past the edge on mobile (and on desktop with trackpad inertia).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Initialise the map exactly once. `initialPosition` is read once
  // on mount to seed the view + drop the marker — we deliberately
  // don't re-init on every prop change to avoid tearing down the
  // Leaflet instance while the user is dragging.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const start = initialPosition ?? DEFAULT_CENTER;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
    }).setView([start.lat, start.lng], initialPosition ? 14 : 12);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
      className: 'portami-tile',
    } as unknown as L.TileLayerOptions).addTo(map);

    L.control.zoom({ position: 'topright' }).addTo(map);

    // The marker is created on first setPicked; see effect below.

    map.on('click', (e: L.LeafletMouseEvent) => {
      const ll: LatLng = { lat: e.latlng.lat, lng: e.latlng.lng };
      setPicked(ll);
      ensureMarker(map, markerRef).setLatLng([ll.lat, ll.lng]);
    });

    mapRef.current = map;

    // If we already had a position, drop the marker immediately so
    // the user sees something to drag.
    if (initialPosition) {
      ensureMarker(map, markerRef).setLatLng([initialPosition.lat, initialPosition.lng]);
    }

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const locateMe = () => {
    if (!('geolocation' in navigator)) return;
    setLocating(true);
    setLocateError(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll: LatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setPicked(ll);
        const map = mapRef.current;
        if (map) {
          ensureMarker(map, markerRef).setLatLng([ll.lat, ll.lng]);
          map.setView([ll.lat, ll.lng], 16, { animate: true });
        }
        setLocating(false);
      },
      () => {
        setLocateError(true);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const handleConfirm = () => {
    if (!picked) return;
    onConfirm(picked);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pick-location-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg)',
        zIndex: 1100,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header
        style={{
          padding: 'calc(var(--safe-top) + 12px) 12px 12px',
          background: 'var(--bg-elev)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <button
          type="button"
          className="btn-icon btn btn-ghost"
          onClick={onClose}
          aria-label={t('common.cancel')}
        >
          <X size={20} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2
            id="pick-location-title"
            style={{
              fontSize: 'var(--fs-md)',
              margin: 0,
              fontWeight: 700,
            }}
          >
            {title}
          </h2>
          {hint && (
            <div className="text-xs text-muted" style={{ marginTop: 2 }}>
              {hint}
            </div>
          )}
        </div>
      </header>

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div ref={containerRef} className="leaflet-container" style={{ height: '100%', width: '100%' }} />

        {/* Locate-me floating button — top-left, just below the header */}
        <button
          type="button"
          className="btn"
          onClick={locateMe}
          disabled={locating}
          aria-label={t('journey.useMyLocation')}
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            zIndex: 500,
            background: 'var(--overlay-strong)',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <Navigation size={16} />
          {locating ? t('journey.locating') : t('journey.useMyLocation')}
        </button>

        {/* Coordinates chip — top-right, mirrors the picked position */}
        <div
          aria-live="polite"
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            zIndex: 500,
            background: 'var(--overlay-strong)',
            borderRadius: 'var(--r-pill)',
            padding: '6px 12px',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-xs)',
            fontWeight: 600,
            boxShadow: 'var(--shadow-sm)',
            pointerEvents: 'none',
          }}
        >
          {picked
            ? `${picked.lat.toFixed(4)}, ${picked.lng.toFixed(4)}`
            : t('journey.noCoords')}
        </div>

        {locateError && (
          <div
            className="banner banner-warning"
            role="status"
            style={{
              position: 'absolute',
              top: 64,
              left: 12,
              right: 12,
              zIndex: 500,
            }}
          >
            <span>{t('journey.errorTitle')}</span>
          </div>
        )}

        {/* Onboarding hint — only shows until the user has placed a pin */}
        {!picked && (
          <div
            className="banner banner-info"
            style={{
              position: 'absolute',
              bottom: 88,
              left: 12,
              right: 12,
              zIndex: 500,
            }}
          >
            <span>{t('journey.pickOnMapHint')}</span>
          </div>
        )}
      </div>

      <footer
        style={{
          padding: '12px 12px calc(12px + var(--safe-bottom))',
          background: 'var(--bg-elev)',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          gap: 8,
        }}
      >
        <button type="button" className="btn flex-1" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary flex-1"
          onClick={handleConfirm}
          disabled={!picked}
        >
          <Check size={18} /> {t('journey.confirmLocation')}
        </button>
      </footer>
    </div>
  );
}

/**
 * Lazily create the draggable marker the first time the user
 * picks a point. Splitting this out keeps the map-init effect
 * focused on tiles + click handling.
 */
function ensureMarker(map: L.Map, markerRef: React.MutableRefObject<L.Marker | null>): L.Marker {
  if (markerRef.current) return markerRef.current;
  const marker = L.marker([0, 0], { draggable: true, autoPan: true }).addTo(map);
  marker.on('dragend', () => {
    const ll = marker.getLatLng();
    // Dispatch a synthetic state update by re-emitting through the
    // map's `click` handler — keeps a single source of truth.
    map.fire('click', { latlng: L.latLng(ll.lat, ll.lng) } as unknown as L.LeafletEvent);
  });
  markerRef.current = marker;
  return marker;
}
