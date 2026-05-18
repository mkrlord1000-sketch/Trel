import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { WorldService } from './worlds';

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
  constructor(
    private launcherDir: string,
    private gameDir: string,
    private worlds: WorldService,
  ) {}

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
      // Чистим только наш локальный gameDir/.minecraft. Системные пути
      // (%APPDATA%\.minecraft, ~/.minecraft) НЕ трогаем — там лежат данные
      // официального лаунчера Mojang, и пользователь не ожидает что наш
      // «сброс» уничтожит чужие миры.
      remove(path.join(this.gameDir, '.minecraft'));

      // Pre-Classic (rd-*, c0.*, in-*, inf-*, ранний alpha) хранит мир как
      // одинокий `level.dat` прямо в корне APPDATA/.minecraft (или, при
      // нашей подмене APPDATA→gameDir, прямо в gameDir). Папок saves/ у этих
      // версий нет, поэтому remove(.../saves) не помогает — нужно отдельно
      // прибить именно файлы level.dat*. wipeAllLooseLevelDat теперь тоже
      // ходит только по нашим путям (см. WorldService).
      try {
        for (const file of this.worlds.wipeAllLooseLevelDat()) removed.push(file);
      } catch {}
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
    const exePath = process.execPath;            // ...\AppData\Local\Programs\Trel\Trel.exe
    const exeDir = path.dirname(exePath);
    const candidates = [
      path.join(exeDir, 'Uninstall Trel.exe'),
      path.join(exeDir, 'Uninstall.exe'),
      path.join(exeDir, '..', 'Uninstall Trel.exe'),
      // Legacy: пользователи, которые ставили старую версию под именем AuroraLauncher
      path.join(exeDir, 'Uninstall AuroraLauncher.exe'),
      path.join(exeDir, 'Uninstall Aurora Launcher.exe'),
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
