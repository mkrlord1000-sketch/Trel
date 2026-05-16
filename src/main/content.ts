import * as fs from 'node:fs';
import * as path from 'node:path';

export type ContentKind = 'mod' | 'shader' | 'resourcepack' | 'texturepack';

export interface ContentItem {
  name: string;             // raw filename (с .disabled если есть)
  displayName: string;      // без .disabled
  kind: ContentKind;
  path: string;             // абсолютный путь
  size: number;
  enabled: boolean;
  isFolder: boolean;
}

const FOLDER_BY_KIND: Record<ContentKind, string> = {
  mod: 'mods',
  shader: 'shaderpacks',
  resourcepack: 'resourcepacks',
  texturepack: 'texturepacks',
};

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

function isInside(child: string, parent: string): boolean {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  return c === p || c.startsWith(p + path.sep);
}

export class ContentService {
  constructor(private gameDir: string) {}

  setGameDir(dir: string) { this.gameDir = dir; }

  dirFor(kind: ContentKind): string {
    return path.join(this.gameDir, FOLDER_BY_KIND[kind]);
  }

  /** Создать все стандартные папки контента (idempotent). */
  ensureFolders(): void {
    for (const kind of Object.keys(FOLDER_BY_KIND) as ContentKind[]) {
      try { fs.mkdirSync(this.dirFor(kind), { recursive: true }); } catch {}
    }
  }

  list(kind: ContentKind): ContentItem[] {
    const dir = this.dirFor(kind);
    if (!fs.existsSync(dir)) return [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return []; }

    const out: ContentItem[] = [];
    for (const e of entries) {
      if (e.name.startsWith('.')) continue; // hidden / system

      const full = path.join(dir, e.name);
      const isFolder = e.isDirectory();
      let size = 0;
      try {
        size = isFolder ? dirSize(full) : fs.statSync(full).size;
      } catch {}

      const lowName = e.name.toLowerCase();
      const isDisabled = lowName.endsWith('.disabled');
      const displayName = isDisabled ? e.name.slice(0, -'.disabled'.length) : e.name;

      // Для модов фильтруем: оставляем только .jar (с/без .disabled)
      if (kind === 'mod') {
        const baseLow = isDisabled ? lowName.slice(0, -'.disabled'.length) : lowName;
        if (!baseLow.endsWith('.jar')) continue;
      }

      out.push({
        name: e.name,
        displayName,
        kind,
        path: full,
        size,
        enabled: !isDisabled,
        isFolder,
      });
    }
    return out.sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru'));
  }

  delete(kind: ContentKind, name: string): boolean {
    const dir = this.dirFor(kind);
    const full = path.join(dir, name);
    if (!isInside(full, dir)) return false;
    if (!fs.existsSync(full)) return false;
    try {
      fs.rmSync(full, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  /** Включить/выключить элемент: добавляет/убирает .disabled расширение. */
  toggle(kind: ContentKind, name: string): boolean {
    const dir = this.dirFor(kind);
    const full = path.join(dir, name);
    if (!isInside(full, dir)) return false;
    if (!fs.existsSync(full)) return false;
    const newPath = full.toLowerCase().endsWith('.disabled')
      ? full.slice(0, -'.disabled'.length)
      : full + '.disabled';
    try {
      fs.renameSync(full, newPath);
      return true;
    } catch {
      return false;
    }
  }

  /** Скопировать файлы в папку контента. Не перезаписывает — добавляет (1), (2)... */
  add(kind: ContentKind, sourcePaths: string[]): { copied: number; errors: string[] } {
    const dir = this.dirFor(kind);
    fs.mkdirSync(dir, { recursive: true });
    const errors: string[] = [];
    let copied = 0;
    for (const src of sourcePaths) {
      try {
        const baseName = path.basename(src);
        const ext = path.extname(baseName);
        const stem = baseName.slice(0, baseName.length - ext.length);
        let dest = path.join(dir, baseName);
        let i = 1;
        while (fs.existsSync(dest)) {
          dest = path.join(dir, `${stem} (${i})${ext}`);
          i++;
        }
        const stat = fs.statSync(src);
        if (stat.isDirectory()) {
          fs.cpSync(src, dest, { recursive: true });
        } else {
          fs.copyFileSync(src, dest);
        }
        copied++;
      } catch (e) {
        errors.push(path.basename(src) + ': ' + (e as Error).message);
      }
    }
    return { copied, errors };
  }
}
