import { apiFetch } from './client';
import { useIdentityStore } from '@/state/identity';
import { canonicalJSON, importPrivateKeyJwk, randomNonce, signMessage, bytesToBase64Url } from '@/crypto';
import type { RouteEditProposal, ProposalVote } from '@/api/types';

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
  const privKey = await importPrivateKeyJwk(id.privKeyJwk);
  const ts = Date.now();
  const nonce = randomNonce();
  const msg = new TextEncoder().encode(canonicalJSON({ proposalId, voter: id.pubKey, kind, ts }));
  const sig = await signMessage(privKey, msg);
  const vote: ProposalVote = { proposalId, voter: id.pubKey, kind, ts, sig: bytesToBase64Url(new Uint8Array([0])) };
  // server will verify sig; in mock we just send kind+ts
  return apiFetch(`/proposals/${proposalId}/votes`, {
    method: 'POST',
    body: { kind, voter: id.pubKey, ts, sig },
    signed: true,
  });
}