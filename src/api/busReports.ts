import { apiFetch } from './client';
import type { BusReport } from '@/api/types';

export async function listBusReports(routeId: string, limit = 20): Promise<BusReport[]> {
  const res = await apiFetch<{ reports: BusReport[] }>(
    `/routes/${routeId}/bus-reports?limit=${limit}`,
    { failFastIfOffline: true },
  );
  return res.reports ?? [];
}

export type NewBusReport = Omit<BusReport, 'id' | 'observedAt'>;

export async function addBusReport(report: NewBusReport): Promise<{ id: string }> {
  return apiFetch(`/routes/${report.routeId}/bus-reports`, {
    method: 'POST',
    body: report,
    signed: true,
  });
}