import { describe, it, expect, beforeEach } from 'vitest';
import { exportMyRoutesAsGeoJSON, importGeoJSON, type PortamiExport } from '@/io/geojson';
import { useIdentityStore } from '@/state/identity';
import { getDB } from '@/storage/db';

async function setupIdentity() {
  await useIdentityStore.getState().init();
}

async function seedRoute(id: string, name: string) {
  const db = await getDB();
  await db.put('routes', {
    id,
    name,
    stops: [
      { id: 's1', name: 'A', lat: 40, lng: -3 },
      { id: 's2', name: 'B', lat: 40.01, lng: -3 },
    ],
    polyline: [
      [40, -3],
      [40.005, -3],
      [40.01, -3],
    ],
    createdBy: useIdentityStore.getState().identity!.pubKey,
    version: 1,
    active: true,
    createdAt: Date.now(),
    isMine: true,
    isFavorite: false,
    cachedAt: Date.now(),
  });
}

describe('GeoJSON export/import', () => {
  beforeEach(async () => {
    setupIdentity();
  });

  it('exports a FeatureCollection with valid structure', async () => {
    await setupIdentity();
    await seedRoute('r1', 'Test route');
    const exp = await exportMyRoutesAsGeoJSON();
    expect(exp.type).toBe('FeatureCollection');
    expect(exp.portami.schemaVersion).toBe(1);
    expect(exp.portami.signatures.length).toBeGreaterThan(0);
    expect(exp.features.length).toBe(1);
    expect(exp.features[0]?.properties.kind).toBe('route');
    expect(exp.features[0]?.geometry.type).toBe('LineString');
  });

  it('round-trips: export then import preserves signature', async () => {
    await setupIdentity();
    await seedRoute('r1', 'Round trip');
    const exp = await exportMyRoutesAsGeoJSON();
    const json = JSON.parse(JSON.stringify(exp));
    // Clear DB so import actually imports instead of skipping
    const db = await getDB();
    await db.clear('routes');
    const result = await importGeoJSON(json, {});
    expect(result.readonly).toBe(false);
    expect(result.imported + result.replaced).toBeGreaterThan(0);

    // Verify route is in DB
    const r = await db.get('routes', 'r1');
    expect(r).toBeDefined();
    expect(r?.name).toBe('Round trip');
  });

  it('rejects file without portami metadata', async () => {
    await expect(
      importGeoJSON({ type: 'FeatureCollection', features: [] }),
    ).rejects.toThrow();
  });

  it('imports unsigned file as read-only', async () => {
    const fakeExport: PortamiExport = {
      type: 'FeatureCollection',
      portami: {
        schemaVersion: 1,
        exportedAt: Date.now(),
        ownerPubKey: 'fakekey',
        ownerAnonId: 'TEST-TEST',
        signatures: [{ over: 'features-hash', by: 'fakekey', sig: 'invalidsig' }],
      },
      features: [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[-3, 40], [-3, 40.01]] },
          properties: {
            kind: 'route',
            routeId: 'r-unsigned',
            name: 'Unsigned route',
            version: 1,
            stops: [],
            createdBy: 'fakekey',
            createdAt: Date.now(),
          },
        },
      ],
    };
    const res = await importGeoJSON(fakeExport, {});
    expect(res.readonly).toBe(true);
    const db = await getDB();
    const r = await db.get('routes', 'r-unsigned');
    expect(r).toBeDefined();
    expect(r?.name).toBe('Unsigned route');
  });

  it('respects keep resolution for existing routes', async () => {
    await setupIdentity();
    await seedRoute('r1', 'Original');
    const exp = await exportMyRoutesAsGeoJSON();
    const json = JSON.parse(JSON.stringify(exp));
    const res = await importGeoJSON(json, { r1: 'keep' });
    expect(res.skipped).toBe(1);
    const db = await getDB();
    const r = await db.get('routes', 'r1');
    expect(r?.name).toBe('Original');
  });
});