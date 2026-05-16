import React, { useEffect, useMemo, useState } from 'react';
import type { DownloadProgress, LauncherSettings, MinecraftAccount, VersionInfo } from '../../shared/types';
import type { JavaPlan } from '../../preload/preload';
import {
  IconPlay, IconInfo, IconAlert, IconCheck, IconSearch,
  IconFolder, IconRefresh, IconCube,
} from '../components/icons';
import { describeVersion } from '../data/versions';
import { LoaderInstallDialog } from '../components/LoaderInstallDialog';

interface Props {
  settings: LauncherSettings;
  account: MinecraftAccount | null;
  onGoToAccounts: () => void;
  onSettingsChange: (s: LauncherSettings) => void;
}

type Filter = 'all' | 'release' | 'snapshot' | 'old_beta' | 'old_alpha';

const typeLabel: Record<string, string> = {
  release: 'релиз', snapshot: 'снапшот', old_beta: 'beta', old_alpha: 'alpha',
};

export const BrowsePage: React.FC<Props> = ({ settings, account, onGoToAccounts, onSettingsChange }) => {
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string>('');
  const [filter, setFilter] = useState<Filter>('release');
  const [query, setQuery] = useState('');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [status, setStatus] = useState('');
  const [statusType, setStatusType] = useState<'neutral' | 'success' | 'error'>('neutral');
  const [busy, setBusy] = useState(false);
  const [javaPlan, setJavaPlan] = useState<JavaPlan | null>(null);
  const [loaderDialogOpen, setLoaderDialogOpen] = useState(false);

  const refreshInstalled = async () => {
    const list = await window.api.minecraft.installed();
    setInstalled(new Set(list));
  };

  useEffect(() => {
    window.api.minecraft.versions().then((list) => {
      setVersions(list);
      if (!selected && list.length) {
        const first = list.find((v) => v.type === 'release') || list[0];
        setSelected(first.id);
      }
    });
    refreshInstalled();

    const offProgress = window.api.minecraft.onProgress(setProgress);
    const offExit = window.api.minecraft.onExit((code) => {
      setStatus(`Игра завершилась (код ${code})`);
      setStatusType(code === 0 ? 'success' : 'error');
      setBusy(false);
    });
    const offManifest = window.api.minecraft.onManifestUpdated((list) => setVersions(list));
    return () => { offProgress(); offExit(); offManifest(); };
  }, []);

  useEffect(() => {
    if (!selected) { setJavaPlan(null); return; }
    let cancelled = false;
    setJavaPlan(null);
    window.api.java.planFor(selected).then((p) => { if (!cancelled) setJavaPlan(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [selected]);

  const filtered = useMemo(() => {
    return versions.filter((v) => {
      if (query && !v.id.toLowerCase().includes(query.toLowerCase())) return false;
      if (filter === 'all') return true;
      return v.type === filter;
    });
  }, [versions, query, filter]);

  const selectedVersion = versions.find((v) => v.id === selected);
  const isInstalled = !!(selected && installed.has(selected));
  const canAct = !!account && !!selected && !busy;

  const counts = useMemo(() => {
    const c = { all: versions.length, release: 0, snapshot: 0, old_beta: 0, old_alpha: 0 };
    for (const v of versions) (c as any)[v.type]++;
    return c;
  }, [versions]);

  const onInstallAndPlay = async () => {
    if (!account || !selected) return;
    setBusy(true);
    setStatusType('neutral');
    try {
      if (!isInstalled) {
        setStatus('Скачивание ' + selected);
        await window.api.minecraft.install(selected);
        await refreshInstalled();
        setStatus('Установлено: ' + selected);
        setStatusType('success');
        setBusy(false);
        onSettingsChange({ ...settings, lastVersionId: selected });
        return;
      }
      setStatus('Запуск Minecraft');
      onSettingsChange({ ...settings, lastVersionId: selected });
      await window.api.minecraft.launch({ versionId: selected, account, memoryMb: settings.memoryMb });
      setStatus('Minecraft запущен');
      setStatusType('success');
    } catch (e) {
      setStatus('Ошибка: ' + (e as Error).message);
      setStatusType('error');
      setBusy(false);
    }
  };

  const onInstallOnly = async () => {
    if (!selected) return;
    setBusy(true);
    setStatus('Скачивание ' + selected);
    setStatusType('neutral');
    try {
      await window.api.minecraft.install(selected);
      await refreshInstalled();
      setStatus('Установлено: ' + selected);
      setStatusType('success');
    } catch (e) {
      setStatus('Ошибка: ' + (e as Error).message);
      setStatusType('error');
    } finally {
      setBusy(false);
    }
  };

  const filterTabs: { id: Filter; label: string; accent: string; c: number }[] = [
    { id: 'release',   label: 'Релизы',   accent: 'release',   c: counts.release },
    { id: 'snapshot',  label: 'Снапшоты', accent: 'snapshot',  c: counts.snapshot },
    { id: 'old_beta',  label: 'Beta',     accent: 'beta',      c: counts.old_beta },
    { id: 'old_alpha', label: 'Alpha',    accent: 'alpha',     c: counts.old_alpha },
    { id: 'all',       label: 'Все',      accent: 'all',       c: counts.all },
  ];

  const playLabel = busy
    ? (isInstalled ? 'Запуск...' : 'Скачивание...')
    : (isInstalled ? 'Играть' : 'Скачать и играть');

  const isLoaderVersion = !!selected && /^1\.\d+(\.\d+)?$/.test(selected);

  return (
    <div className="catalog">
      <header className="catalog-head">
        <div>
          <h1>Каталог версий</h1>
          <p>Найдите и установите любую версию Minecraft</p>
        </div>
        <div className="catalog-head-stats">
          <span className="chip"><b>{versions.length}</b> доступно</span>
          <span className="chip success"><b>{installed.size}</b> установлено</span>
        </div>
      </header>

      <div className="catalog-grid">
        <aside className="catalog-list">
          <div className="catalog-search">
            <IconSearch className="search-icon" />
            <input
              className="input"
              placeholder="Поиск версий"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="lib-side-tabs">
            {filterTabs.map((t) => (
              <button
                key={t.id}
                className={'side-tab tab-' + t.accent + (filter === t.id ? ' active' : '')}
                onClick={() => setFilter(t.id)}
              >
                <span className="side-tab-dot" />
                <span className="side-tab-label">{t.label}</span>
                <span className="count">{t.c}</span>
              </button>
            ))}
          </div>

          <div className="catalog-list-scroll">
            {filtered.length === 0 ? (
              <div className="empty">Ничего не найдено</div>
            ) : (
              filtered.map((v) => {
                const isInst = installed.has(v.id);
                const isSel = selected === v.id;
                const isLastPlayed = v.id === settings.lastVersionId;
                return (
                  <div
                    key={v.id}
                    className={'version-row' + (isSel ? ' selected' : '')}
                    onClick={() => setSelected(v.id)}
                  >
                    <span
                      className={'version-dot ' + (isInst ? 'installed' : 'not-installed')}
                      title={isInst ? 'Установлено' : 'Не установлено'}
                    />
                    <div className="version-main">
                      <div className="version-name">
                        {v.id}
                        {isLastPlayed && <span className="pill">играли</span>}
                      </div>
                      <div className="version-meta">
                        {new Date(v.releaseTime).toLocaleDateString('ru-RU')}
                      </div>
                    </div>
                    <span className={'tag ' + v.type}>{typeLabel[v.type] ?? v.type}</span>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        <main className="catalog-detail">
          {!selected ? (
            <div className="catalog-empty">
              <div className="catalog-empty-icon"><IconCube /></div>
              <h2>Выберите версию</h2>
              <p>Найдите релиз, снапшот или олдовую beta-версию слева, чтобы увидеть детали и запустить игру.</p>
            </div>
          ) : (
            <>
              {!account && (
                <div className="banner">
                  <div>
                    <h2>Нет активного аккаунта</h2>
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Добавьте профиль, чтобы начать игру</div>
                  </div>
                  <button className="btn primary" onClick={onGoToAccounts}>В аккаунты</button>
                </div>
              )}

              <div className="catalog-hero">
                <div className="catalog-hero-info">
                  <div className="catalog-hero-eyebrow">
                    {isInstalled ? <><IconCheck /> Готово к игре</> : 'Не установлено'}
                  </div>
                  <h2 className="catalog-hero-title">{selected}</h2>
                  <div className="catalog-hero-meta">
                    {selectedVersion && (
                      <>
                        <span className={'tag ' + selectedVersion.type}>{typeLabel[selectedVersion.type] ?? selectedVersion.type}</span>
                        <span className="chip">
                          {new Date(selectedVersion.releaseTime).toLocaleDateString('ru-RU')}
                        </span>
                        {javaPlan && !javaPlan.error && (
                          <span className={'chip ' + (javaPlan.plan === 'download' ? 'warn' : 'accent')}>
                            Java {javaPlan.required}
                            {javaPlan.plan === 'reuse' && <> · найдена</>}
                            {javaPlan.plan === 'download' && <> · скачается</>}
                            {javaPlan.plan === 'user' && <> · своя</>}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <button className="play-btn home-play block" disabled={!canAct} onClick={onInstallAndPlay}>
                  {busy && progress && (
                    <span className="progress-fill" style={{ width: progress.percent + '%' }} />
                  )}
                  <span className="label">
                    <IconPlay />
                    {playLabel}
                  </span>
                </button>

                {(busy && progress) && (
                  <div className="hero-progress">
                    <div className="ab-progress-info">
                      <span className="ab-progress-stage">{progress.stage}</span>
                      <span>{progress.percent}%</span>
                    </div>
                    <div className="ab-progress-bar">
                      <div className="fill" style={{ width: progress.percent + '%' }} />
                    </div>
                  </div>
                )}

                {status && !busy && (
                  <div className={'status-line ' + statusType} style={{ marginTop: 12 }}>
                    {statusType === 'error' ? <IconAlert /> : statusType === 'success' ? <IconCheck /> : <IconInfo />}
                    <span>{status}</span>
                  </div>
                )}

                <div className="catalog-hero-tools">
                  {!isInstalled && (
                    <button className="btn" disabled={!selected || busy} onClick={onInstallOnly}>
                      <IconRefresh /> Только скачать
                    </button>
                  )}
                  {isInstalled && (
                    <button
                      className="btn"
                      disabled={!selected}
                      onClick={() => selected && window.api.minecraft.openFolder('version', selected)}
                    >
                      <IconFolder /> Папка версии
                    </button>
                  )}
                  {isLoaderVersion && (
                    <button
                      className="btn"
                      disabled={!selected || busy}
                      onClick={() => setLoaderDialogOpen(true)}
                    >
                      <IconCube /> Мод-загрузчик
                    </button>
                  )}
                </div>
              </div>

              {selectedVersion && describeVersion(selectedVersion) && (
                <div className="about-card">
                  <div className="about-head">
                    <span className="about-label">О версии</span>
                    <span className="about-id mono">{selectedVersion.id}</span>
                  </div>
                  <p className="about-text">{describeVersion(selectedVersion)}</p>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      <LoaderInstallDialog
        mcVersion={selected}
        open={loaderDialogOpen}
        onClose={() => setLoaderDialogOpen(false)}
        onInstalled={async (versionId) => {
          await refreshInstalled();
          setSelected(versionId);
          setStatus(`Установлено: ${versionId}`);
          setStatusType('success');
        }}
      />
    </div>
  );
};
