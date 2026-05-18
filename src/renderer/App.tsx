import React, { useEffect, useState } from 'react';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { HomePage } from './pages/HomePage';
import { BrowsePage } from './pages/BrowsePage';
import { InstalledPage } from './pages/InstalledPage';
import { WorldsPage } from './pages/WorldsPage';
import { AccountsPage } from './pages/AccountsPage';
import { SettingsPage } from './pages/SettingsPage';
import { WelcomePage } from './pages/WelcomePage';
import { ContentPage } from './pages/ContentPage';
import { SkinPage } from './pages/SkinPage';
import { ServersPage } from './pages/ServersPage';
import { DialogProvider } from './components/Dialog';
import type { LauncherSettings, MinecraftAccount } from '../shared/types';

export type Page = 'home' | 'browse' | 'installed' | 'worlds' | 'content' | 'servers' | 'skin' | 'accounts' | 'settings';

export const App: React.FC = () => {
  const [page, setPage] = useState<Page>('home');
  const [settings, setSettings] = useState<LauncherSettings | null>(null);
  const [accounts, setAccounts] = useState<MinecraftAccount[]>([]);
  const [activeUuid, setActiveUuid] = useState<string | null>(null);
  const [accountsReady, setAccountsReady] = useState(false);

  useEffect(() => {
    window.api.settings.get().then(setSettings);
    window.api.accounts.list().then((list) => {
      setAccounts(list);
      if (list.length > 0) setActiveUuid(list[0].uuid);
      setAccountsReady(true);
    });
  }, []);

  const activeAccount = accounts.find((a) => a.uuid === activeUuid) || null;

  const refreshAccounts = async () => {
    const list = await window.api.accounts.list();
    setAccounts(list);
    if (!list.find((a) => a.uuid === activeUuid)) {
      setActiveUuid(list[0]?.uuid ?? null);
    }
  };

  const updateSettings = (s: LauncherSettings) => {
    setSettings(s);
    window.api.settings.set(s);
  };

  if (!settings || !accountsReady) {
    return (
      <DialogProvider>
        <div className="app">
          <TitleBar />
          <div className="main">
            <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="empty">Загрузка...</div>
            </div>
          </div>
        </div>
      </DialogProvider>
    );
  }

  if (accounts.length === 0) {
    return (
      <DialogProvider>
        <div className="app">
          <TitleBar />
          <WelcomePage onDone={refreshAccounts} />
        </div>
      </DialogProvider>
    );
  }

  const isFlush = page === 'browse';

  return (
    <DialogProvider>
      <div className="app">
        <TitleBar />
        <div className="main">
          <Sidebar page={page} onChange={setPage} activeAccount={activeAccount} />
          <div className={'content' + (isFlush ? ' flush' : '')}>
            {page === 'home' && (
              <HomePage
                settings={settings}
                account={activeAccount}
                onGoToAccounts={() => setPage('accounts')}
                onGoToBrowse={() => setPage('browse')}
                onGoToInstalled={() => setPage('installed')}
                onSettingsChange={updateSettings}
              />
            )}
            {page === 'browse' && (
              <BrowsePage
                settings={settings}
                account={activeAccount}
                onGoToAccounts={() => setPage('accounts')}
                onSettingsChange={updateSettings}
              />
            )}
            {page === 'installed' && (
              <InstalledPage
                settings={settings}
                account={activeAccount}
                onSettingsChange={updateSettings}
                onGoToBrowse={() => setPage('browse')}
              />
            )}
            {page === 'worlds' && <WorldsPage />}
            {page === 'content' && (
              <ContentPage
                lastVersionId={settings.lastVersionId}
                onPickVersion={(id) => updateSettings({ ...settings, lastVersionId: id })}
              />
            )}
            {page === 'servers' && <ServersPage />}
            {page === 'accounts' && (
              <AccountsPage
                accounts={accounts}
                activeUuid={activeUuid}
                onSelect={setActiveUuid}
                onChange={refreshAccounts}
                onGoToSkin={() => setPage('skin')}
              />
            )}
            {page === 'skin' && (
              <SkinPage
                accounts={accounts}
                activeUuid={activeUuid}
                onSelect={setActiveUuid}
                onChange={refreshAccounts}
                onGoToAccounts={() => setPage('accounts')}
              />
            )}
            {page === 'settings' && (
              <SettingsPage settings={settings} onChange={updateSettings} />
            )}
          </div>
        </div>
      </div>
    </DialogProvider>
  );
};
