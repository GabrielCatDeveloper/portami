import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS } from '@/i18n';
import { useIdentityStore } from '@/state/identity';
import { Key, Copy, Download, Upload, AlertTriangle, ChevronDown, Sync as SyncIcon, Trash } from '@/components/icons';
import { getDB } from '@/storage/db';
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

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const identity = useIdentityStore((s) => s.identity);
  const anonId = useIdentityStore((s) => s.anonId);
  const regenerate = useIdentityStore((s) => s.regenerate);
  const importFromJwk = useIdentityStore((s) => s.importFromJwk);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDanger, setShowDanger] = useState(false);
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);

  // Load paired devices for the Sync card
  const reloadDevices = async () => {
    try {
      const db = await getDB();
      const list = await db.getAll('pairedDevices');
      setPairedDevices(list);
    } catch {
      setPairedDevices([]);
    }
  };
  useEffect(() => {
    void reloadDevices();
  }, []);

  if (!identity) return null;

  const copyPub = async () => {
    await navigator.clipboard.writeText(identity.pubKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
  const onExportIdentity = async () => {
    const passphrase = window.prompt(
      'Elige una contraseña para proteger el archivo (mínimo 8 caracteres). ' +
        'La necesitarás para volver a importarla. NO la pierdas.',
    );
    if (!passphrase) return;
    if (passphrase.length < 8) {
      flash('La contraseña debe tener al menos 8 caracteres', true);
      return;
    }
    const confirm = window.prompt('Repite la contraseña para confirmar:');
    if (confirm !== passphrase) {
      flash('Las contraseñas no coinciden', true);
      return;
    }
    setBusy('export-id');
    try {
      const backup = await exportIdentityBackup({
        pubKey: identity.pubKey,
        anonId: anonId ?? '',
        privKeyJwk: identity.privKeyJwk,
        passphrase,
      });
      downloadBackup(backup, anonId ?? 'me');
      flash('Identidad exportada. Guarda el archivo en un lugar seguro.');
      // Clear passphrase from memory as soon as possible
    } catch (e) {
      flash(`Error: ${e instanceof Error ? e.message : e}`, true);
    } finally {
      setBusy(null);
    }
  };

  const onImportIdentity = async () => {
    const file = await pickBackupFile();
    if (!file) return;
    const passphrase = window.prompt('Introduce la contraseña del archivo de backup:');
    if (!passphrase) return;
    setBusy('import-id');
    try {
      const jwk = await importIdentityBackup({ backup: file, passphrase });
      await importFromJwk(jwk, file.pubKey);
      flash(`Identidad importada correctamente como #${file.anonId}`);
    } catch (e) {
      flash(`Error: ${e instanceof Error ? e.message : e}`, true);
    } finally {
      setBusy(null);
    }
  };

  // ---- GeoJSON routes ----
  const onExport = async () => {
    setBusy('export');
    try {
      const data = await exportMyRoutesAsGeoJSON();
      const json = JSON.stringify(data, null, 2);
      downloadFile(json, `portami-rutas-${anonId ?? 'me'}.geojson`);
      flash(`Exportadas ${data.features.length} entidades`);
    } catch (e) {
      flash(`Error: ${e}`, true);
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
        `${res.imported} importadas, ${res.replaced} reemplazadas, ${res.merged} fusionadas, ${res.skipped} mantenidas` +
          (res.readonly ? ' (sin firma válida → solo lectura)' : ''),
      );
    } catch (e) {
      flash(`Error: ${e}`, true);
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

      {/* Identity — the headline block */}
      <section className="card mb-4">
        <div className="card-header">
          <div className="list-item-icon"><Key size={20} /></div>
          <div style={{ flex: 1 }}>
            <div className="card-title">Tu identidad</div>
            <div className="card-subtitle">Anónima, generada en este dispositivo. Sin cuentas ni servidores.</div>
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
            Tu ID anónimo
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
            Este es tu identidad pública. Otros usuarios la ven cuando compartes un viaje o una ruta.
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
            <Download size={18} /> Exportar mi identidad
          </button>
          <button
            type="button"
            className="btn btn-block"
            disabled={busy === 'import-id'}
            onClick={() => void onImportIdentity()}
          >
            <Upload size={18} /> Importar mi identidad
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
          <span>Avanzado</span>
          <ChevronDown
            size={16}
            style={{ transform: showAdvanced ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
          />
        </button>

        {showAdvanced && (
          <div className="mt-3" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="field">
              <label className="field-label">Clave pública (hex)</label>
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
                  <Copy size={16} /> {copied ? '✓' : ''}
                </button>
              </div>
              <div className="field-hint">
                Solo necesaria para auditoría o soporte técnico. No la compartas si no sabes para qué sirve.
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
          <span>Zona peligrosa</span>
          <ChevronDown
            size={16}
            style={{ transform: showDanger ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
          />
        </button>

        {showDanger && (
          <div className="mt-3">
            <p className="text-sm text-muted mb-2">
              Regenerar tu identidad la invalidará. Perderás reputación y se desconectarán tus dispositivos emparejados.
              Esta acción no se puede deshacer.
            </p>
            <button
              type="button"
              className="btn btn-danger btn-block"
              onClick={async () => {
                if (confirm('¿Seguro que quieres regenerar tu identidad? No se puede deshacer.')) {
                  await regenerate();
                }
              }}
            >
              <AlertTriangle size={16} /> Regenerar identidad
            </button>
          </div>
        )}
      </section>

      {/* GeoJSON routes */}
      <section className="card mb-4">
        <div className="card-header">
          <div className="card-title">Mis rutas</div>
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
            <Download size={18} /> Exportar como GeoJSON
          </button>
          <button
            type="button"
            className="btn btn-block"
            disabled={busy === 'import'}
            onClick={() => void onImport()}
          >
            <Upload size={18} /> Importar GeoJSON
          </button>
        </div>
      </section>

      {/* Dispositivos emparejados (WebRTC) */}
      <section className="card mb-4">
        <div className="card-header">
          <div className="list-item-icon"><SyncIcon size={20} /></div>
          <div style={{ flex: 1 }}>
            <div className="card-title">Sincronizar con otro dispositivo</div>
            <div className="card-subtitle">
              Pasa tu identidad y tus rutas a otro móvil u ordenador por WebRTC. Sin servidores.
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
                    #{d.pubKey.slice(0, 8)} · Última sync:{' '}
                    {new Date(d.lastSeenAt).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  aria-label="Revocar"
                  onClick={async () => {
                    if (!confirm(`¿Revocar "${d.alias}"?`)) return;
                    const db = await getDB();
                    await db.delete('pairedDevices', d.deviceId);
                    void reloadDevices();
                  }}
                >
                  <Trash size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        <button type="button" className="btn btn-primary btn-block" onClick={() => navigate('/sync')}>
          <SyncIcon size={18} /> Emparejar nuevo dispositivo
        </button>
        <button type="button" className="btn btn-block mt-2" onClick={() => navigate('/following')}>
          <ChevronDown size={18} style={{ transform: 'rotate(-90deg)' }} /> Ver viajes compartidos
        </button>
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
    </div>
  );
}