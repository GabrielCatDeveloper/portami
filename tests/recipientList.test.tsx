// ============================================================
// Tests for the extracted RecipientList component.
//
// We render with a synthetic OutgoingTripShare (no Zustand, no
// IndexedDB, no network) and assert the rendering + the callbacks.
// The component pulls i18n keys for status labels, so we seed the
// locale by calling `i18n.changeLanguage('en')` once in
// beforeAll to keep the assertions deterministic.
// ============================================================
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecipientList } from '@/components/RecipientList';
import i18n from '@/i18n';
import type { OutgoingTripShare } from '@/api/types';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

function mkOutgoing(recipients: OutgoingTripShare['recipients']): OutgoingTripShare {
  return {
    id: 'share-1',
    tripId: 'trip-1',
    routeId: 'r-1',
    routeName: 'L1',
    myAnonId: 'me',
    startedAt: 1_700_000_000_000,
    recipients,
  };
}

function mkRecip(
  deviceId: string,
  status: 'pending' | 'delivered' | 'failed' | 'unreachable',
  alias?: string,
): OutgoingTripShare['recipients'][string] {
  return {
    deviceId,
    alias,
    status,
    lastAttemptAt: 1_700_000_000_000,
  };
}

describe('<RecipientList />', () => {
  it('renders nothing when outgoing is null', () => {
    const { container } = render(
      <RecipientList outgoing={null} onRetry={vi.fn()} onInvite={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the noRecipients message when there are zero recipients', () => {
    render(
      <RecipientList
        outgoing={mkOutgoing({})}
        onRetry={vi.fn()}
        onInvite={vi.fn()}
      />,
    );
    // The en value of trip.share.noRecipients mentions "paired friends".
    expect(
      screen.getByText(/don't have any paired friends yet/i),
    ).toBeInTheDocument();
  });

  it('shows the summary in singular form when there is exactly one recipient', () => {
    const outgoing = mkOutgoing({ d1: mkRecip('d1', 'delivered', 'Alice') });
    render(
      <RecipientList outgoing={outgoing} onRetry={vi.fn()} onInvite={vi.fn()} />,
    );
    // en: "Shared with 1 of 1 friend"
    expect(screen.getByText(/Shared with 1 of 1 friend/)).toBeInTheDocument();
  });

  it('shows the summary in plural form for 2+ recipients', () => {
    const outgoing = mkOutgoing({
      d1: mkRecip('d1', 'delivered', 'Alice'),
      d2: mkRecip('d2', 'pending', 'Bob'),
      d3: mkRecip('d3', 'failed', 'Carla'),
    });
    render(
      <RecipientList outgoing={outgoing} onRetry={vi.fn()} onInvite={vi.fn()} />,
    );
    expect(screen.getByText(/Shared with 1 of 3 friends/)).toBeInTheDocument();
  });

  it('uses the device id (truncated to 8 chars) when alias is missing', () => {
    const outgoing = mkOutgoing({
      'd12345678': mkRecip('d12345678', 'delivered'),
    });
    render(
      <RecipientList outgoing={outgoing} onRetry={vi.fn()} onInvite={vi.fn()} />,
    );
    // slice(0, 8) on 'd12345678' = 'd1234567'.
    expect(screen.getByText('d1234567')).toBeInTheDocument();
  });

  it('shows retry + invite buttons only for failed / unreachable recipients', async () => {
    const onRetry = vi.fn();
    const onInvite = vi.fn();
    const outgoing = mkOutgoing({
      d1: mkRecip('d1', 'delivered', 'Alice'),
      d2: mkRecip('d2', 'pending', 'Bob'),
      d3: mkRecip('d3', 'failed', 'Carla'),
      d4: mkRecip('d4', 'unreachable', 'Dave'),
    });
    const user = userEvent.setup();
    render(
      <RecipientList outgoing={outgoing} onRetry={onRetry} onInvite={onInvite} />,
    );

    // Alice (delivered) + Bob (pending) have no buttons.
    const aliceRow = screen.getByText('Alice').closest('div.row') as HTMLElement;
    expect(within(aliceRow).queryByRole('button')).toBeNull();
    const bobRow = screen.getByText('Bob').closest('div.row') as HTMLElement;
    expect(within(bobRow).queryByRole('button')).toBeNull();

    // Carla (failed) + Dave (unreachable) have retry + invite.
    const carlaRow = screen.getByText('Carla').closest('div.row') as HTMLElement;
    const carlaButtons = within(carlaRow).getAllByRole('button');
    expect(carlaButtons).toHaveLength(2);
    await user.click(carlaButtons[0]!);
    expect(onRetry).toHaveBeenCalledWith('d3');
    await user.click(carlaButtons[1]!);
    expect(onInvite).toHaveBeenCalledWith('d3', 'Carla');
  });

  it('switches to the Spanish locale and renders translated labels', async () => {
    await i18n.changeLanguage('es');
    try {
      const outgoing = mkOutgoing({ d1: mkRecip('d1', 'delivered', 'Eva') });
      render(
        <RecipientList outgoing={outgoing} onRetry={vi.fn()} onInvite={vi.fn()} />,
      );
      // recipient.delivered = "entregado"
      expect(screen.getByText('entregado')).toBeInTheDocument();
      // trip.share.friend_one = "amigo"
      expect(screen.getByText(/Compartido con 1 de 1 amigo/)).toBeInTheDocument();
    } finally {
      // Restore the English locale for the rest of the suite.
      await i18n.changeLanguage('en');
    }
  });
});