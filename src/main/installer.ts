import axios, { AxiosRequestConfig } from 'axios';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import { BrowserWindow } from 'electron';
import AdmZip from 'adm-zip';
import { DownloadProgress } from '../shared/types';

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
const RESOURCES_HOST = 'https://resources.download.minecraft.net';

interface MojangDownload {
  url: string;
  sha1: string;
  size: number;
}

interface MojangLibraryArtifact extends MojangDownload {
  path: string;
}

interface MojangLibrary {
  name: string;
  downloads?: {
    artifact?: MojangLibraryArtifact;
    classifiers?: Record<string, MojangLibraryArtifact>;
  };
  natives?: Record<string, string>;
  extract?: { exclude?: string[] };
  rules?: Array<{ action: 'allow' | 'disallow'; os?: { name?: string; version?: string; arch?: string } }>;
  url?: string; // for legacy libs served from libraries.minecraft.net
}

interface VersionJson {
  id: string;
  inheritsFrom?: string;
  assets?: string;
  assetIndex?: { id: string; url: string; sha1: string; size: number; totalSize: number };
  downloads?: { client?: MojangDownload; server?: MojangDownload };
  libraries: MojangLibrary[];
  javaVersion?: { component: string; majorVersion: number };
  mainClass: string;
  type: string;
  minecraftArguments?: string;
  arguments?: { game: any[]; jvm: any[] };
}

interface AssetIndexJson {
  objects: Record<string, { hash: string; size: number }>;
  virtual?: boolean;
  map_to_resources?: boolean;
}

function sha1File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(file);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function ensureDir(p: string) {
  await fs.promises.mkdir(p, { recursive: true });
}

function osName(): 'windows' | 'linux' | 'osx' {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'osx';
  return 'linux';
}

function libraryAllowed(lib: MojangLibrary): boolean {
  if (!lib.rules || lib.rules.length === 0) return true;
  let allowed = false;
  for (const rule of lib.rules) {
    const matches = !rule.os || rule.os.name === osName() || (rule.os.name === 'osx' && process.platform === 'darwin');
    if (matches) allowed = rule.action === 'allow';
    else if (!rule.os) allowed = rule.action === 'allow';
  }
  return allowed;
}

function nativeClassifier(lib: MojangLibrary): string | null {
  if (!lib.natives) return null;
  const key = osName();
  return lib.natives[key] || null;
}

async function downloadWithRetry(
  url: string,
  dest: string,
  expectedSha1: string | undefined,
  attempts = 5,
): Promise<void> {
  await ensureDir(path.dirname(dest));

  // Already there & valid?
  if (fs.existsSync(dest) && expectedSha1) {
    try {
      const actual = await sha1File(dest);
      if (actual === expectedSha1) return;
    } catch {}
  } else if (fs.existsSync(dest) && !expectedSha1) {
    return;
  }

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const tmp = dest + '.part';
      const cfg: AxiosRequestConfig = {
        responseType: 'stream',
        timeout: 60000,
        maxRedirects: 10,
        validateStatus: (s) => s >= 200 && s < 400,
      };
      const resp = await axios.get(url, cfg);
      await new Promise<void>((resolve, reject) => {
        const out = fs.createWriteStream(tmp);
        resp.data.on('error', reject);
        out.on('error', reject);
        out.on('finish', () => resolve());
        resp.data.pipe(out);
      });
      if (expectedSha1) {
        const actual = await sha1File(tmp);
        if (actual !== expectedSha1) {
          try { fs.unlinkSync(tmp); } catch {}
          throw new Error(`sha1 mismatch for ${url}: expected ${expectedSha1}, got ${actual}`);
        }
      }
      try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch {}
      fs.renameSync(tmp, dest);
      return;
    } catch (e) {
      lastErr = e;
      // exponential backoff
      await new Promise((r) => setTimeout(r, 300 * Math.pow(2, i)));
    }
  }
  throw new Error(`Failed to download ${url}: ${(lastErr as Error)?.message ?? lastErr}`);
}

async function parallelPool<T>(items: T[], worker: (item: T) => Promise<void>, concurrency: number, onOne?: () => void): Promise<void> {
  let i = 0;
  const runners: Promise<void>[] = [];
  const next = async (): Promise<void> => {
    while (i < items.length) {
      const idx = i++;
      try {
        await worker(items[idx]);
      } finally {
        onOne?.();
      }
    }
  };
  for (let n = 0; n < concurrency; n++) runners.push(next());
  await Promise.all(runners);
}

export class MinecraftInstaller {
  constructor(private gameDir: string) {}

  setGameDir(dir: string) {
    this.gameDir = dir;
  }

  async fetchVersions(): Promise<{ id: string; type: string; url: string; releaseTime: string }[]> {
    const { data } = await axios.get(MANIFEST_URL, { timeout: 15000 });
    return data.versions;
  }

  private report(win: BrowserWindow | undefined, p: DownloadProgress) {
    if (win && !win.isDestroyed()) win.webContents.send('minecraft:progress', p);
  }

  /** Download (if missing) the version JSON and return it. Resolves inheritsFrom transitively. */
  private async fetchVersionJson(versionId: string): Promise<VersionJson> {
    // Location under gameDir
    const versionDir = path.join(this.gameDir, 'versions', versionId);
    await ensureDir(versionDir);
    const jsonPath = path.join(versionDir, versionId + '.json');

    if (!fs.existsSync(jsonPath)) {
      // Look up in global manifest
      const { data: manifest } = await axios.get(MANIFEST_URL, { timeout: 15000 });
      const entry = (manifest.versions as Array<{ id: string; url: string }>).find(v => v.id === versionId);
      if (!entry) throw new Error(`Version ${versionId} not found in manifest`);
      const { data: versionJson } = await axios.get(entry.url, { timeout: 15000 });
      fs.writeFileSync(jsonPath, JSON.stringify(versionJson, null, 2), 'utf-8');
    }

    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as VersionJson;

    if (parsed.inheritsFrom) {
      const parent = await this.fetchVersionJson(parsed.inheritsFrom);
      return this.merge(parent, parsed);
    }
    return parsed;
  }

  private merge(parent: VersionJson, child: VersionJson): VersionJson {
    return {
      ...parent,
      ...child,
      libraries: [...(child.libraries ?? []), ...(parent.libraries ?? [])],
      javaVersion: child.javaVersion ?? parent.javaVersion,
      assetIndex: child.assetIndex ?? parent.assetIndex,
      assets: child.assets ?? parent.assets,
      downloads: { ...(parent.downloads ?? {}), ...(child.downloads ?? {}) },
      mainClass: child.mainClass ?? parent.mainClass,
      arguments: child.arguments ?? parent.arguments,
      minecraftArguments: child.minecraftArguments ?? parent.minecraftArguments,
    };
  }

  /** Full install: version JSON, client jar, libraries (+ natives), asset index + assets. Idempotent. */
  async install(versionId: string, win?: BrowserWindow): Promise<VersionJson> {
    await ensureDir(this.gameDir);

    this.report(win, { stage: 'Fetching version metadata', current: 0, total: 1, percent: 2 });
    const ver = await this.fetchVersionJson(versionId);

    // --- Client JAR ---
    this.report(win, { stage: 'Downloading client jar', current: 0, total: 1, percent: 5 });
    const versionDir = path.join(this.gameDir, 'versions', versionId);
    const clientJar = path.join(versionDir, versionId + '.jar');
    if (ver.downloads?.client) {
      await downloadWithRetry(ver.downloads.client.url, clientJar, ver.downloads.client.sha1);
    } else if (!fs.existsSync(clientJar)) {
      // Very old versions may not have downloads field; fallback to launcher assets legacy endpoint
      const legacyUrl = `https://s3.amazonaws.com/Minecraft.Download/versions/${versionId}/${versionId}.jar`;
      await downloadWithRetry(legacyUrl, clientJar, undefined);
    }

    // --- Libraries and natives ---
    const librariesRoot = path.join(this.gameDir, 'libraries');
    const nativesDir = path.join(versionDir, 'natives');
    await ensureDir(nativesDir);

    const libs = (ver.libraries || []).filter(libraryAllowed);
    const libDownloadTasks: (() => Promise<void>)[] = [];
    const nativeArtifacts: MojangLibraryArtifact[] = [];
    const nativeExcludes: Record<string, string[]> = {};

    for (const lib of libs) {
      // normal artifact
      const art = lib.downloads?.artifact;
      if (art) {
        const dest = path.join(librariesRoot, art.path);
        libDownloadTasks.push(() => downloadWithRetry(art.url, dest, art.sha1));
      } else if (lib.name && lib.url) {
        // Legacy maven-style library (e.g. old forge, some modded)
        const [group, artifact, version] = lib.name.split(':');
        const rel = `${group.replace(/\./g, '/')}/${artifact}/${version}/${artifact}-${version}.jar`;
        const url = lib.url.replace(/\/$/, '') + '/' + rel;
        const dest = path.join(librariesRoot, rel);
        libDownloadTasks.push(() => downloadWithRetry(url, dest, undefined));
      }
      // natives
      const classifier = nativeClassifier(lib);
      if (classifier && lib.downloads?.classifiers?.[classifier]) {
        const nat = lib.downloads.classifiers[classifier];
        nativeArtifacts.push(nat);
        if (lib.extract?.exclude) nativeExcludes[nat.path] = lib.extract.exclude;
        const dest = path.join(librariesRoot, nat.path);
        libDownloadTasks.push(() => downloadWithRetry(nat.url, dest, nat.sha1));
      }
    }

    let libDone = 0;
    const libTotal = libDownloadTasks.length;
    this.report(win, { stage: `Downloading libraries 0/${libTotal}`, current: 0, total: libTotal, percent: 10 });
    await parallelPool(libDownloadTasks, (t) => t(), 8, () => {
      libDone++;
      const pct = 10 + Math.floor((libDone / Math.max(1, libTotal)) * 20);
      this.report(win, { stage: `Downloading libraries ${libDone}/${libTotal}`, current: libDone, total: libTotal, percent: pct });
    });

    // Extract natives
    if (nativeArtifacts.length) {
      this.report(win, { stage: 'Extracting natives', current: 0, total: nativeArtifacts.length, percent: 32 });
      for (const nat of nativeArtifacts) {
        const jarPath = path.join(librariesRoot, nat.path);
        try {
          const zip = new AdmZip(jarPath);
          const excludes = nativeExcludes[nat.path] || ['META-INF/'];
          for (const entry of zip.getEntries()) {
            if (entry.isDirectory) continue;
            if (excludes.some((ex) => entry.entryName.startsWith(ex))) continue;
            zip.extractEntryTo(entry, nativesDir, false, true);
          }
        } catch (e) {
          console.warn('Failed to extract natives from', jarPath, e);
        }
      }
    }

    // --- Asset index + assets ---
    const assetsRoot = path.join(this.gameDir, 'assets');
    await ensureDir(assetsRoot);
    await ensureDir(path.join(assetsRoot, 'indexes'));
    await ensureDir(path.join(assetsRoot, 'objects'));

    if (ver.assetIndex) {
      const indexPath = path.join(assetsRoot, 'indexes', ver.assetIndex.id + '.json');
      await downloadWithRetry(ver.assetIndex.url, indexPath, ver.assetIndex.sha1);

      const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as AssetIndexJson;
      const entries = Object.entries(index.objects || {});
      const total = entries.length;

      this.report(win, { stage: `Downloading assets 0/${total}`, current: 0, total, percent: 40 });

      const assetTasks = entries.map(([name, { hash, size }]) => async () => {
        const prefix = hash.slice(0, 2);
        const url = `${RESOURCES_HOST}/${prefix}/${hash}`;
        const dest = path.join(assetsRoot, 'objects', prefix, hash);
        await downloadWithRetry(url, dest, hash);
        // For legacy versions (assets.virtual / map_to_resources), copy into the virtual/legacy or resources folder
        if (index.virtual) {
          const vdest = path.join(assetsRoot, 'virtual', ver.assetIndex!.id, name);
          await ensureDir(path.dirname(vdest));
          if (!fs.existsSync(vdest)) fs.copyFileSync(dest, vdest);
        }
        if (index.map_to_resources) {
          const rdest = path.join(this.gameDir, 'resources', name);
          await ensureDir(path.dirname(rdest));
          if (!fs.existsSync(rdest)) fs.copyFileSync(dest, rdest);
        }
      });

      let assetDone = 0;
      await parallelPool(assetTasks, (t) => t(), 16, () => {
        assetDone++;
        if (assetDone % 10 === 0 || assetDone === total) {
          const pct = 40 + Math.floor((assetDone / Math.max(1, total)) * 58);
          this.report(win, { stage: `Downloading assets ${assetDone}/${total}`, current: assetDone, total, percent: pct });
        }
      });
    }

    // Создаём стандартные папки для контента ВНУТРИ папки версии — каждая
    // версия имеет свои моды/паки. Соединение с тем, что видит игра в
    // gameDir/<sub>, делает MinecraftService через NTFS junctions при запуске.
    for (const sub of ['mods', 'shaderpacks', 'resourcepacks', 'texturepacks']) {
      try { await ensureDir(path.join(versionDir, sub)); } catch {}
    }

    this.report(win, { stage: 'Install complete', current: 1, total: 1, percent: 100 });
    return ver;
  }
}
