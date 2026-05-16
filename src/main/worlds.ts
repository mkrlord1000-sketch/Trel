import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
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
   * Возвращаем все возможные расположения сохранений: gameDir/saves плюс
   * исторические легаси-папки.
   */
  legacyRoots(): string[] {
    const out = [
      path.join(this.gameDir, 'saves'),
      path.join(this.gameDir, '.minecraft', 'saves'),
      path.join(this.gameDir, '.minecraft'),
    ];
    // Windows: APPDATA-based path is the real one for Classic/rd-* on Win
    if (process.platform === 'win32' && process.env.APPDATA) {
      out.push(path.join(process.env.APPDATA, '.minecraft'));
      out.push(path.join(process.env.APPDATA, '.minecraft', 'saves'));
    }
    // macOS-style legacy
    if (process.platform === 'darwin') {
      const home = os.homedir();
      out.push(path.join(home, 'Library', 'Application Support', 'minecraft'));
      out.push(path.join(home, 'Library', 'Application Support', 'minecraft', 'saves'));
    }
    // Linux-style fallback
    const home = os.homedir();
    if (home) {
      out.push(path.join(home, '.minecraft'));
      out.push(path.join(home, '.minecraft', 'saves'));
    }
    return out;
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
    const gameDirResolved = path.resolve(this.gameDir).toLowerCase();
    for (const root of this.legacyRoots()) {
      const levelDat = path.join(root, 'level.dat');
      if (!fs.existsSync(levelDat)) continue;
      let stat: fs.Stats;
      try { stat = fs.statSync(levelDat); } catch { continue; }
      if (!stat.isFile()) continue;

      const key = path.resolve(levelDat).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const inGameDir = path.resolve(root).toLowerCase().startsWith(gameDirResolved);
      out.push({
        name: this.syntheticLooseName(root),
        displayName: inGameDir ? 'Pre-Classic мир' : 'Pre-Classic мир (вне лаунчера)',
        path: root,
        lastPlayed: stat.mtimeMs,
        sizeBytes: stat.size,
        hasIcon: false,
        version: 'Pre-Classic',
      });
    }

    out.sort((a, b) => b.lastPlayed - a.lastPlayed);
    return out;
  }

  /** Synthetic name for a loose level.dat (Pre-Classic). Encodes the parent dir path. */
  private syntheticLooseName(root: string): string {
    return '~legacy:' + path.resolve(root).replace(/[\\/:]/g, '_');
  }

  /** Resolve a world name (folder OR synthetic loose) to its filesystem location. */
  private resolveWorld(worldName: string): { kind: 'folder' | 'loose'; dir: string; levelDat: string } | null {
    if (worldName.startsWith('~legacy:')) {
      for (const root of this.legacyRoots()) {
        if (this.syntheticLooseName(root) !== worldName) continue;
        const levelDat = path.join(root, 'level.dat');
        try {
          if (fs.existsSync(levelDat) && fs.statSync(levelDat).isFile()) {
            return { kind: 'loose', dir: root, levelDat };
          }
        } catch {}
      }
      return null;
    }
    for (const root of this.legacyRoots()) {
      const dir = path.join(root, worldName);
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
    // Pre-Classic: удаляем level.dat и любые его сиблинги-бэкапы (level.dat_old, level.dat.bak)
    try { fs.rmSync(r.levelDat, { force: true }); } catch {}
    try {
      for (const entry of fs.readdirSync(r.dir)) {
        if (/^level\.dat([._-].*)?$/i.test(entry)) {
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
