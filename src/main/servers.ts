import { BrowserWindow } from 'electron';
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import axios from 'axios';
import { JavaService } from './java';
import { SkinServer } from './skin-server';
import { AuthlibInjector } from './authlib';
import { MinecraftAccount } from '../shared/types';

/**
 * Сервис управления локальными Minecraft-серверами.
 *
 * Каждый инстанс — отдельная папка <launcherDir>/servers/<id>/ с server.jar,
 * eula.txt, server.properties и world/. Метаданные всех инстансов хранятся
 * в <launcherDir>/servers/index.json.
 *
 * Запуск: spawnим java в этой папке, ловим stdout/stderr и шлём в renderer.
 * Команды (op, stop, say, ...) пишутся в stdin процесса.
 */

export type ServerStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface ServerInstance {
  id: string;
  name: string;
  /** Версия Minecraft, для которой установлен server.jar (например "1.21.1"). */
  versionId: string;
  createdAt: string;
  /** Аллоцируемый объём памяти, МБ (Xmx). Min ставим Xmx/2. */
  memoryMb: number;
  /** Базовая часть server.properties — UI её редактирует. */
  properties: ServerProperties;
}

export interface ServerProperties {
  motd: string;
  /** TCP-порт сервера. По умолчанию 25565. */
  serverPort: number;
  maxPlayers: number;
  gamemode: 'survival' | 'creative' | 'adventure' | 'spectator';
  difficulty: 'peaceful' | 'easy' | 'normal' | 'hard';
  pvp: boolean;
  onlineMode: boolean;
  whiteList: boolean;
  spawnProtection: number;
}

interface RuntimeState {
  status: ServerStatus;
  proc?: ChildProcessWithoutNullStreams;
  /** Кольцевой буфер последних строк — отправляется новому слушателю при подключении. */
  logBuffer: string[];
}

const LOG_BUFFER_LIMIT = 1000;

function defaultProperties(): ServerProperties {
  return {
    motd: 'A Trel-launched server',
    serverPort: 25565,
    maxPlayers: 20,
    gamemode: 'survival',
    difficulty: 'easy',
    pvp: true,
    onlineMode: false,
    whiteList: false,
    spawnProtection: 16,
  };
}

export class ServerService {
  private root: string;
  private indexFile: string;
  private runtimes = new Map<string, RuntimeState>();

  constructor(
    private launcherDir: string,
    private gameDir: string,
    private java: JavaService,
    private skinServer: SkinServer,
    private authlib: AuthlibInjector,
    private getAccounts: () => MinecraftAccount[],
  ) {
    this.root = path.join(launcherDir, 'servers');
    this.indexFile = path.join(this.root, 'index.json');
    fs.mkdirSync(this.root, { recursive: true });
  }

  setGameDir(gameDir: string) {
    this.gameDir = gameDir;
  }

  // ─── Index/persistence ───────────────────────────────────────────────────

  list(): ServerInstance[] {
    try {
      if (!fs.existsSync(this.indexFile)) return [];
      const raw = JSON.parse(fs.readFileSync(this.indexFile, 'utf-8'));
      if (!Array.isArray(raw)) return [];
      return raw as ServerInstance[];
    } catch {
      return [];
    }
  }

  private save(list: ServerInstance[]): void {
    fs.writeFileSync(this.indexFile, JSON.stringify(list, null, 2), 'utf-8');
  }

  private getOrThrow(id: string): ServerInstance {
    const it = this.list().find((s) => s.id === id);
    if (!it) throw new Error('Сервер не найден');
    return it;
  }

  serverDir(id: string): string {
    return path.join(this.root, id);
  }

  /** Текущий статус (для одного или всех — UI запрашивает раз при загрузке). */
  status(id: string): ServerStatus {
    return this.runtimes.get(id)?.status ?? 'stopped';
  }

  statuses(): Record<string, ServerStatus> {
    const out: Record<string, ServerStatus> = {};
    for (const s of this.list()) out[s.id] = this.status(s.id);
    return out;
  }

  /** Возвращает буфер последних логов (для пере-открытия консоли в UI). */
  logBuffer(id: string): string[] {
    return this.runtimes.get(id)?.logBuffer.slice() ?? [];
  }

  // ─── CRUD ────────────────────────────────────────────────────────────────

  /**
   * Создаёт новый сервер: качает server.jar для указанной версии (если
   * Mojang её отдаёт — для очень старых её может не быть, тогда ошибка),
   * пишет eula=true, server.properties с дефолтами, добавляет в index.json.
   */
  async create(input: {
    name: string;
    versionId: string;
    memoryMb: number;
    properties?: Partial<ServerProperties>;
    onProgress?: (p: { stage: string; percent: number }) => void;
  }): Promise<ServerInstance> {
    const id = crypto.randomBytes(6).toString('hex');
    const dir = path.join(this.root, id);
    fs.mkdirSync(dir, { recursive: true });

    input.onProgress?.({ stage: 'Чтение метаданных версии', percent: 5 });
    // Тянем version JSON через installer'овый кэш (gameDir/versions/<id>/<id>.json),
    // чтобы не дублировать manifest-логику. Если JSON ещё не скачан — installer
    // загрузит его в gameDir, без скачивания client.jar/ассетов.
    const verJson = await this.fetchVersionJson(input.versionId);
    const serverDownload = verJson.downloads?.server;
    if (!serverDownload?.url) {
      // Удалим уже созданную папку, не оставляем мусор
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
      throw new Error(`У версии ${input.versionId} нет официального server.jar (Mojang его не предоставляет).`);
    }

    input.onProgress?.({ stage: 'Скачивание server.jar', percent: 15 });
    const jarPath = path.join(dir, 'server.jar');
    await this.download(serverDownload.url, jarPath, (loaded, total) => {
      const pct = total > 0 ? 15 + Math.round((loaded / total) * 70) : 50;
      input.onProgress?.({ stage: `Скачивание server.jar`, percent: Math.min(pct, 85) });
    });

    // EULA — без неё сервер не стартует. Лаунчер автоматически принимает,
    // потому что юзер уже согласился запуская клиент.
    fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n', 'utf-8');

    const props = { ...defaultProperties(), ...input.properties };
    fs.writeFileSync(path.join(dir, 'server.properties'), this.encodeProperties(props), 'utf-8');

    const instance: ServerInstance = {
      id,
      name: input.name.trim() || `Server-${id.slice(0, 4)}`,
      versionId: input.versionId,
      createdAt: new Date().toISOString(),
      memoryMb: Math.max(512, input.memoryMb),
      properties: props,
    };
    const list = this.list();
    list.push(instance);
    this.save(list);

    input.onProgress?.({ stage: 'Готово', percent: 100 });
    return instance;
  }

  delete(id: string): void {
    const inst = this.getOrThrow(id);
    if (this.status(id) !== 'stopped') {
      throw new Error('Сервер запущен — сначала остановите его');
    }
    const list = this.list().filter((s) => s.id !== id);
    this.save(list);
    try { fs.rmSync(this.serverDir(inst.id), { recursive: true, force: true }); } catch {}
    this.runtimes.delete(id);
  }

  setProperties(id: string, patch: Partial<ServerProperties>): ServerInstance {
    const list = this.list();
    const idx = list.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error('Сервер не найден');
    const updated: ServerInstance = {
      ...list[idx],
      properties: { ...list[idx].properties, ...patch },
    };
    list[idx] = updated;
    this.save(list);
    // Перезаписываем server.properties — изменения подхватятся при следующем запуске.
    fs.writeFileSync(
      path.join(this.serverDir(id), 'server.properties'),
      this.encodeProperties(updated.properties),
      'utf-8',
    );
    return updated;
  }

  rename(id: string, name: string): ServerInstance {
    const list = this.list();
    const idx = list.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error('Сервер не найден');
    list[idx] = { ...list[idx], name: name.trim() || list[idx].name };
    this.save(list);
    return list[idx];
  }

  setMemory(id: string, memoryMb: number): ServerInstance {
    const list = this.list();
    const idx = list.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error('Сервер не найден');
    list[idx] = { ...list[idx], memoryMb: Math.max(512, memoryMb) };
    this.save(list);
    return list[idx];
  }

  // ─── Run/stop ────────────────────────────────────────────────────────────

  async start(id: string, win: BrowserWindow): Promise<void> {
    const inst = this.getOrThrow(id);
    const cur = this.runtimes.get(id);
    if (cur && cur.proc && (cur.status === 'running' || cur.status === 'starting')) {
      return; // already running
    }

    const dir = this.serverDir(id);
    const jarPath = path.join(dir, 'server.jar');
    if (!fs.existsSync(jarPath)) throw new Error('server.jar не найден — пересоздайте сервер');

    // Перезаписываем server.properties из текущих настроек инстанса. Это
    // подтягивает свежие правки лаунчера (server-ip=0.0.0.0, новые ключи)
    // даже на серверах, созданных в более старых версиях Trel.
    fs.writeFileSync(
      path.join(dir, 'server.properties'),
      this.encodeProperties(inst.properties),
      'utf-8',
    );

    // Проверяем что порт свободен заранее: иначе сервер запустится, упадёт с
    // «Address already in use» и пользователь увидит лог только постфактум.
    const portFree = await this.isPortFree(inst.properties.serverPort);
    if (!portFree) {
      throw new Error(
        `Порт ${inst.properties.serverPort} уже занят. ` +
        `Закройте программу которая его слушает или поменяйте порт в настройках сервера.`,
      );
    }

    // Java: версия требует ту же major, что и клиент. Берём из version JSON.
    const verJson = await this.fetchVersionJson(inst.versionId);
    let major = verJson.javaVersion?.majorVersion ?? 8;
    const javaInfo = await this.java.findBest(major) ?? await this.java.ensure(major, win);
    const javaPath = javaInfo.path;

    // ─── authlib-injector для сервера ───────────────────────────────────────
    // Без него offline-клиент с UUID, не известным Mojang, не сможет пройти
    // server-side проверку «hasJoined» — клиент видит «Не удалось проверить
    // имя пользователя». Подключаем тот же mock-сервер, что и для клиента —
    // он отвечает, что игрок легит, и сервер пускает.
    const accounts = this.getAccounts();
    let authlibServerArgs: string[] = [];
    try {
      this.skinServer.setAccounts(accounts);
      const [apiUrl, agentPath] = await Promise.all([
        this.skinServer.start(),
        this.authlib.ensure(),
      ]);
      authlibServerArgs = [`-javaagent:${agentPath}=${apiUrl}`];
      this.broadcastLog(win, id, `[launcher] authlib-injector активен (${apiUrl})\n`);
    } catch (e) {
      this.broadcastLog(win, id, `[launcher] authlib-injector недоступен (${(e as Error).message}) — перевожу сервер в offline-mode\n`);
      // Гарантируем что offline-mode включён, чтобы хотя бы как-то пускало
      if (inst.properties.onlineMode) {
        inst.properties = { ...inst.properties, onlineMode: false };
        const list = this.list();
        const i = list.findIndex((s) => s.id === id);
        if (i >= 0) {
          list[i] = inst;
          this.save(list);
          fs.writeFileSync(path.join(dir, 'server.properties'), this.encodeProperties(inst.properties), 'utf-8');
        }
      }
    }

    const args = [
      `-Xms${Math.max(256, Math.floor(inst.memoryMb / 2))}M`,
      `-Xmx${inst.memoryMb}M`,
      '-Dfile.encoding=UTF-8',
      // Форсим IPv4: иначе на некоторых Windows-конфигах сокет биндится
      // в IPv6, и клиент по IPv4 (включая 127.0.0.1) не доходит.
      '-Djava.net.preferIPv4Stack=true',
      ...authlibServerArgs,
      '-jar', jarPath,
      'nogui',
    ];

    const state: RuntimeState = { status: 'starting', logBuffer: [] };
    this.runtimes.set(id, state);
    this.broadcastStatus(win, id, 'starting');
    this.broadcastLog(win, id, `[launcher] Запуск сервера: ${javaPath} ${args.join(' ')}\n`);

    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawn(javaPath, args, {
        cwd: dir,
        windowsHide: true,
      });
    } catch (e) {
      state.status = 'error';
      this.broadcastStatus(win, id, 'error');
      throw e;
    }
    state.proc = proc;

    // На Windows пытаемся открыть порт в брандмауэре заранее. Без этого первый
    // запуск показывает системный диалог, который пользователь может закрыть
    // не глядя — после чего сервер «работает», но из LAN никто не подключится.
    // netsh не требует UAC если правило уже создано юзером, либо добавит
    // правило в профиль текущего пользователя. Молча игнорируем неудачу.
    if (process.platform === 'win32') {
      this.tryAddFirewallRule(inst.properties.serverPort).catch(() => {});
    }

    proc.stdout.setEncoding('utf-8');
    proc.stderr.setEncoding('utf-8');

    const onChunk = (chunk: string) => {
      // Сервер пишет логи поблочно — перевод в строки для буфера/UI.
      const lines = chunk.split(/(?<=\n)/);
      for (const line of lines) {
        if (!line) continue;
        state.logBuffer.push(line);
        if (state.logBuffer.length > LOG_BUFFER_LIMIT) state.logBuffer.shift();
        this.broadcastLog(win, id, line);
        // Эвристика: «Done (… For help…»: сервер закончил старт.
        if (state.status === 'starting' && /^\[.+?\] \[.+?\]: Done \(/m.test(line)) {
          state.status = 'running';
          this.broadcastStatus(win, id, 'running');
        }
      }
    };
    proc.stdout.on('data', onChunk);
    proc.stderr.on('data', onChunk);

    proc.on('exit', (code, signal) => {
      this.broadcastLog(win, id, `[launcher] Сервер завершился (код ${code}, сигнал ${signal ?? '-'})\n`);
      state.proc = undefined;
      state.status = 'stopped';
      this.broadcastStatus(win, id, 'stopped');
    });
    proc.on('error', (err) => {
      this.broadcastLog(win, id, `[launcher] Ошибка процесса: ${err.message}\n`);
      state.status = 'error';
      this.broadcastStatus(win, id, 'error');
    });
  }

  /**
   * Грациозно останавливает сервер: пишет `stop` в stdin (это корректно
   * сейвит мир и закрывает порт). Если процесс не отвечает в течение
   * 30 секунд — kill -9. Для Windows используем taskkill /F /T чтобы
   * убить дочерние JVM-процессы, иначе порт может остаться в TIME_WAIT.
   */
  async stop(id: string, win: BrowserWindow): Promise<void> {
    const state = this.runtimes.get(id);
    if (!state || !state.proc) return;
    if (state.status === 'stopped' || state.status === 'stopping') return;

    state.status = 'stopping';
    this.broadcastStatus(win, id, 'stopping');
    try { state.proc.stdin.write('stop\n'); } catch {}

    const proc = state.proc;
    // Сохраняем id таймера чтобы очистить его в случае нормального exit'а —
    // иначе хэндл живёт в фоне 30с и при быстром повторном start таймер
    // выстрелит на чужой процесс.
    const killTimer = setTimeout(() => {
      if (proc.exitCode !== null || proc.killed) return;
      if (process.platform === 'win32') {
        // taskkill /F /T убивает процесс и всех его потомков. SIGKILL на
        // Windows через node — это TerminateProcess только корня, но JVM
        // часто плодит дочерние процессы (например, Java agent threads).
        try {
          spawn('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { windowsHide: true });
        } catch { try { proc.kill('SIGKILL'); } catch {} }
      } else {
        try { proc.kill('SIGKILL'); } catch {}
      }
    }, 30_000);
    proc.once('exit', () => clearTimeout(killTimer));
  }

  /** Отправляет произвольную команду в stdin сервера (без префикса слэша). */
  sendCommand(id: string, command: string): void {
    const state = this.runtimes.get(id);
    if (!state?.proc) throw new Error('Сервер не запущен');
    if (!command.trim()) return;
    // Команды Minecraft не требуют ведущий «/», stdin его не понимает —
    // снимаем если пользователь его написал.
    const trimmed = command.replace(/^\/+/, '').trimEnd();
    state.proc.stdin.write(trimmed + '\n');
  }

  /** Останавливает все запущенные серверы — вызывается при выходе из лаунчера. */
  shutdownAll(): void {
    for (const state of this.runtimes.values()) {
      if (state.proc) {
        try { state.proc.stdin.write('stop\n'); } catch {}
      }
    }
  }

  /**
   * Возвращает список доступных адресов подключения для сервера. Полезно
   * показать пользователю в UI: «127.0.0.1:25565» + IP в LAN для друзей.
   *
   * Берём только IPv4, не loopback, не link-local, не виртуальные интерфейсы
   * VirtualBox/VMware (они не дают игрокам реально подключиться).
   *
   * Используем именно 127.0.0.1, а не "localhost": в Minecraft 1.21+ имя
   * "localhost" сначала резолвится в IPv6 ::1, и при разнице конфигурации
   * IPv4/IPv6 серверного сокета и клиента это иногда даёт «не подключиться».
   * 127.0.0.1 однозначно IPv4.
   */
  connectAddresses(id: string): { label: string; host: string; port: number }[] {
    const inst = this.list().find((s) => s.id === id);
    if (!inst) return [];
    const port = inst.properties.serverPort;
    const out: { label: string; host: string; port: number }[] = [
      { label: 'Этот же компьютер', host: '127.0.0.1', port },
    ];
    const ifaces = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(ifaces)) {
      if (!addrs) continue;
      // Пропускаем явные виртуалки/туннели — игроки в LAN их не видят.
      if (/virtualbox|vmware|hyper-?v|wsl|loopback|tap|tun/i.test(name)) continue;
      for (const a of addrs) {
        if (a.family !== 'IPv4') continue;
        if (a.internal) continue;
        // Link-local (169.254.x.x) — обычно никого не подключает.
        if (a.address.startsWith('169.254.')) continue;
        out.push({ label: `Локальная сеть (${name})`, host: a.address, port });
      }
    }
    return out;
  }

  /**
   * Проверяет: свободен ли TCP-порт. Возвращает true если можно занимать,
   * false если уже кто-то слушает.
   */
  private async isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const tester = net.createServer()
        .once('error', () => resolve(false))
        .once('listening', () => {
          tester.close(() => resolve(true));
        })
        .listen(port, '0.0.0.0');
    });
  }

  /**
   * На Windows: добавляет inbound-правило брандмауэра для указанного TCP-порта
   * (если его ещё нет). Без этого первый запуск сервера показывает системный
   * диалог «Разрешить доступ», и если пользователь его проигнорирует — порт
   * слышит только loopback.
   *
   * Использует netsh advfirewall. Без прав админа создастся правило для
   * текущего профиля (Private) — этого достаточно для домашней Wi-Fi сети.
   */
  private async tryAddFirewallRule(port: number): Promise<void> {
    if (process.platform !== 'win32') return;
    const ruleName = `Trel Launcher MC ${port}`;
    return new Promise((resolve) => {
      const child = spawn('netsh', [
        'advfirewall', 'firewall', 'add', 'rule',
        `name=${ruleName}`,
        'dir=in',
        'action=allow',
        'protocol=TCP',
        `localport=${port}`,
        'profile=private,domain',
      ], { windowsHide: true });
      // Не ждём долго и игнорируем код выхода — netsh может вернуть ошибку
      // если правило уже есть или если нет прав.
      const t = setTimeout(() => { try { child.kill(); } catch {} ; resolve(); }, 3000);
      child.on('exit', () => { clearTimeout(t); resolve(); });
      child.on('error', () => { clearTimeout(t); resolve(); });
    });
  }

  // ─── helpers ────────────────────────────────────────────────────────────

  private broadcastStatus(win: BrowserWindow, id: string, status: ServerStatus): void {
    if (win.isDestroyed()) return;
    win.webContents.send('servers:status', { id, status });
  }

  private broadcastLog(win: BrowserWindow, id: string, line: string): void {
    if (win.isDestroyed()) return;
    win.webContents.send('servers:log', { id, line });
  }

  private encodeProperties(p: ServerProperties): string {
    // Только базовые ключи — остальное Mojang заполнит дефолтами при первом запуске.
    const lines = [
      `# Generated by Trel Launcher at ${new Date().toISOString()}`,
      `motd=${escapePropValue(p.motd)}`,
      // Явно биндим на все IPv4 — иначе сервер на некоторых системах
      // слушает только IPv6 ::, и клиенты с локального IPv4 не достают.
      `server-ip=0.0.0.0`,
      `server-port=${p.serverPort}`,
      `query.port=${p.serverPort}`,
      `max-players=${p.maxPlayers}`,
      `gamemode=${p.gamemode}`,
      `difficulty=${p.difficulty}`,
      `pvp=${p.pvp}`,
      `online-mode=${p.onlineMode}`,
      `white-list=${p.whiteList}`,
      `spawn-protection=${p.spawnProtection}`,
      // Прямой вывод в консоль лаунчера, без ANSI
      `enable-jmx-monitoring=false`,
      // 1.19+: enforce-secure-profile требует от клиента подписанных
      // сертификатов от Mojang. У offline-аккаунтов их нет → сервер
      // отвергает подключение с «Не удалось проверить имя пользователя».
      // Отключаем — это совместимо со всеми клиентами (1.19+ просто не
      // подписывают чат, а 1.21+ работают и без подписи).
      `enforce-secure-profile=false`,
      `prevent-proxy-connections=false`,
    ];
    return lines.join('\n') + '\n';
  }

  private async fetchVersionJson(versionId: string): Promise<any> {
    // Ходим в gameDir/versions/<id>/<id>.json (если уже есть от установки клиента),
    // иначе тянем напрямую из manifest и сохраняем туда же.
    const jsonPath = path.join(this.gameDir, 'versions', versionId, versionId + '.json');
    if (fs.existsSync(jsonPath)) {
      const j = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      // server.jar URL для лоадер-профилей берётся из родителя (inheritsFrom)
      if (j.inheritsFrom && !j.downloads?.server) {
        const parentPath = path.join(this.gameDir, 'versions', j.inheritsFrom, j.inheritsFrom + '.json');
        if (fs.existsSync(parentPath)) {
          const parent = JSON.parse(fs.readFileSync(parentPath, 'utf-8'));
          return { ...parent, ...j, downloads: { ...(parent.downloads ?? {}), ...(j.downloads ?? {}) } };
        }
      }
      return j;
    }
    // Нет на диске — тянем
    const { data: manifest } = await axios.get('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json', { timeout: 15000 });
    const entry = (manifest.versions as any[]).find((v) => v.id === versionId);
    if (!entry) throw new Error(`Версия ${versionId} не найдена в манифесте Mojang`);
    const { data: vj } = await axios.get(entry.url, { timeout: 15000 });
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(vj, null, 2), 'utf-8');
    return vj;
  }

  private async download(url: string, dest: string, onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const resp = await axios.get(url, {
      responseType: 'stream',
      timeout: 120_000,
      maxRedirects: 5,
    });
    const totalRaw = resp.headers['content-length'];
    const total = typeof totalRaw === 'string' ? parseInt(totalRaw, 10) || 0 : 0;
    let loaded = 0;
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(dest);
      resp.data.on('data', (chunk: Buffer) => {
        loaded += chunk.length;
        onProgress?.(loaded, total);
      });
      resp.data.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      resp.data.pipe(out);
    });
  }
}

function escapePropValue(v: string): string {
  // server.properties — Java-properties: backslash, =, : надо экранировать.
  return v
    .replace(/\\/g, '\\\\')
    .replace(/=/g, '\\=')
    .replace(/:/g, '\\:')
    .replace(/\n/g, '\\n');
}
