import { apiFetch } from './client';
import type { GPSSample, VehicleKind } from '@/api/types';

export type ActiveBus = {
  tripId: string;
  anonId: string;
  startedAt: number;
  position: GPSSample;
  vehicleKind?: VehicleKind;
};

export type ActiveBusOnRoute = ActiveBus & { routeId?: string };

export async function fetchActiveBusesOnRoute(routeId: string): Promise<ActiveBus[]> {
  const res = await apiFetch<{ buses: ActiveBus[] }>(`/routes/${routeId}/active-buses`, { failFastIfOffline: true });
  return res.buses;
}

export async function fetchAllActiveBuses(): Promise<ActiveBusOnRoute[]> {
  const res = await apiFetch<{ buses: ActiveBusOnRoute[] }>('/active-buses', { failFastIfOffline: true });
  return res.buses;
}