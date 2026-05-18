/**
 * Поддерживает ли версия Minecraft authlib-injector (= кастомный скин внутри
 * игры через наш локальный yggdrasil-сервер).
 *
 * authlib-injector подменяет URL Mojang sessionserver. Это имеет смысл только
 * для версий, которые этот sessionserver запрашивают: 1.6+ и все современные
 * мод-лоадеры (Forge/Fabric/Quilt/NeoForge, инстанцированные на 1.6+).
 *
 * Для всего что выглядит как pre-1.6 (rd-*, c0.*, in-*, inf-*, alpha 1.x,
 * beta b1.*, релизы 1.0–1.5) скин в самой игре не появится — там либо вообще
 * нет понятия скинов, либо сессии Mojang используются по-старому.
 *
 * Используется и в main (решить: добавлять `-javaagent` или нет), и в
 * renderer (отметить такие версии в UI как «без поддержки скинов»).
 *
 * @param versionId  id установленной/каталожной версии (rd-132211, 1.20.1, 1.20.1-forge-47.2.0, …)
 * @param baseMc     базовая MC-версия для loader-профилей (`json.inheritsFrom`).
 *                   Для чистой ванили и каталога можно передать `undefined`.
 */
export function supportsCustomSkin(versionId: string, baseMc?: string | null): boolean {
  const ref = baseMc || versionId;

  // Pre-Classic / Classic / Indev / Infdev / Alpha / Beta — точно нет
  if (/^(rd-|c0\.|in-|inf-|a1\.|b1\.|a-|b-)/i.test(ref)) return false;

  // Семантический парсер «1.X[.Y]».  Если не парсится (snapshot, fool day и т.п.) —
  // консервативно считаем «поддерживается»: все основные snapshot-каналы новее 1.6.
  const m = /^1\.(\d+)(?:\.(\d+))?/.exec(ref);
  if (!m) {
    // Сами snapshot/PR-айди (`23w14a`, `1.21-pre1`, …) — тоже считаем поддерживающими.
    // Без этого все ежедневные snapshot'ы получили бы лейбл «без скина», что неверно.
    return true;
  }
  const minor = parseInt(m[1], 10);
  return minor >= 6;
}
