import { BrowserWindow, ipcMain, dialog } from 'electron';
import { shell } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MinecraftService } from './minecraft';
import { AuthService } from './auth';
import { SettingsStore } from './settings';
import { JavaService } from './java';
import { WorldService } from './worlds';
import { ResetService } from './reset';
import { ContentService, ContentKind } from './content';
import { LauncherUpdater } from './updater';
import { ServerService, ServerProperties } from './servers';
import { SkinServer } from './skin-server';
import { AuthlibInjector } from './authlib';
import { assertSafeVersionId, assertSafeServerId, assertSafeWorldName } from './safeIds';
import { LaunchOptions, LauncherSettings } from '../shared/types';

export function registerIpc(win: BrowserWindow, launcherDir: string, updater: LauncherUpdater) {
  const store = new SettingsStore(launcherDir);
  const settings = store.loadSettings();
  const java = new JavaService(launcherDir);
  const worlds = new WorldService(settings.gameDir);
  // SkinServer и AuthlibInjector — общие между клиентом и серверами.
  // Один mock-сервер обслуживает скины клиента и server-side authlib проверки.
  const skinServer = new SkinServer();
  const authlib = new AuthlibInjector(launcherDir);
  const mc = new MinecraftService(settings.gameDir, java, worlds, launcherDir, skinServer, authlib);
  const resetSvc = new ResetService(launcherDir, settings.gameDir, worlds);
  const content = new ContentService(settings.gameDir);
  const auth = new AuthService();
  const servers = new ServerService(launcherDir, settings.gameDir, java, skinServer, authlib, () => store.loadAccounts());

  // Прокидываем актуальный список аккаунтов в skin-сервер. Без этого
  // authlib-injector при запуске игры не нашёл бы профиль с текстурой.
  mc.updateSkinAccounts(store.loadAccounts());

  // Сводим существующие установки к одному folder per loader: для каждого
  // лоадера с inheritsFrom впитываем родительскую ваниль и удаляем её папку.
  // Безопасно для тех у кого уже всё «плоское» — flatten идемпотентен.
  try { mc.consolidateInstalls(); } catch {}

  // ─── Cold-start prewarm ────────────────────────────────────────────────
  // Прогреваем Java-кэш в фоне ещё до того как renderer успеет подключиться.
  // К моменту когда пользователь жмёт «Играть», `findBest` отдаёт результат
  // мгновенно из persistent-кэша и не запускает scan на горячем пути.
  java.prewarm().catch(() => {});

  // Заодно резолвим Java под последнюю запущенную версию: к моменту клика
  // resolveJava() уже знает путь и не делает ни одного дискового запроса.
  if (settings.lastVersionId) {
    (async () => {
      try {
        const vDir = path.join(settings.gameDir, 'versions', settings.lastVersionId!);
        const jsonPath = path.join(vDir, settings.lastVersionId + '.json');
        if (!fs.existsSync(jsonPath)) return;
        const json = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        let major = json.javaVersion?.majorVersion;
        if (!major && json.inheritsFrom) {
          const parentJson = path.join(settings.gameDir, 'versions', json.inheritsFrom, json.inheritsFrom + '.json');
          if (fs.existsSync(parentJson)) {
            const pj = JSON.parse(fs.readFileSync(parentJson, 'utf-8'));
            major = pj.javaVersion?.majorVersion;
          }
        }
        if (typeof major === 'number') await java.findBest(major);
      } catch {}
    })();
  }

  ipcMain.handle('settings:get', () => store.loadSettings());
  ipcMain.handle('settings:set', (_e, s: LauncherSettings) => {
    const prevDir = store.loadSettings().gameDir;
    store.saveSettings(s);
    mc.setGameDir(s.gameDir);
    worlds.setGameDir(s.gameDir);
    resetSvc.setGameDir(s.gameDir);
    content.setGameDir(s.gameDir);
    servers.setGameDir(s.gameDir);
    if (s.gameDir !== prevDir) {
      try { mc.consolidateInstalls(); } catch {}
    }
    return s;
  });
  ipcMain.handle('settings:pickDir', async () => {
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('accounts:list', () => store.loadAccounts());
  // Простой mutex: все мутации accounts.json идут через одну Promise-цепочку.
  // Без этого параллельные setSkin (drag-drop + клик) могут перезаписать
  // друг друга — оба читают одинаковый снапшот, второй проигрывает.
  let accountsLock: Promise<unknown> = Promise.resolve();
  const withAccountsLock = <T>(fn: () => T | Promise<T>): Promise<T> => {
    const next = accountsLock.then(() => fn(), () => fn());
    accountsLock = next;
    return next as Promise<T>;
  };
  // Обновляет skin-сервер актуальным списком аккаунтов после любой записи.
  const refreshSkinServer = () => {
    try { mc.updateSkinAccounts(store.loadAccounts()); } catch {}
  };
  ipcMain.handle('accounts:addGuest', (_e, name: string) => withAccountsLock(() => {
    const list = store.loadAccounts();
    const acc = auth.createGuest(name);
    const existing = list.findIndex((a) => a.uuid === acc.uuid);
    if (existing >= 0) {
      // Сохраняем уже привязанный скин/модель, чтобы повторное добавление не сбросило их.
      list[existing] = { ...list[existing], ...acc };
    } else {
      list.push(acc);
    }
    store.saveAccounts(list);
    refreshSkinServer();
    return list[existing >= 0 ? existing : list.length - 1];
  }));
  ipcMain.handle('accounts:remove', (_e, uuid: string) => withAccountsLock(() => {
    const list = store.loadAccounts().filter((a) => a.uuid !== uuid);
    store.saveAccounts(list);
    refreshSkinServer();
    return list;
  }));

  // ---- Скины ----
  // Скин хранится у аккаунта как data-URL (PNG, 64×64 или 64×32).
  // Чтобы скин был виден ВНУТРИ игры — лаунчер при запуске поднимает
  // локальный yggdrasil-mock на 127.0.0.1:RANDOM и передаёт игре через
  // authlib-injector (-javaagent).
  //
  // При смене скина мы дополнительно чистим дисковый кэш скинов Minecraft
  // (assets/skins). Игра кэширует загруженные текстуры по SHA256 от URL,
  // и хотя URL теперь завязан на хэш PNG (см. SkinServer.profileResponse),
  // на ОЧЕНЬ старых запусках мог остаться файл со старым URL. Чистка
  // гарантирует что в игре никогда не покажется прошлый скин из кэша.
  const wipeSkinCache = () => {
    try {
      const skinCache = path.join(store.loadSettings().gameDir, 'assets', 'skins');
      if (fs.existsSync(skinCache)) {
        fs.rmSync(skinCache, { recursive: true, force: true });
      }
    } catch {}
  };

  ipcMain.handle('accounts:setSkin', async (_e, uuid: string, dataUrl: string, model: 'classic' | 'slim') => withAccountsLock(() => {
    const list = store.loadAccounts();
    const idx = list.findIndex((a) => a.uuid === uuid);
    if (idx < 0) throw new Error('Аккаунт не найден');
    // Базовая валидация: должен быть data:image/png;base64,...
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
      throw new Error('Скин должен быть PNG. Перетащи .png-файл или выбери через диалог.');
    }
    // Защита от слишком больших скинов: PNG 64×64 ~5KB, 64×128 ~10KB,
    // больше 128KB — это явно не скин (либо фото, либо потенциальный DoS).
    const approxBytes = Math.floor(dataUrl.length * 0.75); // base64 → bytes
    if (approxBytes > 128 * 1024) {
      throw new Error('Файл скина слишком большой (>128 КБ). Это должен быть PNG 64×64 или 64×32.');
    }
    list[idx] = { ...list[idx], skin: dataUrl, skinModel: model };
    store.saveAccounts(list);
    refreshSkinServer();
    wipeSkinCache();
    return list[idx];
  }));
  ipcMain.handle('accounts:removeSkin', (_e, uuid: string) => withAccountsLock(() => {
    const list = store.loadAccounts();
    const idx = list.findIndex((a) => a.uuid === uuid);
    if (idx < 0) throw new Error('Аккаунт не найден');
    const { skin, skinModel, ...rest } = list[idx];
    list[idx] = rest;
    store.saveAccounts(list);
    refreshSkinServer();
    wipeSkinCache();
    return list[idx];
  }));
  ipcMain.handle('accounts:pickSkinFile', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Выбери файл скина',
      properties: ['openFile'],
      filters: [{ name: 'PNG-скин', extensions: ['png'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const filePath = res.filePaths[0];
    try {
      const buf = fs.readFileSync(filePath);
      // Проверяем что это реально PNG (магические байты 89 50 4E 47)
      if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
        throw new Error('Файл не является PNG');
      }
      return 'data:image/png;base64,' + buf.toString('base64');
    } catch (e) {
      throw new Error('Не удалось прочитать файл: ' + (e as Error).message);
    }
  });

  ipcMain.handle('minecraft:versions', () => mc.fetchVersions());
  ipcMain.handle('minecraft:installed', () => mc.installedVersionIds());
  ipcMain.handle('minecraft:installedDetailed', () => mc.installedDetailed());
  ipcMain.handle('minecraft:install', async (_e, versionId: string) => {
    assertSafeVersionId(versionId);
    await mc.install(versionId, win);
    return true;
  });
  // Сбрасывает settings.lastVersionId если он указывает на одну из переданных
  // версий. Это нужно, чтобы после удаления версии главная не показывала
  // удалённую как активную.
  const clearLastVersionIfDeleted = (deletedIds: string[]) => {
    const s = store.loadSettings();
    if (s.lastVersionId && deletedIds.includes(s.lastVersionId)) {
      s.lastVersionId = '';
      store.saveSettings(s);
    }
  };

  ipcMain.handle('minecraft:uninstall', (_e, versionId: string) => {
    assertSafeVersionId(versionId);
    const r = mc.uninstall(versionId);
    clearLastVersionIfDeleted([versionId]);
    return r;
  });
  ipcMain.handle('minecraft:uninstallDeep', (_e, versionId: string) => {
    assertSafeVersionId(versionId);
    const r = mc.uninstallDeep(versionId);
    clearLastVersionIfDeleted([versionId]);
    return r;
  });
  ipcMain.handle('minecraft:revertToVanilla', async (_e, baseMc: string) => {
    assertSafeVersionId(baseMc, 'baseMc');
    const result = await mc.revertToVanilla(baseMc, win);
    // Если активной была одна из удалённых модд-версий — переключаем на
    // базовую ваниль (она же только что переустановлена). Если активной была
    // не она вовсе — не трогаем.
    const s = store.loadSettings();
    if (s.lastVersionId && result.removed.includes(s.lastVersionId)) {
      s.lastVersionId = baseMc;
      store.saveSettings(s);
    }
    // Возвращаем актуальные настройки в renderer чтобы он тоже обновил state.
    return { ...result, settings: store.loadSettings() };
  });
  ipcMain.handle('minecraft:openFolder', (_e, kind: 'game' | 'version', versionId?: string) => {
    if (kind === 'version') {
      assertSafeVersionId(versionId);
    }
    const p = kind === 'version' && versionId ? mc.versionFolder(versionId) : mc.gameFolder();
    shell.openPath(p).catch(() => {});
    return p;
  });
  ipcMain.handle('minecraft:launch', async (_e, opts: LaunchOptions) => {
    assertSafeVersionId(opts?.versionId, 'opts.versionId');
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
  ipcMain.handle('worlds:icon', (_e, name: string) => {
    assertSafeWorldName(name);
    return worlds.iconDataUrl(name);
  });
  ipcMain.handle('worlds:delete', (_e, name: string) => {
    assertSafeWorldName(name);
    return worlds.delete(name);
  });
  ipcMain.handle('worlds:deleteWithBackups', (_e, name: string) => {
    assertSafeWorldName(name);
    return worlds.deleteWithBackups(name);
  });
  ipcMain.handle('worlds:backup', (_e, name: string) => {
    assertSafeWorldName(name);
    return worlds.backup(name);
  });
  ipcMain.handle('worlds:openFolder', (_e, name?: string) => {
    if (!name) {
      shell.openPath(worlds.savesDir()).catch(() => {});
      return worlds.savesDir();
    }
    assertSafeWorldName(name);
    // For synthetic Pre-Classic worlds findWorldPath returns the parent dir;
    // for regular worlds — the world folder itself.
    const resolved = worlds.findWorldPath(name) || path.join(worlds.savesDir(), name);
    shell.openPath(resolved).catch(() => {});
    return resolved;
  });

  // ---- content (mods, shaders, resourcepacks, texturepacks) ----
  const ensureSafeContentVersion = (versionId?: string) => {
    if (versionId !== undefined) assertSafeVersionId(versionId);
  };
  ipcMain.handle('content:list', (_e, kind: ContentKind, versionId?: string) => {
    ensureSafeContentVersion(versionId);
    return content.list(kind, versionId);
  });
  ipcMain.handle('content:delete', (_e, kind: ContentKind, name: string, versionId?: string) => {
    ensureSafeContentVersion(versionId);
    return content.delete(kind, name, versionId);
  });
  ipcMain.handle('content:toggle', (_e, kind: ContentKind, name: string, versionId?: string) => {
    ensureSafeContentVersion(versionId);
    return content.toggle(kind, name, versionId);
  });
  ipcMain.handle('content:openFolder', (_e, kind: ContentKind, versionId?: string) => {
    ensureSafeContentVersion(versionId);
    const dir = content.dirFor(kind, versionId);
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir).catch(() => {});
    return dir;
  });
  ipcMain.handle('content:add', async (_e, kind: ContentKind, versionId?: string) => {
    ensureSafeContentVersion(versionId);
    const filters = kind === 'mod'
      ? [{ name: 'Моды (.jar)', extensions: ['jar', 'disabled'] }]
      : [{ name: 'Архивы (.zip)', extensions: ['zip'] }, { name: 'Все файлы', extensions: ['*'] }];
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters,
    });
    if (res.canceled) return { copied: 0, errors: [] as string[] };
    return content.add(kind, res.filePaths, versionId);
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
    assertSafeVersionId(mcVersion, 'mcVersion');
    return mc.loaders.listVersions(loader, mcVersion);
  });
  ipcMain.handle('loaders:install', async (
    _e,
    loader: 'fabric' | 'quilt' | 'neoforge' | 'forge',
    mcVersion: string,
    loaderVersion: string,
  ) => {
    assertSafeVersionId(mcVersion, 'mcVersion');
    assertSafeVersionId(loaderVersion, 'loaderVersion');
    return mc.loaders.install(loader, mcVersion, loaderVersion, win);
  });

  // ---- launcher updater ----
  ipcMain.handle('updater:state', () => updater.getState());
  ipcMain.handle('updater:check', () => updater.check());
  ipcMain.handle('updater:install', () => updater.quitAndInstall());

  // ---- servers ----
  ipcMain.handle('servers:list', () => servers.list());
  ipcMain.handle('servers:statuses', () => servers.statuses());
  ipcMain.handle('servers:logBuffer', (_e, id: string) => {
    assertSafeServerId(id);
    return servers.logBuffer(id);
  });
  ipcMain.handle('servers:create', async (_e, input: { name: string; versionId: string; memoryMb: number; properties?: Partial<ServerProperties> }) => {
    assertSafeVersionId(input?.versionId, 'input.versionId');
    return servers.create({
      ...input,
      onProgress: (p) => {
        if (!win.isDestroyed()) win.webContents.send('servers:createProgress', p);
      },
    });
  });
  ipcMain.handle('servers:delete', (_e, id: string) => {
    assertSafeServerId(id);
    servers.delete(id);
  });
  ipcMain.handle('servers:start', (_e, id: string) => {
    assertSafeServerId(id);
    return servers.start(id, win);
  });
  ipcMain.handle('servers:stop', (_e, id: string) => {
    assertSafeServerId(id);
    return servers.stop(id, win);
  });
  ipcMain.handle('servers:sendCommand', (_e, id: string, command: string) => {
    assertSafeServerId(id);
    return servers.sendCommand(id, command);
  });
  ipcMain.handle('servers:setProperties', (_e, id: string, patch: Partial<ServerProperties>) => {
    assertSafeServerId(id);
    return servers.setProperties(id, patch);
  });
  ipcMain.handle('servers:rename', (_e, id: string, name: string) => {
    assertSafeServerId(id);
    return servers.rename(id, name);
  });
  ipcMain.handle('servers:setMemory', (_e, id: string, memoryMb: number) => {
    assertSafeServerId(id);
    return servers.setMemory(id, memoryMb);
  });
  ipcMain.handle('servers:openFolder', (_e, id: string) => {
    assertSafeServerId(id);
    const dir = servers.serverDir(id);
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir).catch(() => {});
    return dir;
  });
  ipcMain.handle('servers:connectAddresses', (_e, id: string) => {
    assertSafeServerId(id);
    return servers.connectAddresses(id);
  });

  // ---- periodic auto-check for Mojang manifest (so new versions appear without restart) ----
  const pushManifestUpdate = async () => {
    try {
      const list = await mc.fetchVersions();
      if (!win.isDestroyed()) win.webContents.send('minecraft:manifestUpdated', list);
    } catch {}
  };
  const manifestInterval = setInterval(pushManifestUpdate, 30 * 60 * 1000);

  // Грациозная остановка ВСЕХ ресурсов при закрытии окна лаунчера.
  // Раньше тут был только servers.shutdownAll(), но висели:
  //   - manifestInterval (засыпал webContents.send в destroyed window)
  //   - skinServer (HTTP-сокет на 127.0.0.1)
  // На macOS окна закрываются и переоткрываются, без cleanup ресурсы
  // накапливались бы между сессиями.
  win.on('close', () => {
    clearInterval(manifestInterval);
    try { servers.shutdownAll(); } catch {}
    try { skinServer.stop(); } catch {}
  });
}
