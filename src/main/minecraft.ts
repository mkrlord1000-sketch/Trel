import * as fs from 'node:fs';
import * as path from 'node:path';
import { BrowserWindow } from 'electron';
import { launch, LaunchOption } from '@xmcl/core';
import { VersionInfo, LaunchOptions } from '../shared/types';
import { supportsCustomSkin } from '../shared/skin-support';
import { JavaService } from './java';
import { MinecraftInstaller } from './installer';
import { LoaderService, LoaderType } from './loaders';
import { WorldService } from './worlds';
import { SkinServer } from './skin-server';
import { AuthlibInjector } from './authlib';

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
 * Pre-Classic / Classic / Indev / Infdev / ранний Alpha — версии, которые
 * вместо папки `saves/<world>` пишут одиночные world-файлы прямо в gameDir
 * (или в gameDir/.minecraft при системной подмене APPDATA):
 *   - rd-* / c0.*       → `level.dat`
 *   - in-* (Indev)      → `mclevel.dat`
 *   - inf-* (Infdev)    → `<имя>.mclevel` (в saves/) или `level.dat`
 *   - a1.0.*, a1.1.0    → `level.dat` (старый формат, до a1.1.1)
 *
 * При полном (deep) удалении такой версии нужно зачистить loose-файлы,
 * иначе при следующем запуске любой совместимой старой версии мир
 * «воскреснет» сам. WorldService.wipeAllLooseLevelDat() покрывает все
 * три формата.
 *
 * Совпадает только с теми префиксами, у которых формат сохранения =
 * одиночный файл. С beta/release не пересекается.
 */
function isPreClassicVersionId(id: string): boolean {
  return /^(rd-|c0\.|in-|inf-|a1\.0\.|a1\.1\.0)/i.test(id);
}

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
  private worlds: WorldService;
  /** Shared между клиентом и серверами — авторизация и скины через один mock. */
  private skinServer: SkinServer;
  private authlib: AuthlibInjector;
  private launcherDir: string;
  /** Идентификаторы версий, для которых сейчас выполняется launch — защита от двойного клика. */
  private launchingVersions = new Set<string>();

  constructor(
    private gameDir: string,
    private java: JavaService,
    worlds?: WorldService,
    launcherDir?: string,
    skinServer?: SkinServer,
    authlib?: AuthlibInjector,
  ) {
    this.installer = new MinecraftInstaller(gameDir);
    this.loaders = new LoaderService(gameDir, java, this.installer);
    this.worlds = worlds ?? new WorldService(gameDir);
    // launcherDir для authlib-injector кэша. Если не передан — кладём рядом с gameDir.
    this.launcherDir = launcherDir ?? path.dirname(gameDir);
    this.skinServer = skinServer ?? new SkinServer();
    this.authlib = authlib ?? new AuthlibInjector(this.launcherDir);
  }

  setGameDir(dir: string) {
    this.gameDir = dir;
    this.installer.setGameDir(dir);
    this.loaders.setGameDir(dir);
    this.worlds.setGameDir(dir);
  }

  async fetchVersions(): Promise<VersionInfo[]> {
    const list = await this.installer.fetchVersions();
    return list as VersionInfo[];
  }

  /**
   * Возвращает ID установленных версий: тех, у которых на диске есть
   * собственный клиентский jar в `versions/<id>/<id>.jar`.
   *
   * Раньше считали «jar или json» — это давало false positives после
   * установки лоадеров: parent ваниль (`1.21.11`) хранится как одна
   * папка с одним только JSON (для inheritsFrom-резолва), без jar.
   * После flatten она удаляется, но fetchVersionJson может пересоздать
   * JSON-файл при любом обращении к Forge-профилю — и в списке вылазит
   * «третья версия», которой реально нет.
   *
   * Для loader-профилей `flattenLoaderProfile()` копирует jar в их папку,
   * так что и Fabric/Quilt-инстансы (которые исходно идут как inherits-only)
   * после flatten корректно проходят эту проверку.
   */
  installedVersionIds(): string[] {
    const versionsDir = path.join(this.gameDir, 'versions');
    if (!fs.existsSync(versionsDir)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(versionsDir)) {
      const dir = path.join(versionsDir, entry);
      const jar = path.join(dir, `${entry}.jar`);
      if (fs.existsSync(jar)) out.push(entry);
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
   *
   * Дополнительно подчищает orphan-папки ванили: папки в `versions/<id>/`
   * с одним JSON и без JAR, которые соответствуют base-MC уже-установленного
   * лоадера. Такие «призраки» появлялись когда installer резолвил inheritsFrom
   * и создавал JSON-файл, но flatten их не успевал убрать. UI их видел как
   * отдельную «третью» версию.
   */
  consolidateInstalls(): void {
    for (const d of this.installedDetailed()) {
      if (d.loader) this.loaders.flattenLoaderProfile(d.id);
    }
    this.cleanupOrphanedParents();
  }

  /**
   * Удаляет папки `versions/<id>/` где:
   *  - нет собственного JAR
   *  - и есть установленный лоадер с baseMc === id
   * Это и есть «призрак» родительской ванили после flatten.
   */
  private cleanupOrphanedParents(): void {
    const versionsRoot = path.join(this.gameDir, 'versions');
    if (!fs.existsSync(versionsRoot)) return;
    // Соберём базы тех версий, для которых есть установленный лоадер.
    const installedLoaders = this.installedVersionIds()
      .map((id) => this.detailFor(id))
      .filter((d) => d.loader);
    const moddedBases = new Set(installedLoaders.map((d) => d.baseMc));

    for (const entry of fs.readdirSync(versionsRoot)) {
      if (!moddedBases.has(entry)) continue;
      const dir = path.join(versionsRoot, entry);
      const jar = path.join(dir, entry + '.jar');
      if (fs.existsSync(jar)) continue; // Это нормальная установка ванили — не трогаем.
      // Папка есть, JAR нет, для этой базы есть лоадер → orphan.
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
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
    // Pre-Classic / Classic / Indev / rd-* пишут мир как одинокий level.dat
    // в корень APPDATA/.minecraft (у нас → gameDir или gameDir/.minecraft).
    // versions/<id>/saves для них не существует, поэтому без явной зачистки
    // мир остаётся на диске и при следующем запуске старой версии
    // «воскресает». Чистим только если других pre-classic версий не осталось,
    // чтобы не задеть мир, общий между несколькими rd-*.
    if (isPreClassicVersionId(versionId) && !this.hasOtherPreClassicInstalled(versionId)) {
      try {
        for (const file of this.worlds.wipeAllLooseLevelDat()) removed.push(file);
      } catch {}
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

  /**
   * Проверяет, остались ли установленные pre-classic версии помимо `excludeId`.
   * Используется в uninstallDeep, чтобы не зачистить общий loose level.dat,
   * если у пользователя установлено несколько rd-* / c0.* версий.
   */
  private hasOtherPreClassicInstalled(excludeId: string): boolean {
    const versionsRoot = path.join(this.gameDir, 'versions');
    if (!fs.existsSync(versionsRoot)) return false;
    try {
      for (const entry of fs.readdirSync(versionsRoot)) {
        if (entry === excludeId) continue;
        if (!isPreClassicVersionId(entry)) continue;
        // Должна быть реально установлена (jar или json)
        const dir = path.join(versionsRoot, entry);
        if (fs.existsSync(path.join(dir, entry + '.jar')) ||
            fs.existsSync(path.join(dir, entry + '.json'))) {
          return true;
        }
      }
    } catch {}
    return false;
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
   * Wire up content folders for the given version so the game (which always
   * reads gameDir/<mods|shaderpacks|...>) actually sees this version's content.
   *
   * Раньше использовали NTFS junction → gameDir/mods был линком. Forge на JDK 21
   * при старте делает `Files.createDirectories(gameDir/mods)` и на junction
   * валится `FileAlreadyExistsException` — поэтому теперь стратегия другая:
   *   gameDir/<sub> — обычная папка (Forge её спокойно видит)
   *   её содержимое — жёсткие ссылки на файлы из versions/<id>/<sub>
   * Жёсткая ссылка на файл с точки зрения NTFS — это тот же inode, никакого
   * дублирования места, и игра видит её как обычный файл.
   */
  linkContentFolders(versionId: string): void {
    const versionDir = this.versionFolder(versionId);
    if (!fs.existsSync(versionDir)) return;
    for (const sub of CONTENT_FOLDERS) {
      this.mirrorOneContentFolder(versionDir, sub);
    }
  }

  /**
   * Зеркалит содержимое versions/<id>/<sub> в gameDir/<sub> через hard-links.
   * Если в gameDir/<sub> ранее был junction (от старой версии лаунчера) —
   * аккуратно удаляем его (это «висячий» entry, не сама папка).
   * Если в gameDir/<sub> уже лежат реальные файлы — миграция в version-folder.
   */
  private mirrorOneContentFolder(versionDir: string, sub: string): void {
    const target = path.join(this.gameDir, sub);
    const source = path.join(versionDir, sub);

    // Per-version папка — всегда есть.
    try { fs.mkdirSync(source, { recursive: true }); } catch {}

    // Если в gameDir/<sub> сейчас junction (legacy-режим) — снимаем его
    // как linkfile. На NTFS junction отображается как symlink.
    let isLink = false;
    try { isLink = fs.lstatSync(target).isSymbolicLink(); } catch {}
    if (isLink) {
      try { fs.unlinkSync(target); }
      catch { try { fs.rmSync(target, { recursive: true, force: true }); } catch {} }
    }

    // Если в gameDir/<sub> уже лежит реальная папка с файлами от прошлого
    // запуска другой версии — переносим её содержимое в version-folder этой
    // версии (один раз), потом будем зеркалить только текущей версии.
    // Делаем это аккуратно: НЕ трогаем уже зазеркаленные файлы (hardlinks с
    // тем же содержимым считаются «уже существующими» в version dir и
    // пропускаются). Перенос делаем для НЕ-зеркал — то есть когда target
    // содержит файлы, которых нет в source.
    if (fs.existsSync(target) && !isLink) {
      try {
        // На первом запуске после старого junction-режима target может
        // уже быть пустой папкой — это ок, пропустим. Если же в нём что-то
        // есть и оно не совпадает с source — переносим в source.
        for (const entry of fs.readdirSync(target)) {
          const from = path.join(target, entry);
          const to = path.join(source, entry);
          if (fs.existsSync(to)) continue;
          try { fs.renameSync(from, to); }
          catch {
            try { fs.cpSync(from, to, { recursive: true }); fs.rmSync(from, { recursive: true, force: true }); } catch {}
          }
        }
      } catch {}
    }

    // Создаём gameDir/<sub> как обычную папку.
    try { fs.mkdirSync(target, { recursive: true }); } catch {}

    // Чистим target от записей, которых уже нет в source (другие версии,
    // удалённые моды и т.д.). Реальные файлы НЕ трогаем — только удаляем
    // hard-links: если у файла больше 1 ссылки, безопасно удалить эту.
    try {
      const sourceEntries = new Set(fs.readdirSync(source));
      for (const entry of fs.readdirSync(target)) {
        if (sourceEntries.has(entry)) continue;
        const tp = path.join(target, entry);
        try {
          const st = fs.lstatSync(tp);
          if (st.isFile() && st.nlink > 1) {
            // Это hardlink — наш зеркальный артефакт. Удаляем.
            fs.unlinkSync(tp);
          }
          // Если nlink == 1 (единственная ссылка) или это директория —
          // оставляем: пользователь мог положить что-то руками.
        } catch {}
      }
    } catch {}

    // Зеркалим текущие файлы из version-folder в gameDir/<sub>.
    try {
      for (const entry of fs.readdirSync(source)) {
        const sp = path.join(source, entry);
        const tp = path.join(target, entry);
        let sStat: fs.Stats;
        try { sStat = fs.statSync(sp); } catch { continue; }
        if (!sStat.isFile()) continue; // моды/паки — это файлы (.jar/.zip), вложенные папки игнорируем

        // Если target уже существует — проверяем что это та же ссылка.
        if (fs.existsSync(tp)) {
          try {
            const tStat = fs.statSync(tp);
            // Один и тот же inode на NTFS = одинаковые ino. Если совпадает,
            // ничего делать не надо.
            if (tStat.ino && sStat.ino && tStat.ino === sStat.ino) continue;
            // Иначе — пользовательский файл с тем же именем. Не перезаписываем,
            // чтобы не потерять чужой.
            continue;
          } catch {}
        }

        try {
          fs.linkSync(sp, tp);
        } catch {
          // Если hard-link не получился (например, разные тома), копируем.
          // Это допустимый fallback — лишь чуть-чуть места.
          try { fs.copyFileSync(sp, tp); } catch {}
        }
      }
    } catch {}
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

  /** Обновляет список аккаунтов в локальном skin-сервере. Вызывается из ipc после изменений в accounts.json. */
  updateSkinAccounts(list: import('../shared/types').MinecraftAccount[]): void {
    this.skinServer.setAccounts(list);
  }

  /**
   * Поддерживает ли версия Minecraft authlib-injector. См. shared/skin-support.ts —
   * предикат единый для main и renderer, чтобы UI и backend всегда были
   * согласованы по списку версий «без скинов».
   */
  private supportsAuthlibInjector(versionId: string, baseMc: string | undefined): boolean {
    return supportsCustomSkin(versionId, baseMc);
  }

  async launch(opts: LaunchOptions, win: BrowserWindow, userJavaPath?: string): Promise<number> {
    // Защита от двойного клика «Играть»: если уже идёт запуск той же
    // версии, отбиваем второй вызов чтобы не плодить процессы и не
    // конфликтовать на FS-операциях (linkContentFolders, content folders).
    if (this.launchingVersions.has(opts.versionId)) {
      throw new Error('Запуск уже идёт — подождите');
    }
    this.launchingVersions.add(opts.versionId);
    try {
      return await this.doLaunch(opts, win, userJavaPath);
    } finally {
      this.launchingVersions.delete(opts.versionId);
    }
  }

  private async doLaunch(opts: LaunchOptions, win: BrowserWindow, userJavaPath?: string): Promise<number> {
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

    // Java-резолв и подготовка content-папок никак не связаны — пусть бегут
    // параллельно. На горячем пути (кэш Java тёплый) выигрыш ~10-30ms.
    const javaPromise = this.resolveJava(requiredMajor, userJavaPath, win);

    // Привязываем content-папки (mods/shaderpacks/...) к текущей версии через
    // NTFS junction-ы, чтобы каждая версия видела свои моды/паки, а игра при
    // этом продолжала читать gameDir/<sub>. См. linkContentFolders.
    this.ensureContentFolders(opts.versionId);
    this.linkContentFolders(opts.versionId);

    // ─── authlib-injector: кастомный скин в игре ──────────────────────────
    // Параллельно с резолвом Java стартуем skin-сервер и качаем агент.
    // Если что-то упало — просто запустим без агента (скин не будет виден,
    // но игра запустится).
    let authlibArgs: string[] = [];
    let baseMc: string | undefined;
    try {
      const json = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      baseMc = json.inheritsFrom ?? undefined;
    } catch {}
    const useAuthlib = !!opts.account.skin && this.supportsAuthlibInjector(opts.versionId, baseMc);
    if (useAuthlib) {
      try {
        // НЕ делаем setAccounts([opts.account]) — это бы стёр остальных
        // (например, если параллельно запущен сервер). skinServer держит
        // все аккаунты, обновляемые через ipc.refreshSkinServer; здесь
        // только запускаем сервер и подключаем агент.
        const [apiUrl, agentPath] = await Promise.all([
          this.skinServer.start(),
          this.authlib.ensure(),
        ]);
        authlibArgs = [
          `-javaagent:${agentPath}=${apiUrl}`,
        ];
        win.webContents.send('minecraft:log', `[launcher] authlib-injector активен (${apiUrl})\n`);
      } catch (e) {
        win.webContents.send('minecraft:log', `[launcher] authlib-injector недоступен (${(e as Error).message}) — играем без кастомного скина\n`);
      }
    }

    const { path: javaPath, reason } = await javaPromise;
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
      launcherName: 'Trel',
      launcherBrand: 'Trel',
      minMemory: Math.floor(opts.memoryMb / 2),
      maxMemory: opts.memoryMb,
      // JVM-флаги: дублируем path overrides на случай если Java читает их из properties
      extraJVMArgs: [
        `-Duser.home=${this.gameDir}`,
        `-Duser.dir=${this.gameDir}`,
        ...authlibArgs,
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
