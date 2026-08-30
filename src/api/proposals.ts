import { apiFetch } from './client';
import { useIdentityStore } from '@/state/identity';
import type { RouteEditProposal } from '@/api/types';

export async function listProposals(routeId: string): Promise<RouteEditProposal[]> {
  const res = await apiFetch<{ proposals: RouteEditProposal[] }>(`/routes/${routeId}/proposals`);
  return res.proposals;
}

export async function createProposal(
  routeId: string,
  proposal: Omit<RouteEditProposal, 'id' | 'status' | 'approvals' | 'rejections' | 'createdAt' | 'expiresAt'>,
): Promise<{ id: string }> {
  return apiFetch(`/routes/${routeId}/proposals`, { method: 'POST', body: proposal, signed: true });
}

export async function voteOnProposal(
  proposalId: string,
  kind: 'approve' | 'reject',
): Promise<{ approvals: number; rejections: number; status: string }> {
  const id = await useIdentityStore.getState().ensure();
  return apiFetch(`/proposals/${proposalId}/votes`, {
    method: 'POST',
    body: { kind, voter: id.pubKey, ts: Date.now() },
    signed: true,
  });
}