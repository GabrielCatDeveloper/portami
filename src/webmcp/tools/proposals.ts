import { registerOneTool } from '../register';
// Proposals tools — read proposals, create new ones (community
// edits to a route), vote on them.
//
// Voting rules (server-enforced):
//   - 5 approvals auto-apply the diff and bump the route version.
//   - 5 rejections discard the proposal.
//   - Each voter can only vote once per proposal.

import type { ModelContextTool, ModelContext } from '@mcp-b/webmcp-types';
import { listProposals, createProposal, voteOnProposal } from '@/api/proposals';
import { getDB } from '@/storage/db';
import type { RouteDiff, RouteEditProposal } from '@/api/types';
import { num, object, str } from '../schema';

const PROPOSAL_STATUSES = ['pending', 'approved', 'rejected', 'expired'] as const;

const DIFF_KINDS = [
  'stop-added',
  'stop-removed',
  'stop-moved',
  'stop-renamed',
  'polyline-partial-replaced',
  'meta-changed',
] as const;

export const proposalsTools: ModelContextTool[] = [
  {
    name: 'list_proposals',
    title: 'List proposals',
    description:
      'List proposals for a route. Optional status filter. Pulls from the server (and merges into local cache).',
    inputSchema: object({
      routeId: str('Route id.'),
      status: str('Filter by status.', PROPOSAL_STATUSES),
      limit: num('Max proposals to return (default 50, max 200).', { minimum: 1, maximum: 200 }),
    }, ['routeId']),
    async execute({ routeId, status, limit }) {
      const proposals = await listProposals(routeId as string);
      const db = await getDB();
      const now = Date.now();
      const tx = db.transaction('proposals', 'readwrite');
      for (const p of proposals) {
        await tx.store.put({ ...p, cachedAt: now } as RouteEditProposal & { cachedAt: number });
      }
      await tx.done;
      const max = Math.min(Number(limit ?? 50), 200);
      const filtered = status ? proposals.filter((p) => p.status === status) : proposals;
      return filtered.slice(0, max);
    },
  },

  {
    name: 'get_proposal',
    title: 'Get proposal',
    description: 'Read a single proposal by id (from the local cache).',
    inputSchema: object({ proposalId: str('Proposal id.') }, ['proposalId']),
    annotations: { readOnlyHint: true },
    async execute({ proposalId }) {
      const db = await getDB();
      const p = await db.get('proposals', proposalId as string);
      return p ?? null;
    },
  },

  {
    name: 'create_proposal',
    title: 'Create proposal',
    description:
      'Propose changes to a route. Pass `diff` as a JSON string with one or more RouteDiff entries. Each entry shape: stop-added {stop}, stop-removed {stopId}, stop-moved {stopId, fromLat, fromLng, toLat, toLng}, stop-renamed {stopId, fromName, toName}, polyline-partial-replaced {fromIdx, toIdx, newSegment}, meta-changed {field:"name", from, to}.',
    inputSchema: object({
      routeId: str('Route id.'),
      title: str('Short title for the proposal.'),
      rationale: str('Why this change is needed (optional).'),
      diff: str(
        'JSON-encoded array of RouteDiff entries. Example: [{"kind":"stop-renamed","stopId":"s1","fromName":"A","toName":"A (norte)"}]',
      ),
    }, ['routeId', 'title', 'diff']),
    async execute({ routeId, title, rationale, diff }) {
      const diffArr = JSON.parse(diff as string) as RouteDiff[];
      if (!Array.isArray(diffArr) || diffArr.length === 0) {
        throw new Error('diff must be a non-empty JSON array');
      }
      const idStore = (await import('@/state/identity')).useIdentityStore.getState();
      const anonId = idStore.anonId ?? '';
      const route = await (await getDB()).get('routes', routeId as string);
      const routeVersionAtProposal = (route?.version as number | undefined) ?? 1;
      const { id } = await createProposal(routeId as string, {
        routeId: routeId as string,
        routeVersionAtProposal,
        author: idStore.identity!.pubKey,
        authorAnonId: anonId,
        title: title as string,
        rationale: typeof rationale === 'string' ? rationale : undefined,
        diff: diffArr,
      });
      return { id, routeId, title, diffCount: diffArr.length };
    },
  },

  {
    name: 'vote_proposal',
    title: 'Vote on a proposal',
    description:
      'Cast your vote (approve or reject) on a proposal. You can only vote once per proposal; revote is not allowed.',
    inputSchema: object({
      proposalId: str('Proposal id.'),
      vote: str('Your vote.', ['approve', 'reject']),
    }, ['proposalId', 'vote']),
    async execute({ proposalId, vote }) {
      const res = await voteOnProposal(proposalId as string, vote as 'approve' | 'reject');
      // Update local cache
      const db = await getDB();
      const cur = await db.get('proposals', proposalId as string);
      if (cur) {
        await db.put('proposals', {
          ...cur,
          approvals: res.approvals,
          rejections: res.rejections,
          status: res.status as RouteEditProposal['status'],
          myVote: vote as 'approve' | 'reject',
        });
      }
      return res;
    },
  },

  // Quietly expose the diff-kind vocabulary so an agent can
  // introspect it without guessing.
  {
    name: 'list_proposal_diff_kinds',
    title: 'List supported proposal diff kinds',
    description: 'Return the RouteDiff kinds accepted by `create_proposal`.',
    inputSchema: object({}),
    annotations: { readOnlyHint: true },
    async execute() {
      return DIFF_KINDS.map((kind) => ({ kind }));
    },
  },
];

export async function registerProposalsTools(mc: ModelContext): Promise<void> {
  for (const t of proposalsTools) await registerOneTool(mc, t);
}
