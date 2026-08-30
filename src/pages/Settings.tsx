import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS } from '@/i18n';
import { useIdentityStore } from '@/state/identity';
import { Key, Copy, AlertTriangle, Download, Upload } from '@/components/icons';
import { exportMyRoutesAsGeoJSON, importGeoJSON, downloadFile, pickFile, type ImportMode } from '@/io/geojson';

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const identity = useIdentityStore((s) => s.identity);
  const anonId = useIdentityStore((s) => s.anonId);
  const regenerate = useIdentityStore((s) => s.regenerate);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  if (!identity) return null;

  const copyPub = async () => {
    await navigator.clipboard.writeText(identity.pubKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onExport = async () => {
    setBusy('export');
    try {
      const data = await exportMyRoutesAsGeoJSON();
      const json = JSON.stringify(data, null, 2);
      downloadFile(json, `portami-routes-${anonId ?? 'me'}.geojson`);
      setLastResult(`Exportadas ${data.features.length} entidades`);
    } catch (e) {
      setLastResult(`Error: ${e}`);
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
      setLastResult(
        `${res.imported} importadas, ${res.replaced} reemplazadas, ${res.merged} fusionadas, ${res.skipped} mantenidas` +
        (res.readonly ? ' (sin firma válida → solo lectura)' : ''),
      );
    } catch (e) {
      setLastResult(`Error: ${e}`);
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

      {/* Identity */}
      <section className="card mb-4">
        <div className="card-header">
          <div className="list-item-icon"><Key size={20} /></div>
          <div style={{ flex: 1 }}>
            <div className="card-title">{t('settings.identity')}</div>
            <div className="card-subtitle">{t('settings.privacy')}</div>
          </div>
        </div>

        <div className="field">
          <label className="field-label">{t('settings.anonId')}</label>
          <div style={{
            padding: '12px 14px',
            background: 'var(--bg-subtle)',
            borderRadius: 'var(--r-md)',
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            fontSize: 'var(--fs-md)',
            color: 'var(--brand-700)',
            textAlign: 'center',
          }}>
            #{anonId}
          </div>
          <div className="field-hint">Tu ID corto derivado de tu clave pública. Estable entre dispositivos.</div>
        </div>

        <div className="field">
          <label className="field-label">{t('settings.pubKey')}</label>
          <div className="row gap-2">
            <code style={{
              flex: 1,
              padding: '12px 14px',
              background: 'var(--bg-subtle)',
              borderRadius: 'var(--r-md)',
              fontSize: 'var(--fs-xs)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {identity.pubKey}
            </code>
            <button type="button" className="btn btn-sm" onClick={copyPub}>
              <Copy size={16} /> {copied ? '✓' : ''}
            </button>
          </div>
        </div>

        <div className="row gap-2">
          <button type="button" className="btn flex-1">
            {t('settings.exportPrivate')}
          </button>
          <button type="button" className="btn flex-1">
            {t('settings.importPrivate')}
          </button>
        </div>

        <div className="divider" />

        <button
          type="button"
          className="btn btn-danger btn-block"
          onClick={async () => {
            if (confirm(t('settings.regenerateWarn'))) await regenerate();
          }}
        >
          <AlertTriangle size={16} /> {t('settings.regenerate')}
        </button>
      </section>

      {/* Import/Export routes */}
      <section className="card mb-4">
        <div className="card-header">
          <div className="card-title">{t('settings.exportRoutes')}</div>
        </div>
        <div className="row gap-2">
          <button
            type="button"
            className="btn flex-1"
            disabled={busy === 'export'}
            onClick={() => void onExport()}
          >
            <Download size={16} /> GeoJSON
          </button>
          <button
            type="button"
            className="btn flex-1"
            disabled={busy === 'import'}
            onClick={() => void onImport()}
          >
            <Upload size={16} /> {t('settings.importGeoJSON')}
          </button>
        </div>
        {lastResult && (
          <div className="banner banner-info mt-3 text-sm">{lastResult}</div>
        )}
      </section>

      {/* Sync shortcuts */}
      <section className="card mb-4">
        <div className="card-header">
          <div className="card-title">{t('sync.devices')}</div>
        </div>
        <a href="/sync" className="btn btn-block">
          {t('sync.pair')}
        </a>
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
          href="https://github.com/"
          target="_blank"
          rel="noopener"
          className="btn btn-ghost btn-sm mt-2"
          style={{ padding: 0 }}
        >
          {t('settings.openSource')} ↗
        </a>
      </section>
    </div>
  );
}