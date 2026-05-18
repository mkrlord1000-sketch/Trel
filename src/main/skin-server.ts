import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { AddressInfo } from 'node:net';
import { MinecraftAccount } from '../shared/types';

/**
 * Локальный mock-сервер yggdrasil/sessionserver/services API. Используется
 * вместе с authlib-injector чтобы Minecraft в offline-режиме показывал
 * кастомные скины из accounts.json лаунчера.
 *
 * Покрывает три «хоста» Mojang API, которые authlib-injector проксирует:
 *   - sessionserver.mojang.com         (профили + текстуры)
 *   - api.mojang.com                   (lookup ника ↔ UUID)
 *   - api.minecraftservices.com        (publickeys, attributes, blocklist...)
 *
 * При подключении к мультиплеер-серверу клиент стучится в несколько из этих
 * эндпоинтов. Если хоть один отдаёт 404 — Minecraft показывает «Ошибка входа:
 * Status: 404». Поэтому реализуем минимум по всем веткам.
 *
 * texture-property подписывается RSA-ключом, генерируемым один раз при старте
 * сервера, и публичный ключ выдаётся в metadata.signaturePublickey. Без этого
 * authlib-injector ругается «Bad signature public key» при запуске игры.
 */
export class SkinServer {
  private server: http.Server | null = null;
  private port = 0;
  private byUuidUndashed = new Map<string, MinecraftAccount>();
  private byName = new Map<string, MinecraftAccount>();
  /** Кэш PNG-байтов и URL-friendly хэша по UUID. Обновляется в setAccounts. */
  private skinByHash = new Map<string, Buffer>();
  private hashByUuid = new Map<string, string>();
  private privateKeyPem = '';
  private publicKeyPem = '';

  setAccounts(list: MinecraftAccount[]) {
    this.byUuidUndashed.clear();
    this.byName.clear();
    this.skinByHash.clear();
    this.hashByUuid.clear();
    for (const a of list) {
      const undashed = a.uuid.replace(/-/g, '').toLowerCase();
      this.byUuidUndashed.set(undashed, a);
      this.byName.set(a.name.toLowerCase(), a);
      // Если скин есть — кэшируем декодированные байты под хэшем содержимого.
      // URL вида /textures/<sha256>.png меняется при смене скина, и Minecraft,
      // который кэширует текстуры на диске по SHA256 от URL, при смене скина
      // увидит новый URL → новый кэш-файл → новая текстура. Без этого
      // клиент показывает старый скин даже если наш сервер уже отдаёт новый.
      if (a.skin) {
        const m = /^data:image\/png;base64,(.+)$/.exec(a.skin);
        if (m) {
          const buf = Buffer.from(m[1], 'base64');
          const hash = crypto.createHash('sha256').update(buf).digest('hex');
          this.skinByHash.set(hash, buf);
          this.hashByUuid.set(undashed, hash);
        }
      }
    }
  }

  isRunning() { return !!this.server; }

  apiUrl(): string {
    return `http://127.0.0.1:${this.port}/`;
  }

  async start(): Promise<string> {
    if (this.server) return this.apiUrl();
    // Генерим RSA-ключевую пару один раз. 2048 бит = быстро (~100ms) и
    // совместимо со схемой Mojang. Ключи в памяти, не сохраняются на диск.
    if (!this.privateKeyPem) {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      this.privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      this.publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    }
    this.server = http.createServer((req, res) => this.handle(req, res));
    this.server.on('error', () => {});
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => {
        this.port = (this.server!.address() as AddressInfo).port;
        resolve();
      });
    });
    return this.apiUrl();
  }

  stop() {
    if (this.server) {
      try { this.server.close(); } catch {}
      this.server = null;
      this.port = 0;
    }
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse) {
    let url: URL;
    try {
      url = new URL(req.url || '/', `http://${req.headers.host}`);
    } catch {
      res.writeHead(400); res.end(); return;
    }
    const send = (status: number, body: string | Buffer, ct = 'application/json; charset=utf-8') => {
      res.writeHead(status, {
        'Content-Type': ct,
        'Access-Control-Allow-Origin': '*',
      });
      res.end(body);
    };
    const sendJson = (status: number, obj: unknown) => send(status, JSON.stringify(obj));
    const empty = () => { res.writeHead(204); res.end(); };

    const p = url.pathname;

    // Root meta — authlib-injector обращается сюда первым делом.
    if (p === '/' || p === '') {
      return sendJson(200, {
        meta: {
          serverName: 'Trel Launcher',
          implementationName: 'trel-launcher-skin-server',
          implementationVersion: '1.0',
          'feature.non_email_login': true,
          'feature.no_mojang_namespace': true,
          'feature.username_check': false,
          links: { homepage: '', register: '' },
        },
        skinDomains: ['127.0.0.1', 'localhost', '.localhost'],
        signaturePublickey: this.publicKeyPem,
      });
    }

    // ─── sessionserver.mojang.com ─────────────────────────────────────────
    // Профиль по UUID (с дефисами или без). Имя пути может приходить и как
    // /sessionserver/session/minecraft/profile/{uuid}, и просто
    // /session/minecraft/profile/{uuid} — authlib-injector варьирует префикс.
    let m = /^(?:\/sessionserver)?\/session\/minecraft\/profile\/([a-f0-9-]+)$/i.exec(p);
    if (m) {
      const uuid = m[1].replace(/-/g, '').toLowerCase();
      const acc = this.byUuidUndashed.get(uuid);
      if (!acc) return empty();
      return sendJson(200, this.profileResponse(acc));
    }

    // Server-side join verification. Клиент при заходе на сервер сообщает
    // sessionserver: «я подключаюсь, вот мой serverId». Мы в offline просто
    // отвечаем 204 — сервер потом сам спросит hasJoined и тоже получит ОК.
    if (/^(?:\/sessionserver)?\/session\/minecraft\/join$/.test(p) && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => empty());
      return;
    }

    // Sessionserver проверяет что игрок «зашёл». Здесь сервер Minecraft
    // спрашивает: hasJoined?username=ASER&serverId=...
    // Мы отдаём профиль найденного аккаунта (с скином).
    if (/^(?:\/sessionserver)?\/session\/minecraft\/hasJoined$/.test(p)) {
      const username = url.searchParams.get('username');
      if (!username) return empty();
      const acc = this.byName.get(username.toLowerCase());
      if (!acc) return empty();
      return sendJson(200, this.profileResponse(acc));
    }

    // ─── api.mojang.com ───────────────────────────────────────────────────
    // Single-name lookup
    m = /^(?:\/api)?\/users\/profiles\/minecraft\/(.+)$/.exec(p);
    if (m) {
      const acc = this.byName.get(decodeURIComponent(m[1]).toLowerCase());
      if (!acc) return empty();
      return sendJson(200, { id: acc.uuid.replace(/-/g, ''), name: acc.name });
    }

    // Bulk lookup
    if (/^(?:\/api)?\/profiles\/minecraft$/.test(p) && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const names = JSON.parse(body) as string[];
          const out = (Array.isArray(names) ? names : [])
            .map((n) => this.byName.get(String(n).toLowerCase()))
            .filter((a): a is MinecraftAccount => !!a)
            .map((a) => ({ id: a.uuid.replace(/-/g, ''), name: a.name }));
          sendJson(200, out);
        } catch {
          sendJson(200, []);
        }
      });
      return;
    }

    // История ников игрока (deprecated, но клиент 1.20+ всё ещё дёргает)
    if (/^(?:\/api)?\/user\/profiles\/[a-f0-9-]+\/names$/i.test(p)) {
      // Возвращаем единственный «нынешний» ник без исторических записей.
      const m2 = /\/profiles\/([a-f0-9-]+)\/names$/i.exec(p);
      if (m2) {
        const acc = this.byUuidUndashed.get(m2[1].replace(/-/g, '').toLowerCase());
        if (acc) return sendJson(200, [{ name: acc.name }]);
      }
      return sendJson(200, []);
    }

    // Blocklist (api.mojang.com/blockedservers) — пустой список.
    if (p === '/blockedservers' || p === '/api/blockedservers') {
      return send(200, '');
    }

    // ─── api.minecraftservices.com ────────────────────────────────────────
    // Player attributes — клиент получает sub-объекты для чата/multiplayer.
    if (/^(?:\/minecraftservices)?\/player\/attributes$/.test(p)) {
      return sendJson(200, {
        privileges: {
          onlineChat: { enabled: true },
          multiplayerServer: { enabled: true },
          multiplayerRealms: { enabled: false },
          telemetry: { enabled: false },
        },
        profanityFilterPreferences: { profanityFilterOn: false },
        banStatus: { bannedScopes: {} },
      });
    }

    // Public keys (chat reporting). Возвращаем дефолтную структуру —
    // Minecraft 1.19+ требует это, но для unsigned chat достаточно.
    if (/^(?:\/minecraftservices)?\/publickeys$/.test(p)) {
      return sendJson(200, {
        profilePropertyKeys: [{ publicKey: this.publicKeyPem.replace(/-----[^-]+-----|\s/g, '') }],
        playerCertificateKeys: [{ publicKey: this.publicKeyPem.replace(/-----[^-]+-----|\s/g, '') }],
      });
    }

    // Player certificates — клиент 1.19+ запрашивает свои сертификаты для
    // подписи чата. В offline возвращаем «нет», клиент работает без подписи.
    if (/^(?:\/minecraftservices)?\/player\/certificates$/.test(p) && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => empty());
      return;
    }

    // Blocklist для отчётов чата
    if (/^(?:\/minecraftservices)?\/privacy\/blocklist$/.test(p)) {
      return sendJson(200, { blockedProfiles: [] });
    }

    // Информация об «entitlements» (что куплено). Возвращаем фиктивный
    // licensed product — без этого 1.21+ может показать «Failed to verify».
    if (/^(?:\/minecraftservices)?\/entitlements\/license$/.test(p)
        || /^(?:\/minecraftservices)?\/entitlements\/mcstore$/.test(p)) {
      return sendJson(200, {
        items: [
          { name: 'product_minecraft', signature: '' },
          { name: 'game_minecraft', signature: '' },
        ],
        signature: '',
        keyId: '',
      });
    }

    // Список «известных пакетов» (resource packs от Mojang). Пусто.
    if (/^(?:\/minecraftservices)?\/known_packs$/.test(p)) {
      return sendJson(200, []);
    }

    // Profile «my» (информация о текущем игроке). Клиент знает свой UUID
    // из --uuid аргумента, но иногда ходит сюда чтобы проверить.
    if (/^(?:\/minecraftservices)?\/minecraft\/profile$/.test(p)) {
      // Берём первый аккаунт — на offline-сервере он всегда один активный
      const acc = this.byUuidUndashed.values().next().value as MinecraftAccount | undefined;
      if (!acc) return empty();
      const undashed = acc.uuid.replace(/-/g, '');
      return sendJson(200, {
        id: undashed,
        name: acc.name,
        skins: [],
        capes: [],
      });
    }

    // ─── PNG-текстура ─────────────────────────────────────────────────────
    m = /^\/textures\/([a-f0-9]{64})\.png$/i.exec(p);
    if (m) {
      const hash = m[1].toLowerCase();
      const buf = this.skinByHash.get(hash);
      if (!buf) { res.writeHead(404); res.end(); return; }
      // Long-lived cache на стороне клиента — содержимое неизменно для этого URL.
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
      res.end(buf);
      return;
    }

    // Catch-all: лучше отдать 200 с пустым массивом, чем 404 — тогда клиент
    // не падает с «Ошибка входа: Status: 404» на неизвестных эндпоинтах,
    // которые могут добавиться в новых версиях Minecraft. Логируем чтобы
    // знать что добавлять — если ловим много таких, значит mock неполный.
    // eslint-disable-next-line no-console
    console.warn(`[skin-server] unhandled ${req.method ?? 'GET'} ${p}`);
    sendJson(200, {});
  }

  private profileResponse(acc: MinecraftAccount) {
    const undashedUuid = acc.uuid.replace(/-/g, '').toLowerCase();
    const textures: Record<string, unknown> = {};
    if (acc.skin) {
      const hash = this.hashByUuid.get(undashedUuid);
      if (hash) {
        const skin: Record<string, unknown> = {
          // URL завязан на SHA256 от PNG, поэтому при смене скина он другой —
          // и Minecraft не возьмёт старый файл из своего дискового кэша.
          url: `http://127.0.0.1:${this.port}/textures/${hash}.png`,
        };
        if (acc.skinModel === 'slim') {
          skin.metadata = { model: 'slim' };
        }
        textures.SKIN = skin;
      }
    }
    const texturesObj = {
      // timestamp тоже обновляется при каждом запросе — сервер при изменении
      // скина возвращает свежий объект, а Minecraft регулярно перечитывает
      // профиль (раз в несколько секунд).
      timestamp: Date.now(),
      profileId: undashedUuid,
      profileName: acc.name,
      textures,
    };
    const texturesB64 = Buffer.from(JSON.stringify(texturesObj)).toString('base64');
    // Подпись по схеме Mojang: SHA1withRSA по байтам base64-значения,
    // результат тоже в base64. authlib-injector проверяет её через
    // signaturePublickey из metadata.
    const signature = crypto.sign('RSA-SHA1', Buffer.from(texturesB64, 'utf-8'), this.privateKeyPem)
      .toString('base64');
    return {
      id: undashedUuid,
      name: acc.name,
      properties: [{ name: 'textures', value: texturesB64, signature }],
    };
  }
}
