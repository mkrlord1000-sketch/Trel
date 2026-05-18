import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { registerIpc } from './ipc';
import { LauncherUpdater } from './updater';

const isDev = !app.isPackaged;
const updater = new LauncherUpdater();

const APP_NAME = 'Trel';
const LEGACY_APP_NAME = 'AuroraLauncher';

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0e1016',
    title: APP_NAME,
    icon: path.join(app.getAppPath(), 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.setMenuBarVisibility(false);

  if (isDev) {
    win.loadURL('http://localhost:5173');
    // win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

function ensureLauncherDir(): string {
  const newDir = path.join(app.getPath('appData'), APP_NAME);
  const oldDir = path.join(app.getPath('appData'), LEGACY_APP_NAME);

  // Миграция данных пользователей со старого имени (AuroraLauncher → Trel).
  // Если новой папки ещё нет, а старая существует — переименовываем.
  if (!fs.existsSync(newDir) && fs.existsSync(oldDir)) {
    try {
      fs.renameSync(oldDir, newDir);
      // Внутри settings.json gameDir мог хранить полный путь со старым именем —
      // переписываем, чтобы лаунчер дальше работал с обновлённым путём.
      // Сравнение case-insensitive: на Windows пути `C:\Users\...` и
      // `c:\users\...` указывают на одно место, а простой includes
      // регистро-чувствителен и пропускал такие случаи.
      const settingsFile = path.join(newDir, 'settings.json');
      if (fs.existsSync(settingsFile)) {
        try {
          const raw = fs.readFileSync(settingsFile, 'utf-8');
          const parsed = JSON.parse(raw);
          if (typeof parsed.gameDir === 'string') {
            const lcDir = parsed.gameDir.toLowerCase();
            const lcOld = oldDir.toLowerCase();
            if (lcDir.includes(lcOld)) {
              const idx = lcDir.indexOf(lcOld);
              // Заменяем сохраняя регистр окружающих символов: берём префикс/суффикс из оригинала
              parsed.gameDir = parsed.gameDir.slice(0, idx) + newDir + parsed.gameDir.slice(idx + oldDir.length);
              fs.writeFileSync(settingsFile, JSON.stringify(parsed, null, 2), 'utf-8');
            }
          }
        } catch {}
      }
    } catch {
      // Если переименовать не удалось (файл занят и т.п.) — fallback: используем старую папку.
      if (fs.existsSync(oldDir)) return oldDir;
    }
  }

  if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });
  return newDir;
}

app.whenReady().then(() => {
  const launcherDir = ensureLauncherDir();
  const win = createWindow();
  registerIpc(win, launcherDir, updater);

  updater.attach(win);

  // Check for launcher updates shortly after start, then every hour.
  setTimeout(() => updater.check().catch(() => {}), 5000);
  setInterval(() => updater.check().catch(() => {}), 60 * 60 * 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Window controls
ipcMain.handle('window:minimize', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.minimize();
});
ipcMain.handle('window:maximize', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  if (w.isMaximized()) w.unmaximize();
  else w.maximize();
});
ipcMain.handle('window:close', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.close();
});
