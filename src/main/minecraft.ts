import * as fs from 'node:fs';
import * as path from 'node:path';
import { BrowserWindow } from 'electron';
import { launch, LaunchOption } from '@xmcl/core';
import { VersionInfo, LaunchOptions } from '../shared/types';
import { JavaService } from './java';
import { MinecraftInstaller } from './installer';
import { LoaderService, LoaderType, LoaderVersion } from './loaders';

export class MinecraftService {
  private installer: MinecraftInstaller;
  public loaders: LoaderService;

  constructor(private gameDir: string, private java: JavaService) {
    this.installer = new MinecraftInstaller(gameDir);
    this.loaders = new LoaderService(gameDir, java, this.installer);
  }

  setGameDir(dir: string) {
    this.gameDir = dir;
    this.installer.setGameDir(dir);
    this.loaders.setGameDir(dir);
  }

  async fetchVersions(): Promise<VersionInfo[]> {
    const list = await this.installer.fetchVersions();
    return list as VersionInfo[];
  }

  /** Return the IDs of versions already downloaded (client jar is present). */
  installedVersionIds(): string[] {
    const versionsDir = path.join(this.gameDir, 'versions');
    if (!fs.existsSync(versionsDir)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(versionsDir)) {
      const jar = path.join(versionsDir, entry, `${entry}.jar`);
      if (fs.existsSync(jar)) out.push(entry);
    }
    return out;
  }

  /** Delete an installed version's files (its own folder under versions/<id>). */
  uninstall(versionId: string): boolean {
    const dir = path.join(this.gameDir, 'versions', versionId);
    if (!fs.existsSync(dir)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  }

  /** Deep uninstall: version folder, orphaned libs & assets, per-version data dirs (saves/resourcepacks/mods inside versions/<id>). */
  uninstallDeep(versionId: string): { removed: string[] } {
    const removed: string[] = [];
    const versionDir = path.join(this.gameDir, 'versions', versionId);
    if (fs.existsSync(versionDir)) {
      fs.rmSync(versionDir, { recursive: true, force: true });
      removed.push(versionDir);
    }
    // Some launchers put saves/resourcepacks inside versions/<id>; wipe leftovers if any still exist
    for (const sub of ['saves', 'resourcepacks', 'mods', 'shaderpacks']) {
      const p = path.join(this.gameDir, 'versions', versionId, sub);
      if (fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true, force: true });
        removed.push(p);
      }
    }
    // Clean up orphaned libraries/assets only if no other versions exist
    const versionsRoot = path.join(this.gameDir, 'versions');
    const hasOther = fs.existsSync(versionsRoot) && fs.readdirSync(versionsRoot).some((e) => {
      const jar = path.join(versionsRoot, e, e + '.jar');
      return fs.existsSync(jar);
    });
    if (!hasOther) {
      for (const sub of ['libraries', 'assets']) {
        const p = path.join(this.gameDir, sub);
        if (fs.existsSync(p)) {
          fs.rmSync(p, { recursive: true, force: true });
          removed.push(p);
        }
      }
    }
    return { removed };
  }

  gameFolder(): string {
    return this.gameDir;
  }

  versionFolder(versionId: string): string {
    return path.join(this.gameDir, 'versions', versionId);
  }

  async install(versionId: string, win: BrowserWindow) {
    return this.installer.install(versionId, win);
  }

  /** Decide which Java to use for a version. Returns executable path. */
  async resolveJava(requiredMajor: number, userJavaPath: string | undefined, win: BrowserWindow): Promise<{ path: string; reason: string }> {
    // Validate user override compatibility
    if (userJavaPath && userJavaPath.trim() && fs.existsSync(userJavaPath)) {
      const info = await this.java.inspectExe(userJavaPath);
      if (info && JavaService.isCompatible(info.major, requiredMajor)) {
        return { path: userJavaPath, reason: `user override (Java ${info.major})` };
      }
      // Incompatible — warn via log, fall through to auto-selection
      win.webContents.send(
        'minecraft:log',
        `[launcher] Ignoring user Java override at ${userJavaPath}: Java ${info?.major ?? '?'} is not compatible with required Java ${requiredMajor}. Auto-selecting.\n`
      );
    }
    const best = await this.java.findBest(requiredMajor);
    if (best) return { path: best.path, reason: `auto-selected Java ${best.major} from system` };
    const fresh = await this.java.ensure(requiredMajor, win);
    return { path: fresh.path, reason: `downloaded Java ${requiredMajor}` };
  }

  async launch(opts: LaunchOptions, win: BrowserWindow, userJavaPath?: string): Promise<number> {
    const versionDir = path.join(this.gameDir, 'versions', opts.versionId);
    const clientJar = path.join(versionDir, opts.versionId + '.jar');
    const jsonPath = path.join(versionDir, opts.versionId + '.json');

    let requiredMajor: number;
    if (fs.existsSync(clientJar) && fs.existsSync(jsonPath)) {
      // Версия уже установлена — НЕ перепроверяем все файлы, только читаем требуемую Java
      try {
        const json = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        requiredMajor = json.javaVersion?.majorVersion;
        if (!requiredMajor && json.inheritsFrom) {
          // Гибридные (Fabric/Forge) — берём из родителя
          const parentJson = path.join(this.gameDir, 'versions', json.inheritsFrom, json.inheritsFrom + '.json');
          if (fs.existsSync(parentJson)) {
            const pj = JSON.parse(fs.readFileSync(parentJson, 'utf-8'));
            requiredMajor = pj.javaVersion?.majorVersion;
          }
        }
        requiredMajor = requiredMajor ?? 8;
      } catch {
        requiredMajor = 8;
      }
    } else {
      // Не установлено — ставим
      const ver = await this.install(opts.versionId, win);
      requiredMajor = ver.javaVersion?.majorVersion ?? 8;
    }

    const { path: javaPath, reason } = await this.resolveJava(requiredMajor, userJavaPath, win);
    win.webContents.send('minecraft:log', `[launcher] Using Java: ${javaPath} (${reason})\n`);

    // Старые версии (rd-*, c0.*, in-*, inf-*, alpha) игнорируют gamePath и
    // пишут мир в зависимости от ОС:
    //   Win   -> %APPDATA%\.minecraft   (System.getenv("APPDATA"))
    //   Mac   -> ~/Library/Application Support/minecraft
    //   Linux -> ~/.minecraft           (System.getProperty("user.home"))
    // Подменяем переменные окружения чтобы каждый случай попадал в наш gameDir.
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    childEnv.APPDATA = this.gameDir;
    childEnv.HOME = this.gameDir;
    childEnv.USERPROFILE = this.gameDir;

    const launchOption: LaunchOption = {
      version: opts.versionId,
      gamePath: this.gameDir,
      javaPath,
      nativeRoot: path.join(this.gameDir, 'versions', opts.versionId, 'natives'),
      gameProfile: {
        name: opts.account.name,
        id: opts.account.uuid,
      },
      accessToken: '0'.repeat(32),
      userType: 'legacy',
      launcherName: 'AuroraLauncher',
      launcherBrand: 'Aurora',
      minMemory: Math.floor(opts.memoryMb / 2),
      maxMemory: opts.memoryMb,
      // JVM-флаги: дублируем path overrides на случай если Java читает их из properties
      extraJVMArgs: [
        `-Duser.home=${this.gameDir}`,
        `-Duser.dir=${this.gameDir}`,
      ],
      // Главное: подменяем переменные окружения, которые читают legacy-версии
      extraExecOption: {
        env: childEnv,
        cwd: this.gameDir,
      },
    };

    const proc = await launch(launchOption);

    proc.stdout?.on('data', (d: Buffer) => {
      if (!win.isDestroyed()) win.webContents.send('minecraft:log', d.toString());
    });
    proc.stderr?.on('data', (d: Buffer) => {
      if (!win.isDestroyed()) win.webContents.send('minecraft:log', d.toString());
    });
    proc.on('exit', (code) => {
      if (!win.isDestroyed()) win.webContents.send('minecraft:exit', code ?? -1);
    });

    return proc.pid ?? -1;
  }
}
