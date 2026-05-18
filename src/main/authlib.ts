import * as fs from 'node:fs';
import * as path from 'node:path';
import axios from 'axios';

/**
 * authlib-injector — стандартный Java-агент, который перехватывает обращения
 * Minecraft-клиента к Mojang API и перенаправляет их на наш локальный URL.
 * Без него offline-Minecraft рисует случайный default-Alex по UUID.
 *
 * Источник: https://authlib-injector.yushi.moe/ (open source, GPL-3).
 * Скачиваем один раз, кэшируем в <launcherDir>/cache/authlib-injector.jar.
 */
export class AuthlibInjector {
  constructor(private launcherDir: string) {}

  jarPath(): string {
    return path.join(this.launcherDir, 'cache', 'authlib-injector.jar');
  }

  /** Скачивает агент если его ещё нет. Возвращает абсолютный путь. */
  async ensure(): Promise<string> {
    const out = this.jarPath();
    if (fs.existsSync(out) && fs.statSync(out).size > 50_000) {
      return out;
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });

    // Берём последний релиз через метаданные API authlib-injector.
    // Если по какой-то причине это недоступно — фолбек на конкретную версию.
    let downloadUrl: string | null = null;
    try {
      const { data } = await axios.get(
        'https://authlib-injector.yushi.moe/artifact/latest.json',
        { timeout: 15_000 },
      );
      if (data && typeof data.download_url === 'string') {
        downloadUrl = data.download_url;
      }
    } catch {}
    if (!downloadUrl) {
      // Стабильный фолбек на конкретный релиз
      downloadUrl = 'https://github.com/yushijinhun/authlib-injector/releases/download/v1.2.5/authlib-injector-1.2.5.jar';
    }

    const resp = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      timeout: 60_000,
      maxRedirects: 5,
    });
    fs.writeFileSync(out, Buffer.from(resp.data));
    return out;
  }
}
