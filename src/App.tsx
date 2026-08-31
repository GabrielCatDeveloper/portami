import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useIdentityStore } from '@/state/identity';
import { Home as HomeIcon, Map, Record as RecordIcon, Settings as SettingsIcon } from '@/components/icons';
import { TripBanner } from '@/components/TripBanner';

import HomePage from '@/pages/Home';
import ExplorePage from '@/pages/Explore';
import RouteDetailPage from '@/pages/RouteDetail';
import TripPage from '@/pages/Trip';
import RecordPage from '@/pages/Record';
import SettingsPage from '@/pages/Settings';
import SyncPage from '@/pages/Sync';

export default function App() {
  const { t } = useTranslation();
  const init = useIdentityStore((s) => s.init);
  const initialized = useIdentityStore((s) => s.initialized);
  const navigate = useNavigate();
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    init().catch((e) => setBootError(String(e)));
  }, [init]);

  if (bootError) {
    return (
      <div className="page" style={{ paddingTop: 40 }}>
        <div className="banner banner-danger">{t('common.error')}: {bootError}</div>
      </div>
    );
  }
  if (!initialized) {
    return (
      <div className="page" style={{ paddingTop: 60, textAlign: 'center' }}>
        <div className="skeleton" style={{ height: 48, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 16, width: '60%', margin: '0 auto 12px' }} />
        <div className="skeleton" style={{ height: 16, width: '40%', margin: '0 auto' }} />
      </div>
    );
  }

  return (
    <div className="app">
      <TripBanner onEndClick={() => navigate('/trip')} />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/explore" element={<ExplorePage />} />
          <Route path="/routes/:id" element={<RouteDetailPage />} />
          <Route path="/trip" element={<TripPage />} />
          <Route path="/record" element={<RecordPage />} />
          {/* Sync is reachable from Settings (less-used action, no need
              for a permanent slot in the bottom nav). */}
          <Route path="/sync" element={<SyncPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>

      <nav className="bottom-nav" aria-label="primary">
        <NavLink to="/" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
          <HomeIcon size={22} />
          <span>{t('nav.home')}</span>
        </NavLink>
        <NavLink to="/explore" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
          <Map size={22} />
          <span>{t('nav.explore')}</span>
        </NavLink>
        <NavLink to="/record" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
          <RecordIcon size={22} />
          <span>{t('nav.record')}</span>
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
          <SettingsIcon size={22} />
          <span>{t('nav.settings')}</span>
        </NavLink>
      </nav>
    </div>
  );
}