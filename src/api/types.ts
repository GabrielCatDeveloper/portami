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

/**
 * How to request a stop on this route. Set collaboratively by users
 * (typically a frequent rider confirms whether the bus has a button
 * and what it looks like).
 */
export type StopRequestInfo = {
  /** "button" = push a button inside the bus; "shout" = tell the driver; "app" = use an operator app; "other" / "unknown" */
  type: 'button' | 'shout' | 'app' | 'other' | 'unknown';
  /** Short, human-readable instructions (e.g. "El botón está junto a la puerta trasera, marcado en rojo"). */
  notes?: string;
  /** Data URL of a photo showing the button. Helps new riders locate it. */
  buttonPhotoUrl?: string;
  /** Number of distinct users that have confirmed this info. */
  confirmations?: number;
  /** Last time it was updated. */
  updatedAt?: number;
};

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
  /** How to ask the driver to stop (collaborative, edited by users). */
  stopRequest?: StopRequestInfo;
};

/**
 * Report by a user about a specific bus they rode on this route.
 * Buses aren't permanently tied to routes (operators rotate them), so
 * these reports are observations useful for other riders.
 */
export type BusReport = {
  id: string;
  routeId: string;
  /** Bus identifier: license plate, fleet number, or other. */
  plate: string;
  /** When the user observed the bus on this route. */
  observedAt: number;
  /** Did this specific bus have a stop-request button? */
  hasStopButton?: boolean;
  /** Photo of the button (data URL). */
  buttonPhotoUrl?: string;
  /** Free notes: condition of the bus, where it stops, etc. */
  notes?: string;
  reportedBy: string; // anonId
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
  reporter: string;
};

// ============================================================
// Journey planning (A → B)
// ============================================================

/** A single step of a journey plan. */
export type JourneyStep =
  | {
      kind: 'walk';
      /** Approximate coords at the start of the walk. */
      from: LatLng;
      /** Destination of the walk (a stop or a point). */
      to: LatLng;
      distanceM: number;
      durationS: number;
    }
  | {
      kind: 'ride';
      routeId: string;
      routeName: string;
      vehicleKind?: VehicleKind;
      fromStopId: string;
      fromStopName: string;
      toStopId: string;
      toStopName: string;
      /** Distance on the route between the two stops. */
      rideDistanceM: number;
      /** If the route has a schedule, this is the next valid departure after
       * `departAfter`; otherwise undefined (assumes always available). */
      nextDepartureUtc?: number;
    };

export type Journey = {
  id: string;
  from: LatLng;
  to: LatLng;
  steps: JourneyStep[];
  totalDurationS: number;
  totalWalkM: number;
  totalRideM: number;
  /** Number of vehicle boardings (so transfers = boardings - 1 when >= 1). */
  boardings: number;
  /** Earliest possible departure time given the schedule. */
  departAfterUtc: number;
  /** Resulting arrival time at `to`. */
  arriveByUtc: number;
  /** Max walking speed in m/s required to make the connections. 0 if no walking. */
  maxRequiredWalkSpeedMs: number;
};

export type JourneyPlanRequest = {
  from: LatLng;
  to: LatLng;
  /** Optional — defaults to "now". */
  departAfterUtc?: number;
  /** Max m/s the user is willing to walk. Defaults to 1.4 (≈ slow stroll). */
  maxWalkSpeedMs?: number;
  /** Max number of boardings (transfers + 1). Defaults to 3. */
  maxBoardings?: number;
  /** Search radius around from/to in meters. Defaults to 600. */
  walkRadiusM?: number;
  /** Optional: exclude these route IDs. */
  excludeRouteIds?: string[];
  /** Vehicle filter. */
  vehicleKinds?: VehicleKind[];
};

export type JourneyPlanResponse = {
  journeys: Journey[];
  /** Routes considered for the search. Useful for the UI to show "no buses" cases. */
  considered: Array<{ routeId: string; reason: string }>;
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
// Multi-peer WebRTC status (Hito 7 — Fase 1)
// ============================================================

/**
 * Connection state of a single WebRTC peer.
 * - `disconnected`: never connected or explicitly closed
 * - `connecting`:   SDP/ICE exchange in progress (initial pair or reconnect)
 * - `connected`:    data channel open
 * - `reconnecting`: ICE connection dropped, retrying
 * - `unreachable`:  repeated failures — manual intervention needed
 * - `revoked`:      user removed this peer from pairedDevices
 * - `error`:        unrecoverable error (e.g. pair-code mismatch)
 */
export type PeerStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'unreachable'
  | 'revoked'
  | 'error';

export type PeerInfo = {
  /** Stable peer identifier — equals the paired device's `deviceId` (== pubKey). */
  deviceId: string;
  /** Human alias, copied from `PairedDevice.alias` at pairing time. */
  alias: string;
  /** Peer pubKey (== deviceId, kept for explicitness). */
  pubKey: string;
  status: PeerStatus;
  /** When the current connection entered `connected` (ms epoch). */
  lastConnectedAt?: number;
  /** Last error message if status === 'error'. */
  lastError?: string;
};

// ============================================================
// Trip shares (Hito 7 — Fase 2)
//
// Two stores: one for outgoing trip shares (what I send to friends),
// one for incoming (what my friends are sharing with me).
// Both have TTL 7d enforced by useStorageJanitor.
// ============================================================

/**
 * Compact summary of a planned journey, safe to send over the wire
 * and to persist on either side. Lighter than the full `Journey`.
 */
export type PlannedRouteSummary = {
  steps: Array<{ kind: 'walk' | 'ride'; label: string }>;
  totalDurationS: number;
};

/** Delivery state for one recipient of an outgoing trip share. */
export type RecipientStatus =
  | 'pending'   // sent, no ack yet (waiting up to 10s)
  | 'delivered' // ack received
  | 'failed'    // retried at least once, still no ack
  | 'unreachable'; // peer not connected, will retry on reconnect

export type OutgoingTripShareRecipient = {
  /** The peer's deviceId (= pubKey). */
  deviceId: string;
  /** Peer anonId — populated when we receive the `hello` ack. */
  peerAnonId?: string;
  /** Human alias of the recipient. */
  alias?: string;
  status: RecipientStatus;
  /** Last time we tried to send (or retry) to this recipient. */
  lastAttemptAt: number;
  /** When the recipient acked `trip-share-start`. */
  deliveredAt?: number;
  /** Last error if status === 'failed'. */
  error?: string;
};

/**
 * One row in `outgoingTripShares`. Represents "I started a trip on
 * route X at time T, and I tried to share it with N friends".
 */
export type OutgoingTripShare = {
  /** tripShareId — UUID generated at startSharing(). */
  id: string;
  /** The user's local trip id (FK to `trips`). */
  tripId: string;
  routeId: string;
  routeName: string;
  plannedRoute?: PlannedRouteSummary;
  /** My anonId — included for debugging / multi-device replay. */
  myAnonId: string;
  startedAt: number;
  endedAt?: number;
  endReason?: string;
  /** Keyed by peer deviceId. */
  recipients: Record<string, OutgoingTripShareRecipient>;
};

/**
 * One row in `incomingTripShares`. Keyed by `fromAnonId` because a
 * given friend can have at most one *active* incoming share at a time
 * (they can only be on one trip at once).
 */
export type IncomingTripShare = {
  /** Sender's anonId. */
  fromAnonId: string;
  /** Sender's deviceId (== pubKey), for WebRTC targeting. */
  fromDeviceId: string;
  /** Sender's alias at the time the share started. */
  fromAlias?: string;
  /** The trip id assigned by the sender (informational only). */
  tripId: string;
  routeId?: string;
  routeName?: string;
  plannedRoute?: PlannedRouteSummary;
  startedAt: number;
  endedAt?: number;
  endReason?: string;
  lastLocation?: LatLng & { ts: number; speed?: number };
  nextStopName?: string;
  etaNextStopS?: number;
  /** Connection state of the sender as observed locally. */
  senderStatus: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
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
  | { kind: 'pong'; ts: number }
  // Trip sharing (sender → receiver) — for the "friend can find me" feature.
  // `tripShareId` correlates all messages of the same share so the
  // receiver can ack each one and the sender can track delivery.
  | {
      kind: 'trip-share-start';
      tripShareId: string;
      fromAnonId: string;
      fromDeviceId: string;
      fromAlias?: string;
      routeId?: string;
      routeName?: string;
      plannedRoute?: PlannedRouteSummary;
      startedAt: number;
    }
  | {
      kind: 'trip-share-location';
      tripShareId: string;
      fromAnonId: string;
      ts: number;
      lat: number;
      lng: number;
      speed?: number;
      nextStopName?: string;
      etaNextStopS?: number;
    }
  | { kind: 'trip-share-end'; tripShareId: string; fromAnonId: string; ts: number; reason: string }
  // Ack from receiver → sender. Sent in response to `trip-share-start`
  // (mandatory) and optionally to `trip-share-location`/`trip-share-end`.
  | {
      kind: 'trip-share-ack';
      tripShareId: string;
      recipientAnonId: string;
      recipientDeviceId: string;
      ts: number;
      ackFor: 'start' | 'location' | 'end';
    };