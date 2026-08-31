import { apiFetch } from './client';
import type { JourneyPlanRequest, JourneyPlanResponse } from '@/api/types';

export async function planJourney(req: JourneyPlanRequest): Promise<JourneyPlanResponse> {
  return apiFetch('/journey-plan', { method: 'POST', body: req });
}