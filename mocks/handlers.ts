import { http, HttpResponse, delay } from 'msw';
import { activeBuses, seedRoutes } from './data/seed';
import type { Route, GPSSample } from '@/api/types';
import { distanceToPolyline } from '@/geo/distance';

type ActiveTrip = {
  id: string;
  routeId: string;
  startedAt: number;
  endedAt?: number;
  anonId: string;
  lastSample?: GPSSample;
};

const trips = new Map<string, ActiveTrip>();
const proposals = new Map<string, any>();
const detours: any[] = [];
const incidents: any[] = [];
const busReports: any[] = [];

export const handlers = [
  // List nearby routes (filter by point-to-polyline proximity)
  http.get('/api/routes/nearby', async ({ request }) => {
    await delay(200);
    const url = new URL(request.url);
    const lat = parseFloat(url.searchParams.get('lat') ?? '40.42');
    const lng = parseFloat(url.searchParams.get('lng') ?? '-3.69');
    // Use real proximity to the polyline, not just the midpoint
    const nearby = seedRoutes
      .map((r) => ({ route: r, distM: distanceToPolyline({ lat, lng }, r.polyline) }))
      .filter(({ distM }) => distM < 5000) // 5 km
      .sort((a, b) => a.distM - b.distM)
      .map(({ route }) => route);
    return HttpResponse.json({ routes: nearby });
  }),

  // Get single route
  http.get('/api/routes/:id', async ({ params }) => {
    await delay(150);
    const r = seedRoutes.find((x) => x.id === params.id);
    if (!r) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(r);
  }),

  // List ALL routes (used by Board to find matches)
  http.get('/api/routes', async () => {
    await delay(200);
    return HttpResponse.json({ routes: seedRoutes });
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

  // Push samples (updates the trip's lastSample)
  http.post('/api/trips/:id/samples', async ({ params, request }) => {
    await delay(80);
    const trip = trips.get(params.id as string);
    if (!trip) return new HttpResponse(null, { status: 404 });
    const body = (await request.json()) as { samples: GPSSample[] };
    const last = body.samples[body.samples.length - 1];
    if (last) trip.lastSample = last;
    return new HttpResponse(null, { status: 204 });
  }),

  // Get trip state
  http.get('/api/trips/:id', async ({ params }) => {
    await delay(120);
    const trip = trips.get(params.id as string);
    if (!trip) return new HttpResponse(null, { status: 404 });
    // Simulate live movement on the demo activeBuses (cosmetic)
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

  // ACTIVE BUSES on a route (the new endpoint for live tracking)
  http.get('/api/routes/:id/active-buses', async ({ params }) => {
    await delay(100);
    const active = Array.from(trips.values()).filter(
      (t) => t.routeId === params.id && !t.endedAt && t.lastSample,
    );
    return HttpResponse.json({
      buses: active.map((t) => ({
        tripId: t.id,
        anonId: t.anonId,
        startedAt: t.startedAt,
        position: t.lastSample,
      })),
    });
  }),

  // ALL active buses across routes (for Explore map)
  http.get('/api/active-buses', async () => {
    await delay(120);
    const active = Array.from(trips.values()).filter(
      (t) => !t.endedAt && t.lastSample,
    );
    return HttpResponse.json({
      buses: active.map((t) => ({
        tripId: t.id,
        routeId: t.routeId,
        anonId: t.anonId,
        startedAt: t.startedAt,
        position: t.lastSample,
      })),
    });
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

  // Incidents
  http.post('/api/incidents', async ({ request }) => {
    await delay(150);
    const body = (await request.json()) as any;
    const id = `i-${Math.random().toString(36).slice(2, 6)}`;
    incidents.push({ id, ts: Date.now(), resolved: false, ...body });
    return HttpResponse.json({ id }, { status: 201 });
  }),

  http.get('/api/incidents', async ({ request }) => {
    await delay(100);
    const url = new URL(request.url);
    const routeId = url.searchParams.get('routeId');
    const now = Date.now();
    const visible = incidents.filter((i) =>
      !i.resolved && (i.endsAt === undefined || i.endsAt > now) &&
      (!routeId || i.routeId === routeId)
    );
    return HttpResponse.json({ incidents: visible });
  }),

  http.post('/api/incidents/:id/resolve', async ({ params }) => {
    await delay(100);
    const i = incidents.find((x) => x.id === params.id);
    if (i) {
      i.resolved = true;
      i.resolvedAt = Date.now();
    }
    return HttpResponse.json({ ok: true });
  }),

  // ===== Stop request (per-route) =====
  http.put('/api/routes/:id/stop-request', async ({ params, request }) => {
    await delay(150);
    const id = params.id as string;
    const body = await request.json() as any;
    const seed = seedRoutes.find((r) => r.id === id);
    if (seed) {
      seed.stopRequest = { ...body, updatedAt: Date.now() };
    }
    return HttpResponse.json({ ok: true, stopRequest: { ...body, updatedAt: Date.now() } });
  }),

  // ===== Bus reports (per-route) =====
  http.get('/api/routes/:id/bus-reports', async ({ params, request }) => {
    await delay(100);
    const id = params.id as string;
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
    const list = busReports
      .filter((r) => r.routeId === id)
      .sort((a, b) => b.observedAt - a.observedAt)
      .slice(0, limit);
    return HttpResponse.json({ reports: list });
  }),

  http.post('/api/routes/:id/bus-reports', async ({ params, request }) => {
    await delay(150);
    const id = params.id as string;
    const body = await request.json() as any;
    if (!body.plate?.trim()) {
      return new HttpResponse('plate required', { status: 400 });
    }
    const rid = `br-${Math.random().toString(36).slice(2, 8)}`;
    busReports.push({
      id: rid,
      routeId: id,
      plate: body.plate.trim(),
      observedAt: Date.now(),
      hasStopButton: body.hasStopButton,
      buttonPhotoUrl: body.buttonPhotoUrl,
      notes: body.notes,
      reportedBy: body.reportedBy,
    });
    return HttpResponse.json({ id: rid }, { status: 201 });
  }),
];