import { contextBridge, ipcRenderer } from 'electron';
import type { LaunchOptions, LauncherSettings, MinecraftAccount, VersionInfo, DownloadProgress } from '../shared/types';

export interface JavaInstallInfo {
  path: string;
  home: string;
  major: number;
  version: string;
  vendor?: string;
  managed: boolean;
}

export interface JavaPlan {
  required: number;
  plan: 'user' | 'reuse' | 'download';
  path: string | null;
  major?: number;
  version?: string;
  vendor?: string;
  error?: string;
}

export interface WorldEntry {
  name: string;
  displayName: string;
  path: string;
  lastPlayed: number;
  sizeBytes: number;
  gameMode?: number;
  hardcore?: boolean;
  version?: string;
  hasIcon: boolean;
}

export interface UpdaterState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error' | 'disabled';
  current: string;
  latest?: string;
  percent?: number;
  bytesPerSecond?: number;
  error?: string;
}

export type LoaderType = 'fabric' | 'quilt' | 'neoforge' | 'forge';

export interface LoaderVersionInfo {
  loader: LoaderType;
  version: string;
  stable?: boolean;
  mcVersion?: string;
}

const api = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
  },
  settings: {
    get: (): Promise<LauncherSettings> => ipcRenderer.invoke('settings:get'),
    set: (s: LauncherSettings): Promise<LauncherSettings> => ipcRenderer.invoke('settings:set', s),
    pickDir: (): Promise<string | null> => ipcRenderer.invoke('settings:pickDir'),
  },
  accounts: {
    list: (): Promise<MinecraftAccount[]> => ipcRenderer.invoke('accounts:list'),
    addGuest: (name: string): Promise<MinecraftAccount> => ipcRenderer.invoke('accounts:addGuest', name),
    remove: (uuid: string): Promise<MinecraftAccount[]> => ipcRenderer.invoke('accounts:remove', uuid),
  },
  java: {
    list: (): Promise<JavaInstallInfo[]> => ipcRenderer.invoke('java:list'),
    scan: (): Promise<JavaInstallInfo[]> => ipcRenderer.invoke('java:scan'),
    planFor: (versionId: string): Promise<JavaPlan | null> => ipcRenderer.invoke('java:planFor', versionId),
  },
  worlds: {
    list: (): Promise<WorldEntry[]> => ipcRenderer.invoke('worlds:list'),
    icon: (name: string): Promise<string | null> => ipcRenderer.invoke('worlds:icon', name),
    delete: (name: string): Promise<boolean> => ipcRenderer.invoke('worlds:delete', name),
    deleteWithBackups: (name: string): Promise<{ world: boolean; backupsRemoved: number }> =>
      ipcRenderer.invoke('worlds:deleteWithBackups', name),
    backup: (name: string): Promise<string> => ipcRenderer.invoke('worlds:backup', name),
    openFolder: (name?: string): Promise<string> => ipcRenderer.invoke('worlds:openFolder', name),
  },
  reset: {
    perform: (opts: { keepUserData: boolean }): Promise<{ removed: string[]; keptUserData: boolean }> =>
      ipcRenderer.invoke('reset:perform', opts),
    uninstallLauncher: (keepUserData: boolean): Promise<{ ok: boolean; reason?: string }> =>
      ipcRenderer.invoke('reset:uninstallLauncher', keepUserData),
  },
  loaders: {
    list: (loader: 'fabric' | 'quilt' | 'neoforge' | 'forge', mcVersion: string): Promise<LoaderVersionInfo[]> =>
      ipcRenderer.invoke('loaders:list', loader, mcVersion),
    install: (
      loader: 'fabric' | 'quilt' | 'neoforge' | 'forge',
      mcVersion: string,
      loaderVersion: string,
    ): Promise<{ versionId: string }> =>
      ipcRenderer.invoke('loaders:install', loader, mcVersion, loaderVersion),
  },
  updater: {
    state: (): Promise<UpdaterState> => ipcRenderer.invoke('updater:state'),
    check: (): Promise<UpdaterState> => ipcRenderer.invoke('updater:check'),
    install: (): Promise<void> => ipcRenderer.invoke('updater:install'),
    onState: (cb: (s: UpdaterState) => void) => {
      const listener = (_: unknown, s: UpdaterState) => cb(s);
      ipcRenderer.on('updater:state', listener);
      return () => ipcRenderer.removeListener('updater:state', listener);
    },
  },
  minecraft: {
    versions: (): Promise<VersionInfo[]> => ipcRenderer.invoke('minecraft:versions'),
    installed: (): Promise<string[]> => ipcRenderer.invoke('minecraft:installed'),
    install: (versionId: string): Promise<boolean> => ipcRenderer.invoke('minecraft:install', versionId),
    uninstall: (versionId: string): Promise<boolean> => ipcRenderer.invoke('minecraft:uninstall', versionId),
    uninstallDeep: (versionId: string): Promise<{ removed: string[] }> => ipcRenderer.invoke('minecraft:uninstallDeep', versionId),
    openFolder: (kind: 'game' | 'version', versionId?: string): Promise<string> =>
      ipcRenderer.invoke('minecraft:openFolder', kind, versionId),
    launch: (opts: LaunchOptions): Promise<number> => ipcRenderer.invoke('minecraft:launch', opts),
    onProgress: (cb: (p: DownloadProgress) => void) => {
      const listener = (_: unknown, p: DownloadProgress) => cb(p);
      ipcRenderer.on('minecraft:progress', listener);
      return () => ipcRenderer.removeListener('minecraft:progress', listener);
    },
    onLog: (cb: (line: string) => void) => {
      const listener = (_: unknown, line: string) => cb(line);
      ipcRenderer.on('minecraft:log', listener);
      return () => ipcRenderer.removeListener('minecraft:log', listener);
    },
    onExit: (cb: (code: number) => void) => {
      const listener = (_: unknown, code: number) => cb(code);
      ipcRenderer.on('minecraft:exit', listener);
      return () => ipcRenderer.removeListener('minecraft:exit', listener);
    },
    onManifestUpdated: (cb: (list: VersionInfo[]) => void) => {
      const listener = (_: unknown, list: VersionInfo[]) => cb(list);
      ipcRenderer.on('minecraft:manifestUpdated', listener);
      return () => ipcRenderer.removeListener('minecraft:manifestUpdated', listener);
    },
  },
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
