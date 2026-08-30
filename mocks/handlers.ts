import { http, HttpResponse, delay } from 'msw';
import { activeBuses, seedRoutes } from './data/seed';
import type { Route } from '@/api/types';

const trips = new Map<string, { id: string; routeId: string; startedAt: number; endedAt?: number; anonId: string }>();
const proposals = new Map<string, any>();
const detours: any[] = [];

export const handlers = [
  // List nearby routes
  http.get('/api/routes/nearby', async ({ request }) => {
    await delay(200);
    const url = new URL(request.url);
    const lat = parseFloat(url.searchParams.get('lat') ?? '40.42');
    const lng = parseFloat(url.searchParams.get('lng') ?? '-3.69');
    const nearby = seedRoutes.filter((r) => {
      const mid = r.polyline[Math.floor(r.polyline.length / 2)];
      const dLat = (mid[0] - lat) * 111;
      const dLng = (mid[1] - lng) * 85;
      return Math.sqrt(dLat * dLat + dLng * dLng) < 100; // 100 km radius
    });
    return HttpResponse.json({ routes: nearby });
  }),

  // Get single route
  http.get('/api/routes/:id', async ({ params }) => {
    await delay(150);
    const r = seedRoutes.find((x) => x.id === params.id);
    if (!r) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(r);
  }),

  // Create route
  http.post('/api/routes', async ({ request }) => {
    await delay(300);
    const body = (await request.json()) as Route;
    const id = body.id ?? `r-${Math.random().toString(36).slice(2, 8)}`;
    const created = { ...body, id, version: 1, createdAt: Date.now() };
    seedRoutes.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),

  // Start trip
  http.post('/api/trips/start', async ({ request }) => {
    await delay(200);
    const body = (await request.json()) as { routeId: string; pub: string; ts: number };
    const id = `t-${Math.random().toString(36).slice(2, 10)}`;
    trips.set(id, { id, routeId: body.routeId, startedAt: body.ts, anonId: body.pub.slice(0, 8) });
    return HttpResponse.json({ tripId: id });
  }),

  // Push samples
  http.post('/api/trips/:id/samples', async () => {
    await delay(80);
    return new HttpResponse(null, { status: 204 });
  }),

  // Get trip state (other active buses)
  http.get('/api/trips/:id', async ({ params }) => {
    await delay(120);
    const trip = trips.get(params.id as string);
    if (!trip) return new HttpResponse(null, { status: 404 });
    // Simulate live movement
    const bus = activeBuses.get(trip.routeId);
    if (bus) {
      bus.lat += (Math.random() - 0.5) * 0.0008;
      bus.lng += (Math.random() - 0.5) * 0.0008;
      bus.etaNextStop = Math.max(60_000, bus.etaNextStop - 30_000 + (Math.random() - 0.5) * 10_000);
    }
    const route = seedRoutes.find((r) => r.id === trip.routeId);
    return HttpResponse.json({
      trip,
      route,
      activeBuses: Array.from(activeBuses.entries()).map(([routeId, b]) => ({ routeId, ...b })),
      routeVersion: route?.version ?? 1,
    });
  }),

  // End trip
  http.post('/api/trips/:id/end', async ({ params }) => {
    await delay(150);
    const trip = trips.get(params.id as string);
    if (trip) trip.endedAt = Date.now();
    return new HttpResponse(null, { status: 204 });
  }),

  // Proposals list
  http.get('/api/routes/:id/proposals', async ({ params }) => {
    await delay(150);
    const list = Array.from(proposals.values()).filter((p: any) => p.routeId === params.id);
    return HttpResponse.json({ proposals: list });
  }),

  // Create proposal
  http.post('/api/routes/:id/proposals', async ({ params, request }) => {
    await delay(250);
    const body = (await request.json()) as any;
    const id = `p-${Math.random().toString(36).slice(2, 8)}`;
    proposals.set(id, {
      id,
      routeId: params.id,
      ...body,
      status: 'pending',
      approvals: 0,
      rejections: 0,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 86400_000,
    });
    return HttpResponse.json({ id }, { status: 201 });
  }),

  // Vote
  http.post('/api/proposals/:id/votes', async ({ params, request }) => {
    await delay(150);
    const body = (await request.json()) as any;
    const p: any = proposals.get(params.id as string);
    if (!p) return new HttpResponse(null, { status: 404 });
    p[body.kind === 'approve' ? 'approvals' : 'rejections']++;
    if (p.approvals >= 5) p.status = 'approved';
    else if (p.rejections >= 5) p.status = 'rejected';
    proposals.set(p.id, p);
    return HttpResponse.json({ approvals: p.approvals, rejections: p.rejections, status: p.status });
  }),

  // Detour
  http.post('/api/detours', async ({ request }) => {
    await delay(200);
    const body = (await request.json()) as any;
    detours.push({ id: `d-${Math.random().toString(36).slice(2, 6)}`, ts: Date.now(), ...body });
    return new HttpResponse(null, { status: 201 });
  }),
];