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

/** Версия формата java-cache.json. Меняется при breaking-change структуры. */
const JAVA_CACHE_VERSION = 1;
/** Сколько времени трастим persistent-кэш без фонового re-scan. 7 дней. */
const JAVA_CACHE_FRESH_MS = 7 * 24 * 60 * 60 * 1000;

interface JavaCacheFile {
  version: number;
  scannedAt: number;
  platform: string;          // process.platform + '-' + process.arch
  installs: JavaInstall[];
}

export class JavaService {
  private cache: JavaInstall[] | null = null;
  /** Промис текущего scan(), чтобы параллельные вызовы шарили один обход. */
  private scanInFlight: Promise<JavaInstall[]> | null = null;
  /** Был ли persistent-кэш загружен в this.cache (а не результат scan). */
  private cacheLoadedFromDisk = false;

  constructor(private launcherDir: string) {}

  private javaRoot(): string {
    const dir = path.join(this.launcherDir, 'java');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private cacheFile(): string {
    return path.join(this.launcherDir, 'java-cache.json');
  }

  /** Грузит persistent-кэш с диска, фильтруя несуществующие пути. Null если кэш отсутствует/повреждён/устарел по платформе. */
  private loadCacheFromDisk(): { installs: JavaInstall[]; scannedAt: number } | null {
    try {
      const file = this.cacheFile();
      if (!fs.existsSync(file)) return null;
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as JavaCacheFile;
      if (raw.version !== JAVA_CACHE_VERSION) return null;
      const platform = `${process.platform}-${process.arch}`;
      if (raw.platform !== platform) return null;
      if (!Array.isArray(raw.installs)) return null;
      // Отсеиваем пути которых уже нет на диске — пользователь мог
      // удалить JRE между запусками.
      const valid = raw.installs.filter((i) =>
        i && typeof i.path === 'string' && fs.existsSync(i.path)
      );
      if (valid.length === 0) return null;
      return { installs: valid, scannedAt: raw.scannedAt ?? 0 };
    } catch {
      return null;
    }
  }

  private saveCacheToDisk(installs: JavaInstall[]): void {
    try {
      const payload: JavaCacheFile = {
        version: JAVA_CACHE_VERSION,
        scannedAt: Date.now(),
        platform: `${process.platform}-${process.arch}`,
        installs,
      };
      fs.writeFileSync(this.cacheFile(), JSON.stringify(payload, null, 2), 'utf-8');
    } catch {}
  }

  /**
   * Прогревает кэш Java в фоне, не блокируя caller. Безопасно вызывать
   * многократно: повторные вызовы просто await'ят уже идущий scan.
   * Используется при старте лаунчера, чтобы первый клик «Играть» не ждал.
   */
  prewarm(): Promise<JavaInstall[]> {
    return this.list();
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

  /**
   * Полное сканирование системы. Параллельно проверяет все кандидатные
   * директории + JAVA_HOME + первый `java` из PATH. На холодном диске
   * занимает ~200-500ms, на тёплом ~50-150ms.
   */
  async scan(): Promise<JavaInstall[]> {
    // Дедуплицируем параллельные вызовы — несколько подсистем могут
    // одновременно запросить scan на старте, нет смысла обходить FS дважды.
    if (this.scanInFlight) return this.scanInFlight;
    this.scanInFlight = this.doScan();
    try {
      return await this.scanInFlight;
    } finally {
      this.scanInFlight = null;
    }
  }

  private async doScan(): Promise<JavaInstall[]> {
    const tasks: Promise<JavaInstall | null>[] = [];

    // 1) JAVA_HOME
    if (process.env.JAVA_HOME) {
      tasks.push(this.inspect(process.env.JAVA_HOME, false));
    }

    // 2) PATH — первый `java`. Запускаем параллельно с обходом папок,
    // чтобы 50-200ms на spawn `where` не блокировали остальное.
    tasks.push((async () => {
      try {
        const { stdout } = await pExecFile(
          process.platform === 'win32' ? 'where' : 'which',
          ['java'],
          { timeout: 3000, windowsHide: true },
        );
        const first = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
        if (first && fs.existsSync(first)) {
          const home = path.resolve(path.dirname(first), '..');
          return this.inspect(home, false);
        }
      } catch {}
      return null;
    })());

    // 3) Известные корневые директории — одно- и двухуровневая глубина.
    // Раньше это был последовательный двойной for; теперь все inspect()
    // запускаются параллельно через Promise.all.
    const javaRoot = this.javaRoot();
    const javaRootKey = path.resolve(javaRoot).toLowerCase();
    for (const root of this.candidateRoots()) {
      const managed = path.resolve(root).toLowerCase() === javaRootKey;
      for (const entry of listDirSafe(root)) {
        const full = path.join(root, entry);
        tasks.push(this.inspect(full, managed));
        // Two levels deep — Microsoft/jdk-21/, Eclipse Adoptium/jdk-17.0.x/...
        for (const subEntry of listDirSafe(full)) {
          const subFull = path.join(full, subEntry);
          tasks.push(this.inspect(subFull, managed));
        }
      }
    }

    const settled = await Promise.all(tasks);
    const results = settled.filter((x): x is JavaInstall => !!x);
    const out = dedupeByPath(results).sort((a, b) => b.major - a.major);

    this.cache = out;
    this.cacheLoadedFromDisk = false;
    this.saveCacheToDisk(out);
    return out;
  }

  /**
   * Возвращает список Java. Стратегия:
   *   1. Если есть in-memory кэш — отдаём его (мгновенно).
   *   2. Иначе пробуем persistent-кэш с диска (фильтруя удалённые пути).
   *   3. Иначе делаем полный scan.
   *
   * Если persistent-кэш протух (старше 7 дней) — отдаём его сразу, но в
   * фоне триггерим re-scan, чтобы данные подтянулись к следующему запуску.
   */
  async list(): Promise<JavaInstall[]> {
    if (this.cache) return this.cache;

    const fromDisk = this.loadCacheFromDisk();
    if (fromDisk) {
      this.cache = fromDisk.installs;
      this.cacheLoadedFromDisk = true;

      // Stale? — фоном пересканируем, пока пользователь играет.
      if (Date.now() - fromDisk.scannedAt > JAVA_CACHE_FRESH_MS) {
        this.scan().catch(() => {});
      }
      return this.cache;
    }

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

  /**
   * Find the best java for the given required major. Prefers exact match,
   * then newer, then older.
   *
   * Если результат поиска по persistent-кэшу пуст — делаем форс re-scan
   * (вдруг пользователь поставил новую Java между сессиями). Это даёт
   * правильное поведение без бесполезного скачивания.
   */
  async findBest(required: number): Promise<JavaInstall | null> {
    let result = this.findBestIn(await this.list(), required);
    if (result) return result;
    if (this.cacheLoadedFromDisk) {
      // persistent-кэш мог быть неполным — пересканим и попробуем ещё раз.
      const fresh = await this.scan();
      result = this.findBestIn(fresh, required);
      if (result) return result;
    }
    return null;
  }

  private findBestIn(all: JavaInstall[], required: number): JavaInstall | null {
    if (all.length === 0) return null;
    const exact = all.find((j) => j.major === required);
    if (exact) return exact;
    if (required <= 8) {
      // Only Java 8 works for LaunchWrapper-era versions
      return all.find((j) => j.major === 8) ?? null;
    }
    const greaterOrEqual = all.filter((j) => j.major >= required).sort((a, b) => a.major - b.major)[0];
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

    // Сбрасываем кэш и находим свежераспакованную JRE через scan().
    // scan() ВНУТРИ doScan() уже сохранит обновлённый кэш на диск, так что
    // следующий запуск лаунчера не будет перекачивать Java заново.
    this.cache = null;
    this.cacheLoadedFromDisk = false;
    const fresh = await this.findBest(major);
    if (!fresh) throw new Error('Java extracted but not found by scanner');
    return fresh;
  }

  private report(win: BrowserWindow | undefined, p: DownloadProgress) {
    if (win && !win.isDestroyed()) win.webContents.send('minecraft:progress', p);
  }
}
