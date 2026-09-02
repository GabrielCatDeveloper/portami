// ============================================================
// Small inline modal used to collect a passphrase (e.g. for the
// identity backup) without relying on the blocking `window.prompt`
// (which doesn't work in some embedded contexts, freezes the JS
// thread, and is unstyled/inaccessible).
// ============================================================
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from '@/components/icons';

export type PassphrasePromptProps = {
  title: string;
  description?: string;
  /** Whether to require the user to type the passphrase twice. */
  confirm?: boolean;
  /** Minimum length enforced before the submit button enables. */
  minLength?: number;
  onSubmit: (passphrase: string) => void;
  onCancel: () => void;
};

export function PassphrasePrompt({
  title,
  description,
  confirm = false,
  minLength = 8,
  onSubmit,
  onCancel,
}: PassphrasePromptProps) {
  const { t } = useTranslation();
  const [pass, setPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Stable ids so multiple PassphrasePrompts on the same page (rare)
  // don't collide on label-input association.
  const passId = `passphrase-${useId()}`;
  const confirmId = `passphrase-confirm-${useId()}`;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    if (pass.length < minLength) {
      setError(t('passphrase.tooShort', { n: minLength }));
      return;
    }
    if (confirm && pass !== confirmPass) {
      setError(t('passphrase.mismatch'));
      return;
    }
    onSubmit(pass);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="passphrase-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 1100,
      }}
      onClick={onCancel}
    >
      <div
        className="card"
        style={{ maxWidth: 420, width: '100%', margin: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-header">
          <div id="passphrase-modal-title" className="card-title" style={{ flex: 1 }}>
            {title}
          </div>
          <button
            type="button"
            className="btn-icon btn btn-ghost"
            onClick={onCancel}
            aria-label={t('common.cancelAria')}
          >
            <X size={18} />
          </button>
        </div>

        {description && (
          <p className="text-sm text-muted mb-3">{description}</p>
        )}

        <div className="field">
          <label className="field-label" htmlFor={passId}>{t('passphrase.label')}</label>
          <input
            id={passId}
            ref={inputRef}
            type="password"
            className="input"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !confirm) submit();
              else if (e.key === 'Escape') onCancel();
            }}
            autoComplete="new-password"
            placeholder={t('passphrase.minPlaceholder', { n: minLength })}
          />
        </div>

        {confirm && (
          <div className="field">
            <label className="field-label" htmlFor={confirmId}>{t('passphrase.confirmLabel')}</label>
            <input
              id={confirmId}
              type="password"
              className="input"
              value={confirmPass}
              onChange={(e) => setConfirmPass(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
                else if (e.key === 'Escape') onCancel();
              }}
              autoComplete="new-password"
            />
          </div>
        )}

        {error && (
          <div className="banner banner-danger mb-3 text-sm">{error}</div>
        )}

        <div className="row gap-2">
          <button type="button" className="btn flex-1" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary flex-1"
            onClick={submit}
            disabled={pass.length < minLength || (confirm && pass !== confirmPass)}
          >
            {t('common.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}