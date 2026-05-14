import React, { useEffect, useMemo, useState } from 'react';
import type { LauncherSettings, MinecraftAccount, VersionInfo } from '../../shared/types';
import { IconPlay, IconTrash, IconFolder, IconCube, IconArrow } from '../components/icons';
import { useDialog } from '../components/Dialog';
import { LoaderInstallDialog } from '../components/LoaderInstallDialog';

interface Props {
  settings: LauncherSettings;
  account: MinecraftAccount | null;
  onSettingsChange: (s: LauncherSettings) => void;
  onGoToBrowse: () => void;
}

const typeLabel: Record<string, string> = {
  release: 'релиз', snapshot: 'снапшот', old_beta: 'beta', old_alpha: 'alpha',
};

export const InstalledPage: React.FC<Props> = ({ settings, account, onSettingsChange, onGoToBrowse }) => {
  const dialog = useDialog();
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [installed, setInstalled] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [loaderFor, setLoaderFor] = useState<string | null>(null);

  const refresh = async () => {
    const list = await window.api.minecraft.installed();
    setInstalled(list);
  };

  useEffect(() => {
    window.api.minecraft.versions().then(setVersions);
    refresh();
  }, []);

  const items = useMemo(() => {
    return installed
      .map((id) => {
        const meta = versions.find((v) => v.id === id);
        return {
          id,
          type: meta?.type ?? 'unknown',
          releaseTime: meta?.releaseTime,
          isLast: id === settings.lastVersionId,
        };
      })
      .sort((a, b) => {
        if (a.isLast && !b.isLast) return -1;
        if (!a.isLast && b.isLast) return 1;
        return (b.releaseTime || '').localeCompare(a.releaseTime || '');
      });
  }, [installed, versions, settings.lastVersionId]);

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
    setStatus('Удалено: ' + id);
    refresh();
  };

  const onUninstallAll = async () => {
    if (installed.length === 0) return;
    const choice = await dialog.show({
      title: `Удалить все установленные версии (${installed.length})?`,
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
    for (const id of installed) {
      try { await window.api.minecraft.uninstall(id); } catch {}
    }
    setStatus(`Удалено: ${installed.length} версий`);
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

      {installed.length === 0 ? (
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
              {installed.length} {pluralize(installed.length, 'версия', 'версии', 'версий')}
            </span>
            <div className="row">
              <button className="btn ghost sm" onClick={onGoToBrowse}>+ Добавить</button>
              <button className="btn ghost sm" onClick={onUninstallAll}>
                <IconTrash /> Удалить все
              </button>
            </div>
          </div>

          <div className="installed-grid">
            {items.map((it) => (
              <div key={it.id} className={'inst-card' + (it.isLast ? ' featured' : '')}>
                <div className="inst-card-head">
                  <div className="inst-card-name">{it.id}</div>
                  {it.isLast && <span className="pill">последняя</span>}
                </div>
                <div className="inst-card-meta">
                  {it.type !== 'unknown' && (
                    <span className={'tag ' + it.type}>{typeLabel[it.type] ?? it.type}</span>
                  )}
                  {it.releaseTime && (
                    <span className="chip">{new Date(it.releaseTime).toLocaleDateString('ru-RU')}</span>
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
                    {/^1\.\d+(\.\d+)?$/.test(it.id) && (
                      <button
                        className="icon-btn"
                        onClick={() => setLoaderFor(it.id)}
                        title="Установить мод-загрузчик (Fabric, Forge, NeoForge, Quilt)"
                      >
                        <IconCube />
                      </button>
                    )}
                    <button
                      className="icon-btn"
                      onClick={() => window.api.minecraft.openFolder('version', it.id)}
                      title="Открыть папку"
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
            ))}
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
