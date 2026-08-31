// ============================================================
// Core domain types for portami
// ============================================================

export type LatLng = { lat: number; lng: number };

export type Stop = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

/**
 * Weekly time window. `daysOfWeek` uses 0=Sun..6=Sat (Date convention).
 * `intervals` are local-time HH:MM ranges.
 * A route is "active at moment X" iff:
 *   - X.dayOfWeek is in daysOfWeek, AND
 *   - there is some interval [start, end] such that start ≤ X.h:m ≤ end
 */
export type Schedule = {
  daysOfWeek: number[]; // [0..6]
  intervals: Array<{ start: string; end: string }>; // "HH:MM"
};

export type VehicleKind = 'bus' | 'train' | 'tram' | 'metro' | 'other';

export type Route = {
  id: string;
  name: string;
  stops: Stop[];
  polyline: Array<[number, number]>; // [lat, lng]
  createdBy: string; // pubkey b64url
  version: number;
  active: boolean;
  createdAt?: number;
  vehicleKind?: VehicleKind;
  /** Weekly timetables. Empty/missing -> always active. */
  schedules?: Schedule[];
  /** Operator / company name, free text */
  operator?: string;
  /** Direction label (e.g. "Centro ↔ Aeropuerto") */
  direction?: string;
};

/**
 * Temporary service incident. Examples: cancellation, delay, diversion.
 *
 * Lifecycle:
 *   - If `endsAt` is set, the incident auto-expires at that time.
 *   - Otherwise it persists until a user marks it resolved.
 *   - The app hides incidents where resolved=true OR endsAt < now().
 */
export type IncidentKind = 'cancellation' | 'delay' | 'diversion' | 'other';
export type Incident = {
  id: string;
  routeId: string;
  kind: IncidentKind;
  reason: string;            // free text, e.g. "Manifestación en Sol"
  reportedBy: string;        // anonId
  ts: number;
  /** Optional scheduled end (ISO ms). When expires, incident auto-hides. */
  endsAt?: number;
  /** True once a user has marked it resolved. */
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: number;
};

export type GPSSample = {
  ts: number;
  lat: number;
  lng: number;
  acc: number;
  speed?: number;
};

export type Trip = {
  id: string;
  routeId: string;
  routeVersionAtStart: number;
  startedAt: number;
  endedAt?: number;
  samples: GPSSample[];
};

export type Detour = {
  id: string;
  routeId: string;
  ts: number;
  reason: string;
  altPolyline: Array<[number, number]>;
  reporter: string; // pubkey
};

// ============================================================
// Proposals / community editing
// ============================================================

export type RouteDiff =
  | { kind: 'stop-added'; stop: Stop }
  | { kind: 'stop-removed'; stopId: string }
  | { kind: 'stop-moved'; stopId: string; fromLat: number; fromLng: number; toLat: number; toLng: number }
  | { kind: 'stop-renamed'; stopId: string; fromName: string; toName: string }
  | { kind: 'polyline-partial-replaced'; fromIdx: number; toIdx: number; newSegment: Array<[number, number]> }
  | { kind: 'meta-changed'; field: 'name'; from: string; to: string };

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export type RouteEditProposal = {
  id: string;
  routeId: string;
  routeVersionAtProposal: number;
  author: string;
  authorAnonId: string;
  title: string;
  rationale?: string;
  diff: RouteDiff[];
  status: ProposalStatus;
  createdAt: number;
  appliedAt?: number;
  expiresAt: number;
  approvals: number;
  rejections: number;
};

export type ProposalVote = {
  proposalId: string;
  voter: string; // pubkey
  kind: 'approve' | 'reject';
  ts: number;
  sig: string;
};

// ============================================================
// Signed request envelope
// ============================================================

export type SignedEnvelope<T = unknown> = {
  pub: string;
  nonce: string;
  ts: number;
  body: T;
  sig: string;
};

// ============================================================
// Identity
// ============================================================

export type Identity = {
  pubKey: string; // base64url
  privKeyJwk: JsonWebKey;
  createdAt: number;
};

// ============================================================
// Recordings (raw GPS traces saved before trimming)
// ============================================================

export type EditOp =
  | { kind: 'trim-start'; keepFromIdx: number }
  | { kind: 'trim-end'; keepUntilIdx: number }
  | { kind: 'cut'; fromIdx: number; toIdx: number }
  | { kind: 'delete-stop'; stopId: string }
  | { kind: 'move-stop'; stopId: string; toIdx: number }
  | { kind: 'rename-stop'; stopId: string; name: string };

export type DraftRoute = {
  recordingId: string;
  title: string;
  originalSamples: GPSSample[];
  cuts: Array<[number, number]>;
  trimStart?: number;
  trimEnd?: number;
  stops: Array<{ id: string; name: string; sampleIdx: number }>;
  editHistory: EditOp[];
  editFuture: EditOp[];
  createdAt: number;
  publishedRouteId?: string;
};

export type Recording = {
  id: string;
  samples: GPSSample[];
  createdAt: number;
  routeId?: string;
};

// ============================================================
// WebRTC pairing
// ============================================================

export type PairedDevice = {
  deviceId: string;
  pubKey: string; // device pubkey (NOT user pubkey)
  alias: string;
  pairedAt: number;
  lastSeenAt: number;
};

// ============================================================
// Sync messages
// ============================================================

export type SyncMessage =
  | { kind: 'hello'; deviceId: string; pubKey: string; alias: string; appVersion: string }
  | { kind: 'auth'; nonce: string; sig: string }
  | { kind: 'verify'; pairCode: string }
  | { kind: 'identity-transfer'; encryptedJwk: string; nonce: string; salt: string; ephemeralPubKey: string }
  | { kind: 'sync-init'; lastSyncTs: number; entityHashes: Record<string, string> }
  | { kind: 'sync-entities'; entities: Array<{ type: 'route' | 'proposal' | 'draft'; data: unknown }> }
  | { kind: 'sync-conflict'; entityId: string; ours: unknown; theirs: unknown }
  | { kind: 'conflict-resolved'; entityId: string; resolution: 'ours' | 'theirs' | 'merged' }
  | { kind: 'paired-device-revoked'; deviceId: string }
  | { kind: 'ping'; ts: number }
  | { kind: 'pong'; ts: number };