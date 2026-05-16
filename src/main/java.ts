import axios from 'axios';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { BrowserWindow } from 'electron';
import AdmZip from 'adm-zip';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DownloadProgress } from '../shared/types';

const pExecFile = promisify(execFile);

export interface JavaInstall {
  path: string;        // executable (javaw.exe / java)
  home: string;        // parent of bin/
  major: number;
  version: string;     // full version string, e.g. "21.0.1"
  vendor?: string;
  managed: boolean;    // true if installed by this launcher
}

// Adoptium Temurin API — public JRE distribution.
// Docs: https://api.adoptium.net/q/swagger-ui/
function adoptiumUrl(major: number, osName: string, arch: string, imageType: 'jre' | 'jdk' = 'jre'): string {
  return (
    'https://api.adoptium.net/v3/binary/latest/' +
    `${major}/ga/${osName}/${arch}/${imageType}/hotspot/normal/eclipse`
  );
}

function platformInfo(): { osName: string; arch: string; isZip: boolean; exe: string } {
  const plat = process.platform;
  const a = process.arch;
  let osName: string;
  let isZip: boolean;
  let exe: string;
  if (plat === 'win32') {
    osName = 'windows';
    isZip = true;
    exe = 'javaw.exe';
  } else if (plat === 'darwin') {
    osName = 'mac';
    isZip = false;
    exe = 'java';
  } else {
    osName = 'linux';
    isZip = false;
    exe = 'java';
  }
  const arch = a === 'arm64' ? 'aarch64' : 'x64';
  return { osName, arch, isZip, exe };
}

/** Parse JAVA_VERSION=... from the release file (much cheaper than spawning java -version). */
function parseMajorFromVersionString(raw: string): number | null {
  // Examples:
  // 1.8.0_351  -> 8
  // 11.0.20    -> 11
  // 17         -> 17
  // 21.0.1     -> 21
  const s = raw.replace(/^1\./, '').split('.')[0].replace(/[^\d].*$/, '');
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function readReleaseFile(javaHome: string): { version: string; vendor?: string } | null {
  const rel = path.join(javaHome, 'release');
  if (!fs.existsSync(rel)) return null;
  try {
    const text = fs.readFileSync(rel, 'utf-8');
    const vm = /^JAVA_VERSION="?([^"\r\n]+)"?/m.exec(text);
    const vendorM = /^IMPLEMENTOR="?([^"\r\n]+)"?/m.exec(text);
    if (!vm) return null;
    return { version: vm[1], vendor: vendorM?.[1] };
  } catch {
    return null;
  }
}

async function probeJavaViaExec(exe: string): Promise<{ version: string; vendor?: string } | null> {
  try {
    // `java -version` prints to stderr
    const { stderr } = await pExecFile(exe, ['-version'], { timeout: 5000, windowsHide: true });
    const m = /version "?([^"\s]+)"?/.exec(stderr);
    if (!m) return null;
    const vendorM = /(OpenJDK|Java\(TM\)|GraalVM|Corretto|Zulu|Liberica|Semeru|Temurin)/i.exec(stderr);
    return { version: m[1], vendor: vendorM?.[1] };
  } catch {
    return null;
  }
}

function dedupeByPath(list: JavaInstall[]): JavaInstall[] {
  const seen = new Set<string>();
  const out: JavaInstall[] = [];
  for (const it of list) {
    const key = path.resolve(it.path).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function listDirSafe(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

export class JavaService {
  private cache: JavaInstall[] | null = null;

  constructor(private launcherDir: string) {}

  private javaRoot(): string {
    const dir = path.join(this.launcherDir, 'java');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** All directories where JDK/JRE installations typically live. */
  private candidateRoots(): string[] {
    const roots: string[] = [];
    if (process.platform === 'win32') {
      const programFiles = [
        process.env['ProgramFiles'] || 'C:\\Program Files',
        process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
        process.env['ProgramW6432'] || '',
      ].filter(Boolean) as string[];
      const vendorDirs = [
        'Java',
        'Eclipse Adoptium',
        'Eclipse Foundation',
        'AdoptOpenJDK',
        'Zulu',
        'Amazon Corretto',
        'BellSoft',
        'Microsoft',
        'OpenJDK',
        'SapMachine',
        'Semeru',
        'JetBrains\\Runtime',
        'Android\\Android Studio\\jbr',
      ];
      for (const pf of programFiles) {
        for (const v of vendorDirs) {
          roots.push(path.join(pf, v));
        }
      }
      // Minecraft official launcher runtime bundles
      const local = process.env['LOCALAPPDATA'];
      if (local) {
        roots.push(path.join(local, 'Packages', 'Microsoft.4297127D64EC6_8wekyb3d8bbwe', 'LocalCache', 'Local', 'runtime'));
      }
      // Scoop / user installs
      const user = process.env['USERPROFILE'];
      if (user) {
        roots.push(path.join(user, 'scoop', 'apps'));
        roots.push(path.join(user, '.jdks'));
      }
    } else if (process.platform === 'darwin') {
      roots.push('/Library/Java/JavaVirtualMachines');
      roots.push(path.join(os.homedir(), 'Library/Java/JavaVirtualMachines'));
    } else {
      roots.push('/usr/lib/jvm');
      roots.push('/usr/java');
      roots.push('/opt');
      roots.push(path.join(os.homedir(), '.jdks'));
      roots.push(path.join(os.homedir(), '.sdkman/candidates/java'));
    }
    // Our own managed folder
    roots.push(this.javaRoot());
    return roots;
  }

  /** Try to derive JavaInstall from a `javaHome` candidate. */
  private async inspect(javaHome: string, managed: boolean): Promise<JavaInstall | null> {
    const { exe } = platformInfo();
    // On macOS, JVM bundles have Contents/Home inside
    let home = javaHome;
    if (process.platform === 'darwin') {
      const inner = path.join(javaHome, 'Contents', 'Home');
      if (fs.existsSync(inner)) home = inner;
    }
    const binExe = path.join(home, 'bin', exe);
    if (!fs.existsSync(binExe)) return null;

    let parsed = readReleaseFile(home);
    if (!parsed) parsed = await probeJavaViaExec(binExe);
    if (!parsed) return null;

    const major = parseMajorFromVersionString(parsed.version);
    if (!major) return null;

    return {
      path: binExe,
      home,
      major,
      version: parsed.version,
      vendor: parsed.vendor,
      managed,
    };
  }

  /** Exhaustively scan the system. */
  async scan(): Promise<JavaInstall[]> {
    const results: JavaInstall[] = [];
    const { exe } = platformInfo();

    // 1) JAVA_HOME
    if (process.env.JAVA_HOME) {
      const item = await this.inspect(process.env.JAVA_HOME, false);
      if (item) results.push(item);
    }

    // 2) PATH — take the first `java` on it
    try {
      const { stdout } = await pExecFile(process.platform === 'win32' ? 'where' : 'which', ['java'], { timeout: 3000, windowsHide: true });
      const first = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
      if (first && fs.existsSync(first)) {
        // Resolve parent .. /bin/java -> javaHome
        const home = path.resolve(path.dirname(first), '..');
        const item = await this.inspect(home, false);
        if (item) results.push(item);
      }
    } catch {}

    // 3) Known root directories — one level deep
    for (const root of this.candidateRoots()) {
      for (const entry of listDirSafe(root)) {
        const full = path.join(root, entry);
        const managed = path.resolve(root).toLowerCase() === path.resolve(this.javaRoot()).toLowerCase();
        const item = await this.inspect(full, managed);
        if (item) { results.push(item); continue; }
        // Two levels deep (many distros nest once more, e.g. Microsoft/jdk-21/...)
        for (const subEntry of listDirSafe(full)) {
          const subFull = path.join(full, subEntry);
          const it2 = await this.inspect(subFull, managed);
          if (it2) results.push(it2);
        }
      }
    }

    const out = dedupeByPath(results).sort((a, b) => b.major - a.major);
    this.cache = out;
    return out;
  }

  async list(): Promise<JavaInstall[]> {
    if (this.cache) return this.cache;
    return this.scan();
  }

  /** Inspect a specific java executable path. Returns null if not a valid java. */
  async inspectExe(exePath: string): Promise<JavaInstall | null> {
    if (!exePath || !fs.existsSync(exePath)) return null;
    // exePath = <home>/bin/javaw.exe -> home = two levels up
    const home = path.resolve(path.dirname(exePath), '..');
    return this.inspect(home, false);
  }

  /** Check if a given java major is compatible with the required major for Minecraft. */
  static isCompatible(javaMajor: number, requiredMajor: number): boolean {
    // Minecraft <= 1.16 (required 8) uses LaunchWrapper which needs exactly Java 8
    if (requiredMajor <= 8) return javaMajor === 8;
    // 1.17+ works with Java >= required. Newer Java usually works, old Java does not.
    return javaMajor >= requiredMajor;
  }

  /** Find the best java for the given required major. Prefers exact match, then newer, then older. */
  async findBest(required: number): Promise<JavaInstall | null> {
    const all = await this.list();
    if (all.length === 0) return null;
    const exact = all.find(j => j.major === required);
    if (exact) return exact;
    if (required <= 8) {
      // Only Java 8 works for LaunchWrapper-era versions
      return all.find(j => j.major === 8) ?? null;
    }
    const greaterOrEqual = all.filter(j => j.major >= required).sort((a, b) => a.major - b.major)[0];
    if (greaterOrEqual) return greaterOrEqual;
    return null;
  }

  findManaged(major: number): JavaInstall | null {
    return (this.cache ?? []).find(j => j.managed && j.major === major) ?? null;
  }

  /** Ensure Java of the given major is available. Reuse existing, download if missing. */
  async ensure(major: number, win?: BrowserWindow): Promise<JavaInstall> {
    const found = await this.findBest(major);
    if (found) return found;

    const { osName, arch, isZip } = platformInfo();
    const url = adoptiumUrl(major, osName, arch, 'jre');
    const slot = path.join(this.javaRoot(), `jre-${major}`);
    fs.mkdirSync(slot, { recursive: true });

    const tmpFile = path.join(os.tmpdir(), `trel-jre-${major}-${Date.now()}.${isZip ? 'zip' : 'tar.gz'}`);
    this.report(win, { stage: `Downloading Java ${major}`, current: 0, total: 100, percent: 0 });

    const response = await axios.get(url, {
      responseType: 'stream',
      maxRedirects: 10,
      timeout: 120000,
    });
    const total = Number(response.headers['content-length']) || 0;
    let downloaded = 0;

    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(tmpFile);
      response.data.on('data', (chunk: Buffer) => {
        downloaded += chunk.length;
        if (total > 0) {
          this.report(win, {
            stage: `Downloading Java ${major}`,
            current: downloaded,
            total,
            percent: Math.min(99, Math.floor((downloaded / total) * 100)),
          });
        }
      });
      response.data.on('error', reject);
      out.on('error', reject);
      out.on('finish', () => resolve());
      response.data.pipe(out);
    });

    this.report(win, { stage: `Extracting Java ${major}`, current: 100, total: 100, percent: 100 });

    if (isZip) {
      const zip = new AdmZip(tmpFile);
      zip.extractAllTo(slot, true);
    } else {
      const { execFileSync } = await import('node:child_process');
      execFileSync('tar', ['-xzf', tmpFile, '-C', slot]);
    }
    try { fs.unlinkSync(tmpFile); } catch {}

    // Invalidate cache and locate the fresh install
    this.cache = null;
    const fresh = await this.findBest(major);
    if (!fresh) throw new Error('Java extracted but not found by scanner');
    return fresh;
  }

  private report(win: BrowserWindow | undefined, p: DownloadProgress) {
    if (win && !win.isDestroyed()) win.webContents.send('minecraft:progress', p);
  }
}
