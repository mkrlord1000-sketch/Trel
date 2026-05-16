import * as fs from 'node:fs';
import * as path from 'node:path';
import { BrowserWindow } from 'electron';
import { launch, LaunchOption } from '@xmcl/core';
import { VersionInfo, LaunchOptions } from '../shared/types';
import { JavaService } from './java';
import { MinecraftInstaller } from './installer';
import { LoaderService, LoaderType, LoaderVersion } from './loaders';

export interface InstalledVersionDetail {
  /** Raw folder name (e.g. "1.20.1" or "1.20.1-forge-47.2.0"). */
  id: string;
  /** The base Minecraft version. For vanilla equals id. */
  baseMc: string;
  /** Mod loader if this is a modded profile, otherwise null. */
  loader: LoaderType | null;
  /** Loader-specific version (e.g. "47.2.0" for Forge). */
  loaderVersion: string | null;
}

const CONTENT_FOLDERS = ['mods', 'shaderpacks', 'resourcepacks', 'texturepacks'] as const;

/**
 * Detect loader + base MC from a versions folder name. Best-effort heuristic,
 * used together with the JSON's inheritsFrom field for accuracy.
 */
function detectLoaderFromId(
  id: string,
): { loader: LoaderType; baseMc: string; loaderVersion: string } | null {
  let m: RegExpExecArray | null;

  // Fabric: fabric-loader-<lv>-<mc>
  m = /^fabric-loader-(.+?)-(\d.+)$/.exec(id);
  if (m) return { loader: 'fabric', loaderVersion: m[1], baseMc: m[2] };

  // Quilt: quilt-loader-<lv>-<mc>
  m = /^quilt-loader-(.+?)-(\d.+)$/.exec(id);
  if (m) return { loader: 'quilt', loaderVersion: m[1], baseMc: m[2] };

  // Forge: <mc>-forge-<lv>  (e.g. 1.20.1-forge-47.2.0)
  m = /^(\d+(?:\.\d+){0,2})-forge-(.+)$/i.exec(id);
  if (m) return { loader: 'forge', baseMc: m[1], loaderVersion: m[2] };
  // Forge: forge-<mc>-<lv>
  m = /^forge-(\d+(?:\.\d+){0,2})-(.+)$/i.exec(id);
  if (m) return { loader: 'forge', baseMc: m[1], loaderVersion: m[2] };

  // NeoForge: neoforge-<lv>  (e.g. neoforge-21.1.10 -> 1.21.1)
  m = /^neoforge-(\d+\.\d+(?:\.\d+)?)$/i.exec(id);
  if (m) {
    const lv = m[1];
    const sm = /^(\d+)\.(\d+)(?:\.\d+)?/.exec(lv);
    if (sm) {
      const minor = parseInt(sm[2], 10);
      const baseMc = minor === 0 ? `1.${sm[1]}` : `1.${sm[1]}.${minor}`;
      return { loader: 'neoforge', baseMc, loaderVersion: lv };
    }
    return { loader: 'neoforge', baseMc: '?', loaderVersion: lv };
  }

  return null;
}

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
      const dir = path.join(versionsDir, entry);
      const jar = path.join(dir, `${entry}.jar`);
      const json = path.join(dir, `${entry}.json`);
      // Loader profiles (Fabric/Quilt) ship only a JSON and inherit the jar
      // from the parent vanilla install — count those as installed too.
      if (fs.existsSync(jar) || fs.existsSync(json)) out.push(entry);
    }
    return out;
  }

  /** Same as installedVersionIds but enriched with loader info per entry. */
  installedDetailed(): InstalledVersionDetail[] {
    return this.installedVersionIds().map((id) => this.detailFor(id));
  }

  detailFor(id: string): InstalledVersionDetail {
    const jsonPath = path.join(this.gameDir, 'versions', id, id + '.json');
    let inheritsFrom: string | undefined;
    try {
      const j = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      inheritsFrom = j.inheritsFrom;
    } catch {}

    const detected = detectLoaderFromId(id);
    if (detected) {
      return {
        id,
        baseMc: inheritsFrom ?? detected.baseMc,
        loader: detected.loader,
        loaderVersion: detected.loaderVersion,
      };
    }
    if (inheritsFrom) {
      return { id, baseMc: inheritsFrom, loader: null, loaderVersion: null };
    }
    return { id, baseMc: id, loader: null, loaderVersion: null };
  }

  /** Returns all installed loader profiles for a given base MC version. */
  loadersForBase(baseMc: string): InstalledVersionDetail[] {
    return this.installedDetailed().filter((d) => d.loader && d.baseMc === baseMc);
  }

  /**
   * Проходится по установленным лоадер-профилям и для каждого вызывает
   * flatten — это убирает «двойные» папки (lоадер + родительская ваниль),
   * сохраняя содержимое (mods/saves/...) внутри лоадера.
   * Идемпотентно — после первого прохода ничего не делает.
   */
  consolidateInstalls(): void {
    for (const d of this.installedDetailed()) {
      if (d.loader) this.loaders.flattenLoaderProfile(d.id);
    }
  }

  /**
   * Удаляет все профили лоадеров для baseMc, мигрируя их content (моды,
   * шейдеры, ресурс-/текстур-паки, миры) в чистую ванильную установку.
   * Если папки ванили нет (после flatten она была удалена), переустанавливает её.
   */
  async revertToVanilla(baseMc: string, win: BrowserWindow): Promise<{ removed: string[]; reinstalledBase: boolean }> {
    const loaders = this.loadersForBase(baseMc);
    const removed: string[] = [];

    const baseDir = this.versionFolder(baseMc);
    const baseJsonPath = path.join(baseDir, baseMc + '.json');
    let reinstalledBase = false;
    if (!fs.existsSync(baseJsonPath)) {
      // Ванилька была «впитана» в лоадер при flatten — поднимаем её обратно.
      await this.installer.install(baseMc, win);
      reinstalledBase = true;
    }
    this.ensureContentFolders(baseMc);

    for (const d of loaders) {
      const loaderDir = path.join(this.gameDir, 'versions', d.id);
      // Migrate content из папки лоадера в свежую ваниль, ничего не теряем.
      for (const sub of ['mods', 'shaderpacks', 'resourcepacks', 'texturepacks', 'saves']) {
        const fromDir = path.join(loaderDir, sub);
        if (!fs.existsSync(fromDir)) continue;
        const toDir = path.join(baseDir, sub);
        try { fs.mkdirSync(toDir, { recursive: true }); } catch {}
        try {
          for (const entry of fs.readdirSync(fromDir)) {
            const from = path.join(fromDir, entry);
            const to = path.join(toDir, entry);
            if (fs.existsSync(to)) continue;
            try { fs.renameSync(from, to); }
            catch {
              try {
                fs.cpSync(from, to, { recursive: true });
                fs.rmSync(from, { recursive: true, force: true });
              } catch {}
            }
          }
        } catch {}
      }

      try {
        fs.rmSync(loaderDir, { recursive: true, force: true });
        removed.push(d.id);
      } catch {}
    }

    return { removed, reinstalledBase };
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

  /** Resolve content folder (mods/shaderpacks/...) for a given version. */
  contentFolder(versionId: string, sub: typeof CONTENT_FOLDERS[number]): string {
    return path.join(this.versionFolder(versionId), sub);
  }

  /** Ensure content folders exist inside the version directory. */
  ensureContentFolders(versionId: string): void {
    const dir = this.versionFolder(versionId);
    if (!fs.existsSync(dir)) return;
    for (const sub of CONTENT_FOLDERS) {
      try { fs.mkdirSync(path.join(dir, sub), { recursive: true }); } catch {}
    }
  }

  /**
   * Wire up content folders for the given version so that the game (which
   * always reads gameDir/<mods|shaderpacks|...>) actually sees the per-version
   * content. We create NTFS junctions from gameDir/<sub> -> versions/<id>/<sub>.
   * On first run, any existing real folder in gameDir gets its contents moved
   * into the version folder, so the user doesn't lose mods they already placed.
   */
  linkContentFolders(versionId: string): void {
    const versionDir = this.versionFolder(versionId);
    if (!fs.existsSync(versionDir)) return;
    for (const sub of CONTENT_FOLDERS) {
      this.linkOneContentFolder(versionDir, sub);
    }
  }

  private linkOneContentFolder(versionDir: string, sub: string): void {
    const target = path.join(this.gameDir, sub);
    const source = path.join(versionDir, sub);

    try { fs.mkdirSync(source, { recursive: true }); } catch {}

    if (fs.existsSync(target)) {
      let isLink = false;
      try { isLink = fs.lstatSync(target).isSymbolicLink(); } catch {}

      if (isLink) {
        // Already a junction — check if it points to the right place.
        try {
          const current = fs.readlinkSync(target);
          if (path.resolve(current) === path.resolve(source)) return;
        } catch {}
        // Wrong target or unreadable — drop it.
        try { fs.unlinkSync(target); }
        catch { try { fs.rmSync(target, { recursive: true, force: true }); } catch {} }
      } else {
        // Real folder — migrate any contents into the version folder.
        try {
          for (const entry of fs.readdirSync(target)) {
            const from = path.join(target, entry);
            const to = path.join(source, entry);
            if (fs.existsSync(to)) continue; // don't overwrite per-version files
            try {
              fs.renameSync(from, to);
            } catch {
              // Cross-device or locked — fall back to copy+remove.
              try {
                fs.cpSync(from, to, { recursive: true });
                fs.rmSync(from, { recursive: true, force: true });
              } catch {}
            }
          }
          fs.rmSync(target, { recursive: true, force: true });
        } catch {}
      }
    }

    try {
      fs.symlinkSync(source, target, 'junction');
    } catch (e) {
      // Junctions only work on NTFS / Windows; on other systems we just leave
      // the real per-version folder and the user can use it directly.
      // Not fatal — the game will simply not see per-version content.
      // eslint-disable-next-line no-console
      console.warn(`linkContentFolders: failed to create junction for ${sub}:`, e);
    }
  }

  async install(versionId: string, win: BrowserWindow) {
    const result = await this.installer.install(versionId, win);
    this.ensureContentFolders(versionId);
    return result;
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

    // Привязываем content-папки (mods/shaderpacks/...) к текущей версии через
    // NTFS junction-ы, чтобы каждая версия видела свои моды/паки, а игра при
    // этом продолжала читать gameDir/<sub>. См. linkContentFolders.
    this.ensureContentFolders(opts.versionId);
    this.linkContentFolders(opts.versionId);

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
      launcherName: 'Trel',
      launcherBrand: 'Trel',
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
