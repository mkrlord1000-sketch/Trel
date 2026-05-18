import React, { useEffect, useMemo, useState } from 'react';
import type { LauncherSettings, MinecraftAccount, VersionInfo } from '../../shared/types';
import type { InstalledVersionDetail, LoaderType } from '../../preload/preload';
import { IconPlay, IconTrash, IconFolder, IconCube, IconArrow, IconRefresh, IconSkinOff } from '../components/icons';
import { useDialog } from '../components/Dialog';
import { LoaderInstallDialog } from '../components/LoaderInstallDialog';
import { supportsCustomSkin } from '../../shared/skin-support';

interface Props {
  settings: LauncherSettings;
  account: MinecraftAccount | null;
  onSettingsChange: (s: LauncherSettings) => void;
  onGoToBrowse: () => void;
}

const typeLabel: Record<string, string> = {
  release: 'релиз', snapshot: 'снапшот', old_beta: 'beta', old_alpha: 'alpha',
};

const loaderLabel: Record<LoaderType, string> = {
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
};

export const InstalledPage: React.FC<Props> = ({ settings, account, onSettingsChange, onGoToBrowse }) => {
  const dialog = useDialog();
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [details, setDetails] = useState<InstalledVersionDetail[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [loaderFor, setLoaderFor] = useState<string | null>(null);

  const refresh = async () => {
    const list = await window.api.minecraft.installedDetailed();
    setDetails(list);
  };

  useEffect(() => {
    window.api.minecraft.versions().then(setVersions);
    refresh();
  }, []);

  // Скрываем стандалон-ваниль, если для этой же базы установлен хотя бы
  // один лоадер — он "впитывает" её под именем базовой MC версии.
  const items = useMemo(() => {
    const moddedBases = new Set(details.filter((d) => d.loader).map((d) => d.baseMc));
    return details
      .filter((d) => d.loader || !moddedBases.has(d.id))
      .map((d) => {
        const meta = versions.find((v) => v.id === d.baseMc);
        return {
          ...d,
          type: meta?.type ?? 'unknown',
          releaseTime: meta?.releaseTime,
          isLast: d.id === settings.lastVersionId,
        };
      })
      .sort((a, b) => {
        if (a.isLast && !b.isLast) return -1;
        if (!a.isLast && b.isLast) return 1;
        return (b.releaseTime || '').localeCompare(a.releaseTime || '');
      });
  }, [details, versions, settings.lastVersionId]);

  const onPlay = async (id: string) => {
    if (!account) return;
    setBusyId(id);
    setStatus('Запуск ' + id);
    try {
      onSettingsChange({ ...settings, lastVersionId: id });
      await window.api.minecraft.launch({ versionId: id, account, memoryMb: settings.memoryMb });
      setStatus('Minecraft запущен');
    } catch (e) {
      setStatus('Ошибка: ' + (e as Error).message);
    } finally {
      // Снимаем busy сразу: launch отдаёт PID при старте, не при завершении игры.
      setBusyId(null);
    }
  };

  const onUninstall = async (id: string) => {
    const choice = await dialog.show({
      title: `Удалить версию ${id}?`,
      tone: 'danger',
      message: (
        <>
          <b>Полностью</b> — папка версии и (если она последняя) общие <code>libraries</code> и <code>assets</code>.
          <br />
          <b>Только версию</b> — удалится только её папка.
        </>
      ),
      buttons: [
        { label: 'Отмена', value: 'cancel', variant: 'ghost' },
        { label: 'Только версию', value: 'shallow', variant: 'default' },
        { label: 'Полностью', value: 'deep', variant: 'danger' },
      ],
      defaultIndex: 0,
      cancelValue: 'cancel',
    });
    if (choice === 'cancel') return;
    if (choice === 'deep') {
      await window.api.minecraft.uninstallDeep(id);
    } else {
      await window.api.minecraft.uninstall(id);
    }
    // Если удалили текущую «активную» версию — главная не должна показывать
    // её как выбранную. Бэкенд уже сбросил это в settings.json, но рендерер
    // держит копию в памяти — синхронизируем явно.
    if (settings.lastVersionId === id) {
      onSettingsChange({ ...settings, lastVersionId: '' });
    }
    setStatus('Удалено: ' + id);
    refresh();
  };

  const onRevertToVanilla = async (baseMc: string) => {
    const choice = await dialog.show({
      title: `Вернуть ${baseMc} к ванили?`,
      tone: 'warn',
      message: (
        <>
          Будут удалены все установленные мод-загрузчики для <b>{baseMc}</b>.
          Ванильная установка и её папки с модами/паками <b>сохранятся</b>.
        </>
      ),
      buttons: [
        { label: 'Отмена', value: 'cancel', variant: 'ghost' },
        { label: 'Вернуть', value: 'ok', variant: 'default' },
      ],
      defaultIndex: 0,
      cancelValue: 'cancel',
    });
    if (choice !== 'ok') return;
    const result = await window.api.minecraft.revertToVanilla(baseMc);
    setStatus(result.removed.length > 0
      ? `Удалено: ${result.removed.join(', ')}`
      : 'Лоадеров не было.');
    // Backend сам обновил lastVersionId — берём из возвращённых settings,
    // чтобы UI и settings.json не разъезжались.
    if (result.settings) {
      onSettingsChange(result.settings);
    } else if (settings.lastVersionId && result.removed.includes(settings.lastVersionId)) {
      onSettingsChange({ ...settings, lastVersionId: baseMc });
    }
    refresh();
  };

  const onUninstallAll = async () => {
    if (details.length === 0) return;
    const choice = await dialog.show({
      title: `Удалить все установленные версии (${details.length})?`,
      tone: 'danger',
      message: 'Все файлы версий будут удалены. Сохранения и аккаунты останутся.',
      buttons: [
        { label: 'Отмена', value: 'cancel', variant: 'ghost' },
        { label: 'Удалить все', value: 'ok', variant: 'danger' },
      ],
      defaultIndex: 0,
      cancelValue: 'cancel',
    });
    if (choice !== 'ok') return;
    const ids = details.map((d) => d.id);
    for (const id of ids) {
      try { await window.api.minecraft.uninstall(id); } catch {}
    }
    if (settings.lastVersionId && ids.includes(settings.lastVersionId)) {
      onSettingsChange({ ...settings, lastVersionId: '' });
    }
    setStatus(`Удалено: ${ids.length} версий`);
    refresh();
  };

  return (
    <div>
      <div className="page-head">
        <h1>Установленные</h1>
        <p>Версии, готовые к запуску</p>
      </div>

      {status && (
        <div className="hint" style={{ marginBottom: 12 }}>{status}</div>
      )}

      {items.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <h2 style={{ fontSize: 16, marginBottom: 8 }}>Пока нет установленных версий</h2>
          <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
            Откройте каталог и выберите версию, чтобы скачать её.
          </p>
          <button className="btn primary" onClick={onGoToBrowse}>
            Открыть каталог <IconArrow />
          </button>
        </div>
      ) : (
        <>
          <div className="installed-head">
            <span className="muted" style={{ fontSize: 13 }}>
              {items.length} {pluralize(items.length, 'версия', 'версии', 'версий')}
            </span>
            <div className="row">
              <button className="btn ghost sm" onClick={onGoToBrowse}>+ Добавить</button>
              <button className="btn ghost sm" onClick={onUninstallAll}>
                <IconTrash /> Удалить все
              </button>
            </div>
          </div>

          <div className="installed-grid">
            {items.map((it) => {
              // Имя карточки: baseMc, если есть лоадер — берём базу и приписываем бейдж.
              const showName = it.loader ? it.baseMc : it.id;
              return (
                <div key={it.id} className={'inst-card' + (it.isLast ? ' featured' : '')}>
                  <div className="inst-card-head">
                    <div className="inst-card-name">{showName}</div>
                    {it.isLast && <span className="pill">последняя</span>}
                  </div>
                  <div className="inst-card-meta">
                    {it.type !== 'unknown' && (
                      <span className={'tag ' + it.type}>{typeLabel[it.type] ?? it.type}</span>
                    )}
                    {it.loader && (
                      <span className="chip accent" title={`Лоадер: ${loaderLabel[it.loader]} ${it.loaderVersion ?? ''}`}>
                        + {loaderLabel[it.loader]}
                      </span>
                    )}
                    {it.releaseTime && (
                      <span className="chip">{new Date(it.releaseTime).toLocaleDateString('ru-RU')}</span>
                    )}
                    {!supportsCustomSkin(it.id, it.baseMc) && (
                      <span className="chip warn" title="Кастомные скины не поддерживаются на pre-1.6 версиях">
                        <IconSkinOff /> без скинов
                      </span>
                    )}
                  </div>
                  <div className="inst-card-actions">
                    <button
                      className="btn primary block"
                      disabled={!account || busyId === it.id}
                      onClick={() => onPlay(it.id)}
                    >
                      <IconPlay />
                      {busyId === it.id ? 'Запуск...' : 'Играть'}
                    </button>
                    <div className="row" style={{ gap: 4 }}>
                      {/* Установка лоадера доступна для чистых релизов без лоадера */}
                      {!it.loader && /^1\.\d+(\.\d+)?$/.test(it.id) && (
                        <button
                          className="icon-btn"
                          onClick={() => setLoaderFor(it.id)}
                          title="Установить мод-загрузчик (Fabric, Forge, NeoForge, Quilt)"
                        >
                          <IconCube />
                        </button>
                      )}
                      {/* Кнопка revert — только если это лоадер */}
                      {it.loader && (
                        <button
                          className="icon-btn"
                          onClick={() => onRevertToVanilla(it.baseMc)}
                          title={`Вернуться к ванили (${it.baseMc})`}
                        >
                          <IconRefresh />
                        </button>
                      )}
                      <button
                        className="icon-btn"
                        onClick={() => window.api.minecraft.openFolder('version', it.id)}
                        title="Открыть папку версии"
                      >
                        <IconFolder />
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => onUninstall(it.id)}
                        title="Удалить"
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <LoaderInstallDialog
        mcVersion={loaderFor ?? ''}
        open={loaderFor !== null}
        onClose={() => setLoaderFor(null)}
        onInstalled={async (versionId) => {
          await refresh();
          setStatus(`Установлено: ${versionId}`);
          onSettingsChange({ ...settings, lastVersionId: versionId });
        }}
      />
    </div>
  );
};

function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
