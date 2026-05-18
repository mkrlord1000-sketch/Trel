/**
 * Хелперы для отображения «эффективного» списка установленных версий в UI.
 *
 * На диске для каждого мод-лоадера (Forge/Fabric/Quilt/NeoForge) хранится
 * пара папок: сама ваниль (`1.21.11`) и профиль лоадера (`1.21.11-forge-…`).
 * Backend честно возвращает обе. Но в UI пользователь не должен видеть
 * «отдельную» ваниль рядом с её же лоадером — это путает счётчик
 * установленных версий.
 *
 * Эти функции возвращают только «видимые в UI» инстансы: лоадер впитывает
 * базовую MC-версию, обычные ваниль-установки оставляем как есть.
 */

export interface InstalledDetailLike {
  id: string;
  baseMc: string;
  loader: string | null;
}

/** Какие baseMc уже представлены лоадер-профилем. */
export function moddedBaseSet(details: InstalledDetailLike[]): Set<string> {
  return new Set(details.filter((d) => d.loader).map((d) => d.baseMc));
}

/**
 * Возвращает только те инстансы, которые UI должен показывать как «версии
 * для запуска». Если для базовой MC есть лоадер — отдельную ванильную
 * запись скрываем (её jar и assets всё ещё на диске и используются лоадером).
 */
export function effectiveInstalled<T extends InstalledDetailLike>(details: T[]): T[] {
  const modded = moddedBaseSet(details);
  return details.filter((d) => d.loader || !modded.has(d.id));
}

/** Сколько версий показывать в любых счётчиках UI. */
export function effectiveInstalledCount(details: InstalledDetailLike[]): number {
  return effectiveInstalled(details).length;
}
