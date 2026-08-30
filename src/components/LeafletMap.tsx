import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { Route, LatLng } from '@/api/types';

// Workaround for default marker icons in bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const busIcon = L.divIcon({
  className: 'portami-marker',
  html: `<div class="portami-marker-bus"><svg width="20" height="20" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="0">
    <rect x="4" y="6" width="15" height="12" rx="2" fill="#0f766e"/>
    <rect x="5" y="8" width="4" height="3" rx="0.5" fill="#ccfbf1"/>
    <rect x="11" y="8" width="4" height="3" rx="0.5" fill="#ccfbf1"/>
    <circle cx="6" cy="20" r="1.6" fill="#0f766e"/>
    <circle cx="14" cy="20" r="1.6" fill="#0f766e"/>
  </div></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

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

export type MapLayer = {
  routes?: Route[];
  showStops?: boolean;
  centerOn?: LatLng;
  followUser?: boolean;
  onMapClick?: (latlng: LatLng) => void;
  userPosition?: LatLng | null;
  className?: string;
};

export function LeafletMap({ routes, showStops, centerOn, followUser, onMapClick, userPosition, className }: MapLayer) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = L.map(ref.current, {
      zoomControl: false,
      attributionControl: true,
    }).setView([40.4194, -3.6931], 12);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
      className: 'portami-tile',
    }).addTo(map);

    L.control.zoom({ position: 'topright' }).addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      onMapClickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    mapRef.current = map;
    routeLayerRef.current = L.layerGroup().addTo(map);

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
      const line = L.polyline(latlngs, {
        color: i === 0 ? '#0f766e' : '#94a3b8',
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

  return <div ref={ref} className={`leaflet-container ${className ?? ''}`} />;
}