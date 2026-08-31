import { apiFetch } from './client';
import type { Incident } from '@/api/types';

export async function listIncidents(routeId?: string): Promise<Incident[]> {
  const q = routeId ? `?routeId=${encodeURIComponent(routeId)}` : '';
  const res = await apiFetch<{ incidents: Incident[] }>(`/incidents${q}`, { failFastIfOffline: true });
  return res.incidents ?? [];
}

export async function reportIncident(incident: Omit<Incident, 'id' | 'ts' | 'resolved'>): Promise<{ id: string }> {
  return apiFetch('/incidents', { method: 'POST', body: incident, signed: true });
}

export async function resolveIncident(id: string): Promise<void> {
  await apiFetch(`/incidents/${encodeURIComponent(id)}/resolve`, { method: 'POST', signed: true });
}