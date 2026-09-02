import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QR, Camera, Sync as SyncIcon, Copy, AlertTriangle, Check } from '@/components/icons';
import { useSyncStore } from '@/sync';
import type { PairedDevice } from '@/api/types';

export default function SyncPage() {
  const { t } = useTranslation();
  const sync = useSyncStore();
  const phase = sync.phase;
  const loadPairedDevices = sync.loadPairedDevices;
  const [pasteValue, setPasteValue] = useState('');
  const [copied, setCopied] = useState(false);
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [showJoinPaste, setShowJoinPaste] = useState(false);

  useEffect(() => {
    void loadPairedDevices().then(setDevices);
  }, [phase, loadPairedDevices]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — user can still paste manually.
    }
  };

  const onStartPair = async () => {
    try {
      const offer = await sync.createOfferAndWait();
      setPasteValue(offer);
    } catch (e) {
      console.error(e);
    }
  };

  const onJoin = async () => {
    if (!pasteValue.trim()) return;
    try {
      const answer = await sync.joinWithOffer(pasteValue.trim());
      setPasteValue(answer);
    } catch (e) {
      console.error(e);
    }
  };

  const onFinishInitiator = async () => {
    if (!pasteValue.trim()) return;
    await sync.finishPairingAsInitiator(pasteValue.trim());
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1>{t('sync.pair')}</h1>
      </header>

      {sync.phase === 'idle' && (
        <>
          <div className="empty">
            <div className="empty-illustration">
              <SyncIcon size={48} />
            </div>
            <h3>{t('sync.pair')}</h3>
            <p className="mb-4">
              Sincroniza tu identidad, rutas y propuestas con otro dispositivo por WebRTC. Sin servidor intermedio.
            </p>

            <div
              className="sync-actions"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                width: '100%',
                maxWidth: 360,
                margin: '0 auto',
              }}
            >
              <button type="button" className="btn btn-primary btn-lg btn-block" onClick={onStartPair}>
                <QR size={20} /> {t('sync.pairInit')}
              </button>
              <button
                type="button"
                className="btn btn-lg btn-block"
                onClick={() => {
                  setShowJoinPaste(true);
                  setPasteValue('');
                }}
              >
                <Camera size={20} /> {t('sync.pairJoin')}
              </button>
            </div>
          </div>

          <section className="card mt-4">
            {showJoinPaste && sync.phase === 'idle' && (
            <section className="card mb-4" style={{ maxWidth: 360, width: '100%', margin: '0 auto' }}>
              <div className="card-title mb-2">Pegar offer del otro dispositivo</div>
              <p className="text-sm text-muted mb-2">
                Copia el offer SDP que te ha pasado tu amigo y pégalo aquí.
              </p>
              <textarea
                className="textarea"
                value={pasteValue}
                onChange={(e) => setPasteValue(e.target.value)}
                placeholder='{"type":"offer","sdp":"v=0..."}'
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12, minHeight: 100 }}
              />
              <div className="row gap-2 mt-3">
                <button
                  type="button"
                  className="btn flex-1"
                  onClick={() => setShowJoinPaste(false)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-primary flex-1"
                  onClick={() => {
                    setShowJoinPaste(false);
                    void onJoin();
                  }}
                  disabled={!pasteValue.trim()}
                >
                  Empezar
                </button>
              </div>
            </section>
          )}

          <div className="card-title mb-2">{t('sync.devices')}</div>
            {devices.length === 0 ? (
              <p className="text-sm text-muted">{t('sync.noDevices')}</p>
            ) : (
              <div className="list">
                {devices.map((d) => (
                  <div key={d.deviceId} className="list-item">
                    <div className="list-item-icon">
                      <SyncIcon size={20} />
                    </div>
                    <div className="list-item-body">
                      <div className="list-item-title">{d.alias}</div>
                      <div className="list-item-sub">
                        #{d.pubKey.slice(0, 8)} · {t('sync.syncNow')}: {new Date(d.lastSeenAt).toLocaleString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => void sync.revokeDevice(d.deviceId).then(() => void sync.loadPairedDevices().then(setDevices))}
                    >
                      {t('sync.revoke')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {(sync.phase === 'awaiting-peer') && (
        <section className="card mb-4">
          <h3 className="mb-2">{sync.role === 'initiator' ? 'Tu offer SDP' : 'Generando respuesta…'}</h3>
          <p className="text-sm text-muted mb-3">
            {sync.role === 'initiator'
              ? 'Copia este código y pégalo en el otro dispositivo. Luego pega la respuesta del otro dispositivo abajo.'
              : 'Tu código de respuesta se mostrará a continuación. Cópialo en el dispositivo iniciador.'}
          </p>
          <textarea
            className="textarea"
            readOnly
            value={sync.myOffer ?? sync.progress ?? ''}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 12, minHeight: 120 }}
          />
          <div className="row gap-2 mt-3">
            <button type="button" className="btn flex-1" onClick={() => void copy(sync.myOffer ?? '')}>
              <Copy size={16} /> {copied ? '✓' : 'Copiar'}
            </button>
          </div>

          {sync.role === 'initiator' && (
            <div className="mt-4">
              <label className="field-label">Pega aquí la respuesta del otro dispositivo:</label>
              <textarea
                className="textarea"
                value={pasteValue}
                onChange={(e) => setPasteValue(e.target.value)}
                placeholder='{"type":"answer","sdp":...}'
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12, minHeight: 100 }}
              />
              <button
                type="button"
                className="btn btn-primary btn-block mt-3"
                onClick={onFinishInitiator}
                disabled={!pasteValue.trim()}
              >
                {t('sync.confirm')}
              </button>
            </div>
          )}
        </section>
      )}

      {(sync.phase === 'verifying' || sync.phase === 'transferring' || sync.phase === 'syncing') && (
        <section className="card mb-4 text-center">
          <div className="empty-illustration" style={{ margin: '0 auto 16px' }}>
            <SyncIcon size={40} />
          </div>
          <h3>{(sync.phase === 'verifying' && 'Verificando emparejamiento') ||
               (sync.phase === 'transferring' && 'Transfiriendo identidad cifrada') ||
               (sync.phase === 'syncing' && 'Sincronizando datos')}</h3>

          {sync.pairCode && sync.phase === 'verifying' && (
            <>
              <p className="text-sm text-muted mb-3">Comprueba que el código coincide en ambos dispositivos</p>
              <div style={{
                fontSize: 36,
                fontWeight: 800,
                fontFamily: 'var(--font-mono)',
                letterSpacing: 8,
                color: 'var(--brand-700)',
                margin: '12px 0',
              }}>
                {sync.pairCode}
              </div>
              <div className="text-sm text-muted">Dispositivo: {sync.peerAlias ?? '…'}</div>
            </>
          )}
          {sync.progress && sync.phase !== 'verifying' && (
            <p className="text-sm text-muted">{sync.progress}</p>
          )}
          <button type="button" className="btn btn-block mt-4" onClick={() => sync.reset()}>
            {t('sync.cancel')}
          </button>
        </section>
      )}

      {sync.phase === 'success' && (
        <section className="card text-center mb-4" style={{ background: 'var(--brand-50)' }}>
          <div className="empty-illustration" style={{ margin: '0 auto 16px', background: 'var(--brand-600)', color: 'white' }}>
            <Check size={40} />
          </div>
          <h3>{t('sync.success')}</h3>
          <p className="text-sm text-muted">{sync.progress}</p>
          <button type="button" className="btn btn-primary btn-block mt-4" onClick={() => sync.reset()}>
            OK
          </button>
        </section>
      )}

      {sync.phase === 'error' && (
        <section className="card text-center mb-4" style={{ background: '#fee2e2' }}>
          <div className="empty-illustration" style={{ margin: '0 auto 16px', background: 'var(--danger)', color: 'white' }}>
            <AlertTriangle size={40} />
          </div>
          <h3>{sync.error ?? 'Error'}</h3>
          <button type="button" className="btn btn-primary btn-block mt-4" onClick={() => sync.reset()}>
            {t('sync.cancel')}
          </button>
        </section>
      )}
    </div>
  );
}