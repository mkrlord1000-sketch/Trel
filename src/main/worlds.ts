import * as fs from 'node:fs';
import * as path from 'node:path';
import AdmZip from 'adm-zip';

export interface WorldInfo {
  name: string;             // folder name
  displayName: string;      // from level.dat or fallback
  path: string;             // absolute path to world folder
  lastPlayed: number;       // epoch ms, 0 if unknown
  sizeBytes: number;
  gameMode?: number;        // 0 survival, 1 creative, 2 adventure, 3 spectator
  hardcore?: boolean;
  version?: string;         // version used to create/save world
  hasIcon: boolean;
}

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      try {
        if (e.isDirectory()) total += dirSize(p);
        else total += fs.statSync(p).size;
      } catch {}
    }
  } catch {}
  return total;
}

/**
 * Parse very minimal data from level.dat NBT WITHOUT adding an NBT dependency.
 * We look for TAG_Long LastPlayed, TAG_String LevelName, TAG_Int GameType, TAG_Byte hardcore, TAG_String Version.name.
 * The binary format of NBT makes it possible to grep these values reliably since their key names are unique ASCII strings.
 */
function parseLevelDat(file: string): { name?: string; lastPlayed?: number; gameMode?: number; hardcore?: boolean; version?: string } {
  try {
    let raw: Buffer;
    try {
      // level.dat is gzipped NBT
      raw = require('node:zlib').gunzipSync(fs.readFileSync(file));
    } catch {
      raw = fs.readFileSync(file);
    }
    const out: any = {};

    // Helper: find tag by ASCII name, assume preceding 2 bytes are name length
    function findTag(tagId: number, name: string): number {
      const needle = Buffer.alloc(1 + 2 + name.length);
      needle[0] = tagId;
      needle.writeUInt16BE(name.length, 1);
      needle.write(name, 3, 'ascii');
      return raw.indexOf(needle);
    }

    const nameIdx = findTag(0x08, 'LevelName'); // TAG_String
    if (nameIdx >= 0) {
      const lenOff = nameIdx + 1 + 2 + 'LevelName'.length;
      const len = raw.readUInt16BE(lenOff);
      out.name = raw.slice(lenOff + 2, lenOff + 2 + len).toString('utf-8');
    }

    const lpIdx = findTag(0x04, 'LastPlayed'); // TAG_Long (ms)
    if (lpIdx >= 0) {
      const valOff = lpIdx + 1 + 2 + 'LastPlayed'.length;
      out.lastPlayed = Number(raw.readBigInt64BE(valOff));
    }

    const gmIdx = findTag(0x03, 'GameType'); // TAG_Int
    if (gmIdx >= 0) {
      const valOff = gmIdx + 1 + 2 + 'GameType'.length;
      out.gameMode = raw.readInt32BE(valOff);
    }

    const hcIdx = findTag(0x01, 'hardcore'); // TAG_Byte
    if (hcIdx >= 0) {
      const valOff = hcIdx + 1 + 2 + 'hardcore'.length;
      out.hardcore = raw[valOff] === 1;
    }

    // Version.Name inside a compound — find TAG_String "Name"
    const vIdx = findTag(0x08, 'Name');
    if (vIdx >= 0) {
      const valOff = vIdx + 1 + 2 + 'Name'.length;
      const len = raw.readUInt16BE(valOff);
      const val = raw.slice(valOff + 2, valOff + 2 + len).toString('utf-8');
      // Only accept if looks like a version string
      if (/^\d/.test(val) && val.length < 40) out.version = val;
    }

    return out;
  } catch {
    return {};
  }
}

export class WorldService {
  constructor(private gameDir: string) {}

  setGameDir(dir: string) { this.gameDir = dir; }

  /** saves/ is shared for the vanilla game directory. */
  savesDir(): string { return path.join(this.gameDir, 'saves'); }

  /**
   * Старые версии (rd-*, c0.*, alpha-classic) пишут миры в зависимости от ОС:
   * Windows -> %APPDATA%\.minecraft (System.getenv("APPDATA"))
   * Mac     -> ~/Library/Application Support/minecraft
   * Linux   -> ~/.minecraft (user.home)
   *
   * Возвращаем все возможные расположения сохранений ВНУТРИ нашего gameDir
   * (gameDir/saves, gameDir/.minecraft/saves, gameDir/.minecraft).
   *
   * Системные пути (%APPDATA%\.minecraft) НЕ включаются: иначе миры
   * официального лаунчера Mojang всплывали бы в UI Trel — это и зрелищно
   * сбивает с толку, и опасно (можно случайно удалить чужой мир).
   *
   * Pre-Classic версии при наличии нашей подмены `APPDATA=gameDir` пишут
   * `level.dat` прямо в gameDir, а не в системный `.minecraft` — для них
   * хватает ветки `looseLevelDatRoots()` ниже.
   */
  legacyRoots(): string[] {
    const out = [
      path.join(this.gameDir, 'saves'),
      path.join(this.gameDir, '.minecraft', 'saves'),
      path.join(this.gameDir, '.minecraft'),
    ];
    return out;
  }

  /**
   * Где Pre-Classic версии физически пишут одиночный `level.dat`.
   * Шире, чем `legacyRoots()`, потому что rd-* запускается с cwd=gameDir
   * и `-Duser.dir=gameDir`, а потом пишет `level.dat` прямо туда —
   * не в `gameDir/saves` и не в `gameDir/.minecraft`. Если этот корень
   * не учесть, файл не находится и не удаляется при «полностью удалить».
   */
  private looseLevelDatRoots(): string[] {
    const out: string[] = [
      this.gameDir,                     // rd-* пишет сюда из-за cwd=gameDir
      ...this.legacyRoots(),
    ];
    // dedupe
    const seen = new Set<string>();
    return out.filter((p) => {
      const k = path.resolve(p).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  list(): WorldInfo[] {
    const seen = new Set<string>();
    const out: WorldInfo[] = [];

    const scanRoot = (root: string, isLegacy: boolean) => {
      if (!fs.existsSync(root)) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch { return; }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(root, entry.name);
        // Avoid recursing into nested .minecraft accidentally
        if (entry.name === '.minecraft') continue;

        const levelDat = path.join(dir, 'level.dat');
        if (!fs.existsSync(levelDat)) continue;

        // Avoid duplicates by canonical path
        const key = path.resolve(dir).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const parsed = parseLevelDat(levelDat);
        out.push({
          name: entry.name,
          displayName: parsed.name || entry.name,
          path: dir,
          lastPlayed: parsed.lastPlayed || 0,
          sizeBytes: dirSize(dir),
          gameMode: parsed.gameMode,
          hardcore: parsed.hardcore,
          version: parsed.version,
          hasIcon: fs.existsSync(path.join(dir, 'icon.png')),
        });
      }
    };

    for (const root of this.legacyRoots()) scanRoot(root, root !== this.savesDir());

    // Pre-Classic / Classic / rd-* версии сохраняют мир как ОДИНОЧНЫЙ файл
    // <root>/level.dat (а не как папку). Без этой ветки такие миры были
    // не видны в UI — пользователь не мог их удалить, и они "воскресали"
    // при следующем запуске старой версии.
    //
    // Indev/Infdev (in-*, inf-*) дополнительно используют формат `mclevel.dat`
    // в gameDir и `saves/<name>.mclevel` (одиночные файлы, не папки).
    const gameDirResolved = path.resolve(this.gameDir).toLowerCase();
    const looseFiles = ['level.dat', 'mclevel.dat'];
    for (const root of this.looseLevelDatRoots()) {
      for (const fileName of looseFiles) {
        const looseFile = path.join(root, fileName);
        if (!fs.existsSync(looseFile)) continue;
        let stat: fs.Stats;
        try { stat = fs.statSync(looseFile); } catch { continue; }
        if (!stat.isFile()) continue;

        const key = path.resolve(looseFile).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const inGameDir = path.resolve(root).toLowerCase().startsWith(gameDirResolved);
        const isIndev = fileName === 'mclevel.dat';
        out.push({
          name: this.syntheticLooseName(root, fileName),
          displayName: isIndev
            ? (inGameDir ? 'Indev мир' : 'Indev мир (вне лаунчера)')
            : (inGameDir ? 'Pre-Classic мир' : 'Pre-Classic мир (вне лаунчера)'),
          path: root,
          lastPlayed: stat.mtimeMs,
          sizeBytes: stat.size,
          hasIcon: false,
          version: isIndev ? 'Indev/Infdev' : 'Pre-Classic',
        });
      }
    }

    // Infdev: миры могут лежать как `saves/<имя>.mclevel` (одиночные файлы).
    // Ищем такие файлы во всех savesDir-ах. Их формат отличается от
    // современного — мы их просто показываем чтобы можно было удалить.
    for (const root of this.legacyRoots()) {
      if (!fs.existsSync(root)) continue;
      let entries: string[];
      try { entries = fs.readdirSync(root); } catch { continue; }
      for (const entry of entries) {
        if (!entry.toLowerCase().endsWith('.mclevel')) continue;
        const full = path.join(root, entry);
        let stat: fs.Stats;
        try { stat = fs.statSync(full); } catch { continue; }
        if (!stat.isFile()) continue;

        const key = path.resolve(full).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        out.push({
          name: this.syntheticLooseName(root, entry),
          displayName: `Infdev мир (${entry.replace(/\.mclevel$/i, '')})`,
          path: root,
          lastPlayed: stat.mtimeMs,
          sizeBytes: stat.size,
          hasIcon: false,
          version: 'Infdev',
        });
      }
    }

    out.sort((a, b) => b.lastPlayed - a.lastPlayed);
    return out;
  }

  /**
   * Synthetic name for a loose level/mclevel file (Pre-Classic / Indev / Infdev).
   * Encodes parent dir path + filename, чтобы один root мог содержать
   * несколько разных world-файлов (например `level.dat` от Pre-Classic
   * и `mclevel.dat` от Indev одновременно).
   */
  private syntheticLooseName(root: string, fileName: string = 'level.dat'): string {
    const rootKey = path.resolve(root).replace(/[\\/:]/g, '_');
    const fileKey = fileName.replace(/[\\/:]/g, '_');
    return '~legacy:' + rootKey + ':' + fileKey;
  }

  /** Resolve a world name (folder OR synthetic loose) to its filesystem location. */
  private resolveWorld(worldName: string): { kind: 'folder' | 'loose'; dir: string; levelDat: string } | null {
    if (worldName.startsWith('~legacy:')) {
      // Новый формат: `~legacy:<rootKey>:<fileName>`. Старый формат
      // `~legacy:<rootKey>` всё ещё поддерживаем для обратной совместимости —
      // тогда подразумеваем `level.dat`.
      const rest = worldName.slice('~legacy:'.length);
      // Имя файла идёт после последнего ':' (rootKey не содержит ':' благодаря
      // замене разделителей в syntheticLooseName).
      const lastColon = rest.lastIndexOf(':');
      let fileName = 'level.dat';
      if (lastColon >= 0) {
        const tail = rest.slice(lastColon + 1);
        // Эвристика: легитимные world-файлы — level.dat[.suffix] или *.mclevel
        if (/^level\.dat([._-].*)?$/i.test(tail) || /^mclevel\.dat$/i.test(tail) || /\.mclevel$/i.test(tail)) {
          fileName = tail;
        }
      }
      for (const root of this.looseLevelDatRoots()) {
        if (this.syntheticLooseName(root, fileName) !== worldName
            && this.syntheticLooseName(root) !== worldName) continue;
        const file = path.join(root, fileName);
        try {
          if (fs.existsSync(file) && fs.statSync(file).isFile()) {
            return { kind: 'loose', dir: root, levelDat: file };
          }
        } catch {}
      }
      // Fallback для legacyRoots (могут быть Infdev-файлы в saves/)
      for (const root of this.legacyRoots()) {
        if (this.syntheticLooseName(root, fileName) !== worldName) continue;
        const file = path.join(root, fileName);
        try {
          if (fs.existsSync(file) && fs.statSync(file).isFile()) {
            return { kind: 'loose', dir: root, levelDat: file };
          }
        } catch {}
      }
      return null;
    }
    // Обычное имя мира — папка saves/<имя>. Защита от `../`: убеждаемся,
    // что реальный resolved-путь действительно лежит ВНУТРИ root.
    for (const root of this.legacyRoots()) {
      const dir = path.join(root, worldName);
      const resolvedRoot = path.resolve(root);
      const resolvedDir = path.resolve(dir);
      if (
        resolvedDir !== resolvedRoot &&
        !resolvedDir.startsWith(resolvedRoot + path.sep)
      ) {
        // worldName содержал `..` или абсолютный путь — пропускаем root.
        continue;
      }
      const levelDat = path.join(dir, 'level.dat');
      if (fs.existsSync(levelDat)) return { kind: 'folder', dir, levelDat };
    }
    return null;
  }

  /** Find absolute path of world by its folder name across all legacy roots. */
  findWorldPath(worldName: string): string | null {
    const r = this.resolveWorld(worldName);
    return r ? r.dir : null;
  }

  iconDataUrl(worldName: string): string | null {
    const r = this.resolveWorld(worldName);
    if (!r || r.kind !== 'folder') return null;
    const p = path.join(r.dir, 'icon.png');
    if (!fs.existsSync(p)) return null;
    try {
      const buf = fs.readFileSync(p);
      return 'data:image/png;base64,' + buf.toString('base64');
    } catch {
      return null;
    }
  }

  delete(worldName: string): boolean {
    const r = this.resolveWorld(worldName);
    if (!r) return false;
    if (r.kind === 'folder') {
      fs.rmSync(r.dir, { recursive: true, force: true });
      return true;
    }
    // Loose-формат: удаляем сам файл и его сиблинги-бэкапы.
    // Pre-Classic: `level.dat`, `level.dat_old`, `level.dat.bak`
    // Indev:       `mclevel.dat`, `mclevel.dat_old`
    // Infdev:      `<имя>.mclevel` — только сам файл, бэкапов обычно нет
    try { fs.rmSync(r.levelDat, { force: true }); } catch {}
    const baseName = path.basename(r.levelDat).toLowerCase();
    try {
      for (const entry of fs.readdirSync(r.dir)) {
        const lower = entry.toLowerCase();
        // Удаляем бэкапы только для level.dat / mclevel.dat
        if (baseName === 'level.dat' && /^level\.dat([._-].*)?$/i.test(entry)) {
          try { fs.rmSync(path.join(r.dir, entry), { force: true }); } catch {}
        } else if (baseName === 'mclevel.dat' && /^mclevel\.dat([._-].*)?$/i.test(entry)) {
          try { fs.rmSync(path.join(r.dir, entry), { force: true }); } catch {}
        }
      }
    } catch {}
    return true;
  }

  /** Delete world AND all its existing zip backups in <gameDir>/backups/<worldName>-*.zip */
  deleteWithBackups(worldName: string): { world: boolean; backupsRemoved: number } {
    const worldDeleted = this.delete(worldName);
    let backupsRemoved = 0;
    const backupsDir = path.join(this.gameDir, 'backups');
    if (fs.existsSync(backupsDir)) {
      const safeName = worldName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const prefixes = [worldName + '-', safeName + '-'];
      for (const file of fs.readdirSync(backupsDir)) {
        if (!file.endsWith('.zip')) continue;
        if (!prefixes.some((p) => file.startsWith(p))) continue;
        try {
          fs.unlinkSync(path.join(backupsDir, file));
          backupsRemoved++;
        } catch {}
      }
    }
    return { world: worldDeleted, backupsRemoved };
  }

  /**
   * Удаляет ВСЕ loose-файлы миров (level.dat*, mclevel.dat*, *.mclevel)
   * из всех корней, куда могли записать мир Pre-Classic / Classic / Indev /
   * Infdev / ранний Alpha. Шире чем `legacyRoots()` — включает сам gameDir,
   * потому что rd-* и Indev запускаются с cwd=gameDir и пишут эти файлы
   * прямо туда.
   *
   * Используется при «полностью удалить» pre-classic версии и при полном
   * сбросе лаунчера. Без этого после удаления старой версии мир сохранялся
   * и «воскресал» при следующем запуске любой совместимой старой версии.
   *
   * Удаляются только сами world-файлы — папки и прочие файлы рядом не
   * трогаются, чтобы не задеть данные официального лаунчера.
   */
  wipeAllLooseLevelDat(): string[] {
    const removed: string[] = [];
    const looseRe = /^(level\.dat|mclevel\.dat)([._-].*)?$|\.mclevel$/i;
    for (const root of this.looseLevelDatRoots()) {
      if (!fs.existsSync(root)) continue;
      let entries: string[];
      try { entries = fs.readdirSync(root); } catch { continue; }
      for (const entry of entries) {
        if (!looseRe.test(entry)) continue;
        const full = path.join(root, entry);
        try {
          // Только файл; если по какой-то причине это директория с таким
          // именем — пропускаем, чтобы не снести случайно полноценный мир.
          if (fs.statSync(full).isFile()) {
            fs.rmSync(full, { force: true });
            removed.push(full);
          }
        } catch {}
      }
    }
    // Дополнительно: Infdev-миры в saves-папках (`saves/<name>.mclevel`).
    for (const root of this.legacyRoots()) {
      if (!fs.existsSync(root)) continue;
      let entries: string[];
      try { entries = fs.readdirSync(root); } catch { continue; }
      for (const entry of entries) {
        if (!/\.mclevel$/i.test(entry)) continue;
        const full = path.join(root, entry);
        try {
          if (fs.statSync(full).isFile()) {
            fs.rmSync(full, { force: true });
            removed.push(full);
          }
        } catch {}
      }
    }
    return removed;
  }

  /** Zip the world folder to `<gameDir>/backups/<worldName>-<timestamp>.zip` and return its path. */
  backup(worldName: string): string {
    const r = this.resolveWorld(worldName);
    if (!r) throw new Error('World not found');
    const backupsDir = path.join(this.gameDir, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = worldName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const out = path.join(backupsDir, `${safeName}-${stamp}.zip`);
    const zip = new AdmZip();
    if (r.kind === 'folder') {
      zip.addLocalFolder(r.dir, path.basename(r.dir));
    } else {
      zip.addLocalFile(r.levelDat);
    }
    zip.writeZip(out);
    return out;
  }
}
