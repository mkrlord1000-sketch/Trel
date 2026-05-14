import axios from 'axios';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import { BrowserWindow } from 'electron';
import { JavaService } from './java';
import { MinecraftInstaller } from './installer';
import { DownloadProgress } from '../shared/types';

export type LoaderType = 'fabric' | 'quilt' | 'neoforge' | 'forge';

export interface LoaderVersion {
  loader: LoaderType;
  /** Loader version, e.g. "0.16.0" or "47.3.10" */
  version: string;
  /** True if marked stable / recommended */
  stable?: boolean;
  /** Some loaders include the MC version in the id (e.g. NeoForge) */
  mcVersion?: string;
}

export interface InstallLoaderResult {
  /** New version id that can be launched (and is now in versions/ folder). */
  versionId: string;
}

export class LoaderService {
  constructor(private gameDir: string, private java: JavaService, private installer: MinecraftInstaller) {}

  setGameDir(dir: string) {
    this.gameDir = dir;
    this.installer.setGameDir(dir);
  }

  // ------------------------------------------------------------------
  // Fetching available versions
  // ------------------------------------------------------------------

  async listVersions(loader: LoaderType, mc: string): Promise<LoaderVersion[]> {
    switch (loader) {
      case 'fabric':   return this.listFabric(mc);
      case 'quilt':    return this.listQuilt(mc);
      case 'neoforge': return this.listNeoForge(mc);
      case 'forge':    return this.listForge(mc);
    }
  }

  private async listFabric(mc: string): Promise<LoaderVersion[]> {
    const url = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}`;
    const { data } = await axios.get(url, { timeout: 15000 });
    return (data as any[]).map((it) => ({
      loader: 'fabric' as const,
      version: it.loader.version,
      stable: it.loader.stable,
    }));
  }

  private async listQuilt(mc: string): Promise<LoaderVersion[]> {
    const url = `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mc)}`;
    const { data } = await axios.get(url, { timeout: 15000 });
    return (data as any[]).map((it) => ({
      loader: 'quilt' as const,
      version: it.loader.version,
    }));
  }

  private async listNeoForge(mc: string): Promise<LoaderVersion[]> {
    const url = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge';
    try {
      const { data } = await axios.get(url, { timeout: 15000 });
      const versions = data?.versions ?? [];
      // NeoForge versions look like "21.1.10". MC version is encoded as the prefix:
      // 21.1.x -> 1.21.1, 20.4.x -> 1.20.4. We filter those that match.
      const expectedPrefix = mcToNeoForgePrefix(mc);
      return versions
        .filter((v: string) => !expectedPrefix || v.startsWith(expectedPrefix))
        .map((v: string) => ({ loader: 'neoforge' as const, version: v, mcVersion: mc }));
    } catch {
      return [];
    }
  }

  private async listForge(mc: string): Promise<LoaderVersion[]> {
    // Fast metadata source maintained by the Forge-files project
    const url = `https://files.minecraftforge.net/net/minecraftforge/forge/index_${mc}.html`;
    // The official maven metadata is much heavier; instead we use the BMCLAPI mirror's index:
    const apiUrl = `https://bmclapi2.bangbang93.com/forge/minecraft/${mc}`;
    try {
      const { data } = await axios.get(apiUrl, { timeout: 15000 });
      // returns array of { build, version, mcversion, ... }
      return (data as any[])
        .map((it) => ({
          loader: 'forge' as const,
          version: `${it.mcversion}-${it.version}`,
          mcVersion: it.mcversion,
        }))
        .reverse();
    } catch {
      return [];
    }
  }

  // ------------------------------------------------------------------
  // Installation
  // ------------------------------------------------------------------

  async install(
    loader: LoaderType,
    mc: string,
    loaderVersion: string,
    win: BrowserWindow,
  ): Promise<InstallLoaderResult> {
    // Make sure base MC is installed first.
    this.report(win, { stage: `Установка Minecraft ${mc}`, current: 0, total: 1, percent: 5 });
    await this.installer.install(mc, win);

    switch (loader) {
      case 'fabric':   return this.installFabric(mc, loaderVersion, win);
      case 'quilt':    return this.installQuilt(mc, loaderVersion, win);
      case 'neoforge': return this.installNeoForge(mc, loaderVersion, win);
      case 'forge':    return this.installForge(mc, loaderVersion, win);
    }
  }

  private async installProfileFromJson(jsonUrl: string, idTemplate: string, win: BrowserWindow): Promise<InstallLoaderResult> {
    this.report(win, { stage: 'Загрузка профиля лоадера', current: 0, total: 1, percent: 30 });
    const { data: profile } = await axios.get(jsonUrl, { timeout: 30000 });
    const versionId = profile.id || idTemplate;

    const versionsDir = path.join(this.gameDir, 'versions', versionId);
    fs.mkdirSync(versionsDir, { recursive: true });
    const jsonPath = path.join(versionsDir, versionId + '.json');
    fs.writeFileSync(jsonPath, JSON.stringify(profile, null, 2), 'utf-8');

    this.report(win, { stage: 'Скачивание библиотек лоадера', current: 0, total: 1, percent: 50 });
    // Кладём через стандартный installer (он умеет inheritsFrom и докачает либы)
    await this.installer.install(versionId, win);

    this.report(win, { stage: 'Готово', current: 1, total: 1, percent: 100 });
    return { versionId };
  }

  private async installFabric(mc: string, lv: string, win: BrowserWindow) {
    const url = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(lv)}/profile/json`;
    const id = `fabric-loader-${lv}-${mc}`;
    return this.installProfileFromJson(url, id, win);
  }

  private async installQuilt(mc: string, lv: string, win: BrowserWindow) {
    const url = `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(lv)}/profile/json`;
    const id = `quilt-loader-${lv}-${mc}`;
    return this.installProfileFromJson(url, id, win);
  }

  private async installNeoForge(mc: string, lv: string, win: BrowserWindow): Promise<InstallLoaderResult> {
    const installerUrl =
      `https://maven.neoforged.net/releases/net/neoforged/neoforge/${lv}/neoforge-${lv}-installer.jar`;
    return this.runJarInstaller('neoforge', installerUrl, mc, lv, win);
  }

  private async installForge(mc: string, lv: string, win: BrowserWindow): Promise<InstallLoaderResult> {
    // lv looks like "1.20.1-47.2.0"
    const installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${lv}/forge-${lv}-installer.jar`;
    return this.runJarInstaller('forge', installerUrl, mc, lv, win);
  }

  private async runJarInstaller(
    loader: 'forge' | 'neoforge',
    installerUrl: string,
    mc: string,
    lv: string,
    win: BrowserWindow,
  ): Promise<InstallLoaderResult> {
    const tmpFile = path.join(os.tmpdir(), `${loader}-installer-${Date.now()}.jar`);
    this.report(win, { stage: `Загрузка ${loader} installer`, current: 0, total: 100, percent: 30 });

    const resp = await axios.get(installerUrl, { responseType: 'stream', timeout: 120000, maxRedirects: 10 });
    const total = Number(resp.headers['content-length']) || 0;
    let downloaded = 0;
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(tmpFile);
      resp.data.on('data', (c: Buffer) => {
        downloaded += c.length;
        if (total > 0) {
          this.report(win, {
            stage: `Загрузка ${loader} installer`,
            current: downloaded, total,
            percent: 30 + Math.floor((downloaded / total) * 30),
          });
        }
      });
      resp.data.on('error', reject);
      out.on('error', reject);
      out.on('finish', () => resolve());
      resp.data.pipe(out);
    });

    // Need Java to run the installer
    this.report(win, { stage: 'Подготовка Java', current: 0, total: 1, percent: 60 });
    const java = await this.java.findBest(17) ?? await this.java.findBest(8) ?? await this.java.ensure(17, win);

    this.report(win, { stage: `Запуск ${loader} installer`, current: 0, total: 1, percent: 70 });
    await this.runJar(java.path, tmpFile);

    try { fs.unlinkSync(tmpFile); } catch {}

    // Determine resulting version id by scanning versions/ for new entry
    const versionId = this.detectInstalledLoaderVersion(loader, mc, lv);
    this.report(win, { stage: 'Готово', current: 1, total: 1, percent: 100 });
    return { versionId };
  }

  private runJar(javaPath: string, jarFile: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Forge installer accepts --installClient. NeoForge follows same pattern.
      const args = ['-jar', jarFile, '--installClient', this.gameDir];
      const proc = spawn(javaPath, args, { stdio: 'pipe' });
      let stderr = '';
      proc.stderr?.on('data', (d) => stderr += d.toString());
      proc.on('error', reject);
      proc.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Installer завершился с кодом ${code}: ${stderr.slice(0, 500)}`));
      });
    });
  }

  private detectInstalledLoaderVersion(loader: 'forge' | 'neoforge', mc: string, lv: string): string {
    const versionsDir = path.join(this.gameDir, 'versions');
    if (!fs.existsSync(versionsDir)) throw new Error('versions folder not found');
    const entries = fs.readdirSync(versionsDir);
    const needle = loader === 'forge' ? 'forge' : 'neoforge';
    // Prefer entry that contains both loader name and version
    const match = entries.find((n) => n.toLowerCase().includes(needle) && n.includes(lv.split('-').pop() || ''));
    if (match) return match;
    const fallback = entries.find((n) => n.toLowerCase().includes(needle) && n.includes(mc));
    if (fallback) return fallback;
    throw new Error(`Не удалось определить установленную версию ${loader}`);
  }

  private report(win: BrowserWindow, p: DownloadProgress) {
    if (!win.isDestroyed()) win.webContents.send('minecraft:progress', p);
  }
}

function mcToNeoForgePrefix(mc: string): string | null {
  // 1.20.1 -> "20.1."
  // 1.21    -> "21."
  // 1.21.1 -> "21.1."
  const m = /^1\.(\d+)(?:\.(\d+))?$/.exec(mc);
  if (!m) return null;
  return m[2] ? `${m[1]}.${m[2]}.` : `${m[1]}.`;
}
