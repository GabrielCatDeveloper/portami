// ============================================================
// RecipientList — live status of each paired friend for the
// active outgoing trip share.
//
// Why a standalone component:
//   - The Trip page wires together many concerns (geolocation,
//     detector, alerts, share bridge). Embedding the recipient UI
//     inline meant we couldn't render it in isolation, so the chip
//     colour + retry + invite flow had zero unit-test coverage.
//   - Extracting it lets us test the chip variants, the retry /
//     invite button rendering, and the summary plural without
//     standing up the full Trip page tree.
//
// Props are deliberately minimal — we accept the callbacks that
// the parent already uses, plus the `outgoing` shape directly.
// This keeps the component decoupled from the Zustand store
// (which makes it trivial to test: render with a synthetic
// outgoing).
// ============================================================

import { useTranslation } from 'react-i18next';
import { recipientChip } from '@/state/tripShare';
import { Sync as SyncIcon, ArrowUpRight } from '@/components/icons';
import type { OutgoingTripShare } from '@/api/types';

export type RecipientListProps = {
  /** Active outgoing share. If null, the component renders nothing. */
  outgoing: OutgoingTripShare | null;
  /** Called when the user taps "Retry" on a failed recipient. */
  onRetry: (deviceId: string) => void;
  /** Called when the user taps "Invite via another app". */
  onInvite: (deviceId: string, alias?: string) => void;
};

export function RecipientList({ outgoing, onRetry, onInvite }: RecipientListProps) {
  const { t } = useTranslation();
  if (!outgoing) return null;
  const recipients = Object.values(outgoing.recipients);
  if (recipients.length === 0) {
    return (
      <p className="text-sm text-muted mb-3">{t('trip.share.noRecipients')}</p>
    );
  }
  const delivered = recipients.filter((r) => r.status === 'delivered').length;
  return (
    <div className="mb-3" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="text-xs text-muted">
        {t('trip.share.summary', {
          delivered,
          total: recipients.length,
          friend: t(recipients.length === 1 ? 'trip.share.friend_one' : 'trip.share.friend_other'),
        })}
      </div>
      {recipients.map((r) => {
        const chip = recipientChip(r.status);
        const canRetry = r.status === 'failed' || r.status === 'unreachable';
        const colour =
          chip.variant === 'success' ? 'var(--success)'
          : chip.variant === 'danger' ? 'var(--danger)'
          : chip.variant === 'warning' ? 'var(--warning)'
          : 'var(--muted)';
        return (
          <div
            key={r.deviceId}
            className="row gap-2"
            style={{
              alignItems: 'center',
              padding: '8px 10px',
              background: 'var(--bg-subtle)',
              borderRadius: 'var(--r-md)',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                minWidth: 24,
                color: colour,
              }}
              aria-hidden
            >
              {chip.icon}
            </span>
            <div style={{ flex: 1, fontSize: 'var(--fs-sm)' }}>
              <div style={{ fontWeight: 600 }}>{r.alias ?? r.deviceId.slice(0, 8)}</div>
              <div className="text-xs text-muted">{t(chip.i18nKey)}</div>
            </div>
            {canRetry && (
              <>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => onRetry(r.deviceId)}
                  aria-label={t('trip.share.retry')}
                  title={t('trip.share.retryTitle')}
                >
                  <SyncIcon size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => onInvite(r.deviceId, r.alias)}
                  aria-label={t('trip.share.invite')}
                  title={t('trip.share.inviteTitle')}
                >
                  <ArrowUpRight size={14} />
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}