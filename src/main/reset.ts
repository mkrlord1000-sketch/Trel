import { app } from 'electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

export interface ResetOptions {
  /** Если true — оставить миры (saves), настройки (settings.json), аккаунты (accounts.json). */
  keepUserData: boolean;
}

export interface ResetResult {
  removed: string[];
  keptUserData: boolean;
}

/**
 * Полный сброс лаунчера: удаление кеша Java, скачанных версий, ассетов, библиотек.
 * Если keepUserData=false — также удаляются настройки, аккаунты, миры и бэкапы.
 *
 * После выполнения приложение перезапускается (или закрывается, если перезапуск невозможен).
 */
export class ResetService {
  constructor(private launcherDir: string, private gameDir: string) {}

  setGameDir(dir: string) { this.gameDir = dir; }

  perform(opts: ResetOptions): ResetResult {
    const removed: string[] = [];

    const remove = (p: string) => {
      if (fs.existsSync(p)) {
        try {
          fs.rmSync(p, { recursive: true, force: true });
          removed.push(p);
        } catch {}
      }
    };

    // Always-removable: cache + downloaded game data + java
    remove(path.join(this.launcherDir, 'java'));
    remove(path.join(this.launcherDir, 'cache'));
    remove(path.join(this.gameDir, 'versions'));
    remove(path.join(this.gameDir, 'libraries'));
    remove(path.join(this.gameDir, 'assets'));
    remove(path.join(this.gameDir, 'logs'));
    remove(path.join(this.gameDir, 'crash-reports'));

    if (!opts.keepUserData) {
      // Also wipe user data: configs, accounts, saves, backups, resourcepacks, mods, screenshots
      remove(path.join(this.launcherDir, 'settings.json'));
      remove(path.join(this.launcherDir, 'accounts.json'));
      remove(path.join(this.gameDir, 'saves'));
      remove(path.join(this.gameDir, 'backups'));
      remove(path.join(this.gameDir, 'resourcepacks'));
      remove(path.join(this.gameDir, 'shaderpacks'));
      remove(path.join(this.gameDir, 'mods'));
      remove(path.join(this.gameDir, 'screenshots'));
      remove(path.join(this.gameDir, 'options.txt'));
      remove(path.join(this.gameDir, 'usercache.json'));
      remove(path.join(this.gameDir, 'launcher_profiles.json'));

      // Legacy: ранние версии (rd-*, c0.*, alpha-classic) пишут в зависимости от ОС.
      // Чистим все возможные места, чтобы старые миры тоже исчезали при полном сбросе.
      remove(path.join(this.gameDir, '.minecraft'));
      const home = os.homedir();
      if (process.platform === 'win32' && process.env.APPDATA) {
        remove(path.join(process.env.APPDATA, '.minecraft', 'saves'));
        // Не сносим всю %APPDATA%\.minecraft — там могут быть данные официального лаунчера
      }
      if (process.platform === 'darwin' && home) {
        remove(path.join(home, 'Library', 'Application Support', 'minecraft', 'saves'));
      }
      if (home) {
        remove(path.join(home, '.minecraft', 'saves'));
      }
    }

    return { removed, keptUserData: opts.keepUserData };
  }

  /** Restart the launcher cleanly. */
  restart() {
    app.relaunch();
    app.exit(0);
  }

  /**
   * Полное удаление лаунчера через NSIS-uninstaller.
   * Если keepUserData=false — сначала чистим всё, потом запускаем uninstaller.
   * Возвращает false если uninstaller не найден (например, portable-сборка).
   */
  uninstallLauncher(opts: ResetOptions): { ok: boolean; reason?: string } {
    // Сначала чистим данные
    this.perform(opts);

    // Ищем NSIS uninstaller
    const exePath = process.execPath;            // ...\AppData\Local\Programs\AuroraLauncher\AuroraLauncher.exe
    const exeDir = path.dirname(exePath);
    const candidates = [
      path.join(exeDir, 'Uninstall AuroraLauncher.exe'),
      path.join(exeDir, 'Uninstall Aurora Launcher.exe'),
      path.join(exeDir, 'Uninstall.exe'),
      path.join(exeDir, '..', 'Uninstall AuroraLauncher.exe'),
    ];
    const uninstaller = candidates.find((p) => fs.existsSync(p));
    if (!uninstaller) {
      return { ok: false, reason: 'NSIS uninstaller не найден. Возможно, это portable-сборка — удалите .exe вручную.' };
    }

    // Запускаем uninstaller отвязанно от родителя и сразу выходим из лаунчера
    const child = spawn(uninstaller, ['/allusers', '_?=' + exeDir], {
      detached: true,
      stdio: 'ignore',
      cwd: exeDir,
    });
    child.unref();

    setTimeout(() => app.exit(0), 200);
    return { ok: true };
  }
}
