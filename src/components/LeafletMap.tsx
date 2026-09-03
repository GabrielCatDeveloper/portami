import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { Route, LatLng, VehicleKind } from '@/api/types';

// Leaflet's typing declares `_getIconUrl` as private but bundlers
// need to delete it on the prototype before `mergeOptions` can
// substitute the icon URLs. The double-cast avoids `any` and keeps
// the field inaccessible from app code.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Per-vehicle icons. Trains/trams/metro use a different colour and
// outline to distinguish them from buses at a glance.
const VEHICLE_COLORS: Record<VehicleKind, { bg: string; fg: string; label: string }> = {
  bus:   { bg: '#0f766e', fg: '#ccfbf1', label: '🚌' },
  train: { bg: '#1d4ed8', fg: '#dbeafe', label: '🚆' },
  tram:  { bg: '#16a34a', fg: '#dcfce7', label: '🚊' },
  metro: { bg: '#7c3aed', fg: '#ede9fe', label: '🚇' },
  other: { bg: '#475569', fg: '#f1f5f9', label: '🚐' },
};

function vehicleIcon(kind: VehicleKind = 'bus'): L.DivIcon {
  const c = VEHICLE_COLORS[kind] ?? VEHICLE_COLORS.bus;
  return L.divIcon({
    className: 'portami-marker',
    html: `<div class="portami-marker-vehicle" style="background:${c.bg}"><span style="font-size:14px;line-height:28px">${c.label}</span></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

const stopIcon = L.divIcon({
  className: 'portami-marker',
  html: `<div class="portami-marker-stop"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const userIcon = L.divIcon({
  className: 'portami-marker',
  html: `<div class="portami-marker-user"><div class="portami-marker-user-dot"></div></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

export function vehicleEmoji(kind: VehicleKind | undefined): string {
  return VEHICLE_COLORS[kind ?? 'bus'].label;
}

export function vehicleColor(kind: VehicleKind | undefined): string {
  return VEHICLE_COLORS[kind ?? 'bus'].bg;
}

export type ActiveBusMarker = {
  tripId: string;
  anonId: string;
  position: LatLng;
  vehicleKind?: VehicleKind;
};

export type MapLayer = {
  routes?: Route[];
  showStops?: boolean;
  centerOn?: LatLng;
  followUser?: boolean;
  onMapClick?: (latlng: LatLng) => void;
  userPosition?: LatLng | null;
  activeBuses?: ActiveBusMarker[];
  className?: string;
};

export function LeafletMap({
  routes, showStops, centerOn, followUser, onMapClick, userPosition, activeBuses, className,
}: MapLayer) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const busLayerRef = useRef<L.LayerGroup | null>(null);
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = L.map(ref.current, {
      zoomControl: false,
      attributionControl: true,
    }).setView([40.4194, -3.6931], 12);

    // `loading="lazy"` is honoured by Leaflet on the <img> elements
    // it creates for each tile, deferring off-screen fetches until
    // the tile scrolls into view. This avoids the burst of 30+
    // tile requests the map fires on first mount, which is the
    // single biggest CPU/network cost on the explore page.
    const tileOptions = {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
      className: 'portami-tile',
      loading: 'lazy',
    } as unknown as L.TileLayerOptions;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', tileOptions).addTo(map);

    L.control.zoom({ position: 'topright' }).addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      onMapClickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    mapRef.current = map;
    routeLayerRef.current = L.layerGroup().addTo(map);
    busLayerRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Render routes
  useEffect(() => {
    const map = mapRef.current;
    const layer = routeLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (!routes) return;
    const allLatLngs: L.LatLng[] = [];
    routes.forEach((r, i) => {
      const latlngs = r.polyline.map(([la, ln]) => L.latLng(la, ln));
      const colour = vehicleColor(r.vehicleKind);
      const line = L.polyline(latlngs, {
        color: i === 0 ? colour : '#94a3b8',
        weight: i === 0 ? 5 : 3,
        opacity: i === 0 ? 1 : 0.6,
      }).addTo(layer);
      line.bindTooltip(r.name, { direction: 'center', className: 'portami-tooltip' });
      allLatLngs.push(...latlngs);
      if (showStops) {
        r.stops.forEach((s, idx) => {
          const marker = L.marker([s.lat, s.lng], { icon: stopIcon })
            .bindTooltip(`${idx + 1}. ${s.name}`)
            .addTo(layer);
          marker.on('click', () => {
            map.flyTo([s.lat, s.lng], 16, { duration: 0.6 });
          });
          allLatLngs.push(L.latLng(s.lat, s.lng));
        });
      }
    });
    if (allLatLngs.length && !centerOn) {
      const bounds = L.latLngBounds(allLatLngs);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }
  }, [routes, showStops, centerOn]);

  // Center
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !centerOn) return;
    map.setView([centerOn.lat, centerOn.lng], map.getZoom() || 14, { animate: true });
  }, [centerOn]);

  // User marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!userPosition) {
      if (userMarkerRef.current) {
        userMarkerRef.current.remove();
        userMarkerRef.current = null;
      }
      return;
    }
    if (!userMarkerRef.current) {
      userMarkerRef.current = L.marker([userPosition.lat, userPosition.lng], { icon: userIcon }).addTo(map);
    } else {
      userMarkerRef.current.setLatLng([userPosition.lat, userPosition.lng]);
    }
    if (followUser) {
      map.panTo([userPosition.lat, userPosition.lng], { animate: true });
    }
  }, [userPosition, followUser]);

  // Active bus/train markers (other users currently riding this route).
  // Each marker takes its route's vehicle kind so trains/trams look
  // visually distinct from buses on the map.
  useEffect(() => {
    const layer = busLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!activeBuses) return;
    for (const b of activeBuses) {
      const kind = (b as { vehicleKind?: VehicleKind }).vehicleKind;
      const icon = vehicleIcon(kind ?? 'bus');
      const label = vehicleEmoji(kind);
      L.marker([b.position.lat, b.position.lng], { icon })
        .bindTooltip(`${label} · #${b.anonId.slice(0, 6)}`)
        .addTo(layer);
    }
  }, [activeBuses]);

  return <div ref={ref} className={`leaflet-container ${className ?? ''}`} style={{ height: '100%', width: '100%' }} />;
}