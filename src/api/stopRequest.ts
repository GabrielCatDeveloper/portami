import { apiFetch } from './client';
import type { Route, StopRequestInfo } from '@/api/types';

export async function updateStopRequest(
  routeId: string,
  info: StopRequestInfo,
): Promise<StopRequestInfo | null> {
  const res = await apiFetch<{ ok: boolean; stopRequest: StopRequestInfo }>(
    `/routes/${routeId}/stop-request`,
    { method: 'PUT', body: info, signed: true },
  );
  return res.stopRequest ?? null;
}

export async function getStopRequest(route: Route): Promise<StopRequestInfo | undefined> {
  return route.stopRequest;
}
