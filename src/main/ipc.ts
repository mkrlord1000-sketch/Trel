import { BrowserWindow, ipcMain, dialog } from 'electron';
import { shell } from 'electron';
import { MinecraftService } from './minecraft';
import { AuthService } from './auth';
import { SettingsStore } from './settings';
import { JavaService } from './java';
import { WorldService } from './worlds';
import { ResetService } from './reset';
import { LauncherUpdater } from './updater';
import { LaunchOptions, LauncherSettings } from '../shared/types';

export function registerIpc(win: BrowserWindow, launcherDir: string, updater: LauncherUpdater) {
  const store = new SettingsStore(launcherDir);
  const settings = store.loadSettings();
  const java = new JavaService(launcherDir);
  const mc = new MinecraftService(settings.gameDir, java);
  const worlds = new WorldService(settings.gameDir);
  const resetSvc = new ResetService(launcherDir, settings.gameDir);
  const auth = new AuthService();

  ipcMain.handle('settings:get', () => store.loadSettings());
  ipcMain.handle('settings:set', (_e, s: LauncherSettings) => {
    store.saveSettings(s);
    mc.setGameDir(s.gameDir);
    worlds.setGameDir(s.gameDir);
    resetSvc.setGameDir(s.gameDir);
    return s;
  });
  ipcMain.handle('settings:pickDir', async () => {
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('accounts:list', () => store.loadAccounts());
  ipcMain.handle('accounts:addGuest', (_e, name: string) => {
    const list = store.loadAccounts();
    const acc = auth.createGuest(name);
    const existing = list.findIndex((a) => a.uuid === acc.uuid);
    if (existing >= 0) list[existing] = acc;
    else list.push(acc);
    store.saveAccounts(list);
    return acc;
  });
  ipcMain.handle('accounts:remove', (_e, uuid: string) => {
    const list = store.loadAccounts().filter((a) => a.uuid !== uuid);
    store.saveAccounts(list);
    return list;
  });

  ipcMain.handle('minecraft:versions', () => mc.fetchVersions());
  ipcMain.handle('minecraft:installed', () => mc.installedVersionIds());
  ipcMain.handle('minecraft:install', async (_e, versionId: string) => {
    await mc.install(versionId, win);
    return true;
  });
  ipcMain.handle('minecraft:uninstall', (_e, versionId: string) => {
    return mc.uninstall(versionId);
  });
  ipcMain.handle('minecraft:uninstallDeep', (_e, versionId: string) => {
    return mc.uninstallDeep(versionId);
  });
  ipcMain.handle('minecraft:openFolder', (_e, kind: 'game' | 'version', versionId?: string) => {
    const p = kind === 'version' && versionId ? mc.versionFolder(versionId) : mc.gameFolder();
    shell.openPath(p);
    return p;
  });
  ipcMain.handle('minecraft:launch', async (_e, opts: LaunchOptions) => {
    const s = store.loadSettings();
    return mc.launch(opts, win, s.javaPath);
  });

  ipcMain.handle('java:list', () => java.list());
  ipcMain.handle('java:scan', () => java.scan());
  ipcMain.handle('java:planFor', async (_e, versionId: string) => {
    try {
      const vers = await mc.fetchVersions();
      const entry = vers.find(v => v.id === versionId);
      if (!entry) return null;
      const axios = (await import('axios')).default;
      const { data } = await axios.get((entry as any).url, { timeout: 15000 });
      let major = data.javaVersion?.majorVersion;
      if (!major && data.inheritsFrom) {
        const parentEntry = vers.find(v => v.id === data.inheritsFrom);
        if (parentEntry) {
          const { data: pd } = await axios.get((parentEntry as any).url, { timeout: 15000 });
          major = pd.javaVersion?.majorVersion;
        }
      }
      if (!major) major = 8;
      const s = store.loadSettings();
      // Validate user override
      if (s.javaPath) {
        const info = await java.inspectExe(s.javaPath);
        if (info && (await import('./java')).JavaService.isCompatible(info.major, major)) {
          return { required: major, plan: 'user', path: s.javaPath, major: info.major, version: info.version };
        }
        // user override incompatible — fall through
      }
      const best = await java.findBest(major);
      if (best) return { required: major, plan: 'reuse', path: best.path, version: best.version, major: best.major, vendor: best.vendor };
      return { required: major, plan: 'download', path: null };
    } catch (e) {
      return { error: (e as Error).message };
    }
  });

  // ---- worlds ----
  ipcMain.handle('worlds:list', () => worlds.list());
  ipcMain.handle('worlds:icon', (_e, name: string) => worlds.iconDataUrl(name));
  ipcMain.handle('worlds:delete', (_e, name: string) => worlds.delete(name));
  ipcMain.handle('worlds:deleteWithBackups', (_e, name: string) => worlds.deleteWithBackups(name));
  ipcMain.handle('worlds:backup', (_e, name: string) => worlds.backup(name));
  ipcMain.handle('worlds:openFolder', (_e, name?: string) => {
    const p = name ? require('node:path').join(worlds.savesDir(), name) : worlds.savesDir();
    shell.openPath(p);
    return p;
  });

  // ---- launcher reset ----
  ipcMain.handle('reset:perform', (_e, opts: { keepUserData: boolean }) => {
    const result = resetSvc.perform(opts);
    setTimeout(() => resetSvc.restart(), 300);
    return result;
  });

  // ---- launcher uninstall ----
  ipcMain.handle('reset:uninstallLauncher', (_e, keepUserData: boolean) => {
    return resetSvc.uninstallLauncher({ keepUserData });
  });

  // ---- mod loaders ----
  ipcMain.handle('loaders:list', (_e, loader: 'fabric' | 'quilt' | 'neoforge' | 'forge', mcVersion: string) => {
    return mc.loaders.listVersions(loader, mcVersion);
  });
  ipcMain.handle('loaders:install', async (
    _e,
    loader: 'fabric' | 'quilt' | 'neoforge' | 'forge',
    mcVersion: string,
    loaderVersion: string,
  ) => {
    return mc.loaders.install(loader, mcVersion, loaderVersion, win);
  });

  // ---- launcher updater ----
  ipcMain.handle('updater:state', () => updater.getState());
  ipcMain.handle('updater:check', () => updater.check());
  ipcMain.handle('updater:install', () => updater.quitAndInstall());

  // ---- periodic auto-check for Mojang manifest (so new versions appear without restart) ----
  const pushManifestUpdate = async () => {
    try {
      const list = await mc.fetchVersions();
      if (!win.isDestroyed()) win.webContents.send('minecraft:manifestUpdated', list);
    } catch {}
  };
  setInterval(pushManifestUpdate, 30 * 60 * 1000);
}
