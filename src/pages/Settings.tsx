import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS } from '@/i18n';
import { useIdentityStore } from '@/state/identity';
import { useTestingStore } from '@/state/testing';
import { useCollaborateStore } from '@/state/collaborate';
import { useSyncStore } from '@/sync';
import { Key, Copy, Download, Upload, AlertTriangle, ChevronDown, Sync as SyncIcon, Trash, Beaker, Info, Share } from '@/components/icons';
import { PassphrasePrompt } from '@/components/PassphrasePrompt';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { PairedDevice } from '@/api/types';
import {
  exportMyRoutesAsGeoJSON,
  importGeoJSON,
  downloadFile,
  pickFile,
} from '@/io/geojson';
import {
  exportIdentityBackup,
  importIdentityBackup,
  downloadBackup,
  pickBackupFile,
} from '@/io/identityBackup';

type PromptMode =
  | { kind: 'export' }
  | { kind: 'import'; file: Awaited<ReturnType<typeof pickBackupFile>> }
  | { kind: 'regenerate' }
  | { kind: 'revoke'; device: PairedDevice };

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const identity = useIdentityStore((s) => s.identity);
  const anonId = useIdentityStore((s) => s.anonId);
  const regenerate = useIdentityStore((s) => s.regenerate);
  const importFromJwk = useIdentityStore((s) => s.importFromJwk);
  const testing = useTestingStore();
  const collaborate = useCollaborateStore();
  const sync = useSyncStore();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDanger, setShowDanger] = useState(false);
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);
  const [prompt, setPrompt] = useState<PromptMode | null>(null);

  // Load paired devices for the Sync card
  const reloadDevices = async () => {
    try {
      const list = await sync.loadPairedDevices();
      setPairedDevices(list);
    } catch {
      setPairedDevices([]);
    }
  };
  useEffect(() => {
    void reloadDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync]);

  if (!identity) return null;

  const copyPub = async () => {
    try {
      await navigator.clipboard.writeText(identity.pubKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (insecure context or denied permission);
      // silently ignore — the pubKey is still visible in the advanced panel.
    }
  };

  const flash = (msg: string, isError = false) => {
    setLastResult(isError ? null : msg);
    setLastError(isError ? msg : null);
    setTimeout(() => {
      setLastResult(null);
      setLastError(null);
    }, 5000);
  };

  // ---- Identity backup / restore ----
  const onExportIdentity = () => setPrompt({ kind: 'export' });

  const onImportIdentity = async () => {
    const file = await pickBackupFile();
    if (!file) return;
    setPrompt({ kind: 'import', file });
  };

  const handlePassphraseSubmit = async (passphrase: string) => {
    const mode = prompt;
    setPrompt(null);
    if (!mode || !identity) return;

    if (mode.kind === 'export') {
      setBusy('export-id');
      try {
        const backup = await exportIdentityBackup({
          pubKey: identity.pubKey,
          anonId: anonId ?? '',
          privKeyJwk: identity.privKeyJwk,
          passphrase,
        });
        downloadBackup(backup, anonId ?? 'me');
        flash(t('settings.flash.identityExported'));
      } catch (e) {
        flash(t('settings.flash.error', { msg: e instanceof Error ? e.message : String(e) }), true);
      } finally {
        setBusy(null);
      }
      return;
    }

    if (mode.kind === 'import') {
      if (!mode.file) return;
      setBusy('import-id');
      try {
        const jwk = await importIdentityBackup({ backup: mode.file, passphrase });
        await importFromJwk(jwk);
        flash(t('settings.flash.identityImported', { anonId: mode.file.anonId }));
      } catch (e) {
        flash(t('settings.flash.error', { msg: e instanceof Error ? e.message : String(e) }), true);
      } finally {
        setBusy(null);
      }
    }
  };

  // ---- GeoJSON routes ----
  const onExport = async () => {
    setBusy('export');
    try {
      const data = await exportMyRoutesAsGeoJSON();
      const json = JSON.stringify(data, null, 2);
      downloadFile(json, `portami-rutas-${anonId ?? 'me'}.geojson`);
      flash(t('settings.flash.geoJsonExported', { n: data.features.length }));
    } catch (e) {
      flash(t('settings.flash.error', { msg: e instanceof Error ? e.message : String(e) }), true);
    } finally {
      setBusy(null);
    }
  };

  const onImport = async () => {
    const file = await pickFile();
    if (!file) return;
    setBusy('import');
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await importGeoJSON(json, {});
      flash(
        t('settings.flash.geoJsonImported', res) +
          (res.readonly ? t('settings.flash.geoJsonImportedReadonly') : ''),
      );
    } catch (e) {
      flash(t('settings.flash.error', { msg: e instanceof Error ? e.message : String(e) }), true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1>{t('settings.title')}</h1>
      </header>

      {/* Language */}
      <section className="card mb-4">
        <div className="card-header">
          <div className="card-title">{t('settings.language')}</div>
        </div>
        <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
          {SUPPORTED_LANGUAGES.map((lng) => (
            <button
              key={lng}
              type="button"
              data-testid={`lang-${lng}`}
              className={`chip ${i18n.language.startsWith(lng) ? 'active' : ''}`}
              onClick={() => {
                void i18n.changeLanguage(lng);
                localStorage.setItem('portami.lang', lng);
              }}
            >
              {LANGUAGE_LABELS[lng]}
            </button>
          ))}
        </div>
      </section>

      {/* Identity — the headline block */}
      <section className="card mb-4">
        <div className="card-header">
          <div className="list-item-icon"><Key size={20} /></div>
          <div style={{ flex: 1 }}>
            <div className="card-title">{t('settings.identityTitle')}</div>
            <div className="card-subtitle">{t('settings.identitySubtitle')}</div>
          </div>
        </div>

        <div
          style={{
            padding: '16px',
            background: 'var(--bg-subtle)',
            borderRadius: 'var(--r-md)',
            textAlign: 'center',
            marginBottom: '12px',
          }}
        >
          <div className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
            {t('settings.anonId')}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 800,
              fontSize: 28,
              color: 'var(--brand-700)',
              marginTop: 4,
              letterSpacing: 1,
            }}
          >
            #{anonId}
          </div>
          <div className="text-xs text-muted mt-2">
            {t('settings.identityPublicHint')}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <button
            type="button"
            className="btn btn-block"
            disabled={busy === 'export-id'}
            onClick={() => void onExportIdentity()}
          >
            <Download size={18} /> {t('settings.exportIdentity')}
          </button>
          <button
            type="button"
            className="btn btn-block"
            disabled={busy === 'import-id'}
            onClick={() => void onImportIdentity()}
          >
            <Upload size={18} /> {t('settings.importIdentity')}
          </button>
        </div>

        {lastResult && (
          <div className="banner banner-success mt-3 text-sm">{lastResult}</div>
        )}
        {lastError && (
          <div className="banner banner-danger mt-3 text-sm">{lastError}</div>
        )}

        {/* Advanced — hidden by default */}
        <button
          type="button"
          className="btn btn-ghost btn-sm mt-3"
          style={{ width: '100%', justifyContent: 'space-between' }}
          onClick={() => setShowAdvanced((v) => !v)}
        >
          <span>{t('settings.advanced')}</span>
          <ChevronDown
            size={16}
            style={{ transform: showAdvanced ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
          />
        </button>

        {showAdvanced && (
          <div className="mt-3" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="field">
              <label className="field-label">{t('settings.publicKeyHex')}</label>
              <div className="row gap-2">
                <code
                  style={{
                    flex: 1,
                    padding: '12px 14px',
                    background: 'var(--bg-subtle)',
                    borderRadius: 'var(--r-md)',
                    fontSize: 'var(--fs-xs)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {identity.pubKey}
                </code>
                <button type="button" className="btn btn-sm" onClick={copyPub}>
                  <Copy size={16} /> {copied ? t('settings.copied') : ''}
                </button>
              </div>
              <div className="field-hint">
                {t('settings.publicKeyHint')}
              </div>
            </div>
          </div>
        )}

        {/* Danger zone — hidden by default */}
        <button
          type="button"
          className="btn btn-ghost btn-sm mt-2"
          style={{ width: '100%', justifyContent: 'space-between', color: 'var(--danger)' }}
          onClick={() => setShowDanger((v) => !v)}
        >
          <span>{t('settings.dangerZone')}</span>
          <ChevronDown
            size={16}
            style={{ transform: showDanger ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
          />
        </button>

        {showDanger && (
          <div className="mt-3">
            <p className="text-sm text-muted mb-2">
              {t('settings.regenerateHint')}
            </p>
            <button
              type="button"
              className="btn btn-danger btn-block"
              onClick={() => setPrompt({ kind: 'regenerate' })}
            >
              <AlertTriangle size={16} /> {t('settings.regenerate')}
            </button>
          </div>
        )}
      </section>

      {/* GeoJSON routes */}
      <section className="card mb-4">
        <div className="card-header">
          <div className="card-title">{t('settings.myRoutes')}</div>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <button
            type="button"
            className="btn btn-block"
            disabled={busy === 'export'}
            onClick={() => void onExport()}
          >
            <Download size={18} /> {t('settings.exportGeoJSON')}
          </button>
          <button
            type="button"
            className="btn btn-block"
            disabled={busy === 'import'}
            onClick={() => void onImport()}
          >
            <Upload size={18} /> {t('settings.importGeoJSON')}
          </button>
        </div>
      </section>

      {/* Dispositivos emparejados (WebRTC) */}
      <section className="card mb-4">
        <div className="card-header">
          <div className="list-item-icon"><SyncIcon size={20} /></div>
          <div style={{ flex: 1 }}>
            <div className="card-title">{t('settings.syncTitle')}</div>
            <div className="card-subtitle">
              {t('settings.syncSubtitle')}
            </div>
          </div>
        </div>

        {pairedDevices.length > 0 && (
          <div className="list mb-3">
            {pairedDevices.map((d) => (
              <div key={d.deviceId} className="list-item">
                <div className="list-item-icon">
                  <SyncIcon size={20} />
                </div>
                <div className="list-item-body">
                  <div className="list-item-title">{d.alias}</div>
                  <div className="list-item-sub">
                    #{d.pubKey.slice(0, 8)} · {t('settings.lastSync')}{' '}
                    {new Date(d.lastSeenAt).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  aria-label={t('settings.revoke')}
                  onClick={() => setPrompt({ kind: 'revoke', device: d })}
                >
                  <Trash size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        <button type="button" className="btn btn-primary btn-block" onClick={() => navigate('/sync')}>
          <SyncIcon size={18} /> {t('settings.pairNew')}
        </button>
        <button type="button" className="btn btn-block mt-2" onClick={() => navigate('/following')}>
          <ChevronDown size={18} style={{ transform: 'rotate(-90deg)' }} /> {t('settings.viewSharedTrips')}
        </button>
      </section>

      {/* Collaborate mode: opt-in to share the GPS with our
          server. OFF by default. Only the watcher posts to the
          server when this is on; P2P friend sharing is independent
          and has its own toggle. This is the architectural rule
          documented in ROADMAP_FUTURE.md → "Regla de oro de
          privacidad". */}
      <section className="card mb-4" data-testid="settings-collaborate">
        <div className="card-header">
          <div className="list-item-icon" style={{ background: 'var(--brand-700)', color: 'white' }}>
            <Share size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="card-title">{t('collaborate.title')}</div>
            <div className="card-subtitle">{t('collaborate.subtitle')}</div>
          </div>
        </div>
        <label className="row gap-2" style={{ alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            data-testid="collaborate-toggle"
            checked={collaborate.enabled}
            onChange={(e) => collaborate.setEnabled(e.target.checked)}
          />
          <span style={{ fontWeight: 600 }}>{t('collaborate.enable')}</span>
        </label>
        <p className="text-xs text-muted mt-2 mb-0" style={{ lineHeight: 1.4 }}>
          {t('collaborate.description')}
        </p>
        <div
          className="banner banner-info mt-3 mb-0 text-sm"
          style={{ alignItems: 'flex-start' }}
        >
          <Info size={16} />
          <span>
            <strong>{t('collaborate.directOnlyWithFriends')}</strong>{' '}
            {t('collaborate.notTheServer')}
          </span>
        </div>
      </section>

      {/* Testing mode */}
      <section className="card mb-4" data-testid="settings-testing">
        <div className="card-header">
          <div className="list-item-icon" style={{ background: 'var(--accent-500)', color: 'white' }}>
            <Beaker size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="card-title">{t('testing.title')}</div>
            <div className="card-subtitle">{t('testing.subtitle')}</div>
          </div>
        </div>

        <label className="row gap-2" style={{ alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={testing.enabled}
            onChange={(e) => testing.setEnabled(e.target.checked)}
            data-testid="testing-toggle"
          />
          <span style={{ fontWeight: 600 }}>{t('testing.enable')}</span>
        </label>
        <p className="text-xs text-muted mt-2 mb-3">{t('testing.enableHint')}</p>

        {testing.enabled && (
          <div className="field">
            <label className="field-label">{t('testing.gps')}</label>
            <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`chip ${testing.gpsMode === 'simulated' ? 'active' : ''}`}
                onClick={() => testing.setGpsMode('simulated')}
              >
                {t('testing.gpsSimulated')}
              </button>
              <button
                type="button"
                className={`chip ${testing.gpsMode === 'real' ? 'active' : ''}`}
                onClick={() => testing.setGpsMode('real')}
              >
                {t('testing.gpsReal')}
              </button>
            </div>
            <div className="banner banner-info mt-3">
              <span>{t('testing.reloadToApply')}</span>
            </div>
          </div>
        )}

        <p className="text-xs text-muted mt-3">{t('testing.databaseNote')}</p>
      </section>

      {/* Notifications */}
      <section className="card mb-4">
        <div className="card-header">
          <div className="card-title">{t('settings.notifications')}</div>
        </div>
        <button
          type="button"
          className="btn btn-block"
          onClick={async () => {
            const perm = await Notification.requestPermission();
            if (perm === 'granted') {
              new Notification('portami', { body: t('app.tagline') });
            }
          }}
        >
          {t('settings.notifPermission')}
        </button>
      </section>

      {/* Privacy */}
      <section className="card mb-4">
        <div className="card-title mb-2">{t('settings.privacy')}</div>
        <p className="text-sm text-muted">{t('settings.privacyText')}</p>
      </section>

      {/* About */}
      <section className="card">
        <div className="card-title">{t('settings.about')}</div>
        <div className="text-sm text-muted mt-2">
          {t('settings.version', { v: '0.1.0' })}
        </div>
        <a
          href="https://github.com/GabrielCatDeveloper/portami"
          target="_blank"
          rel="noopener"
          className="btn btn-ghost btn-sm mt-2"
          style={{ padding: 0 }}
        >
          {t('settings.openSource')} ↗
        </a>
      </section>

      {prompt?.kind === 'export' && (
        <PassphrasePrompt
          title={t('settings.exportIdTitle')}
          description={t('settings.exportIdDesc')}
          confirm
          onSubmit={handlePassphraseSubmit}
          onCancel={() => setPrompt(null)}
        />
      )}

      {prompt?.kind === 'import' && (
        <PassphrasePrompt
          title={t('settings.importIdTitle')}
          description={t('settings.importIdDesc')}
          onSubmit={handlePassphraseSubmit}
          onCancel={() => setPrompt(null)}
        />
      )}

      {prompt?.kind === 'regenerate' && (
        <ConfirmDialog
          title={t('settings.regenerateIdTitle')}
          description={t('settings.regenerateIdDesc')}
          confirmLabel={t('settings.regenerateConfirm')}
          variant="danger"
          onConfirm={async () => {
            setPrompt(null);
            await regenerate();
            flash(t('settings.flash.identityRegenerated'));
          }}
          onCancel={() => setPrompt(null)}
        />
      )}

      {prompt?.kind === 'revoke' && (
        <ConfirmDialog
          title={t('settings.revokeTitle', { alias: prompt.device.alias })}
          description={t('settings.revokeDesc')}
          confirmLabel={t('settings.revokeConfirm')}
          variant="danger"
          onConfirm={async () => {
            setPrompt(null);
            await sync.revokeDevice(prompt.device.deviceId);
            void reloadDevices();
          }}
          onCancel={() => setPrompt(null)}
        />
      )}
    </div>
  );
}