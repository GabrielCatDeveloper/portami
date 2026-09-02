// ============================================================
// /connect-back?a=<answer>&for=<emitter-anonId>&v=1
//
// The emitter side of the invite flow:
//   1. Parse the answer-back URL.
//   2. Verify the `for` field matches my anonId (otherwise it was
//      meant for someone else; refuse).
//   3. Hand the answer to useSyncStore.finishPairingAsInitiator().
//      This finishes the pairing the emitter started when they
//      generated the offer.
//   4. The full pairing flow runs (pair-code verification, identity
//      transfer, sync). On success, the connection becomes `connected`
//      and the trip-share-start flows automatically.
// ============================================================
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSyncStore } from '@/sync';
import { useIdentityStore } from '@/state/identity';
import { parseAnswerBackLink } from '@/sync/invite';
import { ArrowLeft, AlertTriangle, Check, Info } from '@/components/icons';

type State =
  | { kind: 'processing' }
  | { kind: 'invalid'; error: string }
  | { kind: 'notForYou'; forAnonId: string }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

export default function ConnectBackPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sync = useSyncStore();
  const identity = useIdentityStore();
  const [state, setState] = useState<State>({ kind: 'processing' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const parsed = parseAnswerBackLink(searchParams);
      if (!parsed.ok) {
        if (!cancelled) setState({ kind: 'invalid', error: parsed.error });
        return;
      }
      if (parsed.forAnonId !== identity.anonId) {
        if (!cancelled) {
          setState({ kind: 'notForYou', forAnonId: parsed.forAnonId });
        }
        return;
      }

      try {
        await sync.finishPairingAsInitiator(parsed.answer);
        if (cancelled) return;
        // Check whether the pairing actually completed (the store may
        // have moved to phase === 'error' for some reason).
        if (sync.phase === 'error') {
          setState({ kind: 'error', message: sync.error ?? t('connect.pairingFailed') });
          return;
        }
        setState({ kind: 'success' });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="btn-icon btn" onClick={() => navigate(-1)} aria-label={t('connect.back')}>
          <ArrowLeft />
        </button>
        <h1 style={{ flex: 1 }}>
          {state.kind === 'success' ? t('connect.success') : t('connect.processing')}
        </h1>
      </header>

      {state.kind === 'processing' && (
        <div className="card text-center">
          <div className="empty-illustration" style={{ margin: '0 auto 16px' }}>
            <Info size={40} />
          </div>
          <p className="text-sm text-muted">{t('connect.processing')}</p>
        </div>
      )}

      {state.kind === 'invalid' && (
        <div className="banner banner-danger">
          <AlertTriangle size={18} />
          <span>{t('connect.invalidLink')}: {state.error}</span>
        </div>
      )}

      {state.kind === 'notForYou' && (
        <div className="banner banner-warning">
          <AlertTriangle size={18} />
          <span>{t('connect.notForYouFor', { anonId: state.forAnonId.slice(0, 6) })}</span>
        </div>
      )}

      {state.kind === 'error' && (
        <div className="banner banner-danger">
          <AlertTriangle size={18} />
          <span>{t('connect.error')}: {state.message}</span>
        </div>
      )}

      {state.kind === 'success' && (
        <>
          <div className="banner banner-success mb-3">
            <Check size={18} />
            <span>{t('connect.success')}</span>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => navigate('/trip')}
          >
            {t('common.ok', { defaultValue: 'OK' })}
          </button>
        </>
      )}
    </div>
  );
}
