// ============================================================
// GeoJSON export / import with Ed25519 signature
// ============================================================
import {
  canonicalJSON,
  importPublicKeyB64,
  sha256,
  signMessage,
  importPrivateKeyJwk,
  verifySignature,
  randomUUID,
} from '@/crypto';
import { getDB } from '@/storage/db';

export type PortamiExport = {
  type: 'FeatureCollection';
  portami: {
    schemaVersion: 1;
    exportedAt: number;
    ownerPubKey: string;
    ownerAnonId: string;
    signatures: Array<{ over: 'features-hash'; by: string; sig: string }>;
  };
  features: Array<{
    type: 'Feature';
    geometry: { type: 'LineString' | 'Point'; coordinates: any };
    properties: any;
  }>;
};

// ============================================================
// Export
// ============================================================
export async function exportMyRoutesAsGeoJSON(): Promise<PortamiExport> {
  const db = await getDB();
  const allRoutes = await db.getAll('routes');
  const myRoutes = allRoutes.filter((r) => r.isMine);

  const idStore = (await import('@/state/identity')).useIdentityStore.getState();
  const ownerPubKey = idStore.identity!.pubKey;
  const ownerAnonId = idStore.anonId ?? '';

  const features: PortamiExport['features'] = myRoutes.map((r) => ({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: r.polyline.map(([la, ln]) => [ln, la]),
    },
    properties: {
      kind: 'route',
      routeId: r.id,
      name: r.name,
      version: r.version,
      vehicleKind: r.vehicleKind,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      stops: r.stops.map((s) => ({ id: s.id, name: s.name, lng: s.lng, lat: s.lat })),
    },
  }));

  // Proposals by the user
  const allProposals = await db.getAll('proposals');
  const myProposals = allProposals.filter((p) => p.author === ownerPubKey);
  for (const p of myProposals) {
    const target = myRoutes.find((r) => r.id === p.routeId);
    const center = target?.polyline[0] ?? [0, 0];
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [center[1], center[0]] },
      properties: {
        kind: 'proposal',
        proposalId: p.id,
        routeId: p.routeId,
        status: p.status,
        title: p.title,
        rationale: p.rationale,
        diff: p.diff,
      },
    });
  }

  // Sign over canonical features JSON
  const featuresCanon = canonicalJSON(features);
  const hash = await sha256(featuresCanon);

  const privKey = await importPrivateKeyJwk(idStore.identity!.privKeyJwk);
  const sig = await signMessage(privKey, hash);

  return {
    type: 'FeatureCollection',
    portami: {
      schemaVersion: 1,
      exportedAt: Date.now(),
      ownerPubKey,
      ownerAnonId,
      signatures: [{ over: 'features-hash', by: ownerPubKey, sig }],
    },
    features,
  };
}

// ============================================================
// Import
// ============================================================
export type ImportMode = 'replace' | 'keep' | 'merge';
export type ImportResult = {
  imported: number;
  skipped: number;
  replaced: number;
  merged: number;
  readonly: boolean;
};

export async function importGeoJSON(
  json: unknown,
  resolutions: Record<string, ImportMode> = {},
): Promise<ImportResult> {
  if (!isPortamiExport(json)) throw new Error('Archivo no es un export de portami válido');
  const exp = json as PortamiExport;

  // Verify signature
  let readonly = false;
  try {
    const featuresCanon = canonicalJSON(exp.features);
    const hash = await sha256(featuresCanon);
    const sigEntry = exp.portami.signatures.find((s) => s.over === 'features-hash');
    if (!sigEntry) throw new Error('No signature in file');
    const pubKey = await importPublicKeyB64(sigEntry.by);
    const valid = await verifySignature(pubKey, hash, sigEntry.sig);
    if (!valid) throw new Error('Invalid signature');
  } catch {
    readonly = true;
  }

  const db = await getDB();
  const result: ImportResult = { imported: 0, skipped: 0, replaced: 0, merged: 0, readonly };

  for (const f of exp.features) {
    const kind = f.properties?.kind;
    if (kind === 'route') {
      const id = f.properties.routeId as string;
      const existing = await db.get('routes', id);
      const resolution = resolutions[id] ?? (existing ? 'keep' : 'replace');

      if (resolution === 'keep') {
        result.skipped++;
        continue;
      }

      const coords = (f.geometry as any).coordinates as Array<[number, number]>;
      const polyline: Array<[number, number]> = coords.map(([lng, lat]) => [lat, lng]);

      const stops = (f.properties.stops ?? []).map((s: any) => ({
        id: s.id ?? randomUUID(),
        name: s.name,
        lat: s.lat,
        lng: s.lng,
      }));

      if (existing && resolution === 'merge') {
        // Merge: union of stops + newer polyline
        const existingStops = existing.stops;
        const seen = new Set(existingStops.map((s) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`));
        for (const s of stops) {
          const key = `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
          if (!seen.has(key)) {
            existingStops.push(s);
            seen.add(key);
          }
        }
        await db.put('routes', { ...existing, polyline, stops: existingStops });
        result.merged++;
        continue;
      }

      await db.put('routes', {
        id,
        name: f.properties.name,
        polyline,
        stops,
        createdBy: f.properties.createdBy,
        version: f.properties.version ?? 1,
        active: true,
        vehicleKind: f.properties.vehicleKind,
        createdAt: f.properties.createdAt ?? Date.now(),
        isMine: false,
        isFavorite: false,
        cachedAt: Date.now(),
      });
      if (existing && resolution === 'replace') result.replaced++;
      else result.imported++;
    } else if (kind === 'proposal') {
      const id = f.properties.proposalId as string;
      const existing = await db.get('proposals', id);
      if (existing) {
        result.skipped++;
        continue;
      }
      await db.put('proposals', {
        id,
        routeId: f.properties.routeId,
        routeVersionAtProposal: f.properties.routeVersionAtProposal ?? 1,
        author: f.properties.author ?? exp.portami.ownerPubKey,
        authorAnonId: f.properties.authorAnonId ?? exp.portami.ownerAnonId,
        title: f.properties.title,
        rationale: f.properties.rationale,
        diff: f.properties.diff ?? [],
        status: f.properties.status ?? 'pending',
        createdAt: f.properties.createdAt ?? exp.portami.exportedAt,
        expiresAt: f.properties.expiresAt ?? exp.portami.exportedAt + 30 * 86400_000,
        approvals: f.properties.approvals ?? 0,
        rejections: f.properties.rejections ?? 0,
      });
      result.imported++;
    }
  }

  // Record import history
  await db.add('importHistory', {
    ts: Date.now(),
    file: exp.portami.ownerAnonId || 'unknown',
    imported: result.imported,
    skipped: result.skipped,
    replaced: result.replaced,
    merged: result.merged,
  });

  return result;
}

function isPortamiExport(x: any): x is PortamiExport {
  return x && x.type === 'FeatureCollection' && x.portami && Array.isArray(x.features);
}

// ============================================================
// Download helpers
// ============================================================
export function downloadFile(content: string, filename: string, mime = 'application/geo+json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.geojson,.json,application/geo+json';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}