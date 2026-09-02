// ============================================================
// Inline confirm dialog used in place of `window.confirm()`. The
// native confirm freezes the JS thread, is unstyled and breaks
// inside cross-origin iframes; this component renders an inline
// modal with proper a11y semantics.
// ============================================================
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, X } from '@/components/icons';

export type ConfirmDialogProps = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
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
          <div
            className="list-item-icon"
            style={{
              background: variant === 'danger' ? 'var(--danger)' : 'var(--warning)',
              color: 'white',
            }}
          >
            <AlertTriangle size={20} />
          </div>
          <div id="confirm-dialog-title" className="card-title" style={{ flex: 1 }}>
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

        <div className="row gap-2">
          <button type="button" className="btn flex-1" onClick={onCancel}>
            {cancelLabel ?? t('common.cancel')}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`btn flex-1 ${variant === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onCancel();
            }}
          >
            {confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}