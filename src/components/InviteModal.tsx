// ============================================================
// InviteModal — generates an invite deeplink for a single paired
// friend and offers share intents (Web Share, WhatsApp, Telegram,
// SMS, copy). The actual deeplink creation is in @/sync/invite.
//
// Flow:
//   - User clicks the 📤 button next to an unreachable recipient.
//   - We generate an offer SDP via createInviteLink().
//   - We display the link + buttons. Picking one fires the intent.
//   - User sends via WhatsApp / Telegram / SMS / native share.
//
// Limitations (Opción A, no server):
//   - Friend opens link → generates answer on their device → has to
//     paste/send it back. The receiver page (/connect) handles that.
// ============================================================
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createInviteLink,
  defaultInviteText,
  whatsappShareUrl,
  telegramShareUrl,
  smsShareUrl,
} from '@/sync/invite';
import { X, Copy, Share as ShareIcon, ArrowUpRight } from '@/components/icons';

export type InviteModalProps = {
  /** The paired friend's deviceId (just for record-keeping / logs). */
  recipientDeviceId: string;
  /** The paired friend's alias (display name in the modal title + text). */
  recipientAlias?: string;
  /** Optional tripShareId to attach so the receiver knows which share to expect. */
  tripShareId?: string;
  /** The my anon id (for verification on the receiver side). */
  emitterAnonId: string;
  onClose: () => void;
};

type State =
  | { kind: 'idle' }
  | { kind: 'generating' }
  | { kind: 'ready'; url: string }
  | { kind: 'error'; message: string };

export function InviteModal({
  recipientDeviceId,
  recipientAlias,
  tripShareId,
  emitterAnonId,
  onClose,
}: InviteModalProps) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);

  // Generate the link lazily once the modal opens.
  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'generating' });
    (async () => {
      try {
        const url = await createInviteLink({
          emitterAnonId,
          emitterAlias: recipientAlias,
          tripShareId,
        });
        if (!cancelled) setState({ kind: 'ready', url });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recipientDeviceId, emitterAnonId, recipientAlias, tripShareId]);

  const lang = (i18n.language?.slice(0, 2) || 'es') as 'es' | 'ca' | 'en';
  const text = state.kind === 'ready'
    ? defaultInviteText({
        emitterAlias: recipientAlias,
        inviteUrl: state.url,
        language: lang,
      })
    : '';
  const waUrl = state.kind === 'ready' ? whatsappShareUrl(text) : '';
  const tgUrl = state.kind === 'ready' ? telegramShareUrl(text, state.url) : '';
  const smsUrl = state.kind === 'ready' ? smsShareUrl(text) : '';

  const onCopy = async () => {
    if (state.kind !== 'ready') return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: select the textarea content.
    }
  };

  const onNativeShare = async () => {
    if (state.kind !== 'ready') return;
    if (!navigator.share) return;
    try {
      await navigator.share({ text, url: state.url });
    } catch {
      /* user dismissed */
    }
  };

  const hasNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ maxWidth: 460, width: '100%', margin: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-header">
          <div style={{ flex: 1 }}>
            <div id="invite-modal-title" className="card-title">
              {t('invite.title', { name: recipientAlias ?? recipientDeviceId.slice(0, 6) })}
            </div>
            <div className="card-subtitle">{t('invite.subtitle')}</div>
          </div>
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            onClick={onClose}
            aria-label={t('invite.cancel')}
          >
            <X size={18} />
          </button>
        </div>

        {state.kind === 'generating' && (
          <p className="text-sm text-muted mb-2">{t('invite.generating')}</p>
        )}

        {state.kind === 'error' && (
          <div className="banner banner-danger">
            <span>{t('invite.error')}: {state.message}</span>
          </div>
        )}

        {state.kind === 'ready' && (
          <>
            <label className="field-label" htmlFor="invite-textarea">
              {t('invite.shareVia')}
            </label>
            <textarea
              id="invite-textarea"
              className="textarea"
              readOnly
              value={text}
              rows={4}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
            <div
              className="row gap-2 mt-3"
              style={{ flexWrap: 'wrap', justifyContent: 'space-between' }}
            >
              <button type="button" className="btn btn-sm" onClick={onCopy}>
                <Copy size={14} /> {copied ? t('invite.copied') : t('invite.copy')}
              </button>
              {hasNativeShare && (
                <button type="button" className="btn btn-sm btn-primary" onClick={onNativeShare}>
                  <ShareIcon size={14} /> {t('invite.share')}
                </button>
              )}
            </div>

            <div
              className="mt-3"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: 8,
              }}
            >
              <a
                className="btn btn-sm"
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ArrowUpRight size={14} /> {t('invite.whatsapp')}
              </a>
              <a
                className="btn btn-sm"
                href={tgUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ArrowUpRight size={14} /> {t('invite.telegram')}
              </a>
              <a className="btn btn-sm" href={smsUrl}>
                <ArrowUpRight size={14} /> {t('invite.sms')}
              </a>
            </div>

            <p className="text-xs text-muted mt-3">
              {t('connect.waitingSubtitle')}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
