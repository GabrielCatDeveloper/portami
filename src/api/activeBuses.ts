import { apiFetch } from './client';
import type { GPSSample } from '@/api/types';

export type ActiveBus = {
  tripId: string;
  anonId: string;
  startedAt: number;
  position: GPSSample;
};

export type ActiveBusOnRoute = ActiveBus & { routeId?: string };

export async function fetchActiveBusesOnRoute(routeId: string): Promise<ActiveBus[]> {
  const res = await apiFetch<{ buses: ActiveBus[] }>(`/routes/${routeId}/active-buses`);
  return res.buses;
}

export async function fetchAllActiveBuses(): Promise<ActiveBusOnRoute[]> {
  const res = await apiFetch<{ buses: ActiveBusOnRoute[] }>('/active-buses');
  return res.buses;
}