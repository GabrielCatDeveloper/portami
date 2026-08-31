// ============================================================
// /connect?o=...&u=...&a=...&t=...&v=1
//
// The receiver side of the invite flow:
//   1. Parse query params.
//   2. Validate the invite.
//   3. Bootstrap a WebRTC peer via useSyncStore.joinWithOffer().
//      This emits the answer SDP from the receiver side.
//   4. Display the answer + a copy button + share intents so the
//      user can send it back to the emitter via WhatsApp / SMS.
//
// The full pairing ceremony (verify pair code, identity transfer,
// sync entities) runs underneath — once the emitter processes the
// answer, the connection completes and the trip-share-start arrives.
// ============================================================
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSyncStore } from '@/sync';
import { useIdentityStore } from '@/state/identity';
import {
  parseInviteLink,
  buildAnswerBackUrl,
  defaultAnswerBackText,
  whatsappShareUrl,
  telegramShareUrl,
  smsShareUrl,
} from '@/sync/invite';
import { ArrowLeft, Copy, Share as ShareIcon, ArrowUpRight, Info, AlertTriangle, Check } from '@/components/icons';

type State =
  | { kind: 'loading' }
  | { kind: 'invalid'; error: string }
  | { kind: 'needsIdentity' }
  | { kind: 'generating' }
  | { kind: 'ready'; answer: string; emitterAlias?: string }
  | { kind: 'error'; message: string };

export default function ConnectPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sync = useSyncStore();
  const identity = useIdentityStore();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Step 1: parse
      const parsed = parseInviteLink(searchParams);
      if (!parsed.ok) {
        if (!cancelled) setState({ kind: 'invalid', error: parsed.error });
        return;
      }
      // Step 2: identity gate — receiver needs to have an identity to
      // bootstrap the WebRTC peer (the emitter will transfer theirs
      // once the connection opens, but we need a deviceKey first).
      if (!identity.initialized) {
        // App.tsx kicks init on mount; if it's still pending, wait
        // one tick and try again.
        await new Promise((r) => setTimeout(r, 50));
      }
      if (!identity.anonId) {
        if (!cancelled) setState({ kind: 'needsIdentity' });
        return;
      }

      // Step 3: bootstrap + answer
      if (!cancelled) setState({ kind: 'generating' });
      try {
        const answer = await sync.joinWithOffer(parsed.offer);
        if (cancelled) return;
        setState({
          kind: 'ready',
          answer,
          emitterAlias: parsed.emitterAlias,
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // We intentionally don't depend on `identity` mid-effect — the
    // effect re-runs when the search params change, which is enough
    // for the typical mount path (identity is initialized by App).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const lang = (i18n.language?.slice(0, 2) || 'es') as 'es' | 'ca' | 'en';

  // ----- Render branches -----
  if (state.kind === 'loading') {
    return <Shell title={t('connect.title')} onBack={() => navigate(-1)}>…</Shell>;
  }
  if (state.kind === 'invalid') {
    return (
      <Shell title={t('connect.invalidLink')} onBack={() => navigate(-1)}>
        <div className="banner banner-danger">
          <AlertTriangle size={18} />
          <span>{state.error}</span>
        </div>
      </Shell>
    );
  }
  if (state.kind === 'needsIdentity') {
    return (
      <Shell title={t('connect.title')} onBack={() => navigate(-1)}>
        <div className="banner banner-info">
          <Info size={18} />
          <span>{t('home.noActiveTrip') /* placeholder */}</span>
        </div>
      </Shell>
    );
  }
  if (state.kind === 'generating') {
    return (
      <Shell
        title={t('connect.title')}
        subtitle={t('connect.generating')}
        onBack={() => navigate(-1)}
      >
        <div className="skeleton" style={{ height: 80 }} />
      </Shell>
    );
  }
  if (state.kind === 'error') {
    return (
      <Shell title={t('connect.error')} onBack={() => navigate(-1)}>
        <div className="banner banner-danger">
          <AlertTriangle size={18} />
          <span>{state.message}</span>
        </div>
      </Shell>
    );
  }

  // state.kind === 'ready'
  const emitterLabel = state.emitterAlias ?? t('connect.title');
  const answerUrl = buildAnswerBackUrl({
    emitterAnonId: identity.anonId ?? '',
    answer: state.answer,
  });
  const text = defaultAnswerBackText({
    emitterAlias: state.emitterAlias,
    answerBackUrl: answerUrl,
    language: lang,
  });
  const waUrl = whatsappShareUrl(text);
  const tgUrl = telegramShareUrl(text, answerUrl);
  const smsUrl = smsShareUrl(text);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(answerUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  const onNativeShare = async () => {
    if (typeof navigator.share !== 'function') return;
    try {
      await navigator.share({ text, url: answerUrl });
    } catch {
      /* dismissed */
    }
  };
  const hasNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <Shell
      title={t('connect.answerReady')}
      subtitle={t('connect.sendBack', { alias: emitterLabel })}
      onBack={() => navigate(-1)}
    >
      <p className="text-sm text-muted mb-2">{t('connect.answerCopyHint', { alias: emitterLabel })}</p>
      <textarea
        className="textarea"
        readOnly
        value={answerUrl}
        rows={4}
        style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
      />
      <div className="row gap-2 mt-3" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-sm" onClick={onCopy}>
          <Copy size={14} /> {copied ? t('invite.copied') : t('invite.copy')}
        </button>
        {hasNativeShare && (
          <button type="button" className="btn btn-sm btn-primary" onClick={onNativeShare}>
            <ShareIcon size={14} /> {t('invite.share')}
          </button>
        )}
      </div>

      <div className="mt-3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <a className="btn btn-sm" href={waUrl} target="_blank" rel="noopener noreferrer">
          <ArrowUpRight size={14} /> {t('invite.whatsapp')}
        </a>
        <a className="btn btn-sm" href={tgUrl} target="_blank" rel="noopener noreferrer">
          <ArrowUpRight size={14} /> {t('invite.telegram')}
        </a>
        <a className="btn btn-sm" href={smsUrl}>
          <ArrowUpRight size={14} /> {t('invite.sms')}
        </a>
      </div>

      <div className="banner banner-info mt-3">
        <Check size={18} />
        <span>{t('connect.success')}</span>
      </div>
    </Shell>
  );
}

function Shell({
  title,
  subtitle,
  onBack,
  children,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="btn-icon btn" onClick={onBack} aria-label="Volver">
          <ArrowLeft />
        </button>
        <h1 style={{ flex: 1 }}>{title}</h1>
      </header>
      {subtitle && <p className="text-sm text-muted mb-3">{subtitle}</p>}
      {children}
    </div>
  );
}
